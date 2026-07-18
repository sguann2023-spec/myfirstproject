import { createHash, randomUUID } from 'node:crypto'

import { agentArtifactRepository } from '../../../database/repositories/agentArtifactRepository'
import type { AgentArtifact } from './types'

export interface SaveArtifactInput extends Omit<AgentArtifact, 'id' | 'createdAt'> {}

export interface ArtifactStoreService {
  save(input: SaveArtifactInput): Promise<AgentArtifact>
  findByToolCallId(toolCallId: string): Promise<AgentArtifact[]>
  listByTurnId(turnId: string): Promise<AgentArtifact[]>
}

export class ArtifactStoreServiceImpl implements ArtifactStoreService {
  async save(input: SaveArtifactInput): Promise<AgentArtifact> {
    return agentArtifactRepository.save({
      id: `artifact_${randomUUID()}`,
      createdAt: new Date().toISOString(),
      ...input
    })
  }

  async findByToolCallId(toolCallId: string): Promise<AgentArtifact[]> {
    return agentArtifactRepository.listByToolCallId(toolCallId)
  }

  async listByTurnId(turnId: string): Promise<AgentArtifact[]> {
    return agentArtifactRepository.listByTurnId(turnId)
  }
}

export const artifactStoreService = new ArtifactStoreServiceImpl()

export function buildArtifactHash(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}
