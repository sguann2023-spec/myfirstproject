import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { handleMock, publishMock, getSessionMock, listSessionsMock, createSessionMessageMock } = vi.hoisted(() => ({
  handleMock: vi.fn(),
  publishMock: vi.fn(),
  getSessionMock: vi.fn(),
  listSessionsMock: vi.fn(),
  createSessionMessageMock: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), silly: vi.fn() })
  }
}))

vi.mock('@shared/IpcChannel', () => ({
  IpcChannel: {
    AgentSessionStream_Subscribe: 'AgentSessionStream_Subscribe',
    AgentSessionStream_Unsubscribe: 'AgentSessionStream_Unsubscribe',
    AgentSessionStream_Abort: 'AgentSessionStream_Abort',
    AgentSessionStream_Chunk: 'AgentSessionStream_Chunk',
    CherryChatStream_SessionCreate: 'CherryChatStream_SessionCreate',
    CherryChatStream_SessionGet: 'CherryChatStream_SessionGet',
    CherryChatStream_SessionUpdate: 'CherryChatStream_SessionUpdate',
    CherryChatStream_SessionList: 'CherryChatStream_SessionList',
    CherryChatStream_MessageCreate: 'CherryChatStream_MessageCreate',
    CherryChatStream_MessageList: 'CherryChatStream_MessageList',
    CherryChatStream_Abort: 'CherryChatStream_Abort',
    CherryChatStream_Subscribe: 'CherryChatStream_Subscribe',
    CherryChatStream_Unsubscribe: 'CherryChatStream_Unsubscribe',
    CherryChatStream_Chunk: 'CherryChatStream_Chunk',
    AgentSession_Changed: 'AgentSession_Changed'
  }
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: handleMock
  }
}))

vi.mock('@main/apiServer/services/models', () => ({
  modelsService: {
    getModels: vi.fn()
  }
}))

vi.mock('@main/utils', () => ({
  getDataPath: vi.fn(() => '/tmp/data')
}))

vi.mock('../../../../WindowService', () => ({
  windowService: {
    getMainWindow: vi.fn(() => null)
  }
}))

vi.mock('../../SessionService', () => ({
  sessionService: {
    getSession: getSessionMock,
    listSessions: listSessionsMock,
    updateSession: vi.fn(),
    createSession: vi.fn()
  }
}))

vi.mock('../../SessionMessageService', () => ({
  sessionMessageService: {
    createSessionMessage: createSessionMessageMock,
    listSessionMessages: vi.fn()
  }
}))

vi.mock('../ChannelMessageHandler', () => ({
  channelMessageHandler: {
    abortSession: vi.fn(() => false)
  }
}))

vi.mock('../SessionStreamBus', () => ({
  sessionStreamBus: {
    publish: publishMock,
    subscribe: vi.fn(() => () => undefined),
    hasSubscribers: vi.fn(() => false),
    subscriberCount: vi.fn(() => 0)
  }
}))

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function flushMicrotasks(times = 3) {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve()
  }
}

describe('sessionStreamIpc abort handling', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.useFakeTimers()
    getSessionMock.mockResolvedValue({
      id: 'session-1',
      agent_id: 'agent-1',
      model: 'claude-3',
      configuration: {}
    })
    listSessionsMock.mockResolvedValue({ sessions: [], total: 0 })
  })

  afterEach(async () => {
    await vi.runOnlyPendingTimersAsync()
    vi.useRealTimers()
  })

  it('suppresses late chunk, stream-finished, and complete after abort', async () => {
    const handlers = new Map<string, (event: unknown, payload?: any) => Promise<any> | any>()
    handleMock.mockImplementation((channel: string, handler: (event: unknown, payload?: any) => Promise<any> | any) => {
      handlers.set(channel, handler)
    })

    const streamFinished = deferred<void>()
    const completion = deferred<{ assistantMessage?: unknown; userMessage?: unknown }>()
    let streamController: ReadableStreamDefaultController<any> | null = null
    const streamCancelMock = vi.fn()
    const stream = new ReadableStream({
      start(controller) {
        streamController = controller
      },
      cancel(reason: unknown) {
        streamCancelMock(reason)
      }
    })

    createSessionMessageMock.mockResolvedValue({
      stream,
      streamFinished: streamFinished.promise,
      completion: completion.promise
    })

    const { registerSessionStreamIpc } = await import('../sessionStreamIpc')
    registerSessionStreamIpc()

    const createHandler = handlers.get('CherryChatStream_MessageCreate')
    const abortHandler = handlers.get('CherryChatStream_Abort')

    expect(createHandler).toBeTypeOf('function')
    expect(abortHandler).toBeTypeOf('function')

    const createResult = await createHandler?.(null, {
      sessionId: 'session-1',
      agent_id: 'agent-1',
      content: 'hello'
    })

    expect(createResult).toEqual({ ok: true, requestId: expect.any(String) })
    const requestId = createResult.requestId

    streamController?.enqueue({ type: 'text-delta', text: 'first' })
    await flushMicrotasks()

    await abortHandler?.(null, { sessionId: 'session-1' })
    await flushMicrotasks()

    streamFinished.resolve()
    streamController?.enqueue({ type: 'text-delta', text: 'late' })
    streamController?.close()
    completion.resolve({})

    await flushMicrotasks(6)

    const publishedForRequest = publishMock.mock.calls
      .map(([, event]) => event)
      .filter((event) => event?.requestId === requestId)

    expect(publishedForRequest.map((event) => event.type)).toEqual(['started', 'chunk', 'cancelled'])
    expect(
      publishedForRequest.filter((event) => event.type === 'chunk').map((event) => event.chunk?.text)
    ).toEqual(['first'])
    expect(streamCancelMock).not.toHaveBeenCalled()
  })
})
