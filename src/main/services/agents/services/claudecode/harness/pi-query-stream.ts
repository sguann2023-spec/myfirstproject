import { randomUUID } from 'node:crypto'

import { loggerService } from '@logger'
import type { LanguageModelUsage, ProviderMetadata, TextStreamPart } from 'ai'
import { limitInlineToolPayload } from '@shared/sessionPayloadLimits'

import type { AgentStream } from '../../../interfaces/AgentStreamInterface'
import { agentTurnRepository } from '../../../database/repositories/agentTurnRepository'
import { emitCancelled, emitChunk, emitError, emitLifecycleEvent } from './event-adapter'
import {
  handleToolResultSideEffects,
  type QueryArchitectureContext
} from './query-side-effects'
import { conversationSegmentService } from '../session-architecture/ConversationSegmentService'
import type { AgentConversationSegment, AgentTurn } from '../session-architecture/types'
import type { ClaudeCodeHarnessAdapter } from './create-harness'
import type { SessionArchitectureContext } from './query-stream'
import { buildInlineToolResultPayload } from './tool-result-payload'

const logger = loggerService.withContext('ClaudeCodePiQuery')

const DEFAULT_PI_TERMINAL_TIMEOUT_MS = 120_000
const PI_NETWORK_RETRY_LIMIT = 5
const PI_NETWORK_RETRY_BASE_DELAY_MS = 800

type PendingToolCall = {
  emittedId: string
  providerToolCallId: string
  toolName: string
  input?: unknown
}

type PiToolCallSnapshot = {
  contentIndex: number
  id: string
  name: string
  arguments: unknown
}

function mapPiStopReason(reason: string | undefined): 'stop' | 'length' | 'tool-calls' | 'error' {
  if (reason === 'length') return 'length'
  if (reason === 'toolUse') return 'tool-calls'
  if (reason === 'error' || reason === 'aborted') return 'error'
  return 'stop'
}

function resolvePiTerminalTimeoutMs(): number {
  const raw = Number(process.env.PI_TERMINAL_TIMEOUT_MS ?? '')
  if (Number.isFinite(raw) && raw >= 1_000) return raw
  return DEFAULT_PI_TERMINAL_TIMEOUT_MS
}

function createPiTerminalTimeoutError(timeoutMs: number): Error {
  const error = new Error(`PI assistant stream did not reach a terminal state within ${timeoutMs}ms`)
  error.name = 'PiStreamTerminalTimeoutError'
  return error
}

function isRetriablePiError(error: Error): boolean {
  const name = String(error.name || '').trim()
  const message = String(error.message || '').trim()
  const normalized = `${name} ${message}`.toLowerCase()

  return (
    name === 'PiStreamTerminalTimeoutError'
    || /\b502\b|\b503\b|\b504\b/.test(message)
    || normalized.includes('connection error')
    || normalized.includes('socket hang up')
    || normalized.includes('ecconnreset')
    || normalized.includes('econnreset')
    || normalized.includes('connection reset')
    || normalized.includes('network error')
    || normalized.includes('fetch failed')
    || normalized.includes('upstream request failed')
    || normalized.includes('上游请求失败')
    || normalized.includes('timed out')
    || normalized.includes('timeout')
  )
}

function buildPiRetryStatusText(attempt: number, maxRetries: number): string {
  return `第${attempt}/${maxRetries}次重试`
}

async function waitForPiRetryDelay(delayMs: number, abortSignal?: AbortSignal): Promise<void> {
  if (delayMs <= 0) return
  if (abortSignal?.aborted) {
    throw new DOMException('Request was aborted', 'AbortError')
  }

  await new Promise<void>((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      abortSignal?.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)

    const onAbort = () => {
      clearTimeout(timeoutHandle)
      abortSignal?.removeEventListener('abort', onAbort)
      reject(new DOMException('Request was aborted', 'AbortError'))
    }

    abortSignal?.addEventListener('abort', onAbort, { once: true })
  })
}

export function convertPiUsage(usage?: {
  input?: number
  output?: number
  totalTokens?: number
  cacheRead?: number
  cacheWrite?: number
  reasoning?: number
}): LanguageModelUsage {
  const noCacheInputTokens = Number(usage?.input ?? 0)
  const outputTokens = Number(usage?.output ?? 0)
  const cacheReadTokens = Number(usage?.cacheRead ?? 0)
  const cacheWriteTokens = Number(usage?.cacheWrite ?? 0)
  const inputTokens = noCacheInputTokens + cacheReadTokens + cacheWriteTokens
  return {
    inputTokens,
    outputTokens,
    totalTokens: Number(usage?.totalTokens ?? inputTokens + outputTokens),
    inputTokenDetails: {
      cacheReadTokens,
      cacheWriteTokens,
      noCacheTokens: noCacheInputTokens
    },
    outputTokenDetails: {
      textTokens: Math.max(0, outputTokens - Number(usage?.reasoning ?? 0)),
      reasoningTokens: Number(usage?.reasoning ?? 0)
    }
  }
}

function extractAssistantText(message: { content?: Array<{ type: string; text?: string }> }): string {
  return Array.isArray(message.content)
    ? message.content
        .filter((part) => part.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text || '')
        .join('')
    : ''
}

function getArtifactSourceType(toolName: string): 'read' | 'grep' | 'webfetch' | 'tool_result' {
  const lower = toolName.toLowerCase()
  if (lower.includes('read')) return 'read'
  if (lower.includes('grep') || lower.includes('search')) return 'grep'
  if (lower.includes('webfetch') || lower.includes('fetch') || lower.includes('browser_snapshot')) return 'webfetch'
  return 'tool_result'
}

function shouldOffloadToolResult(toolName: string, outputText: string): boolean {
  void toolName
  void outputText
  return true
}

function summarizeValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function tryExtractFilePath(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined
  const record = input as Record<string, unknown>
  for (const key of ['file_path', 'path', 'target_path', 'new_path']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function summarizePiContent(value: unknown): {
  partCount: number
  textPartCount: number
  textChars: number
  types: string[]
} {
  const content = Array.isArray(value) ? value : []
  const types: string[] = []
  let textPartCount = 0
  let textChars = 0

  for (const part of content) {
    if (!part || typeof part !== 'object') continue
    const record = part as Record<string, unknown>
    const type = typeof record.type === 'string' ? record.type : 'unknown'
    types.push(type)
    if (type === 'text' && typeof record.text === 'string') {
      textPartCount += 1
      textChars += record.text.length
    }
  }

  return {
    partCount: content.length,
    textPartCount,
    textChars,
    types
  }
}

function extractPiToolCallSnapshots(message: { content?: unknown }): PiToolCallSnapshot[] {
  if (!Array.isArray(message.content)) {
    return []
  }

  return message.content.flatMap((part, contentIndex) => {
    if (!part || typeof part !== 'object') {
      return []
    }

    const record = part as Record<string, unknown>
    if (String(record.type || '') !== 'toolCall') {
      return []
    }

    const nested = record.toolCall && typeof record.toolCall === 'object'
      ? (record.toolCall as Record<string, unknown>)
      : record
    const id = String(nested.id || record.id || '').trim()
    const name = String(nested.name || record.name || '').trim()
    const args =
      nested.arguments !== undefined
        ? nested.arguments
        : nested.input !== undefined
          ? nested.input
          : record.arguments !== undefined
            ? record.arguments
            : record.input

    if (!id || !name) {
      return []
    }

    return [
      {
        contentIndex,
        id,
        name,
        arguments: args
      }
    ]
  })
}

async function ensurePiSegmentAndTurn(input: {
  harness: ClaudeCodeHarnessAdapter
  architectureContext: SessionArchitectureContext
}): Promise<{ currentSegment: AgentConversationSegment; currentTurn: AgentTurn }> {
  const { harness, architectureContext } = input
  let currentSegment = architectureContext.activeSegment
  let currentTurn = architectureContext.currentTurn
  const piSessionId = harness.invokeContext.projection.piSessionId

  if (!currentSegment) {
    currentSegment = await conversationSegmentService.createRootSegment({
      topicId: architectureContext.topicId,
      sdkSessionId: piSessionId,
      systemPromptVersion: architectureContext.promptEnvelope.systemPromptVersion,
      systemPromptHash: architectureContext.promptEnvelope.systemPromptHash,
      basePromptSnapshot: architectureContext.promptEnvelope.systemPrompt
    })
  } else if (!currentSegment.sdkSessionId) {
    await conversationSegmentService.bindSdkSession(currentSegment.id, piSessionId)
    currentSegment = {
      ...currentSegment,
      sdkSessionId: piSessionId,
      updatedAt: new Date().toISOString()
    }
  }

  if (!currentTurn) {
    currentTurn = await agentTurnRepository.save({
      id: `turn_${randomUUID()}`,
      topicId: architectureContext.topicId,
      segmentId: currentSegment.id,
      traceId: architectureContext.traceId,
      userMessageId: '',
      userText: architectureContext.currentPrompt,
      startedAt: new Date().toISOString(),
      status: 'running'
    })
  }

  return { currentSegment, currentTurn }
}

export async function processPiHarnessQuery(input: {
  stream: AgentStream & { sdkSessionId?: string }
  sessionId: string
  agentId: string
  architectureContext: SessionArchitectureContext
  harness: ClaudeCodeHarnessAdapter
  prompt: string
  images?: Array<{ data: string; media_type: string }>
  abortSignal?: AbortSignal
}): Promise<void> {
  const { stream, sessionId, architectureContext, harness, prompt, images, abortSignal } = input
  const runtimeBridge = harness.runtimeBridge

  if (!runtimeBridge) {
    throw new Error('Pi runtime bridge is not available')
  }

  stream.sdkSessionId = harness.invokeContext.projection.piSessionId

  const { currentSegment, currentTurn } = await ensurePiSegmentAndTurn({
    harness,
    architectureContext
  })

  const pendingToolCalls = new Map<string, PendingToolCall>()
  const blockIds = new Map<string, string>()
  const textBlockContents = new Map<string, string>()
  const providerMetadataBase: ProviderMetadata = {
    raw: {
      provider: runtimeBridge.model.provider,
      model: runtimeBridge.model.id,
      piSessionId: harness.invokeContext.projection.piSessionId
    }
  }

  let streamedAssistantText = ''
  let latestInputTokens = 0
  let currentAssistantMessageId = ''
  let currentAssistantUsage: LanguageModelUsage = convertPiUsage()
  let currentAssistantStopReason: 'stop' | 'length' | 'tool-calls' | 'error' = 'stop'
  let textDeltaCount = 0
  let reasoningDeltaCount = 0
  let toolCallCount = 0
  let toolResultCount = 0
  let currentAttempt = 1
  const terminalTimeoutMs = resolvePiTerminalTimeoutMs()
  let terminalTimeoutHandle: NodeJS.Timeout | undefined
  let terminalTimeoutTriggered = false
  let externalAbortRequested = abortSignal?.aborted === true

  const clearTerminalTimeout = () => {
    if (!terminalTimeoutHandle) return
    clearTimeout(terminalTimeoutHandle)
    terminalTimeoutHandle = undefined
  }

  const armTerminalTimeout = () => {
    clearTerminalTimeout()
    terminalTimeoutHandle = setTimeout(() => {
      terminalTimeoutTriggered = true
      void runtimeBridge.harness.abort().catch((abortError) => {
        void abortError
      })
    }, terminalTimeoutMs)
  }

  const onAbort = () => {
    externalAbortRequested = true
    clearTerminalTimeout()
    void runtimeBridge.harness.abort().catch((abortError) => {
      void abortError
    })
  }

  if (abortSignal) {
    if (abortSignal.aborted) {
      onAbort()
    } else {
      abortSignal.addEventListener('abort', onAbort, { once: true })
    }
  }

  const ensureToolBlockId = (contentIndex: number): string => {
    const blockKey = `${currentAssistantMessageId}:${contentIndex}`
    if (!blockIds.has(blockKey)) {
      blockIds.set(blockKey, `pi_tool_${currentAssistantMessageId}_${contentIndex}`)
    }
    return blockIds.get(blockKey)!
  }

  const registerPendingPiToolCall = (input: {
    toolCallId: string
    emittedToolCallId: string
    toolName: string
    toolInput: unknown
    providerMetadata: ProviderMetadata
    source: 'toolcall_end' | 'message_end_snapshot'
  }): void => {
    const { toolCallId, emittedToolCallId, toolName, toolInput, providerMetadata, source } = input
    if (pendingToolCalls.has(toolCallId) || pendingToolCalls.has(emittedToolCallId)) {
      return
    }

    toolCallCount += 1
    const pendingToolCall: PendingToolCall = {
      emittedId: emittedToolCallId,
      providerToolCallId: toolCallId,
      toolName,
      input: toolInput
    }
    pendingToolCalls.set(toolCallId, pendingToolCall)
    pendingToolCalls.set(emittedToolCallId, pendingToolCall)

    if (source === 'message_end_snapshot') {
      logger.warn('[PiQuery] recovered missing toolcall_end from assistant message_end snapshot', {
        sessionId,
        traceId: architectureContext.traceId,
        toolCallId,
        emittedToolCallId,
        toolName,
        toolCallCount
      })
    } else {
      logger.info('[PiQuery] assistant toolcall_end', {
        sessionId,
        traceId: architectureContext.traceId,
        toolCallId,
        emittedToolCallId,
        toolName,
        toolCallCount
      })
    }

    emitChunk(
      stream,
      {
        type: 'tool-call',
        toolCallId: emittedToolCallId,
        toolName,
        input: toolInput,
        providerExecuted: false,
        providerMetadata
      } as TextStreamPart<any>,
      harness
    )
    emitChunk(
      stream,
      {
        type: 'tool-input-end',
        id: emittedToolCallId,
        providerMetadata
      } as TextStreamPart<any>,
      harness
    )
  }

  const emitRetryStatusChunk = (attempt: number): void => {
    emitChunk(
      stream,
      ({
        type: 'retry-status',
        attempt,
        maxRetries: PI_NETWORK_RETRY_LIMIT,
        text: buildPiRetryStatusText(attempt, PI_NETWORK_RETRY_LIMIT)
      } as unknown) as TextStreamPart<any>,
      harness
    )
  }

  const unsubscribe = runtimeBridge.harness.subscribe(async (event) => {
    if (event.type === 'message_start' && event.message.role === 'assistant') {
      armTerminalTimeout()
      currentAssistantMessageId = `pi_assistant_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      currentAssistantUsage = convertPiUsage((event.message as any).usage)
      currentAssistantStopReason = mapPiStopReason((event.message as any).stopReason)
      logger.info('[PiQuery] assistant message_start', {
        sessionId,
        traceId: architectureContext.traceId,
        piSessionId: harness.invokeContext.projection.piSessionId,
        messageId: currentAssistantMessageId,
        usage: (event.message as any).usage,
        stopReason: (event.message as any).stopReason
      })
      emitChunk(
        stream,
        {
          type: 'start-step',
          request: { body: '' },
          warnings: []
        } as TextStreamPart<any>,
        harness
      )
      return
    }

    if (event.type === 'message_update') {
      const assistantEvent = event.assistantMessageEvent as any
      const blockKey = `${currentAssistantMessageId}:${assistantEvent.contentIndex}`
      const providerMetadata = {
        ...providerMetadataBase,
        raw: {
          ...(providerMetadataBase.raw as Record<string, unknown>),
          assistantEventType: assistantEvent.type
        }
      }

      if (!blockIds.has(blockKey)) {
        const prefix =
          assistantEvent.type.startsWith('thinking') ? 'pi_reasoning' : assistantEvent.type.startsWith('toolcall') ? 'pi_tool' : 'pi_text'
        blockIds.set(blockKey, `${prefix}_${currentAssistantMessageId}_${assistantEvent.contentIndex}`)
      }

      const blockId = blockIds.get(blockKey)!

      switch (assistantEvent.type) {
        case 'text_start':
          textBlockContents.set(blockId, '')
          logger.info('[PiQuery] assistant text_start', {
            sessionId,
            traceId: architectureContext.traceId,
            blockId,
            contentIndex: assistantEvent.contentIndex
          })
          emitChunk(stream, { type: 'text-start', id: blockId, providerMetadata } as TextStreamPart<any>, harness)
          return
        case 'text_delta':
          streamedAssistantText += String(assistantEvent.delta || '')
          textBlockContents.set(blockId, `${textBlockContents.get(blockId) || ''}${String(assistantEvent.delta || '')}`)
          textDeltaCount += 1
          emitChunk(
            stream,
            {
              type: 'text-delta',
              id: blockId,
              text: String(assistantEvent.delta || ''),
              providerMetadata
            } as TextStreamPart<any>,
            harness
          )
          return
        case 'text_end':
          const completedText = textBlockContents.get(blockId) || ''
          logger.info('[PiQuery] assistant text_end', {
            sessionId,
            traceId: architectureContext.traceId,
            blockId,
            textDeltaCount,
            streamedAssistantTextChars: streamedAssistantText.length,
            blockTextChars: completedText.length
          })
          emitChunk(
            stream,
            {
              type: 'text-end',
              id: blockId,
              providerMetadata: {
                ...providerMetadata,
                text: {
                  value: completedText
                }
              }
            } as TextStreamPart<any>,
            harness
          )
          textBlockContents.delete(blockId)
          return
        case 'thinking_start':
          emitChunk(stream, { type: 'reasoning-start', id: blockId, providerMetadata } as TextStreamPart<any>, harness)
          return
        case 'thinking_delta':
          reasoningDeltaCount += 1
          emitChunk(
            stream,
            {
              type: 'reasoning-delta',
              id: blockId,
              text: String(assistantEvent.delta || ''),
              providerMetadata
            } as TextStreamPart<any>,
            harness
          )
          return
        case 'thinking_end':
          emitChunk(stream, { type: 'reasoning-end', id: blockId, providerMetadata } as TextStreamPart<any>, harness)
          return
        case 'toolcall_start': {
          const partialToolCall = (assistantEvent.partial?.content?.[assistantEvent.contentIndex] ?? {}) as Record<string, unknown>
          const toolName = String(partialToolCall.name || '')
          emitChunk(
            stream,
            {
              type: 'tool-input-start',
              id: blockId,
              toolName,
              providerMetadata
            } as TextStreamPart<any>,
            harness
          )
          return
        }
        case 'toolcall_delta':
          emitChunk(
            stream,
            {
              type: 'tool-input-delta',
              id: blockId,
              delta: String(assistantEvent.delta || ''),
              providerMetadata
            } as TextStreamPart<any>,
            harness
          )
          return
        case 'toolcall_end': {
          const toolCall = assistantEvent.toolCall as { id: string; name: string; arguments: unknown }
          const providerToolCallId = String(toolCall.id || blockId)
          const emittedToolCallId = blockId
          registerPendingPiToolCall({
            toolCallId: providerToolCallId,
            emittedToolCallId,
            toolName: String(toolCall.name || ''),
            toolInput: toolCall.arguments,
            providerMetadata,
            source: 'toolcall_end'
          })
          return
        }
        default:
          return
      }
    }

    if (event.type === 'message_end' && event.message.role === 'assistant') {
      clearTerminalTimeout()
      latestInputTokens = Number((event.message as any).usage?.input ?? latestInputTokens)
      currentAssistantUsage = convertPiUsage((event.message as any).usage)
      currentAssistantStopReason = mapPiStopReason((event.message as any).stopReason)
      const messageEndToolCalls = extractPiToolCallSnapshots(event.message as { content?: unknown })
      for (const toolCall of messageEndToolCalls) {
        const emittedToolCallId = ensureToolBlockId(toolCall.contentIndex)
        const providerMetadata = {
          ...providerMetadataBase,
          raw: {
            ...(providerMetadataBase.raw as Record<string, unknown>),
            assistantEventType: 'message_end',
            toolCallRecovery: true
          }
        }
        registerPendingPiToolCall({
          toolCallId: toolCall.id,
          emittedToolCallId,
          toolName: toolCall.name,
          toolInput: toolCall.arguments,
          providerMetadata,
          source: 'message_end_snapshot'
        })
      }
      logger.info('[PiQuery] assistant message_end', {
        sessionId,
        traceId: architectureContext.traceId,
        messageId: currentAssistantMessageId,
        usage: (event.message as any).usage,
        stopReason: (event.message as any).stopReason,
        errorMessage: (event.message as any).errorMessage,
        textDeltaCount,
        reasoningDeltaCount,
        toolCallCount,
        toolResultCount,
        streamedAssistantTextChars: streamedAssistantText.length,
        messageContent: summarizePiContent((event.message as any).content)
      })
      emitChunk(
        stream,
        {
          type: 'finish-step',
          response: {
            id: currentAssistantMessageId,
            timestamp: new Date(),
            modelId: String((event.message as any).model || runtimeBridge.model.id)
          },
          usage: currentAssistantUsage,
          finishReason: currentAssistantStopReason,
          rawFinishReason: (event.message as any).stopReason,
          providerMetadata: providerMetadataBase
        } as TextStreamPart<any>,
        harness
      )
      return
    }

    if (event.type === 'tool_execution_end') {
      const pending = pendingToolCalls.get(event.toolCallId)
      const toolName = pending?.toolName || event.toolName
      const emittedToolCallId = pending?.emittedId || event.toolCallId
      toolResultCount += 1
      const providerMetadata = {
        ...providerMetadataBase,
        raw: {
          ...(providerMetadataBase.raw as Record<string, unknown>),
          toolExecution: 'end'
        }
      }

      if (event.isError) {
        logger.warn('[PiQuery] tool_execution_end error', {
          sessionId,
          traceId: architectureContext.traceId,
          toolCallId: event.toolCallId,
          emittedToolCallId,
          toolName,
          toolResultCount,
          error: summarizeValue(event.result)
        })
        emitChunk(
          stream,
          {
            type: 'tool-error',
            toolCallId: emittedToolCallId,
            toolName,
            input: pending?.input,
            error: limitInlineToolPayload(event.result, { label: `${toolName || 'tool'} 错误输出` }),
            rawError: event.result,
            providerExecuted: false,
            providerMetadata
          } as TextStreamPart<any>,
          harness
        )
        architectureContext.pendingFileChanges.delete(event.toolCallId)
        pendingToolCalls.delete(event.toolCallId)
        if (emittedToolCallId !== event.toolCallId) {
          pendingToolCalls.delete(emittedToolCallId)
        }
        return
      }

      const output = (event.result as { content?: unknown; details?: unknown }).content ?? event.result
      const rawOutput = event.result
      const inlineSource = buildInlineToolResultPayload(event.result)
      const inlineOutput = limitInlineToolPayload(
        Array.isArray(inlineSource) ? { content: inlineSource } : inlineSource,
        { label: `${toolName || 'tool'} 回包` }
      )
      logger.info('[PiQuery] tool_execution_end success', {
        sessionId,
        traceId: architectureContext.traceId,
        toolCallId: event.toolCallId,
        emittedToolCallId,
        toolName,
        toolResultCount,
        outputSummary: summarizePiContent(Array.isArray(output) ? output : [output])
      })
      const toolResultChunk = {
        type: 'tool-result',
        toolCallId: emittedToolCallId,
        toolName,
        input: pending?.input,
        output: inlineOutput,
        rawOutput,
        providerExecuted: false,
        providerMetadata
      } as TextStreamPart<any>

      await handleToolResultSideEffects({
        chunk: toolResultChunk,
        architectureContext: architectureContext as QueryArchitectureContext,
        currentSegment,
        currentTurn,
        pendingToolCalls,
        getArtifactSourceType,
        shouldOffloadToolResult,
        tryExtractFilePath
      })

      emitChunk(stream, toolResultChunk, harness)
    }
  })

  try {
    let result: unknown
    for (let attemptIndex = 0; attemptIndex <= PI_NETWORK_RETRY_LIMIT; attemptIndex += 1) {
      currentAttempt = attemptIndex + 1
      terminalTimeoutTriggered = false
      result = undefined

      try {
        result = await runtimeBridge.harness.prompt(prompt, {
          images: images?.map((image) => ({
            type: 'image',
            data: image.data,
            mimeType: image.media_type
          }))
        })
      } catch (error) {
        clearTerminalTimeout()
        const errorObj = error instanceof Error ? error : new Error(String(error))
        const hasVisibleOrSideEffects = textDeltaCount > 0 || toolCallCount > 0 || toolResultCount > 0
        const shouldRetry =
          !externalAbortRequested
          && abortSignal?.aborted !== true
          && !hasVisibleOrSideEffects
          && attemptIndex < PI_NETWORK_RETRY_LIMIT
          && isRetriablePiError(errorObj)

        if (!shouldRetry) {
          throw errorObj
        }

        const retryAttempt = attemptIndex + 1
        logger.warn('[PiQuery] prompt attempt failed before any visible output, scheduling retry', {
          sessionId,
          traceId: architectureContext.traceId,
          attempt: retryAttempt,
          maxRetries: PI_NETWORK_RETRY_LIMIT,
          error: errorObj.message,
          currentAttempt,
          textDeltaCount,
          toolCallCount,
          toolResultCount
        })
        emitRetryStatusChunk(retryAttempt)
        await waitForPiRetryDelay(PI_NETWORK_RETRY_BASE_DELAY_MS * retryAttempt, abortSignal)
        continue
      }

      clearTerminalTimeout()

      const resultStopReason = String((result as any).stopReason || '').trim()
      if (terminalTimeoutTriggered) {
        const timeoutError = createPiTerminalTimeoutError(terminalTimeoutMs)
        const hasVisibleOrSideEffects = textDeltaCount > 0 || toolCallCount > 0 || toolResultCount > 0
        const shouldRetry =
          !externalAbortRequested
          && abortSignal?.aborted !== true
          && !hasVisibleOrSideEffects
          && attemptIndex < PI_NETWORK_RETRY_LIMIT

        if (!shouldRetry) {
          throw timeoutError
        }

        const retryAttempt = attemptIndex + 1
        logger.warn('[PiQuery] prompt attempt timed out before any visible output, scheduling retry', {
          sessionId,
          traceId: architectureContext.traceId,
          attempt: retryAttempt,
          maxRetries: PI_NETWORK_RETRY_LIMIT,
          timeoutMs: terminalTimeoutMs
        })
        emitRetryStatusChunk(retryAttempt)
        await waitForPiRetryDelay(PI_NETWORK_RETRY_BASE_DELAY_MS * retryAttempt, abortSignal)
        continue
      }
      if (externalAbortRequested || abortSignal?.aborted || resultStopReason === 'aborted') {
        await agentTurnRepository.update(currentTurn.id, {
          assistantText: streamedAssistantText || undefined,
          completedAt: new Date().toISOString(),
          status: 'cancelled',
          cumulativeInputTokens: latestInputTokens
        })
        emitCancelled(stream, new Error('Request aborted by client'), harness)
        return
      }
      if (resultStopReason === 'error') {
        const resultError = new Error(String((result as any).errorMessage || 'PI harness returned an error stop reason'))
        const hasVisibleOrSideEffects = textDeltaCount > 0 || toolCallCount > 0 || toolResultCount > 0
        const shouldRetry =
          !externalAbortRequested
          && abortSignal?.aborted !== true
          && !hasVisibleOrSideEffects
          && attemptIndex < PI_NETWORK_RETRY_LIMIT
          && isRetriablePiError(resultError)

        if (!shouldRetry) {
          throw resultError
        }

        const retryAttempt = attemptIndex + 1
        logger.warn('[PiQuery] prompt attempt ended with retriable stopReason=error before any visible output, scheduling retry', {
          sessionId,
          traceId: architectureContext.traceId,
          attempt: retryAttempt,
          maxRetries: PI_NETWORK_RETRY_LIMIT,
          error: resultError.message
        })
        emitRetryStatusChunk(retryAttempt)
        await waitForPiRetryDelay(PI_NETWORK_RETRY_BASE_DELAY_MS * retryAttempt, abortSignal)
        continue
      }

      break
    }

    if (!result) {
      throw new Error('PI harness did not return a result after retries')
    }

    const finalAssistantText = extractAssistantText(result as any) || streamedAssistantText
    const finalUsage = convertPiUsage((result as any).usage)
    logger.info('[PiQuery] prompt completed', {
      sessionId,
      traceId: architectureContext.traceId,
      piSessionId: harness.invokeContext.projection.piSessionId,
      attemptsUsed: currentAttempt,
      stopReason: (result as any).stopReason,
      errorMessage: (result as any).errorMessage,
      resultContent: summarizePiContent((result as any).content),
      extractedAssistantTextChars: extractAssistantText(result as any).length,
      streamedAssistantTextChars: streamedAssistantText.length,
      finalAssistantTextChars: finalAssistantText.length,
      textDeltaCount,
      reasoningDeltaCount,
      toolCallCount,
      toolResultCount
    })

    await agentTurnRepository.update(currentTurn.id, {
      assistantText: finalAssistantText || undefined,
      completedAt: new Date().toISOString(),
      status: 'completed',
      cumulativeInputTokens: Number((result as any).usage?.input ?? latestInputTokens)
    })

    emitChunk(
      stream,
      {
        type: 'finish',
        totalUsage: finalUsage,
        finishReason: mapPiStopReason((result as any).stopReason),
        rawFinishReason: (result as any).stopReason,
        providerMetadata: providerMetadataBase
      } as TextStreamPart<any>,
      harness
    )
    emitLifecycleEvent(stream, 'stream-finished', harness)
    emitLifecycleEvent(stream, 'complete', harness)
  } catch (error) {
    clearTerminalTimeout()
    const errorObj = error instanceof Error ? error : new Error(String(error))
    const isTimedOut = terminalTimeoutTriggered || errorObj.name === 'PiStreamTerminalTimeoutError'
    const isAborted =
      !isTimedOut &&
      (externalAbortRequested ||
        abortSignal?.aborted === true ||
        errorObj.name === 'AbortError' ||
        errorObj.message.includes('aborted'))

    await agentTurnRepository.update(currentTurn.id, {
      assistantText: streamedAssistantText || undefined,
      completedAt: new Date().toISOString(),
      status: isAborted ? 'cancelled' : 'failed',
      cumulativeInputTokens: latestInputTokens
    })

    if (isAborted) {
      emitCancelled(stream, new Error('Request aborted by client'), harness)
      return
    }

    logger.error('Pi harness query failed', {
      sessionId,
      attemptsUsed: currentAttempt,
      error: errorObj.message
    })
    emitError(stream, errorObj, harness)
  } finally {
    clearTerminalTimeout()
    if (abortSignal) {
      abortSignal.removeEventListener('abort', onAbort)
    }
    unsubscribe()
    await Promise.allSettled((runtimeBridge.mcpClients ?? []).map((client) => client.close()))
  }
}
