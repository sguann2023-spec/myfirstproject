import { randomUUID } from 'node:crypto'

import { and, desc, eq, inArray } from 'drizzle-orm'

import { BaseService } from '../../BaseService'
import type { AgentTurn } from '../../services/claudecode/session-architecture/types'
import { agentTurnsTable, type AgentTurnRow, type InsertAgentTurnRow } from '../schema'

export interface IAgentTurnRepository {
  getById(turnId: string): Promise<AgentTurn | null>
  save(turn: AgentTurn): Promise<AgentTurn>
  update(turnId: string, updates: Partial<AgentTurn>): Promise<void>
  listBySegmentId(segmentId: string, limit?: number): Promise<AgentTurn[]>
}

export function isTurnEligibleForRecentContext(
  turn: Pick<AgentTurn, 'status' | 'userText' | 'assistantText'>
): boolean {
  if (turn.status === 'completed') {
    return true
  }
  if (turn.status !== 'cancelled' && turn.status !== 'failed') {
    return false
  }
  return Boolean(String(turn.userText || '').trim() || String(turn.assistantText || '').trim())
}

class AgentTurnRepositoryImpl extends BaseService implements IAgentTurnRepository {
  private static instance: AgentTurnRepositoryImpl | null = null

  static getInstance(): AgentTurnRepositoryImpl {
    if (!AgentTurnRepositoryImpl.instance) {
      AgentTurnRepositoryImpl.instance = new AgentTurnRepositoryImpl()
    }
    return AgentTurnRepositoryImpl.instance
  }

  private deserialize(row: AgentTurnRow | undefined): AgentTurn | null {
    if (!row) return null
    return {
      id: row.id,
      topicId: row.topic_id,
      segmentId: row.segment_id,
      traceId: row.trace_id ?? undefined,
      userMessageId: row.user_message_id,
      assistantMessageId: row.assistant_message_id ?? undefined,
      userText: row.user_text ?? undefined,
      assistantText: row.assistant_text ?? undefined,
      cumulativeInputTokens: row.cumulative_input_tokens,
      startedAt: row.started_at,
      completedAt: row.completed_at ?? undefined,
      status: row.status as AgentTurn['status']
    }
  }

  async getById(turnId: string): Promise<AgentTurn | null> {
    const database = await this.getDatabase()
    const rows = await database.select().from(agentTurnsTable).where(eq(agentTurnsTable.id, turnId)).limit(1)
    return this.deserialize(rows[0])
  }

  async save(turn: AgentTurn): Promise<AgentTurn> {
    const database = await this.getDatabase()
    const insertData: InsertAgentTurnRow = {
      id: turn.id || `turn_${randomUUID()}`,
      topic_id: turn.topicId,
      segment_id: turn.segmentId,
      trace_id: turn.traceId,
      user_message_id: turn.userMessageId || '',
      assistant_message_id: turn.assistantMessageId,
      user_text: turn.userText,
      assistant_text: turn.assistantText,
      cumulative_input_tokens: turn.cumulativeInputTokens ?? 0,
      started_at: turn.startedAt,
      completed_at: turn.completedAt,
      status: turn.status
    }
    const [saved] = await database.insert(agentTurnsTable).values(insertData).returning()
    return this.deserialize(saved)!
  }

  async update(turnId: string, updates: Partial<AgentTurn>): Promise<void> {
    const database = await this.getDatabase()
    await database
      .update(agentTurnsTable)
      .set({
        segment_id: updates.segmentId,
        trace_id: updates.traceId,
        user_message_id: updates.userMessageId,
        assistant_message_id: updates.assistantMessageId,
        user_text: updates.userText,
        assistant_text: updates.assistantText,
        cumulative_input_tokens: updates.cumulativeInputTokens,
        completed_at: updates.completedAt,
        status: updates.status
      })
      .where(eq(agentTurnsTable.id, turnId))
  }

  async listBySegmentId(segmentId: string, limit = 4): Promise<AgentTurn[]> {
    const database = await this.getDatabase()
    const rows = await database
      .select()
      .from(agentTurnsTable)
      .where(and(eq(agentTurnsTable.segment_id, segmentId), inArray(agentTurnsTable.status, ['completed', 'cancelled', 'failed'])))
      .orderBy(desc(agentTurnsTable.started_at))
    return rows
      .map((row) => this.deserialize(row)!)
      .filter(isTurnEligibleForRecentContext)
      .reverse()
      .slice(-limit)
  }
}

export const agentTurnRepository = AgentTurnRepositoryImpl.getInstance()
