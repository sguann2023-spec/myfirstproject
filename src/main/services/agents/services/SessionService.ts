import * as fs from 'node:fs'
import * as path from 'node:path'

import { loggerService } from '@logger'
import { getDataPath } from '@main/utils'
import { parsePluginMetadata } from '@main/utils/markdownParser'
import type { SlashCommand, UpdateSessionResponse } from '@types'
import {
  AgentBaseSchema,
  type AgentEntity,
  type AgentSessionEntity,
  type CreateSessionRequest,
  type GetAgentSessionResponse,
  type ListOptions,
  type UpdateSessionRequest
} from '@types'
import { and, asc, count, desc, eq, isNull, type SQL } from 'drizzle-orm'
import { isTokenTelemetry, mergeTokenTelemetry, type SessionTokenStatsSnapshot, type TokenContextTelemetry, type TokenTelemetry } from '@shared/tokenTelemetry'

import { BaseService } from '../BaseService'
import { agentsTable, type InsertSessionRow, type SessionRow, sessionsTable } from '../database/schema'
import { OrderedTaskQueue } from '../database/orderedTaskQueue'
import { insertSessionAtFront, persistWorkspaceSessionPaths, reorderSessionRows } from '../database/repositories/servicePersistence'
import type { AgentModelField } from '../errors'
import { builtinSlashCommands } from './claudecode/commands'
import { remapWorkspacePath, validateWorkspaceRename, workspaceRenameError } from './workspaceRename'

const logger = loggerService.withContext('SessionService')

const tokenUsageMetadata = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const result: Record<string, unknown> = {}
  const scalarFields = ['prompt_tokens', 'completion_tokens', 'total_tokens', 'input_tokens', 'output_tokens',
    'thoughts_tokens', 'reasoning_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens', 'cost']
  for (const key of scalarFields) {
    const number = (value as Record<string, unknown>)[key]
    if (typeof number === 'number' && Number.isFinite(number) && number >= 0) result[key] = number
  }
  for (const key of ['prompt_tokens_details', 'input_tokens_details', 'completion_tokens_details', 'output_tokens_details']) {
    const details = (value as Record<string, unknown>)[key]
    if (!details || typeof details !== 'object') continue
    const projected: Record<string, number> = {}
    for (const field of ['cached_tokens', 'cache_creation_input_tokens', 'cache_write_tokens', 'reasoning_tokens', 'audio_tokens']) {
      const number = (details as Record<string, unknown>)[field]
      if (typeof number === 'number' && Number.isFinite(number) && number >= 0) projected[field] = number
    }
    if (Object.keys(projected).length) result[key] = projected
  }
  return Object.keys(result).length ? result : undefined
}

export type SessionTokenStatsResponse = SessionTokenStatsSnapshot & {
  ok: true
  usageMessages: Array<{
    id: string
    role: string
    usage?: unknown
    usageSteps?: unknown[]
    tokenTelemetry?: TokenTelemetry
    model?: unknown
    traceId?: string
    invocationId?: string
    provider?: { requestId: string }
    createdAt?: unknown
  }>
  context: TokenContextTelemetry | null
  historyComplete: boolean
} | { ok: false; error: string }

export class SessionService extends BaseService {
  private static instance: SessionService | null = null
  private readonly workspaceRenameQueue = new OrderedTaskQueue()
  // Keep consumed requests until session deletion, including unpersisted/old-generation turns.
  private readonly tokenStats = new Map<string, SessionTokenStatsSnapshot>()
  private tokenStatsRevision = 0
  private readonly tokenStatsListeners = new Set<(agentId: string, snapshot: SessionTokenStatsSnapshot) => void>()

  onTokenStatsChanged(listener: (agentId: string, snapshot: SessionTokenStatsSnapshot) => void): () => void {
    this.tokenStatsListeners.add(listener)
    return () => { this.tokenStatsListeners.delete(listener) }
  }

  /** Must run in the session write queue. History contexts are deliberately never merged. */
  private captureTokenStats(agentId: string, id: string, configuration: Record<string, unknown>, ledger?: TokenTelemetry): SessionTokenStatsSnapshot {
    const previous = this.tokenStats.get(id)
    const merged = mergeTokenTelemetry(previous?.tokenTelemetry, ledger)
    const cached = configuration.token_context_telemetry
    const context = cached && isTokenTelemetry({ version: 1, requests: [], context: cached })
      ? cached as TokenContextTelemetry : null
    const contextGeneration = this.contextGeneration(configuration)
    const changed = !previous || contextGeneration !== previous.contextGeneration
      || JSON.stringify(context) !== JSON.stringify(previous.context)
      || merged.requests.length !== previous.tokenTelemetry.requests.length
      || merged.requests.some((request, index) => request !== previous.tokenTelemetry.requests[index])
    if (!changed) return previous
    const snapshot: SessionTokenStatsSnapshot = {
      sessionId: id, revision: ++this.tokenStatsRevision, contextGeneration,
      tokenTelemetry: { version: 1, requests: merged.requests, ...(context ? { context } : {}) }, context
    }
    this.tokenStats.set(id, snapshot)
    for (const listener of this.tokenStatsListeners) {
      try { listener(agentId, snapshot) } catch (error) {
        logger.warn('Token stats notification failed', { sessionId: id, error: error as Error })
      }
    }
    return snapshot
  }
  private readonly sessionWrites = new Map<string, { queue: OrderedTaskQueue; pending: number }>()

  private writeSession<T>(id: string, operation: () => Promise<T>): Promise<T> {
    let entry = this.sessionWrites.get(id)
    if (!entry) {
      entry = { queue: new OrderedTaskQueue(), pending: 0 }
      this.sessionWrites.set(id, entry)
    }
    const current = entry
    current.pending++
    return current.queue.run(operation).finally(() => {
      if (--current.pending === 0) this.sessionWrites.delete(id)
    })
  }
  private readonly modelFields: AgentModelField[] = ['model', 'plan_model', 'small_model']

  static getInstance(): SessionService {
    if (!SessionService.instance) {
      SessionService.instance = new SessionService()
    }
    return SessionService.instance
  }

  /**
   * Override BaseService.listSlashCommands to merge builtin and plugin commands
   */
  async listSlashCommands(agentType: string, agentId?: string): Promise<SlashCommand[]> {
    const commands: SlashCommand[] = []
    const builtinCommandNames: string[] = []
    const localCommandNames: string[] = []

    // Add builtin slash commands
    if (agentType === 'claude-code') {
      commands.push(...builtinSlashCommands)
      for (const cmd of builtinSlashCommands) {
        builtinCommandNames.push(String(cmd.command || ''))
      }
    }

    // Add local command plugins from .claude/commands/
    if (agentId) {
      try {
        const database = await this.getDatabase()
        const result = await database.select().from(agentsTable).where(eq(agentsTable.id, agentId)).limit(1)
        const agent = result[0] ? this.deserializeJsonFields(result[0]) : null
        const workdir = (agent as AgentEntity | null)?.accessible_paths?.[0]

        if (workdir) {
          const commandsDir = path.join(workdir, '.claude', 'commands')
          try {
            const entries = await fs.promises.readdir(commandsDir, { withFileTypes: true })
            const ALLOWED_EXTENSIONS = ['.md', '.txt']
            let localCount = 0

            for (const entry of entries) {
              if (!entry.isFile()) continue
              const ext = path.extname(entry.name).toLowerCase()
              if (!ALLOWED_EXTENSIONS.includes(ext)) continue

              try {
                const filePath = path.join(commandsDir, entry.name)
                const metadata = await parsePluginMetadata(
                  filePath,
                  path.join('commands', entry.name),
                  'commands',
                  'command'
                )
                const commandName = entry.name.replace(/\.md$/i, '')
                localCommandNames.push(`/${commandName}`)
                commands.push({
                  command: `/${commandName}`,
                  description: metadata.description
                })
                localCount++
              } catch {
                // Skip files that fail to parse
              }
            }

            logger.info('Listed slash commands', {
              agentType,
              agentId,
              builtinCount: builtinSlashCommands.length,
              localCount,
              totalCount: commands.length,
              builtinCommands: builtinCommandNames.sort(),
              localCommands: Array.from(new Set(localCommandNames)).sort()
            })
          } catch {
            // .claude/commands/ doesn't exist, that's fine
          }
        }
      } catch (error) {
        logger.warn('Failed to list local command plugins', {
          agentId,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    return commands
  }

  async createSession(
    agentId: string,
    req: Partial<CreateSessionRequest> = {}
  ): Promise<GetAgentSessionResponse | null> {
    // Validate agent exists - we'll need to import AgentService for this check
    // For now, we'll skip this validation to avoid circular dependencies
    // The database foreign key constraint will handle this

    const database = await this.getDatabase()
    const agents = await database
      .select()
      .from(agentsTable)
      .where(and(eq(agentsTable.id, agentId), isNull(agentsTable.deleted_at)))
      .limit(1)
    if (!agents[0]) {
      throw new Error('Agent not found')
    }
    const agent = this.deserializeJsonFields(agents[0]) as AgentEntity

    const id = `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
    const now = new Date().toISOString()

    // inherit configuration from agent by default, can be overridden by sessionData
    const sessionData: Partial<CreateSessionRequest> = {
      ...agent,
      ...req
    }

    const requestedAccessiblePaths = Array.isArray(req.accessible_paths)
      ? req.accessible_paths.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
      : []
    sessionData.accessible_paths = requestedAccessiblePaths
    const selectedWorkspacePath = String(
      ((sessionData.configuration as Record<string, unknown> | undefined)?.selected_workspace_path as string | undefined) || ''
    ).trim()
    if (requestedAccessiblePaths.length > 0 && !selectedWorkspacePath) {
      sessionData.configuration = {
        ...((sessionData.configuration as Record<string, unknown> | undefined) ?? {}),
        selected_workspace_path: requestedAccessiblePaths[0]
      } as unknown as CreateSessionRequest['configuration']
    }

    await this.validateAgentModels(agent.type, {
      model: sessionData.model,
      plan_model: sessionData.plan_model,
      small_model: sessionData.small_model
    }, {
      runtimeApiKey: String(
        (sessionData.configuration as Record<string, any> | undefined)?.env_vars?.VECTCUT_API_KEY || ''
      ).trim()
    })

    if (sessionData.accessible_paths !== undefined) {
      sessionData.accessible_paths = this.ensurePathsExist(sessionData.accessible_paths)
    }

    const serializedData = this.serializeJsonFields(sessionData)

    const insertData: InsertSessionRow = {
      id,
      agent_id: agentId,
      agent_type: agent.type,
      name: serializedData.name || null,
      description: serializedData.description || null,
      accessible_paths: serializedData.accessible_paths || null,
      instructions: serializedData.instructions || null,
      model: serializedData.model || null,
      plan_model: serializedData.plan_model || null,
      small_model: serializedData.small_model || null,
      mcps: serializedData.mcps || null,
      allowed_tools: serializedData.allowed_tools || null,
      configuration: serializedData.configuration || null,
      sort_order: 0,
      created_at: now,
      updated_at: now
    }

    const db = await this.getDatabase()
    // Serialize display-order changes within this agent's session list.
    await insertSessionAtFront(db, insertData)

    const result = await db.select().from(sessionsTable).where(eq(sessionsTable.id, id)).limit(1)

    if (!result[0]) {
      throw new Error('Failed to create session')
    }

    const session = this.deserializeJsonFields(result[0])
    return await this.getSession(agentId, session.id)
  }

  async getSession(agentId: string | undefined, id: string): Promise<GetAgentSessionResponse | null> {
    const database = await this.getDatabase()
    const result = await database
      .select()
      .from(sessionsTable)
      .where(agentId ? and(eq(sessionsTable.id, id), eq(sessionsTable.agent_id, agentId)) : eq(sessionsTable.id, id))
      .limit(1)

    if (!result[0]) {
      return null
    }

    const session = this.deserializeJsonFields(result[0]) as GetAgentSessionResponse
    const { tools, legacyIdMap } = await this.listMcpTools(session.agent_type, session.mcps)
    session.tools = tools
    session.allowed_tools = this.normalizeAllowedTools(session.allowed_tools, session.tools, legacyIdMap)

    // If slash_commands is not in database yet (e.g., first invoke before init message),
    // fall back to builtin + local commands. Otherwise, use the merged commands from database.
    if (!session.slash_commands || session.slash_commands.length === 0) {
      session.slash_commands = await this.listSlashCommands(session.agent_type, session.agent_id)
    }

    return session
  }

  async listSessions(
    agentId?: string,
    options: ListOptions = {}
  ): Promise<{ sessions: AgentSessionEntity[]; total: number }> {
    // Build where conditions
    const whereConditions: SQL[] = []
    if (agentId) {
      whereConditions.push(eq(sessionsTable.agent_id, agentId))
    }

    const whereClause =
      whereConditions.length > 1
        ? and(...whereConditions)
        : whereConditions.length === 1
          ? whereConditions[0]
          : undefined

    // Get total count
    const database = await this.getDatabase()
    const totalResult = await database.select({ count: count() }).from(sessionsTable).where(whereClause)

    const total = totalResult[0].count

    // Build list query with pagination - sort by sort_order ASC, created_at DESC for tie-breaking
    const baseQuery = database
      .select()
      .from(sessionsTable)
      .where(whereClause)
      .orderBy(asc(sessionsTable.sort_order), desc(sessionsTable.created_at))

    const result =
      options.limit !== undefined
        ? options.offset !== undefined
          ? await baseQuery.limit(options.limit).offset(options.offset)
          : await baseQuery.limit(options.limit)
        : await baseQuery

    const sessions = result.map((row) => this.deserializeJsonFields(row)) as GetAgentSessionResponse[]

    return { sessions, total }
  }

  async renameWorkspace(source: string, name: string, isBusy: () => boolean) {
    const database = await this.getDatabase()
    return this.workspaceRenameQueue.run(async () => {
      // The caller holds the execution gate while paths are moved and persisted.
      // Only filesystem compensation belongs here; SQL atomicity belongs to persistence.
      let movedTarget = ''
      try {
        const rows = await database.select().from(sessionsTable)
        // Reject stale requests BEFORE touching the filesystem, even if the old
        // pathname has since been reused by an unrelated folder.
        const associated = rows.some((row) => {
          const session = this.deserializeJsonFields(row) as AgentSessionEntity
          return [...(session.accessible_paths || []), (session.configuration as any)?.selected_workspace_path]
            .some((value) => typeof value === 'string' && remapWorkspacePath(value, source, '/__renamed_workspace__') !== value)
        })
        if (!associated) throw new Error('工作空间信息已过期，请刷新后重试')
        const target = validateWorkspaceRename(source, name)
        if (isBusy()) throw new Error('存在运行中的会话，请等待该工作空间的任务结束后重命名')
        if (target === path.resolve(source)) return { source, target, sessions: [] }
        const affected = rows.flatMap((row) => {
          const session = this.deserializeJsonFields(row) as AgentSessionEntity
          const configuration = { ...(session.configuration || {}) } as Record<string, any>
          const accessible_paths = (session.accessible_paths || []).map((p) => remapWorkspacePath(p, source, target))
          if (typeof configuration.selected_workspace_path === 'string') {
            configuration.selected_workspace_path = remapWorkspacePath(configuration.selected_workspace_path, source, target)
          }
          return JSON.stringify(accessible_paths) !== JSON.stringify(session.accessible_paths)
            || configuration.selected_workspace_path !== (session.configuration as any)?.selected_workspace_path
            ? [{ session, accessible_paths, configuration }] : []
        })
        if (!affected.length) throw new Error('工作空间未关联任何会话')
        fs.renameSync(source, target)
        movedTarget = target
        await persistWorkspaceSessionPaths(database, affected.map((item) => ({
          id: item.session.id,
          ...this.serializeJsonFields({ accessible_paths: item.accessible_paths, configuration: item.configuration })
        })))
        return { source, target, sessions: affected.map(({ session, ...updates }) => ({ ...session, ...updates })) }
      } catch (error) {
        if (movedTarget) {
          try {
            try { fs.lstatSync(source); throw new Error('source reused') } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
            }
            fs.renameSync(movedTarget, source)
          } catch {
            throw new Error('重命名失败且目录恢复失败，请停止操作并联系支持人员')
          }
        }
        throw workspaceRenameError(error)
      }
    })
  }

  async updateSession(
    agentId: string,
    id: string,
    updates: UpdateSessionRequest
  ): Promise<UpdateSessionResponse | null> {
    return this.writeSession(id, () => this.updateSessionLocked(agentId, id, updates))
  }

  private async updateSessionLocked(
    agentId: string, id: string, updates: UpdateSessionRequest
  ): Promise<UpdateSessionResponse | null> {
    // Read configuration inside the same queue as telemetry writes.
    const existing = await this.getSession(agentId, id)
    if (!existing) {
      return null
    }

    // Validate agent exists if changing main_agent_id
    // We'll skip this validation for now to avoid circular dependencies

    const now = new Date().toISOString()
    const normalizedUpdates: UpdateSessionRequest = { ...updates }

    if (normalizedUpdates.accessible_paths !== undefined) {
      if (normalizedUpdates.accessible_paths.length === 0) {
        throw new Error('accessible_paths must not be empty')
      }
      normalizedUpdates.accessible_paths = this.resolveAccessiblePaths(normalizedUpdates.accessible_paths, existing.agent_id)
    }

    if (Object.prototype.hasOwnProperty.call(normalizedUpdates, 'configuration')) {
      const existingConfiguration =
        existing.configuration && typeof existing.configuration === 'object'
          ? (existing.configuration as Record<string, unknown>)
          : {}
      const incomingConfiguration =
        normalizedUpdates.configuration && typeof normalizedUpdates.configuration === 'object'
          ? (normalizedUpdates.configuration as Record<string, unknown>)
          : {}
      const existingEnvVars =
        existingConfiguration.env_vars && typeof existingConfiguration.env_vars === 'object'
          ? (existingConfiguration.env_vars as Record<string, unknown>)
          : {}
      const incomingEnvVars =
        incomingConfiguration.env_vars && typeof incomingConfiguration.env_vars === 'object'
          ? (incomingConfiguration.env_vars as Record<string, unknown>)
          : {}

      // This key is maintained only by the runtime observer, never by stale UI snapshots.
      const { token_context_telemetry: _ignoredContext, token_context_generation: _ignoredGeneration, ...incomingConfig } = incomingConfiguration
      normalizedUpdates.configuration = {
        ...existingConfiguration,
        ...incomingConfig,
        env_vars: {
          ...existingEnvVars,
          ...incomingEnvVars
        }
      } as UpdateSessionRequest['configuration']
    }

    const modelUpdates: Partial<Record<AgentModelField, string | undefined>> = {}
    for (const field of this.modelFields) {
      if (Object.prototype.hasOwnProperty.call(normalizedUpdates, field)) {
        modelUpdates[field] = normalizedUpdates[field as keyof UpdateSessionRequest] as string | undefined
      }
    }

    if (Object.keys(modelUpdates).length > 0) {
      const effectiveConfiguration = normalizedUpdates.configuration ?? existing.configuration
      await this.validateAgentModels(existing.agent_type, modelUpdates, {
        runtimeApiKey: String(
          (effectiveConfiguration as Record<string, any> | undefined)?.env_vars?.VECTCUT_API_KEY || ''
        ).trim()
      })
    }

    const configuration = (existing.configuration || {}) as Record<string, unknown>
    const nextConfiguration = (normalizedUpdates.configuration || configuration) as Record<string, unknown>
    const contextChanged = this.modelFields.some(field =>
      Object.prototype.hasOwnProperty.call(updates, field) && updates[field] !== existing[field])
      || ['runtime_session_id', 'session_id', 'clear_context', 'context_reset_at', 'clear_history_at'].some(key =>
        Object.prototype.hasOwnProperty.call(nextConfiguration, key) && nextConfiguration[key] !== configuration[key])
    if (contextChanged) {
      const cached = configuration.token_context_telemetry
      normalizedUpdates.configuration = {
        ...nextConfiguration,
        token_context_generation: this.contextGeneration(configuration) + 1,
        ...(cached && isTokenTelemetry({ version: 1, requests: [], context: cached })
          ? { token_context_telemetry: this.invalidatedContext(cached as TokenContextTelemetry) } : {})
      } as unknown as UpdateSessionRequest['configuration']
    }

    const serializedUpdates = this.serializeJsonFields(normalizedUpdates)

    const updateData: Partial<SessionRow> = {
      updated_at: now
    }
    const replaceableFields = Object.keys(AgentBaseSchema.shape) as (keyof SessionRow)[]

    for (const field of replaceableFields) {
      if (Object.prototype.hasOwnProperty.call(serializedUpdates, field)) {
        const value = serializedUpdates[field as keyof typeof serializedUpdates]
        ;(updateData as Record<string, unknown>)[field] = value ?? null
      }
    }

    const database = await this.getDatabase()
    await database.update(sessionsTable).set(updateData).where(eq(sessionsTable.id, id))

    if (contextChanged) this.captureTokenStats(agentId, id, normalizedUpdates.configuration as Record<string, unknown>)
    return await this.getSession(agentId, id)
  }

  private invalidatedContext(context: TokenContextTelemetry): TokenContextTelemetry {
    return { ...context, revision: context.revision + 1, observedAt: Math.max(Date.now(), context.observedAt + 1),
      basis: 'invalidated', validity: 'stale', reason: 'Session model or context changed' }
  }

  private contextGeneration(configuration: Record<string, unknown>): number {
    const value = configuration.token_context_generation
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
  }

  /** Capture once before starting a runtime invocation, not when observing its chunks. */
  async getTokenContextGeneration(agentId: string, id: string): Promise<number | null> {
    return this.writeSession(id, async () => {
      const session = await this.getSession(agentId, id)
      return session ? this.contextGeneration((session.configuration || {}) as Record<string, unknown>) : null
    })
  }

  /** Ingest the entire runtime ledger even when its context is rejected. */
  async ingestTokenTelemetry(agentId: string, id: string, telemetry: unknown, expectedGeneration: number): Promise<SessionTokenStatsSnapshot | null> {
    if (!isTokenTelemetry(telemetry)) return null
    return this.writeSession(id, async () => {
      const session = await this.getSession(agentId, id)
      if (!session) return null
      const configuration = { ...(session.configuration || {}) } as Record<string, unknown>
      if (telemetry.context) await this.updateTokenContextLocked(agentId, id, session, configuration, telemetry.context, expectedGeneration)
      const previous = this.tokenStats.get(id)
      const snapshot = this.captureTokenStats(agentId, id, configuration, telemetry)
      return snapshot === previous ? null : snapshot
    })
  }

  /** Compatibility entry point; context and ledger always share the same snapshot clock. */
  async updateTokenContext(agentId: string, id: string, context: unknown, expectedGeneration: number): Promise<boolean> {
    if (!context || !isTokenTelemetry({ version: 1, requests: [], context })) return false
    return this.writeSession(id, async () => {
      const session = await this.getSession(agentId, id)
      if (!session) return false
      const configuration = { ...(session.configuration || {}) } as Record<string, unknown>
      const updated = await this.updateTokenContextLocked(agentId, id, session, configuration, context as TokenContextTelemetry, expectedGeneration)
      if (updated) this.captureTokenStats(agentId, id, configuration)
      return updated
    })
  }

  private async updateTokenContextLocked(
    agentId: string, id: string, session: GetAgentSessionResponse, configuration: Record<string, unknown>,
    incoming: TokenContextTelemetry, expectedGeneration: number
  ): Promise<boolean> {
    if (incoming.runtimeSessionId !== id || expectedGeneration !== this.contextGeneration(configuration)) return false
    const model = String(session.model || '').trim()
    const separator = model.indexOf(':')
    if (separator >= 0) {
      if (incoming.providerId !== model.slice(0, separator) || incoming.modelId !== model.slice(separator + 1)) return false
    } else if (!model || incoming.modelId !== model) return false
    const cached = configuration.token_context_telemetry
    if (cached && isTokenTelemetry({ version: 1, requests: [], context: cached })) {
      const previous = cached as TokenContextTelemetry
      if (incoming.id === previous.id && incoming.runtimeSessionId === previous.runtimeSessionId
        && incoming.revision <= previous.revision) return false
      if (incoming.observedAt < previous.observedAt ||
        (previous.basis === 'invalidated' && incoming.observedAt <= previous.observedAt)) return false
    }
    const database = await this.getDatabase()
    const nextConfiguration = { ...configuration, token_context_telemetry: incoming }
    await database.update(sessionsTable).set(this.serializeJsonFields({ configuration: nextConfiguration }))
      .where(and(eq(sessionsTable.id, id), eq(sessionsTable.agent_id, agentId)))
    configuration.token_context_telemetry = incoming
    return true
  }

  async invalidateTokenContext(agentId: string, id: string): Promise<void> {
    await this.writeSession(id, async () => {
      const session = await this.getSession(agentId, id)
      const configuration = { ...(session?.configuration || {}) } as Record<string, unknown>
      const context = configuration.token_context_telemetry
      if (!session) return
      configuration.token_context_generation = this.contextGeneration(configuration) + 1
      if (context && isTokenTelemetry({ version: 1, requests: [], context })) {
        configuration.token_context_telemetry = this.invalidatedContext(context as TokenContextTelemetry)
      }
      const database = await this.getDatabase()
      await database.update(sessionsTable).set(this.serializeJsonFields({ configuration }))
        .where(and(eq(sessionsTable.id, id), eq(sessionsTable.agent_id, agentId)))
      this.captureTokenStats(agentId, id, configuration)
    })
  }

  async getTokenStats(agentId: string, id: string): Promise<SessionTokenStatsResponse> {
    const session = await this.getSession(agentId, id)
    if (!session) return { ok: false, error: 'session not found' }
    const { agentHistoryService } = await import('../database/agentHistoryService')
    const messages = new Map<string, Extract<SessionTokenStatsResponse, { ok: true }>['usageMessages'][number]>()
    let tokenTelemetry: TokenTelemetry = { version: 1, requests: [] }
    let afterSequence = -1
    let historyComplete = false
    let sourcesComplete = true
    try {
      while (true) {
        const page = await agentHistoryService.getHistory(id, { afterSequence, limit: 500, readOnly: true })
        if (page.historyComplete === false) sourcesComplete = false
        for (const persisted of page.messages) {
          const message = persisted.message as unknown as Record<string, any>
          if (typeof message.id !== 'string' || !message.id) continue
          const telemetry = isTokenTelemetry(message.tokenTelemetry) ? message.tokenTelemetry : undefined
          const usage = tokenUsageMetadata(message.usage)
          const usageSteps = Array.isArray(message.usageSteps)
            ? message.usageSteps.map(tokenUsageMetadata).filter((item): item is Record<string, unknown> => !!item) : undefined
          if (telemetry) tokenTelemetry = mergeTokenTelemetry(tokenTelemetry, telemetry)
          // Explicit metadata projection: never send content, blocks, tool arguments or results.
          messages.set(message.id, {
            id: message.id, role: String(message.role || ''),
            ...(usage ? { usage } : {}),
            ...(usageSteps ? { usageSteps } : {}),
            ...(telemetry ? { tokenTelemetry: telemetry } : {}),
            ...(typeof message.model === 'string' ? { model: message.model } : {}),
            ...(typeof message.traceId === 'string' ? { traceId: message.traceId } : {}),
            ...(typeof message.invocationId === 'string' ? { invocationId: message.invocationId } : {}),
            ...(typeof message.provider?.requestId === 'string' ? { provider: { requestId: message.provider.requestId } } : {}),
            ...(typeof message.createdAt === 'number' || typeof message.createdAt === 'string' ? { createdAt: message.createdAt } : {})
          })
        }
        if (!page.hasMore) { historyComplete = sourcesComplete; break }
        const next = page.nextAfterSequence
        if (typeof next !== 'number' || !Number.isFinite(next) || next <= afterSequence) break
        afterSequence = next
      }
    } catch (error) {
      logger.warn('Token stats history read incomplete', { sessionId: id, error: error as Error })
    }
    // Pagination is outside the write queue. Capture only after it finishes so delayed
    // history reads can never label an old overlay/context with a newer revision.
    return this.writeSession(id, async () => {
      const latest = await this.getSession(agentId, id)
      if (!latest) return { ok: false as const, error: 'session not found' }
      const snapshot = this.captureTokenStats(agentId, id, (latest.configuration || {}) as Record<string, unknown>, tokenTelemetry)
      return { ok: true as const, ...snapshot, usageMessages: [...messages.values()], historyComplete }
    })
  }

  async deleteSession(agentId: string, id: string): Promise<boolean> {
    return this.writeSession(id, () => this.deleteSessionLocked(agentId, id))
  }

  private async deleteSessionLocked(agentId: string, id: string): Promise<boolean> {
    const existing = await this.getSession(agentId, id)
    const database = await this.getDatabase()
    const result = await database
      .delete(sessionsTable)
      .where(and(eq(sessionsTable.id, id), eq(sessionsTable.agent_id, agentId)))

    if (result.rowsAffected > 0) {
      this.tokenStats.delete(id)
      const sessionWorkspace = existing?.accessible_paths?.[0]
      if (sessionWorkspace && this.isManagedSessionWorkspace(sessionWorkspace)) {
        try {
          await fs.promises.rm(sessionWorkspace, { recursive: true, force: true })
        } catch (error) {
          logger.warn('Failed to remove session workspace', {
            sessionId: id,
            sessionWorkspace,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }
    }

    return result.rowsAffected > 0
  }

  private getManagedSessionsRoot(): string {
    return path.resolve(getDataPath('SessionWorkspaces'))
  }

  private isManagedSessionWorkspace(workspace: string): boolean {
    const root = this.getManagedSessionsRoot()
    const resolved = path.resolve(workspace)
    return resolved === root || resolved.startsWith(root + path.sep)
  }

  private async prepareSessionWorkspaceWithSkills(
    agentId: string,
    sessionId: string,
    agentWorkspace?: string
  ): Promise<string> {
    const sessionWorkspace = path.join(this.getManagedSessionsRoot(), agentId, sessionId)
    const sessionClaudeDir = path.join(sessionWorkspace, '.claude')
    const sessionSkillsRoot = path.join(sessionClaudeDir, 'skills')
    const agentSkillsRoot = agentWorkspace
      ? path.join(path.resolve(agentWorkspace), '.claude', 'skills')
      : undefined

    await fs.promises.mkdir(sessionClaudeDir, { recursive: true })

    if (!agentSkillsRoot) {
      logger.warn('Preparing session workspace without shared agent skills because agent workspace is missing', {
        agentId,
        sessionId,
        workspace: sessionWorkspace
      })
      await fs.promises.mkdir(sessionSkillsRoot, { recursive: true })
      return sessionWorkspace
    }

    try {
      await fs.promises.mkdir(agentSkillsRoot, { recursive: true })
      await fs.promises.rm(sessionSkillsRoot, { recursive: true, force: true })
      await fs.promises.symlink(
        agentSkillsRoot,
        sessionSkillsRoot,
        process.platform === 'win32' ? 'junction' : 'dir'
      )

      logger.info('Prepared session workspace with shared agent skills', {
        agentId,
        sessionId,
        workspace: sessionWorkspace,
        agentWorkspace,
        agentSkillsRoot
      })
    } catch (error) {
      logger.warn('Failed to link agent skills into session workspace', {
        agentId,
        sessionId,
        workspace: sessionWorkspace,
        agentWorkspace,
        agentSkillsRoot,
        error: error instanceof Error ? error.message : String(error)
      })
      await fs.promises.mkdir(sessionSkillsRoot, { recursive: true })
    }

    return sessionWorkspace
  }


  async reorderSessions(agentId: string, orderedIds: string[]): Promise<void> {
    const database = await this.getDatabase()
    await reorderSessionRows(database, agentId, orderedIds)
    logger.info('Sessions reordered', { agentId, count: orderedIds.length })
  }

  async sessionExists(agentId: string, id: string): Promise<boolean> {
    const database = await this.getDatabase()
    const result = await database
      .select({ id: sessionsTable.id })
      .from(sessionsTable)
      .where(and(eq(sessionsTable.id, id), eq(sessionsTable.agent_id, agentId)))
      .limit(1)

    return result.length > 0
  }
}

export const sessionService = SessionService.getInstance()
