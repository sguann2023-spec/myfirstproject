import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
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

import FigureSearchServer from '../figure-search'

const CLOUD = 'https://open.vectcut.com/stickman/mcp'
const PROTOCOL = '2025-03-26'
const SEARCH = { name: 'search_images', arguments: { query: 'walking figure' } }
const SECRET = 'upstream secret Bearer private-token'
const image = {
  id: 'figure-1', score: 0.92, url: 'https://cdn.example/figure.png?signature=a%2Bb&expires=123', category: 'walking',
  filename: '/internal/figure.png', source: SECRET
}
const rawData = { query: SEARCH.arguments.query, results: [image], provider: 'stickman',
  meta: { service: 'stickman', topk: 10, collection: 'private-collection', color: null, count: 1 } }
type RpcRequest = {
  jsonrpc: string; id?: number; method: string
  params: { name?: string; arguments?: Record<string, unknown>; protocolVersion?: string }
}

function jsonResponse(message: unknown): Response {
  return new Response(JSON.stringify(message), { headers: { 'content-type': 'application/json' } })
}

function mockRemote(options: {
  raw?: unknown; toolResult?: Record<string, unknown>; reply?: (message: RpcRequest) => Response | undefined
} = {}) {
  const requests: RpcRequest[] = []
  mockFetch.mockImplementation(async (_url: string, init: RequestInit) => {
    const message = JSON.parse(String(init.body)) as RpcRequest
    requests.push(message)
    const overridden = options.reply?.(message)
    if (overridden) return overridden
    if (message.method === 'initialize') return jsonResponse({ jsonrpc: '2.0', id: message.id, result: {
      protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: 'stickman-search', version: '1.0.0' }
    } })
    if (message.method === 'notifications/initialized') return new Response(null, { status: 202 })
    if (message.method === 'tools/call') return jsonResponse({ jsonrpc: '2.0', id: message.id,
      result: options.toolResult ?? { content: [], structuredContent: options.raw ?? rawData } })
    throw new Error(`Unexpected MCP method: ${message.method}`)
  })
  return requests
}

function assertFailure(result: unknown, paid = true) {
  expect(result).toEqual({ content: [{ type: 'text', text:
    'Figure search is unavailable. Check parameters, login, resource balance and service deployment.' + (paid
      ? ' This operation may consume credits and was not automatically retried. Confirm its outcome before attempting another search.' : '')
  }], isError: true })
  expect(JSON.stringify(result)).not.toMatch(/upstream|secret|Bearer|private-token|filename|\bsource\b|provider|collection/)
}

describe('FigureSearchServer with a real in-memory MCP SDK client', () => {
  let client: Client
  let unexpectedFetch: ReturnType<typeof vi.fn>
  const connections: Array<{ client: Client; server: FigureSearchServer }> = []

  async function connect(endpoint?: string) {
    const server = new FigureSearchServer(endpoint)
    const connected = new Client({ name: 'figure-search-test', version: '1.0.0' })
    connections.push({ client: connected, server })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.mcpServer.connect(serverTransport)
    await connected.connect(clientTransport)
    return connected
  }

  beforeEach(async () => {
    mockFetch.mockReset().mockRejectedValue(new Error('Unconfigured net.fetch'))
    mockEnsureToken.mockReset().mockResolvedValue('login-token')
    mockStoreGet.mockReset()
    vi.stubEnv('FIGURE_SEARCH_MCP_URL', '')
    vi.stubEnv('VECTCUT_API_KEY', '')
    vi.stubEnv('VECTCUT_APIKEY', '')
    unexpectedFetch = vi.fn().mockRejectedValue(new Error('Real networking is forbidden'))
    vi.stubGlobal('fetch', unexpectedFetch)
    client = await connect()
  })

  afterEach(async () => {
    try {
      for (const connection of connections.splice(0)) {
        await connection.client.close()
        await connection.server.mcpServer.close()
      }
      expect(unexpectedFetch).not.toHaveBeenCalled()
    } finally {
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
    }
  })

  it('lists only the paid search tool with query/topk and no auth or networking', async () => {
    const { tools } = await client.listTools()
    expect(tools).toHaveLength(1)
    expect(tools[0]).toMatchObject({ name: 'search_images', title: '\u706b\u67f4\u4eba\u7d20\u6750\u641c\u7d22',
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      inputSchema: { type: 'object', required: ['query'], additionalProperties: false, properties: {
        query: { type: 'string', minLength: 1, maxLength: 2000 },
        topk: { type: 'integer', minimum: 1, maximum: 50, default: 10 }
      } } })
    expect(Object.keys(tools[0].inputSchema.properties!)).toEqual(['query', 'topk'])
    expect(tools[0].description).toContain('successful search consumes 1 resource unit')
    expect(tools[0].description).toContain('Never automatically retry')
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockEnsureToken).not.toHaveBeenCalled()
  })

  it('rejects unsupported parameters, invalid ranges and non-whitelisted tools before networking', async () => {
    const invalid = [
      {}, { query: ' ' }, { query: 42 }, { query: 'x'.repeat(2001) },
      ...[0, 51, 1.5, '10', null, true].map(topk => ({ query: 'x', topk })),
      ...['license', 'license_key', 'collection', 'color', 'endpoint', 'constructor', 'toString']
        .map(key => JSON.parse(`{"query":"x","${key}":"unexpected"}`))
    ]
    for (const args of invalid) assertFailure(await client.callTool({ name: 'search_images', arguments: args }))
    for (const name of ['search_stickman', 'get_image', 'recolor', 'upload']) {
      assertFailure(await client.callTool({ name, arguments: { query: 'x' } }), false)
    }
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockEnsureToken).not.toHaveBeenCalled()
  })

  it('maps only search_stickman, trims query, applies default and accepts inclusive topk and Unicode limits', async () => {
    const requests = mockRemote()
    for (const [args, expected] of [
      [{ query: ' walking figure ' }, { query: 'walking figure', topk: 10 }],
      [{ query: 'x', topk: 1 }, { query: 'x', topk: 1 }],
      [{ query: '\u{1f6b6}'.repeat(2000), topk: 50 }, { query: '\u{1f6b6}'.repeat(2000), topk: 50 }]
    ]) {
      expect((await client.callTool({ name: 'search_images', arguments: args })).isError).not.toBe(true)
      expect(requests.at(-1)?.params).toEqual({ name: 'search_stickman', arguments: expected })
    }
    expect(requests.filter(message => message.method === 'tools/call')).toHaveLength(3)
  })

  it('uses exact stateless negotiation, trusted headers and a 195000 ms timeout with one paid call', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    const requests = mockRemote()
    expect((await client.callTool(SEARCH)).isError).not.toBe(true)
    expect(timeout).toHaveBeenCalledWith(195_000)
    expect(requests).toEqual([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {
        protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'figure-search', version: '1.0.0' }
      } },
      { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: {
        name: 'search_stickman', arguments: { query: SEARCH.arguments.query, topk: 10 }
      } }
    ])
    for (const [url, init] of mockFetch.mock.calls) {
      expect(url).toBe(CLOUD)
      expect(init).toMatchObject({ method: 'POST', redirect: 'error', signal: expect.any(AbortSignal) })
      expect(Object.fromEntries(new Headers(init.headers))).toEqual({
        accept: 'application/json', authorization: 'Bearer login-token',
        'content-type': 'application/json', 'mcp-protocol-version': PROTOCOL
      })
    }
  })

  it.each(['401', 'http', 'network', 'timeout', 'rpc', 'tool', 'text', 'schema'])
    ('sends the paid tools/call once on %s failure and sanitizes diagnostics', async failure => {
      const requests = mockRemote({ reply: message => {
        if (message.method !== 'tools/call') return undefined
        if (failure === 'network') throw new Error(SECRET)
        if (failure === 'timeout') throw new DOMException(SECRET, 'TimeoutError')
        if (failure === '401' || failure === 'http') return new Response(SECRET, { status: failure === '401' ? 401 : 503 })
        return jsonResponse({ jsonrpc: '2.0', id: message.id,
          ...(failure === 'rpc' ? { error: { code: -32603, message: SECRET } } : { result:
            failure === 'tool' ? { content: [{ type: 'text', text: SECRET }], isError: true }
              : { content: [{ type: failure === 'schema' ? 'unknown' : 'text', text: SECRET }] } }) })
      } })
      assertFailure(await client.callTool(SEARCH))
      expect(requests.map(message => message.method)).toEqual(['initialize', 'notifications/initialized', 'tools/call'])
      expect(mockFetch).toHaveBeenCalledTimes(3)
      expect(mockEnsureToken.mock.calls).toEqual([[undefined], [undefined], []])
      expect(mockEnsureToken.mock.calls.some(([force]) => force === true)).toBe(false)
    })

  it('refreshes initialization only and still sends the paid call exactly once', async () => {
    mockEnsureToken.mockImplementation(async force => force ? 'refreshed-token' : 'login-token')
    let rejected = false
    const requests = mockRemote({ reply: message => {
      if (message.method !== 'initialize' || rejected) return undefined
      rejected = true
      return new Response(SECRET, { status: 401 })
    } })
    expect((await client.callTool(SEARCH)).isError).not.toBe(true)
    expect(requests.map(message => message.method)).toEqual(['initialize', 'initialize', 'notifications/initialized', 'tools/call'])
    expect(mockEnsureToken.mock.calls.filter(([force]) => force === true)).toEqual([[true]])
  })

  it('uses stored credentials without retrying a paid 401 and fails closed without credentials', async () => {
    mockEnsureToken.mockRejectedValue(new Error(SECRET))
    mockStoreGet.mockImplementation(key => key === 'auth.vectcut_api_key' ? ' stored-key ' : undefined)
    const requests = mockRemote({ reply: message => message.method === 'tools/call' ? new Response(SECRET, { status: 401 }) : undefined })
    assertFailure(await client.callTool(SEARCH))
    expect(requests.filter(message => message.method === 'tools/call')).toHaveLength(1)
    for (const [, init] of mockFetch.mock.calls) expect(new Headers(init.headers).get('authorization')).toBe('Bearer stored-key')
    mockStoreGet.mockReset()
    mockFetch.mockClear()
    assertFailure(await client.callTool(SEARCH))
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it.each(['structured', 'text'])('projects %s results to id/score/url/category and preserves signed URLs', async format => {
    const raw = { ...rawData, query: SECRET, results: [image, { ...image, id: 'figure-2', score: null, category: null }] }
    mockRemote({ toolResult: format === 'structured' ? { content: [{ type: 'text', text: SECRET }], structuredContent: raw }
      : { content: [{ type: 'text', text: JSON.stringify(raw) }] } })
    const result = await client.callTool(SEARCH)
    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toEqual({ title: '\u706b\u67f4\u4eba\u7d20\u6750\u641c\u7d22', mediaType: 'image',
      query: SEARCH.arguments.query, results: [
        { id: image.id, score: image.score, url: image.url, category: image.category },
        { id: 'figure-2', score: null, url: image.url, category: null }
      ] })
    const content = (result.content as CallToolResult['content'])[0]
    expect(content.type).toBe('text')
    if (content.type === 'text') expect(JSON.parse(content.text)).toEqual(result.structuredContent)
    expect(JSON.stringify(result)).not.toMatch(/meta|filename|source|provider|collection|secret/)
    expect(mockFetch.mock.calls.every(([url]) => url === CLOUD)).toBe(true)
  })

  it('accepts empty and 50-item results, rejects malformed/over-limit projections without retry', async () => {
    for (const results of [[], Array(50).fill(image)]) {
      mockRemote({ raw: { results } })
      expect((await client.callTool({ name: 'search_images', arguments: { query: 'x', topk: 50 } })).isError).not.toBe(true)
    }
    for (const raw of [{}, { results: [null] }, { results: Array(11).fill(image) },
      ...[{ id: '' }, { score: '0.9' }, { url: 'data:image/png;base64,AAAA' },
        { url: 'https://user:secret@cdn.example/image' }].map(fields => ({ results: [{ ...image, ...fields }] }))]) {
      const requests = mockRemote({ raw })
      assertFailure(await client.callTool(SEARCH))
      expect(requests.filter(message => message.method === 'tools/call')).toHaveLength(1)
    }
  })

  it.each(['version', 'id', 'notification'])('stops before the paid call on invalid initialization %s', async failure => {
    const requests = mockRemote({ reply: message => {
      if (failure === 'notification') return message.method === 'notifications/initialized' ? new Response(null, { status: 200 }) : undefined
      if (message.method !== 'initialize') return undefined
      return jsonResponse({ jsonrpc: '2.0', id: failure === 'id' ? 99 : message.id,
        result: { protocolVersion: failure === 'version' ? 'unsupported' : PROTOCOL } })
    } })
    assertFailure(await client.callTool(SEARCH))
    expect(requests.filter(message => message.method === 'tools/call')).toHaveLength(0)
  })

  it('rejects untrusted endpoints and unsafe environment overrides without networking', () => {
    for (const endpoint of ['https://evil.example/stickman/mcp', 'http://open.vectcut.com/stickman/mcp',
      'https://open.vectcut.com.evil.example/stickman/mcp', `${CLOUD}?key=secret`, `${CLOUD}#fragment`,
      'https://user:secret@open.vectcut.com/stickman/mcp', 'https://open.vectcut.com/other',
      'http://localhost:3456/stickman/search', 'http://localhost.evil.example/stickman/mcp']) {
      expect(() => new FigureSearchServer(endpoint)).toThrow('trusted endpoint')
    }
    vi.stubEnv('FIGURE_SEARCH_MCP_URL', 'https://evil.example/stickman/mcp')
    expect(() => new FigureSearchServer()).toThrow('trusted endpoint')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it.each(['http://localhost:3456/stickman/mcp', 'https://127.0.0.1:3456/stickman/mcp', 'http://[::1]:3456/stickman/mcp'])
    ('isolates local endpoint %s from credentials', async endpoint => {
      vi.stubEnv('FIGURE_SEARCH_MCP_URL', endpoint)
      vi.stubEnv('VECTCUT_API_KEY', 'environment-secret')
      mockStoreGet.mockReturnValue('store-secret')
      const local = await connect()
      const requests = mockRemote()
      expect((await local.callTool(SEARCH)).isError).not.toBe(true)
      expect(requests.filter(message => message.method === 'tools/call')).toHaveLength(1)
      for (const [url, init] of mockFetch.mock.calls) {
        expect(url).toBe(endpoint)
        expect(new Headers(init.headers).has('authorization')).toBe(false)
      }
      expect(mockEnsureToken).not.toHaveBeenCalled()
      expect(mockStoreGet).not.toHaveBeenCalled()
    })

  it('does not cache results or credentials across accounts', async () => {
    const requests = mockRemote()
    await client.callTool(SEARCH)
    mockEnsureToken.mockResolvedValue('second-account')
    await client.callTool(SEARCH)
    expect(requests.filter(message => message.method === 'tools/call')).toHaveLength(2)
    expect(mockFetch.mock.calls.slice(-3).map(([, init]) => new Headers(init.headers).get('authorization')))
      .toEqual(Array(3).fill('Bearer second-account'))
  })
})
