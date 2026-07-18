import { randomUUID } from 'node:crypto'

import { loggerService } from '@logger'
import { and, desc, eq } from 'drizzle-orm'

import { BaseService } from '../../BaseService'
import {
  agentConversationSegmentsTable,
  type AgentConversationSegmentRow,
  type InsertAgentConversationSegmentRow
} from '../schema'
import type { AgentConversationSegment } from '../../services/claudecode/session-architecture/types'

const logger = loggerService.withContext('AgentConversationSegmentRepository')

export interface IAgentConversationSegmentRepository {
  getActiveByTopicId(topicId: string): Promise<AgentConversationSegment | null>
  getBySdkSessionId(sdkSessionId: string): Promise<AgentConversationSegment | null>
  save(segment: AgentConversationSegment): Promise<AgentConversationSegment>
  update(segmentId: string, updates: Partial<AgentConversationSegment>): Promise<void>
}

class AgentConversationSegmentRepositoryImpl extends BaseService implements IAgentConversationSegmentRepository {
  private static instance: AgentConversationSegmentRepositoryImpl | null = null

  static getInstance(): AgentConversationSegmentRepositoryImpl {
    if (!AgentConversationSegmentRepositoryImpl.instance) {
      AgentConversationSegmentRepositoryImpl.instance = new AgentConversationSegmentRepositoryImpl()
    }
    return AgentConversationSegmentRepositoryImpl.instance
  }

  private deserialize(row: AgentConversationSegmentRow | undefined): AgentConversationSegment | null {
    if (!row) return null
    return {
      id: row.id,
      topicId: row.topic_id,
      sdkSessionId: row.sdk_session_id,
      parentSegmentId: row.parent_segment_id ?? undefined,
      forkFromSdkSessionId: row.fork_from_sdk_session_id ?? undefined,
      systemPromptVersion: row.system_prompt_version,
      systemPromptHash: row.system_prompt_hash,
      basePromptSnapshot: row.base_prompt_snapshot ?? undefined,
      rawSummary: row.raw_summary ?? undefined,
      continuationSummary: row.continuation_summary ?? undefined,
      compactReason: row.compact_reason ?? undefined,
      summaryVersion: row.summary_version ?? undefined,
      startMessageId: row.start_message_id ?? undefined,
      endMessageId: row.end_message_id ?? undefined,
      status: row.status as AgentConversationSegment['status'],
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  async getActiveByTopicId(topicId: string): Promise<AgentConversationSegment | null> {
    const database = await this.getDatabase()
    const rows = await database
      .select()
      .from(agentConversationSegmentsTable)
      .where(and(eq(agentConversationSegmentsTable.topic_id, topicId), eq(agentConversationSegmentsTable.status, 'active')))
      .orderBy(desc(agentConversationSegmentsTable.updated_at))
      .limit(1)
    return this.deserialize(rows[0])
  }

  async getBySdkSessionId(sdkSessionId: string): Promise<AgentConversationSegment | null> {
    if (!sdkSessionId) return null
    const database = await this.getDatabase()
    const rows = await database
      .select()
      .from(agentConversationSegmentsTable)
      .where(eq(agentConversationSegmentsTable.sdk_session_id, sdkSessionId))
      .limit(1)
    return this.deserialize(rows[0])
  }

  async save(segment: AgentConversationSegment): Promise<AgentConversationSegment> {
    const database = await this.getDatabase()
    const now = segment.updatedAt || new Date().toISOString()
    const insertData: InsertAgentConversationSegmentRow = {
      id: segment.id || `seg_${randomUUID()}`,
      topic_id: segment.topicId,
      sdk_session_id: segment.sdkSessionId || '',
      parent_segment_id: segment.parentSegmentId,
      fork_from_sdk_session_id: segment.forkFromSdkSessionId,
      system_prompt_version: segment.systemPromptVersion,
      system_prompt_hash: segment.systemPromptHash,
      base_prompt_snapshot: segment.basePromptSnapshot,
      raw_summary: segment.rawSummary,
      continuation_summary: segment.continuationSummary,
      compact_reason: segment.compactReason,
      summary_version: segment.summaryVersion,
      start_message_id: segment.startMessageId,
      end_message_id: segment.endMessageId,
      status: segment.status,
      created_at: segment.createdAt || now,
      updated_at: now
    }
    const [saved] = await database.insert(agentConversationSegmentsTable).values(insertData).returning()
    logger.info('[SegmentRepo] saved', { topicId: segment.topicId, segmentId: insertData.id, status: segment.status })
    return this.deserialize(saved)!
  }

  async update(segmentId: string, updates: Partial<AgentConversationSegment>): Promise<void> {
    const database = await this.getDatabase()
    await database
      .update(agentConversationSegmentsTable)
      .set({
        sdk_session_id: updates.sdkSessionId,
        parent_segment_id: updates.parentSegmentId,
        fork_from_sdk_session_id: updates.forkFromSdkSessionId,
        system_prompt_version: updates.systemPromptVersion,
        system_prompt_hash: updates.systemPromptHash,
        base_prompt_snapshot: updates.basePromptSnapshot,
        raw_summary: updates.rawSummary,
        continuation_summary: updates.continuationSummary,
        compact_reason: updates.compactReason,
        summary_version: updates.summaryVersion,
        start_message_id: updates.startMessageId,
        end_message_id: updates.endMessageId,
        status: updates.status,
        updated_at: updates.updatedAt ?? new Date().toISOString()
      })
      .where(eq(agentConversationSegmentsTable.id, segmentId))
  }
}

export const agentConversationSegmentRepository = AgentConversationSegmentRepositoryImpl.getInstance()
