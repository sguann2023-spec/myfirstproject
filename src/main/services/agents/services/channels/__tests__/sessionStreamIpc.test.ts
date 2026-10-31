import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { handleMock, publishMock, getSessionMock, listSessionsMock, createSessionMessageMock, sessionChangedMock, loggerError } = vi.hoisted(() => ({
  handleMock: vi.fn(),
  publishMock: vi.fn(),
  getSessionMock: vi.fn(),
  listSessionsMock: vi.fn(),
  createSessionMessageMock: vi.fn(),
  sessionChangedMock: vi.fn(),
  loggerError: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: loggerError, warn: vi.fn(), debug: vi.fn(), silly: vi.fn() })
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
    handle: handleMock,
    on: vi.fn()
  },
  app: { getPath: vi.fn(() => '/tmp') }
}))

vi.mock('@mcp-trace/trace-core', () => ({ TraceMethod: () => () => undefined }))

vi.mock('@main/apiServer/services/models', () => ({
  modelsService: {
    getModels: vi.fn()
  }
}))

vi.mock('@main/mcpServers/draft-download', () => ({ default: class MockMcpServer {} }))
vi.mock('@main/mcpServers/draft-elements', () => ({ default: class MockMcpServer {} }))
vi.mock('@main/mcpServers/draft-management', () => ({ default: class MockMcpServer {} }))
vi.mock('@main/mcpServers/digital-human', () => ({ default: class MockMcpServer {} }))
vi.mock('@main/mcpServers/koubo-template', () => ({ default: class MockMcpServer {} }))
vi.mock('@main/mcpServers/seed-audio', () => ({ default: class MockMcpServer {} }))
vi.mock('@main/mcpServers/speech-generate', () => ({ default: class MockMcpServer {} }))
vi.mock('@main/mcpServers/image-generate', () => ({ default: class MockMcpServer {} }))
vi.mock('@main/mcpServers/video-generate', () => ({ default: class MockMcpServer {} }))
vi.mock('@main/mcpServers/voice-conversion', () => ({ default: class MockMcpServer {} }))
vi.mock('@main/mcpServers/social-copywriting', () => ({ default: class MockMcpServer {} }))
vi.mock('@main/mcpServers/subtitle-recognition', () => ({ default: class MockMcpServer {} }))
vi.mock('@main/mcpServers/video-understand', () => ({ default: class MockMcpServer {} }))

vi.mock('@main/utils', () => ({
  getDataPath: vi.fn(() => '/tmp/data')
}))
vi.mock('@main/utils/locales', () => ({ t: vi.fn((key: string) => key) }))

vi.mock('../../database/schema', () => ({ agentsTable: {} }))
vi.mock('../../database/sessionMessageRepository', () => ({ agentMessageRepository: {} }))
vi.mock('../../database/repositories/agentTurnRepository', () => ({ agentTurnRepository: {} }))
vi.mock('../builtin/BuiltinAgentIds', () => ({ CHERRY_CLAW_AGENT_ID: 'builtin-agent' }))
vi.mock('../claudecode/session-architecture/ConversationSegmentService', () => ({ conversationSegmentService: {} }))

vi.mock('../../../../WindowService', () => ({
  windowService: {
    getMainWindow: vi.fn(() => ({ isDestroyed: () => false, webContents: { send: sessionChangedMock } }))
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

function createMockStream(
  stream: ReadableStream<any>,
  streamFinished: Promise<void> = Promise.resolve(),
  historyPersisted?: Promise<unknown>
) {
  return { stream, streamFinished, completion: Promise.resolve({}), ...(historyPersisted ? { historyPersisted } : {}) }
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

  it('gets a session by ID without listing or enriching unrelated sessions', async () => {
    const handlers = new Map<string, (event: unknown, payload?: any) => Promise<any> | any>()
    handleMock.mockImplementation((channel: string, handler: (event: unknown, payload?: any) => Promise<any> | any) => handlers.set(channel, handler))
    const { registerSessionStreamIpc } = await import('../sessionStreamIpc')
    registerSessionStreamIpc()
    const result = await handlers.get('CherryChatStream_SessionGet')?.(null, { sessionId: 'session-1' })
    expect(result).toMatchObject({ ok: true, session: { id: 'session-1', agent_id: 'agent-1' } })
    expect(getSessionMock).toHaveBeenCalledWith(undefined, 'session-1')
    expect(getSessionMock).toHaveBeenCalledTimes(1)
    expect(listSessionsMock).not.toHaveBeenCalled()
  })

  it('falls back to an ID lookup for a mismatched agent without a 2000-session limit', async () => {
    getSessionMock.mockResolvedValueOnce(null)
    const handlers = new Map<string, (event: unknown, payload?: any) => Promise<any> | any>()
    handleMock.mockImplementation((channel: string, handler: (event: unknown, payload?: any) => Promise<any> | any) => handlers.set(channel, handler))
    const { registerSessionStreamIpc } = await import('../sessionStreamIpc')
    registerSessionStreamIpc()
    const result = await handlers.get('CherryChatStream_SessionGet')?.(null, { sessionId: 'session-1', agent_id: 'wrong-agent' })
    expect(result).toMatchObject({ ok: true, session: { id: 'session-1' } })
    expect(getSessionMock.mock.calls).toEqual([['wrong-agent', 'session-1'], [undefined, 'session-1']])
    expect(listSessionsMock).not.toHaveBeenCalled()
  })

  it('reuses stable invocation IDs across startup retries', async () => {
    const handlers = new Map<string, (event: unknown, payload?: any) => Promise<any> | any>()
    handleMock.mockImplementation((channel: string, handler: (event: unknown, payload?: any) => Promise<any> | any) => {
      handlers.set(channel, handler)
    })
    const stream = new ReadableStream({ start(controller) { controller.close() } })
    createSessionMessageMock
      .mockRejectedValueOnce(new Error('database is locked'))
      .mockResolvedValue(createMockStream(stream))

    const { registerSessionStreamIpc } = await import('../sessionStreamIpc')
    registerSessionStreamIpc()
    const createHandler = handlers.get('CherryChatStream_MessageCreate')
    const pending = createHandler?.(null, {
      sessionId: 'session-1',
      agent_id: 'agent-1',
      content: 'hello',
      requestId: 'request-stable'
    })
    await vi.runAllTimersAsync()
    expect(await pending).toEqual({ ok: true, requestId: 'request-stable' })
    expect(createSessionMessageMock).toHaveBeenCalledTimes(2)
    const firstIds = createSessionMessageMock.mock.calls[0]?.[3]?.invocationIds
    const secondIds = createSessionMessageMock.mock.calls[1]?.[3]?.invocationIds
    expect(secondIds).toEqual(firstIds)
    expect(firstIds).toMatchObject({ traceId: 'request-stable' })
  })

  it.each(['success', 'failure', 'best-effort-loss', 'absent'])('completes the UI before optional historyPersisted settles with %s', async (outcome) => {
    const handlers = new Map<string, (event: unknown, payload?: any) => Promise<any> | any>()
    handleMock.mockImplementation((channel: string, handler: (event: unknown, payload?: any) => Promise<any> | any) => {
      handlers.set(channel, handler)
    })
    const streamFinished = deferred<void>()
    const historyPersisted = deferred<{}>()
    const historySettled = vi.fn()
    void historyPersisted.promise.then(historySettled, historySettled)
    let controller!: ReadableStreamDefaultController<any>
    const stream = new ReadableStream({ start(value) { controller = value } })
    const result = createMockStream(stream, streamFinished.promise, outcome === 'absent' ? undefined : historyPersisted.promise)
    expect('historyPersisted' in result).toBe(outcome !== 'absent')
    const completionSettled = vi.fn()
    void result.completion.then(completionSettled)
    createSessionMessageMock.mockResolvedValue(result)
    const { registerSessionStreamIpc } = await import('../sessionStreamIpc')
    registerSessionStreamIpc()
    const createResult = await handlers.get('CherryChatStream_MessageCreate')?.(null, {
      sessionId: 'session-1', agent_id: 'agent-1', content: 'hello', requestId: 'request-delayed'
    })
    expect(createResult).toEqual({ ok: true, requestId: 'request-delayed' })

    streamFinished.resolve()
    await flushMicrotasks(6)
    expect(publishMock.mock.calls.some(([, event]) => event.type === 'complete')).toBe(false)
    controller.enqueue({ type: 'text-delta', text: 'last' })
    controller.close()
    await flushMicrotasks(10)

    const events = () => publishMock.mock.calls.map(([, event]) => event)
    expect(events().map((event) => event.type)).toEqual(['started', 'stream-finished', 'chunk', 'complete'])
    expect(events().find((event) => event.type === 'chunk')?.chunk.text).toBe('last')
    expect(completionSettled).toHaveBeenCalledExactlyOnceWith({})
    expect(historySettled).not.toHaveBeenCalled()
    expect(sessionChangedMock).not.toHaveBeenCalled()

    if (outcome === 'success') historyPersisted.resolve({ assistantMessage: { id: 'saved-assistant', content: { blocks: [] } } })
    else if (outcome === 'best-effort-loss') historyPersisted.resolve({})
    else if (outcome === 'failure') historyPersisted.reject(new Error('database is locked'))
    await flushMicrotasks(10)
    expect(events().filter((event) => event.type === 'complete')).toHaveLength(1)
    expect(events().some((event) => event.type === 'error')).toBe(false)
    expect(sessionChangedMock).toHaveBeenCalledTimes(outcome === 'success' ? 1 : 0)
    if (outcome === 'success') {
      expect(sessionChangedMock).toHaveBeenCalledWith('AgentSession_Changed', {
        agentId: 'agent-1', sessionId: 'session-1', headless: true
      })
    }
    if (outcome === 'failure') {
      expect(loggerError).toHaveBeenCalledExactlyOnceWith('[SessionStreamIpc] Background history persistence failed', {
        sessionId: 'session-1', requestId: 'request-delayed', error: 'database is locked'
      })
    } else {
      expect(loggerError).not.toHaveBeenCalled()
    }
  })

  it('suppresses late chunk, stream-finished, and complete after abort', async () => {
    const handlers = new Map<string, (event: unknown, payload?: any) => Promise<any> | any>()
    handleMock.mockImplementation((channel: string, handler: (event: unknown, payload?: any) => Promise<any> | any) => {
      handlers.set(channel, handler)
    })

    const streamFinished = deferred<void>()
    const historyPersisted = deferred<{ assistantMessage?: unknown; userMessage?: unknown }>()
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

    createSessionMessageMock.mockResolvedValue(createMockStream(stream, streamFinished.promise, historyPersisted.promise))

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
    historyPersisted.resolve({ assistantMessage: { id: 'saved-after-abort' } })

    await flushMicrotasks(6)

    const publishedForRequest = publishMock.mock.calls
      .map(([, event]) => event)
      .filter((event) => event?.requestId === requestId)

    expect(publishedForRequest.map((event) => event.type)).toEqual(['started', 'chunk', 'cancelled'])
    expect(
      publishedForRequest.filter((event) => event.type === 'chunk').map((event) => event.chunk?.text)
    ).toEqual(['first'])
    expect(streamCancelMock).not.toHaveBeenCalled()
    expect(sessionChangedMock).not.toHaveBeenCalled()
  })
})
