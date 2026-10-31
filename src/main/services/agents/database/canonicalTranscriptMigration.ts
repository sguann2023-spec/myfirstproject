import { createHash } from 'node:crypto'

import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'

import { withoutTransaction } from './withoutTransaction'
import type * as schema from './schema'
import {
  agentConversationSegmentsTable,
  agentMessagePartsTable,
  agentMessagesTable,
  agentTurnsTable,
  sessionMessagesTable,
  sessionsTable
} from './schema'

type AgentDatabase = LibSQLDatabase<typeof schema>

type LegacyPayload = {
  message?: Record<string, unknown>
  blocks?: Array<Record<string, unknown>>
}

type LegacyCandidate = {
  rowId: number
  sessionId: string
  payload: LegacyPayload
  messageId: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  status: 'pending' | 'streaming' | 'completed' | 'cancelled' | 'failed' | 'interrupted'
  createdAt: string
  updatedAt: string
  completeness: number
}

type TranscriptMessage = {
  id: string
  role: string
  sequence: number
  createdAt: string
  text: string
}

type MessagePair = { user: TranscriptMessage; assistant: TranscriptMessage }

export interface CanonicalTranscriptBackfillResult {
  legacyRows: number
  invalidRows: number
  duplicateRows: number
  messagesInserted: number
  partsInserted: number
  turnsRepaired: number
  segmentsCreated: number
  turnsCreated: number
  unresolvedTurns: number
  orphanMessages: number
}

export interface CrashReconciliationResult {
  turnsInterrupted: number
  messagesInterrupted: number
  partsInterrupted: number
  toolsInterrupted: number
}

const stableId = (prefix: string, ...values: unknown[]): string =>
  `${prefix}_${createHash('sha256').update(values.map((value) => String(value ?? '')).join('\u0000')).digest('hex').slice(0, 24)}`

const parseJsonObject = (value: unknown): LegacyPayload | null => {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as LegacyPayload) : null
  } catch {
    return null
  }
}

const normalizeRole = (role: unknown): LegacyCandidate['role'] | null => {
  if (role === 'agent') return 'assistant'
  return role === 'user' || role === 'assistant' || role === 'system' || role === 'tool' ? role : null
}

const normalizeStatus = (message: Record<string, unknown>): LegacyCandidate['status'] => {
  const status = String(message.status ?? '').toLowerCase()
  if (message.aborted === true || status === 'cancelled' || status === 'canceled') return 'cancelled'
  if (status === 'failed' || status === 'error') return 'failed'
  if (status === 'interrupted') return 'interrupted'
  if (status === 'streaming' || status === 'running') return 'streaming'
  if (status === 'pending') return 'pending'
  return 'completed'
}

const isTerminal = (status: LegacyCandidate['status']): boolean =>
  status === 'completed' || status === 'cancelled' || status === 'failed' || status === 'interrupted'

const candidateCompleteness = (payload: LegacyPayload, status: LegacyCandidate['status']): number => {
  const message = payload.message ?? {}
  const blocks = Array.isArray(payload.blocks) ? payload.blocks : []
  const terminal = isTerminal(status) ? 1_000_000 : 0
  const nonemptyBlocks = blocks.filter((block) => Object.keys(block).length > 0).length
  return terminal + nonemptyBlocks * 1000 + Object.keys(message).length
}

const blockType = (block: Record<string, unknown>): string => {
  const type = String(block.type ?? '').trim()
  if (type === 'main_text') return 'text'
  if (type === 'thinking') return 'reasoning'
  if (type === 'image') return 'image'
  if (type === 'tool') return 'tool'
  return type || 'legacy'
}

const blockData = (block: Record<string, unknown>): Record<string, unknown> => {
  const data = { ...block }
  delete data.id
  delete data.messageId
  if ('content' in data && !('text' in data) && typeof data.content === 'string') {
    data.text = data.content
  }
  return data
}

const messageText = (parts: Array<{ type: string; data_json: Record<string, unknown> }>): string =>
  parts
    .filter((part) => part.type === 'text')
    .map((part) => String(part.data_json?.text ?? part.data_json?.content ?? ''))
    .join('')

const buildPairs = (messages: TranscriptMessage[]): { pairs: MessagePair[]; orphanMessages: number } => {
  const pairs: MessagePair[] = []
  let orphanMessages = 0
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (message.role === 'user' && messages[index + 1]?.role === 'assistant') {
      pairs.push({ user: message, assistant: messages[index + 1] })
      index += 1
    } else if (message.role === 'user' || message.role === 'assistant') {
      orphanMessages += 1
    }
  }
  return { pairs, orphanMessages }
}

const exactTextMatches = (turn: { user_text: string | null; assistant_text: string | null }, pair: MessagePair): boolean => {
  const userText = String(turn.user_text ?? '').trim()
  const assistantText = String(turn.assistant_text ?? '').trim()
  return (!userText || userText === pair.user.text.trim()) &&
    (!assistantText || assistantText === pair.assistant.text.trim())
}

async function loadTranscript(tx: AgentDatabase, sessionId: string): Promise<TranscriptMessage[]> {
  const messages = await tx
    .select()
    .from(agentMessagesTable)
    .where(eq(agentMessagesTable.session_id, sessionId))
    .orderBy(asc(agentMessagesTable.sequence))
  const ids = messages.map((message) => message.id)
  const parts = ids.length
    ? await tx
        .select()
        .from(agentMessagePartsTable)
        .where(and(eq(agentMessagePartsTable.session_id, sessionId), inArray(agentMessagePartsTable.message_id, ids)))
        .orderBy(asc(agentMessagePartsTable.sequence))
    : []
  const partsByMessage = new Map<string, typeof parts>()
  for (const part of parts) {
    const current = partsByMessage.get(part.message_id) ?? []
    current.push(part)
    partsByMessage.set(part.message_id, current)
  }
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    sequence: message.sequence,
    createdAt: message.created_at,
    text: messageText(partsByMessage.get(message.id) ?? [])
  }))
}

async function repairAndProjectTurns(
  tx: AgentDatabase,
  sessionId: string,
  pairs: MessagePair[],
  allowProjection: boolean,
  result: CanonicalTranscriptBackfillResult
): Promise<void> {
  const turns = await tx
    .select()
    .from(agentTurnsTable)
    .where(eq(agentTurnsTable.topic_id, sessionId))
    .orderBy(asc(agentTurnsTable.started_at), asc(agentTurnsTable.id))
  const pairByUser = new Map(pairs.map((pair) => [pair.user.id, pair]))
  const pairByAssistant = new Map(pairs.map((pair) => [pair.assistant.id, pair]))
  const claimed = new Set<string>()

  for (const turn of turns) {
    const userId = String(turn.user_message_id ?? '').trim()
    const assistantId = String(turn.assistant_message_id ?? '').trim()
    let candidates: MessagePair[] = []
    if (userId) {
      const pair = pairByUser.get(userId)
      if (pair && (!assistantId || pair.assistant.id === assistantId)) candidates = [pair]
    } else if (assistantId) {
      const pair = pairByAssistant.get(assistantId)
      if (pair) candidates = [pair]
    } else {
      candidates = pairs.filter((pair) => !claimed.has(pair.user.id) && exactTextMatches(turn, pair))
      if (!String(turn.user_text ?? '').trim() && !String(turn.assistant_text ?? '').trim() && candidates.length !== 1) {
        candidates = []
      }
    }

    if (candidates.length !== 1) {
      if (!userId || !assistantId) result.unresolvedTurns += 1
      continue
    }
    const pair = candidates[0]
    claimed.add(pair.user.id)
    const updates: { user_message_id?: string; assistant_message_id?: string } = {}
    if (!userId) updates.user_message_id = pair.user.id
    if (!assistantId) updates.assistant_message_id = pair.assistant.id
    if (Object.keys(updates).length) {
      await tx.update(agentTurnsTable).set(updates).where(eq(agentTurnsTable.id, turn.id))
      result.turnsRepaired += 1
    }
    await tx
      .update(agentMessagesTable)
      .set({ turn_id: turn.id })
      .where(and(eq(agentMessagesTable.session_id, sessionId), inArray(agentMessagesTable.id, [pair.user.id, pair.assistant.id])))
    await tx
      .update(agentMessagesTable)
      .set({ parent_message_id: pair.user.id })
      .where(and(eq(agentMessagesTable.session_id, sessionId), eq(agentMessagesTable.id, pair.assistant.id), isNull(agentMessagesTable.parent_message_id)))
  }

  // Creating projections is deliberately limited to untouched legacy histories.
  // Mixed histories or histories with an existing segment/turn are left alone.
  if (!allowProjection || turns.length > 0 || pairs.length === 0) return
  const segments = await tx
    .select({ id: agentConversationSegmentsTable.id })
    .from(agentConversationSegmentsTable)
    .where(eq(agentConversationSegmentsTable.topic_id, sessionId))
  if (segments.length > 0) return

  const segmentId = stableId('legacy_seg', sessionId)
  const now = pairs[pairs.length - 1].assistant.createdAt
  const [existingSegment] = await tx.select({ id: agentConversationSegmentsTable.id })
    .from(agentConversationSegmentsTable).where(eq(agentConversationSegmentsTable.id, segmentId)).limit(1)
  if (!existingSegment) {
    await tx
      .insert(agentConversationSegmentsTable)
      .values({
        id: segmentId,
        topic_id: sessionId,
        sdk_session_id: '',
        system_prompt_version: 'legacy',
        system_prompt_hash: stableId('legacy_prompt', sessionId),
        status: 'active',
        start_message_id: pairs[0].user.id,
        end_message_id: pairs[pairs.length - 1].assistant.id,
        created_at: pairs[0].user.createdAt,
        updated_at: now
      })
    result.segmentsCreated += 1
  }

  for (const pair of pairs) {
    const turnId = stableId('legacy_turn', sessionId, pair.user.id, pair.assistant.id)
    const [existingTurn] = await tx.select({ id: agentTurnsTable.id })
      .from(agentTurnsTable).where(eq(agentTurnsTable.id, turnId)).limit(1)
    if (!existingTurn) {
      await tx
        .insert(agentTurnsTable)
        .values({
          id: turnId,
          topic_id: sessionId,
          segment_id: segmentId,
          user_message_id: pair.user.id,
          assistant_message_id: pair.assistant.id,
          user_text: pair.user.text || undefined,
          assistant_text: pair.assistant.text || undefined,
          cumulative_input_tokens: 0,
          started_at: pair.user.createdAt,
          completed_at: pair.assistant.createdAt,
          status: 'completed'
        })
      result.turnsCreated += 1
    }
    await tx
      .update(agentMessagesTable)
      .set({ turn_id: turnId })
      .where(and(eq(agentMessagesTable.session_id, sessionId), inArray(agentMessagesTable.id, [pair.user.id, pair.assistant.id])))
    await tx
      .update(agentMessagesTable)
      .set({ parent_message_id: pair.user.id })
      .where(and(eq(agentMessagesTable.session_id, sessionId), eq(agentMessagesTable.id, pair.assistant.id), isNull(agentMessagesTable.parent_message_id)))
  }
}

/** Backfill legacy history with independent writes, not an atomic session migration. */
export async function backfillCanonicalTranscript(db: AgentDatabase): Promise<CanonicalTranscriptBackfillResult> {
  const result: CanonicalTranscriptBackfillResult = {
    legacyRows: 0,
    invalidRows: 0,
    duplicateRows: 0,
    messagesInserted: 0,
    partsInserted: 0,
    turnsRepaired: 0,
    segmentsCreated: 0,
    turnsCreated: 0,
    unresolvedTurns: 0,
    orphanMessages: 0
  }

  // Deleted sessions retain their events for history, not for active backfill.
  const rows = await db.select().from(sessionMessagesTable)
    .where(inArray(sessionMessagesTable.session_id, db.select({ id: sessionsTable.id }).from(sessionsTable)))
    .orderBy(asc(sessionMessagesTable.created_at), asc(sessionMessagesTable.id))
  result.legacyRows = rows.length
  const candidates = new Map<string, LegacyCandidate>()
  const legacyMessageIdsBySession = new Map<string, Set<string>>()

  for (const row of rows) {
    const payload = parseJsonObject(row.content)
    const message = payload?.message
    const messageId = typeof message?.id === 'string' ? message.id.trim() : ''
    const role = normalizeRole(message?.role ?? row.role)
    if (!payload || !message || !messageId || !role) {
      result.invalidRows += 1
      continue
    }
    const status = normalizeStatus(message)
    const candidate: LegacyCandidate = {
      rowId: row.id,
      sessionId: row.session_id,
      payload,
      messageId,
      role,
      status,
      createdAt: String(message.createdAt ?? row.created_at),
      updatedAt: String(message.updatedAt ?? row.updated_at),
      completeness: candidateCompleteness(payload, status)
    }
    const key = `${row.session_id}\u0000${messageId}`
    const existing = candidates.get(key)
    if (existing) {
      result.duplicateRows += 1
      if (
        candidate.completeness < existing.completeness ||
        (candidate.completeness === existing.completeness && candidate.updatedAt <= existing.updatedAt)
      ) {
        continue
      }
    }
    candidates.set(key, candidate)
    const legacyIds = legacyMessageIdsBySession.get(row.session_id) ?? new Set<string>()
    legacyIds.add(messageId)
    legacyMessageIdsBySession.set(row.session_id, legacyIds)
  }

  // Backfill statements persist independently; failures leave the completed prefix.
  // Yield between sessions without holding a database lock or replaying writes.
  const candidatesBySession = new Map<string, LegacyCandidate[]>()
  for (const candidate of candidates.values()) {
    const grouped = candidatesBySession.get(candidate.sessionId) ?? []
    grouped.push(candidate)
    candidatesBySession.set(candidate.sessionId, grouped)
  }
  for (const [sessionId, sessionCandidates] of candidatesBySession) {
    await withoutTransaction(db, async (tx) => {
      // Selection precedes these writes; the session may have been deleted.
      // Retained history is not active migration input.
      const [session] = await tx.select({ id: sessionsTable.id }).from(sessionsTable).where(eq(sessionsTable.id, sessionId)).limit(1)
      if (!session) return
      const ordered = [...sessionCandidates].sort(
        (left, right) => left.createdAt.localeCompare(right.createdAt) || left.rowId - right.rowId
      )
      let nextSequence: number | undefined
      for (const candidate of ordered) {
        const [existing] = await tx.select({ session_id: agentMessagesTable.session_id }).from(agentMessagesTable).where(eq(agentMessagesTable.id, candidate.messageId)).limit(1)
        if (existing) {
          // A global logical id owned by another session is ambiguous; an existing
          // canonical row in this session is already the more authoritative copy.
          continue
        }
        if (nextSequence === undefined) {
          const rows = await tx.select({ value: sql<number>`coalesce(max(${agentMessagesTable.sequence}), -1)` }).from(agentMessagesTable).where(eq(agentMessagesTable.session_id, sessionId))
          nextSequence = Number(rows[0]?.value ?? -1) + 1
        }
        const sequence = nextSequence
        nextSequence += 1
        const message = candidate.payload.message ?? {}
        await tx.insert(agentMessagesTable).values({
          id: candidate.messageId,
          session_id: sessionId,
          sequence,
          role: candidate.role,
          status: candidate.status,
          semantics_json: { origin: 'migration', source: 'session_messages', legacyRowId: candidate.rowId, uiVisibility: 'visible', providerVisibility: 'visible' },
          provider_json: message.modelId ? { modelId: message.modelId } : undefined,
          usage_json: message.usage && typeof message.usage === 'object' ? (message.usage as Record<string, unknown>) : undefined,
          error_json: message.error && typeof message.error === 'object' ? (message.error as Record<string, unknown>) : undefined,
          finish_json: message.finish && typeof message.finish === 'object' ? (message.finish as Record<string, unknown>) : undefined,
          created_at: candidate.createdAt,
          completed_at: isTerminal(candidate.status) ? candidate.updatedAt : undefined,
          updated_at: candidate.updatedAt
        })
        result.messagesInserted += 1

        const blocks = Array.isArray(candidate.payload.blocks) ? candidate.payload.blocks : []
        for (let index = 0; index < blocks.length; index += 1) {
          const block = blocks[index]
          await tx.insert(agentMessagePartsTable).values({
            id: stableId('legacy_part', sessionId, candidate.messageId, index, block.id),
            session_id: sessionId,
            message_id: candidate.messageId,
            sequence: index,
            type: blockType(block),
            data_json: blockData(block),
            created_at: String(block.createdAt ?? candidate.createdAt),
            updated_at: String(block.updatedAt ?? candidate.updatedAt)
          })
          result.partsInserted += 1
        }
      }

      const transcript = await loadTranscript(tx, sessionId)
      const { pairs, orphanMessages } = buildPairs(transcript)
      result.orphanMessages += orphanMessages
      const legacyIds = legacyMessageIdsBySession.get(sessionId) ?? new Set<string>()
      const legacyOnly = transcript.length > 0 && transcript.every((message) => legacyIds.has(message.id))
      await repairAndProjectTurns(tx, sessionId, pairs, legacyOnly, result)
    })
    // Yield between sessions so concurrent app work keeps making progress.
    await new Promise((resolve) => setImmediate(resolve))
  }

  return result
}

const interruptedToolError = {
  code: 'interrupted',
  name: 'InterruptedError',
  message: 'Tool execution was interrupted before completion.'
}

/** Settle process-owned in-flight state left behind by a previous process.
 *
 * `beforeTimestamp` (process start time, ISO) is a watermark: rows created or
 * updated at/after it belong to a live turn of the current process and must not
 * be settled. The expensive tool-part sweep is scoped to non-terminal messages
 * instead of the whole parts table; a tool part stuck under an already-terminal
 * message is closed by SqlitePiSessionStorage.closeInterruptedToolCalls when
 * the session is opened for provider context.
 */
export async function reconcileInterruptedAgentWork(
  db: AgentDatabase,
  options?: { beforeTimestamp?: string }
): Promise<CrashReconciliationResult> {
  const now = new Date().toISOString()
  const before = options?.beforeTimestamp
  const staleOnly = <T extends { started_at?: unknown; updated_at?: unknown }>(row: T): boolean => {
    if (!before) return true
    const marker = String(row.updated_at ?? row.started_at ?? '')
    return !marker || marker < before
  }
  return withoutTransaction(db, async (tx) => {
    const runningTurns = (
      await tx.select({ id: agentTurnsTable.id, started_at: agentTurnsTable.started_at }).from(agentTurnsTable)
        .where(and(
          eq(agentTurnsTable.status, 'running'),
          inArray(agentTurnsTable.topic_id, tx.select({ id: sessionsTable.id }).from(sessionsTable))
        ))
    ).filter((turn) => staleOnly(turn))
    if (runningTurns.length) {
      await tx
        .update(agentTurnsTable)
        .set({ status: 'interrupted', completed_at: now })
        .where(inArray(agentTurnsTable.id, runningTurns.map((turn) => turn.id)))
    }

    const streamingMessages = (
      await tx
        .select({ id: agentMessagesTable.id, updated_at: agentMessagesTable.updated_at })
        .from(agentMessagesTable)
        .where(and(
          eq(agentMessagesTable.role, 'assistant'),
          inArray(agentMessagesTable.status, ['pending', 'streaming']),
          inArray(agentMessagesTable.session_id, tx.select({ id: sessionsTable.id }).from(sessionsTable))
        ))
    ).filter((message) => staleOnly(message))
    const streamingIds = streamingMessages.map((message) => message.id)
    if (streamingIds.length) {
      await tx
        .update(agentMessagesTable)
        .set({ status: 'interrupted', completed_at: now, updated_at: now, error_json: interruptedToolError, finish_json: { reason: 'interrupted' } })
        .where(inArray(agentMessagesTable.id, streamingIds))
    }

    let partsInterrupted = 0
    let toolsInterrupted = 0
    if (streamingIds.length) {
      const messageParts = await tx.select().from(agentMessagePartsTable).where(inArray(agentMessagePartsTable.message_id, streamingIds))
      for (const part of messageParts) {
        const data = part.data_json ?? {}
        const nonTerminal =
          data.status === 'streaming' || data.status === 'pending' || data.status === 'running' || data.status === 'processing'
        if (!nonTerminal) continue
        if (part.type === 'tool') {
          await tx
            .update(agentMessagePartsTable)
            .set({
              data_json: {
                ...data,
                status: 'error',
                interruptionStatus: 'interrupted',
                error: interruptedToolError,
                result: { type: 'error', error: interruptedToolError }
              },
              updated_at: now
            })
            .where(eq(agentMessagePartsTable.id, part.id))
          toolsInterrupted += 1
        } else {
          await tx.update(agentMessagePartsTable).set({ data_json: { ...data, status: 'interrupted' }, updated_at: now }).where(eq(agentMessagePartsTable.id, part.id))
          partsInterrupted += 1
        }
      }
    }

    return {
      turnsInterrupted: runningTurns.length,
      messagesInterrupted: streamingIds.length,
      partsInterrupted,
      toolsInterrupted
    }
  })
}
