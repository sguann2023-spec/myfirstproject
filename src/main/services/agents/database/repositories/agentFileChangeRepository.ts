import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'

import { BaseService } from '../../BaseService'
import type { AgentFileChange } from '../../services/claudecode/session-architecture/types'
import { agentFileChangesTable, type AgentFileChangeRow, type InsertAgentFileChangeRow } from '../schema'

export interface IAgentFileChangeRepository {
  save(change: AgentFileChange): Promise<AgentFileChange>
  listByTurnId(turnId: string): Promise<AgentFileChange[]>
}

class AgentFileChangeRepositoryImpl extends BaseService implements IAgentFileChangeRepository {
  private static instance: AgentFileChangeRepositoryImpl | null = null

  static getInstance(): AgentFileChangeRepositoryImpl {
    if (!AgentFileChangeRepositoryImpl.instance) {
      AgentFileChangeRepositoryImpl.instance = new AgentFileChangeRepositoryImpl()
    }
    return AgentFileChangeRepositoryImpl.instance
  }

  private deserialize(row: AgentFileChangeRow): AgentFileChange {
    return {
      id: row.id,
      topicId: row.topic_id,
      segmentId: row.segment_id,
      turnId: row.turn_id,
      messageId: row.message_id ?? undefined,
      toolCallId: row.tool_call_id ?? undefined,
      filePath: row.file_path,
      operation: row.operation as AgentFileChange['operation'],
      beforeSnapshot: row.before_snapshot ?? undefined,
      afterSnapshot: row.after_snapshot ?? undefined,
      patch: row.patch ?? undefined,
      beforeHash: row.before_hash ?? undefined,
      afterHash: row.after_hash ?? undefined,
      createdAt: row.created_at
    }
  }

  async save(change: AgentFileChange): Promise<AgentFileChange> {
    const database = await this.getDatabase()
    const insertData: InsertAgentFileChangeRow = {
      id: change.id || `filechange_${randomUUID()}`,
      topic_id: change.topicId,
      segment_id: change.segmentId,
      turn_id: change.turnId,
      message_id: change.messageId,
      tool_call_id: change.toolCallId,
      file_path: change.filePath,
      operation: change.operation,
      before_snapshot: change.beforeSnapshot,
      after_snapshot: change.afterSnapshot,
      patch: change.patch,
      before_hash: change.beforeHash,
      after_hash: change.afterHash,
      created_at: change.createdAt || new Date().toISOString()
    }
    const [saved] = await database.insert(agentFileChangesTable).values(insertData).returning()
    return this.deserialize(saved)
  }

  async listByTurnId(turnId: string): Promise<AgentFileChange[]> {
    const database = await this.getDatabase()
    const rows = await database.select().from(agentFileChangesTable).where(eq(agentFileChangesTable.turn_id, turnId))
    return rows.map((row) => this.deserialize(row))
  }
}

export const agentFileChangeRepository = AgentFileChangeRepositoryImpl.getInstance()
