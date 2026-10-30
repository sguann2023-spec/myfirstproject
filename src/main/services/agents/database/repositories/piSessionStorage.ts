import { createHash, randomUUID } from 'node:crypto'

import type {
  SessionEntryCursorOptions,
  SessionErrorCode,
  SessionMetadata,
  SessionStats,
  SessionStorage,
  SessionTreeEntry
} from '@earendil-works/pi-agent-core'
import { and, asc, eq, sql } from 'drizzle-orm'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'

import { piInvocationEntriesTable, piSessionEntriesTable, piSessionsTable } from '../schema'
import type * as schema from '../schema'
import { withoutTransaction } from '../withoutTransaction'
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
interface EntryMetadata { id: string; bytes: number }

function historyLimitError(): Error {
  const error = new Error('PI history exceeds safe reading limits; compact the conversation or start a new session.')
  error.name = 'PiHistoryLimitError'
  return error
}

type InvocationEntryKind = 'user_message'
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

const topicWrites = new Map<string, OrderedTaskQueue>()

function runTopicWrite<T>(topicId: string, operation: () => Promise<T>): Promise<T> {
  let queue = topicWrites.get(topicId)
  if (!queue) {
    queue = new OrderedTaskQueue()
    topicWrites.set(topicId, queue)
  }
  return queue.run(operation)
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

export class SqlitePiSessionStorage implements SessionStorage<DurablePiSessionMetadata> {
  private invocationId?: string
  private overlay = false
  private overlayPrefix: SessionTreeEntry[] = []
  private overlayPrefixById = new Map<string, SessionTreeEntry>()

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
    storage.overlay = await isPiOverlay(await storage.database())
    await storage.ensureSession(input.requestedSessionId ?? input.topicId, input.metadata)
    if (storage.overlay) {
      await storage.restoreOverlayContext(input.invocationId)
    } else {
      await storage.hydrateFromCanonicalTranscript(input.invocationId)
      await storage.closeInterruptedToolCalls()
    }
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
    if (await isPiOverlay(db)) {
      const boundary = await captureOverlayBoundary(db, input.topicId)
      const prefix = await readOverlayPrefix(db, input.topicId, boundary,
        (messageId) => messageId)
      return prefix.some(item => !excluded.has(item.id) && !(item as any).__providerHidden)
    }
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
    await runTopicWrite(this.topicId, async () => {
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
      const [existing] = await db.select({ topicId: piSessionsTable.topic_id })
        .from(piSessionsTable).where(eq(piSessionsTable.topic_id, this.topicId)).limit(1)
      if (existing) return
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
    await runTopicWrite(this.topicId, async () => {
      const db = await this.database()
      const markerKey = '__canonicalHydration'
      const [session] = await db.select().from(piSessionsTable).where(eq(piSessionsTable.topic_id, this.topicId)).limit(1)
      const metadata = session?.metadata_json ?? {}
      const marker = metadata[markerKey] as { complete?: boolean; excludeMessageId?: string } | undefined
      if (marker?.complete) return
      const [existing] = await db.select({ id: piSessionEntriesTable.entry_id })
        .from(piSessionEntriesTable).where(eq(piSessionEntriesTable.topic_id, this.topicId)).limit(1)
      // Existing PI conversations without a hydration checkpoint are authoritative.
      if (existing && !marker) return
      const excludedId = marker ? marker.excludeMessageId : excludeMessageId
      const saveCheckpoint = async (complete: boolean) => {
        await db.update(piSessionsTable).set({
          metadata_json: { ...metadata, [markerKey]: { complete, excludeMessageId: excludedId } }
        }).where(eq(piSessionsTable.topic_id, this.topicId))
      }
      const transcript = (await new AgentTranscriptRepository(db).listTranscript(this.topicId)).filter(
        (item) => !excludedId ||
          (item.message.id !== excludedId && item.message.parentMessageId !== excludedId)
      )
      if (transcript.length === 0) return
      if (!marker) await saveCheckpoint(false)
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
          // Persist each entry before its leaf as independent statements.
          // Stable IDs support explicit hydration after a restart, not automatic retry.
          await this.persistEntryTreeSequentially(db, async (tx) => {
            if (!(await this.getEntryWith(tx, entry.id))) await this.insertEntry(tx, entry, entry.id)
          })
          leafId = entry.id
        }
      }
      await saveCheckpoint(true)
    })
  }

  private async restoreOverlayContext(excludeMessageId?: string): Promise<void> {
    await runTopicWrite(this.topicId, async () => {
      const db = await this.database()
      const [session] = await db.select().from(piSessionsTable).where(eq(piSessionsTable.topic_id, this.topicId)).limit(1)
      const metadata = session.metadata_json ?? {}
      let boundary = metadata.__overlayContext as OverlayContextBoundary | undefined
      if (!boundary) {
        const [existing] = await db.select({ id: piSessionEntriesTable.entry_id }).from(piSessionEntriesTable)
          .where(eq(piSessionEntriesTable.topic_id, this.topicId)).limit(1)
        // Merged legacy PI trees are authoritative and need no projected prefix.
        if (existing) return
        boundary = await captureOverlayBoundary(db, this.topicId, excludeMessageId)
      }
      this.overlayPrefix = await readOverlayPrefix(db, this.topicId, boundary,
        (messageId, index) => stableEntryId('canonical', this.topicId, messageId, index))
      const treeDigest = createHash('sha256').update(JSON.stringify(this.overlayPrefix.map(entry => [entry.id, entry.parentId]))).digest('hex')
      if (boundary.treeDigest && boundary.treeDigest !== treeDigest) {
        throw await sessionError('invalid_session', 'PI overlay source context changed or is unavailable; cannot restore its parent tree without migration')
      }
      this.overlayPrefixById = new Map(this.overlayPrefix.map(entry => [entry.id, entry]))
      if (!metadata.__overlayContext) {
        await db.update(piSessionsTable).set({
          metadata_json: { ...metadata, __overlayContext: { ...boundary, treeDigest } },
          active_leaf_id: this.overlayPrefix[this.overlayPrefix.length - 1]?.id ?? null
        }).where(eq(piSessionsTable.topic_id, this.topicId))
      }
    })
  }

  private async closeInterruptedToolCalls(): Promise<void> {
    await runTopicWrite(this.topicId, async () => {
      const db = await this.database()
      await this.persistEntryTreeSequentially(db, async (tx) => {
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

  private async filterProviderHiddenCanonicalEntries(
    db: DatabaseExecutor,
    entries: SessionTreeEntry[],
    closeInterrupted = false
  ): Promise<SessionTreeEntry[]> {
    const hiddenIds = await this.getProviderHiddenCanonicalEntryIds(db)
    const visibleEntries = entries.filter((entry) => !hiddenIds.has(entry.id) && !(entry as any).__providerHidden)
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
    const filtered = visibleEntries.filter((entry) => {
      if (entry.type !== 'message' || entry.message.role !== 'toolResult') return true
      const id = entry.message.toolCallId
      return !discardedCalls.has(id) || replayableCalls.has(id)
    })
    if (!this.overlay || !closeInterrupted) return filtered
    // Interrupted legacy calls are closed only in the read projection, never copied.
    const resolved = new Set(filtered.flatMap(entry => entry.type === 'message' && entry.message.role === 'toolResult' ? [entry.message.toolCallId] : []))
    const closed: SessionTreeEntry[] = []
    for (const entry of filtered) {
      closed.push(entry)
      if (entry.type !== 'message' || entry.message.role !== 'assistant' || ['aborted', 'error'].includes(entry.message.stopReason)) continue
      for (const [contentIndex, content] of entry.message.content.entries()) {
        if (content.type !== 'toolCall' || resolved.has(content.id)) continue
        resolved.add(content.id)
        closed.push(overlayInterruptedResult(entry, contentIndex)!)
      }
    }
    const metadata: EntryMetadata[] = []
    let bytes = 0
    for (const entry of closed) {
      const item = { id: entry.id, bytes: Buffer.byteLength(JSON.stringify(entry)) }
      bytes = this.checkHistoryMetadata(metadata, item, bytes)
      metadata.push(item)
    }
    return closed
  }

  async getMetadata(): Promise<DurablePiSessionMetadata> {
    const db = await this.database()
    const [row] = await db.select().from(piSessionsTable).where(eq(piSessionsTable.topic_id, this.topicId)).limit(1)
    if (!row) throw await sessionError('not_found', `PI session for topic ${this.topicId} was not found`)
    return {
      id: row.pi_session_id,
      createdAt: row.created_at,
      topicId: row.topic_id,
      metadata: row.metadata_json
        ? Object.fromEntries(Object.entries(row.metadata_json).filter(([key]) => !['__canonicalHydration', '__overlayContext'].includes(key)))
        : undefined
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
    await runTopicWrite(this.topicId, async () => {
      const db = await this.database()
      await this.persistEntryTreeSequentially(db, async (tx) => {
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
    await runTopicWrite(this.topicId, async () => {
      const db = await this.database()
      await this.persistEntryTreeSequentially(db, async (tx) => {
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

  // Entry rows, active leaf updates and invocation claims persist sequentially.
  // Failures leave a completed prefix; the topic queue only provides ordering.
  private persistEntryTreeSequentially<T>(
    db: AgentDatabase,
    operation: (tx: AgentDatabase) => Promise<T>
  ): Promise<T> {
    return withoutTransaction(db, operation)
  }

  private async claimInvocationEntry(
    tx: AgentDatabase,
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

  private async insertEntry(tx: DatabaseExecutor, entry: SessionTreeEntry, leafId: string | null): Promise<void> {
    // Allocate within the topic queue; conflicts propagate without replaying writes.
    const [sequenceRow] = await tx
      .select({ nextSequence: sql<number>`coalesce(max(${piSessionEntriesTable.sequence}), -1) + 1` })
      .from(piSessionEntriesTable)
      .where(eq(piSessionEntriesTable.topic_id, this.topicId))
    await tx.insert(piSessionEntriesTable).values({
      topic_id: this.topicId,
      sequence: Number(sequenceRow?.nextSequence ?? 0),
      entry_id: entry.id,
      parent_entry_id: entry.parentId,
      entry_type: entry.type,
      entry_json: entry as unknown as Record<string, unknown>,
      created_at: entry.timestamp
    })

    await tx
      .update(piSessionsTable)
      .set({ active_leaf_id: leafId, updated_at: new Date().toISOString() })
      .where(eq(piSessionsTable.topic_id, this.topicId))
  }

  async getEntry(id: string): Promise<SessionTreeEntry | undefined> {
    return this.getEntryWith(await this.database(), id)
  }

  private async getEntryWith(db: DatabaseExecutor, id: string): Promise<SessionTreeEntry | undefined> {
    if (Buffer.byteLength(id) > 1024) throw historyLimitError()
    const projected = this.overlayPrefixById.get(id)
    if (projected) return projected
    const [row] = await db.all<{ entry: string | null }>(sql`
      SELECT CASE WHEN octet_length(entry_json) <= ${PI_HISTORY_LIMITS.entryBytes}
        THEN entry_json END AS entry FROM pi_session_entries
      WHERE topic_id = ${this.topicId} AND entry_id = ${id} LIMIT 1
    `)
    if (!row) {
      // Read-projected closures remain addressable if a branch targets one.
      const closure = this.overlay && /^overlay_interrupted:(.+):(\d+)$/.exec(id)
      if (!closure) return undefined
      const assistant = await this.getEntryWith(db, closure[1])
      return assistant ? overlayInterruptedResult(assistant, Number(closure[2])) : undefined
    }
    if (typeof row.entry !== 'string') throw historyLimitError()
    return JSON.parse(row.entry) as SessionTreeEntry
  }

  async findEntries<TType extends SessionTreeEntry['type']>(
    type: TType
  ): Promise<Array<Extract<SessionTreeEntry, { type: TType }>>> {
    if (this.overlay) return (await this.getEntries()).filter(entry => entry.type === type) as Array<Extract<SessionTreeEntry, { type: TType }>>
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
    if (this.overlay) {
      const path: SessionTreeEntry[] = []
      const metadata: EntryMetadata[] = []
      const visited = new Set<string>()
      let next: string | null = leafId
      let stopAt: string | null = null
      let bytes = 0
      while (next !== null) {
        if (visited.has(next)) throw await sessionError('invalid_session', `Cycle at entry ${next}`)
        visited.add(next)
        const entry = await this.getEntryWith(db, next)
        if (!entry) throw await sessionError('invalid_session', `Entry ${next} not found`)
        const item = { id: entry.id, bytes: Buffer.byteLength(JSON.stringify(entry)) }
        bytes = this.checkHistoryMetadata(metadata, item, bytes)
        metadata.push(item)
        path.push(entry)
        if (entry.id === stopAt || (entry.type === 'compaction' && Array.isArray(entry.retainedTail))) break
        if (entry.type === 'compaction') stopAt = entry.firstKeptEntryId ?? null
        next = entry.parentId
      }
      return this.filterProviderHiddenCanonicalEntries(db, path.reverse(), true)
    }
    const metadata: EntryMetadata[] = []
    const visited = new Set<string>()
    let stopAtEntryId: string | null = null
    let next: string | null = leafId
    let total = 0
    while (next !== null) {
      if (Buffer.byteLength(next) > 1024) throw historyLimitError()
      const rows = await db.all<EntryMetadata & { parent: string | null; type: string; first_kept: string | null; retained: number }>(sql`
        WITH RECURSIVE walk(id, parent, type, bytes, first_kept, retained, depth, stop_at) AS (
          SELECT entry_id, parent_entry_id, entry_type, octet_length(entry_json),
            CASE WHEN entry_type = 'compaction' AND octet_length(entry_json) <= ${PI_HISTORY_LIMITS.entryBytes}
              THEN substr(json_extract(entry_json, '$.firstKeptEntryId'), 1, 1025) END,
            CASE WHEN entry_type = 'compaction' AND octet_length(entry_json) <= ${PI_HISTORY_LIMITS.entryBytes}
              THEN coalesce(json_type(entry_json, '$.retainedTail'), 'null') = 'array' ELSE 0 END,
            0, ${stopAtEntryId}
          FROM pi_session_entries WHERE topic_id = ${this.topicId} AND entry_id = ${next}
          UNION ALL
          SELECT p.entry_id, p.parent_entry_id, p.entry_type, octet_length(p.entry_json),
            CASE WHEN p.entry_type = 'compaction' AND octet_length(p.entry_json) <= ${PI_HISTORY_LIMITS.entryBytes}
              THEN substr(json_extract(p.entry_json, '$.firstKeptEntryId'), 1, 1025) END,
            CASE WHEN p.entry_type = 'compaction' AND octet_length(p.entry_json) <= ${PI_HISTORY_LIMITS.entryBytes}
              THEN coalesce(json_type(p.entry_json, '$.retainedTail'), 'null') = 'array' ELSE 0 END,
            walk.depth + 1, CASE WHEN walk.type = 'compaction' THEN walk.first_kept ELSE walk.stop_at END
          FROM walk JOIN pi_session_entries p ON p.topic_id = ${this.topicId} AND p.entry_id = walk.parent
          WHERE walk.depth < ${PI_HISTORY_LIMITS.metadataBatch - 1} AND NOT walk.retained
            AND (walk.stop_at IS NULL OR walk.id <> walk.stop_at)
        )
        SELECT substr(id, 1, 1025) AS id, substr(parent, 1, 1025) AS parent,
          type, bytes, first_kept, retained FROM walk ORDER BY depth
      `)
      if (rows.length === 0) throw await sessionError(metadata.length ? 'invalid_session' : 'not_found', `Entry ${next} not found`)
      for (const row of rows) {
        if (Buffer.byteLength(row.id) > 1024 || (row.parent && Buffer.byteLength(row.parent) > 1024) ||
          (row.first_kept && Buffer.byteLength(row.first_kept) > 1024)) throw historyLimitError()
        if (visited.has(row.id)) throw await sessionError('invalid_session', `Cycle at entry ${row.id}`)
        visited.add(row.id)
        total = this.checkHistoryMetadata(metadata, row, total)
        metadata.push({ id: row.id, bytes: Number(row.bytes) })
        if (row.id === stopAtEntryId || Number(row.retained)) { next = null; break }
        if (row.type === 'compaction') stopAtEntryId = row.first_kept
        next = row.parent
      }
    }
    return this.filterProviderHiddenCanonicalEntries(db, (await this.readBoundedEntries(db, metadata)).reverse())
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

  async getEntries(options?: SessionEntryCursorOptions): Promise<SessionTreeEntry[]> {
    if (this.overlay && this.overlayPrefix.length) {
      const prefix = this.overlayPrefix
      const entries = [...prefix, ...await this.getStoredEntries()]
      let bytes = 0
      const metadata: EntryMetadata[] = []
      for (const entry of entries) {
        const item = { id: entry.id, bytes: Buffer.byteLength(JSON.stringify(entry)) }
        bytes = this.checkHistoryMetadata(metadata, item, bytes)
        metadata.push(item)
      }
      const after = options?.afterEntrySeq ?? 0
      const limit = options?.limit ?? entries.length
      if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 0) throw historyLimitError()
      return this.filterProviderHiddenCanonicalEntries(await this.database(), entries.slice(after, after + limit))
    }
    return this.getStoredEntries(options)
  }

  private async getStoredEntries(options?: SessionEntryCursorOptions): Promise<SessionTreeEntry[]> {
    const db = await this.database()
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
    return this.overlay && this.overlayPrefix.length ? entries : this.filterProviderHiddenCanonicalEntries(db, entries)
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
