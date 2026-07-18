import { randomUUID } from 'node:crypto'

import { agentConversationSegmentRepository } from '../../../database/repositories/agentConversationSegmentRepository'
import type { AgentConversationSegment } from './types'

export interface CreateSegmentInput {
  topicId: string
  sdkSessionId?: string
  parentSegmentId?: string
  forkFromSdkSessionId?: string
  systemPromptVersion: string
  systemPromptHash: string
  basePromptSnapshot?: string
  rawSummary?: string
  continuationSummary?: string
  compactReason?: string
  summaryVersion?: string
}

export interface ConversationSegmentService {
  getActiveSegment(topicId: string): Promise<AgentConversationSegment | null>
  createRootSegment(input: CreateSegmentInput): Promise<AgentConversationSegment>
  createChildSegment(input: CreateSegmentInput): Promise<AgentConversationSegment>
  bindSdkSession(segmentId: string, sdkSessionId: string): Promise<void>
  markSegmentCompacted(segmentId: string, updates: Partial<AgentConversationSegment>): Promise<void>
  closeSegment(segmentId: string): Promise<void>
}

export class ConversationSegmentServiceImpl implements ConversationSegmentService {
  async getActiveSegment(topicId: string): Promise<AgentConversationSegment | null> {
    return agentConversationSegmentRepository.getActiveByTopicId(topicId)
  }

  async createRootSegment(input: CreateSegmentInput): Promise<AgentConversationSegment> {
    const now = new Date().toISOString()
    return agentConversationSegmentRepository.save({
      id: `seg_${randomUUID()}`,
      topicId: input.topicId,
      sdkSessionId: input.sdkSessionId || '',
      parentSegmentId: input.parentSegmentId,
      forkFromSdkSessionId: input.forkFromSdkSessionId,
      systemPromptVersion: input.systemPromptVersion,
      systemPromptHash: input.systemPromptHash,
      basePromptSnapshot: input.basePromptSnapshot,
      rawSummary: input.rawSummary,
      continuationSummary: input.continuationSummary,
      compactReason: input.compactReason,
      summaryVersion: input.summaryVersion,
      status: 'active',
      createdAt: now,
      updatedAt: now
    })
  }

  async createChildSegment(input: CreateSegmentInput): Promise<AgentConversationSegment> {
    return this.createRootSegment(input)
  }

  async bindSdkSession(segmentId: string, sdkSessionId: string): Promise<void> {
    await agentConversationSegmentRepository.update(segmentId, {
      sdkSessionId,
      updatedAt: new Date().toISOString()
    })
  }

  async markSegmentCompacted(segmentId: string, updates: Partial<AgentConversationSegment>): Promise<void> {
    await agentConversationSegmentRepository.update(segmentId, {
      ...updates,
      status: 'compacted',
      updatedAt: new Date().toISOString()
    })
  }

  async closeSegment(segmentId: string): Promise<void> {
    await agentConversationSegmentRepository.update(segmentId, {
      status: 'closed',
      updatedAt: new Date().toISOString()
    })
  }
}

export const conversationSegmentService = new ConversationSegmentServiceImpl()
