import { EventEmitter } from 'node:events'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

vi.mock('@shared/sessionPayloadLimits', () => ({
  limitInlineToolPayload: vi.fn((value: unknown) => value)
}))

vi.mock('../../../database/repositories/agentTurnRepository', () => ({
  agentTurnRepository: {
    save: vi.fn(),
    update: vi.fn()
  }
}))

vi.mock('../session-architecture/ConversationSegmentService', () => ({
  conversationSegmentService: {
    createRootSegment: vi.fn(),
    bindSdkSession: vi.fn()
  }
}))

vi.mock('../harness/query-side-effects', () => ({
  handleToolResultSideEffects: vi.fn()
}))

import { agentTurnRepository } from '../../../database/repositories/agentTurnRepository'
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
  abort: ReturnType<typeof vi.fn>
  prompt: ReturnType<typeof vi.fn>
} {
  let listener: ((event: unknown) => Promise<void>) | undefined
  const abort = vi.fn(overrides?.abort ?? (async () => undefined))
  const prompt = vi.fn(overrides?.prompt ?? (async () => ({ role: 'assistant', content: [], stopReason: 'stop', usage: {} })))

  return {
    emitAgentEvent: async (event) => {
      await listener?.(event)
    },
    abort,
    prompt,
    harness: {
      enabled: false,
      mode: 'pi-npm',
      importStrategy: 'npm-native-import',
      invokeContext: {
        runtime: { traceId: 'trace-1' },
        projection: {
          topicId: 'topic-1',
          piSessionId: 'pi-session-1'
        }
      },
      appendUserPrompt() {},
      appendAssistantResponse() {},
      recordProjectionEvent() {},
      runtimeBridge: {
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
    vi.spyOn(agentTurnRepository, 'update').mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    delete process.env.PI_TERMINAL_TIMEOUT_MS
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

  it('fails the turn when the assistant never reaches a terminal state before the timeout', async () => {
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

    await vi.advanceTimersByTimeAsync(1000)
    await runPromise

    expect(harnessStub.abort).toHaveBeenCalledTimes(1)
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

    const chunkTypes = stream.events
      .filter((event): event is AgentStreamEvent & { chunk: { type: string } } => event.type === 'chunk' && Boolean(event.chunk))
      .map((event) => event.chunk.type)

    expect(chunkTypes).toContain('tool-call')
    expect(chunkTypes).toContain('tool-input-end')
    expect(stream.events.map((event) => event.type)).toContain('error')
  })
})
