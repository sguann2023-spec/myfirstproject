// After migration 0014 these message mappings target SQL command views, not tables.
// Reads project immutable events; INSERT/UPDATE/DELETE append through INSTEAD OF triggers.
import { sql } from 'drizzle-orm'
import { check, foreignKey, index, integer, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core'

import { sessionsTable } from './sessions.schema'

/**
 * Canonical, durable agent transcript.
 *
 * IDs are logical identities supplied by the runtime. Sequence numbers are
 * allocated once by the repository and never change during an in-scope upsert.
 */
export const agentMessagesTable = sqliteTable(
  'agent_messages',
  {
    id: text('id').primaryKey(),
    session_id: text('session_id').notNull(),
    sequence: integer('sequence').notNull(),
    turn_id: text('turn_id'),
    parent_message_id: text('parent_message_id').references((): AnySQLiteColumn => agentMessagesTable.id, {
      onDelete: 'set null'
    }),
    role: text('role').notNull(),
    status: text('status').notNull(),
    semantics_json: text('semantics_json', { mode: 'json' }).$type<Record<string, unknown>>(),
    provider_json: text('provider_json', { mode: 'json' }).$type<Record<string, unknown>>(),
    usage_json: text('usage_json', { mode: 'json' }).$type<Record<string, unknown>>(),
    error_json: text('error_json', { mode: 'json' }).$type<Record<string, unknown>>(),
    finish_json: text('finish_json', { mode: 'json' }).$type<Record<string, unknown>>(),
    created_at: text('created_at').notNull(),
    completed_at: text('completed_at'),
    updated_at: text('updated_at').notNull()
  },
  (table) => [
    uniqueIndex('uq_agent_messages_session_sequence').on(table.session_id, table.sequence),
    uniqueIndex('uq_agent_messages_session_id').on(table.session_id, table.id),
    index('idx_agent_messages_session_status').on(table.session_id, table.status),
    index('idx_agent_messages_turn_id').on(table.turn_id),
    index('idx_agent_messages_parent_message_id').on(table.parent_message_id),
    foreignKey({
      columns: [table.session_id],
      foreignColumns: [sessionsTable.id],
      name: 'fk_agent_messages_session_id'
    }).onDelete('cascade'),
    check('agent_messages_role_check', sql`${table.role} IN ('user', 'assistant', 'system', 'tool')`),
    check(
      'agent_messages_status_check',
      sql`${table.status} IN ('pending', 'streaming', 'completed', 'cancelled', 'failed', 'interrupted')`
    )
  ]
)

export const agentMessagePartsTable = sqliteTable(
  'agent_message_parts',
  {
    id: text('id').primaryKey(),
    session_id: text('session_id').notNull(),
    message_id: text('message_id').notNull(),
    sequence: integer('sequence').notNull(),
    type: text('type').notNull(),
    data_json: text('data_json', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull()
  },
  (table) => [
    uniqueIndex('uq_agent_message_parts_message_sequence').on(table.message_id, table.sequence),
    uniqueIndex('uq_agent_message_parts_message_id').on(table.message_id, table.id),
    index('idx_agent_message_parts_session_message').on(table.session_id, table.message_id),
    index('idx_agent_message_parts_type').on(table.type),
    foreignKey({
      columns: [table.session_id],
      foreignColumns: [sessionsTable.id],
      name: 'fk_agent_message_parts_session_id'
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.session_id, table.message_id],
      foreignColumns: [agentMessagesTable.session_id, agentMessagesTable.id],
      name: 'fk_agent_message_parts_session_message_id'
    }).onDelete('cascade')
  ]
)

export const piSessionsTable = sqliteTable(
  'pi_sessions',
  {
    topic_id: text('topic_id').primaryKey(),
    pi_session_id: text('pi_session_id').notNull(),
    created_at: text('created_at').notNull(),
    active_leaf_id: text('active_leaf_id'),
    metadata_json: text('metadata_json', { mode: 'json' }).$type<Record<string, unknown>>(),
    updated_at: text('updated_at').notNull()
  },
  (table) => [
    uniqueIndex('uq_pi_sessions_pi_session_id').on(table.pi_session_id),
    foreignKey({
      columns: [table.topic_id],
      foreignColumns: [sessionsTable.id],
      name: 'fk_pi_sessions_topic_id'
    }).onDelete('cascade')
  ]
)

export const piSessionEntriesTable = sqliteTable(
  'pi_session_entries',
  {
    topic_id: text('topic_id').notNull(),
    sequence: integer('sequence').notNull(),
    entry_id: text('entry_id').notNull(),
    parent_entry_id: text('parent_entry_id'),
    entry_type: text('entry_type').notNull(),
    entry_json: text('entry_json', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    created_at: text('created_at').notNull()
  },
  (table) => [
    uniqueIndex('uq_pi_session_entries_topic_sequence').on(table.topic_id, table.sequence),
    uniqueIndex('uq_pi_session_entries_topic_entry').on(table.topic_id, table.entry_id),
    index('idx_pi_session_entries_topic_type').on(table.topic_id, table.entry_type),
    index('idx_pi_session_entries_topic_parent').on(table.topic_id, table.parent_entry_id),
    foreignKey({
      columns: [table.topic_id],
      foreignColumns: [piSessionsTable.topic_id],
      name: 'fk_pi_session_entries_topic_id'
    }).onDelete('cascade')
  ]
)

export const piInvocationEntriesTable = sqliteTable(
  'pi_invocation_entries',
  {
    topic_id: text('topic_id').notNull(),
    invocation_id: text('invocation_id').notNull(),
    entry_kind: text('entry_kind').notNull(),
    entry_id: text('entry_id').notNull(),
    created_at: text('created_at').notNull()
  },
  (table) => [
    uniqueIndex('uq_pi_invocation_entries_topic_kind').on(table.topic_id, table.invocation_id, table.entry_kind),
    index('idx_pi_invocation_entries_topic_entry').on(table.topic_id, table.entry_id),
    foreignKey({
      columns: [table.topic_id],
      foreignColumns: [piSessionsTable.topic_id],
      name: 'fk_pi_invocation_entries_topic_id'
    }).onDelete('cascade')
  ]
)

export type AgentMessageRow = typeof agentMessagesTable.$inferSelect
export type InsertAgentMessageRow = typeof agentMessagesTable.$inferInsert
export type AgentMessagePartRow = typeof agentMessagePartsTable.$inferSelect
export type InsertAgentMessagePartRow = typeof agentMessagePartsTable.$inferInsert
export type PiSessionRow = typeof piSessionsTable.$inferSelect
export type PiSessionEntryRow = typeof piSessionEntriesTable.$inferSelect
