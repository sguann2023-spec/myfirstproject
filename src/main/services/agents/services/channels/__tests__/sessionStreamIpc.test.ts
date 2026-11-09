import { normalizeChatError } from '../../../../../../shared/chatError'
import { readFileSync } from 'node:fs'
import { getEventListeners } from 'node:events'
import { runInNewContext } from 'node:vm'
import { transpileModule } from 'typescript'
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
const { digitalHumanCall, packagingCall, exportCall, persistDirect, saveTurn } = vi.hoisted(() => ({
  digitalHumanCall: vi.fn(), packagingCall: vi.fn(), exportCall: vi.fn(), persistDirect: vi.fn(), saveTurn: vi.fn()
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
    CherryChatStream_DigitalHumanRequest: 'CherryChatStream_DigitalHumanRequest',
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

vi.mock('@main/mcpServers/draft-download', () => ({ default: class {
  mcpServer = { server: { _requestHandlers: new Map([['tools/call', exportCall]]) } }
} }))
vi.mock('@main/mcpServers/draft-elements', () => ({ default: class MockMcpServer {} }))
vi.mock('@main/mcpServers/draft-management', () => ({ default: class MockMcpServer {} }))
vi.mock('@main/mcpServers/digital-human', () => ({ default: class {
  mcpServer = { server: { _requestHandlers: new Map([['tools/call', digitalHumanCall]]) } }
} }))
vi.mock('@main/mcpServers/koubo-template', () => ({ default: class {
  mcpServer = { server: { _requestHandlers: new Map([['tools/call', packagingCall]]) } }
} }))
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

vi.mock('../../../database/schema', () => ({ agentsTable: {} }))
vi.mock('../directRequestPersistence', () => ({ persistDirectRequestExchange: persistDirect }))
vi.mock('../../../database/repositories/agentTurnRepository', () => ({ agentTurnRepository: { save: saveTurn } }))
vi.mock('../../builtin/BuiltinAgentIds', () => ({ CHERRY_CLAW_AGENT_ID: 'builtin-agent' }))
vi.mock('../../claudecode/session-architecture/ConversationSegmentService', () => ({
  conversationSegmentService: { getActiveSegment: vi.fn(async () => ({ id: 'segment' })) }
}))

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

  it.each(['packaging', 'export'])('commits completed digital-human stages when %s throws', async failedStage => {
    const handlers = new Map<string, (event: unknown, payload?: any) => Promise<any>>()
    handleMock.mockImplementation((channel, handler) => handlers.set(channel, handler))
    const generated = { task_status: 1, digital_human_url: 'https://example.com/generated.mp4' }
    const packaged = { success: true, output: { draft_id: 'packaged-draft' } }
    digitalHumanCall.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify(generated) }] })
    packagingCall.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify(packaged) }] })
    exportCall.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify({ accepted: 1 }) }] })
    const failure = new Error(`${failedStage} unavailable`)
    if (failedStage === 'packaging') packagingCall.mockRejectedValueOnce(failure)
    else exportCall.mockRejectedValueOnce(failure)
    const { registerSessionStreamIpc } = await import('../sessionStreamIpc')
    registerSessionStreamIpc()
    const result = await handlers.get('CherryChatStream_DigitalHumanRequest')!(null, {
      sessionId: 'session-1', userMessageId: 'direct-user', assistantMessageId: 'direct-assistant',
      digitalHumanRequest: { mode: 'lip_sync', copywriting: 'copy', voice_id: 'voice',
        video_url: 'https://example.com/presenter.mp4', packaging_template: 'fisheye_ins' }
    })
    expect(result.ok).toBe(true)
    expect(persistDirect).toHaveBeenCalledOnce()
    const exchange = persistDirect.mock.calls[0][0]
    expect(exchange.turnId).toBe(saveTurn.mock.calls[0][0].id)
    expect(saveTurn.mock.calls[0][0].status).toBe('failed')
    const tools = exchange.assistant.payload.blocks.filter((block: any) => block.type === 'tool')
    expect(tools).toHaveLength(failedStage === 'packaging' ? 2 : 3)
    expect(tools[0]).toMatchObject({ status: 'success', metadata: { rawMcpToolResponse: { responseRaw: generated } } })
    expect(tools[tools.length - 1]).toMatchObject({ status: 'error',
      metadata: { rawMcpToolResponse: { responseRaw: { error: failure.message } } } })
    if (failedStage === 'packaging') expect(exportCall).not.toHaveBeenCalled()
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

  it.each(['stuck', 'settles'])('aborts timed-out startup and only retries after it exits: %s', async outcome => {
    const handlers = new Map<string, any>()
    handleMock.mockImplementation((channel, handler) => handlers.set(channel, handler))
    const startup = deferred<any>()
    createSessionMessageMock.mockImplementationOnce((_session, _message, controller) => {
      if (outcome === 'settles') controller.signal.addEventListener('abort', () => startup.reject(new Error('aborted')))
      return startup.promise
    }).mockResolvedValue(createMockStream(new ReadableStream({ start(c) { c.close() } })))
    const { registerSessionStreamIpc } = await import('../sessionStreamIpc')
    registerSessionStreamIpc()
    const pending = handlers.get('CherryChatStream_MessageCreate')(null, {
      sessionId: 'session-1', content: 'hello', requestId: 'startup-timeout'
    })
    await vi.runAllTimersAsync()
    const result = await pending
    expect(createSessionMessageMock.mock.calls[0][2].signal.aborted).toBe(true)
    expect(createSessionMessageMock).toHaveBeenCalledTimes(outcome === 'stuck' ? 1 : 2)
    if (outcome === 'stuck') {
      expect(result).toMatchObject({ ok: false, code: 'SESSION_MESSAGE_START_TIMEOUT', error: expect.any(String) })
      expect(normalizeChatError(result).category).toBe('startup_timeout')
    } else expect(result.ok).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('aborts non-retriable startup failures', async () => {
    const handlers = new Map<string, any>()
    handleMock.mockImplementation((channel, handler) => handlers.set(channel, handler))
    createSessionMessageMock.mockRejectedValue(new Error('invalid API key'))
    const { registerSessionStreamIpc } = await import('../sessionStreamIpc')
    registerSessionStreamIpc()
    const result = await handlers.get('CherryChatStream_MessageCreate')(null, {
      sessionId: 'session-1', content: 'hello', requestId: 'bad-key'
    })
    expect(result.ok).toBe(false)
    expect(createSessionMessageMock.mock.calls[0][2].signal.aborted).toBe(true)
    expect(createSessionMessageMock).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['startup', 'cleanup', 'backoff'])('cancels promptly during %s without retrying', async phase => {
    const handlers = new Map<string, any>()
    handleMock.mockImplementation((channel, handler) => handlers.set(channel, handler))
    createSessionMessageMock.mockImplementation(() => phase === 'backoff'
      ? Promise.reject(new Error('fetch failed')) : new Promise(() => {}))
    const { registerSessionStreamIpc } = await import('../sessionStreamIpc')
    registerSessionStreamIpc()
    const pending = handlers.get('CherryChatStream_MessageCreate')(null, {
      sessionId: 'session-1', content: 'hello', requestId: `cancel-${phase}`
    })
    await vi.advanceTimersByTimeAsync(phase === 'cleanup' ? 15_000 : 0)
    await handlers.get('AgentSessionStream_Abort')(null, { sessionId: 'session-1' })
    expect(await pending).toEqual({ ok: true, requestId: `cancel-${phase}` })
    expect(createSessionMessageMock).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    expect(publishMock.mock.calls.filter(([, event]) => event.type === 'error')).toHaveLength(0)
  })

  it('aborts the final failed attempt after exhausting retries', async () => {
    const handlers = new Map<string, any>()
    handleMock.mockImplementation((channel, handler) => handlers.set(channel, handler))
    createSessionMessageMock.mockRejectedValue(new Error('fetch failed'))
    const { registerSessionStreamIpc } = await import('../sessionStreamIpc')
    registerSessionStreamIpc()
    const pending = handlers.get('CherryChatStream_MessageCreate')(null, {
      sessionId: 'session-1', content: 'hello', requestId: 'exhausted'
    })
    await vi.runAllTimersAsync()
    expect((await pending).ok).toBe(false)
    expect(createSessionMessageMock).toHaveBeenCalledTimes(6)
    expect(createSessionMessageMock.mock.calls.every(call => call[2].signal.aborted)).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
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
    expect(getEventListeners(createSessionMessageMock.mock.calls[1][2].signal, 'abort')).toHaveLength(0)
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
      expect(sessionChangedMock).toHaveBeenCalledWith('AgentSession_Changed', expect.objectContaining({
        agentId: 'agent-1', sessionId: 'session-1', headless: true
      }))
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

describe('startup error frontend mapping', () => {
  it.each([
    { code: 'SESSION_MESSAGE_START_TIMEOUT', message: 'startup failed' },
    { error: 'Session message stream did not start within 15000ms' },
    'Session message stream did not start within 15000ms',
    new Error('SESSION_MESSAGE_START_TIMEOUT')
  ])('maps structured and legacy startup errors accurately: %j', error => {
    expect(normalizeChatError(error)).toMatchObject({
      category: 'startup_timeout', code: 'SESSION_MESSAGE_START_TIMEOUT',
      title: expect.stringContaining('会话启动超时')
    })
  })

  it('retains ordinary network and user cancellation classifications', () => {
    expect(normalizeChatError(new Error('network timeout')).category).toBe('network')
    expect(normalizeChatError({ code: 'ABORTED' }).category).toBe('aborted')
    const home = readFileSync(new URL('../../../../../../page/HomePage/HomePage.jsx', import.meta.url), 'utf8')
    expect(home).toContain("throw Object.assign(new Error(result?.error || 'agent createMessage failed'), { code: result?.code })")
  })
})

// Exercise the actual fixed-reply generators without starting Electron or an Agent.
describe('direct generated media workspace links', () => {
  const source = readFileSync(new URL('../sessionStreamIpc.ts', import.meta.url), 'utf8')
  const names = ['Speech', 'SeedAudio', 'VoiceConversion', 'AiVideo', 'ImageGenerate', 'DigitalHuman']
  const declarations = ['buildDirectWorkspaceFileText', 'getDirectDigitalHumanVideoUrl', ...names.map(name => `buildDirect${name}AssistantText`)]
    .map(name => {
      const start = source.indexOf(`function ${name}(`)
      const end = source.indexOf('\nfunction ', start + 1)
      return source.slice(start, end)
    }).join('\n')
  const context: Record<string, any> = { EOL: '\n' }
  runInNewContext(transpileModule(declarations, { compilerOptions: { target: 99 } }).outputText, context)
  const filePath = '/workspace/中文 [一] (二)#?.mp3'
  it.each(names)('%s prefers a clickable workspace path and preserves remote output', name => {
    for (const shape of [{ filePath }, { file_path: filePath }, { artifact: { file_path: filePath } }, { result: { file_path: filePath } }, { output: { file_path: filePath } }]) {
      const response = { ...shape, url: 'https://example.com/media', output: { audio_url: 'https://example.com/media', video_url: 'https://example.com/media', image_url: 'https://example.com/media', ...shape.output } }
      const text = context[`buildDirect${name}AssistantText`]({ toolArgs: {}, toolResponse: response })
      expect(text).toContain('工作区文件：[')
      expect(text).toContain('file:///workspace/%E4%B8%AD%E6%96%87%20%5B%E4%B8%80%5D%20%28%E4%BA%8C%29%23%3F.mp3')
      expect(text).toContain('https://example.com/media')
      expect(text.indexOf('工作区文件')).toBeLessThan(text.indexOf('https://example.com/media'))
    }
  })
  it.each(names)('%s does not claim saving succeeded on failure or missing paths', name => {
    for (const failure of [{ saveError: 'disk full' }, { save_failed: true, save_error: 'disk full' }]) {
      const text = context[`buildDirect${name}AssistantText`]({ toolArgs: {}, toolResponse: { filePath, ...failure } })
      expect(text).not.toContain('工作区文件：')
      expect(text).toContain('工作区保存失败：disk full')
    }
    for (const response of [{}, { filePath: 'https://example.com/media' }, { filePath, success: false }]) {
      expect(context[`buildDirect${name}AssistantText`]({ toolArgs: {}, toolResponse: response })).not.toContain('工作区文件：')
    }
  })
})
