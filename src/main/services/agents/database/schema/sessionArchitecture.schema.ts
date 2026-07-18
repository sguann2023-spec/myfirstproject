import { foreignKey, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { sessionsTable } from './sessions.schema'

export const agentConversationSegmentsTable = sqliteTable('agent_conversation_segments', {
  id: text('id').primaryKey(),
  topic_id: text('topic_id').notNull(),
  sdk_session_id: text('sdk_session_id').notNull().default(''),
  parent_segment_id: text('parent_segment_id'),
  fork_from_sdk_session_id: text('fork_from_sdk_session_id'),
  system_prompt_version: text('system_prompt_version').notNull(),
  system_prompt_hash: text('system_prompt_hash').notNull(),
  base_prompt_snapshot: text('base_prompt_snapshot'),
  raw_summary: text('raw_summary'),
  continuation_summary: text('continuation_summary'),
  compact_reason: text('compact_reason'),
  summary_version: text('summary_version'),
  start_message_id: text('start_message_id'),
  end_message_id: text('end_message_id'),
  status: text('status').notNull(),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull()
})

export const agentConversationSegmentsTopicIdx = index('idx_agent_conversation_segments_topic_id').on(
  agentConversationSegmentsTable.topic_id
)
export const agentConversationSegmentsStatusIdx = index('idx_agent_conversation_segments_status').on(
  agentConversationSegmentsTable.status
)
export const agentConversationSegmentsSdkSessionIdx = index('idx_agent_conversation_segments_sdk_session_id').on(
  agentConversationSegmentsTable.sdk_session_id
)

export const agentConversationSegmentsTopicFk = foreignKey({
  columns: [agentConversationSegmentsTable.topic_id],
  foreignColumns: [sessionsTable.id],
  name: 'fk_agent_conversation_segments_topic_id'
}).onDelete('cascade')

export const agentConversationSegmentsParentFk = foreignKey({
  columns: [agentConversationSegmentsTable.parent_segment_id],
  foreignColumns: [agentConversationSegmentsTable.id],
  name: 'fk_agent_conversation_segments_parent_segment_id'
}).onDelete('set null')

export const agentTurnsTable = sqliteTable('agent_turns', {
  id: text('id').primaryKey(),
  topic_id: text('topic_id').notNull(),
  segment_id: text('segment_id').notNull(),
  trace_id: text('trace_id'),
  user_message_id: text('user_message_id').notNull().default(''),
  assistant_message_id: text('assistant_message_id'),
  user_text: text('user_text'),
  assistant_text: text('assistant_text'),
  cumulative_input_tokens: integer('cumulative_input_tokens').notNull().default(0),
  started_at: text('started_at').notNull(),
  completed_at: text('completed_at'),
  status: text('status').notNull()
})

export const agentTurnsTopicIdx = index('idx_agent_turns_topic_id').on(agentTurnsTable.topic_id)
export const agentTurnsSegmentIdx = index('idx_agent_turns_segment_id').on(agentTurnsTable.segment_id)
export const agentTurnsStartedAtIdx = index('idx_agent_turns_started_at').on(agentTurnsTable.started_at)

export const agentTurnsTopicFk = foreignKey({
  columns: [agentTurnsTable.topic_id],
  foreignColumns: [sessionsTable.id],
  name: 'fk_agent_turns_topic_id'
}).onDelete('cascade')

export const agentTurnsSegmentFk = foreignKey({
  columns: [agentTurnsTable.segment_id],
  foreignColumns: [agentConversationSegmentsTable.id],
  name: 'fk_agent_turns_segment_id'
}).onDelete('cascade')

export const agentArtifactsTable = sqliteTable('agent_artifacts', {
  id: text('id').primaryKey(),
  topic_id: text('topic_id').notNull(),
  segment_id: text('segment_id').notNull(),
  turn_id: text('turn_id').notNull(),
  source_type: text('source_type').notNull(),
  tool_subtype: text('tool_subtype'),
  tool_call_id: text('tool_call_id'),
  file_path: text('file_path'),
  uri: text('uri'),
  line_start: integer('line_start'),
  line_end: integer('line_end'),
  content: text('content').notNull(),
  content_hash: text('content_hash').notNull(),
  summary: text('summary'),
  created_at: text('created_at').notNull()
})

export const agentArtifactsTopicIdx = index('idx_agent_artifacts_topic_id').on(agentArtifactsTable.topic_id)
export const agentArtifactsTurnIdx = index('idx_agent_artifacts_turn_id').on(agentArtifactsTable.turn_id)
export const agentArtifactsToolCallIdx = index('idx_agent_artifacts_tool_call_id').on(agentArtifactsTable.tool_call_id)

export const agentArtifactsTopicFk = foreignKey({
  columns: [agentArtifactsTable.topic_id],
  foreignColumns: [sessionsTable.id],
  name: 'fk_agent_artifacts_topic_id'
}).onDelete('cascade')

export const agentArtifactsSegmentFk = foreignKey({
  columns: [agentArtifactsTable.segment_id],
  foreignColumns: [agentConversationSegmentsTable.id],
  name: 'fk_agent_artifacts_segment_id'
}).onDelete('cascade')

export const agentArtifactsTurnFk = foreignKey({
  columns: [agentArtifactsTable.turn_id],
  foreignColumns: [agentTurnsTable.id],
  name: 'fk_agent_artifacts_turn_id'
}).onDelete('cascade')

export const agentFileChangesTable = sqliteTable('agent_file_changes', {
  id: text('id').primaryKey(),
  topic_id: text('topic_id').notNull(),
  segment_id: text('segment_id').notNull(),
  turn_id: text('turn_id').notNull(),
  message_id: text('message_id'),
  tool_call_id: text('tool_call_id'),
  file_path: text('file_path').notNull(),
  operation: text('operation').notNull(),
  before_snapshot: text('before_snapshot'),
  after_snapshot: text('after_snapshot'),
  patch: text('patch'),
  before_hash: text('before_hash'),
  after_hash: text('after_hash'),
  created_at: text('created_at').notNull()
})

export const agentFileChangesTopicIdx = index('idx_agent_file_changes_topic_id').on(agentFileChangesTable.topic_id)
export const agentFileChangesTurnIdx = index('idx_agent_file_changes_turn_id').on(agentFileChangesTable.turn_id)
export const agentFileChangesPathIdx = index('idx_agent_file_changes_file_path').on(agentFileChangesTable.file_path)

export const agentFileChangesTopicFk = foreignKey({
  columns: [agentFileChangesTable.topic_id],
  foreignColumns: [sessionsTable.id],
  name: 'fk_agent_file_changes_topic_id'
}).onDelete('cascade')

export const agentFileChangesSegmentFk = foreignKey({
  columns: [agentFileChangesTable.segment_id],
  foreignColumns: [agentConversationSegmentsTable.id],
  name: 'fk_agent_file_changes_segment_id'
}).onDelete('cascade')

export const agentFileChangesTurnFk = foreignKey({
  columns: [agentFileChangesTable.turn_id],
  foreignColumns: [agentTurnsTable.id],
  name: 'fk_agent_file_changes_turn_id'
}).onDelete('cascade')

export type AgentConversationSegmentRow = typeof agentConversationSegmentsTable.$inferSelect
export type InsertAgentConversationSegmentRow = typeof agentConversationSegmentsTable.$inferInsert

export type AgentTurnRow = typeof agentTurnsTable.$inferSelect
export type InsertAgentTurnRow = typeof agentTurnsTable.$inferInsert

export type AgentArtifactRow = typeof agentArtifactsTable.$inferSelect
export type InsertAgentArtifactRow = typeof agentArtifactsTable.$inferInsert

export type AgentFileChangeRow = typeof agentFileChangesTable.$inferSelect
export type InsertAgentFileChangeRow = typeof agentFileChangesTable.$inferInsert
