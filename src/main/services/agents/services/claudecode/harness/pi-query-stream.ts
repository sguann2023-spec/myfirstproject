import { randomUUID } from 'node:crypto'

import { loggerService } from '@logger'
import type { LanguageModelUsage, ProviderMetadata, TextStreamPart } from 'ai'
import { isInlineToolPayloadTruncated, limitInlineToolPayload } from '@shared/sessionPayloadLimits'

import type { AgentStream } from '../../../interfaces/AgentStreamInterface'
import { agentTurnRepository } from '../../../database/repositories/agentTurnRepository'
import { emitCancelled, emitChunk, emitError, emitLifecycleEvent } from './event-adapter'
import {
  handleToolResultSideEffects,
  type QueryArchitectureContext
} from './query-side-effects'
import {
  registerMcpProgressCallId,
  unregisterMcpProgressCallId
} from './mcp-progress-call-id-map'
import { conversationSegmentService } from '../session-architecture/ConversationSegmentService'
import type { AgentConversationSegment, AgentTurn } from '../session-architecture/types'
import type { ClaudeCodeHarnessAdapter } from './create-harness'
import type { SessionArchitectureContext } from './query-stream'
import { buildInlineToolResultPayload } from './tool-result-payload'

const logger = loggerService.withContext('ClaudeCodePiQuery')

const DEFAULT_PI_TERMINAL_TIMEOUT_MS = 600_000
const DEFAULT_PI_IDLE_TIMEOUT_MS = 60_000
const PI_NETWORK_RETRY_LIMIT = 5
const PI_NETWORK_RETRY_BASE_DELAY_MS = 3000

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

function resolvePiIdleTimeoutMs(): number {
  const raw = Number(process.env.PI_IDLE_TIMEOUT_MS ?? '')
  if (Number.isFinite(raw) && raw >= 1_000) return raw
  return DEFAULT_PI_IDLE_TIMEOUT_MS
}

function createPiIdleTimeoutError(timeoutMs: number): Error {
  const error = new Error(`PI assistant stream stalled without any chunk for ${timeoutMs}ms`)
  error.name = 'PiStreamIdleTimeoutError'
  return error
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

  // 非可重试错误：以下三类严格不重试（重试不会改变结果，反而浪费资源）：
  //   1) 鉴权 / 权限类：401 Unauthorized、403 Forbidden、invalid api key、authentication failed 等
  //   2) 请求本身有误：400 Bad Request、422 Unprocessable Entity、404 Not Found、
  //      context length / token limit exceeded、content policy / safety 触发等
  //   3) 客户端主动中止：AbortError
  // 除此之外的所有网络类、超时类、5xx、限流、上游未知错误等，一律重试。
  const nonRetriableStatusCodePattern = /\b(400|401|403|404|422)\b/
  const isNonRetriable =
    name === 'AbortError'
    || nonRetriableStatusCodePattern.test(message)
    || normalized.includes('unauthorized')
    || normalized.includes('forbidden')
    || normalized.includes('invalid api key')
    || normalized.includes('invalid_api_key')
    || normalized.includes('authentication failed')
    || normalized.includes('permission denied')
    || normalized.includes('context length')
    || normalized.includes('maximum context')
    || normalized.includes('token limit')
    || normalized.includes('content policy')
    || normalized.includes('content_filter')
    || normalized.includes('safety')

  return !isNonRetriable
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
  let currentAttempt = 0
  const terminalTimeoutMs = resolvePiTerminalTimeoutMs()
  const idleTimeoutMs = resolvePiIdleTimeoutMs()
  let terminalTimeoutHandle: NodeJS.Timeout | undefined
  let idleTimeoutHandle: NodeJS.Timeout | undefined
  let terminalTimeoutTriggered = false
  let idleTimeoutTriggered = false
  let externalAbortRequested = abortSignal?.aborted === true

  const clearTerminalTimeout = () => {
    if (!terminalTimeoutHandle) return
    clearTimeout(terminalTimeoutHandle)
    terminalTimeoutHandle = undefined
  }

  const clearIdleTimeout = () => {
    if (!idleTimeoutHandle) return
    clearTimeout(idleTimeoutHandle)
    idleTimeoutHandle = undefined
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

  const armIdleTimeout = () => {
    clearIdleTimeout()
    idleTimeoutHandle = setTimeout(() => {
      idleTimeoutTriggered = true
      logger.warn('[PiQuery] idle timeout reached without any chunk, aborting for retry', {
        sessionId,
        traceId: architectureContext.traceId,
        idleTimeoutMs,
        currentAttempt
      })
      void runtimeBridge.harness.abort().catch((abortError) => {
        void abortError
      })
    }, idleTimeoutMs)
  }

  const onAbort = () => {
    externalAbortRequested = true
    clearTerminalTimeout()
    clearIdleTimeout()
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
    registerMcpProgressCallId(toolCallId, emittedToolCallId)
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
    // 每收到任何 harness 事件都视为有活性，重置并重新武装空闲超时，
    // 确保流中途断网后 idleTimeoutMs 内无新事件即可触发重试。
    armIdleTimeout()
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
      unregisterMcpProgressCallId(event.toolCallId, emittedToolCallId)
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
      const inlinePayload = Array.isArray(inlineSource) ? { content: inlineSource } : inlineSource
      const inlineOutput = limitInlineToolPayload(
        inlinePayload,
        { label: `${toolName || 'tool'} 回包` }
      )
      const truncated = isInlineToolPayloadTruncated(inlinePayload)
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
        truncated,
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
    // 连续重试计数：一旦本次 attempt 期间收到过新的 chunk（视为「已恢复」），
    // 就在下次失败时把计数清零，避免整次任务把重试次数一路累加到上限。
    // 循环退出条件也用它 —— 只有「连续失败」达到上限才真正放弃。
    let consecutiveRetryCount = 0
    let progressSnapshot = { textDeltaCount, reasoningDeltaCount, toolCallCount, toolResultCount }
    const hasMadeProgressSinceSnapshot = (): boolean =>
      textDeltaCount > progressSnapshot.textDeltaCount
      || reasoningDeltaCount > progressSnapshot.reasoningDeltaCount
      || toolCallCount > progressSnapshot.toolCallCount
      || toolResultCount > progressSnapshot.toolResultCount
    // 计算「若本轮失败，将会成为的连续失败次数」；本轮有进展则从 1 重新开始计。
    const computeNextRetryCount = (): number =>
      hasMadeProgressSinceSnapshot() ? 1 : consecutiveRetryCount + 1
    // 提交一次失败：更新连续失败计数与进度快照，供下一轮判断。
    const commitFailedAttempt = (): void => {
      if (hasMadeProgressSinceSnapshot()) {
        consecutiveRetryCount = 0
      }
      consecutiveRetryCount += 1
      progressSnapshot = { textDeltaCount, reasoningDeltaCount, toolCallCount, toolResultCount }
    }

    while (true) {
      currentAttempt += 1
      terminalTimeoutTriggered = false
      idleTimeoutTriggered = false
      result = undefined

      try {
        // 不在 attempt 起始时武装 idle timeout：首个 chunk 前的等待完全交给
        // SessionStreamIpc 的启动/连接超时兜底，避免慢首字节被误判为断流。
        // 首个 harness event 到达后（见 subscribe 回调）才开始检测空闲。
        result = await runtimeBridge.harness.prompt(prompt, {
          images: images?.map((image) => ({
            type: 'image',
            data: image.data,
            mimeType: image.media_type
          }))
        })
      } catch (error) {
        clearTerminalTimeout()
        clearIdleTimeout()
        const errorObj = idleTimeoutTriggered
          ? createPiIdleTimeoutError(idleTimeoutMs)
          : (error instanceof Error ? error : new Error(String(error)))
        // 中途已经产出内容也允许重试，只要错误可重试且未被外部 abort。
        const madeProgress = hasMadeProgressSinceSnapshot()
        const nextRetryCount = computeNextRetryCount()
        const shouldRetry =
          !externalAbortRequested
          && abortSignal?.aborted !== true
          && nextRetryCount <= PI_NETWORK_RETRY_LIMIT
          && isRetriablePiError(errorObj)

        if (!shouldRetry) {
          throw errorObj
        }

        commitFailedAttempt()
        logger.warn('[PiQuery] prompt attempt failed, scheduling retry', {
          sessionId,
          traceId: architectureContext.traceId,
          attempt: consecutiveRetryCount,
          maxRetries: PI_NETWORK_RETRY_LIMIT,
          error: errorObj.message,
          currentAttempt,
          madeProgressSinceLastFailure: madeProgress,
          textDeltaCount,
          toolCallCount,
          toolResultCount
        })
        emitRetryStatusChunk(consecutiveRetryCount)
        await waitForPiRetryDelay(PI_NETWORK_RETRY_BASE_DELAY_MS * consecutiveRetryCount, abortSignal)
        continue
      }

      clearTerminalTimeout()
      clearIdleTimeout()

      const resultStopReason = String((result as any).stopReason || '').trim()
      if (terminalTimeoutTriggered) {
        const timeoutError = createPiTerminalTimeoutError(terminalTimeoutMs)
        const madeProgress = hasMadeProgressSinceSnapshot()
        const nextRetryCount = computeNextRetryCount()
        const shouldRetry =
          !externalAbortRequested
          && abortSignal?.aborted !== true
          && nextRetryCount <= PI_NETWORK_RETRY_LIMIT

        if (!shouldRetry) {
          throw timeoutError
        }

        commitFailedAttempt()
        logger.warn('[PiQuery] prompt attempt timed out, scheduling retry', {
          sessionId,
          traceId: architectureContext.traceId,
          attempt: consecutiveRetryCount,
          maxRetries: PI_NETWORK_RETRY_LIMIT,
          timeoutMs: terminalTimeoutMs,
          madeProgressSinceLastFailure: madeProgress
        })
        emitRetryStatusChunk(consecutiveRetryCount)
        await waitForPiRetryDelay(PI_NETWORK_RETRY_BASE_DELAY_MS * consecutiveRetryCount, abortSignal)
        continue
      }
      if (externalAbortRequested || abortSignal?.aborted || resultStopReason === 'aborted') {
        // 若是 idle timeout 主动 abort（而非用户/外部取消），应走重试而非结束流。
        if (idleTimeoutTriggered && !externalAbortRequested && abortSignal?.aborted !== true) {
          const idleError = createPiIdleTimeoutError(idleTimeoutMs)
          const madeProgress = hasMadeProgressSinceSnapshot()
          const nextRetryCount = computeNextRetryCount()
          const shouldRetry = nextRetryCount <= PI_NETWORK_RETRY_LIMIT && isRetriablePiError(idleError)
          if (!shouldRetry) {
            throw idleError
          }
          commitFailedAttempt()
          logger.warn('[PiQuery] prompt attempt aborted by idle timeout, scheduling retry', {
            sessionId,
            traceId: architectureContext.traceId,
            attempt: consecutiveRetryCount,
            maxRetries: PI_NETWORK_RETRY_LIMIT,
            idleTimeoutMs,
            madeProgressSinceLastFailure: madeProgress
          })
          emitRetryStatusChunk(consecutiveRetryCount)
          await waitForPiRetryDelay(PI_NETWORK_RETRY_BASE_DELAY_MS * consecutiveRetryCount, abortSignal)
          continue
        }
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
        const madeProgress = hasMadeProgressSinceSnapshot()
        const nextRetryCount = computeNextRetryCount()
        const shouldRetry =
          !externalAbortRequested
          && abortSignal?.aborted !== true
          && nextRetryCount <= PI_NETWORK_RETRY_LIMIT
          && isRetriablePiError(resultError)

        if (!shouldRetry) {
          throw resultError
        }

        commitFailedAttempt()
        logger.warn('[PiQuery] prompt attempt ended with retriable stopReason=error, scheduling retry', {
          sessionId,
          traceId: architectureContext.traceId,
          attempt: consecutiveRetryCount,
          maxRetries: PI_NETWORK_RETRY_LIMIT,
          error: resultError.message,
          madeProgressSinceLastFailure: madeProgress
        })
        emitRetryStatusChunk(consecutiveRetryCount)
        await waitForPiRetryDelay(PI_NETWORK_RETRY_BASE_DELAY_MS * consecutiveRetryCount, abortSignal)
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
    clearIdleTimeout()
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
    clearIdleTimeout()
    if (abortSignal) {
      abortSignal.removeEventListener('abort', onAbort)
    }
    unsubscribe()
    await Promise.allSettled((runtimeBridge.mcpClients ?? []).map((client) => client.close()))
  }
}
