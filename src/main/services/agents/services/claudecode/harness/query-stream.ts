import type { Options, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { loggerService } from '@logger'

import type { AgentStream } from '../../../interfaces/AgentStreamInterface'
import { agentArtifactRepository } from '../../../database/repositories/agentArtifactRepository'
import { agentTurnRepository } from '../../../database/repositories/agentTurnRepository'
import { buildPersistedAssistantText, extractAssistantTextFromSdkMessage } from '../assistant-text'
import type { ClaudeCodeHarnessAdapter } from './create-harness'
import { emitCancelled, emitChunk, emitError, emitLifecycleEvent } from './event-adapter'
import {
  handleInitSystemMessage,
  handleToolResultSideEffects,
  maybeBridgeScreenshotToolResult,
  recoverFreshSegmentAfterCompactionLoop,
  summarizeChunkField,
  type QueryArchitectureContext
} from './query-side-effects'
import type {
  AgentConversationSegment,
  AgentTurn,
  SegmentPromptEnvelope
} from '../session-architecture/types'
import { conversationCompactionService } from '../session-architecture/ConversationCompactionService'
import { conversationSummaryService } from '../session-architecture/ConversationSummaryService'
import { fileChangeJournalService } from '../session-architecture/FileChangeJournalService'
import { conversationSegmentService } from '../session-architecture/ConversationSegmentService'
import { ClaudeStreamState, transformSDKMessageToStreamParts } from '../transform'

const logger = loggerService.withContext('ClaudeCodeService')
const DEFAULT_SEGMENT_RECENT_TURNS = 4
const MAX_AUTO_COMPACTIONS_PER_QUERY = 2

type PendingToolCall = {
  toolName: string
  input?: unknown
}

export type SessionArchitectureContext = {
  traceId: string
  topicId: string
  currentPrompt: string
  activeSegment: AgentConversationSegment | null
  currentTurn: AgentTurn | null
  promptEnvelope: SegmentPromptEnvelope
  pendingFileChanges: Map<
    string,
    Array<{
      filePath: string
      operation: 'create' | 'update' | 'delete'
      existedBefore: boolean
      beforeSnapshot?: string
      beforeHash?: string
    }>
  >
}

type StreamingProbe = {
  firstChunkAtMs: number | null
  firstTextDeltaAtMs: number | null
  firstReasoningDeltaAtMs: number | null
  firstToolCallAtMs: number | null
  firstToolResultAtMs: number | null
  textDeltaCount: number
  reasoningDeltaCount: number
  assistantSnapshotWithTextCount: number
  assistantSnapshotTextChars: number
}

type ToolUseProbe = {
  assistantMessageCount: number
  assistantWithToolUseCount: number
  assistantToolUseBlockCount: number
  transformedToolCallCount: number
  transformedToolResultCount: number
}

type ThinkingProbe = {
  streamReasoningStartCount: number
  streamReasoningDeltaCount: number
  assistantReasoningBlockCount: number
  assistantReasoningChars: number
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

function tryExtractFilePath(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined
  const record = input as Record<string, unknown>
  for (const key of ['file_path', 'path', 'target_path', 'new_path']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  if (Array.isArray(record.paths) && typeof record.paths[0] === 'string') {
    return record.paths[0]
  }
  return undefined
}

async function applyCompactionIfNeeded(
  currentSegment: AgentConversationSegment | null,
  currentTurn: AgentTurn | null,
  architectureContext: SessionArchitectureContext,
  finalInputTokens: number
): Promise<void> {
  if (!currentSegment || !currentTurn) {
    return
  }

  const decision = await conversationCompactionService.evaluate({
    segment: currentSegment,
    completedTurn: currentTurn,
    cumulativeInputTokens: finalInputTokens
  })
  logger.info('[SegmentCompact] decision', {
    topicId: architectureContext.topicId,
    traceId: architectureContext.traceId,
    turnId: currentTurn.id,
    segmentId: currentSegment.id,
    cumulativeInputTokens: finalInputTokens,
    decision: decision.shouldCompact,
    reason: decision.reason ?? '',
    preserveRecentMessages: DEFAULT_SEGMENT_RECENT_TURNS
  })

  if (!decision.shouldCompact) {
    return
  }

  const recentTurns = await agentTurnRepository.listBySegmentId(currentSegment.id, DEFAULT_SEGMENT_RECENT_TURNS)
  const artifacts = await agentArtifactRepository.listByTurnId(currentTurn.id)
  const fileChanges = await fileChangeJournalService.listByTurn(currentTurn.id)
  const rawSummary = await conversationSummaryService.buildRawSummary({
    segment: currentSegment,
    recentTurns,
    artifacts,
    fileChanges
  })
  const continuationSummary = await conversationSummaryService.compressSummary({
    rawSummary,
    maxChars: 1_200,
    maxLines: 24,
    maxLineChars: 160
  })

  await conversationSegmentService.markSegmentCompacted(currentSegment.id, {
    rawSummary,
    continuationSummary,
    compactReason: decision.reason,
    summaryVersion: 'v1'
  })
  const childSegment = await conversationSegmentService.createChildSegment({
    topicId: currentSegment.topicId,
    parentSegmentId: currentSegment.id,
    forkFromSdkSessionId: currentSegment.sdkSessionId,
    systemPromptVersion: architectureContext.promptEnvelope.systemPromptVersion,
    systemPromptHash: architectureContext.promptEnvelope.systemPromptHash,
    basePromptSnapshot: architectureContext.promptEnvelope.systemPrompt,
    continuationSummary,
    summaryVersion: 'v1'
  })
  logger.info('[SegmentCompact] applied', {
    topicId: architectureContext.topicId,
    traceId: architectureContext.traceId,
    turnId: currentTurn.id,
    segmentId: currentSegment.id,
    childSegmentId: childSegment.id,
    rawSummaryChars: rawSummary.length,
    continuationSummaryChars: continuationSummary.length,
    preservedRecentMessages: DEFAULT_SEGMENT_RECENT_TURNS,
    compactedMessageCount: recentTurns.length
  })
  logger.info('[ForkContinuation] create-child', {
    topicId: architectureContext.topicId,
    traceId: architectureContext.traceId,
    turnId: currentTurn.id,
    parentSegmentId: currentSegment.id,
    childSegmentId: childSegment.id,
    parentSdkSessionId: currentSegment.sdkSessionId,
    childSdkSessionId: childSegment.sdkSessionId,
    forkMode: 'new-session',
    systemPromptHash: architectureContext.promptEnvelope.systemPromptHash,
    continuationSummaryChars: continuationSummary.length
  })
}

function logStreamingProbeSummary(sessionId: string, duration: number, messageCount: number, streamingProbe: StreamingProbe): void {
  logger.info('Streaming probe summary', {
    sessionId,
    duration,
    messageCount,
    firstChunkAtMs: streamingProbe.firstChunkAtMs,
    firstTextDeltaAtMs: streamingProbe.firstTextDeltaAtMs,
    firstReasoningDeltaAtMs: streamingProbe.firstReasoningDeltaAtMs,
    firstToolCallAtMs: streamingProbe.firstToolCallAtMs,
    firstToolResultAtMs: streamingProbe.firstToolResultAtMs,
    textDeltaCount: streamingProbe.textDeltaCount,
    reasoningDeltaCount: streamingProbe.reasoningDeltaCount,
    assistantSnapshotWithTextCount: streamingProbe.assistantSnapshotWithTextCount,
    assistantSnapshotTextChars: streamingProbe.assistantSnapshotTextChars
  })
  if (streamingProbe.textDeltaCount === 0 && streamingProbe.assistantSnapshotWithTextCount > 0) {
    logger.warn('Streaming probe detected snapshot-only text response', {
      sessionId,
      duration,
      assistantSnapshotWithTextCount: streamingProbe.assistantSnapshotWithTextCount,
      assistantSnapshotTextChars: streamingProbe.assistantSnapshotTextChars
    })
  }
}

function updateThinkingProbe(message: SDKMessage, thinkingProbe: ThinkingProbe, sessionId: string): boolean {
  let thinkingDetectionReported = false
  if (message.type === 'stream_event') {
    const event = (message as any).event
    const eventType = String(event?.type || '')
    if (eventType === 'content_block_start') {
      const blockType = String(event?.content_block?.type || '')
      if (blockType === 'thinking' || blockType === 'redacted_thinking' || blockType === 'reasoning') {
        thinkingProbe.streamReasoningStartCount += 1
        logger.info('Detected thinking block in gateway response (stream start)', {
          sessionId,
          index: event?.index,
          blockType
        })
        thinkingDetectionReported = true
        void fetch('http://127.0.0.1:7777/event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: 'claude-thinking-depth',
            runId: 'pre-fix',
            hypothesisId: 'B',
            location: 'src/main/services/agents/services/claudecode/index.ts',
            msg: '[DEBUG] ClaudeCode response emitted thinking block',
            data: {
              agentSessionId: sessionId,
              eventType,
              blockType,
              index: event?.index,
              streamReasoningStartCount: thinkingProbe.streamReasoningStartCount,
              streamReasoningDeltaCount: thinkingProbe.streamReasoningDeltaCount
            },
            ts: Date.now()
          })
        }).catch(() => {})
      }
    } else if (eventType === 'content_block_delta') {
      const deltaType = String(event?.delta?.type || '')
      if (deltaType === 'thinking_delta' || deltaType === 'reasoning_delta') {
        thinkingProbe.streamReasoningDeltaCount += 1
      }
    }
  }

  if (message.type === 'assistant' && Array.isArray((message as any).message?.content)) {
    for (const block of (message as any).message.content as any[]) {
      const blockType = String(block?.type || '')
      if (blockType === 'thinking' || blockType === 'redacted_thinking' || blockType === 'reasoning') {
        const text = String(block?.thinking ?? block?.text ?? '')
        thinkingProbe.assistantReasoningBlockCount += 1
        thinkingProbe.assistantReasoningChars += text.length
      }
    }
    if (thinkingProbe.assistantReasoningBlockCount > 0) {
      logger.info('Detected thinking blocks in assistant snapshot response', {
        sessionId,
        blocks: thinkingProbe.assistantReasoningBlockCount,
        chars: thinkingProbe.assistantReasoningChars
      })
    }
  }

  return thinkingDetectionReported
}

function updateAssistantToolUseProbe(
  message: SDKMessage,
  toolUseProbe: ToolUseProbe,
  streamingProbe: StreamingProbe,
  sessionId: string
): void {
  if (message.type !== 'assistant' || !Array.isArray((message as any).message?.content)) {
    return
  }

  toolUseProbe.assistantMessageCount += 1
  const blocks = (message as any).message.content as any[]
  const toolUseBlocks = blocks.filter((block) => String(block?.type || '') === 'tool_use')
  const textBlocks = blocks.filter((block) => String(block?.type || '') === 'text')
  const textChars = textBlocks.reduce((total, block) => total + String((block as any)?.text || '').length, 0)

  if (toolUseBlocks.length > 0) {
    toolUseProbe.assistantWithToolUseCount += 1
    toolUseProbe.assistantToolUseBlockCount += toolUseBlocks.length
  }
  if (textBlocks.length > 0 && textChars > 0) {
    streamingProbe.assistantSnapshotWithTextCount += 1
    streamingProbe.assistantSnapshotTextChars += textChars
  }

  if (toolUseBlocks.length > 0) {
    logger.info('Detected assistant tool_use blocks in snapshot response', {
      sessionId,
      blocks: toolUseBlocks.length
    })
  }
}

async function processTransformedChunks(input: {
  sessionId: string
  message: SDKMessage
  chunks: ReturnType<typeof transformSDKMessageToStreamParts>
  startTime: number
  stream: AgentStream
  enqueuePromptMessage: (value: SDKUserMessage | null) => void
  closePromptStream: () => void
  architectureContext: SessionArchitectureContext
  pendingToolCalls: Map<string, PendingToolCall>
  bridgedScreenshotUrls: Set<string>
  streamingProbe: StreamingProbe
  currentSegment: AgentConversationSegment | null
  currentTurn: AgentTurn | null
  streamedAssistantText: string
  finalInputTokens: number
  harness?: ClaudeCodeHarnessAdapter
}): Promise<{
  streamedAssistantText: string
  finalInputTokens: number
}> {
  const {
    sessionId,
    message,
    chunks,
    startTime,
    stream,
    enqueuePromptMessage,
    closePromptStream,
    architectureContext,
    pendingToolCalls,
    bridgedScreenshotUrls,
    streamingProbe,
    currentSegment,
    currentTurn
  } = input
  let { streamedAssistantText, finalInputTokens, harness } = input

  for (const chunk of chunks) {
    const elapsedMs = Date.now() - startTime
    if (streamingProbe.firstChunkAtMs === null) {
      streamingProbe.firstChunkAtMs = elapsedMs
      logger.info('Streaming probe: first transformed chunk emitted', {
        sessionId,
        elapsedMs,
        chunkType: chunk.type,
        sdkMessageType: message.type
      })
    }

    if (chunk.type === 'text-delta') {
      streamingProbe.textDeltaCount += 1
      streamedAssistantText += String((chunk as any).text || '')
      if (streamingProbe.firstTextDeltaAtMs === null) {
        streamingProbe.firstTextDeltaAtMs = elapsedMs
        logger.info('Streaming probe: first text delta emitted', {
          sessionId,
          elapsedMs,
          sdkMessageType: message.type,
          chars: String((chunk as any).text || '').length
        })
      }
    }

    if (chunk.type === 'reasoning-delta') {
      streamingProbe.reasoningDeltaCount += 1
      if (streamingProbe.firstReasoningDeltaAtMs === null) {
        streamingProbe.firstReasoningDeltaAtMs = elapsedMs
        logger.info('Streaming probe: first reasoning delta emitted', {
          sessionId,
          elapsedMs,
          sdkMessageType: message.type,
          chars: String((chunk as any).text || '').length
        })
      }
    }

    if (chunk.type === 'tool-call' && streamingProbe.firstToolCallAtMs === null) {
      streamingProbe.firstToolCallAtMs = elapsedMs
      logger.info('Streaming probe: first tool call emitted', {
        sessionId,
        elapsedMs,
        sdkMessageType: message.type,
        toolName: (chunk as any).toolName ?? ''
      })
    }

    if (chunk.type === 'tool-call') {
      pendingToolCalls.set(String((chunk as any).toolCallId || ''), {
        toolName: String((chunk as any).toolName || ''),
        input: (chunk as any).input
      })
    }

    if ((chunk.type === 'tool-result' || chunk.type === 'tool-error') && streamingProbe.firstToolResultAtMs === null) {
      streamingProbe.firstToolResultAtMs = elapsedMs
      logger.info('Streaming probe: first tool result emitted', {
        sessionId,
        elapsedMs,
        chunkType: chunk.type,
        sdkMessageType: message.type,
        toolName: (chunk as any).toolName ?? ''
      })
    }

    if (chunk.type === 'tool-result') {
      await handleToolResultSideEffects({
        chunk,
        architectureContext: architectureContext as QueryArchitectureContext,
        currentSegment,
        currentTurn,
        pendingToolCalls,
        getArtifactSourceType,
        shouldOffloadToolResult,
        tryExtractFilePath
      })
    }

    if (chunk.type === 'finish') {
      finalInputTokens = Number((chunk as any).totalUsage?.inputTokens ?? finalInputTokens ?? 0)
    }

    if (chunk.type === 'tool-error') {
      architectureContext.pendingFileChanges.delete(String((chunk as any).toolCallId || ''))
      logger.warn('Tool execution failed in stream chunk', {
        sessionId,
        toolCallId: (chunk as any).toolCallId ?? '',
        toolName: (chunk as any).toolName ?? '',
        input: summarizeChunkField((chunk as any).input).slice(0, 600),
        error: summarizeChunkField((chunk as any).error).slice(0, 1200)
      })
    }

    maybeBridgeScreenshotToolResult({
      chunk,
      sessionId,
      bridgedScreenshotUrls,
      enqueuePromptMessage
    })

    if (chunk.type === 'error') {
      logger.error('Error chunk received from SDK stream', {
        sessionId,
        elapsedMs,
        error: summarizeChunkField((chunk as any).error).slice(0, 1200)
      })
    }

    emitChunk(stream, chunk, harness)

    if (chunk.type === 'finish' || chunk.type === 'error') {
      if (chunk.type === 'finish') {
        emitLifecycleEvent(stream, 'stream-finished', harness)
      }
      logger.info('Closing prompt stream as SDK signaled completion', {
        elapsedMs,
        chunkType: chunk.type,
        reason: chunk.type === 'finish' ? 'finished' : 'error_occurred',
        ...(chunk.type === 'error' ? { error: summarizeChunkField((chunk as any).error).slice(0, 1200) } : {})
      })
      closePromptStream()
      logger.info('Prompt stream closed successfully')
    }
  }

  return { streamedAssistantText, finalInputTokens }
}

export async function processClaudeSdkQuery(input: {
  promptStream: AsyncIterable<SDKUserMessage>
  enqueuePromptMessage: (value: SDKUserMessage | null) => void
  closePromptStream: () => void
  options: Options
  stream: AgentStream & { sdkSessionId?: string }
  errorChunks: string[]
  agentId: string
  sessionId: string
  architectureContext: SessionArchitectureContext
  harness?: ClaudeCodeHarnessAdapter
}): Promise<void> {
  const { promptStream, enqueuePromptMessage, closePromptStream, options, stream, errorChunks, agentId, sessionId, harness } =
    input
  const architectureContext = input.architectureContext
  const jsonOutput: SDKMessage[] = []
  let hasCompleted = false
  const startTime = Date.now()
  const streamState = new ClaudeStreamState({ agentSessionId: sessionId })
  const bridgedScreenshotUrls = new Set<string>()
  const toolUseProbe: ToolUseProbe = {
    assistantMessageCount: 0,
    assistantWithToolUseCount: 0,
    assistantToolUseBlockCount: 0,
    transformedToolCallCount: 0,
    transformedToolResultCount: 0
  }
  const thinkingProbe: ThinkingProbe = {
    streamReasoningStartCount: 0,
    streamReasoningDeltaCount: 0,
    assistantReasoningBlockCount: 0,
    assistantReasoningChars: 0
  }
  let thinkingDetectionReported = false
  let currentSegment = architectureContext.activeSegment
  let currentTurn = architectureContext.currentTurn
  let finalInputTokens = 0
  let streamedAssistantText = ''
  const assistantSnapshotTexts: string[] = []
  const pendingToolCalls = new Map<string, PendingToolCall>()
  let compactBoundaryCount = 0
  let repeatedCompactionTriggered = false
  let finalStopReason: 'stop' | 'length' | 'toolUse' | 'error' | 'aborted' = 'stop'
  const streamingProbe: StreamingProbe = {
    firstChunkAtMs: null,
    firstTextDeltaAtMs: null,
    firstReasoningDeltaAtMs: null,
    firstToolCallAtMs: null,
    firstToolResultAtMs: null,
    textDeltaCount: 0,
    reasoningDeltaCount: 0,
    assistantSnapshotWithTextCount: 0,
    assistantSnapshotTextChars: 0
  }

  try {
    for await (const message of query({ prompt: promptStream, options })) {
      if (hasCompleted) break

      jsonOutput.push(message)

      const messageType = String((message as any)?.type || '')
      const systemSubtype = messageType === 'system' ? String((message as any)?.subtype || '') : ''
      const compactProbePreview = JSON.stringify(message).slice(0, 500)
      const hasCompactSignal = compactProbePreview.toLowerCase().includes('compact')

      if (messageType === 'system') {
        logger.info('[compact-probe][sdk-system]', {
          sessionId,
          subtype: systemSubtype || 'unknown',
          hasCompactSignal
        })
        if (systemSubtype === 'status' && hasCompactSignal) {
          logger.info('[compact-probe][sdk-status-compact]', {
            sessionId,
            keys: Object.keys((message as Record<string, unknown>) || {}),
            preview: compactProbePreview
          })
        }
        if (systemSubtype === 'compact_boundary') {
          compactBoundaryCount += 1
          logger.info('[compact-probe][boundary-count]', {
            sessionId,
            compactBoundaryCount,
            maxAutoCompactionsPerQuery: MAX_AUTO_COMPACTIONS_PER_QUERY
          })
          if (compactBoundaryCount > MAX_AUTO_COMPACTIONS_PER_QUERY) {
            repeatedCompactionTriggered = true
            throw new Error(
              `Detected repeated Claude auto-compaction loop after ${compactBoundaryCount} compact boundaries in one request`
            )
          }
        }
      } else if (hasCompactSignal) {
        logger.info('[compact-probe][sdk-message]', {
          sessionId,
          type: messageType || 'unknown',
          preview: compactProbePreview
        })
      }

      if (message.type === 'assistant') {
        const assistantSnapshotText = extractAssistantTextFromSdkMessage(message)
        if (assistantSnapshotText) {
          assistantSnapshotTexts.push(assistantSnapshotText)
        }
        const stopReason = String((message as { stop_reason?: unknown }).stop_reason || '').trim()
        if (stopReason === 'stop' || stopReason === 'length' || stopReason === 'toolUse' || stopReason === 'error') {
          finalStopReason = stopReason
        }
      }

      const detectedThinking = updateThinkingProbe(message, thinkingProbe, sessionId)
      if (detectedThinking && !thinkingDetectionReported) {
        thinkingDetectionReported = true
      }
      updateAssistantToolUseProbe(message, toolUseProbe, streamingProbe, sessionId)

      if (message.type === 'system' && message.subtype === 'init') {
        const nextState = await handleInitSystemMessage({
          message,
          stream,
          sessionId,
          agentId,
          architectureContext: architectureContext as QueryArchitectureContext,
          currentSegment,
          currentTurn
        })
        currentSegment = nextState.currentSegment
        currentTurn = nextState.currentTurn
      }

      const chunks = transformSDKMessageToStreamParts(message, streamState)
      const chunkTypes = chunks.map((chunk) => chunk.type)
      const toolCallCount = chunkTypes.filter((type) => type === 'tool-call').length
      const toolResultCount = chunkTypes.filter((type) => type === 'tool-result' || type === 'tool-error').length
      toolUseProbe.transformedToolCallCount += toolCallCount
      toolUseProbe.transformedToolResultCount += toolResultCount
      if (toolCallCount > 0 || toolResultCount > 0) {
        logger.info('Transformed stream tool chunks', {
          sessionId,
          messageType: message.type,
          toolCallCount,
          toolResultCount,
          chunkTypes
        })
      }

      const nextChunkState = await processTransformedChunks({
        sessionId,
        message,
        chunks,
        startTime,
        stream,
        enqueuePromptMessage,
        closePromptStream,
        architectureContext,
        pendingToolCalls,
        bridgedScreenshotUrls,
        streamingProbe,
        currentSegment,
        currentTurn,
        streamedAssistantText,
        finalInputTokens,
        harness
      })
      streamedAssistantText = nextChunkState.streamedAssistantText
      finalInputTokens = nextChunkState.finalInputTokens
    }

    const duration = Date.now() - startTime
    logStreamingProbeSummary(sessionId, duration, jsonOutput.length, streamingProbe)

    const persistedAssistantText = buildPersistedAssistantText({
      snapshotTexts: assistantSnapshotTexts,
      streamedText: streamedAssistantText
    })
    if (persistedAssistantText) {
      harness?.appendAssistantResponse({
        text: persistedAssistantText,
        stopReason: finalStopReason
      })
    }

    if (currentTurn) {
      const completedAt = new Date().toISOString()
      await agentTurnRepository.update(currentTurn.id, {
        assistantText: persistedAssistantText || undefined,
        completedAt,
        status: 'completed',
        cumulativeInputTokens: finalInputTokens
      })
      currentTurn = {
        ...currentTurn,
        assistantText: persistedAssistantText || undefined,
        completedAt,
        status: 'completed',
        cumulativeInputTokens: finalInputTokens
      }
    }

    await applyCompactionIfNeeded(currentSegment, currentTurn, architectureContext, finalInputTokens)

    emitLifecycleEvent(stream, 'complete', harness)
  } catch (error) {
    if (hasCompleted) return
    hasCompleted = true

    const duration = Date.now() - startTime
    const errorObj = error as any
    const isAborted =
      errorObj?.name === 'AbortError' ||
      errorObj?.message?.includes('aborted') ||
      options.abortController?.signal.aborted

    if (isAborted) {
      finalStopReason = 'aborted'
      if (currentTurn) {
        await agentTurnRepository.update(currentTurn.id, {
          assistantText:
            buildPersistedAssistantText({
              snapshotTexts: assistantSnapshotTexts,
              streamedText: streamedAssistantText
            }) || undefined,
          completedAt: new Date().toISOString(),
          status: 'cancelled',
          cumulativeInputTokens: finalInputTokens
        })
      }
      logger.info('SDK query aborted by client disconnect', { duration })
      emitCancelled(stream, new Error('Request aborted by client'), harness)
      return
    }

    errorChunks.push(errorObj instanceof Error ? errorObj.message : String(errorObj))
    finalStopReason = 'error'
    logger.error('SDK query failed', {
      duration,
      error: errorObj instanceof Error ? { name: errorObj.name, message: errorObj.message } : String(errorObj),
      stderr: errorChunks
    })

    if (currentTurn) {
      await agentTurnRepository.update(currentTurn.id, {
        assistantText:
          buildPersistedAssistantText({
            snapshotTexts: assistantSnapshotTexts,
            streamedText: streamedAssistantText
          }) || undefined,
        completedAt: new Date().toISOString(),
        status: 'failed',
        cumulativeInputTokens: finalInputTokens
      })
    }

    if (repeatedCompactionTriggered) {
      const recoveryMessage =
        '当前对话上下文过长。为了节约您的 token 消耗，已停止本次请求。请开启新对话后继续执行任务。'
      errorChunks.splice(0, errorChunks.length, recoveryMessage)
      try {
        await recoverFreshSegmentAfterCompactionLoop({
          currentSegment,
          currentTurn,
          architectureContext: architectureContext as QueryArchitectureContext,
          compactBoundaryCount
        })
      } catch (recoveryError) {
        logger.error('[CompactionFuse] failed to prepare fresh child segment', {
          topicId: architectureContext.topicId,
          traceId: architectureContext.traceId,
          segmentId: currentSegment?.id ?? '',
          error: recoveryError instanceof Error ? recoveryError.message : String(recoveryError)
        })
      }
    }
    const errorMessage = errorChunks.join('\n\n')
    if (streamedAssistantText || assistantSnapshotTexts.length > 0) {
      const partialAssistantText = buildPersistedAssistantText({
        snapshotTexts: assistantSnapshotTexts,
        streamedText: streamedAssistantText
      })
      if (partialAssistantText) {
        harness?.appendAssistantResponse({
          text: partialAssistantText,
          stopReason: 'error',
          errorMessage
        })
      }
    }

    emitError(stream, new Error(errorMessage), harness)
  } finally {
    closePromptStream()
  }
}
