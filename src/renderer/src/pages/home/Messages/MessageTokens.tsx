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

const MessageTokens: React.FC<MessageTokensProps> = ({ message }) => {
  // const { generating } = useRuntime()
  const locateMessage = () => {
    void EventEmitter.emit(EVENT_NAMES.LOCATE_MESSAGE + ':' + message.id, false)
  }

  const getUsageSteps = () =>
    Array.isArray(message.usageSteps) && message.usageSteps.length > 0
      ? (message.usageSteps as MessageUsageWithCacheDetails[])
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
    const model = message.model
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
    const directUsage = message?.usage as MessageUsageWithCacheDetails | undefined
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
    const usageSteps = getUsageSteps()
    if (usageSteps.length > 0) {
      return usageSteps.reduce((total: number, usageStep: MessageUsageWithCacheDetails) => total + getUsagePrice(usageStep), 0)
    }

    return getUsagePrice(getDisplayUsage())
  }

  const usageSteps = getUsageSteps()
  const displayUsage = getDisplayUsage()

  const getAggregatedUsage = () => {
    const usage = displayUsage
    return {
      prompt_tokens: Number(usage?.prompt_tokens ?? 0) || 0,
      completion_tokens: Number(usage?.completion_tokens ?? 0) || 0,
      total_tokens: Number(usage?.total_tokens ?? 0) || 0
    }
  }

  const getCacheReadSummaryString = () => {
    const cacheReadTokens = getCacheInputTokens(displayUsage).cacheReadTokens
    if (cacheReadTokens <= 0) {
      return ''
    }

    const pricing = message.model?.pricing as MessagePricingWithPreciseFields | undefined
    const uncachedInputPointPerMillion =
      Number(
        pricing?.precise_uncached_input_resource_points_per_unit ?? pricing?.precise_input_resource_points_per_unit ?? 0
      ) || 0
    void uncachedInputPointPerMillion

    return `| 缓存命中 ${cacheReadTokens}`
  }

  const getCacheSavingString = () => {
    const cacheReadTokens = getCacheInputTokens(displayUsage).cacheReadTokens
    if (cacheReadTokens <= 0) {
      return ''
    }

    const pricing = message.model?.pricing as MessagePricingWithPreciseFields | undefined
    const uncachedInputPointPerMillion =
      Number(
        pricing?.precise_uncached_input_resource_points_per_unit ?? pricing?.precise_input_resource_points_per_unit ?? 0
      ) || 0
    const cacheReadPointPerMillion = Number(pricing?.precise_cache_read_resource_points_per_unit ?? 0) || 0

    if (uncachedInputPointPerMillion <= 0 || cacheReadPointPerMillion < 0 || cacheReadPointPerMillion >= uncachedInputPointPerMillion) {
      return ''
    }

    const savingPercent = (((uncachedInputPointPerMillion - cacheReadPointPerMillion) / uncachedInputPointPerMillion) * 100).toFixed(0)
    return `(节约 ${savingPercent}%)`
  }

  const getPriceString = () => {
    const price = getPrice()
    return `| ${t('settings.messages.estimated_price')}: ${price.toFixed(2)}点`
  }

  if (!message.usage && usageSteps.length === 0) {
    return null
  }

  if (message.role === 'user') {
    return (
      <MessageMetadata className="message-tokens" onClick={locateMessage}>
        {`Tokens: ${message?.usage?.total_tokens}`}
      </MessageMetadata>
    )
  }

  if (message.role === 'assistant') {
    let metricsText = ''
    let hasMetrics = false
    const aggregatedUsage = getAggregatedUsage()
    const cacheReadSummaryText = getCacheReadSummaryString()
    const cacheSavingText = getCacheSavingString()
    if (message?.metrics?.completion_tokens && message?.metrics?.time_completion_millsec) {
      hasMetrics = true
      metricsText = t('settings.messages.metrics', {
        time_first_token_millsec: message?.metrics?.time_first_token_millsec,
        token_speed: (message?.metrics?.completion_tokens / (message?.metrics?.time_completion_millsec / 1000)).toFixed(
          0
        )
      })
    }

    const tokensInfo = (
      <span className="tokens">
        Tokens:
        <span>{aggregatedUsage.total_tokens}</span>
        <span>↑{aggregatedUsage.prompt_tokens}</span>
        <span>↓{aggregatedUsage.completion_tokens}</span>
        {cacheReadSummaryText ? <span>{cacheReadSummaryText}</span> : null}
        <span>{getPriceString()}</span>
        {cacheSavingText ? <span>{cacheSavingText}</span> : null}
      </span>
    )

    return (
      <MessageMetadata className="message-tokens" onClick={locateMessage}>
        {hasMetrics ? (
          <Popover
            content={metricsText}
            placement="top"
            trigger="hover"
            mouseEnterDelay={0}
            mouseLeaveDelay={0}
            styles={{ root: { fontSize: 11 } }}>
            {tokensInfo}
          </Popover>
        ) : (
          tokensInfo
        )}
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

export default MessageTokens
