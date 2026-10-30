
import { loggerService } from '@logger'
import type { LanguageModelUsage, ProviderMetadata, TextStreamPart } from 'ai'
import { isInlineToolPayloadTruncated, limitInlineToolPayload } from '@shared/sessionPayloadLimits'

import type { AgentStream } from '../../../interfaces/AgentStreamInterface'
import { isSqliteBusy, sqliteErrorDiagnostics } from '../../../database/sqliteRetry'
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
import type { ClaudeCodeHarnessAdapter, PiNestedToolEvent } from './create-harness'
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
  startedAt: number
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
  // Local persistence contention is retried at the DB operation boundary, never
  // by replaying a prompt (which could repeat tool side effects).
  if (isSqliteBusy(error)) return false
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
    const turnId = harness.invokeContext.projection.turnId
    const userMessageId = harness.invokeContext.projection.userMessageId
    const assistantMessageId = harness.invokeContext.projection.assistantMessageId
    if (!turnId || !userMessageId || !assistantMessageId) {
      throw new Error('PI invocation projection is missing stable turn or message IDs')
    }
    currentTurn = await agentTurnRepository.save({
      id: turnId,
      topicId: architectureContext.topicId,
      segmentId: currentSegment.id,
      traceId: architectureContext.traceId,
      userMessageId,
      assistantMessageId,
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
  const terminalToolCallIds = new Set<string>()
  const completedToolChunks = new Map<string, TextStreamPart<any>>()
  const unreconciledToolResults = new Set<string>()
  const streamingToolInputs = new Map<string, { toolName: string }>()
  const executingToolCallIds = new Set<string>()
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
  const queryStartedAt = Date.now()
  let assistantRound = 0
  let currentAssistantStartedAt = queryStartedAt
  let lastToolCompletedAt: number | undefined
  const terminalTimeoutMs = resolvePiTerminalTimeoutMs()
  const idleTimeoutMs = resolvePiIdleTimeoutMs()
  let terminalTimeoutHandle: NodeJS.Timeout | undefined
  let idleTimeoutHandle: NodeJS.Timeout | undefined
  let terminalTimeoutTriggered = false
  let idleTimeoutTriggered = false
  let externalAbortRequested = abortSignal?.aborted === true
  let cancellationPending = false
  const compactionTriggerTokens =
    runtimeBridge.tokenLimits?.compactionTriggerTokens ??
    (runtimeBridge.tokenLimits?.maxInputTokens
      ? Math.floor(runtimeBridge.tokenLimits.maxInputTokens * 0.9)
      : undefined)

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
    if (executingToolCallIds.size > 0) return
    terminalTimeoutHandle = setTimeout(() => {
      terminalTimeoutTriggered = true
      void runtimeBridge.harness.abort().catch((abortError) => {
        void abortError
      })
    }, terminalTimeoutMs)
  }

  const armIdleTimeout = () => {
    clearIdleTimeout()
    // Tool execution has its own deadline; silence is not an idle model stream.
    if (executingToolCallIds.size > 0) return
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
    source: 'toolcall_end' | 'message_end_snapshot' | 'nested-codemode'
  }): void => {
    const { toolCallId, emittedToolCallId, toolName, toolInput, providerMetadata, source } = input
    if (terminalToolCallIds.has(toolCallId) || terminalToolCallIds.has(emittedToolCallId)) {
      // Execution results can precede the assistant snapshot that supplies the UI alias.
      // Reconcile the retained terminal result to that alias rather than leaving its
      // streamed input card pending. This is projection only, never tool execution.
      const completed = completedToolChunks.get(toolCallId)
      if (completed && !terminalToolCallIds.has(emittedToolCallId)) {
        emitChunk(stream, { ...completed, toolCallId: emittedToolCallId, toolName, input: toolInput } as TextStreamPart<any>, harness)
        terminalToolCallIds.add(emittedToolCallId)
        unreconciledToolResults.delete(toolCallId)
      }
      streamingToolInputs.delete(emittedToolCallId)
      return
    }
    if (pendingToolCalls.has(toolCallId) || pendingToolCalls.has(emittedToolCallId)) return

    streamingToolInputs.delete(emittedToolCallId)
    toolCallCount += 1
    const pendingToolCall: PendingToolCall = {
      emittedId: emittedToolCallId,
      providerToolCallId: toolCallId,
      toolName,
      input: toolInput,
      startedAt: Date.now()
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
        toolCallCount,
        assistantElapsedMs: Date.now() - currentAssistantStartedAt
      })
    } else {
      logger.info('[PiQuery] assistant toolcall_end', {
        sessionId,
        traceId: architectureContext.traceId,
        toolCallId,
        emittedToolCallId,
        toolName,
        toolCallCount,
        assistantElapsedMs: Date.now() - currentAssistantStartedAt
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

  const handleNestedToolEvent = async (event: PiNestedToolEvent): Promise<void> => {
    if (event.type === 'start') {
      executingToolCallIds.add(event.toolCallId)
      clearTerminalTimeout()
    } else if (event.type !== 'update') {
      executingToolCallIds.delete(event.toolCallId)
    }
    armIdleTimeout()
    if (event.type === 'update') return

    const providerMetadata: ProviderMetadata = {
      ...providerMetadataBase,
      raw: {
        ...(providerMetadataBase.raw as Record<string, unknown>),
        nestedCodemodeTool: true
      }
    }

    if (event.type === 'start') {
      registerPendingPiToolCall({
        toolCallId: event.toolCallId,
        emittedToolCallId: event.toolCallId,
        toolName: event.toolName,
        toolInput: event.input,
        providerMetadata,
        source: 'nested-codemode'
      })
      return
    }

    if (terminalToolCallIds.has(event.toolCallId)) return
    const pending = pendingToolCalls.get(event.toolCallId)
    const emittedToolCallId = pending?.emittedId || event.toolCallId
    terminalToolCallIds.add(event.toolCallId)
    terminalToolCallIds.add(emittedToolCallId)
    unregisterMcpProgressCallId(event.toolCallId, emittedToolCallId)
    toolResultCount += 1

    if (event.type === 'error') {
      emitChunk(
        stream,
        {
          type: 'tool-error',
          toolCallId: emittedToolCallId,
          toolName: event.toolName,
          input: pending?.input ?? event.input,
          error: limitInlineToolPayload(event.error, { label: `${event.toolName} 错误输出` }),
          rawError: event.error,
          providerExecuted: false,
          providerMetadata
        } as TextStreamPart<any>,
        harness
      )
    } else {
      const inlineSource = buildInlineToolResultPayload(event.result)
      const inlinePayload = Array.isArray(inlineSource) ? { content: inlineSource } : inlineSource
      emitChunk(
        stream,
        {
          type: 'tool-result',
          toolCallId: emittedToolCallId,
          toolName: event.toolName,
          input: pending?.input ?? event.input,
          output: limitInlineToolPayload(inlinePayload, { label: `${event.toolName} 回包` }),
          rawOutput: event.result,
          truncated: isInlineToolPayloadTruncated(inlinePayload),
          providerExecuted: false,
          providerMetadata
        } as TextStreamPart<any>,
        harness
      )
    }

    architectureContext.pendingFileChanges.delete(event.toolCallId)
    pendingToolCalls.delete(event.toolCallId)
    if (emittedToolCallId !== event.toolCallId) {
      pendingToolCalls.delete(emittedToolCallId)
    }
  }

  const flushUnreconciledToolResults = (): void => {
    for (const id of unreconciledToolResults) {
      const chunk = completedToolChunks.get(id)
      if (chunk) emitChunk(stream, chunk, harness)
    }
    unreconciledToolResults.clear()
  }

  const emitRetryStatusChunk = (attempt: number): void => {
    flushUnreconciledToolResults()
    // Called only after prompt/skill settled: this attempt can no longer execute tools.
    // Deduplicate provider/emitted aliases, and never infer completion from later tools.
    for (const pending of new Set(pendingToolCalls.values())) {
      terminalToolCallIds.add(pending.providerToolCallId)
      terminalToolCallIds.add(pending.emittedId)
      emitChunk(stream, {
        type: 'tool-error',
        toolCallId: pending.emittedId,
        toolName: pending.toolName,
        input: pending.input,
        error: 'Tool call abandoned when the provider attempt ended; retrying.',
        providerExecuted: false,
        providerMetadata: providerMetadataBase
      } as TextStreamPart<any>, harness)
      unregisterMcpProgressCallId(pending.providerToolCallId, pending.emittedId)
      architectureContext.pendingFileChanges.delete(pending.providerToolCallId)
    }
    for (const [id, input] of streamingToolInputs) {
      terminalToolCallIds.add(id)
      emitChunk(stream, {
        type: 'tool-error', toolCallId: id, toolName: input.toolName,
        error: 'Tool input abandoned when the provider attempt ended; retrying.',
        providerExecuted: false, providerMetadata: providerMetadataBase
      } as TextStreamPart<any>, harness)
    }
    streamingToolInputs.clear()
    pendingToolCalls.clear()
    executingToolCallIds.clear()
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

  const unsubscribeNestedTools = runtimeBridge.subscribeNestedToolEvents(handleNestedToolEvent)
  const unsubscribe = runtimeBridge.harness.subscribe(async (event) => {
    if (event.type === 'tool_execution_start') {
      executingToolCallIds.add(event.toolCallId)
      clearTerminalTimeout()
    } else if (event.type === 'tool_execution_end') {
      executingToolCallIds.delete(event.toolCallId)
    }
    // 每收到任何 harness 事件都视为有活性，重置并重新武装空闲超时，
    // 确保流中途断网后 idleTimeoutMs 内无新事件即可触发重试。
    armIdleTimeout()
    if (event.type === 'message_start' && event.message.role === 'assistant') {
      const now = Date.now()
      assistantRound += 1
      currentAssistantStartedAt = now
      armTerminalTimeout()
      currentAssistantMessageId = `pi_assistant_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      currentAssistantUsage = convertPiUsage((event.message as any).usage)
      currentAssistantStopReason = mapPiStopReason((event.message as any).stopReason)
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
          streamingToolInputs.set(blockId, { toolName })
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
      if (terminalToolCallIds.has(event.toolCallId)) return
      const pending = pendingToolCalls.get(event.toolCallId)
      const toolName = pending?.toolName || event.toolName
      const emittedToolCallId = pending?.emittedId || event.toolCallId
      terminalToolCallIds.add(event.toolCallId)
      terminalToolCallIds.add(emittedToolCallId)
      unregisterMcpProgressCallId(event.toolCallId, emittedToolCallId)
      toolResultCount += 1
      const providerMetadata = {
        ...providerMetadataBase,
        raw: {
          ...(providerMetadataBase.raw as Record<string, unknown>),
          toolExecution: 'end'
        }
      }

      completedToolChunks.set(event.toolCallId, {
        type: event.isError ? 'tool-error' : 'tool-result',
        toolCallId: emittedToolCallId,
        toolName,
        input: pending?.input,
        ...(event.isError
          ? { error: limitInlineToolPayload(event.result, { label: `${toolName || 'tool'} 错误输出` }) }
          : { output: limitInlineToolPayload(buildInlineToolResultPayload(event.result), { label: `${toolName || 'tool'} 回包` }) }),
        providerExecuted: false,
        providerMetadata
      } as TextStreamPart<any>)
      if (!pending) {
        // Keep a result until the assistant snapshot supplies its emitted ID. Emitting
        // the raw provider ID here would create a second card for the same execution.
        unreconciledToolResults.add(event.toolCallId)
        return
      }
      if (event.isError) {
        lastToolCompletedAt = Date.now()
        logger.warn('[PiQuery] tool_execution_end error', {
          sessionId,
          traceId: architectureContext.traceId,
          toolCallId: event.toolCallId,
          emittedToolCallId,
          toolName,
          toolResultCount,
          executionElapsedMs: pending ? lastToolCompletedAt - pending.startedAt : undefined,
          queryElapsedMs: lastToolCompletedAt - queryStartedAt,
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
      lastToolCompletedAt = Date.now()
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
        executionElapsedMs: pending ? lastToolCompletedAt - pending.startedAt : undefined,
        queryElapsedMs: lastToolCompletedAt - queryStartedAt,
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

      try {
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
      } catch (error) {
        // Ancillary persistence cannot turn a completed tool into a failed prompt
        // (which could replay a successful Bash invocation).
        logger.warn('[PiQuery] tool result side effects unavailable', {
          toolCallId: event.toolCallId, emittedToolCallId, toolName,
          ...sqliteErrorDiagnostics(error)
        })
        if (truncated) {
          ;(toolResultChunk as any).output = limitInlineToolPayload({
            warning: 'Full tool output storage unavailable; only this bounded preview is available. The tool completed successfully.',
            preview: inlineOutput
          })
        }
      }

      emitChunk(stream, toolResultChunk, harness)
    }
  })

  try {
    let result: unknown
    // Retry attempts are bounded for the whole prompt invocation. A failed attempt may emit
    // progress before its terminal error, but that must not reset the budget: providers that
    // repeatedly stream the same partial response would otherwise retry forever.
    let retryCount = 0
    let progressSnapshot = { textDeltaCount, reasoningDeltaCount, toolCallCount, toolResultCount }
    const hasMadeProgressSinceSnapshot = (): boolean =>
      textDeltaCount > progressSnapshot.textDeltaCount
      || reasoningDeltaCount > progressSnapshot.reasoningDeltaCount
      || toolCallCount > progressSnapshot.toolCallCount
      || toolResultCount > progressSnapshot.toolResultCount
    const computeNextRetryCount = (): number => retryCount + 1
    const commitFailedAttempt = (): void => {
      retryCount += 1
      progressSnapshot = { textDeltaCount, reasoningDeltaCount, toolCallCount, toolResultCount }
    }

    while (true) {
      // Abort may arrive while the harness/turn is being initialized, before prompt starts.
      if (externalAbortRequested || abortSignal?.aborted) {
        throw new DOMException('Request was aborted', 'AbortError')
      }
      currentAttempt += 1
      // Provider IDs may be reused by a new prompt attempt; emitted card IDs remain
      // message-scoped. The previous attempt has settled before entering here.
      terminalToolCallIds.clear()
      completedToolChunks.clear()
      unreconciledToolResults.clear()
      terminalTimeoutTriggered = false
      idleTimeoutTriggered = false
      executingToolCallIds.clear()
      result = undefined

      try {
        // 不在 attempt 起始时武装 idle timeout：首个 chunk 前的等待完全交给
        // SessionStreamIpc 的启动/连接超时兜底，避免慢首字节被误判为断流。
        // 首个 harness event 到达后（见 subscribe 回调）才开始检测空闲。
        const explicitSkill = harness.invokeContext.skills.skillInvocationContext
        if (explicitSkill && !images?.length) {
          logger.info('[PiSkill] invoking native harness skill', {
            sessionId,
            traceId: architectureContext.traceId,
            skillName: explicitSkill.skillName,
            skillFilePath: explicitSkill.skillFilePath,
            attempt: currentAttempt
          })
          result = await runtimeBridge.harness.skill(explicitSkill.skillName, prompt)
        } else {
          let effectivePrompt = prompt
          if (explicitSkill) {
            const skillResource = harness.invokeContext.prompt.resources.skills.find(
              (skill) => skill.name === explicitSkill.skillName
            )
            if (skillResource && harness.packageBridge) {
              effectivePrompt = harness.packageBridge.agentCore.formatSkillInvocation(skillResource, prompt)
            }
            logger.info('[PiSkill] invoking image-compatible skill prompt', {
              sessionId,
              traceId: architectureContext.traceId,
              skillName: explicitSkill.skillName,
              skillFilePath: explicitSkill.skillFilePath,
              imageCount: images?.length ?? 0,
              attempt: currentAttempt
            })
          }
          result = await runtimeBridge.harness.prompt(effectivePrompt, {
            images: images?.map((image) => ({
              type: 'image',
              data: image.data,
              mimeType: image.media_type
            }))
          })
        }
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
          attempt: retryCount,
          maxRetries: PI_NETWORK_RETRY_LIMIT,
          error: errorObj.message,
          currentAttempt,
          madeProgressSinceLastFailure: madeProgress,
          textDeltaCount,
          toolCallCount,
          toolResultCount
        })
        emitRetryStatusChunk(retryCount)
        await waitForPiRetryDelay(PI_NETWORK_RETRY_BASE_DELAY_MS * retryCount, abortSignal)
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
          attempt: retryCount,
          maxRetries: PI_NETWORK_RETRY_LIMIT,
          timeoutMs: terminalTimeoutMs,
          madeProgressSinceLastFailure: madeProgress
        })
        emitRetryStatusChunk(retryCount)
        await waitForPiRetryDelay(PI_NETWORK_RETRY_BASE_DELAY_MS * retryCount, abortSignal)
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
            attempt: retryCount,
            maxRetries: PI_NETWORK_RETRY_LIMIT,
            idleTimeoutMs,
            madeProgressSinceLastFailure: madeProgress
          })
          emitRetryStatusChunk(retryCount)
          await waitForPiRetryDelay(PI_NETWORK_RETRY_BASE_DELAY_MS * retryCount, abortSignal)
          continue
        }
        await agentTurnRepository.update(currentTurn.id, {
          assistantText: streamedAssistantText || undefined,
          completedAt: new Date().toISOString(),
          status: 'cancelled',
          cumulativeInputTokens: latestInputTokens
        })
        cancellationPending = true
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
          attempt: retryCount,
          maxRetries: PI_NETWORK_RETRY_LIMIT,
          error: resultError.message,
          madeProgressSinceLastFailure: madeProgress
        })
        emitRetryStatusChunk(retryCount)
        await waitForPiRetryDelay(PI_NETWORK_RETRY_BASE_DELAY_MS * retryCount, abortSignal)
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

    if (compactionTriggerTokens && finalUsage.inputTokens >= compactionTriggerTokens) {
      try {
        logger.info('[PiQuery] compacting context after token threshold', {
          sessionId,
          traceId: architectureContext.traceId,
          inputTokens: finalUsage.inputTokens,
          compactionTriggerTokens,
          maxInputTokens: runtimeBridge.tokenLimits?.maxInputTokens,
          contextWindowTokens: runtimeBridge.tokenLimits?.contextWindowTokens
        })
        await runtimeBridge.harness.compact()
      } catch (error) {
        logger.warn('[PiQuery] automatic context compaction failed', {
          sessionId,
          traceId: architectureContext.traceId,
          inputTokens: finalUsage.inputTokens,
          compactionTriggerTokens,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    flushUnreconciledToolResults()
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

    try {
      await agentTurnRepository.update(currentTurn.id, {
        assistantText: streamedAssistantText || undefined,
        completedAt: new Date().toISOString(),
        status: isAborted ? 'cancelled' : 'failed',
        cumulativeInputTokens: latestInputTokens
      })
    } catch (storageError) {
      logger.error('Failed to persist failed PI turn; preserving original query error', {
        sessionId,
        error: storageError instanceof Error ? storageError.message : String(storageError),
        originalError: errorObj.message
      })
    }

    flushUnreconciledToolResults()
    if (isAborted) {
      cancellationPending = true
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
    unsubscribeNestedTools()
    await Promise.allSettled((runtimeBridge.mcpClients ?? []).map((client) => client.close()))
    // A cancellation acknowledgement can immediately unlock the next request.
    // Detach listeners and close the old clients before advertising completion.
    if (cancellationPending) {
      emitCancelled(stream, new Error('Request aborted by client'), harness)
    }
  }
}
