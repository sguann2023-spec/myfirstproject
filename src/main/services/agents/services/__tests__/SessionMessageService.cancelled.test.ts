import { EventEmitter } from 'node:events'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentStream } from '../../interfaces/AgentStreamInterface'

const {
  invokeMock,
  persistExchangeMock,
  persistUserMessageMock,
  persistAssistantMessageMock,
  upsertCanonicalMessageMock,
  upsertCanonicalMessagesMock,
  upsertCanonicalPartsMock,
  getTurnMock,
  updateTurnMock
} = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  persistExchangeMock: vi.fn(),
  persistUserMessageMock: vi.fn(),
  persistAssistantMessageMock: vi.fn(),
  upsertCanonicalMessageMock: vi.fn(),
  upsertCanonicalMessagesMock: vi.fn(),
  upsertCanonicalPartsMock: vi.fn(),
  getTurnMock: vi.fn(),
  updateTurnMock: vi.fn()
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

vi.mock('../../database/repositories/agentTranscriptRepository', () => ({
  agentTranscriptRepository: {
    upsertMessage: upsertCanonicalMessageMock,
    upsertMessages: upsertCanonicalMessagesMock,
    upsertParts: upsertCanonicalPartsMock
  }
}))

vi.mock('../../database/repositories/agentTurnRepository', () => ({
  agentTurnRepository: {
    getById: getTurnMock,
    update: updateTurnMock
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
    upsertCanonicalMessagesMock.mockResolvedValue([])
    upsertCanonicalMessageMock.mockResolvedValue({})
    upsertCanonicalPartsMock.mockResolvedValue([])
    getTurnMock.mockResolvedValue(null)
    updateTurnMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not dispatch an attempt that timed out during canonical persistence', async () => {
    const { SessionMessageService } = await import('../SessionMessageService')
    const service = new SessionMessageService()
    const controller = new AbortController()
    vi.spyOn(service as any, 'getLastAgentSessionId').mockResolvedValue('last-session-id')
    vi.spyOn(service as any, 'persistCanonicalTurnStart').mockImplementation(async () => {
      controller.abort()
    })
    await expect(service.createSessionMessage(
      { id: 'session-a', agent_id: 'agent-a' } as any,
      { content: 'hello' } as any,
      controller,
      { persist: true }
    )).rejects.toMatchObject({ name: 'AbortError' })
    expect(invokeMock).not.toHaveBeenCalled()
    expect(persistUserMessageMock).not.toHaveBeenCalled()
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

  it('allocates stable identities once, creates canonical envelopes, and finalizes the same assistant', async () => {
    const { SessionMessageService } = await import('../SessionMessageService')
    const service = new SessionMessageService()
    const agentStream = createAgentStream()
    invokeMock.mockResolvedValue(agentStream)
    vi.spyOn(service as any, 'getLastAgentSessionId').mockResolvedValue('last-session-id')

    const stableIds = {
      turnId: 'turn-stable',
      traceId: 'trace-stable',
      userMessageId: 'message-user-stable',
      assistantMessageId: 'message-assistant-stable'
    }
    const result = await service.createSessionMessage(
      { id: 'session-1', agent_id: 'agent-1', model: 'claude-3' } as any,
      { content: '继续', model: 'openai:qwen3.7-plus' } as any,
      new AbortController(),
      { invocationIds: stableIds }
    )

    expect(invokeMock.mock.calls[0]?.[7]).toEqual(stableIds)
    expect(upsertCanonicalMessagesMock).toHaveBeenCalledWith([
      expect.objectContaining({
        id: stableIds.userMessageId,
        turnId: stableIds.turnId,
        role: 'user',
        status: 'completed'
      }),
      expect.objectContaining({
        id: stableIds.assistantMessageId,
        turnId: stableIds.turnId,
        parentMessageId: stableIds.userMessageId,
        role: 'assistant',
        status: 'streaming',
        provider: expect.objectContaining({ requestId: stableIds.traceId })
      })
    ])

    agentStream.emit('data', { type: 'chunk', chunk: { type: 'text-start' } })
    agentStream.emit('data', { type: 'chunk', chunk: { type: 'text-delta', text: '完成' } })
    agentStream.emit('data', { type: 'chunk', chunk: { type: 'text-end' } })
    agentStream.emit('data', { type: 'complete' })
    await flushMicrotasks(8)
    await expect(result.completion).resolves.toEqual({})

    expect(upsertCanonicalMessageMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: stableIds.assistantMessageId,
        turnId: stableIds.turnId,
        parentMessageId: stableIds.userMessageId,
        status: 'completed'
      })
    )
    expect(upsertCanonicalPartsMock).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          messageId: stableIds.assistantMessageId,
          type: 'text',
          data: expect.objectContaining({ text: '完成', status: 'completed' })
        })
      ])
    )
  })

  it('reuses caller identities across retries without creating new canonical messages', async () => {
    const { SessionMessageService } = await import('../SessionMessageService')
    const stableIds = {
      turnId: 'turn-retry',
      traceId: 'trace-retry',
      userMessageId: 'message-user-retry',
      assistantMessageId: 'message-assistant-retry'
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const service = new SessionMessageService()
      const agentStream = createAgentStream()
      invokeMock.mockResolvedValueOnce(agentStream)
      vi.spyOn(service as any, 'getLastAgentSessionId').mockResolvedValue('last-session-id')
      const result = await service.createSessionMessage(
        { id: 'session-1', agent_id: 'agent-1', model: 'claude-3' } as any,
        { content: '重试请求', model: 'openai:qwen3.7-plus' } as any,
        new AbortController(),
        { invocationIds: stableIds }
      )
      agentStream.emit('data', { type: 'complete' })
      await flushMicrotasks(8)
      await result.completion
    }

    expect(invokeMock.mock.calls.map((call) => call[7])).toEqual([stableIds, stableIds])
    expect(upsertCanonicalMessagesMock).toHaveBeenCalledTimes(2)
    for (const call of upsertCanonicalMessagesMock.mock.calls) {
      expect(call[0].map((message: { id: string }) => message.id)).toEqual([
        stableIds.userMessageId,
        stableIds.assistantMessageId
      ])
    }
  })

  it('finalizes canonical assistant as failed on stream errors', async () => {
    const { SessionMessageService } = await import('../SessionMessageService')
    const service = new SessionMessageService()
    const agentStream = createAgentStream()
    invokeMock.mockResolvedValue(agentStream)
    vi.spyOn(service as any, 'getLastAgentSessionId').mockResolvedValue('last-session-id')

    const result = await service.createSessionMessage(
      { id: 'session-1', agent_id: 'agent-1', model: 'claude-3' } as any,
      { content: '失败请求', model: 'openai:qwen3.7-plus' } as any,
      new AbortController()
    )
    void result.stream.getReader().read().catch(() => undefined)
    agentStream.emit('data', { type: 'error', error: new Error('provider failed') })
    await flushMicrotasks(8)

    await expect(result.completion).rejects.toMatchObject({ message: 'provider failed' })
    expect(upsertCanonicalMessageMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'failed',
        error: expect.objectContaining({ message: 'provider failed' })
      })
    )
  })

  it('marks the agent turn failed when invoke initialization throws', async () => {
    const { SessionMessageService } = await import('../SessionMessageService')
    const service = new SessionMessageService()
    const stableIds = {
      turnId: 'turn-init-failure',
      traceId: 'trace-init-failure',
      userMessageId: 'user-init-failure',
      assistantMessageId: 'assistant-init-failure'
    }
    invokeMock.mockRejectedValue(new Error('bootstrap failed'))
    getTurnMock.mockResolvedValue({ id: stableIds.turnId, status: 'running' })
    vi.spyOn(service as any, 'getLastAgentSessionId').mockResolvedValue('')

    await expect(
      service.createSessionMessage(
        { id: 'session-1', agent_id: 'agent-1', model: 'claude-3' } as any,
        { content: '失败请求', model: 'openai:qwen3.7-plus' } as any,
        new AbortController(),
        { invocationIds: stableIds }
      )
    ).rejects.toThrow('bootstrap failed')

    expect(updateTurnMock).toHaveBeenCalledWith(stableIds.turnId, {
      status: 'failed',
      completedAt: expect.any(String)
    })
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

  it('completes the stream even when canonical finalize persistence fails', async () => {
    const { SessionMessageService } = await import('../SessionMessageService')
    const service = new SessionMessageService()
    const agentStream = createAgentStream()

    invokeMock.mockResolvedValue(agentStream)
    vi.spyOn(service as any, 'getLastAgentSessionId').mockResolvedValue('last-session-id')
    const persistSpy = vi.spyOn(service as any, 'persistHeadlessExchange').mockResolvedValue({})
    upsertCanonicalMessageMock.mockImplementation(async (input: any) => {
      if (input?.status === 'completed') {
        throw new Error('SQLITE_BUSY: database is locked')
      }
      return {}
    })

    const result = await service.createSessionMessage(
      {
        id: 'session-1',
        agent_id: 'agent-1',
        model: 'claude-3'
      } as any,
      {
        content: '正常完成',
        model: 'openai:qwen3.7-plus'
      } as any,
      new AbortController(),
      { persist: true }
    )

    const reader = result.stream.getReader()
    const readAll = (async () => {
      const chunks: unknown[] = []
      for (;;) {
        const { done, value } = await reader.read()
        if (done) return chunks
        chunks.push(value)
      }
    })()

    agentStream.emit('data', { type: 'chunk', chunk: { type: 'text-start', id: 'text-1' } })
    agentStream.emit('data', { type: 'chunk', chunk: { type: 'text-delta', id: 'text-1', text: '答案' } })
    agentStream.emit('data', { type: 'chunk', chunk: { type: 'text-end', id: 'text-1' } })
    agentStream.emit('data', { type: 'complete' })

    await flushMicrotasks()
    await expect(result.streamFinished).resolves.toBeUndefined()
    // The reader must close normally instead of surfacing a stream error.
    await expect(readAll).resolves.toHaveLength(3)
    await expect(result.completion).resolves.toEqual({})
    expect(persistSpy).toHaveBeenCalledTimes(1)
  })
})
