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

import FootageSearchServer from '../footage-search'

const CLOUD = 'https://open.vectcut.com/pexels/mcp'
const PROTOCOL = '2025-03-26'
const MAX_BYTES = 4 * 1024 * 1024
const SECRET = 'pexels upstream secret Bearer private-token'
const SEARCH = { name: 'search_images', arguments: { query: 'nature' } }
const photo = {
  id: 101, width: 1920, height: 1080, alt: 'Forest', avg_color: '#123456',
  url: 'https://www.pexels.com/photo/101/?utm_source=vectcut',
  src: {
    original: 'https://images.pexels.com/photos/101/original.jpeg?signature=a%2Bb&token=c%3Dd',
    large: 'https://images.pexels.com/photos/101/large.jpeg?auto=compress&cs=tinysrgb&w=1920'
  },
  photographer: 'Pexels Creator', photographer_id: 7,
  photographer_url: 'https://www.pexels.com/@creator/?utm_source=vectcut'
}
const video = {
  id: 202, width: 3840, height: 2160, duration: 12.5,
  url: 'https://www.pexels.com/video/202/?utm_source=vectcut',
  image: 'https://images.pexels.com/videos/202/preview.jpeg?signature=a%2Bb',
  video_files: [{ id: 9, width: 3840, height: 2160, fps: 29.97, file_size: 123456,
    quality: 'hd', file_type: 'video/mp4', link: 'https://videos.pexels.com/202/video.mp4?signature=a%2Bb&expires=123' }],
  video_pictures: [{ id: 10, nr: 0, picture: 'https://images.pexels.com/videos/202/frame.jpeg?token=a%2Bb' }],
  user: { id: 7, name: 'Pexels Creator', url: photo.photographer_url }
}
const credit = (asset: typeof photo | typeof video) => ({
  media_id: asset.id, media_url: asset.url, creator: photo.photographer,
  creator_url: photo.photographer_url, pexels_url: asset.url
})
const projectedCredit = (asset: typeof photo | typeof video) => ({
  media_id: asset.id, media_url: asset.url, creator: photo.photographer,
  creator_url: photo.photographer_url, source_url: asset.url
})
const operations = [
  { name: 'search_images', upstream: 'search_photos', args: { query: 'nature' }, asset: photo, title: '\u56fe\u7247\u641c\u7d22' },
  { name: 'get_image', upstream: 'get_photo', args: { photo_id: photo.id }, asset: photo, title: '\u56fe\u7247\u8be6\u60c5' },
  { name: 'search_videos', upstream: 'search_videos', args: { query: 'nature' }, asset: video, title: '\u89c6\u9891\u641c\u7d22' },
  { name: 'get_video', upstream: 'get_video', args: { video_id: video.id }, asset: video, title: '\u89c6\u9891\u8be6\u60c5' }
]
const searchData = { response: { photos: [photo], page: 1, per_page: 15, total_results: 1,
  next_page: 'https://api.pexels.com/v1/search?query=nature&page=2&per_page=15' }, attribution: [credit(photo)] }
type RpcRequest = {
  jsonrpc: string; id?: number; method: string
  params: { name?: string; arguments?: Record<string, unknown>; protocolVersion?: string }
}

function jsonResponse(message: unknown): Response {
  return new Response(JSON.stringify(message), { headers: { 'content-type': 'application/json; charset=utf-8' } })
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
      protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: 'pexels-fixture', version: '1.0.0' }
    } })
    if (message.method === 'notifications/initialized') return new Response(null, { status: 202 })
    if (message.method === 'tools/call') {
      const name = message.params.name!
      const asset = name.includes('video') ? video : photo
      const raw = options.raw ?? (name === 'search_photos' ? searchData : {
        response: name.startsWith('search_') ? { videos: [asset], page: 1, per_page: 15, total_results: 1 } : asset,
        attribution: [credit(asset)]
      })
      return jsonResponse({ jsonrpc: '2.0', id: message.id, result: options.toolResult ?? { content: [], structuredContent: raw } })
    }
    throw new Error(`Unexpected MCP request: ${message.method}`)
  })
  return requests
}

function assertFailure(result: unknown) {
  expect(result).toEqual({ content: [{ type: 'text', text:
    'Media search is unavailable. Check parameters, login and service deployment, or try again later.' }], isError: true })
  expect(JSON.stringify(result)).not.toMatch(/pexels|upstream|secret|Bearer|private-token|rawOutput|base64|provider/i)
}

describe('FootageSearchServer with a real in-memory MCP SDK client', () => {
  let client: Client
  let unexpectedFetch: ReturnType<typeof vi.fn>
  const connections: Array<{ client: Client; server: FootageSearchServer }> = []

  async function connect(endpoint?: string) {
    const server = new FootageSearchServer(endpoint)
    const connected = new Client({ name: 'footage-search-test', version: '1.0.0' })
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
    vi.stubEnv('FOOTAGE_SEARCH_MCP_URL', '')
    vi.stubEnv('VECTCUT_API_KEY', '')
    vi.stubEnv('VECTCUT_APIKEY', '')
    // Fail closed if a dependency bypasses the Electron network boundary.
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

  it('lists exactly four generic read-only tools and restricted schemas without auth or network', async () => {
    const { tools } = await client.listTools()
    expect(tools.map(tool => tool.name)).toEqual(operations.map(operation => operation.name))
    expect(tools.map(tool => tool.title)).toEqual(operations.map(operation => operation.title))
    for (const tool of tools) {
      expect(tool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true })
      expect(tool.inputSchema.additionalProperties).toBe(false)
      expect(tool.description).toContain('Honor explicit AI generation requests')
      expect(tool.description).toContain('no automatic download or timeline insertion')
      expect(tool.description).toContain('show the returned source link prominently and credit creators')
    }
    for (const tool of [tools[0], tools[2]]) {
      expect(tool.inputSchema.required).toEqual(['query'])
      expect(tool.inputSchema.properties).toMatchObject({ query: { minLength: 1, maxLength: 500 },
        page: { minimum: 1, maximum: 10000, default: 1 }, per_page: { minimum: 1, maximum: 80, default: 15 },
        orientation: { enum: ['landscape', 'portrait', 'square'] }, size: { enum: ['large', 'medium', 'small'] },
        locale: { enum: expect.arrayContaining(['en-US', 'zh-CN', 'zh-TW', 'pt-BR']) } })
    }
    expect(tools[0].inputSchema.properties).toHaveProperty('color')
    expect(tools[2].inputSchema.properties).not.toHaveProperty('color')
    for (const [index, key] of [[1, 'photo_id'], [3, 'video_id']] as const) {
      expect(tools[index].inputSchema.required).toEqual([key])
      expect(tools[index].inputSchema.properties).toEqual({ [key]: expect.objectContaining({
        type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER
      }) })
    }
    expect(JSON.stringify(tools)).not.toMatch(/pexels|pexel|vectcut|provider|api.?key/i)
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockEnsureToken).not.toHaveBeenCalled()
    expect(mockStoreGet).not.toHaveBeenCalled()
  })

  it.each(operations)('maps only $name to $upstream with validated arguments', async operation => {
    const requests = mockRemote()
    expect((await client.callTool({ name: operation.name, arguments: operation.args })).isError).not.toBe(true)
    expect(requests[requests.length - 1]?.params).toEqual({ name: operation.upstream, arguments: {
      ...operation.args, ...(operation.name.startsWith('search_') ? { page: 1, per_page: 15 } : {})
    } })
    expect(requests.filter(message => message.method === 'tools/call')).toHaveLength(1)
  })

  it('rejects every invalid parameter family and unknown tool before auth/network', async () => {
    const invalidSearch = [
      {}, { query: ' ' }, { query: 42 }, { query: 'x'.repeat(501) }, { query: '\u{1f332}'.repeat(501) },
      ...[0, 10001, 1.5, '1', null, true].map(page => ({ query: 'x', page })),
      ...[0, 81, 1.5, '15', null, false].map(per_page => ({ query: 'x', per_page })),
      ...['orientation', 'size', 'locale'].map(key => ({ query: 'x', [key]: 'unsupported' })),
      ...['endpoint', 'api_key', 'provider', 'constructor', 'toString']
        .map(key => JSON.parse(`{"query":"x","${key}":"unexpected"}`))
    ]
    for (const name of ['search_images', 'search_videos']) {
      for (const args of invalidSearch) assertFailure(await client.callTool({ name, arguments: args }))
    }
    for (const color of ['teal', '#fff', '#12345g', 42, null]) {
      assertFailure(await client.callTool({ name: 'search_images', arguments: { query: 'x', color } }))
    }
    assertFailure(await client.callTool({ name: 'search_videos', arguments: { query: 'x', color: 'red' } }))
    for (const [name, key] of [['get_image', 'photo_id'], ['get_video', 'video_id']]) {
      for (const args of [{}, ...[0, -1, 1.5, '101', null, true, Number.MAX_SAFE_INTEGER + 1].map(id => ({ [key]: id })),
        { [key]: 1, query: 'x' }, { [key === 'photo_id' ? 'video_id' : 'photo_id']: 1 }]) {
        assertFailure(await client.callTool({ name, arguments: args }))
      }
    }
    for (const name of ['search_photos', 'get_photo', 'track_download', 'download_video', 'insert_timeline', '__proto__', 'constructor']) {
      assertFailure(await client.callTool({ name, arguments: { query: 'x' } }))
    }
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockEnsureToken).not.toHaveBeenCalled()
    expect(mockStoreGet).not.toHaveBeenCalled()
  })

  it('does not forward prototype pollution fields normalized away by the real SDK', async () => {
    const requests = mockRemote()
    for (const name of ['search_images', 'search_videos']) {
      const args = JSON.parse('{"query":"nature","__proto__":{"footagePolluted":true}}')
      expect((await client.callTool({ name, arguments: args })).isError).not.toBe(true)
      expect(requests[requests.length - 1]?.params.arguments).toEqual({ query: 'nature', page: 1, per_page: 15 })
      expect(Object.prototype).not.toHaveProperty('footagePolluted')
    }
  })

  it('trims strings, counts Unicode code points and accepts inclusive search/ID limits and all schema filters', async () => {
    const requests = mockRemote()
    for (const name of ['search_images', 'search_videos']) {
      for (const [args, expected] of [
        [{ query: ' nature ' }, { query: 'nature', page: 1, per_page: 15 }],
        [{ query: 'x', page: 1, per_page: 1 }, { query: 'x', page: 1, per_page: 1 }],
        [{ query: ` ${'\u{1f332}'.repeat(500)} `, page: 10000, per_page: 80, orientation: ' landscape ', size: ' large ', locale: ' zh-CN ' },
          { query: '\u{1f332}'.repeat(500), page: 10000, per_page: 80, orientation: 'landscape', size: 'large', locale: 'zh-CN' }]
      ]) {
        expect((await client.callTool({ name, arguments: args })).isError).not.toBe(true)
        expect(requests[requests.length - 1]?.params.arguments).toEqual(expected)
      }
    }
    const { tools } = await client.listTools()
    for (const key of ['orientation', 'size', 'locale']) {
      const schema = tools[0].inputSchema.properties![key] as { enum: string[] }
      for (const value of schema.enum) {
        expect((await client.callTool({ name: 'search_images', arguments: { query: 'x', [key]: ` ${value} ` } })).isError).not.toBe(true)
        expect(requests[requests.length - 1]?.params.arguments?.[key]).toBe(value)
      }
    }
    for (const color of ['red', 'orange', 'yellow', 'green', 'turquoise', 'blue', 'violet', 'pink', 'brown', 'black', 'gray', 'white', '#aB12Cd']) {
      expect((await client.callTool({ name: 'search_images', arguments: { query: 'x', color: ` ${color} ` } })).isError).not.toBe(true)
      expect(requests[requests.length - 1]?.params.arguments?.color).toBe(color)
    }
    for (const operation of operations.filter(item => item.name.startsWith('get_'))) {
      for (const id of [1, Number.MAX_SAFE_INTEGER]) {
        const args = { [operation.name === 'get_image' ? 'photo_id' : 'video_id']: id }
        expect((await client.callTool({ name: operation.name, arguments: args })).isError).not.toBe(true)
        expect(requests[requests.length - 1]?.params.arguments).toEqual(args)
      }
    }
  })

  it('negotiates exact stateless JSON-RPC and trusted headers for each operation with no media fetch', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    const requests = mockRemote()
    for (const operation of operations) await client.callTool({ name: operation.name, arguments: operation.args })
    expect(timeout).toHaveBeenCalledWith(65_000)
    expect(requests.map(message => message.method)).toEqual(Array(4).fill(['initialize', 'notifications/initialized', 'tools/call']).flat())
    for (let offset = 0; offset < requests.length; offset += 3) {
      expect(requests[offset]).toEqual({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
        protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'footage-search', version: '1.0.0' }
      } })
      expect(requests[offset + 1]).toEqual({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })
      expect(requests[offset + 2]).toMatchObject({ jsonrpc: '2.0', id: 2 })
    }
    for (const [url, init] of mockFetch.mock.calls) {
      expect(url).toBe(CLOUD)
      expect(init).toMatchObject({ method: 'POST', redirect: 'error', signal: expect.any(AbortSignal) })
      expect(Object.fromEntries(new Headers(init.headers))).toEqual({
        accept: 'application/json', authorization: 'Bearer login-token',
        'content-type': 'application/json', 'mcp-protocol-version': PROTOCOL
      })
    }
  })

  it.each(['initialize', 'notifications/initialized', 'tools/call'])('refreshes Bearer on %s 401 and retries only the identical body', async method => {
    let rejected = false
    let refreshed = false
    mockEnsureToken.mockImplementation(async force => {
      if (force) refreshed = true
      return refreshed ? 'refreshed-token' : 'expired-token'
    })
    mockRemote({ reply: message => {
      if (message.method !== method || rejected) return undefined
      rejected = true
      return new Response(SECRET, { status: 401 })
    } })
    expect((await client.callTool(SEARCH)).isError).not.toBe(true)
    const attempts = mockFetch.mock.calls.filter(([, init]) => JSON.parse(init.body).method === method)
    expect(attempts).toHaveLength(2)
    expect(attempts[0][1].body).toBe(attempts[1][1].body)
    expect(attempts.map(([, init]) => new Headers(init.headers).get('authorization')))
      .toEqual(['Bearer expired-token', 'Bearer refreshed-token'])
    expect(mockEnsureToken.mock.calls.filter(([force]) => force === true)).toEqual([[true]])
  })

  it('bounds repeated 401 and uses a distinct stored fallback without unlimited retry', async () => {
    mockEnsureToken.mockImplementation(async force => force ? 'refreshed-token' : 'expired-token')
    mockFetch.mockImplementation(async () => new Response(SECRET, { status: 401 }))
    assertFailure(await client.callTool(SEARCH))
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(mockEnsureToken.mock.calls).toEqual([[undefined], [true]])
    mockFetch.mockClear()
    mockStoreGet.mockImplementation(key => key === 'auth.vectcut_api_key' ? ' stored-key ' : undefined)
    assertFailure(await client.callTool(SEARCH))
    expect(mockFetch.mock.calls.map(([, init]) => new Headers(init.headers).get('authorization')))
      .toEqual(['Bearer expired-token', 'Bearer refreshed-token', 'Bearer stored-key'])
    mockFetch.mockClear()
    mockEnsureToken.mockResolvedValue('stored-key')
    assertFailure(await client.callTool(SEARCH))
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('falls back to stored credentials, fails closed after logout and never caches across accounts', async () => {
    mockEnsureToken.mockRejectedValue(new Error(SECRET))
    mockStoreGet.mockImplementation(key => key === 'auth.vectcut_api_key' ? ' stored-key ' : undefined)
    const requests = mockRemote()
    expect((await client.callTool(SEARCH)).isError).not.toBe(true)
    expect(mockFetch.mock.calls.map(([, init]) => new Headers(init.headers).get('authorization'))).toEqual(Array(3).fill('Bearer stored-key'))
    mockStoreGet.mockReset()
    const fetchCount = mockFetch.mock.calls.length
    assertFailure(await client.callTool(SEARCH))
    expect(mockFetch).toHaveBeenCalledTimes(fetchCount)
    mockEnsureToken.mockResolvedValue('second-account-token')
    expect((await client.callTool(SEARCH)).isError).not.toBe(true)
    expect(requests.filter(message => message.method === 'tools/call')).toHaveLength(2)
    expect(mockFetch.mock.calls.slice(-3).map(([, init]) => new Headers(init.headers).get('authorization')))
      .toEqual(Array(3).fill('Bearer second-account-token'))
  })

  it.each(operations)('preserves $name URLs, previews and credits while stripping raw/provider fields in both result formats', async operation => {
    const asset = { ...operation.asset, provider: 'pexels', rawOutput: SECRET, download: SECRET }
    const response = operation.name.startsWith('search_') ? {
      [operation.name === 'search_images' ? 'photos' : 'videos']: [asset],
      page: 1, per_page: 15, total_results: 1, next_page: searchData.response.next_page, provider: 'pexels', rawOutput: SECRET
    } : asset
    const raw = { response, attribution: [{ ...credit(operation.asset), provider: 'pexels', secret: SECRET }],
      provider: 'pexels', pexels_api_key: SECRET, rawOutput: SECRET }
    for (const format of ['structured', 'text']) {
      mockRemote({ toolResult: format === 'structured'
        ? { content: [{ type: 'text', text: SECRET }, { type: 'image', data: 'AAAA', mimeType: 'image/png' }], structuredContent: raw }
        : { content: [{ type: 'text', text: JSON.stringify(raw) }] } })
      const result = await client.callTool({ name: operation.name, arguments: operation.args })
      expect(result.isError).not.toBe(true)
      expect(result.structuredContent).toEqual({ title: operation.title,
        mediaType: operation.name.includes('video') ? 'video' : 'image', attribution_required: true,
        usage: expect.stringContaining('Preserve original media URLs and query parameters'),
        ...(operation.name.startsWith('search_') ? { results: [operation.asset], page: 1, per_page: 15,
          total_results: 1, has_next_page: true, has_prev_page: false }
          : { [operation.name === 'get_image' ? 'photo' : 'video']: operation.asset }),
        attribution: [projectedCredit(operation.asset)] })
      const content = result.content as CallToolResult['content']
      expect(content).toHaveLength(1)
      expect(content[0].type).toBe('text')
      if (content[0].type === 'text') expect(JSON.parse(content[0].text)).toEqual(result.structuredContent)
      expect(JSON.stringify(result)).not.toMatch(/provider|rawOutput|secret|api_key|base64|"pexels_url"/)
      expect(JSON.stringify(result)).toContain('Pexels Creator')
      expect(mockFetch.mock.calls.every(([url]) => url === CLOUD)).toBe(true)
    }
  })

  it('drops unsafe references and nested fields, bounds text, and preserves safe URL query bytes', async () => {
    const unsafe = ['data:image/png;base64,AAAA', 'javascript:alert(1)', 'https://user:secret@cdn.example/media',
      `https://cdn.example/${'x'.repeat(4096)}`, 'not-a-url']
    for (const url of unsafe) {
      mockRemote({ raw: { response: { ...photo, alt: 'a'.repeat(2049), photographer: 'p'.repeat(257),
        width: -1, height: '1080', src: { ...photo.src, tiny: url, extra: SECRET },
        photographer_url: url, internal: SECRET }, attribution: [{ ...credit(photo), creator_url: url, rawOutput: SECRET }] } })
      const result = await client.callTool({ name: 'get_image', arguments: { photo_id: 101 } })
      expect(result.isError).not.toBe(true)
      expect(result.structuredContent).toMatchObject({ photo: {
        src: photo.src, alt: 'a'.repeat(2048), photographer: 'p'.repeat(256)
      } })
      const projected = (result.structuredContent as { photo: Record<string, unknown> }).photo
      expect(projected).not.toHaveProperty('width')
      expect(projected).not.toHaveProperty('height')
      expect(projected).not.toHaveProperty('photographer_url')
      expect(JSON.stringify(result)).not.toMatch(/secret|base64|javascript:|internal|rawOutput/)
    }
    mockRemote({ raw: { response: { ...video, video_files: [{ ...video.video_files[0], secret: SECRET },
      ...unsafe.map(link => ({ link }))], user: { ...video.user, email: SECRET },
      video_pictures: [...video.video_pictures, null, ...unsafe.map(picture => ({ picture }))] }, attribution: [credit(video)] } })
    expect((await client.callTool({ name: 'get_video', arguments: { video_id: 202 } })).structuredContent)
      .toMatchObject({ video })
  })

  it.each(['version', 'rpc-version', 'id', 'error', 'missing-result', 'notification-status'])('stops on invalid initialization contract: %s', async failure => {
    const requests = mockRemote({ reply: message => {
      if (failure === 'notification-status') return message.method === 'notifications/initialized' ? new Response(null, { status: 200 }) : undefined
      if (message.method !== 'initialize') return undefined
      return jsonResponse({ jsonrpc: failure === 'rpc-version' ? '1.0' : '2.0', id: failure === 'id' ? 99 : message.id,
        ...(failure === 'missing-result' ? {} : { result: { protocolVersion: failure === 'version' ? 'unsupported' : PROTOCOL } }),
        ...(failure === 'error' ? { error: { code: -32603, message: SECRET } } : {}) })
    } })
    assertFailure(await client.callTool(SEARCH))
    expect(requests.map(message => message.method)).toEqual(failure === 'notification-status' ? ['initialize', 'notifications/initialized'] : ['initialize'])
  })

  it.each(['http', 'network', 'timeout', 'rpc', 'rpc-version', 'id', 'missing-result', 'tool', 'invalid-json', 'text', 'schema'])
    ('sanitizes malicious %s failures without retrying non-401 errors', async failure => {
      const requests = mockRemote({ reply: message => {
        if (message.method !== 'tools/call') return undefined
        if (failure === 'network') throw new Error(SECRET)
        if (failure === 'timeout') throw new DOMException(SECRET, 'TimeoutError')
        if (failure === 'http') return new Response(SECRET, { status: 503 })
        if (failure === 'invalid-json') return new Response(SECRET, { headers: { 'content-type': 'application/json' } })
        return jsonResponse({ jsonrpc: failure === 'rpc-version' ? '1.0' : '2.0', id: failure === 'id' ? 99 : message.id,
          ...(failure === 'missing-result' ? {} : failure === 'rpc' ? { error: { code: -32603, message: SECRET, data: { rawOutput: SECRET } } }
            : { result: failure === 'tool' ? { content: [{ type: 'text', text: SECRET }], isError: true }
              : { content: [{ type: failure === 'schema' ? 'unknown' : 'text', text: SECRET }] } }) })
      } })
      assertFailure(await client.callTool(SEARCH))
      expect(requests.map(message => message.method)).toEqual(['initialize', 'notifications/initialized', 'tools/call'])
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })

  it('accepts empty and 80-item searches with matching credits and rejects malformed or excessive results', async () => {
    for (const operation of operations.filter(item => item.name.startsWith('search_'))) {
      const key = operation.name === 'search_images' ? 'photos' : 'videos'
      for (const count of [0, 80]) {
        const results = Array(count).fill(operation.asset)
        mockRemote({ raw: { response: { [key]: results }, attribution: Array(count).fill(credit(operation.asset)) } })
        expect((await client.callTool({ name: operation.name, arguments: { query: 'x', per_page: 80 } })).structuredContent)
          .toMatchObject({ results })
      }
      const invalid = [null, {}, { response: [] }, { response: { [key]: [operation.asset] } },
        { response: { [key]: [operation.asset] }, attribution: [] },
        { response: { [key]: [] }, attribution: [credit(operation.asset)] },
        { response: { [key]: [operation.asset] }, attribution: [null] },
        { response: { [key]: [null] }, attribution: [{}] },
        { response: { [key]: Array(16).fill(operation.asset) }, attribution: Array(16).fill(credit(operation.asset)) },
        ...[0, '101', 1.5, Number.MAX_SAFE_INTEGER + 1].map(id => ({ response: { [key]: [{ ...operation.asset, id }] }, attribution: [{}] })),
        { response: { [key]: [] }, attribution: [], success: false },
        { response: { [key]: [] }, attribution: [], error: SECRET }]
      for (const raw of invalid) {
        mockRemote({ toolResult: { content: [], structuredContent: raw } })
        assertFailure(await client.callTool({ name: operation.name, arguments: { query: 'x' } }))
      }
    }
    for (const raw of [{ response: { ...photo, src: null }, attribution: [{}] },
      { response: { ...video, video_files: [null] }, attribution: [{}] },
      { response: { ...video, video_files: Array(81).fill(video.video_files[0]) }, attribution: [{}] }]) {
      mockRemote({ raw })
      assertFailure(await client.callTool({ name: 'src' in raw.response ? 'get_image' : 'get_video',
        arguments: 'src' in raw.response ? { photo_id: 101 } : { video_id: 202 } }))
    }
  })

  it.each(['content-length', 'stream', 'html200'])('rejects malicious %s responses and cancels the body', async mode => {
    const cancel = vi.fn()
    let chunks = 0
    mockRemote({ reply: message => message.method === 'tools/call' ? new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        chunks++
        controller.enqueue(mode === 'html200' ? new TextEncoder().encode(`<html>${SECRET}</html>`) : new Uint8Array(1024 * 1024).fill(32))
      }, cancel
    }), { headers: { 'content-type': mode === 'html200' ? 'text/html' : 'application/json',
      ...(mode === 'content-length' ? { 'content-length': String(MAX_BYTES + 1) } : mode === 'stream' ? { 'content-length': '1' } : {})
    } }) : undefined })
    assertFailure(await client.callTool(SEARCH))
    expect(cancel).toHaveBeenCalledOnce()
    if (mode === 'stream') expect(chunks).toBeGreaterThanOrEqual(5)
    else expect(chunks).toBeLessThanOrEqual(1)
  })

  it('accepts JSON exactly at the byte limit without exposing padding', async () => {
    mockRemote({ reply: message => {
      if (message.method !== 'tools/call') return undefined
      const response = { jsonrpc: '2.0', id: message.id, result: { content: [], structuredContent: { ...searchData, padding: '' } } }
      response.result.structuredContent.padding = 'x'.repeat(MAX_BYTES - Buffer.byteLength(JSON.stringify(response)))
      const body = JSON.stringify(response)
      expect(Buffer.byteLength(body)).toBe(MAX_BYTES)
      return new Response(body, { headers: { 'content-type': 'application/json', 'content-length': String(MAX_BYTES) } })
    } })
    const result = await client.callTool(SEARCH)
    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toMatchObject({ results: [photo] })
    expect(result.structuredContent).not.toHaveProperty('padding')
  })

  it('rejects untrusted endpoint families and environment overrides before network/auth', () => {
    for (const endpoint of ['https://evil.example/pexel/mcp', 'https://open.vectcut.com.evil.example/pexel/mcp',
      'https://evil.open.vectcut.com/pexel/mcp', 'http://open.vectcut.com/pexel/mcp', 'https://open.vectcut.com:444/pexel/mcp',
      'https://user:secret@open.vectcut.com/pexel/mcp', `${CLOUD}?host=evil`, `${CLOUD}#secret`,
      'https://open.vectcut.com/other', 'http://localhost.evil.example/pexel/mcp', 'http://192.168.1.1/pexel/mcp', 'ftp://localhost/pexel/mcp']) {
      expect(() => new FootageSearchServer(endpoint)).toThrow('trusted endpoint')
    }
    vi.stubEnv('FOOTAGE_SEARCH_MCP_URL', 'https://evil.example/pexel/mcp')
    expect(() => new FootageSearchServer()).toThrow('trusted endpoint')
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockEnsureToken).not.toHaveBeenCalled()
  })

  it('accepts the alternate trusted cloud path with Bearer authentication', async () => {
    const endpoint = 'https://open.vectcut.com/pexel/mcp'
    const alternate = await connect(endpoint)
    mockRemote()
    expect((await alternate.callTool(SEARCH)).isError).not.toBe(true)
    for (const [url, init] of mockFetch.mock.calls) {
      expect(url).toBe(endpoint)
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer login-token')
    }
  })

  it.each(['http://localhost:3456/pexel/mcp', 'https://127.0.0.1:3456/pexels/mcp', 'http://[::1]:3456/pexel/mcp'])
    ('isolates local endpoint %s from cloud credentials for all four operations', async endpoint => {
      vi.stubEnv('FOOTAGE_SEARCH_MCP_URL', endpoint)
      vi.stubEnv('VECTCUT_API_KEY', 'environment-secret')
      mockStoreGet.mockReturnValue('store-secret')
      const local = await connect()
      const requests = mockRemote()
      for (const operation of operations) {
        expect((await local.callTool({ name: operation.name, arguments: operation.args })).isError).not.toBe(true)
      }
      expect(requests).toHaveLength(12)
      for (const [url, init] of mockFetch.mock.calls) {
        expect(url).toBe(endpoint)
        expect(new Headers(init.headers).has('authorization')).toBe(false)
      }
      expect(mockEnsureToken).not.toHaveBeenCalled()
      expect(mockStoreGet).not.toHaveBeenCalled()
    })
})
