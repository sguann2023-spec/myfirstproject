import { loggerService } from '@logger'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import type { RootState } from '@renderer/store'
import { messageBlocksSelectors } from '@renderer/store/messageBlock'
import type { ImageMessageBlock, Message, MessageBlock } from '@renderer/types/newMessage'
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
import ImageBlock from './ImageBlock'
import MainTextBlock from './MainTextBlock'
import PlaceholderBlock from './PlaceholderBlock'
import ThinkingBlock from './ThinkingBlock'
import ToolBlock from './ToolBlock'
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
  messageStatus?: Message['status']
  message: Message
}

type GroupedBlock = MessageBlock[] | MessageBlock

const groupSimilarBlocks = (blocks: MessageBlock[]): GroupedBlock[] => {
  return blocks.reduce((acc: GroupedBlock[], currentBlock) => {
    if (currentBlock.type === MessageBlockType.IMAGE) {
      // 对于IMAGE类型，按连续分组
      const prevGroup = acc[acc.length - 1]
      if (Array.isArray(prevGroup) && prevGroup[0].type === MessageBlockType.IMAGE) {
        prevGroup.push(currentBlock)
      } else {
        acc.push([currentBlock])
      }
    } else if (currentBlock.type === MessageBlockType.VIDEO) {
      // 对于VIDEO类型，按相同filePath分组
      if (!isVideoBlock(currentBlock)) {
        logger.warn('Block type is VIDEO but failed type guard check', currentBlock)
        acc.push(currentBlock)
        return acc
      }
      const videoBlock = currentBlock
      const existingGroup = acc.find(
        (group) =>
          Array.isArray(group) &&
          group[0].type === MessageBlockType.VIDEO &&
          isVideoBlock(group[0]) &&
          group[0].filePath === videoBlock.filePath
      ) as MessageBlock[] | undefined

      if (existingGroup) {
        existingGroup.push(currentBlock)
      } else {
        acc.push([currentBlock])
      }
    } else if (currentBlock.type === MessageBlockType.TOOL) {
      // TOOL 类型不聚合，按消息顺序逐条渲染。
      acc.push(currentBlock)
    } else {
      acc.push(currentBlock)
    }
    return acc
  }, [])
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

  switch (block.type) {
    case MessageBlockType.MAIN_TEXT:
    case MessageBlockType.CODE:
    case MessageBlockType.IMAGE:
    case MessageBlockType.FILE:
    case MessageBlockType.VIDEO:
    case MessageBlockType.TRANSLATION:
    case MessageBlockType.COMPACT:
    case MessageBlockType.ERROR:
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

const MessageBlockRenderer: React.FC<Props> = ({ blocks, message }) => {
  // 始终调用useSelector，避免条件调用Hook
  const blockEntities = useSelector((state: RootState) => messageBlocksSelectors.selectEntities(state))
  // 根据blocks类型处理渲染数据
  const renderedBlocks = blocks.map((blockId) => blockEntities[blockId]).filter(Boolean)
  const groupedBlocks = useMemo(() => groupSimilarBlocks(renderedBlocks), [renderedBlocks])

  // Check if message is still processing
  const isProcessing = isMessageProcessing(message)
  // Keep the trailing loading indicator visible for the whole processing window,
  // even after main text or tool blocks have already rendered.
  const shouldShowProcessingPlaceholder = isProcessing

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
    return groupedBlocks.slice(0, resultAnchorIndex)
  }, [groupedBlocks, isProcessing, message.role, resultAnchorIndex])

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
      const groupKey = block.map((b) => b.id).join('-')

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
              createdAt: new Date().toISOString()
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
