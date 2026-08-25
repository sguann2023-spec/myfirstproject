import { EventEmitter } from 'node:events'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentStream } from '../../interfaces/AgentStreamInterface'

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn()
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
    expect(persistSpy.mock.calls[0]?.[7]).toMatchObject({
      prompt_tokens: 11,
      completion_tokens: 7,
      total_tokens: 18
    })
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
    expect(persistSpy.mock.calls[0]?.[9]).toBe(originalCreatedAt)
  })
})
