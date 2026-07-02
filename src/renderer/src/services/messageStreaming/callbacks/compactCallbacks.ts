import { loggerService } from '@logger'
import type { AppDispatch, RootState } from '@renderer/store'
import { updateOneBlock } from '@renderer/store/messageBlock'
import { newMessagesActions } from '@renderer/store/newMessage'
import type { MainTextMessageBlock } from '@renderer/types/newMessage'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { createCompactBlock } from '@renderer/utils/messageUtils/create'
import type { ClaudeCodeRawValue } from '@shared/agents/claudecode/types'

import type { BlockManager } from '../BlockManager'

const logger = loggerService.withContext('CompactCallbacks')
const CONTINUATION_SUMMARY_PREFIX = 'This session is being continued from a previous conversation that ran out of context.'
const CONTINUATION_SUMMARY_PREFIX_WITH_SUFFIX =
  'This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier part of the conversation.'

interface CompactCallbacksDeps {
  blockManager: BlockManager
  assistantMsgId: string
  dispatch: AppDispatch
  getState: () => RootState
  topicId: string
  saveUpdatesToDB: any
}

interface CompactState {
  compactBoundaryDetected: boolean
  loadingBlockId: string | null
  summaryBlockId: string | null
  isFirstBlockAfterCompact: boolean
  summaryText: string
}

export const createCompactCallbacks = (deps: CompactCallbacksDeps) => {
  const { blockManager, assistantMsgId, dispatch, getState, topicId, saveUpdatesToDB } = deps

  // State to track compact command processing
  const compactState: CompactState = {
    compactBoundaryDetected: false,
    loadingBlockId: null,
    summaryBlockId: null,
    isFirstBlockAfterCompact: false,
    summaryText: ''
  }

  /**
   * Extracts content from <local-command-stdout> XML tags
   */
  const extractCompactedContent = (text: string): string => {
    const match = text.match(/<local-command-(stdout|stderr)>(.*?)<\/local-command-(stdout|stderr)>/s)
    return match ? match[2].trim() : ''
  }

  /**
   * Checks if text contains local-command-stdout tags
   */
  const hasCompactedContent = (text: string): boolean => {
    return /<local-command-(stdout|stderr)>.*?<\/local-command-(stdout|stderr)>/s.test(text)
  }

  /**
   * Claude Code may emit an auto-continuation summary as plain text instead of
   * the explicit /compact boundary + XML payload flow. Detect that boilerplate
   * so we can still collapse it into the compact UI.
   */
  const isContinuationSummary = (text: string): boolean => {
    const normalized = text.trim()
    return (
      normalized.startsWith(CONTINUATION_SUMMARY_PREFIX) &&
      (normalized.includes('\nSummary:') ||
        normalized.includes('\n\nSummary:') ||
        normalized.includes('The summary below covers the earlier part of the conversation.'))
    )
  }

  const stripContinuationSummaryPreamble = (text: string): string => {
    const normalized = text.trim()
    if (normalized.startsWith(CONTINUATION_SUMMARY_PREFIX_WITH_SUFFIX)) {
      return normalized.slice(CONTINUATION_SUMMARY_PREFIX_WITH_SUFFIX.length).trim()
    }
    if (normalized.startsWith(CONTINUATION_SUMMARY_PREFIX)) {
      return normalized.slice(CONTINUATION_SUMMARY_PREFIX.length).trim()
    }
    return normalized
  }

  const persistCompactBlock = async (blockId: string) => {
    const updatedState = getState()
    const updatedMessage = updatedState.messages.entities[assistantMsgId]
    const updatedBlock = updatedState.messageBlocks.entities[blockId]
    if (updatedMessage && updatedBlock) {
      await saveUpdatesToDB(assistantMsgId, topicId, { blocks: updatedMessage.blocks }, [updatedBlock])
    }
  }

  const ensureLoadingBlock = () => {
    if (compactState.loadingBlockId) {
      return compactState.loadingBlockId
    }

    const loadingBlock = createCompactBlock(assistantMsgId, '', '', {
      status: MessageBlockStatus.PROCESSING
    })
    compactState.loadingBlockId = loadingBlock.id
    void blockManager.handleBlockTransition(loadingBlock, MessageBlockType.COMPACT)
    return loadingBlock.id
  }

  const resetCompactState = () => {
    compactState.compactBoundaryDetected = false
    compactState.loadingBlockId = null
    compactState.summaryBlockId = null
    compactState.summaryText = ''
    compactState.isFirstBlockAfterCompact = false
  }

  const removeBlockReference = async (blockId: string) => {
    const currentState = getState()
    const currentMessage = currentState.messages.entities[assistantMsgId]
    if (!currentMessage?.blocks?.includes(blockId)) {
      return
    }

    const updatedBlocks = currentMessage.blocks.filter((id: string) => id !== blockId)
    dispatch(
      newMessagesActions.updateMessage({
        topicId,
        messageId: assistantMsgId,
        updates: { blocks: updatedBlocks }
      })
    )

    await saveUpdatesToDB(assistantMsgId, topicId, { blocks: updatedBlocks }, [])
  }

  const convertSummaryBlockToCompact = async (summaryBlockId: string, summaryText: string, compactedContent: string) => {
    dispatch(
      updateOneBlock({
        id: summaryBlockId,
        changes: {
          type: MessageBlockType.COMPACT,
          content: summaryText,
          compactedContent,
          status: MessageBlockStatus.SUCCESS
        }
      })
    )

    dispatch(
      newMessagesActions.upsertBlockReference({
        messageId: assistantMsgId,
        blockId: summaryBlockId,
        status: MessageBlockStatus.SUCCESS,
        blockType: MessageBlockType.COMPACT
      })
    )

    blockManager.activeBlockInfo = null
    blockManager.lastBlockType = MessageBlockType.COMPACT
  }

  /**
   * Called when raw data is received from the stream
   */
  const onRawData = (content: unknown, metadata?: Record<string, any>) => {
    logger.debug('Raw data received', { content, metadata })

    const rawValue = content as ClaudeCodeRawValue
    const compactStatus = (rawValue as { status?: string } | null)?.status || ''

    if (rawValue.type === 'compact_status' && compactStatus === 'compacting') {
      logger.info('Compact status detected before boundary')
      ensureLoadingBlock()
      return
    }

    // Check if this is a compact_boundary message
    if (rawValue.type === 'compact') {
      logger.info('Compact boundary detected')
      compactState.compactBoundaryDetected = true
      ensureLoadingBlock()
      compactState.summaryBlockId = null
      compactState.isFirstBlockAfterCompact = true
      compactState.summaryText = ''
    }
  }

  /**
   * Intercept text complete to detect compacted content and create compact block
   */
  const handleTextComplete = async (text: string, currentMainTextBlockId: string | null) => {
    if (!currentMainTextBlockId) {
      return false
    }

    // Get the current main text block to check its full content
    const state = getState()
    const currentBlock = state.messageBlocks.entities[currentMainTextBlockId] as MainTextMessageBlock | undefined

    if (!currentBlock) {
      return false
    }

    const fullContent = currentBlock.content || text

    if (!compactState.compactBoundaryDetected && isContinuationSummary(fullContent)) {
      const summaryText = stripContinuationSummaryPreamble(fullContent)
      logger.info('Detected Claude Code continuation summary', {
        currentMainTextBlockId,
        summaryPreview: summaryText.slice(0, 200)
      })
      await convertSummaryBlockToCompact(currentMainTextBlockId, summaryText, '')
      await persistCompactBlock(currentMainTextBlockId)
      return true
    }

    if (!compactState.compactBoundaryDetected) {
      return false
    }

    // First block after compact_boundary: This is the summary
    if (compactState.isFirstBlockAfterCompact) {
      logger.info('Detected first block after compact boundary (summary)', { fullContent })
      const compactBlockId = compactState.loadingBlockId || currentMainTextBlockId

      if (isContinuationSummary(fullContent)) {
        const summaryText = stripContinuationSummaryPreamble(fullContent)
        resetCompactState()
        await convertSummaryBlockToCompact(compactBlockId, summaryText, '')
        if (currentMainTextBlockId !== compactBlockId) {
          await removeBlockReference(currentMainTextBlockId)
        }
        await persistCompactBlock(compactBlockId)
        return true
      }

      // Store the summary text and block ID
      compactState.summaryText = fullContent
      compactState.summaryBlockId = compactBlockId
      compactState.isFirstBlockAfterCompact = false

      if (compactBlockId !== currentMainTextBlockId) {
        dispatch(
          updateOneBlock({
            id: compactBlockId,
            changes: {
              content: fullContent,
              status: MessageBlockStatus.PROCESSING
            }
          })
        )
        await removeBlockReference(currentMainTextBlockId)
        await persistCompactBlock(compactBlockId)
        return true
      }

      // Hide this block by marking it as a placeholder temporarily
      // We'll convert it to compact block when we get the second block
      dispatch(
        updateOneBlock({
          id: currentMainTextBlockId,
          changes: {
            status: MessageBlockStatus.PROCESSING
          }
        })
      )

      return true // Prevent normal text block completion
    }

    // Second block after compact_boundary: Should contain the XML tags
    if (compactState.summaryBlockId && hasCompactedContent(fullContent)) {
      logger.info('Detected second block with compacted content', { fullContent })

      const compactedContent = extractCompactedContent(fullContent)
      const summaryBlockId = compactState.summaryBlockId
      const summaryText = compactState.summaryText

      logger.info('Converting summary block to compact block', {
        summaryText,
        compactedContent,
        summaryBlockId
      })

      resetCompactState()
      await convertSummaryBlockToCompact(summaryBlockId, summaryText, compactedContent)

      // Remove the current block (the one with XML tags) from message.blocks
      await removeBlockReference(currentMainTextBlockId)

      await persistCompactBlock(summaryBlockId)

      return true
    }

    return false
  }

  return {
    onRawData,
    handleTextComplete
  }
}
