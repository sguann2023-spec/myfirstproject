import { loggerService } from '@logger'
import type { AgentPersistedMessage } from '@types'

import { canonicalEntryToPersisted } from './agentHistoryMapper'
import type { AgentMessageWithParts } from './repositories/agentTranscript.types'
import { agentTranscriptRepository, type IAgentTranscriptRepository } from './repositories/agentTranscriptRepository'
import { agentMessageRepository } from './sessionMessageRepository'
import { recoverPiQuestionHistory } from './recoverPiQuestionHistory'
import { piQuestionHistory, type PiQuestionHistoryReader } from './repositories/piQuestionHistory'
import { mergeLegacyHistory } from './legacyHistoryOrder'

const logger = loggerService.withContext('AgentHistoryService')
const FALLBACK_CURSOR_START = 4_000_000_000_000_000

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
  private readonly fallbackPages = new Map<number, { sessionId: string; ids: string[]; expiresAt: number; base: number }>()
  private nextFallbackCursor = FALLBACK_CURSOR_START

  constructor(
    private readonly transcript: IAgentTranscriptRepository = agentTranscriptRepository,
    private readonly legacy: Pick<typeof agentMessageRepository, 'getSessionHistory'> = agentMessageRepository,
    private readonly piQuestions: PiQuestionHistoryReader = piQuestionHistory
  ) {}

  async getHistory(sessionId: string, options: AgentHistoryOptions = {}): Promise<AgentHistoryPage> {
    let canonical: AgentMessageWithParts[] = []
    try {
      canonical = await this.transcript.listTranscript(sessionId)
    } catch (error) {
      logger.warn('Canonical history read failed; using legacy fallback', { sessionId, error: error as Error })
    }

    let legacy: AgentPersistedMessage[] = []
    try {
      legacy = await this.legacy.getSessionHistory(sessionId)
    } catch (error) {
      if (canonical.length === 0) throw error
      logger.warn('Legacy history read failed; returning canonical history', { sessionId, error: error as Error })
    }

    if (legacy.length && this.transcript.migrateLegacyHistory) {
      try {
        await this.transcript.migrateLegacyHistory(sessionId)
        canonical = await this.transcript.listTranscript(sessionId)
      } catch (error) {
        logger.warn('Session history migration failed; preserving legacy fallback for retry', { sessionId, error: error as Error })
        canonical = await this.transcript.listTranscript(sessionId).catch(() => canonical)
      }
    }
    const legacyIds = new Set(legacy.map(item => item.message.id))
    canonical = canonical.filter(({ message }) =>
      !(message.semantics?.origin === 'legacy_open_migration' && message.semantics?.legacyHistoryComplete !== true && legacyIds.has(message.id)) ||
      message.semantics?.uiVisibility === 'hidden' || message.semantics?.transcriptVisibility === 'hidden')
    const canonicalIds = new Set(canonical.map(({ message }) => message.id))
    const visibleCanonical = canonical.filter(({ message }) =>
      message.semantics?.uiVisibility !== 'hidden' && message.semantics?.transcriptVisibility !== 'hidden'
    )
    const legacyOnly = legacy.filter((item) => {
      const id = String(record(item?.message).id ?? '')
      return id && !canonicalIds.has(id) && record(item?.message).visibility !== 'hidden'
    })
    const canonicalMapped = canonical.map(canonicalEntryToPersisted)
    const visibleIds = new Set([...legacyOnly.map(item => item.message.id), ...visibleCanonical.map(({ message }) => message.id)])
    const ordered = legacy.length ? mergeLegacyHistory(canonicalMapped, legacy) : canonicalMapped
    const needsDisplaySequences = legacyOnly.length > 0 || ordered.some((item, index) => item.message.id !== canonicalMapped[index]?.message.id)
    const after = options.afterSequence ?? -1
    for (const [base, page] of this.fallbackPages) {
      if (page.expiresAt < Date.now()) this.fallbackPages.delete(base)
    }
    let snapshot = after >= FALLBACK_CURSOR_START
      ? [...this.fallbackPages.values()].find(page => page.sessionId === sessionId && after >= page.base && after < page.base + page.ids.length)
      : undefined
    if (after < 0) {
      if (needsDisplaySequences) {
        if (this.fallbackPages.size >= 32) this.fallbackPages.delete(this.fallbackPages.keys().next().value!)
        const base = this.nextFallbackCursor
        this.nextFallbackCursor += ordered.length + 1
        snapshot = { sessionId, ids: ordered.map(item => item.message.id), expiresAt: Date.now() + 5 * 60 * 1000, base }
        this.fallbackPages.set(base, snapshot)
      }
    } else if ((needsDisplaySequences || after >= FALLBACK_CURSOR_START) && !snapshot) {
      throw new Error('History ordering changed; reload from the first page')
    }
    // Preserve slots across deletion and successful retries while paging a fallback.
    const currentById = new Map(ordered.map(item => [item.message.id, item]))
    const merged = snapshot
      ? snapshot.ids.flatMap((id, sequence) => {
        const item = currentById.get(id)
        return item ? [{ ...item, message: { ...item.message, sequence: snapshot!.base + sequence } }] : []
      })
      : needsDisplaySequences
        ? ordered.map((item, sequence) => ({ ...item, message: { ...item.message, sequence } }))
        : ordered

    const eligible = merged.filter((item) => visibleIds.has(item.message.id) && Number(record(item.message).sequence) > after)
    const limit = Math.max(1, Math.min(options.limit ?? (eligible.length || 1), 500))
    let page = eligible.slice(0, limit)
    try {
      page = await recoverPiQuestionHistory(sessionId, page, this.piQuestions)
    } catch (error) {
      logger.warn('PI question recovery failed; returning available history', { sessionId, error: error as Error })
    }
    const sequences = page.map((item) => Number(record(item.message).sequence))
    return {
      messages: page,
      sequences,
      hasMore: eligible.length > page.length,
      nextAfterSequence: sequences.length > 0 ? sequences[sequences.length - 1] : undefined
    }
  }
}

export const agentHistoryService = new AgentHistoryService()
