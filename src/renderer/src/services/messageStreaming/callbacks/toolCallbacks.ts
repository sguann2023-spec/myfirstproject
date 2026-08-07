import { loggerService } from '@logger'
import type { AppDispatch } from '@renderer/store'
import store from '@renderer/store'
import { selectUniqueActivePermissionByToolName, toolPermissionsActions } from '@renderer/store/toolPermissions'
import type { MCPToolResponse, NormalToolResponse } from '@renderer/types'
import { WEB_SEARCH_SOURCE } from '@renderer/types'
import type { ToolMessageBlock } from '@renderer/types/newMessage'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { createCitationBlock, createToolBlock } from '@renderer/utils/messageUtils/create'
import { sanitizeInlinePayload } from '@shared/sessionPayloadLimits'
import { isPlainObject } from 'lodash'

import type { BlockManager } from '../BlockManager'

const logger = loggerService.withContext('ToolCallbacks')

type ToolResponse = MCPToolResponse | NormalToolResponse

const sanitizeToolResponse = (toolResponse: ToolResponse): ToolResponse => {
  const toolName = String(toolResponse?.tool?.name || 'tool')
  return {
    ...toolResponse,
    arguments: sanitizeInlinePayload(toolResponse.arguments, { label: `${toolName} 输入` }) as ToolResponse['arguments'],
    partialArguments: sanitizeInlinePayload(toolResponse.partialArguments, {
      label: `${toolName} 流式输入`
    }) as ToolResponse['partialArguments'],
    response: sanitizeInlinePayload(toolResponse.response, { label: `${toolName} 回包` }) as ToolResponse['response']
  }
}

interface ToolCallbacksDependencies {
  blockManager: BlockManager
  assistantMsgId: string
  dispatch: AppDispatch
}

export const createToolCallbacks = (deps: ToolCallbacksDependencies) => {
  const { blockManager, assistantMsgId, dispatch } = deps

  // 内部维护的状态
  const toolCallIdToBlockIdMap = new Map<string, string>()
  let toolBlockId: string | null = null
  let citationBlockId: string | null = null

  return {
    onToolCallPending: (toolResponse: ToolResponse) => {
      const nextToolResponse = sanitizeToolResponse(toolResponse)
      logger.debug('onToolCallPending', nextToolResponse)
      const existingBlockId = toolCallIdToBlockIdMap.get(nextToolResponse.id)

      if (existingBlockId) {
        blockManager.smartBlockUpdate(
          existingBlockId,
          {
            status: MessageBlockStatus.PENDING,
            metadata: { rawMcpToolResponse: nextToolResponse }
          },
          MessageBlockType.TOOL
        )
        return
      }

      if (blockManager.hasInitialPlaceholder) {
        const changes = {
          type: MessageBlockType.TOOL,
          status: MessageBlockStatus.PENDING,
          toolName: nextToolResponse.tool.name,
          metadata: { rawMcpToolResponse: nextToolResponse }
        }
        toolBlockId = blockManager.initialPlaceholderBlockId!
        blockManager.smartBlockUpdate(toolBlockId, changes, MessageBlockType.TOOL)
        toolCallIdToBlockIdMap.set(nextToolResponse.id, toolBlockId)
      } else if (nextToolResponse.status === 'pending') {
        const toolBlock = createToolBlock(assistantMsgId, nextToolResponse.id, {
          toolName: nextToolResponse.tool.name,
          status: MessageBlockStatus.PENDING,
          metadata: { rawMcpToolResponse: nextToolResponse }
        })
        toolBlockId = toolBlock.id
        void blockManager.handleBlockTransition(toolBlock, MessageBlockType.TOOL)
        toolCallIdToBlockIdMap.set(nextToolResponse.id, toolBlock.id)
      } else {
        logger.warn(
          `[onToolCallPending] Received unhandled tool status: ${nextToolResponse.status} for ID: ${nextToolResponse.id}`
        )
      }
    },

    onToolArgumentStreaming: (toolResponse: ToolResponse) => {
      const nextToolResponse = sanitizeToolResponse(toolResponse)
      // Find or create the tool block for streaming updates
      let existingBlockId = toolCallIdToBlockIdMap.get(nextToolResponse.id)

      if (!existingBlockId) {
        // Create a new tool block if one doesn't exist yet
        if (blockManager.hasInitialPlaceholder) {
          const changes = {
            type: MessageBlockType.TOOL,
            status: MessageBlockStatus.PENDING,
            toolName: nextToolResponse.tool.name,
            metadata: { rawMcpToolResponse: nextToolResponse }
          }
          toolBlockId = blockManager.initialPlaceholderBlockId!
          blockManager.smartBlockUpdate(toolBlockId, changes, MessageBlockType.TOOL)
          toolCallIdToBlockIdMap.set(nextToolResponse.id, toolBlockId)
          existingBlockId = toolBlockId
        } else {
          const toolBlock = createToolBlock(assistantMsgId, nextToolResponse.id, {
            toolName: nextToolResponse.tool.name,
            status: MessageBlockStatus.PENDING,
            metadata: { rawMcpToolResponse: nextToolResponse }
          })
          toolBlockId = toolBlock.id
          void blockManager.handleBlockTransition(toolBlock, MessageBlockType.TOOL)
          toolCallIdToBlockIdMap.set(nextToolResponse.id, toolBlock.id)
          existingBlockId = toolBlock.id
        }
      }

      // Update the tool block with streaming arguments
      const changes: Partial<ToolMessageBlock> = {
        status: MessageBlockStatus.PENDING,
        metadata: { rawMcpToolResponse: nextToolResponse }
      }

      blockManager.smartBlockUpdate(existingBlockId, changes, MessageBlockType.TOOL)
    },

    onToolCallComplete: (toolResponse: ToolResponse) => {
      const nextToolResponse = sanitizeToolResponse(toolResponse)
      // Read resolvedInput BEFORE removing from store (removeByToolCallId deletes it)
      const state = store.getState()
      const fallbackPermission =
        nextToolResponse.tool?.name === 'AskUserQuestion'
          ? selectUniqueActivePermissionByToolName(state.toolPermissions, 'AskUserQuestion')
          : undefined
      const resolvedInput =
        (nextToolResponse?.id ? state.toolPermissions.resolvedInputs[nextToolResponse.id] : undefined) ??
        fallbackPermission?.resolvedInput

      if (nextToolResponse?.id) {
        dispatch(toolPermissionsActions.removeByToolCallId({ toolCallId: nextToolResponse.id }))
      }
      if (fallbackPermission?.toolCallId && fallbackPermission.toolCallId !== nextToolResponse?.id) {
        dispatch(toolPermissionsActions.removeByToolCallId({ toolCallId: fallbackPermission.toolCallId }))
      }
      const existingBlockId = toolCallIdToBlockIdMap.get(nextToolResponse.id)
      toolCallIdToBlockIdMap.delete(nextToolResponse.id)

      if (nextToolResponse.status === 'done' || nextToolResponse.status === 'error' || nextToolResponse.status === 'cancelled') {
        if (!existingBlockId) {
          logger.error(
            `[onToolCallComplete] No existing block found for completed/error tool call ID: ${nextToolResponse.id}. Cannot update.`
          )
          return
        }

        const finalStatus =
          nextToolResponse.status === 'done' || nextToolResponse.status === 'cancelled'
            ? MessageBlockStatus.SUCCESS
            : MessageBlockStatus.ERROR

        const existingBlock = state.messageBlocks.entities[existingBlockId] as ToolMessageBlock | undefined

        const existingResponse = existingBlock?.metadata?.rawMcpToolResponse
        // Merge order: toolResponse.arguments (base) -> existingResponse?.arguments -> resolvedInput (user answers take precedence)
        const mergedArguments = Object.assign(
          {},
          isPlainObject(nextToolResponse.arguments) ? nextToolResponse.arguments : null,
          isPlainObject(existingResponse?.arguments) ? existingResponse?.arguments : null,
          isPlainObject(resolvedInput) ? resolvedInput : null
        )

        const mergedToolResponse: MCPToolResponse | NormalToolResponse = {
          ...(existingResponse ?? nextToolResponse),
          ...nextToolResponse,
          arguments: sanitizeInlinePayload(mergedArguments, { label: `${nextToolResponse.tool.name} 输入` }) as typeof mergedArguments,
          partialArguments: undefined // Strip redundant streaming buffer to free memory
        }

        const changes: Partial<ToolMessageBlock> = {
          content: nextToolResponse.response,
          status: finalStatus,
          metadata: { rawMcpToolResponse: mergedToolResponse }
        }

        if (finalStatus === MessageBlockStatus.ERROR) {
          changes.error = {
            message: `Tool execution failed/error`,
            details: nextToolResponse.response,
            name: null,
            stack: null
          }
        }
        blockManager.smartBlockUpdate(existingBlockId, changes, MessageBlockType.TOOL, true)
        // Handle citation block creation for web search results
        if (nextToolResponse.tool.name === 'builtin_web_search' && nextToolResponse.response) {
          const citationBlock = createCitationBlock(
            assistantMsgId,
            {
              response: { results: nextToolResponse.response, source: WEB_SEARCH_SOURCE.WEBSEARCH }
            },
            {
              status: MessageBlockStatus.SUCCESS
            }
          )
          citationBlockId = citationBlock.id
          void blockManager.handleBlockTransition(citationBlock, MessageBlockType.CITATION)
        }
        if (nextToolResponse.tool.name === 'builtin_knowledge_search' && nextToolResponse.response) {
          const citationBlock = createCitationBlock(
            assistantMsgId,
            { knowledge: nextToolResponse.response },
            {
              status: MessageBlockStatus.SUCCESS
            }
          )
          citationBlockId = citationBlock.id
          void blockManager.handleBlockTransition(citationBlock, MessageBlockType.CITATION)
        }
      } else {
        logger.warn(
          `[onToolCallComplete] Received unhandled tool status: ${nextToolResponse.status} for ID: ${nextToolResponse.id}`
        )
      }

      toolBlockId = null
    },

    // 暴露给 textCallbacks 使用的方法
    getCitationBlockId: () => citationBlockId
  }
}
