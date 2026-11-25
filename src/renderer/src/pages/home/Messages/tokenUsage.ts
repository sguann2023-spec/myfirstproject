import type { Message } from '@renderer/types/newMessage'
import { getReversePromptAccounting, isReversePromptToolName } from '../../../../../shared/reversePrompt'

export type MessageUsageWithCacheDetails = Partial<NonNullable<Message['usage']>>

/** Structural input shared by persisted session messages and renderer Redux messages. */
export type TokenUsageMessage = {
  id?: string
  storeAssistantMessageId?: string | null
  role?: string
  usage?: MessageUsageWithCacheDetails | null
  usageSteps?: readonly MessageUsageWithCacheDetails[] | null
  metrics?: Partial<NonNullable<Message['metrics']>> | null
  blocks?: readonly unknown[] | null
  model?: Message['model']
  status?: string
  error?: unknown
  aborted?: boolean
}

export type TokenUsageBlock = {
  id?: string
  type?: string
  toolName?: string
  metadata?: {
    rawMcpToolResponse?: {
      tool?: { name?: string }
      toolName?: string
      response?: unknown
      responseRaw?: unknown
    }
  }
}

export type TokenUsageBlocksById = Readonly<Record<string, TokenUsageBlock | undefined>>
export type LiveTokenMessagesById = Readonly<Record<string, TokenUsageMessage | undefined>>

type BillingRecord = Record<string, unknown>

const asRecord = (value: unknown): BillingRecord | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as BillingRecord) : null

const asFiniteNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

const asTokenCount = (value: unknown): number | null => {
  const number = asFiniteNumber(value)
  return number !== null && number >= 0 ? number : null
}

// Shared with MessageTokens: keep tool billing parsing and charging separate from token totals.
export function extractBillingPointsFromPayload(
  payload: unknown,
  visited = new WeakSet<object>(),
  depth = 0
): number | null {
  if (depth >= 64) return null

  if (typeof payload === 'string' && payload.trim()) {
    try {
      return extractBillingPointsFromPayload(JSON.parse(payload), visited, depth + 1)
    } catch {
      return null
    }
  }

  const record = asRecord(payload)
  if (!record || visited.has(record)) return null
  visited.add(record)

  const nestedBilling = asRecord(record.billing)
  if (nestedBilling) {
    return asFiniteNumber(
      nestedBilling.total_consumed_points ??
        nestedBilling.points_consumed ??
        nestedBilling.deduct_points ??
        nestedBilling.consume
    )
  }

  if ('total_consumed_points' in record) {
    return asFiniteNumber(record.total_consumed_points)
  }

  if ('points_consumed' in record) {
    return asFiniteNumber(record.points_consumed)
  }

  if ('deduct_points' in record) {
    return asFiniteNumber(record.deduct_points)
  }

  if ('consume' in record) {
    return asFiniteNumber(record.consume)
  }

  if ('responseRaw' in record) {
    const nestedResponseRawPoints = extractBillingPointsFromPayload(record.responseRaw, visited, depth + 1)
    if (nestedResponseRawPoints !== null) {
      return nestedResponseRawPoints
    }
  }

  if ('response' in record) {
    const nestedResponsePoints = extractBillingPointsFromPayload(record.response, visited, depth + 1)
    if (nestedResponsePoints !== null) {
      return nestedResponsePoints
    }
  }

  if ('output' in record) {
    const nestedOutputPoints = extractBillingPointsFromPayload(record.output, visited, depth + 1)
    if (nestedOutputPoints !== null) {
      return nestedOutputPoints
    }
  }

  if ('result' in record) {
    const nestedResultPoints = extractBillingPointsFromPayload(record.result, visited, depth + 1)
    if (nestedResultPoints !== null) {
      return nestedResultPoints
    }
  }

  // Only traverse actual content; serializing plain objects would recurse forever.
  const content = Array.isArray(record.content) ? record.content : []
  for (const value of content) {
    const item = asRecord(value)
    if (item?.type !== 'text' || typeof item.text !== 'string' || !item.text.trim()) continue

    const nestedPoints = extractBillingPointsFromPayload(item.text, visited, depth + 1)
    if (nestedPoints !== null) {
      return nestedPoints
    }
  }

  return null
}

export function extractBillingPointsFromToolResponse(toolResponse: unknown): number {
  const record = asRecord(toolResponse)
  return extractBillingPointsFromPayload(record?.responseRaw ?? record?.response ?? toolResponse) ?? 0
}

export function resolveTokenUsageBlock(
  blockRef: unknown,
  blocksById: TokenUsageBlocksById = {}
): TokenUsageBlock | null {
  if (typeof blockRef === 'string') return blocksById[blockRef] ?? null
  const inlineBlock = asRecord(blockRef) as TokenUsageBlock | null
  if (!inlineBlock) return null
  return (inlineBlock.id && blocksById[inlineBlock.id]) || inlineBlock
}

/** Missing live accounting must not erase persisted accounting, including explicit zero usage. */
export function mergeLiveTokenMessage<T extends TokenUsageMessage>(
  message: T,
  live?: TokenUsageMessage
): T & TokenUsageMessage {
  if (!live) return message
  return {
    ...message,
    ...live,
    usage: live.usage ?? message.usage,
    usageSteps: live.usageSteps?.length ? live.usageSteps : message.usageSteps,
    metrics: live.metrics ?? message.metrics,
    blocks: live.blocks ?? message.blocks,
    model: live.model ?? message.model
  }
}

export function getUsageSteps(message: TokenUsageMessage): readonly MessageUsageWithCacheDetails[] {
  return Array.isArray(message.usageSteps) && message.usageSteps.length > 0 ? message.usageSteps : []
}

export function getCacheInputTokens(usage?: MessageUsageWithCacheDetails | null) {
  const cacheReadTokens =
    Number(
      usage?.cache_read_input_tokens ??
        usage?.prompt_tokens_details?.cached_tokens ??
        usage?.input_tokens_details?.cached_tokens ??
        0
    ) || 0
  const cacheWriteTokens =
    Number(
      usage?.cache_creation_input_tokens ??
        usage?.prompt_tokens_details?.cache_creation_input_tokens ??
        usage?.prompt_tokens_details?.cache_write_tokens ??
        usage?.input_tokens_details?.cache_creation_input_tokens ??
        usage?.input_tokens_details?.cache_write_tokens ??
        0
    ) || 0

  return { cacheReadTokens, cacheWriteTokens }
}

export type MessagePricingWithPreciseFields = NonNullable<Message['model']>['pricing'] & {
  input_resource_points_per_unit?: number
  output_resource_points_per_unit?: number
  precise_input_resource_points_per_unit?: number
  precise_output_resource_points_per_unit?: number
  precise_uncached_input_resource_points_per_unit?: number
  precise_cache_read_resource_points_per_unit?: number
  precise_cache_write_resource_points_per_unit?: number
}

export const isThirdPartyBillingModel = (model?: TokenUsageMessage['model']) =>
  Boolean(model?.provider?.startsWith('custom-') || model?.id?.startsWith('custom-'))

/** Platform points only; external-provider API charges are not part of this estimate. */
export function getConversationUsagePoints(model: TokenUsageMessage['model'], usage?: MessageUsageWithCacheDetails) {
  if (isThirdPartyBillingModel(model)) return 0
  const pricing = model?.pricing as MessagePricingWithPreciseFields | undefined
  const input = Number(usage?.prompt_tokens ?? 0) || 0
  const output = Number(usage?.completion_tokens ?? 0) || 0
  const { cacheReadTokens, cacheWriteTokens } = getCacheInputTokens(usage)
  const uncachedRate = Number(pricing?.precise_uncached_input_resource_points_per_unit ?? pricing?.precise_input_resource_points_per_unit ?? 0) || 0
  const cacheReadRate = Number(pricing?.precise_cache_read_resource_points_per_unit ?? 0) || 0
  const cacheWriteRate = Number(pricing?.precise_cache_write_resource_points_per_unit ?? 0) || 0
  const outputRate = Number(pricing?.precise_output_resource_points_per_unit ?? pricing?.output_per_million_tokens ?? 0) || 0
  if (uncachedRate > 0 || cacheReadRate > 0 || cacheWriteRate > 0 || outputRate > 0) {
    return (Math.max(0, input - cacheReadTokens - cacheWriteTokens) * uncachedRate +
      cacheReadTokens * cacheReadRate + cacheWriteTokens * cacheWriteRate + output * outputRate) / 1_000_000
  }
  const inputRate = Number(pricing?.input_resource_points_per_unit ?? pricing?.input_per_million_tokens ?? 0) || 0
  const legacyOutputRate = Number(pricing?.output_resource_points_per_unit ?? pricing?.output_per_million_tokens ?? 0) || 0
  return (input * inputRate + output * legacyOutputRate) / 1000
}

export function getConversationUsageSavingPoints(model: TokenUsageMessage['model'], usage?: MessageUsageWithCacheDetails) {
  if (isThirdPartyBillingModel(model)) return 0
  const pricing = model?.pricing as MessagePricingWithPreciseFields | undefined
  const { cacheReadTokens } = getCacheInputTokens(usage)
  if (cacheReadTokens <= 0) return 0
  const uncachedRate = Number(pricing?.precise_uncached_input_resource_points_per_unit ?? pricing?.precise_input_resource_points_per_unit ?? 0) || 0
  const cacheReadRate = Number(pricing?.precise_cache_read_resource_points_per_unit ?? 0) || 0
  if (uncachedRate > 0 && cacheReadRate < uncachedRate) {
    return (cacheReadTokens * (uncachedRate - cacheReadRate)) / 1_000_000
  }
  return 0
}

export function getMessageConversationPoints(message: TokenUsageMessage) {
  const steps = getUsageSteps(message)
  return steps.length > 0
    ? steps.reduce((total, usage) => total + getConversationUsagePoints(message.model, usage), 0)
    : getConversationUsagePoints(message.model, getDisplayUsage(message))
}

export function getMessageConversationSavingPoints(message: TokenUsageMessage) {
  const steps = getUsageSteps(message)
  return steps.length > 0
    ? steps.reduce((total, usage) => total + getConversationUsageSavingPoints(message.model, usage), 0)
    : getConversationUsageSavingPoints(message.model, getDisplayUsage(message))
}

/** Message-row normalization: steps replace (never add to) the final usage. */
export function getDisplayUsage(message: TokenUsageMessage): MessageUsageWithCacheDetails | undefined {
  const directUsage = message.usage
  const usageSteps = getUsageSteps(message)

  if (usageSteps.length > 0) {
    return usageSteps.reduce(
      (total, usage) => {
        const promptTokens = Number(usage?.prompt_tokens ?? 0) || 0
        const completionTokens = Number(usage?.completion_tokens ?? 0) || 0
        const totalTokens = Number(usage?.total_tokens ?? promptTokens + completionTokens) || 0
        const { cacheReadTokens, cacheWriteTokens } = getCacheInputTokens(usage)
        total.prompt_tokens += promptTokens
        total.completion_tokens += completionTokens
        total.total_tokens += totalTokens
        total.cache_read_input_tokens += cacheReadTokens
        total.cache_creation_input_tokens += cacheWriteTokens
        return total
      },
      {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        prompt_tokens_details: { cached_tokens: 0, cache_creation_input_tokens: 0, cache_write_tokens: 0 },
        input_tokens_details: { cached_tokens: 0, cache_creation_input_tokens: 0, cache_write_tokens: 0 }
      }
    )
  }

  if (!directUsage) return undefined
  const { cacheReadTokens, cacheWriteTokens } = getCacheInputTokens(directUsage)
  const promptTokens = Number(directUsage.prompt_tokens ?? 0) || 0
  const completionTokens = Number(directUsage.completion_tokens ?? 0) || 0
  return {
    ...directUsage,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: Number(directUsage.total_tokens ?? promptTokens + completionTokens) || 0,
    cache_read_input_tokens: cacheReadTokens,
    cache_creation_input_tokens: cacheWriteTokens,
    prompt_tokens_details: {
      ...directUsage.prompt_tokens_details,
      cached_tokens: cacheReadTokens,
      cache_creation_input_tokens: cacheWriteTokens,
      cache_write_tokens: cacheWriteTokens
    },
    input_tokens_details: {
      ...directUsage.input_tokens_details,
      cached_tokens: cacheReadTokens,
      cache_creation_input_tokens: cacheWriteTokens,
      cache_write_tokens: cacheWriteTokens
    }
  }
}

function inspectUsage(usage?: MessageUsageWithCacheDetails | null) {
  const prompt = asTokenCount(usage?.prompt_tokens)
  const completion = asTokenCount(usage?.completion_tokens)
  const total = asTokenCount(usage?.total_tokens)
  return {
    hasReportedUsage: prompt !== null || completion !== null || total !== null,
    incomplete: prompt === null || completion === null || (usage?.total_tokens != null && total === null)
  }
}

/** Tokens are display-only: tool cost is already included in the existing tool billing. */
export function getInternalToolUsage(message: TokenUsageMessage, blocksById: TokenUsageBlocksById = {}) {
  const total = {
    prompt_tokens: 0, completion_tokens: 0, total_tokens: 0,
    cacheReadTokens: 0, cacheWriteTokens: 0,
    missing: false, missingBilling: false, hasKnownBilling: false,
    hasReportedUsage: false, incomplete: false
  }
  for (const blockRef of message.blocks || []) {
    const block = resolveTokenUsageBlock(blockRef, blocksById)
    if (!block) {
      // An unresolved ID might contain tool accounting; do not claim complete totals.
      total.incomplete = true
      continue
    }
    const response = block.metadata?.rawMcpToolResponse
    if (block.type !== 'tool' || !isReversePromptToolName(block.toolName || response?.tool?.name || response?.toolName || '')) continue
    const accounting = getReversePromptAccounting(response)
    const usage = accounting?.usage
    const points = extractBillingPointsFromPayload(accounting)
    if (points !== null) total.hasKnownBilling = true
    if (points === null || accounting?.billing?.complete === false) total.missingBilling = true
    const prompt = asFiniteNumber(usage?.prompt_tokens ?? usage?.input_tokens)
    const completion = asFiniteNumber(usage?.completion_tokens ?? usage?.output_tokens)
    const tokens = asFiniteNumber(usage?.total_tokens) ?? (
      prompt !== null && completion !== null ? prompt + completion : null
    )
    if (tokens === null) total.missing = true
    total.prompt_tokens += prompt || 0
    total.completion_tokens += completion || 0
    total.total_tokens += tokens || 0
    const cache = getCacheInputTokens(usage)
    total.cacheReadTokens += asTokenCount(cache.cacheReadTokens) ?? 0
    total.cacheWriteTokens += asTokenCount(cache.cacheWriteTokens) ?? 0
    total.hasReportedUsage ||= prompt !== null || completion !== null || tokens !== null
    total.incomplete ||= prompt === null || completion === null || tokens === null || accounting?.billing?.complete === false
  }
  return total
}

/** Shared message-row totals, including metrics fallback and tool-internal tokens. */
export function getMessageTokenUsage(
  message: TokenUsageMessage,
  internalToolUsage = getInternalToolUsage(message)
) {
  const displayUsage = getDisplayUsage(message)
  const completionFallback = Number(message.metrics?.completion_tokens ?? 0) || 0
  const completion = Number(displayUsage?.completion_tokens ?? completionFallback) || 0
  const prompt = Number(displayUsage?.prompt_tokens ?? 0) || 0
  const tokens = Number(displayUsage?.total_tokens ?? prompt + completion) || 0
  return {
    displayUsage,
    internalToolUsage,
    prompt_tokens: prompt + internalToolUsage.prompt_tokens,
    completion_tokens: completion + internalToolUsage.completion_tokens,
    total_tokens: tokens + internalToolUsage.total_tokens
  }
}

export type SessionTokenUsageSummary = {
  /** Known subtotals. Consult hasReportedUsage/incomplete before displaying a zero as actual usage. */
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  hasReportedUsage: boolean
  incomplete: boolean
  /** Unique assistant messages only; user/system messages do not represent model requests. */
  messageCount: number
  reportedMessageCount: number
  unknownMessageCount: number
}

const messageId = (id?: string | null) => (typeof id === 'string' ? id.trim() : '')

/**
 * Pure current-session summary. Live messages overlay matching session entries only; unrelated
 * Redux messages are never appended. Aliased session/store IDs count once, with later snapshots
 * taking precedence. Pass Redux messageBlocks.entities when live blocks contain string IDs.
 * Empty sessions return zero, hasReportedUsage=false and incomplete=false. Missing/partial
 * accounting returns known subtotals plus incomplete=true, not a claim of zero consumption.
 */
export function aggregateSessionTokenUsage(
  messages: readonly TokenUsageMessage[] | null | undefined,
  liveMessagesById: LiveTokenMessagesById = {},
  blocksById: TokenUsageBlocksById = {}
): SessionTokenUsageSummary {
  const summary: SessionTokenUsageSummary = {
    promptTokens: 0, completionTokens: 0, totalTokens: 0,
    cacheReadTokens: 0, cacheWriteTokens: 0,
    hasReportedUsage: false, incomplete: false,
    messageCount: 0, reportedMessageCount: 0, unknownMessageCount: 0
  }
  const assistants = (messages || []).filter((message) => message?.role === 'assistant')
  // Union both IDs so a snapshot, its live reference and duplicate snapshots share one group,
  // even when the entry connecting those aliases occurs later in the session array.
  const parents = assistants.map((_, index) => index)
  const root = (index: number): number => {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]]
      index = parents[index]
    }
    return index
  }
  const aliases = new Map<string, number>()
  assistants.forEach((message, index) => {
    for (const id of [messageId(message.id), messageId(message.storeAssistantMessageId)]) {
      if (!id) continue
      const previous = aliases.get(id)
      if (previous !== undefined) parents[root(index)] = root(previous)
      aliases.set(id, index)
    }
  })
  const groups = new Map<number, TokenUsageMessage[]>()
  assistants.forEach((message, index) => {
    const key = root(index)
    const group = groups.get(key) || []
    group.push(message)
    groups.set(key, group)
  })

  for (const group of groups.values()) {
    let message = group.reduce((previous, next) => mergeLiveTokenMessage(previous, next))
    const candidates = [
      ...group.map((item) => messageId(item.storeAssistantMessageId)).reverse(),
      ...group.map((item) => messageId(item.id)).reverse()
    ]
    const liveId = candidates.find((id) => id && liveMessagesById[id])
    message = mergeLiveTokenMessage(message, liveId ? liveMessagesById[liveId] : undefined)
    const usage = getMessageTokenUsage(message, getInternalToolUsage(message, blocksById))
    const steps = getUsageSteps(message)
    const sources = steps.length > 0 ? steps : [message.usage]
    const reports = sources.map(inspectUsage)
    const metricsReported = !usage.displayUsage && asTokenCount(message.metrics?.completion_tokens) !== null
    const hasReportedUsage = reports.some((report) => report.hasReportedUsage) || metricsReported || usage.internalToolUsage.hasReportedUsage
    const incomplete = reports.some((report) => report.incomplete) || usage.internalToolUsage.incomplete ||
      Boolean(message.error) || message.status === 'error' || Boolean(message.aborted)
    const cache = getCacheInputTokens(usage.displayUsage)
    summary.promptTokens += asTokenCount(usage.prompt_tokens) ?? 0
    summary.completionTokens += asTokenCount(usage.completion_tokens) ?? 0
    summary.totalTokens += asTokenCount(usage.total_tokens) ?? 0
    summary.cacheReadTokens += (asTokenCount(cache.cacheReadTokens) ?? 0) + usage.internalToolUsage.cacheReadTokens
    summary.cacheWriteTokens += (asTokenCount(cache.cacheWriteTokens) ?? 0) + usage.internalToolUsage.cacheWriteTokens
    summary.messageCount++
    summary.reportedMessageCount += Number(hasReportedUsage)
    summary.unknownMessageCount += Number(!hasReportedUsage)
    summary.hasReportedUsage ||= hasReportedUsage
    summary.incomplete ||= incomplete
  }
  return summary
}
