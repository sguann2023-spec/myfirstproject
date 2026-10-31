import { createHash, randomUUID } from 'node:crypto'

import type {
  SessionEntryCursorOptions,
  SessionErrorCode,
  SessionMetadata,
  SessionStats,
  SessionStorage,
  SessionTreeEntry
} from '@earendil-works/pi-agent-core'
import { and, eq, sql } from 'drizzle-orm'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'

import { piInvocationEntriesTable, piSessionEntriesTable, piSessionsTable } from '../schema'
import type * as schema from '../schema'
import { OrderedTaskQueue } from '../orderedTaskQueue'
import { resolveMessageProjectionTables } from '../messageEventStore'
import { AgentTranscriptRepository } from './agentTranscriptRepository'
import type { AgentMessagePart, AgentMessageWithParts } from './agentTranscript.types'
import { captureOverlayBoundary, isPiOverlay, readOverlayPrefix, type OverlayContextBoundary } from './piOverlayContext'

export interface DurablePiSessionMetadata extends SessionMetadata {
  topicId: string
  metadata?: Record<string, unknown>
}

type AgentDatabase = LibSQLDatabase<typeof schema>
type DatabaseExecutor = AgentDatabase

export const PI_HISTORY_LIMITS = {
  entryBytes: 4 * 1024 * 1024,
  batchBytes: 4 * 1024 * 1024,
  totalBytes: 16 * 1024 * 1024,
  entries: 100000,
  metadataBatch: 512
} as const
// Per-topic admitted tasks (including in-flight/recovery) and UTF-8 payload
// bytes. This bounds recording backlog, not the live PI tree or JS heap.
export const PI_PERSISTENCE_LIMITS = {
  tasks: 1024,
  bytes: 8 * 1024 * 1024
} as const
interface EntryMetadata { id: string; bytes: number }

function historyLimitError(): Error {
  const error = new Error('PI history exceeds safe reading limits; compact the conversation or start a new session.')
  error.name = 'PiHistoryLimitError'
  return error
}

type PiAgentMessage = Extract<SessionTreeEntry, { type: 'message' }>['message']


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

function overlayInterruptedResult(entry: SessionTreeEntry, contentIndex: number): SessionTreeEntry | undefined {
  if (entry.type !== 'message' || entry.message.role !== 'assistant' || ['aborted', 'error'].includes(entry.message.stopReason)) return undefined
  const content = entry.message.content[contentIndex]
  if (content?.type !== 'toolCall') return undefined
  return {
    type: 'message', id: `overlay_interrupted:${entry.id}:${contentIndex}`, parentId: entry.id, timestamp: entry.timestamp,
    message: { role: 'toolResult', toolCallId: content.id, toolName: content.name,
      content: [{ type: 'text', text: 'Tool execution was interrupted before completion.' }],
      isError: true, timestamp: entry.message.timestamp, details: { code: 'interrupted', synthetic: true } }
  }
}

interface PiMemoryState {
  metadata: DurablePiSessionMetadata
  entries: SessionTreeEntry[]
  byId: Map<string, SessionTreeEntry>
  leafId: string | null
  claims: Map<string, string>
  hiddenIds: Set<string>
  overlay: boolean
  nextSequence: number
  writes: OrderedTaskQueue
  persistenceFailed: boolean
  pendingWrites: number
  pendingWriteBytes: number
}

interface DatabaseSessions {
  topics: Map<string, Promise<PiMemoryState>>
  owners: Map<string, string>
  initialization: OrderedTaskQueue
}

const databaseSessions = new WeakMap<AgentDatabase, DatabaseSessions>()

function sessionsFor(db: AgentDatabase): DatabaseSessions {
  let sessions = databaseSessions.get(db)
  if (!sessions) {
    sessions = { topics: new Map(), owners: new Map(), initialization: new OrderedTaskQueue() }
    databaseSessions.set(db, sessions)
  }
  return sessions
}

/** Database recovery happens once per database/topic. PI only sees memory thereafter. */
export class SqlitePiSessionStorage implements SessionStorage<DurablePiSessionMetadata> {
  private invocationId?: string
  private state!: PiMemoryState
  private recoveryWrites: Array<{ operation: () => Promise<void>; bytes: number }> | undefined = []

  private constructor(private readonly topicId: string, private readonly db: AgentDatabase) {}

  private static async database(injected?: AgentDatabase): Promise<AgentDatabase> {
    if (injected) return injected
    const { DatabaseManager } = await import('../DatabaseManager')
    return (await DatabaseManager.getInstance()).getDatabase()
  }

  static async openOrCreate(input: {
    topicId: string
    requestedSessionId?: string
    invocationId?: string
    metadata?: Record<string, unknown>
    database?: AgentDatabase
  }): Promise<SqlitePiSessionStorage> {
    const db = await this.database(input.database)
    const sessions = sessionsFor(db)
    const storage = new SqlitePiSessionStorage(input.topicId, db)
    storage.setInvocationId(input.invocationId)
    let opening = sessions.topics.get(input.topicId)
    if (!opening) {
      opening = sessions.initialization.run(async () => {
        await storage.restore(input.requestedSessionId ?? input.topicId, input.metadata)
        sessions.owners.set(storage.state.metadata.id, input.topicId)
        const writes = storage.recoveryWrites!
        storage.recoveryWrites = undefined
        for (const write of writes) storage.scheduleWrite(write.operation, write.bytes)
        return storage.state
      })
      sessions.topics.set(input.topicId, opening)
      void opening.catch(() => {
        if (sessions.topics.get(input.topicId) === opening) sessions.topics.delete(input.topicId)
      })
    }
    storage.state = await opening
    storage.recoveryWrites = undefined
    // Once a topic exists, its identity wins over any requested replacement ID.
    return storage
  }

  static async hasDurableConversation(input: {
    topicId: string
    excludeMessageIds?: string[]
    database?: AgentDatabase
  }): Promise<boolean> {
    const db = await this.database(input.database)
    const opening = sessionsFor(db).topics.get(input.topicId)
    if (opening) {
      const state = await opening
      const excluded = new Set(input.excludeMessageIds ?? [])
      const excludedEntries = new Set([...state.claims].filter(([id]) => excluded.has(id)).map(([, id]) => id))
      for (const id of excluded) excludedEntries.add(stableEntryId('canonical', input.topicId, id, 0))
      return state.entries.some(entry => entry.type === 'message' && !state.hiddenIds.has(entry.id) &&
        !(entry as any).__providerHidden && !excludedEntries.has(entry.id))
    }
    const [entry] = await db.select({ id: piSessionEntriesTable.entry_id }).from(piSessionEntriesTable)
      .where(and(eq(piSessionEntriesTable.topic_id, input.topicId), eq(piSessionEntriesTable.entry_type, 'message'))).limit(1)
    if (entry) return true
    const excluded = new Set(input.excludeMessageIds ?? [])
    if (await isPiOverlay(db)) {
      const boundary = await captureOverlayBoundary(db, input.topicId)
      const prefix = await readOverlayPrefix(db, input.topicId, boundary, messageId => messageId)
      return prefix.some(item => !excluded.has(item.id) && !(item as any).__providerHidden)
    }
    return (await new AgentTranscriptRepository(db).listMessages(input.topicId)).some(message => !excluded.has(message.id))
  }

  setInvocationId(invocationId: string | undefined): void {
    this.invocationId = invocationId?.trim() || undefined
  }

  private stopPersistence(reason: unknown): void {
    const state = this.state
    if (state.persistenceFailed) return
    state.persistenceFailed = true
    if (this.recoveryWrites) {
      this.recoveryWrites.length = 0
      state.pendingWrites = 0
      state.pendingWriteBytes = 0
    }
    console.error('[PiSessionStorage] background persistence stopped', { topicId: this.topicId, error: reason })
  }

  private enqueue(payload: unknown, operation: () => Promise<void>): void {
    const state = this.state
    // Admission happens before extending the Promise chain, including recovery.
    if (state.persistenceFailed) return
    let bytes: number
    try {
      bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8')
    } catch (error) {
      this.stopPersistence(error)
      return
    }
    if (state.pendingWrites >= PI_PERSISTENCE_LIMITS.tasks ||
      bytes > PI_PERSISTENCE_LIMITS.bytes - state.pendingWriteBytes) {
      this.stopPersistence(new Error('PI background persistence queue limit exceeded'))
      return
    }
    state.pendingWrites++
    state.pendingWriteBytes += bytes
    if (this.recoveryWrites) {
      this.recoveryWrites.push({ operation, bytes })
      return
    }
    this.scheduleWrite(operation, bytes)
  }

  private scheduleWrite(operation: () => Promise<void>, bytes: number): void {
    const state = this.state
    void state.writes.run(async () => {
      try {
        if (state.persistenceFailed) return
        await operation()
      } catch (error) {
        // Never retry a partially persisted tree or let SQL failure affect PI.
        this.stopPersistence(error)
      } finally {
        state.pendingWrites--
        state.pendingWriteBytes -= bytes
      }
    })
  }

  private async restore(requestedSessionId: string, metadata?: Record<string, unknown>): Promise<void> {
    const db = this.db
    const [row] = await db.select().from(piSessionsTable).where(eq(piSessionsTable.topic_id, this.topicId)).limit(1)
    const sessionId = row?.pi_session_id ?? requestedSessionId
    if (!row) {
      const owner = sessionsFor(db).owners.get(sessionId)
      const [collision] = await db.select({ topicId: piSessionsTable.topic_id }).from(piSessionsTable)
        .where(eq(piSessionsTable.pi_session_id, sessionId)).limit(1)
      if ((owner && owner !== this.topicId) || (collision && collision.topicId !== this.topicId)) {
        throw await sessionError('invalid_session', `PI session id ${sessionId} already belongs to topic ${owner ?? collision!.topicId}`)
      }
    }
    const stored = await this.getStoredEntries()
    const claims = await db.select().from(piInvocationEntriesTable).where(eq(piInvocationEntriesTable.topic_id, this.topicId))
    const overlay = await isPiOverlay(db)
    const persistedMetadata = structuredClone(row?.metadata_json ?? metadata ?? {})
    this.state = {
      metadata: { id: sessionId, topicId: this.topicId, createdAt: row?.created_at ?? new Date().toISOString(),
        metadata: Object.fromEntries(Object.entries(persistedMetadata).filter(([key]) => !['__canonicalHydration', '__overlayContext'].includes(key))) },
      entries: [], byId: new Map(), leafId: row?.active_leaf_id ?? null,
      claims: new Map(claims.filter(claim => claim.entry_kind === 'user_message').map(claim => [claim.invocation_id, claim.entry_id])),
      hiddenIds: await this.getProviderHiddenCanonicalEntryIds(db), overlay,
      nextSequence: 0, writes: new OrderedTaskQueue(), persistenceFailed: false,
      pendingWrites: 0, pendingWriteBytes: 0
    }
    if (!row) {
      const values = { topic_id: this.topicId, pi_session_id: sessionId, created_at: this.state.metadata.createdAt,
        active_leaf_id: null, metadata_json: structuredClone(persistedMetadata), updated_at: this.state.metadata.createdAt }
      this.enqueue(values, async () => { await db.insert(piSessionsTable).values(values) })
    }
    if (overlay) {
      let boundary = persistedMetadata.__overlayContext as OverlayContextBoundary | undefined
      if (boundary || !stored.length) {
        boundary ??= await captureOverlayBoundary(db, this.topicId, this.invocationId)
        const prefix = await readOverlayPrefix(db, this.topicId, boundary,
          (messageId, index) => stableEntryId('canonical', this.topicId, messageId, index))
        const treeDigest = createHash('sha256').update(JSON.stringify(prefix.map(entry => [entry.id, entry.parentId]))).digest('hex')
        if (boundary.treeDigest && boundary.treeDigest !== treeDigest) {
          throw await sessionError('invalid_session', 'PI overlay source context changed or is unavailable; cannot restore its parent tree without migration')
        }
        for (const entry of prefix) this.restoreEntry(entry)
        if (!persistedMetadata.__overlayContext) {
          persistedMetadata.__overlayContext = { ...boundary, treeDigest }
          this.state.leafId = prefix[prefix.length - 1]?.id ?? null
          this.saveRecoveryMetadata(persistedMetadata)
        }
      }
    }
    for (const entry of stored) this.restoreEntry(entry)
    for (const [invocationId, entryId] of this.state.claims) {
      if (!this.state.byId.has(entryId)) this.state.claims.delete(invocationId)
    }
    const [sequence] = await db.select({ next: sql<number>`coalesce(max(${piSessionEntriesTable.sequence}), -1) + 1` })
      .from(piSessionEntriesTable).where(eq(piSessionEntriesTable.topic_id, this.topicId))
    this.state.nextSequence = Number(sequence?.next ?? 0)
    if (!overlay) {
      const marker = persistedMetadata.__canonicalHydration as { complete?: boolean; excludeMessageId?: string } | undefined
      if (!marker?.complete && (!stored.length || marker)) {
        const excluded = marker ? marker.excludeMessageId : this.invocationId
        const transcript = (await new AgentTranscriptRepository(db).listTranscript(this.topicId)).filter(item =>
          !excluded || (item.message.id !== excluded && item.message.parentMessageId !== excluded))
        if (transcript.length) {
          persistedMetadata.__canonicalHydration = { complete: false, excludeMessageId: excluded }
          this.saveRecoveryMetadata(persistedMetadata)
          let parentId: string | null = null
          const messageLeaves = new Map<string, string | null>()
          for (const item of transcript) {
            if (item.message.parentMessageId) {
              if (!messageLeaves.has(item.message.parentMessageId)) {
                throw await sessionError('invalid_session', `Canonical parent ${item.message.parentMessageId} is unavailable`)
              }
              parentId = messageLeaves.get(item.message.parentMessageId) ?? null
            }
            const messages = canonicalMessageToPi(item)
            for (const [index, message] of messages.entries()) {
              const entry: SessionTreeEntry = { type: 'message', id: stableEntryId('canonical', this.topicId, item.message.id, index),
                parentId, timestamp: item.message.createdAt, message }
              if (!this.state.byId.has(entry.id)) this.commitEntry(entry)
              parentId = entry.id
            }
            messageLeaves.set(item.message.id, parentId)
          }
          this.state.leafId = parentId
          persistedMetadata.__canonicalHydration = { complete: true, excludeMessageId: excluded }
          this.saveRecoveryMetadata(persistedMetadata)
        }
      }
    }
    const sizes: EntryMetadata[] = []
    let bytes = 0
    for (const entry of this.state.entries) {
      const size = { id: entry.id, bytes: Buffer.byteLength(JSON.stringify(entry)) }
      bytes = this.checkHistoryMetadata(sizes, size, bytes)
      sizes.push(size)
    }
    // Validate the active tree during recovery, not on every database read.
    if (this.state.leafId !== null) await this.getPathToRootOrCompaction(this.state.leafId)
    if (!overlay) await this.closeInterruptedToolCalls()
  }

  private saveRecoveryMetadata(metadata: Record<string, unknown>): void {
    const snapshot = structuredClone(metadata)
    const leafId = this.state.leafId
    this.enqueue({ topicId: this.topicId, metadata: snapshot, leafId }, async () => {
      await this.db.update(piSessionsTable).set({ metadata_json: snapshot, active_leaf_id: leafId })
        .where(eq(piSessionsTable.topic_id, this.topicId))
    })
  }

  private restoreEntry(entry: SessionTreeEntry): void {
    const invocationId = (entry as SessionTreeEntry & { __piInvocationId?: string }).__piInvocationId
    if (invocationId && entry.type === 'message' && entry.message.role === 'user') {
      this.state.claims.set(invocationId, entry.id)
      delete (entry as SessionTreeEntry & { __piInvocationId?: string }).__piInvocationId
    }
    if (this.state.byId.has(entry.id)) return
    this.state.entries.push(entry)
    this.state.byId.set(entry.id, entry)
  }

  private commitEntry(entry: SessionTreeEntry, invocationId?: string): void {
    const state = this.state
    this.restoreEntry(entry)
    state.leafId = leafAfterEntry(entry)
    if (invocationId) state.claims.set(invocationId, entry.id)
    const sequence = state.nextSequence++
    const leafId = state.leafId
    this.enqueue({ topicId: this.topicId, entry, invocationId, sequence, leafId }, async () => {
      await this.db.insert(piSessionEntriesTable).values({ topic_id: this.topicId, sequence,
        entry_id: entry.id, parent_entry_id: entry.parentId, entry_type: entry.type,
        entry_json: { ...entry, ...(invocationId ? { __piInvocationId: invocationId } : {}) }, created_at: entry.timestamp })
      await this.db.update(piSessionsTable).set({ active_leaf_id: leafId, updated_at: new Date().toISOString() })
        .where(eq(piSessionsTable.topic_id, this.topicId))
      if (invocationId) await this.db.insert(piInvocationEntriesTable).values({ topic_id: this.topicId,
        invocation_id: invocationId, entry_kind: 'user_message', entry_id: entry.id, created_at: entry.timestamp })
    })
  }

  private async closeInterruptedToolCalls(): Promise<void> {
    const path = await this.getPathToRootOrCompaction(this.state.leafId)
    const resolved = new Set(path.flatMap(entry => entry.type === 'message' && entry.message.role === 'toolResult' ? [entry.message.toolCallId] : []))
    for (const entry of path) {
      if (entry.type !== 'message' || entry.message.role !== 'assistant' || ['aborted', 'error'].includes(entry.message.stopReason)) continue
      for (const [index, content] of entry.message.content.entries()) {
        if (content.type !== 'toolCall' || resolved.has(content.id)) continue
        resolved.add(content.id)
        const result = overlayInterruptedResult(entry, index)!
        const id = stableEntryId('interrupted_tool', this.topicId, entry.id, index, this.state.leafId)
        if (this.state.byId.has(id)) await this.setLeafId(id)
        else this.commitEntry({ ...result, id, parentId: this.state.leafId })
      }
    }
  }

  async getMetadata(): Promise<DurablePiSessionMetadata> {
    return structuredClone(this.state.metadata)
  }

  async getLeafId(): Promise<string | null> {
    return this.state.leafId
  }

  async setLeafId(leafId: string | null): Promise<void> {
    if (leafId !== null && !this.lookupEntry(leafId)) throw await sessionError('not_found', `Entry ${leafId} not found`)
    // Allocate synchronously so a concurrent move cannot capture a stale leaf.
    this.commitEntry({ type: 'leaf', id: this.allocateEntryId(), parentId: this.state.leafId,
      timestamp: new Date().toISOString(), targetId: leafId })
  }

  private allocateEntryId(): string {
    for (let attempt = 0; attempt < 100; attempt++) {
      const id = nextEntryId()
      if (!this.lookupEntry(id)) return id
    }
    return randomUUID()
  }

  async createEntryId(): Promise<string> {
    return this.allocateEntryId()
  }

  async appendEntry(entry: SessionTreeEntry): Promise<void> {
    const snapshot = structuredClone(entry)
    if (this.state.byId.has(snapshot.id)) {
      if (JSON.stringify(this.state.byId.get(snapshot.id)) !== JSON.stringify(snapshot)) {
        throw await sessionError('invalid_entry', `Entry ${snapshot.id} already exists with different content`)
      }
      return
    }
    const invocationId = snapshot.type === 'message' && snapshot.message.role === 'user' ? this.invocationId : undefined
    if (invocationId && this.state.claims.has(invocationId)) return
    if (snapshot.parentId !== null && !this.lookupEntry(snapshot.parentId)) {
      throw await sessionError('invalid_entry', `Parent entry ${snapshot.parentId} not found`)
    }
    if (snapshot.type === 'leaf' && snapshot.targetId !== null && !this.lookupEntry(snapshot.targetId)) {
      throw await sessionError('invalid_entry', `Entry ${snapshot.targetId} not found`)
    }
    if (snapshot.id === snapshot.parentId) throw await sessionError('invalid_entry', `Cycle at entry ${snapshot.id}`)
    // Explicit parents are intentional branches; never rewrite them to the active leaf.
    this.commitEntry(snapshot, invocationId)
  }

  private lookupEntry(id: string): SessionTreeEntry | undefined {
    if (Buffer.byteLength(id) > 1024) throw historyLimitError()
    const entry = this.state.byId.get(id)
    if (entry) return entry
    const closure = this.state.overlay && /^overlay_interrupted:(.+):(\d+)$/.exec(id)
    if (!closure) return undefined
    const assistant = this.state.byId.get(closure[1])
    return assistant ? overlayInterruptedResult(assistant, Number(closure[2])) : undefined
  }

  async getEntry(id: string): Promise<SessionTreeEntry | undefined> {
    const entry = this.lookupEntry(id)
    return entry ? structuredClone(entry) : undefined
  }

  private visible(entries: SessionTreeEntry[], closeInterrupted = false): SessionTreeEntry[] {
    const visible = entries.filter(entry => !this.state.hiddenIds.has(entry.id) && !(entry as any).__providerHidden)
    const discarded = new Set<string>()
    const replayable = new Set<string>()
    for (const entry of visible) {
      if (entry.type !== 'message' || entry.message.role !== 'assistant') continue
      const calls = ['aborted', 'error'].includes(entry.message.stopReason) ? discarded : replayable
      for (const content of entry.message.content) if (content.type === 'toolCall') calls.add(content.id)
    }
    const filtered = visible.filter(entry => entry.type !== 'message' || entry.message.role !== 'toolResult' ||
      !discarded.has(entry.message.toolCallId) || replayable.has(entry.message.toolCallId))
    if (!this.state.overlay || !closeInterrupted) return filtered
    const resolved = new Set(filtered.flatMap(entry => entry.type === 'message' && entry.message.role === 'toolResult' ? [entry.message.toolCallId] : []))
    const result: SessionTreeEntry[] = []
    for (const entry of filtered) {
      result.push(entry)
      if (entry.type !== 'message' || entry.message.role !== 'assistant' || ['aborted', 'error'].includes(entry.message.stopReason)) continue
      for (const [index, content] of entry.message.content.entries()) {
        if (content.type !== 'toolCall' || resolved.has(content.id)) continue
        resolved.add(content.id)
        result.push(overlayInterruptedResult(entry, index)!)
      }
    }
    return result
  }

  async findEntries<TType extends SessionTreeEntry['type']>(type: TType): Promise<Array<Extract<SessionTreeEntry, { type: TType }>>> {
    return (await this.getEntries()).filter(entry => entry.type === type) as Array<Extract<SessionTreeEntry, { type: TType }>>
  }

  async getLabel(id: string): Promise<string | undefined> {
    const labels = this.state.entries.filter(entry => entry.type === 'label' && entry.targetId === id)
    const last = labels[labels.length - 1] as Extract<SessionTreeEntry, { type: 'label' }> | undefined
    return last?.label?.trim() || undefined
  }

  async getSessionName(): Promise<string | undefined> {
    const entries = await this.findEntries('session_info')
    return entries[entries.length - 1]?.name?.trim() || undefined
  }

  async getSessionStats(): Promise<SessionStats> {
    const stats = { messageCount: 0, cachedTokens: 0, uncachedTokens: 0, totalTokens: 0, costTotal: 0 }
    for (const entry of await this.getEntries()) {
      if (entry.type === 'message') stats.messageCount++
      const usage = usageForEntry(entry)
      if (!usage) continue
      stats.cachedTokens += Number(usage.cacheRead ?? 0)
      stats.uncachedTokens += Number(usage.input ?? 0) + Number(usage.cacheWrite ?? 0)
      stats.totalTokens += Number(usage.input ?? 0) + Number(usage.output ?? 0) + Number(usage.cacheRead ?? 0) + Number(usage.cacheWrite ?? 0)
      stats.costTotal += Number(usage.cost?.total ?? 0)
    }
    return stats
  }

  async getPathToRootOrCompaction(leafId: string | null): Promise<SessionTreeEntry[]> {
    const path: SessionTreeEntry[] = []
    const metadata: EntryMetadata[] = []
    const visited = new Set<string>()
    let next = leafId
    let stopAt: string | null = null
    let bytes = 0
    while (next !== null) {
      if (visited.has(next)) throw await sessionError('invalid_session', `Cycle at entry ${next}`)
      visited.add(next)
      const entry = this.lookupEntry(next)
      if (!entry) throw await sessionError(path.length ? 'invalid_session' : 'not_found', `Entry ${next} not found`)
      const item = { id: entry.id, bytes: Buffer.byteLength(JSON.stringify(entry)) }
      bytes = this.checkHistoryMetadata(metadata, item, bytes)
      metadata.push(item)
      path.push(entry)
      if (entry.id === stopAt || (entry.type === 'compaction' && Array.isArray(entry.retainedTail))) break
      if (entry.type === 'compaction') stopAt = entry.firstKeptEntryId ?? null
      next = entry.parentId
    }
    return structuredClone(this.visible(path.reverse(), true))
  }

  async getEntries(options?: SessionEntryCursorOptions): Promise<SessionTreeEntry[]> {
    const after = options?.afterEntrySeq ?? 0
    const limit = options?.limit ?? this.state.entries.length
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 0) throw historyLimitError()
    return structuredClone(this.visible(this.state.entries.slice(after, after + limit)))
  }

  private async getProviderHiddenCanonicalEntryIds(db: DatabaseExecutor): Promise<Set<string>> {
    const tables = await resolveMessageProjectionTables(db, this.topicId)
    const hidden = await db.all<{ id: string; role: string; tools: number }>(sql`
      SELECT substr(m.id, 1, 1025) AS id, m.role, count(p.id) AS tools
      FROM ${sql.identifier(tables.agent_messages)} m LEFT JOIN ${sql.identifier(tables.agent_message_parts)} p
        ON p.session_id = m.session_id AND p.message_id = m.id AND p.type = 'tool'
      WHERE m.session_id = ${this.topicId}
        AND json_extract(m.semantics_json, '$.providerVisibility') = 'hidden'
      GROUP BY m.id, m.role LIMIT ${PI_HISTORY_LIMITS.entries + 1}
    `)
    if (hidden.length > PI_HISTORY_LIMITS.entries) throw historyLimitError()
    const ids = new Set<string>()
    for (const item of hidden) {
      if (Buffer.byteLength(item.id) > 1024) throw historyLimitError()
      // Tool parts give an upper bound on projected results. Extra IDs cannot
      // match another message, and this never loads hidden images/tool bodies.
      const count = item.role === 'user' ? 1 : item.role === 'assistant' ? 1 + Number(item.tools) : item.role === 'tool' ? Number(item.tools) : 0
      if (ids.size + count > PI_HISTORY_LIMITS.entries) throw historyLimitError()
      for (let index = 0; index < count; index += 1) {
        ids.add(stableEntryId('canonical', this.topicId, item.id, index))
      }
    }
    return ids
  }

  private checkHistoryMetadata(previous: EntryMetadata[], row: EntryMetadata, total: number): number {
    const bytes = Number(row.bytes)
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > PI_HISTORY_LIMITS.entryBytes ||
      previous.length >= PI_HISTORY_LIMITS.entries || total + bytes > PI_HISTORY_LIMITS.totalBytes) throw historyLimitError()
    return total + bytes
  }

  private async readBoundedEntries(db: DatabaseExecutor, metadata: EntryMetadata[]): Promise<SessionTreeEntry[]> {
    const entries: SessionTreeEntry[] = []
    let total = 0
    for (let offset = 0; offset < metadata.length;) {
      const batch: EntryMetadata[] = []
      let bytes = 0
      while (offset < metadata.length && batch.length < PI_HISTORY_LIMITS.metadataBatch && bytes + metadata[offset].bytes <= PI_HISTORY_LIMITS.batchBytes) {
        const item = metadata[offset++]
        batch.push(item)
        bytes += item.bytes
      }
      if (!batch.length) throw historyLimitError()
      const ids = sql.join(batch.map(item => sql`${item.id}`), sql`, `)
      // Recheck actual byte counts in SQL before returning any body, in case a
      // record changed between metadata and body reads. Oversize bodies are NULL.
      const rows = await db.all<{ id: string; bytes: number; entry: string | null }>(sql`
        WITH sizes AS (
          SELECT entry_id AS id, octet_length(entry_json) AS bytes FROM pi_session_entries
          WHERE topic_id = ${this.topicId} AND entry_id IN (${ids})
        ), bounded AS (
          SELECT id, bytes, sum(bytes) OVER (ORDER BY id ROWS UNBOUNDED PRECEDING) AS running_bytes FROM sizes
        )
        SELECT bounded.id, bounded.bytes,
          CASE WHEN bounded.bytes <= ${PI_HISTORY_LIMITS.entryBytes} AND bounded.running_bytes <= ${PI_HISTORY_LIMITS.batchBytes}
            THEN e.entry_json END AS entry
        FROM bounded JOIN pi_session_entries e ON e.topic_id = ${this.topicId} AND e.entry_id = bounded.id
      `)
      if (rows.length !== batch.length) throw await sessionError('invalid_session', 'History changed during reading')
      const bodies = new Map<string, { id: string; bytes: number; entry: string | null }>(rows.map(row => [row.id, row]))
      for (const item of batch) {
        const row = bodies.get(item.id)!
        total += Number(row.bytes)
        if (typeof row.entry !== 'string' || total > PI_HISTORY_LIMITS.totalBytes) throw historyLimitError()
        const entry = JSON.parse(row.entry) as SessionTreeEntry
        if (entry.id !== item.id) throw await sessionError('invalid_session', 'History entry identity mismatch')
        entries.push(entry)
        bodies.delete(item.id)
      }
    }
    return entries
  }

  private async getStoredEntries(options?: SessionEntryCursorOptions): Promise<SessionTreeEntry[]> {
    const db = this.db
    const limit = options?.limit ?? PI_HISTORY_LIMITS.entries + 1
    if (!Number.isSafeInteger(limit) || limit < 0) throw historyLimitError()
    const metadata: EntryMetadata[] = []
    let sequence = (options?.afterEntrySeq ?? 0) - 1
    let total = 0
    while (metadata.length < limit) {
      const count = Math.min(PI_HISTORY_LIMITS.metadataBatch, limit - metadata.length)
      const rows = await db.all<EntryMetadata & { sequence: number }>(sql`
        SELECT substr(entry_id, 1, 1025) AS id, octet_length(entry_json) AS bytes, sequence
        FROM pi_session_entries WHERE topic_id = ${this.topicId} AND sequence > ${sequence}
        ORDER BY sequence LIMIT ${count}
      `)
      for (const row of rows) {
        if (Buffer.byteLength(row.id) > 1024) throw historyLimitError()
        total = this.checkHistoryMetadata(metadata, row, total)
        metadata.push({ id: row.id, bytes: Number(row.bytes) })
        sequence = Number(row.sequence)
      }
      if (rows.length < count) break
    }
    const entries = await this.readBoundedEntries(db, metadata)
    return entries
  }

}
