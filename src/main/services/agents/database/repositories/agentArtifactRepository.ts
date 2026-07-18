import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'

import { BaseService } from '../../BaseService'
import type { AgentArtifact } from '../../services/claudecode/session-architecture/types'
import { agentArtifactsTable, type AgentArtifactRow, type InsertAgentArtifactRow } from '../schema'

export interface IAgentArtifactRepository {
  save(artifact: AgentArtifact): Promise<AgentArtifact>
  listByTurnId(turnId: string): Promise<AgentArtifact[]>
  listByToolCallId(toolCallId: string): Promise<AgentArtifact[]>
}

class AgentArtifactRepositoryImpl extends BaseService implements IAgentArtifactRepository {
  private static instance: AgentArtifactRepositoryImpl | null = null

  static getInstance(): AgentArtifactRepositoryImpl {
    if (!AgentArtifactRepositoryImpl.instance) {
      AgentArtifactRepositoryImpl.instance = new AgentArtifactRepositoryImpl()
    }
    return AgentArtifactRepositoryImpl.instance
  }

  private deserialize(row: AgentArtifactRow): AgentArtifact {
    return {
      id: row.id,
      topicId: row.topic_id,
      segmentId: row.segment_id,
      turnId: row.turn_id,
      sourceType: row.source_type as AgentArtifact['sourceType'],
      toolSubtype: row.tool_subtype ?? undefined,
      toolCallId: row.tool_call_id ?? undefined,
      filePath: row.file_path ?? undefined,
      uri: row.uri ?? undefined,
      lineStart: row.line_start ?? undefined,
      lineEnd: row.line_end ?? undefined,
      content: row.content,
      contentHash: row.content_hash,
      summary: row.summary ?? undefined,
      createdAt: row.created_at
    }
  }

  async save(artifact: AgentArtifact): Promise<AgentArtifact> {
    const database = await this.getDatabase()
    const insertData: InsertAgentArtifactRow = {
      id: artifact.id || `artifact_${randomUUID()}`,
      topic_id: artifact.topicId,
      segment_id: artifact.segmentId,
      turn_id: artifact.turnId,
      source_type: artifact.sourceType,
      tool_subtype: artifact.toolSubtype,
      tool_call_id: artifact.toolCallId,
      file_path: artifact.filePath,
      uri: artifact.uri,
      line_start: artifact.lineStart,
      line_end: artifact.lineEnd,
      content: artifact.content,
      content_hash: artifact.contentHash,
      summary: artifact.summary,
      created_at: artifact.createdAt || new Date().toISOString()
    }
    const [saved] = await database.insert(agentArtifactsTable).values(insertData).returning()
    return this.deserialize(saved)
  }

  async listByTurnId(turnId: string): Promise<AgentArtifact[]> {
    const database = await this.getDatabase()
    const rows = await database.select().from(agentArtifactsTable).where(eq(agentArtifactsTable.turn_id, turnId))
    return rows.map((row) => this.deserialize(row))
  }

  async listByToolCallId(toolCallId: string): Promise<AgentArtifact[]> {
    const database = await this.getDatabase()
    const rows = await database.select().from(agentArtifactsTable).where(eq(agentArtifactsTable.tool_call_id, toolCallId))
    return rows.map((row) => this.deserialize(row))
  }
}

export const agentArtifactRepository = AgentArtifactRepositoryImpl.getInstance()
