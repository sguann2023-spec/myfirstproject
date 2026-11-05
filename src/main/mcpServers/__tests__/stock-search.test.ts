import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

const { mockFetch, mockEnsureToken, mockStoreGet } = vi.hoisted(() => ({
  mockFetch: vi.fn(), mockEnsureToken: vi.fn(), mockStoreGet: vi.fn()
}))
vi.mock('electron', () => ({ net: { fetch: mockFetch } }))
vi.mock('electron-store', () => ({ default: class { get = mockStoreGet } }))
vi.mock('../../services/agents/services/AgentRuntimeAuthService', () => ({
  agentRuntimeAuthService: { ensureValidAccessToken: mockEnsureToken }
}))

import StockSearchServer from '../stock-search'

const CLOUD = 'https://open.vectcut.com/coverr/mcp'
const MAX_BYTES = 4 * 1024 * 1024
const FAILURE = {
  content: [{ type: 'text', text: 'Stock media search failed. Check search parameters and login, or try again later.' }],
  isError: true
}
type RpcRequest = {
  jsonrpc: string
  id?: number | string
  method: string
  params?: { name?: string; arguments?: Record<string, unknown>; protocolVersion?: string }
}
type RemoteOptions = {
  format?: 'json' | 'sse'
  raw?: unknown
  toolResult?: Record<string, unknown>
  reply?: (message: RpcRequest) => Response | undefined
  terminate?: (init: RequestInit) => Response | Promise<Response>
}

function rpcResponse(message: unknown, format: 'json' | 'sse' = 'json', session?: string): Response {
  const json = JSON.stringify(message)
  const headers: Record<string, string> = { 'content-type': format === 'json' ? 'application/json' : 'text/event-stream' }
  if (session) headers['mcp-session-id'] = session
  if (format === 'json') return new Response(json, { headers })
  // Split even inside UTF-8 characters and SSE delimiters to exercise the real decoder/parser.
  const bytes = new TextEncoder().encode(`event: message\ndata: ${json}\n\n`)
  let offset = 0
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset === bytes.length) { controller.close(); return }
      controller.enqueue(bytes.slice(offset, offset + 7))
      offset = Math.min(offset + 7, bytes.length)
    }
  }), { headers })
}

function mockRemote(options: RemoteOptions = {}) {
  let sessions = 0
  const requests: RpcRequest[] = []
  mockFetch.mockImplementation(async (_url: string, init: RequestInit) => {
    if (init.method === 'GET') return new Response(null, { status: 405 })
    if (init.method === 'DELETE') return options.terminate ? options.terminate(init) : new Response(null, { status: 204 })
    const message = JSON.parse(String(init.body)) as RpcRequest
    requests.push(message)
    const overridden = options.reply?.(message)
    if (overridden) return overridden
    if (message.method === 'initialize') {
      return rpcResponse({ jsonrpc: '2.0', id: message.id, result: {
        protocolVersion: message.params?.protocolVersion,
        capabilities: { tools: {} }, serverInfo: { name: 'upstream-fixture', version: '1.0.0' }
      } }, options.format, `session-${++sessions}`)
    }
    if (message.method === 'notifications/initialized') return new Response(null, { status: 202 })
    if (message.method === 'tools/call') {
      const raw = options.raw === undefined ? { hits: [] } : options.raw
      return rpcResponse({ jsonrpc: '2.0', id: message.id, result: options.toolResult ?? {
        content: [{ type: 'text', text: JSON.stringify(raw) }], structuredContent: raw
      } }, options.format)
    }
    throw new Error(`Unexpected mock MCP method: ${message.method}`)
  })
  return requests
}

function assertFailure(result: unknown) {
  expect(result).toEqual(FAILURE)
  expect(JSON.stringify(result)).not.toMatch(/coverr|upstream|secret|Bearer|JSON-RPC|rawOutput|base64/i)
}

function assertClosed() {
  expect(mockFetch.mock.calls.length).toBeGreaterThan(0)
  for (const [url, init] of mockFetch.mock.calls) {
    expect(url).toMatch(/\/coverr\/mcp$/)
    expect(init.redirect).toBe('error')
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(init.signal.aborted).toBe(true)
  }
}

describe('StockSearchServer with real MCP SDK clients', () => {
  let client: Client
  const connections: Array<{ client: Client; server: StockSearchServer }> = []

  async function connect(endpoint?: string) {
    const server = new StockSearchServer(endpoint)
    const connected = new Client({ name: 'stock-search-test', version: '1.0.0' })
    connections.push({ client: connected, server })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.mcpServer.connect(serverTransport)
    await connected.connect(clientTransport)
    return connected
  }

  beforeEach(async () => {
    mockFetch.mockReset()
    mockEnsureToken.mockReset().mockResolvedValue('login-token')
    mockStoreGet.mockReset()
    vi.stubEnv('STOCK_SEARCH_MCP_URL', '')
    vi.stubEnv('VECTCUT_API_KEY', '')
    vi.stubEnv('VECTCUT_APIKEY', '')
    client = await connect()
  })

  afterEach(async () => {
    for (const connection of connections.splice(0)) {
      await connection.client.close()
      await connection.server.mcpServer.close()
    }
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('lists exactly four read-only tools with restricted schemas and search guidance', async () => {
    const { tools } = await client.listTools()
    expect(tools.map(tool => tool.name)).toEqual(['search_videos', 'get_video', 'search_audios', 'get_audio'])
    expect(tools.map(tool => tool.title)).toEqual(['\u89c6\u9891\u641c\u7d22', '\u89c6\u9891\u8be6\u60c5', '\u97f3\u9891\u641c\u7d22', '\u97f3\u9891\u8be6\u60c5'])
    for (const tool of tools) {
      expect(tool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, openWorldHint: true })
      expect(tool.inputSchema.additionalProperties).toBe(false)
      expect(tool.inputSchema.required).toEqual([tool.name.startsWith('search_') ? 'query' : 'id'])
      expect(tool.description).toContain('potentially cheaper alternative to AI generation')
      expect(tool.description).toContain('Honor explicit AI generation requests')
      expect(tool.description).toContain('no automatic download or timeline insertion')
      expect(tool.description).toContain('license and third-party rights')
    }
    expect(tools[0].inputSchema.properties).toMatchObject({
      query: { type: 'string', minLength: 1, maxLength: 200 },
      page: { type: 'integer', minimum: 0, default: 0 },
      page_size: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      sort_by: { enum: ['date', 'popular', 'trending'] },
      category: { maxLength: 128 }, filter: { maxLength: 512 }
    })
    expect(Object.keys(tools[2].inputSchema.properties!)).toEqual(['query', 'page', 'page_size', 'sort_by'])
    expect(tools[2].inputSchema.properties).toMatchObject({ sort_by: { enum: ['date', 'popular'] } })
    expect(tools[2].description).toContain('Do not assume dedicated sound effects are available')
    expect(JSON.stringify(tools)).not.toMatch(/coverr|upstream|api.key|proxy/i)
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockEnsureToken).not.toHaveBeenCalled()
  })

  it.each(['get_videos', 'get_audios', 'download_video', 'generate_audio', 'search_images', '__proto__'])('blocks non-whitelisted tool %s before network/auth', async name => {
    assertFailure(await client.callTool({ name, arguments: { query: 'nature' } }))
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockEnsureToken).not.toHaveBeenCalled()
  })

  it.each([
    ['search_videos', 'get_videos', { query: '  \u81ea\u7136 & city  ', category: ' nature ', filter: ' is_vertical:true ', sort_by: ' trending ' }, { query: '\u81ea\u7136 & city', page: 0, page_size: 20, category: 'nature', filter: 'is_vertical:true', sort_by: 'trending' }, 'video'],
    ['search_audios', 'get_audios', { query: ' calm ', page: 2, page_size: 100, sort_by: ' popular ' }, { query: 'calm', page: 2, page_size: 100, sort_by: 'popular' }, 'audio'],
    ['get_video', 'get_video', { id: ' video-123 ' }, { id: 'video-123' }, 'video'],
    ['get_audio', 'get_audio', { id: ' audio-123 ' }, { id: 'audio-123' }, 'audio']
  ] as const)('maps %s to %s, trims arguments and injects context', async (name, remoteName, args, expected, mediaType) => {
    const requests = mockRemote({ raw: name.startsWith('search_') ? { hits: [] } : { id: 'asset-123' } })
    const result = await client.callTool({ name, arguments: { ...args } })
    expect(result.isError).not.toBe(true)
    const calls = requests.filter(request => request.method === 'tools/call')
    expect(calls).toHaveLength(1)
    expect(calls[0].params).toEqual({ name: remoteName, arguments: {
      ...expected, context: expect.stringContaining('avoiding unnecessary custom generation costs')
    } })
    expect(requests.some(request => request.method === 'tools/list')).toBe(false)
    expect(result.structuredContent).toMatchObject({ mediaType, usage: expect.stringContaining('no download or timeline insertion') })
    const text = (result.content as CallToolResult['content'])[0]
    expect(text.type).toBe('text')
    if (text.type === 'text') expect(JSON.parse(text.text)).toEqual(result.structuredContent)
    assertClosed()
  })

  const invalidArgs: Array<[string, Record<string, unknown> | undefined]> = [
    ['search_videos', undefined], ['search_videos', {}], ['search_videos', { query: ' ' }],
    ['search_videos', { query: 'x'.repeat(201) }], ['search_videos', { query: 42 }],
    ...[-1, 0.5, Number.MAX_SAFE_INTEGER + 1, '1', null].map(page => ['search_videos', { query: 'nature', page }] as [string, Record<string, unknown>]),
    ...[0, 101, 1.5, '20'].map(page_size => ['search_videos', { query: 'nature', page_size }] as [string, Record<string, unknown>]),
    ['search_videos', { query: 'nature', sort_by: 'unknown' }],
    ['search_videos', { query: 'nature', category: ' ' }], ['search_videos', { query: 'nature', category: 'x'.repeat(129) }],
    ['search_videos', { query: 'nature', filter: '' }], ['search_videos', { query: 'nature', filter: 'x'.repeat(513) }],
    ...['key', 'host', 'context', 'download'].map(key => ['search_videos', { query: 'nature', [key]: 'injected' }] as [string, Record<string, unknown>]),
    ['search_audios', { query: 'calm', category: 'music' }], ['search_audios', { query: 'calm', filter: 'sfx:true' }],
    ['search_audios', { query: 'calm', sort_by: 'trending' }],
    ['get_video', {}], ['get_video', { id: ' ' }], ['get_video', { id: 'x'.repeat(129) }],
    ['get_audio', { id: 1 }], ['get_audio', { id: 'audio-1', page: 0 }]
  ]
  it.each(invalidArgs)('rejects invalid %s arguments %j without network/auth', async (name, args) => {
    assertFailure(await client.callTool({ name, arguments: args }))
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockEnsureToken).not.toHaveBeenCalled()
  })

  it('accepts inclusive argument boundaries and applies audio pagination defaults', async () => {
    const requests = mockRemote()
    expect((await client.callTool({ name: 'search_videos', arguments: {
      query: 'q'.repeat(200), category: 'c'.repeat(128), filter: 'f'.repeat(512), page: Number.MAX_SAFE_INTEGER, page_size: 1, sort_by: 'date'
    } })).isError).not.toBe(true)
    expect((await client.callTool({ name: 'search_audios', arguments: { query: 'a' } })).isError).not.toBe(true)
    expect(requests.filter(request => request.method === 'tools/call')[1].params?.arguments).toMatchObject({ page: 0, page_size: 20 })
    mockRemote({ raw: { id: 'asset' } })
    expect((await client.callTool({ name: 'get_audio', arguments: { id: 'i'.repeat(128) } })).isError).not.toBe(true)
  })

  it.each(['json', 'sse'] as const)('initializes real HTTP MCP via %s, propagates session headers and closes isolated sessions', async format => {
    const requests = mockRemote({ format, raw: { hits: [{ id: '1', title: '\u81ea\u7136\u98ce\u5149' }] } })
    const terminate = vi.spyOn(StreamableHTTPClientTransport.prototype, 'terminateSession')
    const closeClient = vi.spyOn(Client.prototype, 'close')
    const closeTransport = vi.spyOn(StreamableHTTPClientTransport.prototype, 'close')
    for (let i = 0; i < 2; i++) {
      expect((await client.callTool({ name: 'search_videos', arguments: { query: 'nature' } })).structuredContent)
        .toMatchObject({ hits: [{ id: '1', title: '\u81ea\u7136\u98ce\u5149' }] })
    }
    expect(requests.map(request => request.method)).toEqual([
      'initialize', 'notifications/initialized', 'tools/call',
      'initialize', 'notifications/initialized', 'tools/call'
    ])
    const posts = mockFetch.mock.calls.filter(([, init]) => init.method === 'POST')
    for (let i = 0; i < posts.length; i++) {
      const headers = new Headers(posts[i][1].headers)
      expect(posts[i][0]).toBe(CLOUD)
      expect(headers.get('authorization')).toBe('Bearer login-token')
      expect(headers.get('accept')).toBe('application/json, text/event-stream')
      expect(headers.get('content-type')).toBe('application/json')
      expect(headers.get('mcp-session-id')).toBe(i % 3 === 0 ? null : `session-${Math.floor(i / 3) + 1}`)
      if (i % 3 !== 0) expect(headers.get('mcp-protocol-version')).toBe(requests[0].params?.protocolVersion)
    }
    expect(mockFetch.mock.calls.filter(([, init]) => init.method === 'GET')).toHaveLength(2)
    const deletes = mockFetch.mock.calls.filter(([, init]) => init.method === 'DELETE')
    expect(deletes).toHaveLength(2)
    for (let i = 0; i < deletes.length; i++) {
      const [url, init] = deletes[i]
      const headers = new Headers(init.headers)
      expect(url).toBe(CLOUD)
      expect(init.body).toBeUndefined()
      expect(headers.get('mcp-session-id')).toBe(`session-${i + 1}`)
      expect(headers.get('mcp-protocol-version')).toBe(requests[0].params?.protocolVersion)
      expect(headers.get('authorization')).toBe('Bearer login-token')
      expect(terminate.mock.invocationCallOrder[i]).toBeLessThan(closeClient.mock.invocationCallOrder[i])
      expect(closeClient.mock.invocationCallOrder[i]).toBeLessThan(closeTransport.mock.invocationCallOrder[i * 2])
    }
    expect(terminate).toHaveBeenCalledTimes(2)
    expect(closeClient).toHaveBeenCalledTimes(2)
    // client.close() closes its transport; the implementation also closes it explicitly.
    expect(closeTransport).toHaveBeenCalledTimes(4)
    assertClosed()
  })

  it.each([
    ['http', false], ['http', true], ['network', false], ['network', true]
  ] as const)('preserves the original result when DELETE fails with %s (tool failure=%s)', async (failure, toolFailure) => {
    const closeClient = vi.spyOn(Client.prototype, 'close')
    const closeTransport = vi.spyOn(StreamableHTTPClientTransport.prototype, 'close')
    const cancel = vi.fn()
    mockRemote({
      raw: { hits: [{ id: 'preserved-1' }] },
      ...(toolFailure ? { toolResult: { content: [{ type: 'text', text: 'secret upstream failure' }], isError: true } } : {}),
      terminate: init => {
        expect(new Headers(init.headers).get('mcp-session-id')).toBe('session-1')
        expect(init.signal!.aborted).toBe(false)
        expect(closeClient).not.toHaveBeenCalled()
        expect(closeTransport).not.toHaveBeenCalled()
        if (failure === 'network') throw new Error('secret DELETE network failure')
        return new Response(new ReadableStream({ cancel }), { status: 500 })
      }
    })
    const result = await client.callTool({ name: 'search_videos', arguments: { query: 'nature' } })
    if (toolFailure) assertFailure(result)
    else {
      expect(result.isError).not.toBe(true)
      expect(result.structuredContent).toMatchObject({ hits: [{ id: 'preserved-1' }] })
      expect(JSON.stringify(result)).not.toMatch(/secret|DELETE/)
    }
    expect(mockFetch.mock.calls.filter(([, init]) => init.method === 'DELETE')).toHaveLength(1)
    if (failure === 'http') expect(cancel).toHaveBeenCalledOnce()
    expect(closeClient).toHaveBeenCalledOnce()
    expect(closeTransport).toHaveBeenCalledTimes(2)
    assertClosed()
  })

  it.each([false, true])('bounds DELETE to five seconds then closes without replacing the result (tool failure=%s)', async toolFailure => {
    const deadline = new AbortController()
    const realTimeout = AbortSignal.timeout.bind(AbortSignal)
    // Control only the DELETE deadline, retaining real SDK transports and operation signals.
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => ms === 5_000 ? deadline.signal : realTimeout(ms))
    const closeClient = vi.spyOn(Client.prototype, 'close')
    const closeTransport = vi.spyOn(StreamableHTTPClientTransport.prototype, 'close')
    let deleteSignal: AbortSignal | undefined
    mockRemote({
      raw: { hits: [{ id: 'preserved-1' }] },
      ...(toolFailure ? { toolResult: { content: [], isError: true } } : {}),
      terminate: init => new Promise<Response>((_resolve, reject) => {
        deleteSignal = init.signal!
        deleteSignal.addEventListener('abort', () => reject(deleteSignal!.reason), { once: true })
      })
    })
    const pending = client.callTool({ name: 'search_videos', arguments: { query: 'nature' } })
    await vi.waitFor(() => expect(deleteSignal).toBeDefined())
    expect(timeout.mock.calls.filter(([ms]) => ms === 5_000)).toHaveLength(1)
    expect(timeout).toHaveBeenCalledWith(95_000)
    expect(deleteSignal!.aborted).toBe(false)
    expect(closeClient).not.toHaveBeenCalled()
    expect(closeTransport).not.toHaveBeenCalled()
    deadline.abort(new DOMException('secret DELETE deadline', 'TimeoutError'))
    const result = await pending
    if (toolFailure) assertFailure(result)
    else {
      expect(result.isError).not.toBe(true)
      expect(result.structuredContent).toMatchObject({ hits: [{ id: 'preserved-1' }] })
      expect(JSON.stringify(result)).not.toMatch(/secret|DELETE|TimeoutError/)
    }
    expect(deleteSignal!.reason.name).toBe('TimeoutError')
    expect(closeClient).toHaveBeenCalledOnce()
    expect(closeTransport).toHaveBeenCalledTimes(2)
    assertClosed()
  })

  it('aborts an open standalone SSE connection when the operation finishes', async () => {
    mockRemote()
    const handle = mockFetch.getMockImplementation()!
    const abort = vi.fn()
    mockFetch.mockImplementation(async (url: string, init: RequestInit) => {
      if (init.method !== 'GET') return handle(url, init)
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const onAbort = () => { abort(); controller.close() }
          if (init.signal!.aborted) onAbort()
          else init.signal!.addEventListener('abort', onAbort, { once: true })
        }
      })
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
    })
    expect((await client.callTool({ name: 'search_audios', arguments: { query: 'calm' } })).isError).not.toBe(true)
    expect(abort).toHaveBeenCalledOnce()
    assertClosed()
  })

  it.each(['initialize', 'tools/call'])('retries %s once after Bearer 401 using refreshed credentials', async method => {
    let rejected = false
    mockEnsureToken.mockResolvedValue('expired-token').mockImplementation(async force => force ? 'refreshed-token' : 'expired-token')
    const requests = mockRemote({ reply: message => {
      if (message.method !== method || rejected) return undefined
      rejected = true
      return new Response('coverr secret expired-token', { status: 401 })
    } })
    expect((await client.callTool({ name: 'search_videos', arguments: { query: 'nature' } })).isError).not.toBe(true)
    const attempts = mockFetch.mock.calls.filter(([, init]) => init.method === 'POST' && JSON.parse(init.body).method === method)
    expect(attempts).toHaveLength(2)
    expect(new Headers(attempts[0][1].headers).get('authorization')).toBe('Bearer expired-token')
    expect(new Headers(attempts[1][1].headers).get('authorization')).toBe('Bearer refreshed-token')
    expect(attempts[1][1].body).toBe(attempts[0][1].body)
    expect(mockEnsureToken.mock.calls.filter(([force]) => force === true)).toHaveLength(1)
    expect(requests.filter(request => request.method === method)).toHaveLength(2)
    assertClosed()
  })

  it('falls back to the Store credential when login refresh is unavailable', async () => {
    mockEnsureToken.mockRejectedValue(new Error('secret refresh token'))
    mockStoreGet.mockImplementation(key => key === 'auth.vectcut_api_key' ? ' stored-key ' : undefined)
    mockRemote()
    expect((await client.callTool({ name: 'search_audios', arguments: { query: 'calm' } })).isError).not.toBe(true)
    for (const [, init] of mockFetch.mock.calls) expect(new Headers(init.headers).get('authorization')).toBe('Bearer stored-key')
    expect(mockStoreGet).toHaveBeenCalledWith('auth.vectcut_api_key')
  })

  it('fails without network access when signed out and no stored credentials exist', async () => {
    mockEnsureToken.mockRejectedValue(new Error('secret refresh token from coverr'))
    assertFailure(await client.callTool({ name: 'search_videos', arguments: { query: 'nature' } }))
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('stops retrying when the refreshed Bearer token is also unauthorized', async () => {
    mockEnsureToken.mockResolvedValueOnce('expired-token').mockResolvedValue('refreshed-token')
    mockFetch.mockImplementation(async () => new Response('coverr secret Bearer credentials', { status: 401 }))
    assertFailure(await client.callTool({ name: 'search_videos', arguments: { query: 'nature' } }))
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(mockEnsureToken.mock.calls).toEqual([[undefined], [true]])
    assertClosed()
  })

  it('does not reuse results or credentials across calls and after logout', async () => {
    const requests = mockRemote()
    const request = { name: 'search_videos', arguments: { query: 'nature' } }
    await client.callTool(request)
    mockEnsureToken.mockResolvedValue('other-account-token')
    await client.callTool(request)
    expect(requests.filter(message => message.method === 'tools/call')).toHaveLength(2)
    const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1]
    expect(new Headers(lastCall[1].headers).get('authorization')).toBe('Bearer other-account-token')
    const fetchCount = mockFetch.mock.calls.length
    mockEnsureToken.mockRejectedValue(new Error('secret logout'))
    assertFailure(await client.callTool(request))
    expect(mockFetch).toHaveBeenCalledTimes(fetchCount)
  })

  it.each(['initialize', 'tools/call'])('sanitizes JSON-RPC errors and closes the session on %s failure', async method => {
    mockRemote({ reply: message => message.method === method ? rpcResponse({
      jsonrpc: '2.0', id: message.id, error: { code: -32603, message: 'coverr secret Bearer upstream error', data: { rawOutput: 'secret' } }
    }) : undefined })
    const closeClient = vi.spyOn(Client.prototype, 'close')
    const closeTransport = vi.spyOn(StreamableHTTPClientTransport.prototype, 'close')
    assertFailure(await client.callTool({ name: 'search_videos', arguments: { query: 'nature' } }))
    const deletes = mockFetch.mock.calls.filter(([, init]) => init.method === 'DELETE')
    expect(deletes).toHaveLength(method === 'initialize' ? 0 : 1)
    if (deletes.length) expect(new Headers(deletes[0][1].headers).get('mcp-session-id')).toBe('session-1')
    expect(closeClient).toHaveBeenCalled()
    expect(closeTransport).toHaveBeenCalled()
    assertClosed()
  })

  it.each([403, 404, 429, 500])('sanitizes HTTP %i errors', async status => {
    mockFetch.mockImplementation(async () => new Response('coverr secret Bearer token', { status }))
    assertFailure(await client.callTool({ name: 'search_videos', arguments: { query: 'nature' } }))
    expect(mockFetch).toHaveBeenCalledOnce()
    assertClosed()
  })

  it('sanitizes network exceptions', async () => {
    mockFetch.mockRejectedValue(new Error('coverr secret Bearer network failure'))
    assertFailure(await client.callTool({ name: 'get_audio', arguments: { id: 'audio-1' } }))
    assertClosed()
  })

  it.each([
    { content: [{ type: 'text', text: 'coverr secret error' }], isError: true },
    { content: [{ type: 'text', text: 'coverr secret not JSON' }] },
    { content: [] },
    { content: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }] }
  ])('sanitizes upstream tool failures and invalid text results %j', async toolResult => {
    mockRemote({ toolResult })
    assertFailure(await client.callTool({ name: 'search_videos', arguments: { query: 'nature' } }))
    assertClosed()
  })

  it('sanitizes malformed initialization JSON without leaking its body', async () => {
    mockFetch.mockResolvedValue(new Response('coverr secret malformed JSON', { headers: { 'content-type': 'application/json' } }))
    assertFailure(await client.callTool({ name: 'search_audios', arguments: { query: 'calm' } }))
    assertClosed()
  })

  it('projects bounded metadata, numeric strings and safe URLs without fetching media', async () => {
    const asset = {
      id: 'asset-1', videoId: 'video-1', audioId: 'audio-1', title: 't'.repeat(300), description: 'd'.repeat(3000), name: 'name', slug: 'slug',
      aspectRatio: '16:9', tempo: 'fast', duration: ' 12.5 ', fps: 24, maxHeight: '1080', maxWidth: '1920', downloads: '4',
      views: -1, likes: 'NaN', listens: 'Infinity', isVertical: true, isPremium: false, isAiGenerated: 'true',
      tags: [1, ...Array.from({ length: 40 }, () => 'tag'.repeat(100))], genres: ['ambient'], instruments: ['piano'], videoThemes: ['nature'], moods: ['calm'],
      poster: 'https://cdn.example/poster.jpg', thumbnail: 'data:image/png;base64,AAAA', pageURL: 'https://user:secret@cdn.example/page',
      urls: { preview: 'https://cdn.example/preview.mp4', download: { hd: 'http://cdn.example/hd.mp4', bytes: 999 },
        unsafe: 'javascript:alert(1)', inline: 'data:video/mp4;base64,AAAA', credentials: 'https://user:secret@cdn.example/file',
        relative: '/file.mp4', long: `https://cdn.example/${'x'.repeat(4096)}`, list: ['https://cdn.example/list.mp4'] },
      analyticsId: 'secret', filename: 'secret.mp4', rawOutput: { secret: 'AAAA' }, extra: 'secret'
    }
    mockRemote({ raw: { hits: [asset], page: 0, pages: 2, pageSize: 20, total: 21, analyticsId: 'secret' } })
    const result = await client.callTool({ name: 'search_videos', arguments: { query: 'nature' } })
    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toEqual({
      title: '\u89c6\u9891\u641c\u7d22', mediaType: 'video', usage: expect.stringContaining('license and third-party rights'),
      hits: [{ id: 'asset-1', videoId: 'video-1', audioId: 'audio-1', title: 't'.repeat(256), description: 'd'.repeat(2048), name: 'name', slug: 'slug',
        aspectRatio: '16:9', tempo: 'fast', duration: 12.5, fps: 24, maxHeight: 1080, maxWidth: 1920, downloads: 4,
        isVertical: true, isPremium: false, tags: Array(32).fill('tag'.repeat(100).slice(0, 128)),
        genres: ['ambient'], instruments: ['piano'], videoThemes: ['nature'], moods: ['calm'],
        poster: asset.poster, urls: { preview: asset.urls.preview, download: { hd: asset.urls.download.hd } } }],
      page: 0, pages: 2, pageSize: 20, total: 21
    })
    expect(JSON.stringify(result)).not.toMatch(/secret|analyticsId|filename|rawOutput|javascript:|base64|relative|bytes/)
    expect(mockFetch.mock.calls.every(([url]) => url === CLOUD)).toBe(true)
  })

  it('bounds URL reference depth and breadth and ignores invalid pagination metadata', async () => {
    const url = 'https://cdn.example/file.mp4'
    const urls = Object.fromEntries(Array.from({ length: 34 }, (_, i) => [`url${i}`, url]))
    const nested = { a: { b: { c: { atLimit: url, d: { tooDeep: url } } } } }
    mockRemote({ raw: { hits: [{ id: '1', urls: { nested, ...urls } }],
      page: -1, pages: 1.5, pageSize: '20', total: Number.MAX_SAFE_INTEGER + 1 } })
    const result = await client.callTool({ name: 'search_videos', arguments: { query: 'nature' } })
    const projected = result.structuredContent as { hits: Array<{ urls: Record<string, unknown> }> }
    expect(Object.keys(projected.hits[0].urls)).toHaveLength(32)
    expect(projected.hits[0].urls).toHaveProperty('nested.a.b.c.atLimit', url)
    expect(JSON.stringify(result)).not.toMatch(/tooDeep|url31|url32|url33|pageSize|"pages"|"total"|"page"/)
  })

  it.each([
    ['get_video', { video: { id: 'video-1', urls: { preview: 'https://cdn.example/video.mp4' } }, secret: 'dropped' }, 'video-1'],
    ['get_audio', { audio: { id: 'audio-1', urls: { preview: 'https://cdn.example/audio.mp3' } }, secret: 'dropped' }, 'audio-1'],
    ['get_audio', { id: 'audio-2', duration: '42', secret: 'dropped' }, 'audio-2']
  ] as const)('projects %s wrapped or direct detail results', async (name, raw, id) => {
    mockRemote({ raw })
    const result = await client.callTool({ name, arguments: { id } })
    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toMatchObject({ asset: { id } })
    expect(result.structuredContent).not.toHaveProperty('hits')
    expect(JSON.stringify(result)).not.toContain('secret')
  })

  it('parses text-only results and prefers structured content when both are present', async () => {
    mockRemote({ toolResult: { content: [{ type: 'text', text: JSON.stringify({ hits: [{ id: 'text-1' }] }) }] } })
    expect((await client.callTool({ name: 'search_audios', arguments: { query: 'calm' } })).structuredContent).toMatchObject({ hits: [{ id: 'text-1' }] })
    mockRemote({ toolResult: { content: [{ type: 'text', text: 'secret invalid JSON' }], structuredContent: { hits: [{ id: 'structured-1' }] } } })
    const result = await client.callTool({ name: 'search_audios', arguments: { query: 'calm' } })
    expect(result.structuredContent).toMatchObject({ hits: [{ id: 'structured-1' }] })
    expect(JSON.stringify(result)).not.toContain('secret')
  })

  it.each([
    ['search_videos', []], ['search_videos', {}], ['search_videos', { hits: 'bad' }],
    ['search_videos', { hits: [null] }], ['search_videos', { hits: [[]] }],
    ['search_videos', { hits: Array.from({ length: 101 }, () => ({ id: '1' })) }],
    ['get_video', { video: { title: 'missing id' } }], ['get_audio', { id: 1 }], ['get_audio', { id: '' }]
  ])('rejects invalid or excessive %s result %j', async (name, raw) => {
    mockRemote({ toolResult: { content: [{ type: 'text', text: JSON.stringify(raw) }] } })
    assertFailure(await client.callTool({ name: String(name), arguments: String(name).startsWith('search_') ? { query: 'nature' } : { id: 'asset-1' } }))
    assertClosed()
  })

  it('accepts exactly 100 hits', async () => {
    const hits = Array.from({ length: 100 }, (_, id) => ({ id: String(id) }))
    mockRemote({ raw: { hits } })
    expect((await client.callTool({ name: 'search_videos', arguments: { query: 'nature', page_size: 100 } })).structuredContent).toMatchObject({ hits })
  })

  it.each(['initialize', 'tools/call'])('rejects oversized Content-Length on %s and cancels its unread body', async method => {
    const cancel = vi.fn()
    mockRemote({ reply: message => message.method === method ? new Response(new ReadableStream({ cancel }), {
      headers: { 'content-type': 'application/json', 'content-length': String(MAX_BYTES + 1) }
    }) : undefined })
    assertFailure(await client.callTool({ name: 'search_videos', arguments: { query: 'nature' } }))
    expect(cancel).toHaveBeenCalledOnce()
    assertClosed()
  })

  it.each([undefined, '1'])('enforces cumulative streamed bytes regardless of Content-Length %s', async length => {
    const cancel = vi.fn()
    mockRemote({ reply: message => {
      if (message.method !== 'tools/call') return undefined
      return new Response(new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array(1024 * 1024).fill(32))
        }, cancel
      }), { headers: { 'content-type': 'application/json', ...(length ? { 'content-length': length } : {}) } })
    } })
    assertFailure(await client.callTool({ name: 'search_videos', arguments: { query: 'nature' } }))
    expect(cancel).toHaveBeenCalledOnce()
    assertClosed()
  })

  it('accepts a JSON response exactly at the byte limit and rejects one byte more', async () => {
    for (const extra of [0, 1]) {
      mockRemote({ reply: message => {
        if (message.method !== 'tools/call') return undefined
        const response = { jsonrpc: '2.0', id: message.id, result: { content: [], structuredContent: { hits: [], padding: '' } } }
        const overhead = Buffer.byteLength(JSON.stringify(response))
        response.result.structuredContent.padding = 'x'.repeat(MAX_BYTES - overhead + extra)
        const body = JSON.stringify(response)
        expect(Buffer.byteLength(body)).toBe(MAX_BYTES + extra)
        return new Response(body, { headers: { 'content-type': 'application/json', 'content-length': String(MAX_BYTES + extra) } })
      } })
      const result = await client.callTool({ name: 'search_videos', arguments: { query: 'nature' } })
      if (extra) assertFailure(result)
      else {
        expect(result.isError).not.toBe(true)
        expect(result.structuredContent).toMatchObject({ hits: [] })
        expect(JSON.stringify(result)).not.toContain('padding')
      }
      assertClosed()
    }
  })

  it.each([
    'https://evil.example/coverr/mcp', 'https://open.vectcut.com.evil.example/coverr/mcp',
    'https://evil.open.vectcut.com/coverr/mcp', 'http://open.vectcut.com/coverr/mcp',
    'https://open.vectcut.com:444/coverr/mcp', 'https://user:secret@open.vectcut.com/coverr/mcp',
    'https://open.vectcut.com/coverr/mcp?host=evil', 'https://open.vectcut.com/coverr/mcp#secret',
    'https://open.vectcut.com/other', 'https://open.vectcut.com/coverr/mcp/',
    'http://localhost.evil.example/coverr/mcp', 'http://192.168.1.1/coverr/mcp',
    'ftp://localhost/coverr/mcp', 'http://user:secret@localhost/coverr/mcp',
    'http://localhost/coverr/mcp?secret=1', 'not-a-url'
  ])('rejects untrusted or invalid endpoint %s before networking', endpoint => {
    expect(() => new StockSearchServer(endpoint)).toThrow()
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockEnsureToken).not.toHaveBeenCalled()
  })

  it('also rejects arbitrary remote hosts selected by the environment', () => {
    vi.stubEnv('STOCK_SEARCH_MCP_URL', 'https://evil.example/coverr/mcp')
    expect(() => new StockSearchServer()).toThrow('trusted search endpoint')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it.each(['http://localhost:3456/coverr/mcp', 'https://127.0.0.1:3456/coverr/mcp', 'http://[::1]:3456/coverr/mcp'])('allows loopback endpoint %s without cloud credentials', async endpoint => {
    const local = await connect(endpoint)
    mockRemote()
    expect((await local.callTool({ name: 'search_videos', arguments: { query: 'nature' } })).isError).not.toBe(true)
    for (const [url, init] of mockFetch.mock.calls) {
      expect(url).toBe(endpoint)
      expect(new Headers(init.headers).has('authorization')).toBe(false)
    }
    expect(mockEnsureToken).not.toHaveBeenCalled()
    expect(mockStoreGet).not.toHaveBeenCalled()
    assertClosed()
  })

  it('uses the local environment override without authenticating', async () => {
    vi.stubEnv('STOCK_SEARCH_MCP_URL', 'http://localhost:3456/coverr/mcp')
    const local = await connect()
    mockRemote()
    expect((await local.callTool({ name: 'search_audios', arguments: { query: 'calm' } })).isError).not.toBe(true)
    expect(mockFetch.mock.calls.every(([url]) => url === 'http://localhost:3456/coverr/mcp')).toBe(true)
    expect(mockEnsureToken).not.toHaveBeenCalled()
  })

  it('does not follow remote redirects or expose their body', async () => {
    mockFetch.mockResolvedValue(new Response('coverr secret redirect', { status: 302, headers: { location: 'https://evil.example/coverr/mcp' } }))
    assertFailure(await client.callTool({ name: 'search_videos', arguments: { query: 'nature' } }))
    expect(mockFetch).toHaveBeenCalledOnce()
    expect(mockFetch.mock.calls[0][0]).toBe(CLOUD)
    expect(mockFetch.mock.calls[0][1].redirect).toBe('error')
    assertClosed()
  })
})
