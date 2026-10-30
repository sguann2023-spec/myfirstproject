import { loggerService } from '@logger'
import type { AgentPersistedMessage } from '@types'

import { canonicalEntryToPersisted } from './agentHistoryMapper'
import type { AgentMessageWithParts } from './repositories/agentTranscript.types'
import { agentTranscriptRepository, type IAgentTranscriptRepository } from './repositories/agentTranscriptRepository'
import { agentMessageRepository } from './sessionMessageRepository'

const logger = loggerService.withContext('AgentHistoryService')

export interface AgentHistoryPage {
  messages: AgentPersistedMessage[]
  sequences: number[]
  hasMore: boolean
  nextAfterSequence?: number
}

export interface AgentHistoryOptions {
  afterSequence?: number
  limit?: number
}

const record = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {}

export class AgentHistoryService {
  constructor(
    private readonly transcript: IAgentTranscriptRepository = agentTranscriptRepository,
    private readonly legacy: Pick<typeof agentMessageRepository, 'getSessionHistory'> = agentMessageRepository
  ) {}

  async getHistory(sessionId: string, options: AgentHistoryOptions = {}): Promise<AgentHistoryPage> {
    const startedAt = Date.now()
    logger.info('History load started', { sessionId })
    let canonical: AgentMessageWithParts[] = []
    try {
      canonical = await this.transcript.listTranscript(sessionId)
    } catch (error) {
      logger.warn('Canonical history read failed; using legacy fallback', { sessionId, error: error as Error })
    }

    const canonicalIds = new Set(canonical.map(({ message }) => message.id))
    const visibleCanonical = canonical.filter(({ message }) =>
      message.semantics?.uiVisibility !== 'hidden' && message.semantics?.transcriptVisibility !== 'hidden'
    )
    let legacy: AgentPersistedMessage[] = []
    try {
      legacy = await this.legacy.getSessionHistory(sessionId)
    } catch (error) {
      if (visibleCanonical.length === 0) throw error
      logger.warn('Legacy history read failed; returning canonical history', { sessionId, error: error as Error })
    }

    const legacyOnly = legacy.filter((item) => {
      const id = String(record(item?.message).id ?? '')
      return id && !canonicalIds.has(id) && record(item?.message).visibility !== 'hidden'
    })
    const canonicalMapped = visibleCanonical.map(canonicalEntryToPersisted)
    const sortedLegacyOnly = legacyOnly.sort((left, right) => {
      const leftMessage = record(left.message)
      const rightMessage = record(right.message)
      const leftSequence = Number.isFinite(leftMessage.sequence) ? Number(leftMessage.sequence) : Number.MAX_SAFE_INTEGER
      const rightSequence = Number.isFinite(rightMessage.sequence) ? Number(rightMessage.sequence) : Number.MAX_SAFE_INTEGER
      if (leftSequence !== rightSequence) return leftSequence - rightSequence
      const time = String(leftMessage.createdAt ?? '').localeCompare(String(rightMessage.createdAt ?? ''))
      return time || String(leftMessage.id ?? '').localeCompare(String(rightMessage.id ?? ''))
    })
    const lastCanonicalSequence = canonical.reduce((maximum, entry) => Math.max(maximum, entry.message.sequence), -1)
    const sequencedLegacyOnly = sortedLegacyOnly.map((item, index) => ({
      ...item,
      message: { ...item.message, sequence: lastCanonicalSequence + index + 1 }
    }))
    const merged = [...canonicalMapped, ...sequencedLegacyOnly]

    const after = options.afterSequence ?? -1
    const eligible = merged.filter((item) => Number(record(item.message).sequence) > after)
    const limit = Math.max(1, Math.min(options.limit ?? (eligible.length || 1), 500))
    const page = eligible.slice(0, limit)
    const sequences = page.map((item) => Number(record(item.message).sequence))
    logger.info('History load completed', { sessionId, elapsedMs: Date.now() - startedAt, messages: page.length })
    return {
      messages: page,
      sequences,
      hasMore: eligible.length > page.length,
      nextAfterSequence: sequences.length > 0 ? sequences[sequences.length - 1] : undefined
    }
  }
}

export const agentHistoryService = new AgentHistoryService()
