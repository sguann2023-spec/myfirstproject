import { useAppSelector } from '@renderer/store'
import { getMcpToolDisplayName, parseMcpToolName } from './Tools/shared/mcpToolDisplay'
// import { useRuntime } from '@renderer/hooks/useRuntime'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { Message } from '@renderer/types/newMessage'
import { Popover } from 'antd'
import { t } from 'i18next'
import React from 'react'
import { shallowEqual } from 'react-redux'
import styled from 'styled-components'
import {
  extractBillingPointsFromToolResponse,
  getCacheInputTokens,
  getInternalToolUsage,
  getMessageTokenUsage,
  getUsageSteps,
  mergeLiveTokenMessage,
  resolveTokenUsageBlock,
  type MessageUsageWithCacheDetails,
  type TokenUsageMessage
} from './tokenUsage'

interface MessageTokensProps {
  message: Message
  isLastMessage?: boolean
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

type ToolBillingDetail = {
  label: string
  points: number
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

const EMPTY_TOOL_BILLING_DETAILS: ToolBillingDetail[] = []

const toolBillingDetailsEqual = (a: ToolBillingDetail[], b: ToolBillingDetail[]) => {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].label !== b[i].label || a[i].points !== b[i].points) return false
  }
  return true
}

const MessageTokens: React.FC<MessageTokensProps> = ({ message }) => {
  const currentMessage: Message & TokenUsageMessage = useAppSelector((state: any) =>
    mergeLiveTokenMessage(message, state.messages?.entities?.[message.id]), shallowEqual)

  // Persisted custom models may contain platform pricing from an older model lookup.
  // The provider or fully qualified model ID, not that pricing, determines who bills the conversation.
  const isThirdPartyModel =
    currentMessage.model?.provider?.startsWith('custom-') || currentMessage.model?.id?.startsWith('custom-')

  // const { generating } = useRuntime()
  const locateMessage = () => {
    void EventEmitter.emit(EVENT_NAMES.LOCATE_MESSAGE + ':' + currentMessage.id, false)
  }

  const toolBillingDetails = useAppSelector((state: any) => {
    if (!Array.isArray(currentMessage.blocks) || currentMessage.blocks.length === 0) return EMPTY_TOOL_BILLING_DETAILS

    return currentMessage.blocks.reduce<ToolBillingDetail[]>((details: ToolBillingDetail[], blockRef: unknown) => {
      const block = resolveTokenUsageBlock(blockRef, state.messageBlocks?.entities)
      if (!block || block.type !== 'tool') return details

      const rawToolName =
        block.toolName || block.metadata?.rawMcpToolResponse?.tool?.name || block.metadata?.rawMcpToolResponse?.toolName || ''
      // Codemode is an execution container. Its response can contain the nested
      // MCP result, so counting it would duplicate the real tool's billing.
      if (rawToolName.toLowerCase() === 'codemode') return details

      const points = extractBillingPointsFromToolResponse(block.metadata?.rawMcpToolResponse)
      if (points <= 0) return details

      const label = rawToolName
        ? getMcpToolDisplayName({
            ...parseMcpToolName(rawToolName),
            t
          })
        : 'Tool'

      details.push({ label, points })
      return details
    }, [])
  }, toolBillingDetailsEqual)

  const toolBillingPoints = toolBillingDetails.reduce((total: number, detail: ToolBillingDetail) => total + detail.points, 0)

  const internalToolUsage = useAppSelector((state: any) =>
    getInternalToolUsage(currentMessage, state.messageBlocks?.entities), shallowEqual)
  const tokenUsage = getMessageTokenUsage(currentMessage, internalToolUsage)
  const { displayUsage } = tokenUsage

  const getUsagePrice = (usage?: MessageUsageWithCacheDetails) => {
    if (isThirdPartyModel) return 0

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

  const getPrice = () => {
    const usagePrice = (() => {
      const usageSteps = getUsageSteps(currentMessage)
      if (usageSteps.length > 0) {
        return usageSteps.reduce((total: number, usageStep: MessageUsageWithCacheDetails) => total + getUsagePrice(usageStep), 0)
      }

      return getUsagePrice(displayUsage)
    })()

    return usagePrice + toolBillingPoints
  }

  const hasReportedUsage = Boolean(displayUsage) || Number(currentMessage?.metrics?.completion_tokens ?? 0) > 0
  const incompleteUsage = !displayUsage || internalToolUsage.missing || Boolean(currentMessage.error) || currentMessage.status === 'error' || currentMessage.aborted

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
    if (isThirdPartyModel) return ''

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
    const missingModelBilling = !isThirdPartyModel && !displayUsage
    if (missingModelBilling || internalToolUsage.missingBilling) {
      if (price > 0) return `≥${price.toFixed(2)}`
      if (missingModelBilling || !internalToolUsage.hasKnownBilling) return t('message.accounting.unavailable')
    }
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
    const aggregatedUsage = tokenUsage
    const cacheReadSummaryText = getCacheReadSummaryString()
    const cacheSavingText = getCacheSavingString()
    const usageBillingPoints = Math.max(0, getPrice() - toolBillingPoints)
    const tooltipDetails: ToolBillingDetail[] = [{ label: '对话模型', points: usageBillingPoints }, ...toolBillingDetails]

    const tooltipContent = (
      <TooltipList>
        {tooltipDetails.map((detail, index) => (
          <TooltipRow key={`${index}-${detail.label}`}>
            <span>{detail.label}</span>
            <TooltipValue>
              <TooltipPointIcon src={POINT2_ICON_URL} alt="" aria-hidden="true" />
              <span>{!isThirdPartyModel && index === 0 && !displayUsage ? t('message.accounting.unavailable') : formatPoints(detail.points)}</span>
            </TooltipValue>
          </TooltipRow>
        ))}
      </TooltipList>
    )

    const tokensInfo = (
      <span className="tokens">
        Tokens:
        <span>{(!hasReportedUsage || internalToolUsage.missing) && aggregatedUsage.total_tokens === 0
          ? t('message.accounting.unavailable')
          : formatTokenCount(aggregatedUsage.total_tokens)}</span>
        <span>↑{displayUsage || internalToolUsage.total_tokens > 0 ? formatTokenCount(aggregatedUsage.prompt_tokens) : t('message.accounting.unavailable')}</span>
        <span>↓{hasReportedUsage || internalToolUsage.total_tokens > 0 ? formatTokenCount(aggregatedUsage.completion_tokens) : t('message.accounting.unavailable')}</span>
        {cacheReadSummaryText ? <span>{cacheReadSummaryText}</span> : null}
        <EstimatedPriceSpan>
          <span>| 预估消耗:</span>
          <EstimatedPriceValue>
            <EstimatedPriceIcon src={POINT2_ICON_URL} alt="" aria-hidden="true" />
            <EstimatedPriceNumber>{getPriceString()}</EstimatedPriceNumber>
          </EstimatedPriceValue>
        </EstimatedPriceSpan>
        {cacheSavingText ? <span>{cacheSavingText}</span> : null}
        {incompleteUsage ? <span>| {t('message.accounting.incomplete')}</span> : null}
      </span>
    )

    return (
      <MessageMetadata className="message-tokens" onClick={locateMessage}>
        <Popover
          content={tooltipContent}
          placement="top"
          trigger="hover"
          mouseEnterDelay={0}
          mouseLeaveDelay={0.15}
          destroyTooltipOnHide
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
  max-height: 320px;
  overflow-y: auto;
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
