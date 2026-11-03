import { beforeEach, describe, expect, it, vi } from 'vitest'

const { persistExchange, appendCanonicalExchange } = vi.hoisted(() => ({
  persistExchange: vi.fn(), appendCanonicalExchange: vi.fn()
}))
vi.mock('../../../database/sessionMessageRepository', () => ({ agentMessageRepository: { persistExchange } }))
vi.mock('../../../database/repositories/piSessionStorage', () => ({ SqlitePiSessionStorage: { appendCanonicalExchange } }))

import { persistDirectRequestExchange } from '../directRequestPersistence'

function exchange(): any {
  return { sessionId: 'session', agentSessionId: 'session', turnId: 'turn',
    user: { metadata: { requestId: 'request', semantics: { source: 'composer' } },
      payload: { message: { id: 'user', role: 'user', aiVideoRequest: { model: 'seedance' } }, blocks: [] } },
    assistant: { payload: { message: { id: 'assistant', role: 'assistant', status: 'error' },
      blocks: [{ type: 'tool', status: 'error', content: 'failure with billing' }] } } }
}

describe('persistDirectRequestExchange', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    persistExchange.mockResolvedValue({ userMessage: {}, assistantMessage: {} })
    appendCanonicalExchange.mockResolvedValue(undefined)
  })

  it('adds direct semantics and turn links without mutating input, then appends the persisted exchange', async () => {
    const input = exchange()
    const original = structuredClone(input)
    const result = await persistDirectRequestExchange(input)
    expect(input).toEqual(original)
    expect(persistExchange).toHaveBeenCalledWith(expect.objectContaining({
      user: expect.objectContaining({ metadata: { requestId: 'request', semantics: { source: 'composer', origin: 'direct_request' } },
        payload: expect.objectContaining({ message: expect.objectContaining({ turnId: 'turn' }) }) }),
      assistant: expect.objectContaining({ metadata: { semantics: { origin: 'direct_request' } },
        payload: expect.objectContaining({ message: expect.objectContaining({ turnId: 'turn', askId: 'user' }) }) })
    }))
    expect(appendCanonicalExchange).toHaveBeenCalledWith({ topicId: 'session', userMessageId: 'user', assistantMessageId: 'assistant' })
    expect(persistExchange.mock.invocationCallOrder[0]).toBeLessThan(appendCanonicalExchange.mock.invocationCallOrder[0])
    expect(result).toEqual({ userMessage: {}, assistantMessage: {} })
  })

  it('does not append an exchange when history persistence fails', async () => {
    persistExchange.mockRejectedValue(new Error('history failure'))
    await expect(persistDirectRequestExchange(exchange())).rejects.toThrow('history failure')
    expect(appendCanonicalExchange).not.toHaveBeenCalled()
  })

  it('reports context append failure instead of claiming a complete commit', async () => {
    appendCanonicalExchange.mockRejectedValue(new Error('context failure'))
    await expect(persistDirectRequestExchange(exchange())).rejects.toThrow('context failure')
  })

  it.each(['user', 'assistant'])('rejects an incomplete exchange missing %s before writing history', async role => {
    const input = exchange()
    delete input[role]
    await expect(persistDirectRequestExchange(input)).rejects.toThrow('complete user/assistant exchange')
    expect(persistExchange).not.toHaveBeenCalled()
    expect(appendCanonicalExchange).not.toHaveBeenCalled()
  })
})
