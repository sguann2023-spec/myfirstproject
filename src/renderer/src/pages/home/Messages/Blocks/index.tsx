import { useTranslation } from 'react-i18next'
import { loggerService } from '@logger'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import type { RootState } from '@renderer/store'
import { messageBlocksSelectors } from '@renderer/store/messageBlock'
import type { ImageMessageBlock, Message, MessageBlock, ThinkingMessageBlock, ToolMessageBlock } from '@renderer/types/newMessage'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { isMainTextBlock, isMessageProcessing, isVideoBlock } from '@renderer/utils/messageUtils/is'
import { ChevronRight } from 'lucide-react'
import { AnimatePresence, motion, type Variants } from 'motion/react'
import React, { useEffect, useMemo, useState } from 'react'
import { useSelector } from 'react-redux'
import styled from 'styled-components'

import BlockErrorFallback from './BlockErrorFallback'
import CitationBlock from './CitationBlock'
import CompactBlock from './CompactBlock'
import ErrorBlock from './ErrorBlock'
import FileBlock from './FileBlock'
import { hasAbnormalTermination } from './foldState'
import ImageBlock from './ImageBlock'
import MainTextBlock from './MainTextBlock'
import PlaceholderBlock from './PlaceholderBlock'
import ThinkingBlock from './ThinkingBlock'
import ToolBlock from './ToolBlock'
import ToolBlockGroup from './ToolBlockGroup'
import { groupSimilarBlocks, type GroupedBlock } from './blockGrouping'
import TranslationBlock from './TranslationBlock'
import VideoBlock from './VideoBlock'

const logger = loggerService.withContext('MessageBlockRenderer')

interface AnimatedBlockWrapperProps {
  children: React.ReactNode
  enableAnimation: boolean
}

const blockWrapperVariants: Variants = {
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.3, type: 'spring', bounce: 0 }
  },
  hidden: {
    opacity: 0,
    x: 10
  },
  static: {
    opacity: 1,
    x: 0,
    transition: { duration: 0 }
  }
}

const AnimatedBlockWrapper: React.FC<AnimatedBlockWrapperProps> = ({ children, enableAnimation }) => {
  return (
    <motion.div
      className="block-wrapper"
      variants={blockWrapperVariants}
      initial={enableAnimation ? 'hidden' : 'static'}
      animate={enableAnimation ? 'visible' : 'static'}>
      <ErrorBoundary fallbackComponent={BlockErrorFallback}>{children}</ErrorBoundary>
    </motion.div>
  )
}

interface Props {
  blocks: string[] // 可以接收块ID数组或MessageBlock数组
  fallbackBlockEntities?: Record<string, MessageBlock>
  messageStatus?: Message['status']
  message: Message
  /** ChatShell 专用：处理中占位块旁显示「已处理 xx」计时文案 */
  showProcessingElapsed?: boolean
}

function getBlockTimestamp(block: MessageBlock | undefined): number {
  return resolveTimestamp(block?.updatedAt ?? block?.createdAt)
}

function resolveTimestamp(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return 0

    const numericValue = Number(trimmed)
    if (Number.isFinite(numericValue) && /^\d+$/.test(trimmed)) {
      return numericValue
    }

    const parsedValue = Date.parse(trimmed)
    return Number.isFinite(parsedValue) ? parsedValue : 0
  }

  return 0
}

function getGroupedBlockLastTimestamp(group: GroupedBlock | undefined): number {
  if (!group) return 0
  if (Array.isArray(group)) {
    return group.reduce((latest, item) => Math.max(latest, getBlockTimestamp(item)), 0)
  }
  return getBlockTimestamp(group)
}

function getGroupedBlockFirstTimestamp(group: GroupedBlock | undefined): number {
  if (!group) return 0
  if (Array.isArray(group)) {
    return group.reduce((earliest, item) => {
      const timestamp = getBlockTimestamp(item)
      if (earliest === 0) return timestamp
      if (timestamp === 0) return earliest
      return Math.min(earliest, timestamp)
    }, 0)
  }
  return getBlockTimestamp(group)
}

function isResultAnchorBlock(group: GroupedBlock): boolean {
  const block = Array.isArray(group) ? group[0] : group
  if (!block) return false

  // 注意：ERROR 不作为结果锚，否则一旦发生错误就会把此前的工具产出全部折叠，
  // 用户看不到已产生的最后一次有效结果。ERROR 会作为「锚点之后」的块继续展示。
  // TOOL 也视为有效结果锚：当执行到一半失败时，最后一次工具产出应当保留可见。
  switch (block.type) {
    case MessageBlockType.MAIN_TEXT:
    case MessageBlockType.CODE:
    case MessageBlockType.IMAGE:
    case MessageBlockType.FILE:
    case MessageBlockType.VIDEO:
    case MessageBlockType.TRANSLATION:
    case MessageBlockType.COMPACT:
    case MessageBlockType.TOOL:
      return true
    default:
      return false
  }
}

function formatElapsedDuration(durationMs: number): string {
  const safeMs = Math.max(0, Number.isFinite(durationMs) ? durationMs : 0)
  const totalSeconds = Math.max(1, Math.round(safeMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    const remainingMinutes = Math.floor((totalSeconds % 3600) / 60)
    return `${hours}小时${remainingMinutes > 0 ? `${remainingMinutes}分` : ''}${seconds > 0 ? `${seconds}秒` : ''}`
  }

  if (minutes > 0) {
    return `${minutes}分${seconds > 0 ? `${seconds}秒` : ''}`
  }

  return `${seconds}秒`
}

function getEarliestTimestamp(...values: number[]): number {
  const validValues = values.filter((value) => Number.isFinite(value) && value > 0)
  if (validValues.length === 0) return 0
  return Math.min(...validValues)
}

function getLatestTimestamp(...values: number[]): number {
  const validValues = values.filter((value) => Number.isFinite(value) && value > 0)
  if (validValues.length === 0) return 0
  return Math.max(...validValues)
}

const MessageBlockRenderer: React.FC<Props> = ({ blocks, message, fallbackBlockEntities, showProcessingElapsed }) => {
  // 始终调用useSelector，避免条件调用Hook
  const blockEntities = useSelector((state: RootState) => messageBlocksSelectors.selectEntities(state))
  // 根据blocks类型处理渲染数据
  // History snapshots can render before their blocks have been added to Redux.
  const renderedBlocks = blocks.map((blockId) => blockEntities[blockId] ?? fallbackBlockEntities?.[blockId]).filter(Boolean)
  const { t } = useTranslation()
  const groupedBlocks = useMemo(() => groupSimilarBlocks(renderedBlocks, t), [renderedBlocks, t])

  // Check if message is still processing
  const isProcessing = isMessageProcessing(message)
  // Keep the trailing loading indicator visible for the whole processing window,
  // even after main text or tool blocks have already rendered.
  const shouldShowProcessingPlaceholder = isProcessing

  // 从 UNKNOWN 占位块的 metadata.loadingLabel 中提取网络重试提示文案
  const processingLoadingLabel = useMemo(() => {
    for (const block of renderedBlocks) {
      if (block?.type !== MessageBlockType.UNKNOWN) continue
      const label = String((block as any)?.metadata?.loadingLabel || '').trim()
      if (label) return label
    }
    // 兜底：直接从 message 上读取 retryStatusText（例如 fallback message 或未落 store 时）
    const rawRetryText = String((message as any)?.retryStatusText || '').trim()
    return rawRetryText
  }, [renderedBlocks, message])

  // 「已处理」计时的起点：本轮回复消息的创建时间
  const processingStartedAt = showProcessingElapsed ? String(message.createdAt || '').trim() : ''

  const resultAnchorIndex = useMemo(() => {
    for (let index = groupedBlocks.length - 1; index >= 0; index--) {
      if (isResultAnchorBlock(groupedBlocks[index])) {
        return index
      }
    }
    return -1
  }, [groupedBlocks])

  const hiddenGroupedBlocks = useMemo(() => {
    if (message.role !== 'assistant' || isProcessing || resultAnchorIndex <= 0) {
      return [] as GroupedBlock[]
    }
    // 异常收尾（出错、异常中断、用户主动中断）时不折叠，
    // 让用户看到完整的思考/工具产出上下文，而不是仅剩最后一个块 + 错误 banner，
    // 也不再把这类消息折叠显示成「已完成」。
    if (hasAbnormalTermination(message, renderedBlocks)) {
      return [] as GroupedBlock[]
    }
    return groupedBlocks.slice(0, resultAnchorIndex)
  }, [groupedBlocks, isProcessing, message, renderedBlocks, resultAnchorIndex])

  const visibleGroupedBlocks = useMemo(() => {
    if (hiddenGroupedBlocks.length === 0) {
      return groupedBlocks
    }
    return groupedBlocks.slice(resultAnchorIndex)
  }, [groupedBlocks, hiddenGroupedBlocks.length, resultAnchorIndex])

  const [isHistoryExpanded, setIsHistoryExpanded] = useState(false)

  useEffect(() => {
    setIsHistoryExpanded(false)
  }, [hiddenGroupedBlocks.length, isProcessing, message.id])

  const completionDurationLabel = useMemo(() => {
    if (hiddenGroupedBlocks.length === 0) return ''
    const metricsDurationMs = Number(message.metrics?.time_completion_millsec ?? 0)
    if (metricsDurationMs > 0) {
      return formatElapsedDuration(metricsDurationMs)
    }
    const firstGroupedBlockTimestamp = getGroupedBlockFirstTimestamp(groupedBlocks[0])
    const lastGroupedBlockTimestamp = getGroupedBlockLastTimestamp(groupedBlocks[groupedBlocks.length - 1])
    const messageCreatedAtTimestamp = resolveTimestamp(message.createdAt)
    const messageUpdatedAtTimestamp = resolveTimestamp(message.updatedAt)
    const startedAt = getEarliestTimestamp(
      messageCreatedAtTimestamp,
      firstGroupedBlockTimestamp,
      lastGroupedBlockTimestamp
    )
    const endedAt = getLatestTimestamp(messageUpdatedAtTimestamp, lastGroupedBlockTimestamp, messageCreatedAtTimestamp)
    const durationMs = Math.max(0, endedAt - startedAt)
    return formatElapsedDuration(durationMs)
  }, [groupedBlocks, hiddenGroupedBlocks.length, message.createdAt, message.metrics?.time_completion_millsec, message.updatedAt])

  const blocksToRender = isHistoryExpanded ? groupedBlocks : visibleGroupedBlocks

  const renderGroupedBlock = (block: GroupedBlock): React.ReactNode => {
    if (Array.isArray(block)) {
      const groupKey = [MessageBlockType.TOOL, MessageBlockType.THINKING].includes(block[0].type) ? block[0].id : block.map((b) => b.id).join('-')

      if (block[0].type === MessageBlockType.THINKING) {
        return (
          <AnimatedBlockWrapper key={groupKey} enableAnimation={message.status.includes('ing')}>
            <ThinkingBlock block={block[0] as ThinkingMessageBlock} blocks={block as ThinkingMessageBlock[]} />
          </AnimatedBlockWrapper>
        )
      }

      if (block[0].type === MessageBlockType.TOOL) {
        return (
          <AnimatedBlockWrapper key={groupKey} enableAnimation={message.status.includes('ing')}>
            <ToolBlockGroup blocks={block as ToolMessageBlock[]} />
          </AnimatedBlockWrapper>
        )
      }

      if (block[0].type === MessageBlockType.IMAGE) {
        if (block.length === 1) {
          return (
            <AnimatedBlockWrapper key={groupKey} enableAnimation={message.status.includes('ing')}>
              <ImageBlock key={block[0].id} block={block[0]} isSingle={true} />
            </AnimatedBlockWrapper>
          )
        }
        return (
          <AnimatedBlockWrapper key={groupKey} enableAnimation={message.status.includes('ing')}>
            <ImageBlockGroup count={block.length}>
              {block.map((imageBlock) => (
                <ImageBlock key={imageBlock.id} block={imageBlock as ImageMessageBlock} isSingle={false} />
              ))}
            </ImageBlockGroup>
          </AnimatedBlockWrapper>
        )
      } else if (block[0].type === MessageBlockType.VIDEO) {
        if (!isVideoBlock(block[0])) {
          logger.warn('Expected video block but got different type', block[0])
          return null
        }
        const firstVideoBlock = block[0]
        return (
          <AnimatedBlockWrapper key={groupKey} enableAnimation={message.status.includes('ing')}>
            <VideoBlock key={firstVideoBlock.id} block={firstVideoBlock} />
          </AnimatedBlockWrapper>
        )
      }
      return null
    }

    let blockComponent: React.ReactNode = null

    switch (block.type) {
      case MessageBlockType.UNKNOWN:
        break
      case MessageBlockType.MAIN_TEXT:
      case MessageBlockType.CODE: {
        if (!isMainTextBlock(block)) {
          logger.warn('Expected main text block but got different type', block)
          break
        }
        const mainTextBlock = block
        const citationBlockId = mainTextBlock.citationReferences?.[0]?.citationBlockId

        blockComponent = (
          <MainTextBlock
            key={block.id}
            block={mainTextBlock}
            citationBlockId={citationBlockId}
            role={message.role}
          />
        )
        break
      }
      case MessageBlockType.IMAGE:
        blockComponent = <ImageBlock key={block.id} block={block} />
        break
      case MessageBlockType.FILE:
        blockComponent = <FileBlock key={block.id} block={block} />
        break
      case MessageBlockType.TOOL:
        blockComponent = <ToolBlock key={block.id} block={block} />
        break
      case MessageBlockType.CITATION:
        blockComponent = <CitationBlock key={block.id} block={block} />
        break
      case MessageBlockType.ERROR:
        blockComponent = <ErrorBlock key={block.id} block={block} message={message} />
        break
      case MessageBlockType.THINKING:
        blockComponent = <ThinkingBlock key={block.id} block={block} />
        break
      case MessageBlockType.TRANSLATION:
        blockComponent = <TranslationBlock key={block.id} block={block} />
        break
      case MessageBlockType.VIDEO:
        blockComponent = <VideoBlock key={block.id} block={block} />
        break
      case MessageBlockType.COMPACT:
        blockComponent = <CompactBlock key={block.id} block={block} />
        break
      default:
        logger.warn('Unsupported block type in MessageBlockRenderer:', (block as any).type, block)
        break
    }

    return (
      <AnimatedBlockWrapper key={block.id} enableAnimation={message.status.includes('ing')}>
        {blockComponent}
      </AnimatedBlockWrapper>
    )
  }

  return (
    <AnimatePresence mode="sync">
      {!isProcessing && hiddenGroupedBlocks.length > 0 && (
        <HistoryToggleButton type="button" onClick={() => setIsHistoryExpanded((prev) => !prev)}>
          <HistoryToggleLabel>已完成</HistoryToggleLabel>
          <HistoryToggleDuration>{completionDurationLabel}</HistoryToggleDuration>
          <HistoryToggleArrow $expanded={isHistoryExpanded} size={16} strokeWidth={1.5} />
        </HistoryToggleButton>
      )}
      {blocksToRender.map(renderGroupedBlock)}
      {shouldShowProcessingPlaceholder && (
        <AnimatedBlockWrapper key="message-loading-placeholder" enableAnimation={true}>
          <PlaceholderBlock
            block={{
              id: `loading-${message.id}`,
              messageId: message.id,
              type: MessageBlockType.UNKNOWN,
              status: MessageBlockStatus.PROCESSING,
              createdAt: new Date().toISOString(),
              metadata:
                processingLoadingLabel || processingStartedAt
                  ? {
                      ...(processingLoadingLabel ? { loadingLabel: processingLoadingLabel } : {}),
                      ...(processingStartedAt ? { processingStartedAt } : {})
                    }
                  : undefined
            }}
          />
        </AnimatedBlockWrapper>
      )}
    </AnimatePresence>
  )
}

export default React.memo(MessageBlockRenderer)

const ImageBlockGroup = styled.div<{ count: number }>`
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  max-width: 100%;
`

const HistoryToggleButton = styled.button`
  width: 100%;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0px 0 10px;
  border: none;
  background: transparent;
  color: #7f7f7f;
  cursor: pointer;
  text-align: left;

  &:hover {
    color: #000000;
  }
`

const HistoryToggleLabel = styled.span`
  font-size: 14px;
`

const HistoryToggleDuration = styled.span`
  font-size: 14px;
`

const HistoryToggleArrow = styled(ChevronRight)<{ $expanded: boolean }>`
  color: currentColor;
  transform: ${({ $expanded }) => ($expanded ? 'rotate(90deg)' : 'rotate(0deg)')};
  transition: transform 0.2s ease;
`
