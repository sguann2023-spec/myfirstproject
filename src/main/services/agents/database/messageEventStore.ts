import { sql } from 'drizzle-orm'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import * as schema from './schema'

type Database = LibSQLDatabase<typeof schema>
export type MessageEventEntity = 'agent_messages' | 'agent_message_parts' | 'session_messages'
const messageEntities: MessageEventEntity[] = ['agent_messages', 'agent_message_parts', 'session_messages']

/** New sessions must not touch old message stores lacking session indexes.
 * Do not cache session ownership: attached sources may change between reads. */
export async function resolveMessageProjectionTables(database: Database, sessionId: string): Promise<Record<MessageEventEntity, string>> {
  const tables = Object.fromEntries(messageEntities.map(entity => [entity, entity])) as Record<MessageEventEntity, string>
  const client = (database as Database & { $client?: { overlayEnabled?: boolean } }).$client
  if (client?.overlayEnabled === false) return tables
  const views = await database.all<{ name: string }>(sql`
    SELECT name FROM sqlite_temp_master WHERE type='view' AND name IN (
      'overlay_legacy_sessions','overlay_new_agent_messages','overlay_new_agent_message_parts','overlay_new_session_messages')
  `)
  const names = new Set(views.map(row => row.name))
  if (!names.has('overlay_legacy_sessions')) return tables
  const legacy = await database.all<{ id: string }>(sql`SELECT id FROM overlay_legacy_sessions WHERE id=${sessionId} LIMIT 1`)
  if (legacy.length) return tables
  for (const entity of messageEntities) if (names.has(`overlay_new_${entity}`)) tables[entity] = `overlay_new_${entity}`
  return tables
}

/** Read durable current views directly; raw SQL bypasses Drizzle's JSON decoding. */
export async function readMessageProjection<T>(database: Database, entity: MessageEventEntity, sessionId: string): Promise<T[]> {
  const tables = await resolveMessageProjectionTables(database, sessionId)
  const rows = await database.all<Record<string, unknown>>(
    sql`SELECT * FROM ${sql.identifier(tables[entity])} WHERE session_id=${sessionId}`
  )
  return rows.map((row) => {
    for (const key of Object.keys(row)) {
      if (key.endsWith('_json') && typeof row[key] === 'string') row[key] = JSON.parse(row[key] as string)
    }
    return row as T
  })
}
