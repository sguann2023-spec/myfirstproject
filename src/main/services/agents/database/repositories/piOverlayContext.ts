import { sql, type SQL } from 'drizzle-orm'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import type { SessionTreeEntry } from '@earendil-works/pi-agent-core'

import type * as schema from '../schema'
import { persistedToCanonicalInputs } from '../agentHistoryMapper'
import { resolveMessageProjectionTables } from '../messageEventStore'
import type { AgentMessageWithParts } from './agentTranscript.types'
import { canonicalMessageToPi, PI_HISTORY_LIMITS } from './piSessionStorage'

type Database = LibSQLDatabase<typeof schema>
export interface OverlayContextBoundary {
  canonicalSequence: number
  legacyId: number
  excludeMessageId?: string
  treeDigest?: string
}

export async function isPiOverlay(database: Database): Promise<boolean> {
  const client = (database as Database & { $client?: { overlayEnabled?: boolean } }).$client
  if (client?.overlayEnabled !== undefined) return client.overlayEnabled
  return (await database.all(sql`SELECT name FROM sqlite_temp_master WHERE name='overlay_legacy_sessions' AND type='view'`)).length > 0
}

function limitError(): Error {
  return Object.assign(new Error('PI overlay context exceeds safe reading limits; start a new session.'), { name: 'PiHistoryLimitError' })
}

export async function captureOverlayBoundary(database: Database, topicId: string, excludeMessageId?: string): Promise<OverlayContextBoundary> {
  const tables = await resolveMessageProjectionTables(database, topicId)
  const [canonical] = await database.all<{ maximum: number }>(sql`SELECT coalesce(max(sequence),-1) AS maximum FROM ${sql.identifier(tables.agent_messages)} WHERE session_id=${topicId}`)
  const [legacy] = await database.all<{ maximum: number }>(sql`SELECT coalesce(max(id),-1) AS maximum FROM ${sql.identifier(tables.session_messages)} WHERE session_id=${topicId}`)
  return { canonicalSequence: Number(canonical.maximum), legacyId: Number(legacy.maximum), excludeMessageId }
}

// Budget metadata before transferring bodies, then recheck each body in SQL.
// A prefix boundary is durable; message bodies never are.
export async function readOverlayPrefix(
  database: Database,
  topicId: string,
  boundary: OverlayContextBoundary,
  entryId: (messageId: string, index: number) => string
): Promise<SessionTreeEntry[]> {
  if (!Number.isSafeInteger(boundary.canonicalSequence) || !Number.isSafeInteger(boundary.legacyId)) throw limitError()
  const tables = await resolveMessageProjectionTables(database, topicId)
  let totalBytes = 0
  let totalRows = 0
  let actualBytes = 0
  const read = async (table: string, predicate: SQL): Promise<Record<string, any>[]> => {
    const columns = await database.all<{ name: string }>(sql`PRAGMA table_info(${sql.identifier(table)})`)
    const fields = sql.join(columns.flatMap(({ name }) => [sql`${name}`, sql.identifier(name)]), sql`, `)
    const json = sql`json_object(${fields})`
    const [size] = await database.all<{ count: number; bytes: number; largest: number }>(sql`
      SELECT count(*) AS count, coalesce(sum(octet_length(${json})),0) AS bytes,
        coalesce(max(octet_length(${json})),0) AS largest FROM ${sql.identifier(table)} WHERE ${predicate}
    `)
    totalBytes += Number(size.bytes)
    totalRows += Number(size.count)
    if (totalBytes > PI_HISTORY_LIMITS.totalBytes || totalRows > PI_HISTORY_LIMITS.entries || Number(size.largest) > PI_HISTORY_LIMITS.entryBytes) throw limitError()
    const result: Record<string, any>[] = []
    let offset = 0
    while (offset < Number(size.count)) {
      const rows = await database.all<{ body: string | null; bytes: number }>(sql`
        WITH page AS (SELECT ${json} AS body FROM ${sql.identifier(table)} WHERE ${predicate}
          ORDER BY id LIMIT ${PI_HISTORY_LIMITS.metadataBatch} OFFSET ${offset}),
        sized AS (SELECT body, octet_length(body) AS bytes,
          sum(octet_length(body)) OVER (ROWS UNBOUNDED PRECEDING) AS running FROM page)
        SELECT CASE WHEN bytes<=${PI_HISTORY_LIMITS.entryBytes} AND running<=${PI_HISTORY_LIMITS.batchBytes}
          THEN body END AS body, bytes FROM sized
      `)
      let accepted = 0
      for (const row of rows) {
        if (row.body === null) break
        actualBytes += Number(row.bytes)
        if (actualBytes > PI_HISTORY_LIMITS.totalBytes || result.length >= PI_HISTORY_LIMITS.entries) throw limitError()
        const item = JSON.parse(row.body)
        for (const key of Object.keys(item)) {
          if (key.endsWith('_json') && typeof item[key] === 'string') item[key] = JSON.parse(item[key])
        }
        result.push(item)
        accepted++
      }
      if (!accepted) throw limitError()
      offset += accepted
    }
    return result
  }
  const canonicalPredicate = sql`session_id=${topicId} AND sequence<=${boundary.canonicalSequence}`
  const messages = await read(tables.agent_messages, canonicalPredicate)
  const parts = await read(tables.agent_message_parts, sql`session_id=${topicId} AND message_id IN (
    SELECT id FROM ${sql.identifier(tables.agent_messages)} WHERE ${canonicalPredicate})`)
  const canonicalIds = new Set(messages.map(message => message.id))
  const partsByMessage = new Map<string, Record<string, any>[]>()
  for (const part of parts) {
    const group = partsByMessage.get(part.message_id) ?? []
    group.push(part)
    partsByMessage.set(part.message_id, group)
  }
  const transcript: AgentMessageWithParts[] = messages.map(row => ({
    message: {
      id: row.id, sessionId: topicId, sequence: Number(row.sequence), parentMessageId: row.parent_message_id,
      role: row.role, status: row.status, semantics: row.semantics_json, provider: row.provider_json,
      usage: row.usage_json, error: row.error_json, createdAt: row.created_at, updatedAt: row.updated_at
    },
    parts: (partsByMessage.get(row.id) ?? []).sort((a, b) => a.sequence - b.sequence).map(part => ({
      id: part.id, sessionId: topicId, messageId: row.id, sequence: Number(part.sequence), type: part.type,
      data: part.data_json, createdAt: part.created_at, updatedAt: part.updated_at
    }))
  }))
  const legacy = await read(tables.session_messages, sql`session_id=${topicId} AND id<=${boundary.legacyId}`)
  const candidates = new Map<string, { entry: AgentMessageWithParts; score: number }>()
  for (const row of legacy) {
    const payload = typeof row.content === 'string' ? JSON.parse(row.content) : row.content
    if (!payload?.message) throw new Error('PI overlay legacy history has no supported message payload')
    if (canonicalIds.has(String(payload.message.id))) continue
    payload.message.createdAt ??= row.created_at ?? '1970-01-01T00:00:00.000Z'
    payload.message.updatedAt ??= row.updated_at ?? payload.message.createdAt
    const metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata
    const inputs = persistedToCanonicalInputs(topicId, payload, metadata)
    if (!inputs) throw new Error('PI overlay legacy history has an invalid message payload')
    if (payload.message.visibility === 'hidden') inputs.message.semantics = { ...inputs.message.semantics, providerVisibility: 'hidden' }
    const entry = {
      message: { ...inputs.message, sequence: Number(row.id), createdAt: inputs.message.createdAt ?? row.created_at, updatedAt: inputs.message.updatedAt ?? row.updated_at },
      parts: inputs.parts.map((part, sequence) => ({ ...part, sequence, createdAt: part.createdAt!, updatedAt: part.updatedAt! }))
    } as AgentMessageWithParts
    const terminal = ['completed', 'failed', 'cancelled', 'interrupted'].includes(entry.message.status)
    const score = (terminal ? 1000000 : 0) + entry.parts.length
    if (!candidates.has(entry.message.id) || candidates.get(entry.message.id)!.score <= score) candidates.set(entry.message.id, { entry, score })
  }
  transcript.push(...Array.from(candidates.values(), candidate => candidate.entry))
  transcript.sort((a, b) => a.message.createdAt.localeCompare(b.message.createdAt) || a.message.sequence - b.message.sequence || a.message.id.localeCompare(b.message.id))
  const entries: SessionTreeEntry[] = []
  const messageLeaves = new Map<string, string | null>()
  let bytes = 0
  for (const item of transcript) {
    if (boundary.excludeMessageId && (item.message.id === boundary.excludeMessageId || item.message.parentMessageId === boundary.excludeMessageId)) continue
    let parentId = entries[entries.length - 1]?.id ?? null
    if (item.message.parentMessageId) {
      if (!messageLeaves.has(item.message.parentMessageId)) throw new Error(`PI overlay context parent ${item.message.parentMessageId} is unavailable or out of order`)
      parentId = messageLeaves.get(item.message.parentMessageId) ?? null
    }
    for (const [index, message] of canonicalMessageToPi(item, true).entries()) {
      const entry: SessionTreeEntry = { type: 'message', id: entryId(item.message.id, index), parentId, timestamp: item.message.createdAt, message }
      if (item.message.semantics?.providerVisibility === 'hidden') (entry as any).__providerHidden = true
      const size = Buffer.byteLength(JSON.stringify(entry))
      bytes += size
      if (size > PI_HISTORY_LIMITS.entryBytes || bytes > PI_HISTORY_LIMITS.totalBytes || entries.length >= PI_HISTORY_LIMITS.entries) throw limitError()
      entries.push(entry)
      parentId = entry.id
    }
    messageLeaves.set(item.message.id, parentId)
  }
  return entries
}
