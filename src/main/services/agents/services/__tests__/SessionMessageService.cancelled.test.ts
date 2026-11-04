import { EventEmitter } from 'node:events'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { UpsertAgentMessagePartInput } from '../../database/repositories/agentTranscript.types'
import type { AgentPersistenceHooks, AgentStream } from '../../interfaces/AgentStreamInterface'
import { isWorkspaceRunning, workspaceActivity } from '../workspaceRename'

const {
  invokeMock,
  persistExchangeMock,
  persistUserMessageMock,
  upsertCanonicalMessageMock,
  upsertCanonicalMessagesMock,
  upsertCanonicalPartsMock,
  getTurnMock,
  updateTurnMock
} = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  persistExchangeMock: vi.fn(),
  persistUserMessageMock: vi.fn(),
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
    persistUserMessage: persistUserMessageMock
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

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

async function startCanonicalStream(runtimeFinished?: Promise<void>) {
  const { SessionMessageService } = await import('../SessionMessageService')
  const service = new SessionMessageService()
  const agentStream = createAgentStream()
  agentStream.runtimeFinished = runtimeFinished
  const abortController = new AbortController()
  invokeMock.mockResolvedValue(agentStream)
  vi.spyOn(service as any, 'getLastAgentSessionId').mockResolvedValue('last-session-id')
  const result = await service.createSessionMessage(
    { id: 'session-1', agent_id: 'agent-1', model: 'claude-3', accessible_paths: ['/work/running'] } as any,
    { content: 'hello', model: 'claude-3' } as any,
    abortController
  )
  await flushMicrotasks(16)
  // Exclude the accepted user part from incremental assistant-write assertions.
  upsertCanonicalPartsMock.mockClear()
  const reader = result.stream.getReader()
  const send = async (chunk: any) => {
    const read = reader.read()
    agentStream.emit('data', { type: 'chunk', chunk })
    await expect(read).resolves.toEqual({ done: false, value: chunk })
    await flushMicrotasks(16)
  }
  const finish = async () => {
    agentStream.emit('data', { type: 'complete' })
    await expect(result.completion).resolves.toEqual({})
    await expect(result.historyPersisted).resolves.toEqual({})
    await expect(result.streamFinished).resolves.toBeUndefined()
    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined })
  }
  const hook = (invokeMock.mock.calls[invokeMock.mock.calls.length - 1]?.[8] as AgentPersistenceHooks).onQuestionReceived!
  return { agentStream, abortController, result, reader, send, finish, hook }
}

describe('SessionMessageService cancelled persistence', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    persistUserMessageMock.mockResolvedValue({})
    persistExchangeMock.mockResolvedValue({})
    upsertCanonicalMessagesMock.mockResolvedValue([])
    upsertCanonicalMessageMock.mockResolvedValue({})
    upsertCanonicalPartsMock.mockResolvedValue([])
    getTurnMock.mockResolvedValue(null)
    updateTurnMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not dispatch an already aborted attempt', async () => {
    const { SessionMessageService } = await import('../SessionMessageService')
    const service = new SessionMessageService()
    const controller = new AbortController()
    vi.spyOn(service as any, 'getLastAgentSessionId').mockResolvedValue('last-session-id')
    controller.abort()
    await expect(service.createSessionMessage(
      { id: 'session-a', agent_id: 'agent-a' } as any,
      { content: 'hello' } as any,
      controller,
      { persist: true }
    )).rejects.toMatchObject({ name: 'AbortError' })
    expect(invokeMock).not.toHaveBeenCalled()
    expect(persistUserMessageMock).not.toHaveBeenCalled()
  })

  it.each(['complete', 'error', 'cancelled', 'reader cancel'])('resolves completion on %s with permanently pending DB and releases workspace protection only after runtime finishes', async (terminal) => {
    await flushMicrotasks(16)
    const initialRuns = workspaceActivity.runs
    const runtime = deferred()
    const { agentStream, reader, result, abortController } = await startCanonicalStream(runtime.promise)
    const neverPersisted = new Promise<void>(() => {})
    upsertCanonicalPartsMock.mockReturnValueOnce(neverPersisted)
    const historyResolved = vi.fn()
    void result.historyPersisted!.then(historyResolved)
    const chunk = { type: 'text-delta' as const, id: 'text-1', text: 'partial reply' }
    agentStream.emit('data', { type: 'chunk', chunk })
    await expect(reader.read()).resolves.toEqual({ done: false, value: chunk })
    await flushMicrotasks(16)
    expect(upsertCanonicalPartsMock).not.toHaveBeenCalled()
    expect(result.runtimeFinished).toBe(runtime.promise)
    expect(workspaceActivity.runs).toBe(initialRuns + 1)
    expect(isWorkspaceRunning('/work/running')).toBe(true)
    expect(isWorkspaceRunning('/work/other')).toBe(false)
    try {
      if (terminal === 'reader cancel') {
        await expect(reader.cancel('reader disconnected')).resolves.toBeUndefined()
        expect(abortController.signal.reason).toBe('reader disconnected')
      } else if (terminal === 'error') {
        const providerError = new Error('provider failed')
        const readFailure = expect(reader.read()).rejects.toBe(providerError)
        agentStream.emit('data', { type: 'error', error: providerError })
        await readFailure
      } else {
        agentStream.emit('data', { type: terminal } as any)
        await expect(reader.read()).resolves.toEqual({ done: true, value: undefined })
      }
      await expect(result.streamFinished).resolves.toBeUndefined()
      await expect(result.completion).resolves.toEqual({})
      await flushMicrotasks(16)
      expect(historyResolved).not.toHaveBeenCalled()
      expect(upsertCanonicalMessageMock).not.toHaveBeenCalled()
      expect(agentStream.listenerCount('data')).toBe(0)
      expect(workspaceActivity.runs).toBe(initialRuns + 1)
      expect(isWorkspaceRunning('/work/running')).toBe(true)

      runtime.resolve()
      await result.runtimeFinished
      await flushMicrotasks(16)
      expect(workspaceActivity.runs).toBe(initialRuns)
      expect(isWorkspaceRunning('/work/running')).toBe(false)
      expect(historyResolved).not.toHaveBeenCalled()
      // Duplicate terminal events cannot reacquire or release the run guard again.
      agentStream.emit('data', { type: 'complete' })
      agentStream.emit('data', { type: 'cancelled' })
      await flushMicrotasks(16)
      expect(workspaceActivity.runs).toBe(initialRuns)
      expect(upsertCanonicalPartsMock).toHaveBeenCalledTimes(1)
      expect(upsertCanonicalPartsMock.mock.calls[0][0]).toEqual([
        expect.objectContaining({ data: expect.objectContaining({
          text: 'partial reply',
          status: terminal === 'complete' ? 'completed' : terminal === 'error' ? 'failed' : 'cancelled',
          transcriptBlockIndex: 0
        }) })
      ])
    } finally {
      runtime.resolve()
      if (terminal !== 'error') await reader.cancel()
      await result.completion
      await flushMicrotasks(16)
      // Do not await historyPersisted: this DB promise intentionally never settles.
    }
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
    await expect(result.historyPersisted).resolves.toEqual({})

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
    await expect(result.historyPersisted).resolves.toEqual({})

    expect(persistSpy).toHaveBeenCalledTimes(1)
    expect(persistSpy.mock.calls[0]?.[2]).toEqual([])
    expect(persistSpy.mock.calls[0]?.[8]).toMatchObject({
      prompt_tokens: 11,
      completion_tokens: 7,
      total_tokens: 18
    })
    expect(persistSpy.mock.calls[0]?.[11]).toBe(true)
  })

  it('persists the accepted user message in the background before any stream events', async () => {
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

    // No stream events emitted yet: wait for the background acceptance write.
    await vi.waitFor(() => expect(persistUserMessageMock).toHaveBeenCalledTimes(1))
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
    await expect(result.historyPersisted).resolves.toEqual({})
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

    const result = await service.createSessionMessage(
      { id: 'session-1', agent_id: 'agent-1', model: 'claude-3' } as any,
      { content: '继续', model: 'openai:qwen3.7-plus' } as any,
      new AbortController(),
      { persist: true }
    )

    agentStream.emit('data', { type: 'complete' })
    await result.historyPersisted

    const immediateUserMsgId = persistUserMessageMock.mock.calls[0]?.[0]?.payload?.message?.id
    expect(immediateUserMsgId).toBeTruthy()
    expect(persistSpy).toHaveBeenCalledTimes(1)
    expect(persistSpy.mock.calls[0]?.[12]).toBe(immediateUserMsgId)
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
    await expect(result.historyPersisted).resolves.toEqual({})

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
    await expect(result.historyPersisted).resolves.toEqual({})

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

    agentStream.emit('data', { type: 'chunk', chunk: { type: 'text-start', id: 'text-1' } })
    agentStream.emit('data', { type: 'chunk', chunk: { type: 'text-delta', id: 'text-1', text: '完成' } })
    agentStream.emit('data', { type: 'chunk', chunk: { type: 'text-end', id: 'text-1' } })
    agentStream.emit('data', { type: 'complete' })
    await flushMicrotasks(8)
    await expect(result.historyPersisted).resolves.toEqual({})

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
      await result.historyPersisted
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
    const providerError = new Error('provider failed')
    const readFailure = expect(result.stream.getReader().read()).rejects.toBe(providerError)
    agentStream.emit('data', { type: 'error', error: providerError })
    await readFailure
    await expect(result.streamFinished).resolves.toBeUndefined()
    await expect(result.historyPersisted).resolves.toEqual({})
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

    await vi.waitFor(() => expect(updateTurnMock).toHaveBeenCalledTimes(1))
    expect(updateTurnMock).toHaveBeenCalledWith(stableIds.turnId, {
      status: 'failed',
      completedAt: expect.any(String)
    })
  })

  it.each(['assistant write', 'turn read', 'turn update'])('preserves the original invoke error when initialization cleanup fails at %s', async (stage) => {
    const { SessionMessageService } = await import('../SessionMessageService')
    const service = new SessionMessageService()
    const invokeError = new Error('bootstrap failed')
    const databaseError = new Error('SQLITE_BUSY: database is locked')
    const stableIds = {
      turnId: 'turn-init-db-failure',
      traceId: 'trace-init-db-failure',
      userMessageId: 'user-init-db-failure',
      assistantMessageId: 'assistant-init-db-failure'
    }
    invokeMock.mockRejectedValueOnce(invokeError)
    getTurnMock.mockResolvedValue({ id: stableIds.turnId, status: 'running' })
    if (stage === 'assistant write') upsertCanonicalMessageMock.mockRejectedValueOnce(databaseError)
    if (stage === 'turn read') getTurnMock.mockRejectedValueOnce(databaseError)
    if (stage === 'turn update') updateTurnMock.mockRejectedValueOnce(databaseError)
    vi.spyOn(service as any, 'getLastAgentSessionId').mockResolvedValue('')
    await flushMicrotasks(8)
    const initialRuns = workspaceActivity.runs

    await expect(service.createSessionMessage(
      { id: 'session-1', agent_id: 'agent-1', model: 'claude-3' } as any,
      { content: 'hello', model: 'claude-3' } as any,
      new AbortController(),
      { invocationIds: stableIds }
    )).rejects.toBe(invokeError)

    await vi.waitFor(() => expect(getTurnMock).toHaveBeenCalledTimes(1))
    await flushMicrotasks(16)
    expect(upsertCanonicalMessageMock).toHaveBeenCalledWith(expect.objectContaining({
      id: stableIds.assistantMessageId,
      status: 'failed',
      error: expect.objectContaining({ message: invokeError.message })
    }))
    expect(getTurnMock).toHaveBeenCalledWith(stableIds.turnId)
    if (stage === 'turn read') {
      expect(updateTurnMock).not.toHaveBeenCalled()
    } else {
      expect(updateTurnMock).toHaveBeenCalledWith(stableIds.turnId, {
        status: 'failed', completedAt: expect.any(String)
      })
    }
    expect(workspaceActivity.runs).toBe(initialRuns)
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

  it.each(['complete', 'cancelled', 'reader cancel'])('does not block invoke, continuous chunks, or %s on startup DB writes', async (terminal) => {
    const { SessionMessageService } = await import('../SessionMessageService')
    const service = new SessionMessageService()
    const agentStream = createAgentStream()
    const abortController = new AbortController()
    const gate = deferred()
    upsertCanonicalMessagesMock.mockReturnValueOnce(gate.promise)
    invokeMock.mockResolvedValue(agentStream)
    vi.spyOn(service as any, 'getLastAgentSessionId').mockResolvedValue('')
    const result = await service.createSessionMessage(
      { id: 'session-1', agent_id: 'agent-1' } as any,
      { content: 'hello' } as any, abortController, { persist: true }
    )
    const reader = result.stream.getReader()
    const historyResolved = vi.fn()
    const persisted = result.historyPersisted!.then(historyResolved)
    try {
      expect(invokeMock).toHaveBeenCalledTimes(1)
      expect(upsertCanonicalMessagesMock).toHaveBeenCalledTimes(1)
      expect(persistUserMessageMock).not.toHaveBeenCalled()
      const chunks = [
        { type: 'text-delta' as const, id: 'text-1', text: 'A' },
        { type: 'text-delta' as const, id: 'text-1', text: 'B' }
      ]
      for (const chunk of chunks) agentStream.emit('data', { type: 'chunk', chunk })
      for (const chunk of chunks) await expect(reader.read()).resolves.toEqual({ done: false, value: chunk })
      expect(upsertCanonicalPartsMock).not.toHaveBeenCalled()
      if (terminal === 'reader cancel') {
        await expect(reader.cancel('disconnected')).resolves.toBeUndefined()
        expect(abortController.signal.reason).toBe('disconnected')
      } else {
        agentStream.emit('data', { type: terminal } as any)
        expect(abortController.signal.aborted).toBe(false)
      }
      await expect(result.streamFinished).resolves.toBeUndefined()
      await expect(reader.read()).resolves.toEqual({ done: true, value: undefined })
      expect(agentStream.listenerCount('data')).toBe(0)
      await flushMicrotasks(16)
      await expect(result.completion).resolves.toEqual({})
      expect(historyResolved).not.toHaveBeenCalled()
    } finally {
      gate.resolve()
      await reader.cancel()
      await persisted
    }
    expect(persistUserMessageMock).toHaveBeenCalledTimes(1)
    expect(upsertCanonicalMessageMock).toHaveBeenLastCalledWith(expect.objectContaining({
      status: terminal === 'complete' ? 'completed' : 'cancelled'
    }))
  })

  it('delivers consecutive deltas immediately and writes only the completed invocation snapshot without checkpoints', async () => {
    const { agentStream, reader, result } = await startCanonicalStream()
    const gate = deferred()
    upsertCanonicalPartsMock.mockReturnValueOnce(gate.promise)
    const first = { type: 'text-delta' as const, id: 'text-1', text: 'A' }
    const second = { ...first, text: 'B' }
    try {
      agentStream.emit('data', { type: 'chunk', chunk: first })
      agentStream.emit('data', { type: 'chunk', chunk: second })
      await expect(reader.read()).resolves.toEqual({ done: false, value: first })
      await expect(reader.read()).resolves.toEqual({ done: false, value: second })
      await flushMicrotasks(16)
      expect(upsertCanonicalPartsMock).not.toHaveBeenCalled()
      agentStream.emit('data', { type: 'complete' })
      await result.streamFinished
      await expect(reader.read()).resolves.toEqual({ done: true, value: undefined })
      gate.resolve()
      await result.historyPersisted
      const writes = upsertCanonicalPartsMock.mock.calls.map(([parts]) => parts[0])
      expect(writes.map((part) => part.data)).toEqual([
        expect.objectContaining({ text: 'AB', status: 'completed', transcriptBlockIndex: 0 })
      ])
      expect(new Set(writes.map((part) => part.id)).size).toBe(1)
    } finally {
      gate.resolve()
      await reader.cancel()
      await result.historyPersisted
    }
  })

  it('queues immutable PI turn snapshots while later turns and completion proceed with SQL pending', async () => {
    const { agentStream, send, finish, result } = await startCanonicalStream()
    const gate = deferred()
    const completed = vi.fn()
    void result.completion.then(completed)
    upsertCanonicalPartsMock.mockReturnValueOnce(gate.promise)
    try {
      await send({ type: 'reasoning-delta', id: 'reasoning-1', text: 'think' })
      await send({ type: 'text-delta', id: 'text-1', text: 'A' })
      await send({ type: 'tool-call', toolCallId: 'tool-1', toolName: 'Read', input: { path: 'a' } })
      await send({ type: 'tool-result', toolCallId: 'tool-1', toolName: 'Read', output: 'ok' })
      expect(upsertCanonicalPartsMock).not.toHaveBeenCalled()
      agentStream.emit('data', { type: 'turn-checkpoint' })
      await flushMicrotasks(16)
      expect(upsertCanonicalPartsMock).toHaveBeenCalledTimes(1)
      expect(upsertCanonicalPartsMock.mock.calls[0][0]).toEqual([
        expect.objectContaining({ type: 'reasoning', data: expect.objectContaining({ text: 'think', status: 'streaming', transcriptBlockIndex: 0 }) }),
        expect.objectContaining({ type: 'text', data: expect.objectContaining({ text: 'A', status: 'streaming', transcriptBlockIndex: 1 }) }),
        expect.objectContaining({ type: 'tool', data: expect.objectContaining({ toolId: 'tool-1', content: 'ok', transcriptBlockIndex: 2 }) })
      ])
      expect(completed).not.toHaveBeenCalled()
      // Neither another turn nor terminal delivery waits for the first write.
      await send({ type: 'text-delta', id: 'text-1', text: 'B' })
      agentStream.emit('data', { type: 'turn-checkpoint' })
      await send({ type: 'text-delta', id: 'text-1', text: 'C' })
      agentStream.emit('data', { type: 'complete' })
      await result.completion
      expect(upsertCanonicalPartsMock).toHaveBeenCalledTimes(1)
    } finally {
      gate.resolve()
      await finish()
    }
    const textWrites: UpsertAgentMessagePartInput[][] = upsertCanonicalPartsMock.mock.calls.map(([parts]) =>
      parts.filter((part: UpsertAgentMessagePartInput) => part.type === 'text'))
    expect(textWrites.map(parts => parts.map(part => part.data))).toEqual([
      [expect.objectContaining({ text: 'A', status: 'streaming', transcriptBlockIndex: 1 })],
      [
        expect.objectContaining({ text: 'A', status: 'streaming', transcriptBlockIndex: 1 }),
        expect.objectContaining({ text: 'B', status: 'streaming', transcriptBlockIndex: 3 })
      ],
      [
        expect.objectContaining({ text: 'A', status: 'completed', transcriptBlockIndex: 1 }),
        expect.objectContaining({ text: 'BC', status: 'completed', transcriptBlockIndex: 3 })
      ]
    ])
    expect(new Set(textWrites.map(parts => parts[0].id)).size).toBe(1)
    expect(textWrites[1][1].id).toBe(`${textWrites[0][0].id}_1`)
    expect(textWrites[2].map(part => part.id)).toEqual(textWrites[1].map(part => part.id))
    expect(upsertCanonicalMessageMock.mock.calls.map(([message]) => message.status)).toEqual([
      'streaming', 'streaming', 'completed'
    ])
    expect(upsertCanonicalMessageMock.mock.calls[0][0].completedAt).toBeUndefined()
  })

  it.each(['complete', 'error', 'cancelled', 'reader cancel'])('preserves interleaved segment order and stable part IDs across queued checkpoints and %s', async (terminal) => {
    const { agentStream, send, reader, result } = await startCanonicalStream()
    const gate = deferred()
    const historyResolved = vi.fn()
    void result.historyPersisted!.then(historyResolved)
    upsertCanonicalPartsMock.mockReturnValueOnce(gate.promise)
    const status = terminal === 'complete' ? 'completed' : terminal === 'error' ? 'failed' : 'cancelled'
    try {
      await send({ type: 'reasoning-delta', id: 'reasoning-1', text: 'think' })
      await send({ type: 'text-delta', id: 'text-1', text: 'A' })
      await send({ type: 'tool-call', toolCallId: 'tool-1', toolName: 'Read', input: { path: 'a' } })
      await send({ type: 'text-delta', id: 'text-2', text: 'B' })
      agentStream.emit('data', { type: 'turn-checkpoint' })
      await flushMicrotasks(16)
      expect(upsertCanonicalPartsMock).toHaveBeenCalledTimes(1)
      expect(upsertCanonicalMessageMock).not.toHaveBeenCalled()

      await send({ type: 'tool-result', toolCallId: 'tool-1', toolName: 'Read', output: 'first result' })
      await send({ type: 'tool-call', toolCallId: 'tool-2', toolName: 'Read', input: { path: 'b' } })
      await send({ type: 'text-delta', id: 'text-3', text: 'C' })
      agentStream.emit('data', { type: 'turn-checkpoint' })
      await send({ type: 'text-delta', id: 'text-3', text: 'D' })
      if (terminal === 'reader cancel') {
        await reader.cancel('disconnected')
      } else if (terminal === 'error') {
        const error = new Error('provider failed')
        const readFailure = expect(reader.read()).rejects.toBe(error)
        agentStream.emit('data', { type: 'error', error })
        await readFailure
      } else {
        agentStream.emit('data', { type: terminal } as any)
        await expect(reader.read()).resolves.toEqual({ done: true, value: undefined })
      }
      await expect(result.completion).resolves.toEqual({})
      await expect(result.streamFinished).resolves.toBeUndefined()
      expect(historyResolved).not.toHaveBeenCalled()
      expect(upsertCanonicalPartsMock).toHaveBeenCalledTimes(1)
      expect(upsertCanonicalMessageMock).not.toHaveBeenCalled()
      // Late events cannot append another snapshot or change the captured tail.
      agentStream.emit('data', { type: 'turn-checkpoint' })
      agentStream.emit('data', { type: 'chunk', chunk: { type: 'text-delta', id: 'text-3', text: 'late' } })
      agentStream.emit('data', { type: 'complete' })
    } finally {
      gate.resolve()
      if (terminal !== 'error') await reader.cancel()
      await result.historyPersisted
    }

    const snapshots: UpsertAgentMessagePartInput[][] = upsertCanonicalPartsMock.mock.calls.map(([parts]) => parts)
    const expectedSegments = [
      ['think', 'A', 'tool-1', 'B'],
      ['think', 'A', 'tool-1', 'B', 'tool-2', 'C'],
      ['think', 'A', 'tool-1', 'B', 'tool-2', 'CD']
    ]
    const assistantId = upsertCanonicalMessagesMock.mock.calls[0][0][1].id
    expect(snapshots).toHaveLength(3)
    for (const [index, parts] of snapshots.entries()) {
      expect(parts.map(part => part.data.toolId ?? part.data.text)).toEqual(expectedSegments[index])
      expect(parts.map(part => part.type)).toEqual(
        index === 0 ? ['reasoning', 'text', 'tool', 'text'] : ['reasoning', 'text', 'tool', 'text', 'tool', 'text']
      )
      expect(parts.map(part => part.data.transcriptBlockIndex)).toEqual(parts.map((_, blockIndex) => blockIndex))
      expect(parts.every(part => part.messageId === assistantId && part.sessionId === 'session-1')).toBe(true)
      expect(parts.map(part => part.data.status)).toEqual(parts.map(() => index === 2 ? status : 'streaming'))
      expect(new Set(parts.map(part => part.id)).size).toBe(parts.length)
      const partWriteOrder = upsertCanonicalPartsMock.mock.invocationCallOrder[index]
      const messageWriteOrder = upsertCanonicalMessageMock.mock.invocationCallOrder[index]
      expect(partWriteOrder).toBeLessThan(messageWriteOrder)
      if (index < 2) expect(messageWriteOrder).toBeLessThan(upsertCanonicalPartsMock.mock.invocationCallOrder[index + 1])
    }
    expect(snapshots[0][2].data.content).toBeUndefined()
    expect(snapshots[1][2].data.content).toBe('first result')
    expect(snapshots[2][2].data.content).toBe('first result')
    expect(snapshots[1].slice(0, 4).map(part => part.id)).toEqual(snapshots[0].map(part => part.id))
    expect(snapshots[2].map(part => part.id)).toEqual(snapshots[1].map(part => part.id))
    const textIds = snapshots[2].filter(part => part.type === 'text').map(part => part.id)
    expect(textIds).toEqual([textIds[0], `${textIds[0]}_1`, `${textIds[0]}_2`])
    expect(upsertCanonicalMessageMock.mock.calls.map(([message]) => message.status)).toEqual(['streaming', 'streaming', status])
    expect(upsertCanonicalMessageMock.mock.calls.map(([message]) => message.id)).toEqual([assistantId, assistantId, assistantId])
    expect(upsertCanonicalMessageMock.mock.calls[2][0].completedAt).toEqual(expect.any(String))
  })

  it('persists a PI checkpoint before invocation termination and ignores late checkpoints', async () => {
    const { agentStream, send, finish } = await startCanonicalStream()
    await send({ type: 'text-delta', id: 'text-1', text: 'saved before the next model round' })
    agentStream.emit('data', { type: 'turn-checkpoint' })
    await flushMicrotasks(32)
    expect(upsertCanonicalPartsMock).toHaveBeenCalledExactlyOnceWith([
      expect.objectContaining({ data: expect.objectContaining({ text: 'saved before the next model round', status: 'streaming', transcriptBlockIndex: 0 }) })
    ])
    expect(upsertCanonicalMessageMock).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 'streaming' }))
    await finish()
    agentStream.emit('data', { type: 'turn-checkpoint' })
    await flushMicrotasks(16)
    expect(upsertCanonicalPartsMock).toHaveBeenCalledTimes(2)
  })

  it('saves reasoning, text, tools, and final usage once after all chunks in the invocation', async () => {
    const { send, finish } = await startCanonicalStream()
    await send({ type: 'reasoning-delta', id: 'reasoning-1', text: 'think' })
    await send({ type: 'text-delta', id: 'text-1', text: 'A' })
    await send({ type: 'text-delta', id: 'text-1', text: 'B' })
    await send({ type: 'text-end', id: 'text-1' })
    await send({ type: 'tool-call', toolCallId: 'tool-1', toolName: 'Read', input: { path: 'a' } })
    await send({ type: 'tool-result', toolCallId: 'tool-1', toolName: 'Read', output: 'ok' })
    const usage = { inputTokens: 11, outputTokens: 7, totalTokens: 18,
      inputTokenDetails: { cacheReadTokens: 3, cacheWriteTokens: 2 } }
    await send({ type: 'usage', usage })
    await send({ type: 'usage', usage })
    await send({ type: 'usage', usage: { ...usage, outputTokens: 8, totalTokens: 19 } })
    expect(upsertCanonicalMessageMock).not.toHaveBeenCalled()
    expect(upsertCanonicalPartsMock).not.toHaveBeenCalled()
    await finish()
    expect(upsertCanonicalPartsMock).toHaveBeenCalledTimes(1)
    expect(upsertCanonicalPartsMock.mock.calls[0][0]).toEqual([
      expect.objectContaining({ type: 'reasoning', data: expect.objectContaining({ text: 'think', status: 'completed', transcriptBlockIndex: 0 }) }),
      expect.objectContaining({ type: 'text', data: expect.objectContaining({ text: 'AB', status: 'completed', transcriptBlockIndex: 1 }) }),
      expect.objectContaining({ type: 'tool', data: expect.objectContaining({ toolId: 'tool-1', content: 'ok', status: 'completed', transcriptBlockIndex: 2 }) })
    ])
    expect(upsertCanonicalMessageMock).toHaveBeenCalledTimes(1)
    expect(upsertCanonicalMessageMock).toHaveBeenLastCalledWith(expect.objectContaining({
      status: 'completed', usage: { inputTokens: 11, outputTokens: 8, totalTokens: 19, cacheReadTokens: 3, cacheWriteTokens: 2 }
    }))
  })

  it('does not grow persistence writes with thousands of streaming chunks', async () => {
    const { send, finish } = await startCanonicalStream()
    for (let index = 0; index < 2000; index++) {
      await send({ type: 'text-delta', id: 'text-1', text: 'x' })
    }
    expect(upsertCanonicalPartsMock).not.toHaveBeenCalled()
    expect(upsertCanonicalMessageMock).not.toHaveBeenCalled()
    await finish()
    expect(upsertCanonicalPartsMock).toHaveBeenCalledExactlyOnceWith([
      expect.objectContaining({ data: expect.objectContaining({ text: 'x'.repeat(2000), status: 'completed', transcriptBlockIndex: 0 }) })
    ])
    expect(upsertCanonicalMessageMock).toHaveBeenCalledTimes(1)
  })

  it('does not block usage delivery or cancellation on a pending usage write', async () => {
    const { agentStream, reader, result, abortController } = await startCanonicalStream()
    const gate = deferred()
    upsertCanonicalMessageMock.mockReturnValueOnce(gate.promise)
    const chunk = { type: 'usage', usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } } as any
    try {
      agentStream.emit('data', { type: 'chunk', chunk })
      await expect(reader.read()).resolves.toEqual({ done: false, value: chunk })
      await flushMicrotasks(16)
      expect(upsertCanonicalMessageMock).not.toHaveBeenCalled()
      await reader.cancel('disconnected')
      await result.streamFinished
      expect(abortController.signal.reason).toBe('disconnected')
      agentStream.emit('data', { type: 'chunk', chunk: { type: 'text-delta', id: 'text-1', text: 'late' } })
      agentStream.emit('data', { type: 'complete' })
      expect(agentStream.listenerCount('data')).toBe(0)
    } finally {
      gate.resolve()
      await reader.cancel()
      await result.historyPersisted
    }
    expect(upsertCanonicalMessageMock).toHaveBeenCalledTimes(1)
    expect(upsertCanonicalMessageMock).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'cancelled' }))
    expect(upsertCanonicalPartsMock).not.toHaveBeenCalled()
  })

  it.each(['startup', 'part', 'usage', 'finalize', 'exchange'])('continues the reply and completes when %s DB persistence fails', async (stage) => {
    const failure = new Error(`${stage} DB failed`)
    if (stage === 'startup') upsertCanonicalMessagesMock.mockRejectedValueOnce(failure)
    const { SessionMessageService } = await import('../SessionMessageService')
    const service = new SessionMessageService()
    const agentStream = createAgentStream()
    const controller = new AbortController()
    invokeMock.mockResolvedValue(agentStream)
    vi.spyOn(service as any, 'getLastAgentSessionId').mockResolvedValue('')
    const result = await service.createSessionMessage(
      { id: 'session-1', agent_id: 'agent-1' } as any,
      { content: 'hello' } as any, controller, { persist: true }
    )
    await flushMicrotasks(24)
    if (stage === 'part') upsertCanonicalPartsMock.mockRejectedValueOnce(failure)
    if (stage === 'usage') upsertCanonicalMessageMock.mockRejectedValueOnce(failure)
    if (stage === 'finalize') upsertCanonicalMessageMock.mockImplementation(async (message) => {
      if (message.status === 'completed') throw failure
      return {}
    })
    if (stage === 'exchange') persistExchangeMock.mockRejectedValueOnce(failure)
    const reader = result.stream.getReader()
    const chunks = [
      { type: 'text-delta', id: 'text-1', text: 'A' },
      { type: 'usage', usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } },
      { type: 'text-delta', id: 'text-1', text: 'B' }
    ]
    for (const chunk of chunks) {
      agentStream.emit('data', { type: 'chunk', chunk } as any)
      await expect(reader.read()).resolves.toEqual({ done: false, value: chunk })
      await flushMicrotasks(16)
    }
    agentStream.emit('data', { type: 'complete' })
    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined })
    await expect(result.streamFinished).resolves.toBeUndefined()
    await expect(result.completion).resolves.toEqual({})
    await expect(result.historyPersisted).resolves.toEqual({})
    expect(controller.signal.aborted).toBe(false)
    expect(persistExchangeMock).toHaveBeenCalledTimes(1)
    if (stage === 'part') {
      // A failed content write must not publish a completed envelope.
      expect(upsertCanonicalMessageMock).not.toHaveBeenCalled()
    } else {
      expect(upsertCanonicalMessageMock).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'completed' }))
    }
  })

  it('resolves reader cancellation and completion even when cancellation finalization fails', async () => {
    const { reader, result, agentStream } = await startCanonicalStream()
    upsertCanonicalMessageMock.mockRejectedValueOnce(new Error('cancel finalize failed'))
    await expect(reader.cancel()).resolves.toBeUndefined()
    await expect(result.streamFinished).resolves.toBeUndefined()
    await expect(result.completion).resolves.toEqual({})
    await expect(result.historyPersisted).resolves.toEqual({})
    expect(agentStream.listenerCount('data')).toBe(0)
  })

  it('onQuestionReceived returns without waiting for DB and captures independent question and answer payloads', async () => {
    const { agentStream, reader, hook, result } = await startCanonicalStream()
    const gate = deferred()
    upsertCanonicalPartsMock.mockReturnValueOnce(gate.promise)
    const input = { questions: [{ question: 'Original?' }] }
    const output = { answer: { value: 'A' } }
    try {
      agentStream.emit('data', { type: 'chunk', chunk: { type: 'tool-input-start', id: 'alias-1', toolName: 'AskUserQuestion' } })
      await reader.read()
      const question = { toolName: 'AskUserQuestion', toolCallId: 'canonical-1', rawToolCallId: 'raw-1', aliases: ['alias-1'], input }
      expect(hook(question, new AbortController().signal)).toBeUndefined()
      input.questions[0].question = 'Updated?'
      expect(hook(question, new AbortController().signal)).toBeUndefined()
      agentStream.emit('data', { type: 'chunk', chunk: { type: 'tool-result', toolCallId: 'alias-1', toolName: 'AskUserQuestion', input, output } })
      await reader.read()
      output.answer.value = 'mutated after event'
      agentStream.emit('data', { type: 'complete' })
      await result.streamFinished
      await expect(reader.read()).resolves.toEqual({ done: true, value: undefined })
      // The terminal capture also owns a snapshot, independent of later input changes.
      input.questions[0].question = 'mutated after complete'
      output.answer.value = 'mutated after complete'
      await flushMicrotasks(16)
      expect(upsertCanonicalPartsMock).toHaveBeenCalledTimes(1)
      gate.resolve()
      await result.historyPersisted
      const writes = upsertCanonicalPartsMock.mock.calls.map(([parts]) => parts[0])
      expect(new Set(writes.map((part) => part.id)).size).toBe(1)
      expect(writes).toHaveLength(1)
      expect(writes[0].data).toMatchObject({ toolId: 'alias-1', status: 'completed',
        arguments: { questions: [{ question: 'Updated?' }] }, content: { answer: { value: 'mutated after event' } } })
      expect(writes[0].data.arguments).not.toBe(input)
      expect(writes[0].data.content).not.toBe(output)
    } finally {
      gate.resolve()
      await reader.cancel()
      await result.historyPersisted
    }
  })

  it('uses the last question alias for a new tool while background DB is blocked', async () => {
    const { hook, reader, result } = await startCanonicalStream()
    const gate = deferred()
    upsertCanonicalPartsMock.mockReturnValueOnce(gate.promise)
    try {
      expect(hook({ toolName: 'AskUserQuestion', toolCallId: 'canonical-1', rawToolCallId: 'raw-1',
        aliases: ['old-alias', 'new-alias'], input: { questions: [] } }, new AbortController().signal)).toBeUndefined()
      await flushMicrotasks(16)
      expect(upsertCanonicalPartsMock).not.toHaveBeenCalled()
      await reader.cancel()
      await result.streamFinished
      await flushMicrotasks(16)
      expect(upsertCanonicalPartsMock).toHaveBeenLastCalledWith([
        expect.objectContaining({ type: 'tool', data: expect.objectContaining({ toolId: 'new-alias' }) })
      ])
    } finally {
      gate.resolve()
      await reader.cancel()
      await result.historyPersisted
    }
  })

  it.each(['signal', 'reader', 'finished'])('rejects onQuestionReceived synchronously after %s without writing', async (state) => {
    const { reader, result, hook, finish } = await startCanonicalStream()
    const signal = new AbortController()
    if (state === 'signal') signal.abort()
    if (state === 'reader') { await reader.cancel(); await result.historyPersisted }
    if (state === 'finished') await finish()
    upsertCanonicalPartsMock.mockClear()
    expect(() => hook({ toolName: 'AskUserQuestion', toolCallId: 'question-1', aliases: [], input: {} }, signal.signal))
      .toThrow(expect.objectContaining({ name: 'AbortError' }))
    await flushMicrotasks(16)
    expect(upsertCanonicalPartsMock).not.toHaveBeenCalled()
    if (state === 'signal') await reader.cancel()
    await result.historyPersisted
  })

  it('question DB failure does not interrupt subsequent question updates or answers', async () => {
    const { hook, send, finish, abortController } = await startCanonicalStream()
    upsertCanonicalPartsMock.mockRejectedValueOnce(new Error('question write failed'))
    const question = { toolName: 'AskUserQuestion', toolCallId: 'question-1', aliases: [], input: { questions: [] } }
    expect(hook(question, new AbortController().signal)).toBeUndefined()
    await flushMicrotasks(16)
    expect(hook(question, new AbortController().signal)).toBeUndefined()
    await send({ type: 'tool-result', toolCallId: 'question-1', toolName: 'AskUserQuestion', output: { answer: 'A' } })
    await send({ type: 'text-delta', id: 'text-1', text: 'reply continues' })
    await finish()
    expect(abortController.signal.aborted).toBe(false)
    expect(upsertCanonicalPartsMock.mock.calls.some(([parts]) => parts.some((part: any) => part.data.content?.answer === 'A'))).toBe(true)
  })
})
