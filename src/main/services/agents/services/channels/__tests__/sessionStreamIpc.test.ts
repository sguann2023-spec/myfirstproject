import { normalizeChatError } from '../../../../../../shared/chatError'
import { readFileSync } from 'node:fs'
import { getEventListeners } from 'node:events'
import { runInNewContext } from 'node:vm'
import { transpileModule } from 'typescript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { handleMock, publishMock, getSessionMock, listSessionsMock, createSessionMessageMock, sessionChangedMock, loggerError, loggerInfo } = vi.hoisted(() => ({
  handleMock: vi.fn(),
  publishMock: vi.fn(),
  getSessionMock: vi.fn(),
  listSessionsMock: vi.fn(),
  createSessionMessageMock: vi.fn(),
  sessionChangedMock: vi.fn(),
  loggerError: vi.fn(),
  loggerInfo: vi.fn()
}))
const { updateContextMock, tokenStatsMock, contextGenerationMock, mainWebContents } = vi.hoisted(() => ({
  updateContextMock: vi.fn(), tokenStatsMock: vi.fn(), contextGenerationMock: vi.fn(async () => 0), mainWebContents: { send: vi.fn() }
}))
const { digitalHumanCall, packagingCall, exportCall, persistDirect, saveTurn } = vi.hoisted(() => ({
  digitalHumanCall: vi.fn(), packagingCall: vi.fn(), exportCall: vi.fn(), persistDirect: vi.fn(), saveTurn: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: loggerInfo, error: loggerError, warn: vi.fn(), debug: vi.fn(), silly: vi.fn() })
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
    CherryChatStream_TokenStats: 'CherryChatStream_TokenStats',
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
    getMainWindow: vi.fn(() => ({ isDestroyed: () => false, webContents: Object.assign(mainWebContents, { send: sessionChangedMock }) }))
  }
}))

vi.mock('../../SessionService', () => ({
  sessionService: {
    getSession: getSessionMock,
    getTokenStats: tokenStatsMock,
    ingestTokenTelemetry: updateContextMock,
    onTokenStatsChanged: vi.fn(),
    getTokenContextGeneration: contextGenerationMock,
    invalidateTokenContext: vi.fn(),
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

  it('exposes matching token statistics methods in both preloads', async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true })
    const typescript = readFileSync(new URL('../../../../../../preload/index.ts', import.meta.url), 'utf8')
    const start = typescript.indexOf('    getTokenStats: (sessionId: string)')
    const end = typescript.indexOf('\n    updateSession:', start)
    expect(start).toBeGreaterThan(-1)
    const source = `const bridge = { ${typescript.slice(start, end)} }; bridge.getTokenStats('session')`
    runInNewContext(transpileModule(source, { compilerOptions: { target: 99 } }).outputText,
      { ipcRenderer: { invoke }, IpcChannel: { CherryChatStream_TokenStats: 'cherry-chat-stream:token-stats' } })
    expect(invoke).toHaveBeenLastCalledWith('cherry-chat-stream:token-stats', { sessionId: 'session' })
    const legacy = readFileSync(new URL('../../../../../../preload.js', import.meta.url), 'utf8')
    const line = legacy.split('\n').find(line => line.includes('getTokenStats:'))!
    expect(line).toBeTruthy()
    runInNewContext(`const bridge = { ${line} }; bridge.getTokenStats('legacy')`, { ipcRenderer: { invoke } })
    expect(invoke).toHaveBeenLastCalledWith('cherry-chat-stream:token-stats', { sessionId: 'legacy' })
  })

  it('authorizes token statistics before reading session history', async () => {
    const handlers = new Map<string, any>()
    handleMock.mockImplementation((channel, handler) => handlers.set(channel, handler))
    const { registerSessionStreamIpc } = await import('../sessionStreamIpc')
    registerSessionStreamIpc()
    const getStats = handlers.get('CherryChatStream_TokenStats')
    expect(await getStats({ sender: {} }, { sessionId: 'session-1' })).toMatchObject({ ok: false, error: 'Untrusted sender' })
    expect(tokenStatsMock).not.toHaveBeenCalled()
    expect(await getStats({ sender: mainWebContents }, {})).toMatchObject({ ok: false })
    expect(await getStats({ sender: mainWebContents }, { sessionId: 'session-1', agent_id: 'other-agent' })).toMatchObject({ ok: false })
    tokenStatsMock.mockResolvedValue({ ok: true, historyComplete: true })
    expect(await getStats({ sender: mainWebContents }, { sessionId: 'session-1' })).toMatchObject({ ok: true })
    expect(tokenStatsMock).toHaveBeenCalledWith('agent-1', 'session-1')
  })

  it('captures generation once, ingests full telemetry and broadcasts the service accepted snapshot', async () => {
    const handlers = new Map<string, any>()
    handleMock.mockImplementation((channel, handler) => handlers.set(channel, handler))
    contextGenerationMock.mockResolvedValueOnce(4)
    const cacheWrite = deferred<boolean>()
    updateContextMock.mockReturnValueOnce(cacheWrite.promise)
    let controller!: ReadableStreamDefaultController<any>
    createSessionMessageMock.mockImplementationOnce(async () => {
      expect(contextGenerationMock).toHaveBeenCalledWith('agent-1', 'session-1')
      return createMockStream(new ReadableStream({ start(value) { controller = value } }))
    })
    const { registerSessionStreamIpc } = await import('../sessionStreamIpc')
    registerSessionStreamIpc()
    await handlers.get('CherryChatStream_MessageCreate')(null, { sessionId: 'session-1', content: 'hello', requestId: 'epoch-test' })
    contextGenerationMock.mockResolvedValueOnce(5)
    const context = { id: 'c', revision: 999, runtimeSessionId: 'session-1', modelId: 'claude-3', providerId: 'p',
      observedAt: Date.now() + 100_000, basis: 'request', validity: 'valid', input: { categories: {}, total: 0, status: 'unknown', method: 'test' }, contextWindowTokens: null }
    controller.enqueue({ type: 'raw', rawValue: { type: 'token-telemetry', data: { version: 1, requests: [], context } } })
    controller.close()
    await flushMicrotasks(30)
    expect(updateContextMock).toHaveBeenCalledWith('agent-1', 'session-1', { version: 1, requests: [], context }, 4)
    expect(contextGenerationMock).toHaveBeenCalledTimes(1)
    expect(publishMock).toHaveBeenCalledWith('session-1', expect.objectContaining({ type: 'complete' }))
    expect(sessionChangedMock).not.toHaveBeenCalled()
    cacheWrite.resolve(true)
    await flushMicrotasks(10)
    const { sessionService } = await import('../../SessionService')
    const listener = vi.mocked(sessionService.onTokenStatsChanged).mock.calls[0][0]
    const snapshot = { sessionId: 'session-1', revision: 42, contextGeneration: 4, tokenTelemetry: { version: 1 as const, requests: [], context }, context } as any
    listener('agent-1', snapshot)
    expect(sessionChangedMock).toHaveBeenCalledWith('AgentSession_Changed', expect.objectContaining({ reason: 'token-stats', tokenStats: snapshot }))
    contextGenerationMock.mockReset().mockResolvedValue(0)
  })

  it('ingests ledger-only chunks without waiting for history persistence', async () => {
    const handlers = new Map<string, any>()
    handleMock.mockImplementation((channel, handler) => handlers.set(channel, handler))
    updateContextMock.mockReset().mockResolvedValue(null)
    const telemetry = { version: 1, requests: [{ id: 'r', revision: 1, runtimeSessionId: 'runtime', invocationId: 'i', sequence: 1,
      modelId: 'm', providerId: 'p', operation: 'chat', status: 'prepared', startedAt: 1, attempts: 1,
      input: { categories: {}, total: 0, status: 'unknown', method: 'test' } }] }
    const persisted = deferred<unknown>()
    createSessionMessageMock.mockResolvedValue(createMockStream(new ReadableStream({ start(controller) {
      controller.enqueue({ type: 'raw', rawValue: { type: 'token-telemetry', data: telemetry } })
      controller.close()
    } }), Promise.resolve(), persisted.promise))
    const { registerSessionStreamIpc } = await import('../sessionStreamIpc')
    registerSessionStreamIpc()
    await handlers.get('CherryChatStream_MessageCreate')(null, { sessionId: 'session-1', content: 'hello', requestId: 'ledger-only' })
    await flushMicrotasks(30)
    expect(updateContextMock).toHaveBeenCalledWith('agent-1', 'session-1', telemetry, 0)
    expect(publishMock).toHaveBeenCalledWith('session-1', expect.objectContaining({ type: 'complete' }))
    persisted.resolve({})
  })

  it.each(['reject', 'throw'])('continues forwarding telemetry if the context observer fails (%s)', async failure => {
    const handlers = new Map<string, any>()
    handleMock.mockImplementation((channel, handler) => handlers.set(channel, handler))
    const context = { id: 'c', revision: 1, runtimeSessionId: 'r', modelId: 'm', providerId: 'p',
      observedAt: 1, basis: 'request', validity: 'valid', input: { categories: {}, total: 0, status: 'unknown', method: 'test' }, contextWindowTokens: null }
    const chunk = { type: 'raw', rawValue: { type: 'token-telemetry', data: { version: 1, requests: [], context } } }
    if (failure === 'throw') updateContextMock.mockImplementation(() => { throw new Error('observer failed') })
    else updateContextMock.mockRejectedValue(new Error('observer failed'))
    createSessionMessageMock.mockResolvedValue(createMockStream(new ReadableStream({ start(controller) {
      controller.enqueue(chunk)
      controller.enqueue({ type: 'text-delta', textDelta: 'hello' })
      controller.close()
    } })))
    const { registerSessionStreamIpc } = await import('../sessionStreamIpc')
    registerSessionStreamIpc()
    const result = await handlers.get('CherryChatStream_MessageCreate')(null, { sessionId: 'session-1', content: 'hello', requestId: 'telemetry-test' })
    await flushMicrotasks(30)
    expect(result.ok).toBe(true)
    expect(updateContextMock).toHaveBeenCalledWith('agent-1', 'session-1', { version: 1, requests: [], context }, 0)
    expect(publishMock).toHaveBeenCalledWith('session-1', expect.objectContaining({ chunk }))
    expect(publishMock).toHaveBeenCalledWith('session-1', expect.objectContaining({ type: 'complete' }))
    expect(publishMock.mock.calls.some(([, event]) => event.type === 'error')).toBe(false)
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

  it('correlates submit timing before startup without logging message content', async () => {
    const handlers = new Map<string, any>()
    handleMock.mockImplementation((channel, handler) => handlers.set(channel, handler))
    const sessionLookup = deferred<any>()
    getSessionMock.mockReturnValueOnce(sessionLookup.promise)
    createSessionMessageMock.mockResolvedValue(createMockStream(new ReadableStream({ start(c) { c.close() } })))
    const { registerSessionStreamIpc } = await import('../sessionStreamIpc')
    registerSessionStreamIpc()
    const pending = handlers.get('CherryChatStream_MessageCreate')(null, {
      sessionId: 'session-1', content: 'private-message-not-in-timing', requestId: 'timing-request'
    })
    await flushMicrotasks()
    expect(loggerInfo).toHaveBeenCalledWith('[FirstTextTiming]', expect.objectContaining({
      stage: 'main-workspace-guard-start', requestId: 'timing-request', traceId: 'timing-request', sessionId: 'session-1'
    }))
    expect(createSessionMessageMock).not.toHaveBeenCalled()
    sessionLookup.resolve({ id: 'session-1', agent_id: 'agent-1', model: 'claude-3', configuration: {} })
    expect((await pending).ok).toBe(true)
    const entries = loggerInfo.mock.calls.filter(([label]) => label === '[FirstTextTiming]').map(([, entry]) => entry)
    expect(entries.map(entry => entry.stage)).toEqual([
      'main-workspace-guard-start', 'main-workspace-guard-ready', 'main-submit', 'main-submit-prepared', 'main-stream-created'
    ])
    expect(entries.every(entry => entry.traceId === 'timing-request' && typeof entry.atEpochMs === 'number')).toBe(true)
    expect(entries[1].elapsedMs).toBeGreaterThanOrEqual(0)
    expect(createSessionMessageMock.mock.calls[0][3].invocationIds.traceId).toBe('timing-request')
    expect(JSON.stringify(entries)).not.toContain('private-message-not-in-timing')
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
    expect(createSessionMessageMock).toHaveBeenCalledTimes(11)
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

describe('frontend first-text timing', () => {
  it('logs only the first nonempty text receipt without changing chunks or exposing content', () => {
    const home = readFileSync(new URL('../../../../../../page/HomePage/HomePage.jsx', import.meta.url), 'utf8')
    const start = home.indexOf('        if (perfEntry && !perfEntry.firstNonemptyTextAt')
    const end = home.indexOf('        const chunkStart = getPerfTimestamp();', start)
    expect(start).toBeGreaterThan(0)
    const log = vi.fn()
    const context = {
      perfEntry: { firstNonemptyTextAt: null, createdPerfAt: 10 },
      payload: { sessionId: 'session-1', chunk: { text: '' } },
      chunkType: 'text-start', requestId: 'request-1', logger: { info: log }, getPerfTimestamp: () => 25
    }
    const run = () => runInNewContext(home.slice(start, end), context)
    run()
    context.chunkType = 'text-delta'
    run()
    expect(log).not.toHaveBeenCalled()
    context.payload.chunk.text = 'private-first-text'
    run()
    run()
    expect(log).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith('[FirstTextTiming]', expect.objectContaining({
      stage: 'renderer-first-text-received', traceId: 'request-1', sinceSubmitMs: 15, textLength: 18
    }))
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-first-text')
    expect(context.payload.chunk.text).toBe('private-first-text')
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
