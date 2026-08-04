import type { TextStreamPart } from 'ai'
import { loggerService } from '@logger'

import type { AgentStream, AgentStreamEvent } from '../../../interfaces/AgentStreamInterface'
import type { ClaudeCodeHarnessAdapter } from './create-harness'

const logger = loggerService.withContext('ClaudeCodeEventAdapter')

function summarizeChunk(chunk: TextStreamPart<any>): Record<string, unknown> {
  const anyChunk = chunk as any
  return {
    type: chunk.type,
    id: typeof anyChunk?.id === 'string' ? anyChunk.id : undefined,
    toolCallId: typeof anyChunk?.toolCallId === 'string' ? anyChunk.toolCallId : undefined,
    toolName: typeof anyChunk?.toolName === 'string' ? anyChunk.toolName : undefined,
    textChars: typeof anyChunk?.text === 'string' ? anyChunk.text.length : 0,
    finishReason: typeof anyChunk?.finishReason === 'string' ? anyChunk.finishReason : undefined
  }
}

function recordProjectionEvent(
  harness: ClaudeCodeHarnessAdapter | undefined,
  event: Omit<Parameters<ClaudeCodeHarnessAdapter['recordProjectionEvent']>[0], 'timestamp'>
): void {
  if (!harness?.enabled) return
  harness.recordProjectionEvent(event)
}

export function emitChunk(
  stream: AgentStream,
  chunk: TextStreamPart<any>,
  harness?: ClaudeCodeHarnessAdapter
): void {
  logger.info('[EventAdapter] emit chunk', {
    traceId: harness?.invokeContext.runtime.traceId ?? '',
    topicId: harness?.invokeContext.projection.topicId ?? '',
    piSessionId: harness?.invokeContext.projection.piSessionId ?? '',
    chunk: summarizeChunk(chunk)
  })
  stream.emit('data', {
    type: 'chunk',
    chunk
  })
  recordProjectionEvent(harness, {
    kind: 'chunk',
    streamEventType: 'chunk',
    traceId: harness?.invokeContext.runtime.traceId ?? '',
    topicId: harness?.invokeContext.projection.topicId ?? '',
    turnId: harness?.invokeContext.projection.turnId,
    segmentId: harness?.invokeContext.projection.segmentId,
    piSessionId: harness?.invokeContext.projection.piSessionId ?? '',
    chunkType: chunk.type
  })
}

export function emitLifecycleEvent(
  stream: AgentStream,
  type: Extract<AgentStreamEvent['type'], 'stream-finished' | 'complete' | 'cancelled'>,
  harness?: ClaudeCodeHarnessAdapter
): void {
  logger.info('[EventAdapter] emit lifecycle', {
    traceId: harness?.invokeContext.runtime.traceId ?? '',
    topicId: harness?.invokeContext.projection.topicId ?? '',
    piSessionId: harness?.invokeContext.projection.piSessionId ?? '',
    type
  })
  stream.emit('data', { type })
  recordProjectionEvent(harness, {
    kind: 'lifecycle',
    streamEventType: type,
    traceId: harness?.invokeContext.runtime.traceId ?? '',
    topicId: harness?.invokeContext.projection.topicId ?? '',
    turnId: harness?.invokeContext.projection.turnId,
    segmentId: harness?.invokeContext.projection.segmentId,
    piSessionId: harness?.invokeContext.projection.piSessionId ?? ''
  })
}

export function emitError(stream: AgentStream, error: Error, harness?: ClaudeCodeHarnessAdapter): void {
  logger.warn('[EventAdapter] emit error', {
    traceId: harness?.invokeContext.runtime.traceId ?? '',
    topicId: harness?.invokeContext.projection.topicId ?? '',
    piSessionId: harness?.invokeContext.projection.piSessionId ?? '',
    errorMessage: error.message
  })
  stream.emit('data', {
    type: 'error',
    error
  })
  recordProjectionEvent(harness, {
    kind: 'error',
    streamEventType: 'error',
    traceId: harness?.invokeContext.runtime.traceId ?? '',
    topicId: harness?.invokeContext.projection.topicId ?? '',
    turnId: harness?.invokeContext.projection.turnId,
    segmentId: harness?.invokeContext.projection.segmentId,
    piSessionId: harness?.invokeContext.projection.piSessionId ?? '',
    errorMessage: error.message
  })
}

export function emitCancelled(stream: AgentStream, error: Error, harness?: ClaudeCodeHarnessAdapter): void {
  logger.warn('[EventAdapter] emit cancelled', {
    traceId: harness?.invokeContext.runtime.traceId ?? '',
    topicId: harness?.invokeContext.projection.topicId ?? '',
    piSessionId: harness?.invokeContext.projection.piSessionId ?? '',
    errorMessage: error.message
  })
  stream.emit('data', {
    type: 'cancelled',
    error
  })
  recordProjectionEvent(harness, {
    kind: 'error',
    streamEventType: 'cancelled',
    traceId: harness?.invokeContext.runtime.traceId ?? '',
    topicId: harness?.invokeContext.projection.topicId ?? '',
    turnId: harness?.invokeContext.projection.turnId,
    segmentId: harness?.invokeContext.projection.segmentId,
    piSessionId: harness?.invokeContext.projection.piSessionId ?? '',
    errorMessage: error.message
  })
}
