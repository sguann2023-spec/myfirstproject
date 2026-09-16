import { useAppSelector } from '@renderer/store'
import { normalizeToCallToolResult } from './Tools/shared/callToolResult'
import { getMcpToolDisplayName, parseMcpToolName } from './Tools/shared/mcpToolDisplay'
// import { useRuntime } from '@renderer/hooks/useRuntime'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { Message } from '@renderer/types/newMessage'
import { Popover } from 'antd'
import { t } from 'i18next'
import React from 'react'
import styled from 'styled-components'

interface MessageTokensProps {
  message: Message
  isLastMessage?: boolean
}

type MessageUsageWithCacheDetails = Message['usage'] & {
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  prompt_tokens_details?: {
    cached_tokens?: number
    cache_creation_input_tokens?: number
    cache_write_tokens?: number
  }
  input_tokens_details?: {
    cached_tokens?: number
    cache_creation_input_tokens?: number
    cache_write_tokens?: number
  }
}

type MessagePricingWithPreciseFields = NonNullable<Message['model']>['pricing'] & {
  input_resource_points_per_unit?: number
  output_resource_points_per_unit?: number
  precise_input_resource_points_per_unit?: number
  precise_output_resource_points_per_unit?: number
  precise_uncached_input_resource_points_per_unit?: number
  precise_cache_read_resource_points_per_unit?: number
  precise_cache_write_resource_points_per_unit?: number
}

type BillingRecord = Record<string, unknown>
type ToolBillingDetail = {
  label: string
  points: number
}

type BlockLike = {
  id?: string
  type?: string
  toolName?: string
  metadata?: {
    rawMcpToolResponse?: {
      tool?: {
        name?: string
      }
      toolName?: string
      response?: unknown
      responseRaw?: unknown
    }
  }
}

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

function extractBillingPointsFromPayload(payload: unknown): number | null {
  if (typeof payload === 'string' && payload.trim()) {
    try {
      return extractBillingPointsFromPayload(JSON.parse(payload))
    } catch {
      return null
    }
  }

  const record = asRecord(payload)
  if (!record) return null

  const nestedBilling = asRecord(record.billing)
  if (nestedBilling) {
    return asFiniteNumber(
      nestedBilling.total_consumed_points ?? nestedBilling.points_consumed ?? nestedBilling.consume
    )
  }

  if ('total_consumed_points' in record) {
    return asFiniteNumber(record.total_consumed_points)
  }

  if ('points_consumed' in record) {
    return asFiniteNumber(record.points_consumed)
  }

  if ('consume' in record) {
    return asFiniteNumber(record.consume)
  }

  if ('responseRaw' in record) {
    const nestedResponseRawPoints = extractBillingPointsFromPayload(record.responseRaw)
    if (nestedResponseRawPoints !== null) {
      return nestedResponseRawPoints
    }
  }

  if ('response' in record) {
    const nestedResponsePoints = extractBillingPointsFromPayload(record.response)
    if (nestedResponsePoints !== null) {
      return nestedResponsePoints
    }
  }

  if ('output' in record) {
    const nestedOutputPoints = extractBillingPointsFromPayload(record.output)
    if (nestedOutputPoints !== null) {
      return nestedOutputPoints
    }
  }

  if ('result' in record) {
    const nestedResultPoints = extractBillingPointsFromPayload(record.result)
    if (nestedResultPoints !== null) {
      return nestedResultPoints
    }
  }

  const normalized = normalizeToCallToolResult(payload)
  for (const item of normalized.content) {
    if (item.type !== 'text' || typeof item.text !== 'string' || !item.text.trim()) continue

    const nestedPoints = extractBillingPointsFromPayload(item.text)
    if (nestedPoints !== null) {
      return nestedPoints
    }
  }

  return null
}

function extractBillingPointsFromToolResponse(toolResponse: unknown): number {
  const record = asRecord(toolResponse)
  const directPoints = extractBillingPointsFromPayload(record?.responseRaw ?? record?.response ?? toolResponse)
  if (directPoints !== null) return directPoints

  return 0
}

const formatPoints = (value: number) => (Number(value) || 0).toFixed(2)

const formatTokenCount = (value: number) => {
  const normalizedValue = Number(value) || 0
  if (Math.abs(normalizedValue) >= 1_000_000) {
    return `${(normalizedValue / 1_000_000).toFixed(2)}M`
  }
  if (Math.abs(normalizedValue) >= 1_000) {
    return `${(normalizedValue / 1_000).toFixed(2)}K`
  }
  return String(normalizedValue)
}

const POINT2_ICON_URL = new URL('../../../../../../public/point2.svg', import.meta.url).href

const asBlockLike = (value: unknown): BlockLike | null =>
  typeof value === 'object' && value !== null ? (value as BlockLike) : null

function resolveMessageBlock(state: any, blockRef: unknown): BlockLike | null {
  if (typeof blockRef === 'string') {
    return asBlockLike(state.messageBlocks.entities[blockRef])
  }

  const inlineBlock = asBlockLike(blockRef)
  if (!inlineBlock) return null

  if (inlineBlock.id && state.messageBlocks.entities[inlineBlock.id]) {
    return asBlockLike(state.messageBlocks.entities[inlineBlock.id]) ?? inlineBlock
  }

  return inlineBlock
}

const MessageTokens: React.FC<MessageTokensProps> = ({ message }) => {
  const currentMessage = useAppSelector((state: any) => state.messages?.entities?.[message.id] ?? message)

  // const { generating } = useRuntime()
  const locateMessage = () => {
    void EventEmitter.emit(EVENT_NAMES.LOCATE_MESSAGE + ':' + currentMessage.id, false)
  }

  const toolBillingDetails = useAppSelector((state: any) => {
    if (!Array.isArray(currentMessage.blocks) || currentMessage.blocks.length === 0) return []

    return currentMessage.blocks.reduce<ToolBillingDetail[]>((details: ToolBillingDetail[], blockRef: unknown) => {
      const block = resolveMessageBlock(state, blockRef)
      if (!block || block.type !== 'tool') return details

      const points = extractBillingPointsFromToolResponse(block.metadata?.rawMcpToolResponse)
      if (points <= 0) return details

      const rawToolName =
        block.toolName || block.metadata?.rawMcpToolResponse?.tool?.name || block.metadata?.rawMcpToolResponse?.toolName || ''

      const label = rawToolName
        ? getMcpToolDisplayName({
            ...parseMcpToolName(rawToolName),
            t
          })
        : 'Tool'

      return [...details, { label, points }]
    }, [])
  })

  const toolBillingPoints = toolBillingDetails.reduce((total: number, detail: ToolBillingDetail) => total + detail.points, 0)

  const getUsageSteps = () =>
    Array.isArray(currentMessage.usageSteps) && currentMessage.usageSteps.length > 0
      ? (currentMessage.usageSteps as MessageUsageWithCacheDetails[])
      : []

  const getCacheInputTokens = (usage?: MessageUsageWithCacheDetails) => {
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

    return {
      cacheReadTokens,
      cacheWriteTokens
    }
  }

  const getUsagePrice = (usage?: MessageUsageWithCacheDetails) => {
    const inputTokens = Number(usage?.prompt_tokens ?? 0) || 0
    const outputTokens = Number(usage?.completion_tokens ?? 0) || 0
    const { cacheReadTokens, cacheWriteTokens } = getCacheInputTokens(usage)
    const uncachedInputTokens = Math.max(0, inputTokens - cacheReadTokens - cacheWriteTokens)
    const model = currentMessage.model
    const pricing = model?.pricing as MessagePricingWithPreciseFields | undefined

    const preciseUncachedInputPointPerMillion =
      Number(
        pricing?.precise_uncached_input_resource_points_per_unit ?? pricing?.precise_input_resource_points_per_unit ?? 0
      ) || 0
    const preciseCacheReadPointPerMillion = Number(pricing?.precise_cache_read_resource_points_per_unit ?? 0) || 0
    const preciseCacheWritePointPerMillion = Number(pricing?.precise_cache_write_resource_points_per_unit ?? 0) || 0
    const preciseOutputPointPerMillion =
      Number(pricing?.precise_output_resource_points_per_unit ?? pricing?.output_per_million_tokens ?? 0) || 0

    if (
      preciseUncachedInputPointPerMillion > 0 ||
      preciseCacheReadPointPerMillion > 0 ||
      preciseCacheWritePointPerMillion > 0 ||
      preciseOutputPointPerMillion > 0
    ) {
      return (
        (uncachedInputTokens * preciseUncachedInputPointPerMillion +
          cacheReadTokens * preciseCacheReadPointPerMillion +
          cacheWriteTokens * preciseCacheWritePointPerMillion +
          outputTokens * preciseOutputPointPerMillion) /
        1_000_000
      )
    }

    const inputPointPerThousand =
      Number(pricing?.input_resource_points_per_unit ?? pricing?.input_per_million_tokens ?? 0) || 0
    const outputPointPerThousand =
      Number(pricing?.output_resource_points_per_unit ?? pricing?.output_per_million_tokens ?? 0) || 0

    return (inputTokens * inputPointPerThousand + outputTokens * outputPointPerThousand) / 1000
  }

  const getDisplayUsage = (): MessageUsageWithCacheDetails | undefined => {
    const directUsage = currentMessage?.usage as MessageUsageWithCacheDetails | undefined
    const usageSteps = getUsageSteps()

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
          prompt_tokens_details: {
            cached_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_write_tokens: 0
          },
          input_tokens_details: {
            cached_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_write_tokens: 0
          }
        }
      )
    }

    if (!directUsage) {
      return undefined
    }

    const directCache = getCacheInputTokens(directUsage)
    const promptTokens = Number(directUsage?.prompt_tokens ?? 0) || 0
    const completionTokens = Number(directUsage?.completion_tokens ?? 0) || 0
    const totalTokens = Number(directUsage?.total_tokens ?? promptTokens + completionTokens) || 0
    const cacheReadTokens = directCache.cacheReadTokens
    const cacheWriteTokens = directCache.cacheWriteTokens

    return {
      ...(directUsage ?? {}),
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
      cache_read_input_tokens: cacheReadTokens,
      cache_creation_input_tokens: cacheWriteTokens,
      prompt_tokens_details: {
        ...(directUsage?.prompt_tokens_details ?? {}),
        cached_tokens: cacheReadTokens,
        cache_creation_input_tokens: cacheWriteTokens,
        cache_write_tokens: cacheWriteTokens
      },
      input_tokens_details: {
        ...(directUsage?.input_tokens_details ?? {}),
        cached_tokens: cacheReadTokens,
        cache_creation_input_tokens: cacheWriteTokens,
        cache_write_tokens: cacheWriteTokens
      }
    }
  }

  const getPrice = () => {
    const usagePrice = (() => {
      const usageSteps = getUsageSteps()
      if (usageSteps.length > 0) {
        return usageSteps.reduce((total: number, usageStep: MessageUsageWithCacheDetails) => total + getUsagePrice(usageStep), 0)
      }

      return getUsagePrice(getDisplayUsage())
    })()

    return usagePrice + toolBillingPoints
  }

  const displayUsage = getDisplayUsage()

  const getAggregatedUsage = () => {
    const usage = displayUsage
    const completionTokensFallback = Number(currentMessage?.metrics?.completion_tokens ?? 0) || 0
    const completionTokens = Number(usage?.completion_tokens ?? completionTokensFallback) || 0
    const promptTokens = Number(usage?.prompt_tokens ?? 0) || 0
    const totalTokens = Number(usage?.total_tokens ?? promptTokens + completionTokens) || 0

    return {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens
    }
  }

  const getCacheReadSummaryString = () => {
    const cacheReadTokens = getCacheInputTokens(displayUsage).cacheReadTokens
    if (cacheReadTokens <= 0) {
      return ''
    }

    const pricing = currentMessage.model?.pricing as MessagePricingWithPreciseFields | undefined
    const uncachedInputPointPerMillion =
      Number(
        pricing?.precise_uncached_input_resource_points_per_unit ?? pricing?.precise_input_resource_points_per_unit ?? 0
      ) || 0
    void uncachedInputPointPerMillion

    return `| 缓存命中 ${formatTokenCount(cacheReadTokens)}`
  }

  const getCacheSavingString = () => {
    const cacheReadTokens = getCacheInputTokens(displayUsage).cacheReadTokens
    if (cacheReadTokens <= 0) {
      return ''
    }

    const pricing = currentMessage.model?.pricing as MessagePricingWithPreciseFields | undefined
    const uncachedInputPointPerMillion =
      Number(
        pricing?.precise_uncached_input_resource_points_per_unit ?? pricing?.precise_input_resource_points_per_unit ?? 0
      ) || 0
    const cacheReadPointPerMillion = Number(pricing?.precise_cache_read_resource_points_per_unit ?? 0) || 0

    if (uncachedInputPointPerMillion <= 0 || cacheReadPointPerMillion < 0 || cacheReadPointPerMillion >= uncachedInputPointPerMillion) {
      return ''
    }

    const savingPercent = (((uncachedInputPointPerMillion - cacheReadPointPerMillion) / uncachedInputPointPerMillion) * 100).toFixed(0)
    return `(节省 ${savingPercent}%)`
  }

  const getPriceString = () => {
    const price = getPrice()
    return price.toFixed(2)
  }

  if (currentMessage.role === 'user') {
    return (
      <MessageMetadata className="message-tokens" onClick={locateMessage}>
        {`Tokens: ${formatTokenCount(Number(currentMessage?.usage?.total_tokens ?? 0))}`}
      </MessageMetadata>
    )
  }

  if (currentMessage.role === 'assistant') {
    const aggregatedUsage = getAggregatedUsage()
    const cacheReadSummaryText = getCacheReadSummaryString()
    const cacheSavingText = getCacheSavingString()
    const usageBillingPoints = Math.max(0, getPrice() - toolBillingPoints)
    const tooltipDetails: ToolBillingDetail[] = [{ label: '对话模型', points: usageBillingPoints }, ...toolBillingDetails]

    const tooltipContent = (
      <TooltipList>
        {tooltipDetails.map((detail) => (
          <TooltipRow key={`${detail.label}-${detail.points}`}>
            <span>{detail.label}</span>
            <TooltipValue>
              <TooltipPointIcon src={POINT2_ICON_URL} alt="" aria-hidden="true" />
              <span>{formatPoints(detail.points)}</span>
            </TooltipValue>
          </TooltipRow>
        ))}
      </TooltipList>
    )

    const tokensInfo = (
      <span className="tokens">
        Tokens:
        <span>{formatTokenCount(aggregatedUsage.total_tokens)}</span>
        <span>↑{formatTokenCount(aggregatedUsage.prompt_tokens)}</span>
        <span>↓{formatTokenCount(aggregatedUsage.completion_tokens)}</span>
        {cacheReadSummaryText ? <span>{cacheReadSummaryText}</span> : null}
        <EstimatedPriceSpan>
          <span>| 预估消耗:</span>
          <EstimatedPriceValue>
            <EstimatedPriceIcon src={POINT2_ICON_URL} alt="" aria-hidden="true" />
            <EstimatedPriceNumber>{getPriceString()}</EstimatedPriceNumber>
          </EstimatedPriceValue>
        </EstimatedPriceSpan>
        {cacheSavingText ? <span>{cacheSavingText}</span> : null}
      </span>
    )

    return (
      <MessageMetadata className="message-tokens" onClick={locateMessage}>
        <Popover
          content={tooltipContent}
          placement="top"
          trigger="hover"
          mouseEnterDelay={0}
          mouseLeaveDelay={0}
          styles={{ root: { fontSize: 11 } }}>
          {tokensInfo}
        </Popover>
      </MessageMetadata>
    )
  }

  return null
}

const MessageMetadata = styled.div`
  font-size: 10px;
  color: var(--color-text-3);
  user-select: text;
  cursor: pointer;
  text-align: right;

  .tokens span {
    padding: 0 2px;
  }
`

const EstimatedPriceSpan = styled.span`
  display: inline-flex;
  align-items: center;
  padding: 0 0px;
`

const EstimatedPriceValue = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 1px;
  padding: 0;
  line-height: 1;

  > span {
    padding: 0 1px !important;
  }
`

const EstimatedPriceIcon = styled.img`
  width: 10px;
  height: 10px;
  display: block;
  flex-shrink: 0;
`

const EstimatedPriceNumber = styled.span`
  display: inline-flex;
  align-items: center;
  line-height: 1;
  padding: 0 1px !important;
  position: relative;
`

const TooltipList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 180px;
`

const TooltipRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
`

const TooltipValue = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 3px;
`

const TooltipPointIcon = styled.img`
  width: 10px;
  height: 10px;
  display: block;
  flex-shrink: 0;
`

export default MessageTokens
