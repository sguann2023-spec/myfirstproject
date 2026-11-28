import { readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

import { createHistoryOpenHandler } from '../historyOpenHandler'

type Dependencies = Parameters<typeof createHistoryOpenHandler>[0]
type HistoryOpenEvent = Parameters<ReturnType<typeof createHistoryOpenHandler>>[0]
type HistoryEvent = { -readonly [Key in keyof HistoryOpenEvent]: HistoryOpenEvent[Key] }
type Session = NonNullable<Awaited<ReturnType<Dependencies['getSession']>>>
type HistoryPage = Awaited<ReturnType<Dependencies['getHistory']>>

const messagesFor = (id: string): HistoryPage['messages'] => [{ message: { id } }] as HistoryPage['messages']

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function flushBackground() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

function setup() {
  const mainFrame = { detached: false }
  const sender = { mainFrame, isDestroyed: vi.fn(() => false) }
  const mainWindow = { webContents: sender, isDestroyed: vi.fn(() => false) }
  const event = { sender, senderFrame: mainFrame } as unknown as HistoryEvent
  const messages = messagesFor('message-1')
  const session = { id: 'session-1', agent_id: 'actual-agent', agent_type: 'claude-code' } as Session
  const getHistory = vi.fn(async (_sessionId: string): Promise<HistoryPage> => ({ messages, historyComplete: true }))
  const getSession = vi.fn(async (_agentId: undefined, _sessionId: string): Promise<Session | null> => session)
  const prewarmSessionContext = vi.fn(async (_session: Session, _isCurrentOpen: () => boolean) => {})
  const warn = vi.fn()
  const handler = createHistoryOpenHandler({
    mainWindow: mainWindow as unknown as Dependencies['mainWindow'],
    getHistory,
    getSession,
    prewarmSessionContext,
    warn
  })
  return { handler, event, mainWindow, sender, mainFrame, messages, session, getHistory, getSession, prewarmSessionContext, warn }
}

const invalidSenders: Array<[string, (context: ReturnType<typeof setup>) => void]> = [
  ['another window', (context) => { context.event.sender = {} as HistoryEvent['sender'] }],
  ['a subframe', (context) => { context.event.senderFrame = { detached: false } as HistoryEvent['senderFrame'] }],
  ['a missing frame', (context) => { context.event.senderFrame = null }],
  ['a detached frame', (context) => { context.mainFrame.detached = true }],
  ['a destroyed window', (context) => { context.mainWindow.isDestroyed.mockReturnValue(true) }],
  ['destroyed web contents', (context) => { context.sender.isDestroyed.mockReturnValue(true) }],
  ['a replaced main frame', (context) => { context.sender.mainFrame = { detached: false } }],
  ['a disappearing frame', (context) => {
    Object.defineProperty(context.event, 'senderFrame', { get() { throw new Error('Frame was disposed') } })
  }]
]

describe('selected history open handler', () => {
  it.each([undefined, false, 'true', 1])('returns normal history without warming for warmContext=%s', async (warmContext) => {
    const context = setup()
    const result = await context.handler(context.event, { sessionId: 'session-1', warmContext: warmContext as boolean })
    expect(result).toBe(context.messages)
    expect(context.getHistory).toHaveBeenCalledExactlyOnceWith('session-1')
    expect(context.getSession).not.toHaveBeenCalled()
    expect(context.prewarmSessionContext).not.toHaveBeenCalled()
    expect(context.mainWindow.isDestroyed).not.toHaveBeenCalled()
    expect(context.sender.isDestroyed).not.toHaveBeenCalled()
    expect(context.warn).not.toHaveBeenCalled()
  })

  it('does not access sender authorization for unflagged reads', async () => {
    const context = setup()
    const event = {} as HistoryEvent
    Object.defineProperty(event, 'sender', { get() { throw new Error('Not needed for background reads') } })
    await expect(context.handler(event, { sessionId: 'session-1' })).resolves.toBe(context.messages)
    expect(context.getSession).not.toHaveBeenCalled()
  })

  it('warms the actual resolved session only after complete, nonempty history resolves', async () => {
    const context = setup()
    const history = deferred<HistoryPage>()
    context.getHistory.mockReturnValue(history.promise)
    const response = context.handler(context.event, { sessionId: 'session-1', warmContext: true })
    expect(context.getSession).not.toHaveBeenCalled()
    expect(context.prewarmSessionContext).not.toHaveBeenCalled()

    history.resolve({ messages: context.messages, historyComplete: true })
    await expect(response).resolves.toBe(context.messages)
    await flushBackground()
    expect(context.getSession).toHaveBeenCalledExactlyOnceWith(undefined, 'session-1')
    expect(context.prewarmSessionContext).toHaveBeenCalledExactlyOnceWith(context.session, expect.any(Function))
    expect(context.prewarmSessionContext.mock.calls[0][1]()).toBe(true)
  })

  it('treats an omitted historyComplete marker as complete', async () => {
    const context = setup()
    context.getHistory.mockResolvedValue({ messages: context.messages })
    await expect(context.handler(context.event, { sessionId: 'session-1', warmContext: true })).resolves.toBe(context.messages)
    await flushBackground()
    expect(context.prewarmSessionContext).toHaveBeenCalledOnce()
  })

  it.each(invalidSenders)('does not look up sessions for a flagged request from %s', async (_name, invalidate) => {
    const context = setup()
    invalidate(context)
    await expect(context.handler(context.event, { sessionId: 'session-1', warmContext: true })).resolves.toBe(context.messages)
    expect(context.getSession).not.toHaveBeenCalled()
    expect(context.prewarmSessionContext).not.toHaveBeenCalled()
  })

  it('does not become eligible if the request was unauthorized before history loaded', async () => {
    const context = setup()
    const history = deferred<HistoryPage>()
    context.getHistory.mockReturnValue(history.promise)
    context.event.senderFrame = { detached: false } as HistoryEvent['senderFrame']
    const response = context.handler(context.event, { sessionId: 'session-1', warmContext: true })
    context.event.senderFrame = context.mainFrame as HistoryEvent['senderFrame']
    history.resolve({ messages: context.messages })
    await expect(response).resolves.toBe(context.messages)
    expect(context.getSession).not.toHaveBeenCalled()
  })

  it.each(invalidSenders)('rechecks authorization after history resolves for %s', async (_name, invalidate) => {
    const context = setup()
    const history = deferred<HistoryPage>()
    context.getHistory.mockReturnValue(history.promise)
    const response = context.handler(context.event, { sessionId: 'session-1', warmContext: true })
    invalidate(context)
    history.resolve({ messages: context.messages })
    await expect(response).resolves.toBe(context.messages)
    expect(context.getSession).not.toHaveBeenCalled()
    expect(context.prewarmSessionContext).not.toHaveBeenCalled()
  })

  it.each(invalidSenders)('rechecks authorization after session lookup for %s', async (_name, invalidate) => {
    const context = setup()
    const session = deferred<Session | null>()
    context.getSession.mockReturnValue(session.promise)
    await expect(context.handler(context.event, { sessionId: 'session-1', warmContext: true })).resolves.toBe(context.messages)
    expect(context.getSession).toHaveBeenCalledOnce()
    invalidate(context)
    session.resolve(context.session)
    await flushBackground()
    expect(context.prewarmSessionContext).not.toHaveBeenCalled()
  })

  it.each([
    ['incomplete', false, true],
    ['empty', true, false],
    ['incomplete and empty', false, false]
  ])('skips session lookup for %s history', async (_name, historyComplete, nonempty) => {
    const context = setup()
    const messages = nonempty ? context.messages : []
    context.getHistory.mockResolvedValue({ messages, historyComplete: historyComplete as boolean })
    await expect(context.handler(context.event, { sessionId: 'session-1', warmContext: true })).resolves.toBe(messages)
    expect(context.getSession).not.toHaveBeenCalled()
    expect(context.prewarmSessionContext).not.toHaveBeenCalled()
  })

  it('preserves history failures without session lookup or warming', async () => {
    const context = setup()
    const error = new Error('History unavailable')
    context.getHistory.mockRejectedValue(error)
    await expect(context.handler(context.event, { sessionId: 'session-1', warmContext: true })).rejects.toBe(error)
    expect(context.getSession).not.toHaveBeenCalled()
    expect(context.prewarmSessionContext).not.toHaveBeenCalled()
    expect(context.warn).not.toHaveBeenCalled()
  })

  it.each([null, { id: 'another-session' } as Session])('skips missing or mismatched session %s', async (session) => {
    const context = setup()
    context.getSession.mockResolvedValue(session)
    await expect(context.handler(context.event, { sessionId: 'session-1', warmContext: true })).resolves.toBe(context.messages)
    await flushBackground()
    expect(context.prewarmSessionContext).not.toHaveBeenCalled()
  })

  it('does not delay history while session lookup remains pending', async () => {
    const context = setup()
    const session = deferred<Session | null>()
    context.getSession.mockReturnValue(session.promise)
    await expect(context.handler(context.event, { sessionId: 'session-1', warmContext: true })).resolves.toBe(context.messages)
    expect(context.prewarmSessionContext).not.toHaveBeenCalled()
    session.resolve(context.session)
    await flushBackground()
    expect(context.prewarmSessionContext).toHaveBeenCalledOnce()
  })

  it('does not delay history while warming remains pending', async () => {
    const context = setup()
    const warm = deferred<void>()
    context.prewarmSessionContext.mockReturnValue(warm.promise)
    await expect(context.handler(context.event, { sessionId: 'session-1', warmContext: true })).resolves.toBe(context.messages)
    await flushBackground()
    expect(context.prewarmSessionContext).toHaveBeenCalledOnce()
    warm.resolve(undefined)
    await flushBackground()
  })

  it.each(['lookup rejection', 'lookup throw', 'warm rejection', 'warm throw'])('logs safely without rejecting history after %s', async (failure) => {
    const context = setup()
    const error = new Error('private session content and credentials')
    if (failure === 'lookup rejection') context.getSession.mockRejectedValue(error)
    if (failure === 'lookup throw') context.getSession.mockImplementation(() => { throw error })
    if (failure === 'warm rejection') context.prewarmSessionContext.mockRejectedValue(error)
    if (failure === 'warm throw') context.prewarmSessionContext.mockImplementation(() => { throw error })
    await expect(context.handler(context.event, { sessionId: 'session-1', warmContext: true })).resolves.toBe(context.messages)
    await flushBackground()
    expect(context.warn).toHaveBeenCalledExactlyOnceWith('Failed to prewarm selected history context')
  })

  it('does not leak an unhandled rejection when failure logging also throws', async () => {
    const context = setup()
    context.getSession.mockRejectedValue(new Error('Lookup failed'))
    context.warn.mockImplementation(() => { throw new Error('Logger failed') })
    await expect(context.handler(context.event, { sessionId: 'session-1', warmContext: true })).resolves.toBe(context.messages)
    await flushBackground()
    expect(context.warn).toHaveBeenCalledOnce()
  })

  it('discards stale A history when B is selected before A completes', async () => {
    const context = setup()
    const historyA = deferred<HistoryPage>()
    const messagesB = messagesFor('message-B')
    const sessionB = { ...context.session, id: 'session-B' }
    context.getHistory.mockImplementation((id) => id === 'session-1'
      ? historyA.promise : Promise.resolve({ messages: messagesB }))
    context.getSession.mockResolvedValue(sessionB)
    const responseA = context.handler(context.event, { sessionId: 'session-1', warmContext: true })
    await expect(context.handler(context.event, { sessionId: 'session-B', warmContext: true })).resolves.toBe(messagesB)
    historyA.resolve({ messages: context.messages })
    await expect(responseA).resolves.toBe(context.messages)
    await flushBackground()
    expect(context.getSession).toHaveBeenCalledExactlyOnceWith(undefined, 'session-B')
    expect(context.prewarmSessionContext).toHaveBeenCalledExactlyOnceWith(sessionB, expect.any(Function))
  })

  it('discards stale A session lookup when B is selected before A lookup completes', async () => {
    const context = setup()
    const sessionA = deferred<Session | null>()
    const sessionB = { ...context.session, id: 'session-B' }
    context.getSession.mockImplementation((_agentId, id) => id === 'session-1'
      ? sessionA.promise : Promise.resolve(sessionB))
    await expect(context.handler(context.event, { sessionId: 'session-1', warmContext: true })).resolves.toBe(context.messages)
    await expect(context.handler(context.event, { sessionId: 'session-B', warmContext: true })).resolves.toBe(context.messages)
    sessionA.resolve(context.session)
    await flushBackground()
    expect(context.prewarmSessionContext).toHaveBeenCalledExactlyOnceWith(sessionB, expect.any(Function))
  })

  it('keeps a failed newer selection as the latest token instead of warming stale A', async () => {
    const context = setup()
    const historyA = deferred<HistoryPage>()
    context.getHistory.mockImplementation((id) => id === 'session-1'
      ? historyA.promise : Promise.reject(new Error('B history failed')))
    const responseA = context.handler(context.event, { sessionId: 'session-1', warmContext: true })
    await expect(context.handler(context.event, { sessionId: 'session-B', warmContext: true })).rejects.toThrow('B history failed')
    historyA.resolve({ messages: context.messages })
    await expect(responseA).resolves.toBe(context.messages)
    expect(context.getSession).not.toHaveBeenCalled()
  })

  it('does not supersede selected A with an unflagged background read of B', async () => {
    const context = setup()
    const historyA = deferred<HistoryPage>()
    context.getHistory.mockImplementation((id) => id === 'session-1'
      ? historyA.promise : Promise.resolve({ messages: messagesFor('message-B') }))
    const responseA = context.handler(context.event, { sessionId: 'session-1', warmContext: true })
    await context.handler(context.event, { sessionId: 'session-B' })
    historyA.resolve({ messages: context.messages })
    await expect(responseA).resolves.toBe(context.messages)
    await flushBackground()
    expect(context.getSession).toHaveBeenCalledExactlyOnceWith(undefined, 'session-1')
    expect(context.prewarmSessionContext).toHaveBeenCalledExactlyOnceWith(context.session, expect.any(Function))
  })

  it('does not supersede selected A with a flagged but unauthorized B', async () => {
    const context = setup()
    const historyA = deferred<HistoryPage>()
    context.getHistory.mockImplementation((id) => id === 'session-1'
      ? historyA.promise : Promise.resolve({ messages: messagesFor('message-B') }))
    const responseA = context.handler(context.event, { sessionId: 'session-1', warmContext: true })
    const unauthorized = { sender: context.event.sender, senderFrame: { detached: false } } as HistoryEvent
    await context.handler(unauthorized, { sessionId: 'session-B', warmContext: true })
    historyA.resolve({ messages: context.messages })
    await expect(responseA).resolves.toBe(context.messages)
    await flushBackground()
    expect(context.getSession).toHaveBeenCalledExactlyOnceWith(undefined, 'session-1')
    expect(context.prewarmSessionContext).toHaveBeenCalledOnce()
  })

  it('tracks the latest flagged request per sender rather than globally', async () => {
    const context = setup()
    const historyA = deferred<HistoryPage>()
    const sessionB = { ...context.session, id: 'session-B' }
    const otherSender = { mainFrame: { detached: false }, isDestroyed: vi.fn(() => false) }
    const eventB = { sender: otherSender, senderFrame: otherSender.mainFrame } as unknown as HistoryEvent
    context.getHistory.mockImplementation((id) => id === 'session-1'
      ? historyA.promise : Promise.resolve({ messages: messagesFor('message-B') }))
    context.getSession.mockImplementation(async (_agentId, id) => id === 'session-1' ? context.session : sessionB)
    const responseA = context.handler(context.event, { sessionId: 'session-1', warmContext: true })
    context.mainWindow.webContents = otherSender
    await context.handler(eventB, { sessionId: 'session-B', warmContext: true })
    await flushBackground()
    context.mainWindow.webContents = context.sender
    historyA.resolve({ messages: context.messages })
    await expect(responseA).resolves.toBe(context.messages)
    await flushBackground()
    expect(context.prewarmSessionContext.mock.calls.map(([session]) => session.id)).toEqual(['session-B', 'session-1'])
  })

  it('exposes a live guard for lazy service loading to discard superseded work', async () => {
    const context = setup()
    await context.handler(context.event, { sessionId: 'session-1', warmContext: true })
    await flushBackground()
    const isCurrentOpen = context.prewarmSessionContext.mock.calls[0][1]
    expect(isCurrentOpen()).toBe(true)
    context.getHistory.mockResolvedValue({ messages: [] })
    await context.handler(context.event, { sessionId: 'session-B', warmContext: true })
    expect(isCurrentOpen()).toBe(false)
  })
})

describe('selected history UI opt-in', () => {
  it('flags only the selected-session history hydration request', () => {
    const source = readFileSync(new URL('../../../../../page/HomePage/HomePage.jsx', import.meta.url), 'utf8')
    const requests = [...source.matchAll(/invoke\(IpcChannel\.AgentMessage_GetHistory,\s*\{([^}]+)\}/g)]
    expect(requests).toHaveLength(2)
    expect(requests.filter((match) => /warmContext:\s*true/.test(match[1]))).toHaveLength(1)
    const selected = requests.find((match) => /warmContext:\s*true/.test(match[1]))!
    expect(selected[1]).toMatch(/sessionId:\s*runtimeSessionId/)
    const effectStart = source.lastIndexOf('useEffect(() => {', selected.index)
    expect(source.slice(effectStart, selected.index)).toContain("if (selectedPane !== 'chat') return;")
    expect(source.slice(effectStart, selected.index)).toContain('!activeChatNeedsHistoryHydrate')
  })
})
