import { EventEmitter } from 'node:events'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { terminalStorageLogger } = vi.hoisted(() => ({ terminalStorageLogger: vi.fn() }))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: terminalStorageLogger
    })
  }
}))

vi.mock('@shared/sessionPayloadLimits', async (importOriginal) => await importOriginal())

vi.mock('../../../database/repositories/agentTurnRepository', () => ({
  agentTurnRepository: {
    getById: vi.fn(),
    listBySegmentId: vi.fn(),
    save: vi.fn(),
    update: vi.fn()
  }
}))

vi.mock('../session-architecture/ConversationSegmentService', () => ({
  conversationSegmentService: {
    getActiveSegment: vi.fn(),
    createRootSegment: vi.fn(),
    bindSdkSession: vi.fn()
  }
}))

vi.mock('../harness/query-side-effects', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../harness/query-side-effects')>()
  return { ...actual, handleToolResultSideEffects: vi.fn() }
})

vi.mock('../../../BaseService', () => ({
  BaseService: class { async getDatabase() { return (globalThis as any).__piArtifactDatabase } }
}))

import { handleToolResultSideEffects } from '../harness/query-side-effects'
import { agentTurnRepository } from '../../../database/repositories/agentTurnRepository'
import { conversationSegmentService } from '../session-architecture/ConversationSegmentService'
import type { AgentStream, AgentStreamEvent } from '../../../interfaces/AgentStreamInterface'
import type { AgentConversationSegment, AgentTurn } from '../session-architecture/types'
import { convertPiUsage, processPiHarnessQuery } from '../harness/pi-query-stream'

function createStreamRecorder(): AgentStream & { events: AgentStreamEvent[] } {
  const stream = new EventEmitter() as AgentStream & { events: AgentStreamEvent[] }
  stream.events = []
  stream.on('data', (event: AgentStreamEvent) => {
    stream.events.push(event)
  })
  return stream
}

function createHarnessStub(overrides?: {
  prompt?: (prompt: string, options?: unknown) => Promise<unknown>
  abort?: () => Promise<unknown>
}): {
  harness: any
  emitAgentEvent: (event: unknown) => Promise<void>
  emitNestedToolEvent: (event: unknown) => Promise<void>
  abort: ReturnType<typeof vi.fn>
  prompt: ReturnType<typeof vi.fn>
} {
  let listener: ((event: unknown) => Promise<void>) | undefined
  let nestedToolListener: ((event: unknown) => void | Promise<void>) | undefined
  const abort = vi.fn(overrides?.abort ?? (async () => undefined))
  const prompt = vi.fn(overrides?.prompt ?? (async () => ({ role: 'assistant', content: [], stopReason: 'stop', usage: {} })))

  return {
    emitAgentEvent: async (event) => {
      await listener?.(event)
    },
    emitNestedToolEvent: async (event) => {
      await nestedToolListener?.(event)
    },
    abort,
    prompt,
    harness: {
      enabled: false,
      mode: 'pi-npm',
      importStrategy: 'npm-native-import',
      invokeContext: {
        runtime: { traceId: 'trace-1' },
        skills: {},
        prompt: {
          resources: {
            skills: []
          }
        },
        projection: {
          topicId: 'topic-1',
          piSessionId: 'pi-session-1'
        }
      },
      appendUserPrompt() {},
      appendAssistantResponse() {},
      recordProjectionEvent() {},
      runtimeBridge: {
        subscribeNestedToolEvents(next: (event: unknown) => void | Promise<void>) {
          nestedToolListener = next
          return () => {
            nestedToolListener = undefined
          }
        },
        model: {
          provider: 'provider-1',
          id: 'model-1'
        },
        harness: {
          subscribe(next: (event: unknown) => Promise<void>) {
            listener = next
            return () => {
              listener = undefined
            }
          },
          prompt,
          abort
        }
      }
    }
  }
}

describe('convertPiUsage', () => {
  it('counts cache tokens as part of input tokens while preserving upstream total', () => {
    const usage = convertPiUsage({
      input: 1441,
      output: 180,
      cacheRead: 2048,
      cacheWrite: 0,
      totalTokens: 3669,
      reasoning: 60
    })

    expect(usage).toMatchObject({
      inputTokens: 3489,
      outputTokens: 180,
      totalTokens: 3669,
      inputTokenDetails: {
        noCacheTokens: 1441,
        cacheReadTokens: 2048,
        cacheWriteTokens: 0
      },
      outputTokenDetails: {
        textTokens: 120,
        reasoningTokens: 60
      }
    })
  })
})

describe('processPiHarnessQuery', () => {
  const activeSegment: AgentConversationSegment = {
    id: 'segment-1',
    topicId: 'topic-1',
    sdkSessionId: 'pi-session-1',
    systemPromptVersion: 'v1',
    systemPromptHash: 'hash-1',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
  const currentTurn: AgentTurn = {
    id: 'turn-1',
    topicId: 'topic-1',
    segmentId: 'segment-1',
    traceId: 'trace-1',
    userMessageId: 'user-1',
    userText: 'hello',
    startedAt: '2026-01-01T00:00:00.000Z',
    status: 'running'
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(agentTurnRepository, 'update').mockResolvedValue(undefined)
  })

  afterEach(() => {
    delete (globalThis as any).__piArtifactDatabase
    vi.restoreAllMocks()
    vi.useRealTimers()
    delete process.env.PI_TERMINAL_TIMEOUT_MS
    delete process.env.PI_IDLE_TIMEOUT_MS
  })

  it.each(['completed', 'failed', 'cancelled-result', 'cancelled-error'])('notifies %s before a pending status write settles and only logs its later failure', async (outcome) => {
    let rejectUpdate!: (error: Error) => void
    vi.mocked(agentTurnRepository.update).mockReturnValueOnce(new Promise<void>((_, reject) => {
      rejectUpdate = reject
    }))
    const originalError = new Error(outcome === 'failed' ? '401 Unauthorized' : 'Request aborted')
    if (outcome === 'cancelled-error') originalError.name = 'AbortError'
    const stub = createHarnessStub({ prompt: async () => {
      if (outcome === 'failed' || outcome === 'cancelled-error') throw originalError
      return {
        content: [{ type: 'text', text: 'done' }],
        stopReason: outcome === 'cancelled-result' ? 'aborted' : 'stop',
        usage: { input: 42 }
      }
    } })
    const stream = createStreamRecorder()
    await processPiHarnessQuery({
      stream, sessionId: 'session-1', agentId: 'agent-1',
      architectureContext: { traceId: 'trace-1', topicId: 'topic-1', activeSegment, currentTurn, pendingFileChanges: new Map() } as any,
      harness: stub.harness, prompt: 'hello'
    })
    const status = outcome.startsWith('cancelled') ? 'cancelled' : outcome
    expect(agentTurnRepository.update).toHaveBeenCalledTimes(1)
    expect(agentTurnRepository.update).toHaveBeenCalledWith('turn-1', expect.objectContaining({
      status, completedAt: expect.any(String),
      assistantText: outcome === 'completed' ? 'done' : undefined,
      cumulativeInputTokens: outcome === 'completed' ? 42 : 0
    }))
    expect(stream.events.map(event => event.type)).toEqual(
      outcome === 'completed' ? ['chunk', 'stream-finished', 'complete'] : [status === 'failed' ? 'error' : 'cancelled']
    )
    if (outcome === 'completed') expect(stream.events[0].chunk?.type).toBe('finish')
    if (outcome === 'failed') expect(stream.events[0].error).toBe(originalError)
    const eventsBeforeFailure = [...stream.events]
    rejectUpdate(new Error('status write failed'))
    await Promise.resolve()
    expect(terminalStorageLogger).toHaveBeenCalledWith(
      '[PiQuery] failed to persist terminal turn in background',
      expect.objectContaining({ sessionId: 'session-1', turnId: 'turn-1', status })
    )
    expect(stream.events).toEqual(eventsBeforeFailure)
    expect(stub.prompt).toHaveBeenCalledTimes(1)
    expect(agentTurnRepository.update).toHaveBeenCalledTimes(1)
  })

  it.each(['reject', 'throw'])('does not report a successful model response as failed when a status write can %s', async (failureMode) => {
    const storageError = new Error('status write failed')
    vi.mocked(agentTurnRepository.update).mockImplementationOnce(() => {
      if (failureMode === 'throw') throw storageError
      return Promise.reject(storageError)
    })
    const stub = createHarnessStub()
    const stream = createStreamRecorder()
    await processPiHarnessQuery({
      stream, sessionId: 'session-1', agentId: 'agent-1',
      architectureContext: { traceId: 'trace-1', topicId: 'topic-1', activeSegment, currentTurn, pendingFileChanges: new Map() } as any,
      harness: stub.harness, prompt: 'hello'
    })
    expect(stream.events.map(event => event.type)).toEqual(['chunk', 'stream-finished', 'complete'])
    expect(agentTurnRepository.update).toHaveBeenCalledTimes(1)
    expect(stub.prompt).toHaveBeenCalledTimes(1)
    expect(terminalStorageLogger).toHaveBeenCalledWith(
      '[PiQuery] failed to persist terminal turn in background', expect.objectContaining({ status: 'completed' })
    )
    expect(terminalStorageLogger).not.toHaveBeenCalledWith('Pi harness query failed', expect.anything())
  })

  it.each(['reuse', 'create-segment', 'bind-session', 'save-turn'])('keeps startup DB access scoped to required initialization: %s', async (mode) => {
    const stub = createHarnessStub()
    const stream = createStreamRecorder()
    const initializedTurn = { ...currentTurn, assistantMessageId: 'assistant-1' }
    Object.assign(stub.harness.invokeContext.projection, {
      turnId: currentTurn.id, userMessageId: currentTurn.userMessageId, assistantMessageId: 'assistant-1'
    })
    let releaseInitialization!: () => void
    const pending = new Promise<void>(resolve => { releaseInitialization = resolve })
    vi.mocked(conversationSegmentService.createRootSegment).mockImplementationOnce(async () => {
      await pending
      return activeSegment
    })
    vi.mocked(conversationSegmentService.bindSdkSession).mockImplementationOnce(() => pending)
    vi.mocked(agentTurnRepository.save).mockImplementationOnce(async () => {
      await pending
      return initializedTurn
    })
    const run = processPiHarnessQuery({
      stream, sessionId: 'session-1', agentId: 'agent-1',
      architectureContext: {
        traceId: 'trace-1', topicId: 'topic-1', currentPrompt: 'hello',
        activeSegment: mode === 'create-segment' ? undefined : mode === 'bind-session' ? { ...activeSegment, sdkSessionId: '' } : activeSegment,
        currentTurn: mode === 'save-turn' ? undefined : initializedTurn,
        promptEnvelope: { systemPromptVersion: 'v1', systemPromptHash: 'hash-1', systemPrompt: 'system' },
        pendingFileChanges: new Map()
      } as any,
      harness: stub.harness, prompt: 'hello'
    })
    if (mode !== 'reuse') {
      await Promise.resolve()
      expect(stub.prompt).not.toHaveBeenCalled()
      expect(agentTurnRepository.update).not.toHaveBeenCalled()
    }
    releaseInitialization()
    await run
    expect(conversationSegmentService.createRootSegment).toHaveBeenCalledTimes(mode === 'create-segment' ? 1 : 0)
    expect(conversationSegmentService.bindSdkSession).toHaveBeenCalledTimes(mode === 'bind-session' ? 1 : 0)
    expect(agentTurnRepository.save).toHaveBeenCalledTimes(mode === 'save-turn' ? 1 : 0)
    expect(agentTurnRepository.getById).not.toHaveBeenCalled()
    expect(agentTurnRepository.listBySegmentId).not.toHaveBeenCalled()
    expect(conversationSegmentService.getActiveSegment).not.toHaveBeenCalled()
    expect(stub.prompt).toHaveBeenCalledTimes(1)
  })

  it.each(['direct', 'nested', 'parallel'])('keeps silent %s tools alive past the model deadlines and restores idle detection', async (kind) => {
    vi.useFakeTimers()
    process.env.PI_TERMINAL_TIMEOUT_MS = '1000'
    process.env.PI_IDLE_TIMEOUT_MS = '1000'
    let resolvePrompt: ((value: unknown) => void) | undefined
    const harnessStub = createHarnessStub({
      prompt: () => new Promise((resolve) => { resolvePrompt = resolve })
    })
    const stream = createStreamRecorder()
    const runPromise = processPiHarnessQuery({
      stream, sessionId: 'session-1', agentId: 'agent-1',
      architectureContext: {
        traceId: 'trace-1', topicId: 'topic-1', activeSegment, currentTurn,
        pendingFileChanges: new Map()
      } as any,
      harness: harnessStub.harness, prompt: 'hello'
    })
    await vi.advanceTimersByTimeAsync(0)
    await harnessStub.emitAgentEvent({
      type: 'message_start', message: { role: 'assistant', content: [] }
    })
    const toolName = 'mcp__slow__tool'
    const start = async (id: string) => kind === 'direct'
      ? harnessStub.emitAgentEvent({ type: 'tool_execution_start', toolCallId: id, toolName })
      : harnessStub.emitNestedToolEvent({ type: 'start', toolCallId: id, toolName, input: {} })
    const end = async (id: string) => kind === 'direct'
      ? harnessStub.emitAgentEvent({
          type: 'tool_execution_end', toolCallId: id, toolName, isError: true, result: 'tool timeout'
        })
      : harnessStub.emitNestedToolEvent({
          type: 'success', toolCallId: id, toolName, input: {},
          result: { content: [{ type: 'text', text: 'done' }] }
        })
    await start('tool-1')
    if (kind === 'parallel') await start('tool-2')
    await vi.advanceTimersByTimeAsync(2000)
    expect(harnessStub.abort).not.toHaveBeenCalled()
    if (kind !== 'direct') {
      await harnessStub.emitNestedToolEvent({ type: 'update', toolCallId: 'tool-1', toolName })
    }
    await end('tool-1')
    if (kind === 'parallel') {
      await vi.advanceTimersByTimeAsync(2000)
      expect(harnessStub.abort).not.toHaveBeenCalled()
      await end('tool-2')
    }
    await vi.advanceTimersByTimeAsync(999)
    expect(harnessStub.abort).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(harnessStub.abort).toHaveBeenCalledTimes(1)
    // Complete the stub without retrying so no pending timers survive the test.
    resolvePrompt?.({ role: 'assistant', content: [], stopReason: 'stop', usage: {} })
    await runPromise
    expect(vi.getTimerCount()).toBe(0)
    const toolResults = stream.events.filter(event =>
      event.type === 'chunk' && ['tool-result', 'tool-error'].includes(String(event.chunk?.type))
    )
    expect(toolResults).toHaveLength(kind === 'parallel' ? 2 : 1)
  })

  it('still allows external cancellation while a nested tool is silent', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    let resolvePrompt: ((value: unknown) => void) | undefined
    const harnessStub = createHarnessStub({
      prompt: () => new Promise(resolve => { resolvePrompt = resolve }),
      abort: async () => { resolvePrompt?.({ stopReason: 'aborted', content: [], usage: {} }) }
    })
    const stream = createStreamRecorder()
    const runPromise = processPiHarnessQuery({
      stream, sessionId: 'session-1', agentId: 'agent-1',
      architectureContext: {
        traceId: 'trace-1', topicId: 'topic-1', activeSegment, currentTurn,
        pendingFileChanges: new Map()
      } as any,
      harness: harnessStub.harness, prompt: 'hello', abortSignal: controller.signal
    })
    await vi.advanceTimersByTimeAsync(0)
    await harnessStub.emitNestedToolEvent({
      type: 'start', toolCallId: 'tool-1', toolName: 'mcp__slow__tool', input: {}
    })
    await vi.advanceTimersByTimeAsync(61000)
    expect(harnessStub.abort).not.toHaveBeenCalled()
    controller.abort()
    await runPromise
    expect(harnessStub.abort).toHaveBeenCalledTimes(1)
    expect(stream.events.map(event => event.type)).toContain('cancelled')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not start a prompt when cancelled before harness initialization finishes', async () => {
    const controller = new AbortController()
    controller.abort()
    const harnessStub = createHarnessStub()
    const stream = createStreamRecorder()
    await processPiHarnessQuery({
      stream, sessionId: 'session-1', agentId: 'agent-1',
      architectureContext: {
        traceId: 'trace-1', topicId: 'topic-1', activeSegment, currentTurn,
        pendingFileChanges: new Map()
      } as any,
      harness: harnessStub.harness, prompt: 'cancelled request', abortSignal: controller.signal
    })
    expect(harnessStub.prompt).not.toHaveBeenCalled()
    expect(agentTurnRepository.update).toHaveBeenCalledWith('turn-1', expect.objectContaining({ status: 'cancelled' }))
    expect(stream.events.map(event => event.type)).toEqual(['cancelled'])
  })

  it('acknowledges cancellation only after old MCP clients finish closing', async () => {
    const controller = new AbortController()
    controller.abort()
    const harnessStub = createHarnessStub()
    const stream = createStreamRecorder()
    let releaseClose!: () => void
    let startedClose!: () => void
    const closing = new Promise<void>((resolve) => { startedClose = resolve })
    harnessStub.harness.runtimeBridge.mcpClients = [{ close: () => {
      startedClose()
      return new Promise<void>((resolve) => { releaseClose = resolve })
    } }]
    const run = processPiHarnessQuery({
      stream, sessionId: 'session-1', agentId: 'agent-1',
      architectureContext: {
        traceId: 'trace-1', topicId: 'topic-1', activeSegment, currentTurn,
        pendingFileChanges: new Map()
      } as any,
      harness: harnessStub.harness, prompt: 'hello', abortSignal: controller.signal
    })
    await closing
    expect(stream.events).toEqual([])
    releaseClose()
    await run
    expect(stream.events.map(event => event.type)).toEqual(['cancelled'])
  })

  it('aborts the PI harness and emits cancelled when the external signal aborts', async () => {
    const abortController = new AbortController()
    let aborted = false
    let resolvePrompt: (() => void) | undefined
    const harnessStub = createHarnessStub({
      prompt: async () => {
        if (aborted) {
          return {
            role: 'assistant',
            content: [{ type: 'text', text: '' }],
            stopReason: 'aborted',
            usage: {}
          }
        }
        await new Promise<void>((resolve) => {
          resolvePrompt = resolve
        })
        return {
          role: 'assistant',
          content: [{ type: 'text', text: '' }],
          stopReason: 'aborted',
          usage: {}
        }
      },
      abort: async () => {
        aborted = true
        resolvePrompt?.()
      }
    })
    const stream = createStreamRecorder()

    const runPromise = processPiHarnessQuery({
      stream,
      sessionId: 'session-1',
      agentId: 'agent-1',
      architectureContext: {
        traceId: 'trace-1',
        topicId: 'topic-1',
        currentPrompt: 'hello',
        activeSegment,
        currentTurn,
        promptEnvelope: {
          systemPromptVersion: 'v1',
          systemPromptHash: 'hash-1',
          systemPrompt: 'system'
        },
        pendingFileChanges: new Map()
      } as any,
      harness: harnessStub.harness,
      prompt: 'hello',
      abortSignal: abortController.signal
    })

    abortController.abort()
    await runPromise

    expect(harnessStub.abort).toHaveBeenCalledTimes(1)
    expect(agentTurnRepository.update).toHaveBeenCalledWith(
      'turn-1',
      expect.objectContaining({
        status: 'cancelled'
      })
    )
    expect(stream.events.map((event) => event.type)).toEqual(['cancelled'])
  })

  it('fails the turn after retriable timeouts exhaust the retry budget', async () => {
    vi.useFakeTimers()
    process.env.PI_TERMINAL_TIMEOUT_MS = '1000'

    let resolvePrompt: (() => void) | undefined
    const harnessStub = createHarnessStub({
      prompt: async () => {
        await harnessStub.emitAgentEvent({
          type: 'message_start',
          message: {
            role: 'assistant',
            content: [],
            usage: {},
            stopReason: 'pending'
          }
        })
        await new Promise<void>((resolve) => {
          resolvePrompt = resolve
        })
        return {
          role: 'assistant',
          content: [{ type: 'text', text: '' }],
          stopReason: 'aborted',
          usage: {}
        }
      },
      abort: async () => {
        resolvePrompt?.()
      }
    })
    const stream = createStreamRecorder()

    const runPromise = processPiHarnessQuery({
      stream,
      sessionId: 'session-1',
      agentId: 'agent-1',
      architectureContext: {
        traceId: 'trace-1',
        topicId: 'topic-1',
        currentPrompt: 'hello',
        activeSegment,
        currentTurn,
        promptEnvelope: {
          systemPromptVersion: 'v1',
          systemPromptHash: 'hash-1',
          systemPrompt: 'system'
        },
        pendingFileChanges: new Map()
      } as any,
      harness: harnessStub.harness,
      prompt: 'hello'
    })

    await vi.runAllTimersAsync()
    await runPromise

    expect(harnessStub.abort).toHaveBeenCalledTimes(6)
    const retryStatusChunks = stream.events
      .filter((event): event is AgentStreamEvent & { chunk: Record<string, unknown> } => event.type === 'chunk' && Boolean(event.chunk))
      .filter((event) => String(event.chunk.type || '') === 'retry-status')
    expect(retryStatusChunks).toHaveLength(5)
    expect(String(retryStatusChunks[0]?.chunk?.text || '')).toBe('第1/5次重试')
    expect(String(retryStatusChunks[4]?.chunk?.text || '')).toBe('第5/5次重试')
    expect(agentTurnRepository.update).toHaveBeenCalledWith(
      'turn-1',
      expect.objectContaining({
        status: 'failed'
      })
    )
    expect(stream.events.map((event) => event.type)).toContain('error')
    expect(stream.events.map((event) => event.type)).not.toContain('complete')
    expect(stream.events.map((event) => event.type)).not.toContain('cancelled')
  })

  it('recovers a missing toolcall_end from the final assistant snapshot before surfacing terminated', async () => {
    vi.useFakeTimers()
    const harnessStub = createHarnessStub({
      prompt: async () => {
        await harnessStub.emitAgentEvent({
          type: 'message_start',
          message: {
            role: 'assistant',
            content: [],
            usage: {},
            stopReason: 'pending'
          }
        })
        await harnessStub.emitAgentEvent({
          type: 'message_update',
          assistantMessageEvent: {
            type: 'toolcall_start',
            contentIndex: 0,
            partial: {
              content: [
                {
                  name: 'mcp__video__generate_video'
                }
              ]
            }
          }
        })
        await harnessStub.emitAgentEvent({
          type: 'message_update',
          assistantMessageEvent: {
            type: 'toolcall_delta',
            contentIndex: 0,
            delta: '{"action":"status","taskId":"task-1"}{"action":"status","taskId":"task-1"}'
          }
        })
        await harnessStub.emitAgentEvent({
          type: 'message_end',
          message: {
            role: 'assistant',
            model: 'model-1',
            usage: {},
            stopReason: 'error',
            errorMessage: 'terminated',
            content: [
              {
                type: 'toolCall',
                toolCall: {
                  id: 'provider-tool-1',
                  name: 'mcp__video__generate_video',
                  arguments: {
                    action: 'status',
                    taskId: 'task-1'
                  }
                }
              }
            ]
          }
        })
        return {
          role: 'assistant',
          content: [
            {
              type: 'toolCall',
              toolCall: {
                id: 'provider-tool-1',
                name: 'mcp__video__generate_video',
                arguments: {
                  action: 'status',
                  taskId: 'task-1'
                }
              }
            }
          ],
          stopReason: 'error',
          errorMessage: 'terminated',
          usage: {}
        }
      }
    })
    const stream = createStreamRecorder()

    const runPromise = processPiHarnessQuery({
      stream,
      sessionId: 'session-1',
      agentId: 'agent-1',
      architectureContext: {
        traceId: 'trace-1',
        topicId: 'topic-1',
        currentPrompt: 'hello',
        activeSegment,
        currentTurn,
        promptEnvelope: {
          systemPromptVersion: 'v1',
          systemPromptHash: 'hash-1',
          systemPrompt: 'system'
        },
        pendingFileChanges: new Map()
      } as any,
      harness: harnessStub.harness,
      prompt: 'hello'
    })
    await vi.runAllTimersAsync()
    await runPromise

    const chunkTypes = stream.events
      .filter((event): event is AgentStreamEvent & { chunk: { type: string } } => event.type === 'chunk' && Boolean(event.chunk))
      .map((event) => event.chunk.type)

    expect(chunkTypes).toContain('tool-call')
    expect(chunkTypes).toContain('tool-input-end')
    expect(stream.events.map((event) => event.type)).toContain('error')
  })

  it.each(['SQLITE_BUSY', 'SQLITE_CONSTRAINT', 'large-output'])('emits a single real result without replay when ancillary storage rejects %s', async (code) => {
    vi.useFakeTimers()
    const actual = await vi.importActual<typeof import('../harness/query-side-effects')>('../harness/query-side-effects')
    const failure = Object.assign(new Error('private insert data'), { code: code === 'large-output' ? 'SQLITE_BUSY' : code })
    const returning = vi.fn().mockRejectedValue(failure)
    const inserted: any[] = []
    ;(globalThis as any).__piArtifactDatabase = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
      insert: () => ({ values: (row: any) => {
      inserted.push(row)
      return { returning }
    } }) }
    vi.mocked(handleToolResultSideEffects).mockImplementationOnce(actual.handleToolResultSideEffects)
    const result = { content: [{ type: 'text', text: 'successful bash output' + (code === 'large-output' ? 'x'.repeat(100000) : '') }] }
    const stub = createHarnessStub({ prompt: async () => {
      await stub.emitAgentEvent({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'bash-1', name: 'Bash', arguments: { command: 'test' } }], usage: {}, stopReason: 'toolUse' } })
      await stub.emitAgentEvent({ type: 'tool_execution_start', toolCallId: 'bash-1', toolName: 'Bash', args: { command: 'test' } })
      await stub.emitAgentEvent({ type: 'tool_execution_end', toolCallId: 'bash-1', toolName: 'Bash', isError: false, result })
      return { role: 'assistant', content: [], stopReason: 'stop', usage: {} }
    } })
    const stream = createStreamRecorder()
    const run = processPiHarnessQuery({ stream, sessionId: 'session-1', agentId: 'agent-1',
      architectureContext: { traceId: 'trace-1', topicId: 'topic-1', currentPrompt: 'hello', activeSegment, currentTurn, pendingFileChanges: new Map() } as any,
      harness: stub.harness, prompt: 'hello' })
    await vi.runAllTimersAsync()
    await run
    delete (globalThis as any).__piArtifactDatabase
    expect(returning).toHaveBeenCalledTimes(1)
    expect(new Set(inserted.map(row => row.id)).size).toBe(1)
    const chunks = stream.events.filter((e: any) => e.type === 'chunk').map((e: any) => e.chunk)
    const results = chunks.filter((c: any) => c.type === 'tool-result')
    expect(results).toHaveLength(1)
    expect(JSON.stringify(results[0].output)).toContain('successful bash output')
    expect(handleToolResultSideEffects).toHaveBeenCalled()
    expect(results[0].toolCallId).toBe((vi.mocked(handleToolResultSideEffects).mock.calls.at(-1)?.[0].chunk as any).toolCallId)
    expect(results[0].toolCallId).toBeTruthy()
    expect(results[0].toolCallId).toBe(chunks.find((c: any) => c.type === 'tool-call')?.toolCallId)
    expect(inserted.every(row => row.tool_call_id === 'bash-1')).toBe(true)
    expect(chunks.filter((c: any) => c.type === 'tool-error')).toHaveLength(0)
    if (code === 'large-output') {
      expect(Buffer.byteLength(JSON.stringify(results[0].output))).toBeLessThan(18000)
      expect(JSON.stringify(results[0].output)).toContain('storage unavailable')
      expect(JSON.stringify(results[0].output)).not.toContain('artifact://')
    }
    expect(stub.prompt).toHaveBeenCalledTimes(1)
    expect(stream.events.some(e => e.type === 'complete')).toBe(true)
  })

  it('reconciles a result before snapshot to the streamed card without duplicate provider card', async () => {
    vi.useFakeTimers()
    const harnessStub = createHarnessStub({
      prompt: async () => {
        await harnessStub.emitAgentEvent({
          type: 'message_start',
          message: {
            role: 'assistant',
            content: [],
            usage: {},
            stopReason: 'pending'
          }
        })
        await harnessStub.emitAgentEvent({
          type: 'message_update',
          assistantMessageEvent: {
            type: 'toolcall_start',
            contentIndex: 0,
            partial: {
              content: [
                {
                  name: 'mcp__video__generate_video'
                }
              ]
            }
          }
        })
        await harnessStub.emitAgentEvent({
          type: 'message_update',
          assistantMessageEvent: {
            type: 'toolcall_delta',
            contentIndex: 0,
            delta: '{"action":"status","taskId":"task-1"}{"action":"status","taskId":"task-1"}'
          }
        })
        await harnessStub.emitAgentEvent({
          type: 'tool_execution_end', toolCallId: 'provider-tool-1',
          toolName: 'mcp__video__generate_video', isError: false,
          result: { content: [{ type: 'text', text: 'done' }] }
        })
        await harnessStub.emitAgentEvent({
          type: 'message_end',
          message: {
            role: 'assistant',
            model: 'model-1',
            usage: {},
            stopReason: 'stop',
            errorMessage: 'invalid request',
            content: [
              {
                type: 'toolCall',
                toolCall: {
                  id: 'provider-tool-1',
                  name: 'mcp__video__generate_video',
                  arguments: {
                    action: 'status',
                    taskId: 'task-1'
                  }
                }
              }
            ]
          }
        })
        return {
          role: 'assistant',
          content: [
            {
              type: 'toolCall',
              toolCall: {
                id: 'provider-tool-1',
                name: 'mcp__video__generate_video',
                arguments: {
                  action: 'status',
                  taskId: 'task-1'
                }
              }
            }
          ],
          stopReason: 'stop',
          errorMessage: 'invalid request',
          usage: {}
        }
      }
    })
    const stream = createStreamRecorder()

    const runPromise = processPiHarnessQuery({
      stream,
      sessionId: 'session-1',
      agentId: 'agent-1',
      architectureContext: {
        traceId: 'trace-1',
        topicId: 'topic-1',
        currentPrompt: 'hello',
        activeSegment,
        currentTurn,
        promptEnvelope: {
          systemPromptVersion: 'v1',
          systemPromptHash: 'hash-1',
          systemPrompt: 'system'
        },
        pendingFileChanges: new Map()
      } as any,
      harness: harnessStub.harness,
      prompt: 'hello'
    })
    await vi.runAllTimersAsync()
    await runPromise

    const chunkTypes = stream.events
      .filter((event): event is AgentStreamEvent & { chunk: { type: string } } => event.type === 'chunk' && Boolean(event.chunk))
      .map((event) => event.chunk.type)

    expect(chunkTypes.filter(type => type === 'tool-result')).toHaveLength(1)
    const chunks = stream.events.filter((event: any) => event.type === 'chunk').map((event: any) => event.chunk)
    const start = chunks.find((chunk: any) => chunk.type === 'tool-input-start')
    expect(chunks.find((chunk: any) => chunk.type === 'tool-result')?.toolCallId).toBe(start?.id)
    expect(chunks.find((chunk: any) => chunk.type === 'tool-result')?.toolCallId).not.toBe('provider-tool-1')
    expect(stream.events.map((event) => event.type)).toContain('complete')
  })

  it('projects nested Codemode MCP calls as normal tool card chunks', async () => {
    const nestedToolName = 'mcp__vectcut__subtitle-recognition__submit_subtitle_recognition_task'
    const nestedToolCallId = 'codemode-nested-1'
    const harnessStub = createHarnessStub({
      prompt: async () => {
        await harnessStub.emitNestedToolEvent({
          type: 'start',
          toolCallId: nestedToolCallId,
          toolName: nestedToolName,
          input: { audioPath: '/tmp/audio.wav' }
        })
        await harnessStub.emitNestedToolEvent({
          type: 'success',
          toolCallId: nestedToolCallId,
          toolName: nestedToolName,
          input: { audioPath: '/tmp/audio.wav' },
          result: {
            content: [{ type: 'text', text: '{"taskId":"task-1"}' }]
          }
        })
        return {
          role: 'assistant',
          content: [{ type: 'text', text: 'done' }],
          stopReason: 'stop',
          usage: {}
        }
      }
    })
    const stream = createStreamRecorder()

    await processPiHarnessQuery({
      stream,
      sessionId: 'session-1',
      agentId: 'agent-1',
      architectureContext: {
        traceId: 'trace-1',
        topicId: 'topic-1',
        currentPrompt: 'hello',
        activeSegment,
        currentTurn,
        promptEnvelope: {
          systemPromptVersion: 'v1',
          systemPromptHash: 'hash-1',
          systemPrompt: 'system'
        },
        pendingFileChanges: new Map()
      } as any,
      harness: harnessStub.harness,
      prompt: 'hello'
    })

    const chunks = stream.events
      .filter((event): event is AgentStreamEvent & { chunk: Record<string, unknown> } => event.type === 'chunk')
      .map((event) => event.chunk)
    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: 'tool-call',
        toolCallId: nestedToolCallId,
        toolName: nestedToolName
      })
    )
    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: 'tool-result',
        toolCallId: nestedToolCallId,
        toolName: nestedToolName
      })
    )
  })

  it('retries retriable upstream errors and finalizes abandoned calls and partial inputs', async () => {
    vi.useFakeTimers()
    let promptAttempt = 0
    const harnessStub = createHarnessStub({
      prompt: async () => {
        promptAttempt += 1
        if (promptAttempt === 1) {
          await harnessStub.emitAgentEvent({
            type: 'message_start',
            message: {
              role: 'assistant',
              content: [],
              usage: {},
              stopReason: 'pending'
            }
          })
          await harnessStub.emitAgentEvent({
            type: 'message_update',
            assistantMessageEvent: {
              type: 'toolcall_start', contentIndex: 1,
              partial: { content: [null, { type: 'toolCall', name: 'Read' }] }
            }
          })
          await harnessStub.emitAgentEvent({
            type: 'message_end',
            message: {
              role: 'assistant',
              model: 'model-1',
              usage: {},
              stopReason: 'error',
              errorMessage: '502 "上游请求失败"',
              content: [{ type: 'toolCall', id: 'abandoned-retry-tool', name: 'Bash', arguments: {} }]
            }
          })
          return {
            role: 'assistant',
            content: [],
            stopReason: 'error',
            errorMessage: '502 "上游请求失败"',
            usage: {}
          }
        }

        await harnessStub.emitAgentEvent({
          type: 'message_start',
          message: {
            role: 'assistant',
            content: [],
            usage: {},
            stopReason: 'pending'
          }
        })
        await harnessStub.emitAgentEvent({
          type: 'message_update',
          assistantMessageEvent: {
            type: 'text_start',
            contentIndex: 0
          }
        })
        await harnessStub.emitAgentEvent({
          type: 'message_update',
          assistantMessageEvent: {
            type: 'text_delta',
            contentIndex: 0,
            delta: 'ok'
          }
        })
        await harnessStub.emitAgentEvent({
          type: 'message_update',
          assistantMessageEvent: {
            type: 'text_end',
            contentIndex: 0
          }
        })
        await harnessStub.emitAgentEvent({
          type: 'message_end',
          message: {
            role: 'assistant',
            model: 'model-1',
            usage: {},
            stopReason: 'stop',
            content: [{ type: 'text', text: 'ok' }]
          }
        })
        return {
          role: 'assistant',
          content: [{ type: 'text', text: 'ok' }],
          stopReason: 'stop',
          usage: {}
        }
      }
    })
    const stream = createStreamRecorder()

    const runPromise = processPiHarnessQuery({
      stream,
      sessionId: 'session-1',
      agentId: 'agent-1',
      architectureContext: {
        traceId: 'trace-1',
        topicId: 'topic-1',
        currentPrompt: 'hello',
        activeSegment,
        currentTurn,
        promptEnvelope: {
          systemPromptVersion: 'v1',
          systemPromptHash: 'hash-1',
          systemPrompt: 'system'
        },
        pendingFileChanges: new Map()
      } as any,
      harness: harnessStub.harness,
      prompt: 'hello'
    })
    await vi.runAllTimersAsync()
    await runPromise

    expect(harnessStub.prompt).toHaveBeenCalledTimes(2)
    const retryStatusChunks = stream.events
      .filter((event): event is AgentStreamEvent & { chunk: Record<string, unknown> } => event.type === 'chunk' && Boolean(event.chunk))
      .filter((event) => String(event.chunk.type || '') === 'retry-status')
    expect(retryStatusChunks).toHaveLength(1)
    expect(String(retryStatusChunks[0]?.chunk?.text || '')).toBe('第1/5次重试')
    expect(stream.events.map((event) => event.type)).toContain('complete')
    expect(stream.events.filter((event: any) => event.chunk?.type === 'tool-error').map((event: any) => event.chunk)).toContainEqual(
      expect.objectContaining({ toolName: 'Read', error: expect.stringContaining('Tool input abandoned') })
    )
    expect(stream.events.filter((event: any) => event.chunk?.type === 'tool-error').map((event: any) => event.chunk)).toContainEqual(
      expect.objectContaining({ toolName: 'Bash', error: expect.stringContaining('attempt ended') })
    )

  })

  it('bounds retries for transient upstream errors after visible text has streamed', async () => {
    vi.useFakeTimers()
    const harnessStub = createHarnessStub({
      prompt: async () => {
        await harnessStub.emitAgentEvent({
          type: 'message_start',
          message: {
            role: 'assistant',
            content: [],
            usage: {},
            stopReason: 'pending'
          }
        })
        await harnessStub.emitAgentEvent({
          type: 'message_update',
          assistantMessageEvent: {
            type: 'text_start',
            contentIndex: 0
          }
        })
        await harnessStub.emitAgentEvent({
          type: 'message_update',
          assistantMessageEvent: {
            type: 'text_delta',
            contentIndex: 0,
            delta: 'partial'
          }
        })
        await harnessStub.emitAgentEvent({
          type: 'message_end',
          message: {
            role: 'assistant',
            model: 'model-1',
            usage: {},
            stopReason: 'error',
            errorMessage: '502 "上游请求失败"',
            content: [{ type: 'text', text: 'partial' }]
          }
        })
        return {
          role: 'assistant',
          content: [{ type: 'text', text: 'partial' }],
          stopReason: 'error',
          errorMessage: '502 "上游请求失败"',
          usage: {}
        }
      }
    })
    const stream = createStreamRecorder()

    const runPromise = processPiHarnessQuery({
      stream,
      sessionId: 'session-1',
      agentId: 'agent-1',
      architectureContext: {
        traceId: 'trace-1',
        topicId: 'topic-1',
        currentPrompt: 'hello',
        activeSegment,
        currentTurn,
        promptEnvelope: {
          systemPromptVersion: 'v1',
          systemPromptHash: 'hash-1',
          systemPrompt: 'system'
        },
        pendingFileChanges: new Map()
      } as any,
      harness: harnessStub.harness,
      prompt: 'hello'
    })
    await vi.runAllTimersAsync()
    await runPromise

    expect(harnessStub.prompt).toHaveBeenCalledTimes(6)
    const retryStatusChunks = stream.events
      .filter((event): event is AgentStreamEvent & { chunk: Record<string, unknown> } => event.type === 'chunk' && Boolean(event.chunk))
      .filter((event) => String(event.chunk.type || '') === 'retry-status')
    expect(retryStatusChunks).toHaveLength(5)
    expect(String(retryStatusChunks[0]?.chunk?.text || '')).toBe('第1/5次重试')
    expect(String(retryStatusChunks[4]?.chunk?.text || '')).toBe('第5/5次重试')
    expect(stream.events.map((event) => event.type)).toContain('error')
  })

  it('retries connection error when no text or tool side effects were produced', async () => {
    vi.useFakeTimers()
    let promptAttempt = 0
    const harnessStub = createHarnessStub({
      prompt: async () => {
        promptAttempt += 1
        if (promptAttempt === 1) {
          await harnessStub.emitAgentEvent({
            type: 'message_start',
            message: {
              role: 'assistant',
              content: [],
              usage: {},
              stopReason: 'pending'
            }
          })
          await harnessStub.emitAgentEvent({
            type: 'message_end',
            message: {
              role: 'assistant',
              model: 'model-1',
              usage: {},
              stopReason: 'error',
              errorMessage: 'Connection error.',
              content: []
            }
          })
          return {
            role: 'assistant',
            content: [],
            stopReason: 'error',
            errorMessage: 'Connection error.',
            usage: {}
          }
        }

        await harnessStub.emitAgentEvent({
          type: 'message_start',
          message: {
            role: 'assistant',
            content: [],
            usage: {},
            stopReason: 'pending'
          }
        })
        await harnessStub.emitAgentEvent({
          type: 'message_update',
          assistantMessageEvent: {
            type: 'text_start',
            contentIndex: 0
          }
        })
        await harnessStub.emitAgentEvent({
          type: 'message_update',
          assistantMessageEvent: {
            type: 'text_delta',
            contentIndex: 0,
            delta: 'retry ok'
          }
        })
        await harnessStub.emitAgentEvent({
          type: 'message_update',
          assistantMessageEvent: {
            type: 'text_end',
            contentIndex: 0
          }
        })
        await harnessStub.emitAgentEvent({
          type: 'message_end',
          message: {
            role: 'assistant',
            model: 'model-1',
            usage: {},
            stopReason: 'stop',
            content: [{ type: 'text', text: 'retry ok' }]
          }
        })
        return {
          role: 'assistant',
          content: [{ type: 'text', text: 'retry ok' }],
          stopReason: 'stop',
          usage: {}
        }
      }
    })
    const stream = createStreamRecorder()

    const runPromise = processPiHarnessQuery({
      stream,
      sessionId: 'session-1',
      agentId: 'agent-1',
      architectureContext: {
        traceId: 'trace-1',
        topicId: 'topic-1',
        currentPrompt: 'hello',
        activeSegment,
        currentTurn,
        promptEnvelope: {
          systemPromptVersion: 'v1',
          systemPromptHash: 'hash-1',
          systemPrompt: 'system'
        },
        pendingFileChanges: new Map()
      } as any,
      harness: harnessStub.harness,
      prompt: 'hello'
    })
    await vi.runAllTimersAsync()
    await runPromise

    expect(harnessStub.prompt).toHaveBeenCalledTimes(2)
    const retryStatusChunks = stream.events
      .filter((event): event is AgentStreamEvent & { chunk: Record<string, unknown> } => event.type === 'chunk' && Boolean(event.chunk))
      .filter((event) => String(event.chunk.type || '') === 'retry-status')
    expect(retryStatusChunks).toHaveLength(1)
    expect(String(retryStatusChunks[0]?.chunk?.text || '')).toBe('第1/5次重试')
    expect(stream.events.map((event) => event.type)).toContain('complete')
  })

  it('retries temporarily unavailable model service errors', async () => {
    vi.useFakeTimers()
    let promptAttempt = 0
    const temporaryUnavailableError =
      'The model service is temporarily unavailable. Please try again later. (request id: test-request-id)'
    const harnessStub = createHarnessStub({
      prompt: async () => {
        promptAttempt += 1
        if (promptAttempt === 1) {
          await harnessStub.emitAgentEvent({
            type: 'message_start',
            message: {
              role: 'assistant',
              content: [],
              usage: {},
              stopReason: 'pending'
            }
          })
          await harnessStub.emitAgentEvent({
            type: 'message_end',
            message: {
              role: 'assistant',
              model: 'model-1',
              usage: {},
              stopReason: 'error',
              errorMessage: temporaryUnavailableError,
              content: []
            }
          })
          return {
            role: 'assistant',
            content: [],
            stopReason: 'error',
            errorMessage: temporaryUnavailableError,
            usage: {}
          }
        }

        await harnessStub.emitAgentEvent({
          type: 'message_start',
          message: {
            role: 'assistant',
            content: [],
            usage: {},
            stopReason: 'pending'
          }
        })
        await harnessStub.emitAgentEvent({
          type: 'message_update',
          assistantMessageEvent: {
            type: 'text_start',
            contentIndex: 0
          }
        })
        await harnessStub.emitAgentEvent({
          type: 'message_update',
          assistantMessageEvent: {
            type: 'text_delta',
            contentIndex: 0,
            delta: 'retry ok'
          }
        })
        await harnessStub.emitAgentEvent({
          type: 'message_update',
          assistantMessageEvent: {
            type: 'text_end',
            contentIndex: 0
          }
        })
        await harnessStub.emitAgentEvent({
          type: 'message_end',
          message: {
            role: 'assistant',
            model: 'model-1',
            usage: {},
            stopReason: 'stop',
            content: [{ type: 'text', text: 'retry ok' }]
          }
        })
        return {
          role: 'assistant',
          content: [{ type: 'text', text: 'retry ok' }],
          stopReason: 'stop',
          usage: {}
        }
      }
    })
    const stream = createStreamRecorder()

    const runPromise = processPiHarnessQuery({
      stream,
      sessionId: 'session-1',
      agentId: 'agent-1',
      architectureContext: {
        traceId: 'trace-1',
        topicId: 'topic-1',
        currentPrompt: 'hello',
        activeSegment,
        currentTurn,
        promptEnvelope: {
          systemPromptVersion: 'v1',
          systemPromptHash: 'hash-1',
          systemPrompt: 'system'
        },
        pendingFileChanges: new Map()
      } as any,
      harness: harnessStub.harness,
      prompt: 'hello'
    })
    await vi.runAllTimersAsync()
    await runPromise

    expect(harnessStub.prompt).toHaveBeenCalledTimes(2)
    const retryStatusChunks = stream.events
      .filter((event): event is AgentStreamEvent & { chunk: Record<string, unknown> } => event.type === 'chunk' && Boolean(event.chunk))
      .filter((event) => String(event.chunk.type || '') === 'retry-status')
    expect(retryStatusChunks).toHaveLength(1)
    expect(String(retryStatusChunks[0]?.chunk?.text || '')).toBe('第1/5次重试')
    expect(stream.events.map((event) => event.type)).toContain('complete')
  })

  it('does not replay prompts for nested local busy errors or mask them with failed status writes', async () => {
    const original = new Error('persistence failed', {
      cause: new AggregateError([new Error('SQLITE_BUSY: database is locked')])
    })
    const harnessStub = createHarnessStub({ prompt: async () => { throw original } })
    vi.mocked(agentTurnRepository.update).mockRejectedValueOnce(new Error('status write failed'))
    const stream = createStreamRecorder()
    await processPiHarnessQuery({
      stream,
      sessionId: 'session-1',
      agentId: 'agent-1',
      architectureContext: {
        traceId: 'trace-1', topicId: 'topic-1', currentPrompt: 'hello',
        activeSegment, currentTurn,
        promptEnvelope: { systemPromptVersion: 'v1', systemPromptHash: 'hash-1', systemPrompt: 'system' },
        pendingFileChanges: new Map()
      } as any,
      harness: harnessStub.harness,
      prompt: 'hello'
    })
    expect(harnessStub.prompt).toHaveBeenCalledTimes(1)
    expect(stream.events.find((event) => event.type === 'error')?.error).toBe(original)
  })

  it('retries broader transient provider errors before streaming starts', async () => {
    vi.useFakeTimers()

    const transientErrors = [
      'HTTP 429 Too Many Requests',
      '500 Internal Server Error',
      'model overloaded, please try again later',
      '服务繁忙，请稍后重试'
    ]

    for (const transientError of transientErrors) {
      let promptAttempt = 0
      const harnessStub = createHarnessStub({
        prompt: async () => {
          promptAttempt += 1
          if (promptAttempt === 1) {
            throw new Error(transientError)
          }

          await harnessStub.emitAgentEvent({
            type: 'message_start',
            message: {
              role: 'assistant',
              content: [],
              usage: {},
              stopReason: 'pending'
            }
          })
          await harnessStub.emitAgentEvent({
            type: 'message_update',
            assistantMessageEvent: {
              type: 'text_start',
              contentIndex: 0
            }
          })
          await harnessStub.emitAgentEvent({
            type: 'message_update',
            assistantMessageEvent: {
              type: 'text_delta',
              contentIndex: 0,
              delta: 'retry ok'
            }
          })
          await harnessStub.emitAgentEvent({
            type: 'message_update',
            assistantMessageEvent: {
              type: 'text_end',
              contentIndex: 0
            }
          })
          await harnessStub.emitAgentEvent({
            type: 'message_end',
            message: {
              role: 'assistant',
              model: 'model-1',
              usage: {},
              stopReason: 'stop',
              content: [{ type: 'text', text: 'retry ok' }]
            }
          })
          return {
            role: 'assistant',
            content: [{ type: 'text', text: 'retry ok' }],
            stopReason: 'stop',
            usage: {}
          }
        }
      })
      const stream = createStreamRecorder()

      const runPromise = processPiHarnessQuery({
        stream,
        sessionId: 'session-1',
        agentId: 'agent-1',
        architectureContext: {
          traceId: 'trace-1',
          topicId: 'topic-1',
          currentPrompt: 'hello',
          activeSegment,
          currentTurn,
          promptEnvelope: {
            systemPromptVersion: 'v1',
            systemPromptHash: 'hash-1',
            systemPrompt: 'system'
          },
          pendingFileChanges: new Map()
        } as any,
        harness: harnessStub.harness,
        prompt: 'hello'
      })
      await vi.runAllTimersAsync()
      await runPromise

      expect(harnessStub.prompt).toHaveBeenCalledTimes(2)
      const retryStatusChunks = stream.events
        .filter((event): event is AgentStreamEvent & { chunk: Record<string, unknown> } => event.type === 'chunk' && Boolean(event.chunk))
        .filter((event) => String(event.chunk.type || '') === 'retry-status')
      expect(retryStatusChunks).toHaveLength(1)
      expect(String(retryStatusChunks[0]?.chunk?.text || '')).toBe('第1/5次重试')
      expect(stream.events.map((event) => event.type)).toContain('complete')
    }
  })
})
