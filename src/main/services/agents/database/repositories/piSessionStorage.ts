import { createHash, randomUUID } from 'node:crypto'

import type {
  SessionEntryCursorOptions,
  SessionErrorCode,
  SessionMetadata,
  SessionStats,
  SessionStorage,
  SessionTreeEntry
} from '@earendil-works/pi-agent-core'
import { and, asc, eq, gt, sql } from 'drizzle-orm'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'

import { piInvocationEntriesTable, piSessionEntriesTable, piSessionsTable } from '../schema'
import type * as schema from '../schema'
import { withDbWriteLock } from '../dbWriteQueue'
import { AgentTranscriptRepository } from './agentTranscriptRepository'
import type { AgentMessagePart, AgentMessageWithParts } from './agentTranscript.types'

export interface DurablePiSessionMetadata extends SessionMetadata {
  topicId: string
  metadata?: Record<string, unknown>
}

type AgentDatabase = LibSQLDatabase<typeof schema>
type AgentTransaction = Parameters<Parameters<AgentDatabase['transaction']>[0]>[0]
type DatabaseExecutor = AgentDatabase | AgentTransaction

type InvocationEntryKind = 'user_message'
type PiAgentMessage = Extract<SessionTreeEntry, { type: 'message' }>['message']

const topicQueues = new Map<string, Promise<void>>()
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// pi-agent-core is ESM-only while the main process bundle is CJS, so the class
// must not be imported statically. Load the real SessionError lazily via native
// dynamic import (same technique as create-harness) so `instanceof SessionError`
// checks inside the PI harness keep working; fall back to a code-compatible
// error only if the package cannot be imported at runtime.
const nativeDynamicImport = new Function('specifier', 'return import(specifier)') as <TModule>(
  specifier: string
) => Promise<TModule>
type SessionErrorConstructor = new (code: SessionErrorCode, message: string, cause?: Error) => Error
let sessionErrorConstructor: SessionErrorConstructor | undefined

async function sessionError(code: SessionErrorCode, message: string, cause?: Error): Promise<Error> {
  if (!sessionErrorConstructor) {
    try {
      const mod = await nativeDynamicImport<{
        SessionError: new (code: SessionErrorCode, message: string, cause?: Error) => Error
      }>('@earendil-works/pi-agent-core')
      sessionErrorConstructor = mod.SessionError
    } catch {
      sessionErrorConstructor = class SessionError extends Error {
        readonly code: SessionErrorCode
        constructor(code: SessionErrorCode, message: string) {
          super(message)
          this.name = 'SessionError'
          this.code = code
        }
      }
    }
  }
  return new sessionErrorConstructor(code, message, cause)
}

function serializeForTopic<T>(topicId: string, operation: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> =>
    // Global DB write lock keeps PI entry transactions from interleaving
    // statements with canonical transcript transactions on the single libsql
    // connection (SQLITE_BUSY / "statements in progress"). FIFO order also
    // preserves per-topic sequencing.
    withDbWriteLock(operation)
  const previous = topicQueues.get(topicId) ?? Promise.resolve()
  const result = previous.then(run, run)
  const settled = result.then(
    () => undefined,
    () => undefined
  )
  topicQueues.set(topicId, settled)
  void settled.finally(() => {
    if (topicQueues.get(topicId) === settled) topicQueues.delete(topicId)
  })
  return result
}

function nextEntryId(): string {
  return randomUUID().replaceAll('-', '').slice(-12)
}

function stableEntryId(prefix: string, ...values: unknown[]): string {
  return `${prefix}_${createHash('sha256')
    .update(values.map((value) => String(value ?? '')).join('\u0000'))
    .digest('hex')
    .slice(0, 24)}`
}

function partText(part: AgentMessagePart): string {
  return String(part.data.text ?? part.data.content ?? '')
}

function emptyUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
  }
}

function toolCallId(part: AgentMessagePart): string {
  return String(part.data.toolCallId ?? part.data.toolId ?? part.data.id ?? part.id)
}

function toolName(part: AgentMessagePart): string {
  return String(part.data.toolName ?? part.data.name ?? 'tool')
}

function toolInput(part: AgentMessagePart): Record<string, unknown> {
  const value = part.data.arguments ?? part.data.input
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function toolResultContent(part: AgentMessagePart): Array<{ type: 'text'; text: string }> {
  const raw = part.data.metadata && typeof part.data.metadata === 'object'
    ? (part.data.metadata as Record<string, any>).rawMcpToolResponse?.responseRaw
    : undefined
  const value = raw ?? part.data.rawOutput ?? part.data.output ?? part.data.content ?? part.data.result ?? part.data.error
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '')
  return [{ type: 'text', text: text || 'Tool completed without output.' }]
}

function isToolError(part: AgentMessagePart): boolean {
  const status = String(part.data.status ?? '').toLowerCase()
  return status === 'error' || status === 'failed' || part.data.isError === true
}

function hasToolResult(part: AgentMessagePart): boolean {
  const status = String(part.data.status ?? '').toLowerCase()
  if (!['completed', 'complete', 'error', 'failed', 'cancelled'].includes(status) && part.data.isError !== true) {
    return false
  }
  return ['rawOutput', 'output', 'content', 'result', 'error'].some(
    (key) => part.data[key] !== undefined && part.data[key] !== null
  ) || Boolean(
    part.data.metadata &&
    typeof part.data.metadata === 'object' &&
    (part.data.metadata as Record<string, any>).rawMcpToolResponse?.responseRaw !== undefined
  )
}

export function canonicalMessageToPi(entry: AgentMessageWithParts, includeProviderHidden = false): PiAgentMessage[] {
  const { message, parts } = entry
  const timestamp = Date.parse(message.createdAt) || Date.now()
  if (!includeProviderHidden && message.semantics?.providerVisibility === 'hidden') return []
  if (message.role === 'user') {
    const content: any[] = []
    for (const part of parts) {
      if (part.type === 'text') content.push({ type: 'text', text: partText(part) })
      if (part.type === 'image') {
        const data = String(part.data.data ?? '')
        const mimeType = String(part.data.mediaType ?? part.data.mimeType ?? 'image/png')
        if (data) content.push({ type: 'image', data, mimeType })
      }
    }
    const normalized = content.filter((item) => item.type !== 'text' || item.text)
    return [{ role: 'user', content: normalized.length === 1 && normalized[0].type === 'text' ? normalized[0].text : normalized, timestamp } as PiAgentMessage]
  }
  if (message.role === 'assistant') {
    const content: any[] = []
    for (const part of parts) {
      if (part.type === 'reasoning') {
        const thinking = partText(part)
        if (thinking) content.push({ type: 'thinking', thinking })
      } else if (part.type === 'text') {
        const text = partText(part)
        if (text) content.push({ type: 'text', text })
      } else if (part.type === 'tool') {
        content.push({ type: 'toolCall', id: toolCallId(part), name: toolName(part), arguments: toolInput(part) })
      }
    }
    const usage = message.usage ?? {}
    const assistant = {
      role: 'assistant',
      content,
      api: 'openai-completions',
      provider: String(message.provider?.providerId ?? 'provider'),
      model: String(message.provider?.modelId ?? 'model'),
      usage: {
        ...emptyUsage(),
        input: Number(usage.inputTokens ?? 0),
        output: Number(usage.outputTokens ?? 0),
        cacheRead: Number(usage.cacheReadTokens ?? 0),
        cacheWrite: Number(usage.cacheWriteTokens ?? 0),
        totalTokens: Number(usage.totalTokens ?? 0)
      },
      stopReason: message.status === 'failed' || message.status === 'interrupted' ? 'error' : 'stop',
      errorMessage: message.error?.message,
      timestamp
    } as PiAgentMessage
    const results = parts
      .filter((part) => part.type === 'tool' && hasToolResult(part))
      .map((part) => ({
        role: 'toolResult',
        toolCallId: toolCallId(part),
        toolName: toolName(part),
        content: toolResultContent(part),
        details: part.data,
        isError: isToolError(part),
        timestamp: Date.parse(part.updatedAt) || timestamp
      }) as PiAgentMessage)
    return [assistant, ...results]
  }
  if (message.role === 'tool') {
    return parts.filter((part) => part.type === 'tool' && hasToolResult(part)).map((part) => ({
      role: 'toolResult',
      toolCallId: toolCallId(part),
      toolName: toolName(part),
      content: toolResultContent(part),
      details: part.data,
      isError: isToolError(part),
      timestamp
    }) as PiAgentMessage)
  }
  return []
}

function leafAfterEntry(entry: SessionTreeEntry): string | null {
  return entry.type === 'leaf' ? entry.targetId : entry.id
}

function usageForEntry(entry: SessionTreeEntry) {
  if (entry.type === 'message' && entry.message.role === 'assistant') return entry.message.usage
  if (entry.type === 'compaction' || entry.type === 'branch_summary') return entry.usage
  return undefined
}

export class SqlitePiSessionStorage implements SessionStorage<DurablePiSessionMetadata> {
  private invocationId?: string

  private constructor(
    private readonly topicId: string,
    private readonly injectedDatabase?: AgentDatabase
  ) {}

  static async openOrCreate(input: {
    topicId: string
    requestedSessionId?: string
    invocationId?: string
    metadata?: Record<string, unknown>
    database?: AgentDatabase
  }): Promise<SqlitePiSessionStorage> {
    const storage = new SqlitePiSessionStorage(input.topicId, input.database)
    storage.setInvocationId(input.invocationId)
    await storage.ensureSession(input.requestedSessionId ?? input.topicId, input.metadata)
    await storage.hydrateFromCanonicalTranscript(input.invocationId)
    await storage.closeInterruptedToolCalls()
    return storage
  }

  static async hasDurableConversation(input: {
    topicId: string
    excludeMessageIds?: string[]
    database?: AgentDatabase
  }): Promise<boolean> {
    const storage = new SqlitePiSessionStorage(input.topicId, input.database)
    const db = await storage.database()
    const [entry] = await db
      .select({ id: piSessionEntriesTable.entry_id })
      .from(piSessionEntriesTable)
      .where(and(eq(piSessionEntriesTable.topic_id, input.topicId), eq(piSessionEntriesTable.entry_type, 'message')))
      .limit(1)
    if (entry) return true
    const excluded = new Set(input.excludeMessageIds ?? [])
    const transcript = await new AgentTranscriptRepository(db).listMessages(input.topicId)
    return transcript.some((message) => !excluded.has(message.id))
  }

  setInvocationId(invocationId: string | undefined): void {
    this.invocationId = invocationId?.trim() || undefined
  }

  private async database(): Promise<AgentDatabase> {
    if (this.injectedDatabase) return this.injectedDatabase
    const { DatabaseManager } = await import('../DatabaseManager')
    return (await DatabaseManager.getInstance()).getDatabase()
  }

  private async ensureSession(requestedSessionId: string, metadata?: Record<string, unknown>): Promise<void> {
    await serializeForTopic(this.topicId, async () => {
      const db = await this.database()
      const now = new Date().toISOString()
      const [collision] = await db
        .select({ topicId: piSessionsTable.topic_id })
        .from(piSessionsTable)
        .where(eq(piSessionsTable.pi_session_id, requestedSessionId))
        .limit(1)
      if (collision && collision.topicId !== this.topicId) {
        throw await sessionError(
          'invalid_session',
          `PI session id ${requestedSessionId} already belongs to topic ${collision.topicId}`
        )
      }
      try {
        await db
          .insert(piSessionsTable)
          .values({
            topic_id: this.topicId,
            pi_session_id: requestedSessionId,
            created_at: now,
            active_leaf_id: null,
            metadata_json: metadata,
            updated_at: now
          })
          .onConflictDoNothing({ target: piSessionsTable.topic_id })
      } catch (error) {
        const [owner] = await db
          .select({ topicId: piSessionsTable.topic_id })
          .from(piSessionsTable)
          .where(eq(piSessionsTable.pi_session_id, requestedSessionId))
          .limit(1)
        if (owner && owner.topicId !== this.topicId) {
          throw await sessionError(
            'invalid_session',
            `PI session id ${requestedSessionId} already belongs to topic ${owner.topicId}`,
            error as Error
          )
        }
        throw error
      }
      const [session] = await db
        .select({ topicId: piSessionsTable.topic_id, piSessionId: piSessionsTable.pi_session_id })
        .from(piSessionsTable)
        .where(eq(piSessionsTable.topic_id, this.topicId))
        .limit(1)
      if (!session) {
        const [collision] = await db
          .select({ topicId: piSessionsTable.topic_id })
          .from(piSessionsTable)
          .where(eq(piSessionsTable.pi_session_id, requestedSessionId))
          .limit(1)
        throw await sessionError(
          'invalid_session',
          collision
            ? `PI session id ${requestedSessionId} already belongs to topic ${collision.topicId}`
            : `Failed to create PI session for topic ${this.topicId}`
        )
      }
    })
  }

  private async hydrateFromCanonicalTranscript(excludeMessageId?: string): Promise<void> {
    await serializeForTopic(this.topicId, async () => {
      const db = await this.database()
      const [countRow] = await db
        .select({ count: sql<number>`count(*)` })
        .from(piSessionEntriesTable)
        .where(eq(piSessionEntriesTable.topic_id, this.topicId))
      if (Number(countRow?.count ?? 0) > 0) return

      const transcript = (await new AgentTranscriptRepository(db).listTranscript(this.topicId)).filter(
        (item) => !excludeMessageId ||
          (item.message.id !== excludeMessageId && item.message.parentMessageId !== excludeMessageId)
      )
      if (transcript.length === 0) return

      await db.transaction(async (tx) => {
        let leafId: string | null = null
        for (const item of transcript) {
          const projected = canonicalMessageToPi(item)
          for (let index = 0; index < projected.length; index += 1) {
            const entry: SessionTreeEntry = {
              type: 'message',
              id: stableEntryId('canonical', this.topicId, item.message.id, index),
              parentId: leafId,
              timestamp: item.message.createdAt,
              message: projected[index]
            }
            await this.insertEntry(tx, entry, entry.id)
            leafId = entry.id
          }
        }
      })
    })
  }

  private async closeInterruptedToolCalls(): Promise<void> {
    await serializeForTopic(this.topicId, async () => {
      const db = await this.database()
      await db.transaction(async (tx) => {
        const leafId = await this.getLeafIdWith(tx)
        if (!leafId) return
        const path = await this.getPathToRootOrCompactionWith(tx, leafId)
        const resolved = new Set<string>()
        const pending: Array<{ id: string; name: string }> = []
        for (const entry of path) {
          if (entry.type !== 'message') continue
          const message: any = entry.message
          if (message.role === 'toolResult') resolved.add(String(message.toolCallId))
          // PI drops failed/aborted assistants during provider transformation.
          // Closing their partial calls would create standalone tool results.
          if (message.role === 'assistant' && message.stopReason !== 'aborted' && message.stopReason !== 'error') {
            for (const content of Array.isArray(message.content) ? message.content : []) {
              if (content?.type === 'toolCall') pending.push({ id: String(content.id), name: String(content.name || 'tool') })
            }
          }
        }
        let currentLeaf = leafId
        for (const call of pending) {
          if (resolved.has(call.id)) continue
          const entry: SessionTreeEntry = {
            type: 'message',
            id: stableEntryId('interrupted_tool', this.topicId, call.id),
            parentId: currentLeaf,
            timestamp: new Date().toISOString(),
            message: {
              role: 'toolResult',
              toolCallId: call.id,
              toolName: call.name,
              content: [{ type: 'text', text: 'Tool execution was interrupted before completion.' }],
              details: { code: 'interrupted', synthetic: true },
              isError: true,
              timestamp: Date.now()
            } as PiAgentMessage
          }
          if (await this.getEntryWith(tx, entry.id)) continue
          await this.insertEntry(tx, entry, entry.id)
          currentLeaf = entry.id
        }
      })
    })
  }

  private async getProviderHiddenCanonicalEntryIds(db: DatabaseExecutor): Promise<Set<string>> {
    const hidden = (await new AgentTranscriptRepository(db as AgentDatabase).listTranscript(this.topicId)).filter(
      ({ message }) => message.semantics?.providerVisibility === 'hidden'
    )
    const ids = new Set<string>()
    for (const item of hidden) {
      const projected = canonicalMessageToPi(item, true)
      for (let index = 0; index < projected.length; index += 1) {
        ids.add(stableEntryId('canonical', this.topicId, item.message.id, index))
      }
    }
    return ids
  }

  private async filterProviderHiddenCanonicalEntries(
    db: DatabaseExecutor,
    entries: SessionTreeEntry[]
  ): Promise<SessionTreeEntry[]> {
    const hiddenIds = await this.getProviderHiddenCanonicalEntryIds(db)
    const visibleEntries = hiddenIds.size === 0 ? entries : entries.filter((entry) => !hiddenIds.has(entry.id))
    // Older versions may already have persisted results for partial calls.
    // Preserve the durable records, but never replay results whose assistant
    // PI's provider transform will discard.
    const discardedCalls = new Set<string>()
    const replayableCalls = new Set<string>()
    for (const entry of visibleEntries) {
      if (entry.type !== 'message' || entry.message.role !== 'assistant') continue
      const message = entry.message
      const calls = message.stopReason === 'aborted' || message.stopReason === 'error' ? discardedCalls : replayableCalls
      for (const content of message.content) {
        if (content.type === 'toolCall') calls.add(content.id)
      }
    }
    return visibleEntries.filter((entry) => {
      if (entry.type !== 'message' || entry.message.role !== 'toolResult') return true
      const id = entry.message.toolCallId
      return !discardedCalls.has(id) || replayableCalls.has(id)
    })
  }

  async getMetadata(): Promise<DurablePiSessionMetadata> {
    const db = await this.database()
    const [row] = await db.select().from(piSessionsTable).where(eq(piSessionsTable.topic_id, this.topicId)).limit(1)
    if (!row) throw await sessionError('not_found', `PI session for topic ${this.topicId} was not found`)
    return {
      id: row.pi_session_id,
      createdAt: row.created_at,
      topicId: row.topic_id,
      metadata: row.metadata_json ?? undefined
    }
  }

  async getLeafId(): Promise<string | null> {
    const db = await this.database()
    const [row] = await db
      .select({ leafId: piSessionsTable.active_leaf_id })
      .from(piSessionsTable)
      .where(eq(piSessionsTable.topic_id, this.topicId))
      .limit(1)
    if (!row) throw await sessionError('not_found', `PI session for topic ${this.topicId} was not found`)
    if (row.leafId && !(await this.getEntry(row.leafId))) {
      throw await sessionError('invalid_session', `Entry ${row.leafId} not found`)
    }
    return row.leafId
  }

  async setLeafId(leafId: string | null): Promise<void> {
    await serializeForTopic(this.topicId, async () => {
      const db = await this.database()
      await db.transaction(async (tx) => {
        if (leafId !== null && !(await this.getEntryWith(tx, leafId))) {
          throw await sessionError('not_found', `Entry ${leafId} not found`)
        }
        const currentLeafId = await this.getLeafIdWith(tx)
        const entry: SessionTreeEntry = {
          type: 'leaf',
          id: await this.createEntryIdWith(tx),
          parentId: currentLeafId,
          timestamp: new Date().toISOString(),
          targetId: leafId
        }
        await this.insertEntry(tx, entry, leafId)
      })
    })
  }

  async createEntryId(): Promise<string> {
    const db = await this.database()
    return this.createEntryIdWith(db)
  }

  private async createEntryIdWith(db: DatabaseExecutor): Promise<string> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const id = nextEntryId()
      if (!(await this.getEntryWith(db, id))) return id
    }
    return randomUUID()
  }

  async appendEntry(entry: SessionTreeEntry): Promise<void> {
    await serializeForTopic(this.topicId, async () => {
      const db = await this.database()
      await db.transaction(async (tx) => {
        const currentLeafId = await this.getLeafIdWith(tx)
        if (entry.parentId !== null && !(await this.getEntryWith(tx, entry.parentId))) {
          throw await sessionError('invalid_entry', `Parent entry ${entry.parentId} not found`)
        }
        const orderedEntry = entry.parentId === currentLeafId ? entry : { ...entry, parentId: currentLeafId }

        if (orderedEntry.type === 'message' && orderedEntry.message.role === 'user' && this.invocationId) {
          const [claim] = await tx
            .select({ entryId: piInvocationEntriesTable.entry_id })
            .from(piInvocationEntriesTable)
            .where(
              and(
                eq(piInvocationEntriesTable.topic_id, this.topicId),
                eq(piInvocationEntriesTable.invocation_id, this.invocationId),
                eq(piInvocationEntriesTable.entry_kind, 'user_message')
              )
            )
            .limit(1)
          if (claim) return
          await this.insertEntry(tx, orderedEntry, leafAfterEntry(orderedEntry))
          await this.claimInvocationEntry(tx, this.invocationId, 'user_message', orderedEntry.id, orderedEntry.timestamp)
          return
        }

        await this.insertEntry(tx, orderedEntry, leafAfterEntry(orderedEntry))
      })
    })
  }

  private async claimInvocationEntry(
    tx: AgentTransaction,
    invocationId: string,
    kind: InvocationEntryKind,
    entryId: string,
    createdAt: string
  ): Promise<void> {
    await tx.insert(piInvocationEntriesTable).values({
      topic_id: this.topicId,
      invocation_id: invocationId,
      entry_kind: kind,
      entry_id: entryId,
      created_at: createdAt
    })
  }

  private async insertEntry(tx: AgentTransaction, entry: SessionTreeEntry, leafId: string | null): Promise<void> {
    let lastError: unknown
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const [sequenceRow] = await tx
        .select({ nextSequence: sql<number>`coalesce(max(${piSessionEntriesTable.sequence}), -1) + 1` })
        .from(piSessionEntriesTable)
        .where(eq(piSessionEntriesTable.topic_id, this.topicId))

      try {
        await tx.insert(piSessionEntriesTable).values({
          topic_id: this.topicId,
          sequence: Number(sequenceRow?.nextSequence ?? 0),
          entry_id: entry.id,
          parent_entry_id: entry.parentId,
          entry_type: entry.type,
          entry_json: entry as unknown as Record<string, unknown>,
          created_at: entry.timestamp
        })
        lastError = undefined
        break
      } catch (error) {
        lastError = error
        const message = error instanceof Error ? error.message : String(error)
        if (!/SQLITE_BUSY|database is locked|unique constraint failed: pi_session_entries\.topic_id, pi_session_entries\.sequence/i.test(message) || attempt === 4) {
          throw await sessionError('storage', `Failed to append PI session entry ${entry.id}`, error as Error)
        }
        await wait(5 * (attempt + 1))
      }
    }
    if (lastError) {
      throw await sessionError('storage', `Failed to append PI session entry ${entry.id}`, lastError as Error)
    }

    await tx
      .update(piSessionsTable)
      .set({ active_leaf_id: leafId, updated_at: new Date().toISOString() })
      .where(eq(piSessionsTable.topic_id, this.topicId))
  }

  async getEntry(id: string): Promise<SessionTreeEntry | undefined> {
    return this.getEntryWith(await this.database(), id)
  }

  private async getEntryWith(db: DatabaseExecutor, id: string): Promise<SessionTreeEntry | undefined> {
    const [row] = await db
      .select({ entry: piSessionEntriesTable.entry_json })
      .from(piSessionEntriesTable)
      .where(and(eq(piSessionEntriesTable.topic_id, this.topicId), eq(piSessionEntriesTable.entry_id, id)))
      .limit(1)
    return row?.entry as unknown as SessionTreeEntry | undefined
  }

  async findEntries<TType extends SessionTreeEntry['type']>(
    type: TType
  ): Promise<Array<Extract<SessionTreeEntry, { type: TType }>>> {
    const db = await this.database()
    const rows = await db
      .select({ entry: piSessionEntriesTable.entry_json })
      .from(piSessionEntriesTable)
      .where(and(eq(piSessionEntriesTable.topic_id, this.topicId), eq(piSessionEntriesTable.entry_type, type)))
      .orderBy(asc(piSessionEntriesTable.sequence))
    return rows.map((row) => row.entry as unknown as Extract<SessionTreeEntry, { type: TType }>)
  }

  async getLabel(id: string): Promise<string | undefined> {
    const labels = await this.findEntries('label')
    let label: string | undefined
    for (const entry of labels) {
      if (entry.targetId !== id) continue
      label = entry.label?.trim() || undefined
    }
    return label
  }

  async getSessionName(): Promise<string | undefined> {
    const entries = await this.findEntries('session_info')
    const last = entries[entries.length - 1]
    return last?.name?.trim() || undefined
  }

  async getSessionStats(): Promise<SessionStats> {
    const entries = await this.getEntries()
    let messageCount = 0
    let cachedTokens = 0
    let uncachedTokens = 0
    let totalTokens = 0
    let costTotal = 0
    for (const entry of entries) {
      if (entry.type === 'message') messageCount += 1
      const usage = usageForEntry(entry)
      if (!usage) continue
      cachedTokens += Number(usage.cacheRead ?? 0)
      uncachedTokens += Number(usage.input ?? 0) + Number(usage.cacheWrite ?? 0)
      totalTokens +=
        Number(usage.input ?? 0) +
        Number(usage.output ?? 0) +
        Number(usage.cacheRead ?? 0) +
        Number(usage.cacheWrite ?? 0)
      costTotal += Number(usage.cost?.total ?? 0)
    }
    return { messageCount, cachedTokens, uncachedTokens, totalTokens, costTotal }
  }

  async getPathToRootOrCompaction(leafId: string | null): Promise<SessionTreeEntry[]> {
    return this.getPathToRootOrCompactionWith(await this.database(), leafId)
  }

  private async getPathToRootOrCompactionWith(
    db: DatabaseExecutor,
    leafId: string | null
  ): Promise<SessionTreeEntry[]> {
    if (leafId === null) return []
    const path: SessionTreeEntry[] = []
    let stopAtEntryId: string | null = null
    let current = await this.getEntryWith(db, leafId)
    if (!current) throw await sessionError('not_found', `Entry ${leafId} not found`)
    while (current) {
      path.unshift(current)
      if (stopAtEntryId !== null && current.id === stopAtEntryId) break
      if (current.type === 'compaction') {
        if (current.retainedTail) break
        stopAtEntryId = current.firstKeptEntryId ?? null
      }
      if (!current.parentId) break
      const parent = await this.getEntryWith(db, current.parentId)
      if (!parent) throw await sessionError('invalid_session', `Entry ${current.parentId} not found`)
      current = parent
    }
    return this.filterProviderHiddenCanonicalEntries(db, path)
  }

  async getEntries(options?: SessionEntryCursorOptions): Promise<SessionTreeEntry[]> {
    const db = await this.database()
    const afterSequence = options?.afterEntrySeq ?? 0
    let query = db
      .select({ entry: piSessionEntriesTable.entry_json })
      .from(piSessionEntriesTable)
      .where(
        and(
          eq(piSessionEntriesTable.topic_id, this.topicId),
          gt(piSessionEntriesTable.sequence, afterSequence - 1)
        )
      )
      .orderBy(asc(piSessionEntriesTable.sequence))
      .$dynamic()
    if (options?.limit !== undefined) query = query.limit(options.limit)
    const rows = await query
    return this.filterProviderHiddenCanonicalEntries(
      db,
      rows.map((row) => row.entry as unknown as SessionTreeEntry)
    )
  }

  private async getLeafIdWith(db: DatabaseExecutor): Promise<string | null> {
    const [row] = await db
      .select({ leafId: piSessionsTable.active_leaf_id })
      .from(piSessionsTable)
      .where(eq(piSessionsTable.topic_id, this.topicId))
      .limit(1)
    if (!row) throw await sessionError('not_found', `PI session for topic ${this.topicId} was not found`)
    return row.leafId
  }
}
