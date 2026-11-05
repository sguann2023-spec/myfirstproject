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

import PhotoSearchServer from '../photo-search'

const CLOUD = 'https://open.vectcut.com/unsplash/mcp'
const PROTOCOL = '2025-03-26'
const MAX_BYTES = 4 * 1024 * 1024
const DOWNLOAD = 'https://api.unsplash.com/photos/photo-1/download?ixid=original%2Btracking%3D'
const SEARCH = { name: 'search_images', arguments: { query: 'nature' } }
const REGISTER = { name: 'track_download', arguments: { download_location: DOWNLOAD, user_selected: true } }
const SECRET = 'unsplash upstream secret Bearer private-token'
const photo = {
  id: 'photo-1', description: 'A forest', alt_description: 'Green trees', color: '#123456', blur_hash: 'hash',
  width: 1920, height: 1080, likes: 7,
  urls: {
    raw: 'https://images.unsplash.com/photo-1?ixid=raw%2Bvalue&ixlib=rb-4.1.0',
    regular: 'https://images.unsplash.com/photo-1?ixid=preview%2Bvalue&w=1080&fit=max'
  },
  links: { html: 'https://unsplash.com/photos/photo-1?utm_source=vectcut', download_location: DOWNLOAD },
  user: { id: 'author-1', name: 'Photographer', username: 'photographer', links: { html: 'https://unsplash.com/@photographer?utm_source=vectcut' } }
}
const attribution = [{
  photo_id: photo.id, photographer: photo.user.name,
  photographer_url: photo.user.links.html, unsplash_url: photo.links.html
}]
const searchData = { response: { results: [photo], total: 1, total_pages: 1 }, attribution }
type RpcRequest = {
  jsonrpc: string
  id?: number
  method: string
  params: { name?: string; arguments?: Record<string, unknown>; protocolVersion?: string }
}
type RemoteOptions = {
  raw?: unknown
  toolResult?: Record<string, unknown>
  reply?: (message: RpcRequest, init: RequestInit) => Response | undefined
}

function jsonResponse(message: unknown): Response {
  return new Response(JSON.stringify(message), { headers: { 'content-type': 'application/json; charset=utf-8' } })
}

function mockRemote(options: RemoteOptions = {}) {
  const requests: RpcRequest[] = []
  mockFetch.mockImplementation(async (_url: string, init: RequestInit) => {
    const message = JSON.parse(String(init.body)) as RpcRequest
    requests.push(message)
    const overridden = options.reply?.(message, init)
    if (overridden) return overridden
    if (message.method === 'initialize') return jsonResponse({ jsonrpc: '2.0', id: message.id, result: {
      protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: 'remote-fixture', version: '1.0.0' }
    } })
    if (message.method === 'notifications/initialized') return new Response(null, { status: 202 })
    if (message.method === 'tools/call') {
      const raw = options.raw ?? (message.params.name === 'track_download'
        ? { response: { url: photo.urls.raw } }
        : message.params.name === 'get_photo' ? { response: photo, attribution } : searchData)
      return jsonResponse({ jsonrpc: '2.0', id: message.id, result: options.toolResult ?? { content: [], structuredContent: raw } })
    }
    throw new Error(`Unexpected MCP request: ${message.method}`)
  })
  return requests
}

function assertFailure(result: unknown, registration = false) {
  expect(result).toEqual({
    content: [{ type: 'text', text: registration
      ? 'Image use registration was not confirmed and was not automatically retried. Confirm the outcome before attempting another registration.'
      : 'Image search or details are unavailable. Check parameters, login and service deployment, or try again later.' }],
    isError: true
  })
  expect(JSON.stringify(result)).not.toMatch(/unsplash|upstream|secret|Bearer|private-token|rawOutput|base64/i)
}

describe('PhotoSearchServer with a real in-memory MCP SDK client', () => {
  let client: Client
  let unexpectedFetch: ReturnType<typeof vi.fn>
  const connections: Array<{ client: Client; server: PhotoSearchServer }> = []

  async function connect(endpoint?: string) {
    const server = new PhotoSearchServer(endpoint)
    const connected = new Client({ name: 'photo-search-test', version: '1.0.0' })
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
    vi.stubEnv('PHOTO_SEARCH_MCP_URL', '')
    vi.stubEnv('VECTCUT_API_KEY', '')
    vi.stubEnv('VECTCUT_APIKEY', '')
    // Fail closed if a dependency ever bypasses the mocked Electron network boundary.
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

  it('lists exactly three static tools, restricted schemas and selection/attribution guidance without auth or network', async () => {
    const { tools } = await client.listTools()
    expect(tools.map(tool => tool.name)).toEqual(['search_images', 'get_image', 'track_download'])
    expect(tools.map(tool => tool.title)).toEqual(['\u56fe\u7247\u641c\u7d22', '\u56fe\u7247\u8be6\u60c5', '\u56fe\u7247\u4f7f\u7528\u767b\u8bb0'])
    for (const [index, tool] of tools.entries()) {
      expect(tool.annotations).toEqual({ readOnlyHint: index < 2, destructiveHint: false, idempotentHint: index < 2, openWorldHint: true })
      expect(tool.inputSchema.additionalProperties).toBe(false)
    }
    expect(tools[0].inputSchema.required).toEqual(['query'])
    expect(tools[0].inputSchema.properties).toMatchObject({
      query: { minLength: 1, maxLength: 500 }, page: { minimum: 1, maximum: 10000, default: 1 },
      per_page: { minimum: 1, maximum: 30, default: 10 }, order_by: { enum: ['relevant', 'latest'] },
      orientation: { enum: ['landscape', 'portrait', 'squarish'] }, content_filter: { enum: ['low', 'high'], default: 'high' },
      collections: { maxLength: 500 }, lang: { pattern: '^[A-Za-z]{2,3}(-[A-Za-z]{2,4})?$' }
    })
    expect(tools[1].inputSchema.required).toEqual(['photo_id'])
    expect(tools[1].inputSchema.properties).toMatchObject({ photo_id: { minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9_-]{1,128}$' } })
    expect(tools[2].inputSchema.required).toEqual(['download_location', 'user_selected'])
    expect(tools[2].inputSchema.properties).toMatchObject({ download_location: { maxLength: 4096 }, user_selected: { type: 'boolean', const: true } })
    for (const tool of tools.slice(0, 2)) {
      expect(tool.description).toContain('Honor explicit AI generation requests')
      expect(tool.description).toContain('still photos only')
      expect(tool.description).toContain('Search and preview must not trigger a download registration')
    }
    expect(tools[0].description).toContain('photographer and source credits')
    expect(tools[2].description).toContain('never automatically retry')
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockEnsureToken).not.toHaveBeenCalled()
    expect(mockStoreGet).not.toHaveBeenCalled()
  })

  it('rejects invalid parameter families and non-whitelisted tools before network/auth', async () => {
    const invalidSearch = [
      {}, { query: ' ' }, { query: 'x'.repeat(501) }, { query: 42 },
      ...[0, 10001, 1.5, '1'].map(page => ({ query: 'x', page })),
      ...[0, 31].map(per_page => ({ query: 'x', per_page })),
      ...['order_by', 'orientation', 'color', 'content_filter'].map(key => ({ query: 'x', [key]: 'unsupported' })),
      ...['constructor', 'toString'].map(key => JSON.parse(`{"query":"x","${key}":"unexpected"}`)),
      { query: 'x', collections: 'id,,other' }, { query: 'x', collections: 'c'.repeat(501) },
      { query: 'x', lang: 'english' }, { query: 'x', endpoint: 'https://evil.example' }
    ]
    for (const args of invalidSearch) assertFailure(await client.callTool({ name: 'search_images', arguments: args }))
    for (const args of [{}, { photo_id: '../secret' }, { photo_id: 'p'.repeat(129) }, { photo_id: 'photo-1', query: 'x' }]) {
      assertFailure(await client.callTool({ name: 'get_image', arguments: args }))
    }
    for (const name of ['search_photos', 'download_image', '__proto__']) assertFailure(await client.callTool({ name, arguments: { query: 'x' } }))
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockEnsureToken).not.toHaveBeenCalled()
  })

  it('accepts inclusive ranges, counts Unicode code points, trims filters and maps search/detail names', async () => {
    const requests = mockRemote()
    const searches = [
      [{ query: ' nature ' }, { query: 'nature', page: 1, per_page: 10, order_by: 'relevant', content_filter: 'high' }],
      [{ query: '\u{1f332}'.repeat(500), page: 10000, per_page: 30, order_by: ' latest ', orientation: ' landscape ', color: ' teal ', content_filter: ' low ', collections: ' c-1,c_2 ', lang: ' zh-CN ' },
        { query: '\u{1f332}'.repeat(500), page: 10000, per_page: 30, order_by: 'latest', orientation: 'landscape', color: 'teal', content_filter: 'low', collections: 'c-1,c_2', lang: 'zh-CN' }],
      [{ query: 'x', page: 1, per_page: 1, collections: 'c'.repeat(500) }, { query: 'x', page: 1, per_page: 1, order_by: 'relevant', content_filter: 'high', collections: 'c'.repeat(500) }]
    ] as const
    for (const [args, expected] of searches) {
      expect((await client.callTool({ name: 'search_images', arguments: { ...args } })).isError).not.toBe(true)
      expect(requests[requests.length - 1]?.params).toEqual({ name: 'search_photos', arguments: expected })
    }
    expect((await client.callTool({ name: 'get_image', arguments: { photo_id: ` ${'p'.repeat(128)} ` } })).isError).not.toBe(true)
    expect(requests[requests.length - 1]?.params).toEqual({ name: 'get_photo', arguments: { photo_id: 'p'.repeat(128) } })
    expect(requests.filter(message => message.method === 'tools/call').map(message => message.params.name))
      .toEqual(['search_photos', 'search_photos', 'search_photos', 'get_photo'])
  })

  it('negotiates stateless JSON-RPC per operation with exact IDs, notification and safe request headers', async () => {
    const requests = mockRemote()
    await client.callTool(SEARCH)
    await client.callTool({ name: 'get_image', arguments: { photo_id: photo.id } })
    expect(requests.map(message => message.method)).toEqual([
      'initialize', 'notifications/initialized', 'tools/call', 'initialize', 'notifications/initialized', 'tools/call'
    ])
    for (let offset = 0; offset < requests.length; offset += 3) {
      expect(requests[offset]).toEqual({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
        protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'photo-search', version: '1.0.0' }
      } })
      expect(requests[offset + 1]).toEqual({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })
      expect(requests[offset + 2]).toMatchObject({ jsonrpc: '2.0', id: 2 })
    }
    for (const [url, init] of mockFetch.mock.calls) {
      expect(url).toBe(CLOUD)
      expect(init).toMatchObject({ method: 'POST', redirect: 'error', signal: expect.any(AbortSignal) })
      const headers = new Headers(init.headers)
      expect(headers.get('authorization')).toBe('Bearer login-token')
      expect(headers.get('content-type')).toBe('application/json')
      expect(headers.get('accept')).toBe('application/json')
      expect(headers.get('mcp-protocol-version')).toBe(PROTOCOL)
      expect(headers.has('mcp-session-id')).toBe(false)
    }
  })

  it.each(['version', 'rpc-version', 'id', 'error', 'missing-result', 'notification-status'])('stops at invalid initialization contract: %s', async failure => {
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

  it.each(['initialize', 'tools/call'])('refreshes credentials on a read-only %s 401 and retries the identical body', async method => {
    mockEnsureToken.mockImplementation(async force => force ? 'refreshed-token' : 'expired-token')
    let rejected = false
    mockRemote({ reply: message => {
      if (message.method !== method || rejected) return undefined
      rejected = true
      return new Response(SECRET, { status: 401 })
    } })
    expect((await client.callTool(SEARCH)).isError).not.toBe(true)
    const attempts = mockFetch.mock.calls.filter(([, init]) => JSON.parse(init.body).method === method)
    expect(attempts).toHaveLength(2)
    expect(attempts[0][1].body).toBe(attempts[1][1].body)
    expect(attempts.map(([, init]) => new Headers(init.headers).get('authorization'))).toEqual(['Bearer expired-token', 'Bearer refreshed-token'])
    expect(mockEnsureToken.mock.calls.filter(([force]) => force === true)).toEqual([[true]])
  })

  it('bounds repeated 401 failures, falls back to stored credentials and fails closed after logout', async () => {
    mockEnsureToken.mockImplementation(async force => force ? 'refreshed-token' : 'expired-token')
    mockFetch.mockImplementation(async () => new Response(SECRET, { status: 401 }))
    assertFailure(await client.callTool(SEARCH))
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(mockEnsureToken.mock.calls).toEqual([[undefined], [true]])

    mockEnsureToken.mockRejectedValue(new Error(SECRET))
    mockStoreGet.mockImplementation(key => key === 'auth.vectcut_api_key' ? ' stored-key ' : undefined)
    const requests = mockRemote()
    expect((await client.callTool(SEARCH)).isError).not.toBe(true)
    expect(requests).toHaveLength(3)
    for (const [, init] of mockFetch.mock.calls.slice(-3)) expect(new Headers(init.headers).get('authorization')).toBe('Bearer stored-key')
    const fetchCount = mockFetch.mock.calls.length
    mockStoreGet.mockReset()
    assertFailure(await client.callTool(SEARCH))
    expect(mockFetch).toHaveBeenCalledTimes(fetchCount)
  })

  it('rejects absent/false selection and unsafe registration locations before auth/network', async () => {
    for (const user_selected of [undefined, false, 'true']) {
      assertFailure(await client.callTool({ name: 'track_download', arguments: {
        download_location: DOWNLOAD, ...(user_selected === undefined ? {} : { user_selected })
      } }), true)
    }
    const invalidLocations = [
      ` ${DOWNLOAD}`, 'https://api.unsplash.com.evil.example/photos/photo-1/download',
      'http://api.unsplash.com/photos/photo-1/download', 'https://user:secret@api.unsplash.com/photos/photo-1/download',
      'https://api.unsplash.com/photos/photo-1', `${DOWNLOAD}&host=evil`, `${DOWNLOAD}#fragment`,
      `https://api.unsplash.com/photos/photo-1/download?ixid=${'x'.repeat(4096)}`
    ]
    for (const download_location of invalidLocations) assertFailure(await client.callTool({ name: 'track_download', arguments: { download_location, user_selected: true } }), true)
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockEnsureToken).not.toHaveBeenCalled()
  })

  it('registers once only after selection, preserves the exact ixid location and never fetches media', async () => {
    const requests = mockRemote()
    await client.callTool(SEARCH)
    await client.callTool({ name: 'get_image', arguments: { photo_id: photo.id } })
    expect(requests.filter(message => message.params.name === 'track_download')).toHaveLength(0)
    const result = await client.callTool(REGISTER)
    expect(result.structuredContent).toEqual({ title: '\u56fe\u7247\u4f7f\u7528\u767b\u8bb0', mediaType: 'image', registered: true, url: photo.urls.raw, mediaDownloaded: false })
    const registrations = requests.filter(message => message.params.name === 'track_download')
    expect(registrations).toHaveLength(1)
    expect(registrations[0].params).toEqual({ name: 'track_download', arguments: { download_location: DOWNLOAD } })
    expect(mockFetch.mock.calls.every(([url]) => url === CLOUD)).toBe(true)
  })

  it.each(['401', 'network', 'rpc', 'tool'])('does not retry an ambiguous registration %s failure or expose its details', async failure => {
    const requests = mockRemote({ reply: message => {
      if (message.method !== 'tools/call') return undefined
      if (failure === 'network') throw new Error(SECRET)
      if (failure === '401') return new Response(SECRET, { status: 401 })
      return jsonResponse({ jsonrpc: '2.0', id: message.id,
        ...(failure === 'rpc' ? { error: { code: -32603, message: SECRET, data: { rawOutput: SECRET } } }
          : { result: { content: [{ type: 'text', text: SECRET }], isError: true } }) })
    } })
    assertFailure(await client.callTool(REGISTER), true)
    expect(requests.map(message => message.method)).toEqual(['initialize', 'notifications/initialized', 'tools/call'])
    expect(mockEnsureToken).toHaveBeenCalledTimes(3)
    expect(mockEnsureToken.mock.calls.some(([force]) => force === true)).toBe(false)
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it('uses Store credentials without retrying an unauthorized registration', async () => {
    mockEnsureToken.mockRejectedValue(new Error(SECRET))
    mockStoreGet.mockImplementation(key => key === 'auth.vectcut_api_key' ? 'stored-key' : undefined)
    const requests = mockRemote({ reply: message => message.method === 'tools/call' ? new Response(SECRET, { status: 401 }) : undefined })
    assertFailure(await client.callTool(REGISTER), true)
    expect(requests.filter(message => message.method === 'tools/call')).toHaveLength(1)
    for (const [, init] of mockFetch.mock.calls) expect(new Headers(init.headers).get('authorization')).toBe('Bearer stored-key')
    expect(mockEnsureToken.mock.calls.some(([force]) => force === true)).toBe(false)
  })

  it.each(['search_images', 'get_image'])('projects %s preserving original URLs, ixid and photographer/source credits while dropping unsafe/raw fields', async name => {
    const rawPhoto = { ...photo, description: 'd'.repeat(2049), likes: -1,
      urls: { ...photo.urls, full: 'data:image/png;base64,AAAA', small: 'https://user:secret@cdn.example/image', thumb: 'javascript:alert(1)', extra: 'https://cdn.example/secret' },
      user: { ...photo.user, email: SECRET }, rawOutput: SECRET, download: SECRET }
    const raw = { response: name === 'search_images' ? { results: [rawPhoto], total: 1, total_pages: 1 } : rawPhoto,
      attribution: [{ ...attribution[0], secret: SECRET }], secret: SECRET }
    mockRemote({ toolResult: name === 'search_images'
      ? { content: [{ type: 'text', text: SECRET }], structuredContent: raw }
      : { content: [{ type: 'text', text: JSON.stringify(raw) }] } })
    const result = await client.callTool({ name, arguments: name === 'search_images' ? { query: 'nature' } : { photo_id: photo.id } })
    expect(result.isError).not.toBe(true)
    const { likes: _likes, ...expectedPhoto } = photo
    expect(result.structuredContent).toEqual({
      title: name === 'search_images' ? '\u56fe\u7247\u641c\u7d22' : '\u56fe\u7247\u8be6\u60c5', mediaType: 'image',
      attribution_required: true, download_registration_required: true,
      usage: expect.stringContaining('without removing query parameters such as ixid'),
      ...(name === 'search_images' ? { results: [{ ...expectedPhoto, description: 'd'.repeat(2048) }], total: 1, total_pages: 1 }
        : { photo: { ...expectedPhoto, description: 'd'.repeat(2048) } }),
      attribution: [{ photo_id: photo.id, photographer: photo.user.name, photographer_url: photo.user.links.html, source_url: photo.links.html }]
    })
    const text = (result.content as CallToolResult['content'])[0]
    expect(text.type).toBe('text')
    if (text.type === 'text') expect(JSON.parse(text.text)).toEqual(result.structuredContent)
    expect(JSON.stringify(result)).not.toMatch(/secret|rawOutput|base64|javascript:|email/)
    expect(mockFetch.mock.calls.every(([url]) => url === CLOUD)).toBe(true)
  })

  it.each(['http', 'network', 'rpc', 'invalid-text', 'invalid-tool-schema'])('sanitizes read-only %s failures', async failure => {
    mockRemote({ reply: message => {
      if (message.method !== 'tools/call') return undefined
      if (failure === 'network') throw new Error(SECRET)
      if (failure === 'http') return new Response(SECRET, { status: 500 })
      return jsonResponse({ jsonrpc: '2.0', id: message.id,
        ...(failure === 'rpc' ? { error: { code: -32603, message: SECRET, data: { rawOutput: SECRET } } }
          : { result: { content: failure === 'invalid-text' ? [{ type: 'text', text: SECRET }] : [{ type: 'unknown', secret: SECRET }] } }) })
    } })
    assertFailure(await client.callTool(SEARCH))
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it('accepts exactly 30 photos/credits and rejects excessive, malformed or unattributed results', async () => {
    const results = Array.from({ length: 30 }, (_, id) => ({ ...photo, id: String(id) }))
    mockRemote({ raw: { response: { results }, attribution: Array(30).fill(attribution[0]) } })
    expect((await client.callTool(SEARCH)).structuredContent).toMatchObject({ results })
    const invalid = [
      { response: { results: [...results, photo] }, attribution },
      { response: { results: [photo] }, attribution: Array(31).fill(attribution[0]) },
      { response: { results: [photo] } },
      { response: { results: [{ ...photo, id: '../invalid' }] }, attribution },
      { response: { results: [null] }, attribution }
    ]
    for (const raw of invalid) {
      mockRemote({ raw })
      assertFailure(await client.callTool(SEARCH))
    }
  })

  it.each(['content-length', 'stream', 'html200'])('rejects %s responses and cancels the response body', async mode => {
    const cancel = vi.fn()
    let chunks = 0
    mockRemote({ reply: message => message.method === 'tools/call' ? new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        chunks++
        controller.enqueue(mode === 'html200' ? new TextEncoder().encode(`<html>${SECRET}</html>`) : new Uint8Array(1024 * 1024).fill(32))
      }, cancel
    }), { headers: {
      'content-type': mode === 'html200' ? 'text/html' : 'application/json',
      ...(mode === 'content-length' ? { 'content-length': String(MAX_BYTES + 1) } : mode === 'stream' ? { 'content-length': '1' } : {})
    } }) : undefined })
    assertFailure(await client.callTool(SEARCH))
    expect(cancel).toHaveBeenCalledOnce()
    if (mode === 'stream') expect(chunks).toBeGreaterThanOrEqual(5)
    else expect(chunks).toBeLessThanOrEqual(1)
  })

  it('accepts JSON exactly at the byte limit, without leaking discarded padding', async () => {
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

  it('rejects untrusted endpoint families, including environment overrides, before network/auth', () => {
    const endpoints = [
      'https://open.vectcut.com.evil.example/unsplash/mcp', 'https://evil.open.vectcut.com/unsplash/mcp',
      'http://open.vectcut.com/unsplash/mcp', 'https://open.vectcut.com:444/unsplash/mcp',
      'https://user:secret@open.vectcut.com/unsplash/mcp', `${CLOUD}?host=evil`, `${CLOUD}#secret`,
      'https://open.vectcut.com/other', 'http://localhost.evil.example/unsplash/mcp',
      'http://192.168.1.1/unsplash/mcp', 'ftp://localhost/unsplash/mcp'
    ]
    for (const endpoint of endpoints) expect(() => new PhotoSearchServer(endpoint)).toThrow()
    vi.stubEnv('PHOTO_SEARCH_MCP_URL', 'https://evil.example/unsplash/mcp')
    expect(() => new PhotoSearchServer()).toThrow('trusted endpoint')
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockEnsureToken).not.toHaveBeenCalled()
  })

  it.each(['http://localhost:3456/unsplash/mcp', 'https://127.0.0.1:3456/unsplash/mcp', 'http://[::1]:3456/unsplash/mcp'])('isolates local endpoint %s from cloud credentials for search and registration', async endpoint => {
    vi.stubEnv('PHOTO_SEARCH_MCP_URL', endpoint)
    vi.stubEnv('VECTCUT_API_KEY', 'environment-secret')
    mockStoreGet.mockReturnValue('store-secret')
    const local = await connect()
    const requests = mockRemote()
    expect((await local.callTool(SEARCH)).isError).not.toBe(true)
    expect((await local.callTool(REGISTER)).isError).not.toBe(true)
    expect(requests).toHaveLength(6)
    for (const [url, init] of mockFetch.mock.calls) {
      expect(url).toBe(endpoint)
      expect(new Headers(init.headers).has('authorization')).toBe(false)
    }
    expect(mockEnsureToken).not.toHaveBeenCalled()
    expect(mockStoreGet).not.toHaveBeenCalled()
  })

  it('does not reuse results or credentials across accounts', async () => {
    const requests = mockRemote()
    await client.callTool(SEARCH)
    mockEnsureToken.mockResolvedValue('second-account-token')
    await client.callTool(SEARCH)
    expect(requests.filter(message => message.method === 'tools/call')).toHaveLength(2)
    expect(mockFetch.mock.calls.slice(-3).map(([, init]) => new Headers(init.headers).get('authorization')))
      .toEqual(Array(3).fill('Bearer second-account-token'))
  })
})
