import { loggerService } from '@logger'
import type { AppDispatch } from '@renderer/store'
import { selectUniqueActivePermissionByToolName, toolPermissionsActions } from '@renderer/store/toolPermissions'
import type { MCPToolResponse, NormalToolResponse } from '@renderer/types'
import { WEB_SEARCH_SOURCE } from '@renderer/types'
import type { FileMessageBlock, ImageMessageBlock, Message, ToolMessageBlock } from '@renderer/types/newMessage'
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
  userMessageId: string
  dispatch: AppDispatch
  getState: () => any
}

const IMAGE_GENERATION_TOOL_NAMES = new Set([
  'generate_or_edit_image',
  'mcp__image__generate_or_edit_image',
  'generate_image',
  'mcp__image__generate_image'
])

const toFileUrl = (path: string): string => {
  const normalized = String(path || '').trim()
  if (!normalized) return ''
  return normalized.startsWith('file://') ? normalized : `file://${normalized}`
}

const normalizeFileExt = (ext: string | undefined): string => {
  const normalized = String(ext || '').trim()
  if (!normalized) return ''
  return normalized.startsWith('.') ? normalized : `.${normalized}`
}

const resolveLocalPreviewPath = (state: any, file: { path?: string; id?: string; ext?: string } | undefined): string => {
  if (!file) return ''

  const existingPath = String(file.path || '').trim()
  if (existingPath) {
    return existingPath
  }

  const fileId = String(file.id || '').trim()
  if (!fileId) {
    return ''
  }

  const filesPath = String(state?.runtime?.filesPath || '').trim()
  if (!filesPath) {
    return ''
  }

  return `${filesPath}/${fileId}${normalizeFileExt(file.ext)}`
}

const collectPreviewSourcesFromMessage = (state: any, message: Message | undefined): string[] => {
  if (!message?.blocks?.length) {
    return []
  }

  const previewSources: string[] = []
  for (const blockId of message.blocks) {
    const block = state?.messageBlocks?.entities?.[blockId] as ImageMessageBlock | undefined
    if (!block) {
      continue
    }

    if (block.type === MessageBlockType.IMAGE) {
      const imageBlock = block as ImageMessageBlock
      const localPreviewPath = resolveLocalPreviewPath(state, imageBlock.file)
      if (localPreviewPath) {
        previewSources.push(toFileUrl(localPreviewPath))
      }

      const generatedImages = imageBlock.metadata?.generateImageResponse?.images ?? []
      generatedImages.forEach((image: string) => {
        if (typeof image === 'string' && image.trim()) {
          previewSources.push(image.trim())
        }
      })

      if (imageBlock.url && typeof imageBlock.url === 'string' && imageBlock.url.trim()) {
        previewSources.push(imageBlock.url.trim())
      }
      continue
    }

    if (block.type === MessageBlockType.FILE) {
      const fileBlock = block as FileMessageBlock
      const file = fileBlock.file
      const fileType = String(file?.type || '').toLowerCase()
      const fileExt = String(file?.ext || '').toLowerCase()
      const isImageFile =
        fileType === 'image' || /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(fileExt.startsWith('.') ? fileExt : `.${fileExt}`)

      if (isImageFile) {
        const localPreviewPath = resolveLocalPreviewPath(state, file)
        if (localPreviewPath) {
          previewSources.push(toFileUrl(localPreviewPath))
        }
      }
    }
  }

  return Array.from(new Set(previewSources))
}

const getUserImagePreviewSources = (
  state: any,
  userMessageId: string,
  assistantMsgId: string
): { previewSources: string[]; matchedMessageId?: string; strategy: 'direct' | 'topic_fallback' | 'none' } => {
  const assistantMessage = state?.messages?.entities?.[assistantMsgId] as Message | undefined
  const directCandidateId = String(userMessageId || assistantMessage?.askId || '').trim()
  const directMessage = directCandidateId ? ((state?.messages?.entities?.[directCandidateId] as Message | undefined) ?? undefined) : undefined
  const directSources = collectPreviewSourcesFromMessage(state, directMessage)
  if (directSources.length > 0) {
    return {
      previewSources: directSources,
      matchedMessageId: directMessage?.id,
      strategy: 'direct'
    }
  }

  const topicId = assistantMessage?.topicId
  const topicMessageIds = topicId ? (state?.messages?.messageIdsByTopic?.[topicId] as string[] | undefined) : undefined
  if (!topicMessageIds?.length) {
    return { previewSources: [], strategy: 'none' }
  }

  const assistantIndex = assistantMessage ? topicMessageIds.lastIndexOf(assistantMessage.id) : -1
  const startIndex = assistantIndex >= 0 ? assistantIndex - 1 : topicMessageIds.length - 1

  for (let index = startIndex; index >= 0; index -= 1) {
    const candidateMessageId = topicMessageIds[index]
    const candidateMessage = state?.messages?.entities?.[candidateMessageId] as Message | undefined
    if (!candidateMessage || candidateMessage.role !== 'user') {
      continue
    }

    const previewSources = collectPreviewSourcesFromMessage(state, candidateMessage)
    if (previewSources.length > 0) {
      return {
        previewSources,
        matchedMessageId: candidateMessage.id,
        strategy: 'topic_fallback'
      }
    }
  }

  return { previewSources: [], strategy: 'none' }
}

const enhanceImageGenerationArguments = (
  toolName: string | undefined,
  args: unknown,
  state: any,
  userMessageId: string,
  assistantMsgId: string
): unknown => {
  if (!IMAGE_GENERATION_TOOL_NAMES.has(String(toolName || '')) || !isPlainObject(args)) {
    return args
  }

  const record = { ...(args as Record<string, unknown>) }
  const referenceImages = [
    record.referenceImages,
    record.reference_images,
    record.sourceImages,
    record.source_images,
    record.referenceImage,
    record.reference_image,
    record.sourceImage,
    record.source_image,
    record.baseImage,
    record.base_image,
    record.editImage,
    record.edit_image
  ].flatMap((candidate) => {
    if (Array.isArray(candidate)) {
      return candidate.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
    }
    if (typeof candidate === 'string' && candidate.trim()) {
      return [candidate.trim()]
    }
    return []
  })

  if (!referenceImages.length) {
    return record
  }

  const { previewSources: userPreviewSources } = getUserImagePreviewSources(state, userMessageId, assistantMsgId)
  if (!userPreviewSources.length) {
    return record
  }

  const existingPrepared = Array.isArray(record.reference_images_prepared) ? record.reference_images_prepared : []
  const mergedPrepared = referenceImages.map((item, index) => {
    const originalInput = typeof item === 'string' ? item : String(item ?? '')
    const existingItem = isPlainObject(existingPrepared[index]) ? (existingPrepared[index] as Record<string, unknown>) : {}
    const previewUrl =
      (typeof existingItem.previewUrl === 'string' && existingItem.previewUrl.trim() && existingItem.previewUrl.trim()) ||
      (typeof existingItem.preview_url === 'string' && existingItem.preview_url.trim() && existingItem.preview_url.trim()) ||
      userPreviewSources[index]

    return {
      originalInput,
      submittedUrl:
        (typeof existingItem.submittedUrl === 'string' && existingItem.submittedUrl.trim()) ||
        (typeof existingItem.submitted_url === 'string' && existingItem.submitted_url.trim()) ||
        originalInput,
      previewUrl,
      sourceKind: typeof previewUrl === 'string' && previewUrl.startsWith('file://') ? 'local_file' : 'remote_url'
    }
  })

  record.reference_images_prepared = mergedPrepared.filter((item) => item.previewUrl)
  return record
}

export const createToolCallbacks = (deps: ToolCallbacksDependencies) => {
  const { blockManager, assistantMsgId, userMessageId, dispatch, getState } = deps

  // 内部维护的状态
  const toolCallIdToBlockIdMap = new Map<string, string>()
  let toolBlockId: string | null = null
  let citationBlockId: string | null = null

  const normalizeToolPayloadSignature = (value: unknown): string => {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (!trimmed) return ''
      try {
        return JSON.stringify(JSON.parse(trimmed))
      } catch {
        return trimmed
      }
    }
    if (value === undefined) return ''
    try {
      return JSON.stringify(value) ?? ''
    } catch {
      return String(value)
    }
  }

  const getAskUserQuestionDedupSignature = (toolResponse: ToolResponse): string | null => {
    if (toolResponse.tool?.name !== 'AskUserQuestion') {
      return null
    }

    const payload = toolResponse.arguments ?? toolResponse.partialArguments
    const signature = normalizeToolPayloadSignature(payload)
    return signature ? `${toolResponse.tool.name}:${signature}` : null
  }

  const findEquivalentAskUserQuestionBlockId = (toolResponse: ToolResponse): string | undefined => {
    const signature = getAskUserQuestionDedupSignature(toolResponse)
    if (!signature) return undefined

    const state = getState()

    for (const [existingToolCallId, blockId] of toolCallIdToBlockIdMap.entries()) {
      if (existingToolCallId === toolResponse.id) continue

      const block = state.messageBlocks.entities[blockId] as ToolMessageBlock | undefined
      const existingResponse = block?.metadata?.rawMcpToolResponse as ToolResponse | undefined
      if (!existingResponse) continue

      if (getAskUserQuestionDedupSignature(existingResponse) === signature) {
        logger.warn('Deduplicating duplicate AskUserQuestion block', {
          existingToolCallId,
          duplicateToolCallId: toolResponse.id,
          blockId
        })
        return blockId
      }
    }

    return undefined
  }

  return {
    onToolCallPending: (toolResponse: ToolResponse) => {
      const state = getState()
      const nextToolResponse = sanitizeToolResponse({
        ...toolResponse,
        arguments: enhanceImageGenerationArguments(toolResponse.tool?.name, toolResponse.arguments, state, userMessageId, assistantMsgId)
      })
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

      const equivalentBlockId = findEquivalentAskUserQuestionBlockId(nextToolResponse)
      if (equivalentBlockId) {
        toolCallIdToBlockIdMap.set(nextToolResponse.id, equivalentBlockId)
        blockManager.smartBlockUpdate(
          equivalentBlockId,
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
      const state = getState()
      const nextToolResponse = sanitizeToolResponse({
        ...toolResponse,
        arguments: enhanceImageGenerationArguments(toolResponse.tool?.name, toolResponse.arguments, state, userMessageId, assistantMsgId)
      })
      // Find or create the tool block for streaming updates
      let existingBlockId = toolCallIdToBlockIdMap.get(nextToolResponse.id)

      if (!existingBlockId) {
        const equivalentBlockId = findEquivalentAskUserQuestionBlockId(nextToolResponse)
        if (equivalentBlockId) {
          toolCallIdToBlockIdMap.set(nextToolResponse.id, equivalentBlockId)
          existingBlockId = equivalentBlockId
        }
      }

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
      const baseState = getState()
      const nextToolResponse = sanitizeToolResponse({
        ...toolResponse,
        arguments: enhanceImageGenerationArguments(
          toolResponse.tool?.name,
          toolResponse.arguments,
          baseState,
          userMessageId,
          assistantMsgId
        )
      })
      // Read resolvedInput BEFORE removing from store (removeByToolCallId deletes it)
      const state = getState()
      const toolPermissionsState = state.toolPermissions ?? { requests: {}, resolvedInputs: {} }
      const fallbackPermission =
        nextToolResponse.tool?.name === 'AskUserQuestion'
          ? selectUniqueActivePermissionByToolName(toolPermissionsState, 'AskUserQuestion')
          : undefined
      const resolvedInput =
        (nextToolResponse?.id ? toolPermissionsState.resolvedInputs[nextToolResponse.id] : undefined) ??
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
        const citationSource = nextToolResponse.responseRaw ?? nextToolResponse.response

        if (nextToolResponse.tool.name === 'builtin_web_search' && citationSource) {
          const citationBlock = createCitationBlock(
            assistantMsgId,
            {
              response: { results: citationSource, source: WEB_SEARCH_SOURCE.WEBSEARCH }
            },
            {
              status: MessageBlockStatus.SUCCESS
            }
          )
          citationBlockId = citationBlock.id
          void blockManager.handleBlockTransition(citationBlock, MessageBlockType.CITATION)
        }
        if (nextToolResponse.tool.name === 'builtin_knowledge_search' && citationSource) {
          const citationBlock = createCitationBlock(
            assistantMsgId,
            { knowledge: citationSource },
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
