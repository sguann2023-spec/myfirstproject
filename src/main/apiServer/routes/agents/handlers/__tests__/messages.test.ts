import { beforeEach, describe, expect, it, vi } from 'vitest'

const { agentExists, getSession, createSessionMessage, getHistory } = vi.hoisted(() => ({
  agentExists: vi.fn(),
  getSession: vi.fn(),
  createSessionMessage: vi.fn(),
  getHistory: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) }
}))
vi.mock('@main/apiServer/config/timeouts', () => ({ MESSAGE_STREAM_TIMEOUT_MS: 60_000 }))
vi.mock('@main/apiServer/utils/createStreamAbortController', () => ({
  STREAM_TIMEOUT_REASON: 'timeout',
  createStreamAbortController: () => ({
    abortController: new AbortController(),
    registerAbortHandler: vi.fn(),
    dispose: vi.fn()
  })
}))
vi.mock('@main/services/agents', () => ({
  agentService: { agentExists },
  sessionService: { getSession },
  sessionMessageService: { createSessionMessage, deleteSessionMessage: vi.fn() }
}))
vi.mock('@main/services/agents/database/agentHistoryService', () => ({
  agentHistoryService: { getHistory }
}))

import { createMessage, getMessages } from '../messages'

function response() {
  const listeners = new Map<string, Array<() => void>>()
  const res: any = {
    headersSent: false,
    writableEnded: false,
    setHeader: vi.fn(),
    status: vi.fn(function (this: any) { return this }),
    json: vi.fn(function (this: any) { return this }),
    send: vi.fn(function (this: any) { return this }),
    write: vi.fn(),
    end: vi.fn(function (this: any) {
      this.writableEnded = true
      for (const listener of listeners.get('finish') ?? []) listener()
    }),
    on: vi.fn((event: string, listener: () => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
      return res
    })
  }
  return res
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    params: { agentId: 'agent-1', sessionId: 'session-1' },
    query: {},
    body: { content: 'hello' },
    get: vi.fn(() => undefined),
    on: vi.fn(),
    ...overrides
  } as any
}

describe('agent message REST handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    agentExists.mockResolvedValue(true)
    getSession.mockResolvedValue({ id: 'session-1', agent_id: 'agent-1' })
  })

  it('returns canonical-first history pagination fields', async () => {
    getHistory.mockResolvedValue({
      messages: [{ message: { id: 'm1' }, blocks: [] }],
      hasMore: true,
      nextAfterSequence: 7
    })
    const req = request({ query: { after_sequence: '3', limit: '4' } })
    const res = response()

    await getMessages(req, res)

    expect(getHistory).toHaveBeenCalledWith('session-1', { afterSequence: 3, limit: 4 })
    expect(res.json).toHaveBeenCalledWith({
      messages: [{ message: { id: 'm1' }, blocks: [] }],
      has_more: true,
      next_after_sequence: 7
    })
  })

  it('rejects invalid history pagination', async () => {
    const res = response()
    await getMessages(request({ query: { limit: '501' } }), res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(getHistory).not.toHaveBeenCalled()
  })

  it('enables persistence for headless REST POST streams', async () => {
    const stream = new ReadableStream({ start(controller) { controller.close() } })
    createSessionMessage.mockResolvedValue({ stream, completion: Promise.resolve({}) })
    const res = response()

    await createMessage(request(), res)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(createSessionMessage).toHaveBeenCalledWith(
      { id: 'session-1', agent_id: 'agent-1' },
      { content: 'hello' },
      expect.any(AbortController),
      {
        persist: true,
        invocationIds: expect.objectContaining({
          turnId: expect.any(String),
          traceId: expect.any(String),
          userMessageId: expect.any(String),
          assistantMessageId: expect.any(String)
        })
      }
    )
  })

  it('derives stable invocation IDs from the optional REST idempotency key', async () => {
    const stream = new ReadableStream({ start(controller) { controller.close() } })
    createSessionMessage.mockResolvedValue({ stream, completion: Promise.resolve({}) })
    const keyedRequest = request({ get: vi.fn(() => 'retry-key') })

    await createMessage(keyedRequest, response())
    await createMessage(keyedRequest, response())
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(createSessionMessage.mock.calls[1]?.[3]?.invocationIds).toEqual(
      createSessionMessage.mock.calls[0]?.[3]?.invocationIds
    )
  })
})
