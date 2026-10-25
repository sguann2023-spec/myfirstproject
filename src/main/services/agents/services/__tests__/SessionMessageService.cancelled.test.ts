import { EventEmitter } from 'node:events'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentStream } from '../../interfaces/AgentStreamInterface'

const { invokeMock, persistExchangeMock, persistUserMessageMock, persistAssistantMessageMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  persistExchangeMock: vi.fn(),
  persistUserMessageMock: vi.fn(),
  persistAssistantMessageMock: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), silly: vi.fn() })
  }
}))

vi.mock('@main/apiServer/services/mcp', () => ({
  mcpApiService: {
    getServerInfo: vi.fn()
  }
}))

vi.mock('@main/apiServer/utils', () => ({
  validateModelId: vi.fn(),
  ModelValidationError: class ModelValidationError extends Error {}
}))

vi.mock('@main/utils', () => ({
  getDataPath: vi.fn(() => '/tmp/data')
}))

vi.mock('../../BaseService', () => ({
  BaseService: class BaseService {
    async getDatabase() {
      throw new Error('getDatabase should be mocked in tests')
    }
  }
}))

vi.mock('../../database/sessionMessageRepository', () => ({
  agentMessageRepository: {
    persistExchange: persistExchangeMock,
    persistUserMessage: persistUserMessageMock,
    persistAssistantMessage: persistAssistantMessageMock
  }
}))

vi.mock('../claudecode', () => ({
  default: class MockClaudeCodeService {
    invoke = invokeMock
  }
}))

function flushMicrotasks(times = 4) {
  let promise = Promise.resolve()
  for (let index = 0; index < times; index += 1) {
    promise = promise.then(() => Promise.resolve())
  }
  return promise
}

function createAgentStream(): AgentStream {
  return new EventEmitter() as AgentStream
}

describe('SessionMessageService cancelled persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('persists a cancelled exchange when only thinking blocks were streamed', async () => {
    const { SessionMessageService } = await import('../SessionMessageService')
    const service = new SessionMessageService()
    const agentStream = createAgentStream()

    invokeMock.mockResolvedValue(agentStream)
    vi.spyOn(service as any, 'getLastAgentSessionId').mockResolvedValue('last-session-id')
    const persistSpy = vi.spyOn(service as any, 'persistHeadlessExchange').mockResolvedValue({})

    const result = await service.createSessionMessage(
      {
        id: 'session-1',
        agent_id: 'agent-1',
        model: 'claude-3'
      } as any,
      {
        content: '继续',
        model: 'openai:qwen3.7-plus'
      } as any,
      new AbortController(),
      { persist: true }
    )

    agentStream.emit('data', { type: 'chunk', chunk: { type: 'reasoning-start', id: 'reasoning-1' } })
    agentStream.emit('data', { type: 'chunk', chunk: { type: 'reasoning-delta', id: 'reasoning-1', text: '先分析一下' } })
    agentStream.emit('data', { type: 'chunk', chunk: { type: 'reasoning-end', id: 'reasoning-1' } })
    agentStream.emit('data', { type: 'cancelled' })

    await flushMicrotasks()
    await expect(result.streamFinished).resolves.toBeUndefined()
    await expect(result.completion).resolves.toEqual({})

    expect(persistSpy).toHaveBeenCalledTimes(1)
    expect(persistSpy.mock.calls[0]?.[2]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'thinking',
          content: '先分析一下'
        })
      ])
    )
    expect(persistSpy.mock.calls[0]?.[11]).toBe(true)
  })

  it('persists a cancelled exchange when usage exists without assistant text blocks', async () => {
    const { SessionMessageService } = await import('../SessionMessageService')
    const service = new SessionMessageService()
    const agentStream = createAgentStream()

    invokeMock.mockResolvedValue(agentStream)
    vi.spyOn(service as any, 'getLastAgentSessionId').mockResolvedValue('last-session-id')
    const persistSpy = vi.spyOn(service as any, 'persistHeadlessExchange').mockResolvedValue({})

    const result = await service.createSessionMessage(
      {
        id: 'session-1',
        agent_id: 'agent-1',
        model: 'claude-3'
      } as any,
      {
        content: '继续',
        model: 'openai:qwen3.7-plus'
      } as any,
      new AbortController(),
      { persist: true }
    )

    agentStream.emit('data', {
      type: 'chunk',
      chunk: {
        type: 'usage',
        usage: {
          inputTokens: 11,
          outputTokens: 7,
          totalTokens: 18
        }
      } as any
    })
    agentStream.emit('data', { type: 'cancelled' })

    await flushMicrotasks()
    await expect(result.streamFinished).resolves.toBeUndefined()
    await expect(result.completion).resolves.toEqual({})

    expect(persistSpy).toHaveBeenCalledTimes(1)
    expect(persistSpy.mock.calls[0]?.[2]).toEqual([])
    expect(persistSpy.mock.calls[0]?.[8]).toMatchObject({
      prompt_tokens: 11,
      completion_tokens: 7,
      total_tokens: 18
    })
    expect(persistSpy.mock.calls[0]?.[11]).toBe(true)
  })

  it('persists the user message immediately when the stream starts', async () => {
    const { SessionMessageService } = await import('../SessionMessageService')
    const service = new SessionMessageService()
    const agentStream = createAgentStream()
    persistUserMessageMock.mockResolvedValue({})

    invokeMock.mockResolvedValue(agentStream)
    vi.spyOn(service as any, 'getLastAgentSessionId').mockResolvedValue('last-session-id')

    const result = await service.createSessionMessage(
      {
        id: 'session-1',
        agent_id: 'agent-1',
        model: 'claude-3'
      } as any,
      {
        content: '帮我搜一下产品宣传视频',
        model: 'openai:qwen3.7-plus',
        createdAt: 1787504105982
      } as any,
      new AbortController(),
      { persist: true, displayContent: '帮我搜一下产品宣传视频' }
    )

    // No stream events emitted yet: the user message must already be persisted.
    await flushMicrotasks()
    expect(persistUserMessageMock).toHaveBeenCalledTimes(1)
    expect(persistUserMessageMock.mock.calls[0]?.[0]).toMatchObject({
      sessionId: 'session-1',
      agentSessionId: 'last-session-id'
    })
    expect(persistUserMessageMock.mock.calls[0]?.[0]?.payload?.message).toMatchObject({
      role: 'user',
      status: 'success',
      createdAt: '2026-08-23T16:55:05.982Z'
    })
    expect(persistUserMessageMock.mock.calls[0]?.[0]?.payload?.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'main_text', content: '帮我搜一下产品宣传视频' })
      ])
    )

    // A cancelled stream without assistant content still keeps the user message
    // and must not create a duplicate user row.
    agentStream.emit('data', { type: 'cancelled' })
    await flushMicrotasks()
    await expect(result.streamFinished).resolves.toBeUndefined()
    await expect(result.completion).resolves.toEqual({})
    expect(persistUserMessageMock).toHaveBeenCalledTimes(1)
  })

  it('reuses the stream-start user message id when persisting the completed exchange', async () => {
    const { SessionMessageService } = await import('../SessionMessageService')
    const service = new SessionMessageService()
    const agentStream = createAgentStream()
    persistUserMessageMock.mockResolvedValue({})

    invokeMock.mockResolvedValue(agentStream)
    vi.spyOn(service as any, 'getLastAgentSessionId').mockResolvedValue('last-session-id')
    const persistSpy = vi.spyOn(service as any, 'persistHeadlessExchange').mockResolvedValue({})

    await service.createSessionMessage(
      { id: 'session-1', agent_id: 'agent-1', model: 'claude-3' } as any,
      { content: '继续', model: 'openai:qwen3.7-plus' } as any,
      new AbortController(),
      { persist: true }
    )

    agentStream.emit('data', { type: 'complete' })
    await flushMicrotasks()

    const immediateUserMsgId = persistUserMessageMock.mock.calls[0]?.[0]?.payload?.message?.id
    expect(immediateUserMsgId).toBeTruthy()
    expect(persistSpy).toHaveBeenCalledTimes(1)
    expect(persistSpy.mock.calls[0]?.[12]).toBe(immediateUserMsgId)
  })

  it('checkpoints the assistant message during streaming so a hard kill keeps the partial reply', async () => {
    vi.useFakeTimers()
    try {
      const { SessionMessageService } = await import('../SessionMessageService')
      const service = new SessionMessageService()
      const agentStream = createAgentStream()
      persistUserMessageMock.mockResolvedValue({})
      persistAssistantMessageMock.mockResolvedValue({})

      invokeMock.mockResolvedValue(agentStream)
      vi.spyOn(service as any, 'getLastAgentSessionId').mockResolvedValue('last-session-id')

      await service.createSessionMessage(
        { id: 'session-1', agent_id: 'agent-1', model: 'claude-3' } as any,
        { content: '继续', model: 'openai:qwen3.7-plus' } as any,
        new AbortController(),
        { persist: true }
      )

      agentStream.emit('data', { type: 'chunk', chunk: { type: 'text-start' } })
      agentStream.emit('data', { type: 'chunk', chunk: { type: 'text-delta', text: '这是部分回答' } })
      agentStream.emit('data', { type: 'chunk', chunk: { type: 'text-end' } })

      await vi.advanceTimersByTimeAsync(2100)
      expect(persistAssistantMessageMock).toHaveBeenCalled()
      const snapshotPayload = persistAssistantMessageMock.mock.calls[0]?.[0]?.payload
      expect(snapshotPayload.message).toMatchObject({
        role: 'assistant',
        status: 'streaming'
      })
      expect(snapshotPayload.blocks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'main_text', content: '这是部分回答' })
        ])
      )
      expect(persistAssistantMessageMock.mock.calls[0]?.[0]).toMatchObject({
        sessionId: 'session-1',
        agentSessionId: 'last-session-id'
      })

      // Identical accumulator state must not rewrite the row on every tick.
      const callsAfterFirstTick = persistAssistantMessageMock.mock.calls.length
      await vi.advanceTimersByTimeAsync(2100)
      expect(persistAssistantMessageMock.mock.calls.length).toBe(callsAfterFirstTick)

      agentStream.emit('data', { type: 'cancelled' })
      await flushMicrotasks()
    } finally {
      vi.useRealTimers()
    }
  })

  it('skips persistence for a cancelled exchange with no text, blocks, or usage', async () => {
    const { SessionMessageService } = await import('../SessionMessageService')
    const service = new SessionMessageService()
    const agentStream = createAgentStream()

    invokeMock.mockResolvedValue(agentStream)
    vi.spyOn(service as any, 'getLastAgentSessionId').mockResolvedValue('last-session-id')
    const persistSpy = vi.spyOn(service as any, 'persistHeadlessExchange').mockResolvedValue({})

    const result = await service.createSessionMessage(
      {
        id: 'session-1',
        agent_id: 'agent-1',
        model: 'claude-3'
      } as any,
      {
        content: '继续',
        model: 'openai:qwen3.7-plus'
      } as any,
      new AbortController(),
      { persist: true }
    )

    agentStream.emit('data', { type: 'cancelled' })

    await flushMicrotasks()
    await expect(result.streamFinished).resolves.toBeUndefined()
    await expect(result.completion).resolves.toEqual({})

    expect(persistSpy).not.toHaveBeenCalled()
  })

  it('passes the original user createdAt through to headless persistence', async () => {
    const { SessionMessageService } = await import('../SessionMessageService')
    const service = new SessionMessageService()
    const agentStream = createAgentStream()
    const originalCreatedAt = 1787504105982

    invokeMock.mockResolvedValue(agentStream)
    vi.spyOn(service as any, 'getLastAgentSessionId').mockResolvedValue('last-session-id')
    const persistSpy = vi.spyOn(service as any, 'persistHeadlessExchange').mockResolvedValue({})

    const result = await service.createSessionMessage(
      {
        id: 'session-1',
        agent_id: 'agent-1',
        model: 'claude-3'
      } as any,
      {
        content: '继续',
        model: 'openai:qwen3.7-plus',
        createdAt: originalCreatedAt
      } as any,
      new AbortController(),
      { persist: true }
    )

    agentStream.emit('data', {
      type: 'chunk',
      chunk: {
        type: 'usage',
        usage: {
          inputTokens: 3,
          outputTokens: 2,
          totalTokens: 5
        }
      } as any
    })
    agentStream.emit('data', { type: 'cancelled' })

    await flushMicrotasks()
    await expect(result.streamFinished).resolves.toBeUndefined()
    await expect(result.completion).resolves.toEqual({})

    expect(persistSpy).toHaveBeenCalledTimes(1)
    expect(persistSpy.mock.calls[0]?.[10]).toBe(originalCreatedAt)
    expect(persistSpy.mock.calls[0]?.[11]).toBe(true)
  })

  it('marks only the assistant message as cancelled in persisted history', async () => {
    const { SessionMessageService } = await import('../SessionMessageService')
    const service = new SessionMessageService()
    persistExchangeMock.mockResolvedValue({})

    await (service as any).persistHeadlessExchange(
      { id: 'session-1', agent_id: 'agent-1', model: 'qwen3.7-plus' },
      '什么是勾股定理？',
      [{ id: 'thinking-1', type: 'thinking', status: 'success', content: '分析中' }],
      'runtime-session-1',
      'assistant-1',
      undefined,
      undefined,
      'qwen3.7-plus',
      undefined,
      undefined,
      1787504105982,
      true
    )

    const persisted = persistExchangeMock.mock.calls[0]?.[0]
    expect(persisted.user.payload.message).toMatchObject({
      role: 'user',
      status: 'success'
    })
    expect(persisted.user.payload.message.aborted).toBeUndefined()
    expect(persisted.assistant.payload.message).toMatchObject({
      role: 'assistant',
      status: 'cancelled',
      aborted: true
    })
  })
})
