import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

const { mockFetch, mockEnsureToken, mockStoreGet } = vi.hoisted(() => ({
  mockFetch: vi.fn(), mockEnsureToken: vi.fn(), mockStoreGet: vi.fn()
}))
vi.mock('electron', () => ({ net: { fetch: mockFetch } }))
vi.mock('electron-store', () => ({ default: class { get = mockStoreGet } }))
vi.mock('../../services/agents/services/AgentRuntimeAuthService', () => ({
  agentRuntimeAuthService: { ensureValidAccessToken: mockEnsureToken }
}))

import AiLibraryServer from '../ai-library'

const CLOUD = 'https://open.vectcut.com/vectdash/mcp'
const IMAGE = { log_id: 42, prompt: 'city skyline', image_url: 'https://cdn.example/image.png?signature=keep', size: '1024x1024', model: 'image-model', score: 0.8 }
const VIDEO = { log_id: 42, prompt: 'city skyline', video_url: 'https://cdn.example/video.mp4?signature=keep', size: '1920x1080', model: 'video-model', score: 0.8, status: 'success' }
type Rpc = { id?: number; method: string; params?: { name?: string; arguments?: Record<string, unknown>; protocolVersion?: string } }

function remote(raw: unknown = { assets: [] }, textOnly = false) {
  const requests: Rpc[] = []
  mockFetch.mockImplementation(async (_url: string, init: RequestInit) => {
    const request = JSON.parse(String(init.body)) as Rpc
    requests.push(request)
    if (request.method === 'notifications/initialized') return new Response(null, { status: 202 })
    const result = request.method === 'initialize'
      ? { protocolVersion: request.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'private-provider', version: '1' } }
      : { content: [{ type: 'text', text: JSON.stringify(raw) }], ...(!textOnly ? { structuredContent: raw } : {}) }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), { headers: { 'content-type': 'application/json' } })
  })
  return requests
}

describe('AiLibraryServer using the shared media proxy and real MCP client', () => {
  let client: Client
  const connections: Array<{ client: Client; server: AiLibraryServer }> = []
  async function connect(endpoint?: string) {
    const server = new AiLibraryServer(endpoint)
    const connected = new Client({ name: 'ai-library-test', version: '1' })
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
    for (const key of ['AI_LIBRARY_MCP_URL', 'VECTCUT_API_KEY', 'VECTCUT_APIKEY']) vi.stubEnv(key, '')
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

  it('exposes exactly four read-only tools and no internal filters or generation tools', async () => {
    const { tools } = await client.listTools()
    expect(tools.map(tool => tool.name)).toEqual(['search_images', 'search_videos', 'get_image', 'get_video'])
    for (const tool of tools) {
      expect(tool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false })
      expect(tool.inputSchema.additionalProperties).toBe(false)
      expect(Object.keys(tool.inputSchema.properties!)).toEqual(tool.name.startsWith('search_') ? ['query', 'mode', 'limit', 'size', 'model'] : ['log_id'])
      expect(tool.description).toContain('shared library of already-generated AI assets')
      expect(tool.description).toContain('Honor explicit AI generation requests')
    }
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockEnsureToken).not.toHaveBeenCalled()
  })

  it.each([
    ['search_images', 'search_ai_images', { query: ' city ' }, { query: 'city', mode: 'semantic', limit: 20 }, { assets: [IMAGE] }],
    ['search_videos', 'search_ai_videos', { query: ' city ', mode: 'keyword', limit: 50, model: ' m ', size: ' s ' }, { query: 'city', mode: 'keyword', limit: 50, model: 'm', size: 's' }, { assets: [VIDEO] }],
    ['get_image', 'get_ai_image', { log_id: 42 }, { log_id: 42 }, { asset: IMAGE }],
    ['get_video', 'get_ai_video', { log_id: 42 }, { log_id: 42 }, { asset: VIDEO }]
  ])('maps %s only to %s and preserves the backend argument contract', async (name, upstream, args, expected, raw) => {
    const requests = remote(raw)
    const result = await client.callTool({ name: String(name), arguments: args as Record<string, unknown> })
    expect(result.isError).not.toBe(true)
    expect(requests.map(request => request.method)).toEqual(['initialize', 'notifications/initialized', 'tools/call'])
    expect(requests[2].params).toEqual({ name: upstream, arguments: expected })
    expect(result.structuredContent).toMatchObject({ mediaType: String(name).includes('video') ? 'video' : 'image' })
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(result.structuredContent) }])
    for (const [url, init] of mockFetch.mock.calls) {
      expect(url).toBe(CLOUD)
      expect(init.redirect).toBe('error')
      expect(init.signal).toBeInstanceOf(AbortSignal)
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer login-token')
      expect(new Headers(init.headers).has('mcp-session-id')).toBe(false)
    }
  })

  it.each(['search_ai_images', 'get_ai_video', 'generate_image', 'generate_video', 'delete_asset', 'search_audios', '__proto__'])('rejects non-whitelisted %s before authentication/network', async name => {
    expect((await client.callTool({ name, arguments: { query: 'city' } })).isError).toBe(true)
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockEnsureToken).not.toHaveBeenCalled()
  })

  it.each([
    ['search_images', {}], ['search_images', { query: ' ' }], ['search_images', { query: 'x'.repeat(2001) }],
    ['search_images', { query: 'x', limit: 0 }], ['search_images', { query: 'x', limit: 51 }],
    ['search_images', { query: 'x', limit: 1.5 }], ['search_images', { query: 'x', limit: '20' }],
    ['search_images', { query: 'x', mode: 'unknown' }], ['search_images', { query: 'x', size: 'x'.repeat(65) }],
    ['search_images', { query: 'x', model: 'x'.repeat(256) }],
    ...['provider', 'user_id', 'reference', 'context', 'host', 'page'].map(key => ['search_videos', { query: 'city', [key]: 'private' }] as [string, Record<string, unknown>]),
    ['get_image', { log_id: '42' }], ['get_image', { log_id: 0 }], ['get_image', { log_id: 1.1 }],
    ['get_video', { log_id: Number.MAX_SAFE_INTEGER + 1 }], ['get_video', { log_id: 42, provider: 'private' }]
  ])('rejects invalid %s arguments %j without network', async (name, args) => {
    expect((await client.callTool({ name: String(name), arguments: args as Record<string, unknown> })).isError).toBe(true)
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockEnsureToken).not.toHaveBeenCalled()
  })

  it.each([false, true])('strictly projects asset fields and strips internals (text-only=%s)', async textOnly => {
    remote({ assets: [{ ...VIDEO, status: ' Completed ', provider: 'private', user_id: 'private', reference: { url: 'https://cdn.example/private' },
      duration_ms: 90000, duration: 90, created_at: 123, is_fallback: true, raw_output: 'private', database: 'private' }],
      provider: 'private', scope: 'private', count: 999, candidate_limit: 1000, candidate_count: 10, order: 'vector_provider_order',
      has_more_in_window: true, bounded_retrieval: true }, textOnly)
    const result = await client.callTool({ name: 'search_videos', arguments: { query: 'city' } })
    const { status: _status, ...expected } = VIDEO
    expect(result.structuredContent).toEqual({ title: 'AI\u89c6\u9891\u641c\u7d22', mediaType: 'video', usage: expect.any(String),
      assets: [expected], count: 1, mode: 'semantic', has_more_in_window: true, bounded_retrieval: true })
    expect(JSON.stringify(result.structuredContent)).not.toMatch(/private|duration_ms|"duration"|created_at|provider|"reference"|candidate|database|status|fallback/)
    expect(mockFetch.mock.calls.every(([url]) => url === CLOUD)).toBe(true)
  })

  it.each(['success', 'succeeded', 'completed', 'done', ' SUCCESS '])('accepts successful video status %s', async status => {
    remote({ asset: { ...VIDEO, status } })
    expect((await client.callTool({ name: 'get_video', arguments: { log_id: 42 } })).isError).not.toBe(true)
  })
  it.each(['pending', 'failed', '', null, true, undefined])('excludes unsuccessful videos and rejects their details: %s', async status => {
    remote({ assets: [{ ...VIDEO, status }, VIDEO] })
    expect((await client.callTool({ name: 'search_videos', arguments: { query: 'city' } })).structuredContent).toMatchObject({ count: 1, assets: [expect.objectContaining({ log_id: 42 })] })
    remote({ asset: { ...VIDEO, status } })
    expect((await client.callTool({ name: 'get_video', arguments: { log_id: 42 } })).isError).toBe(true)
  })

  it.each([
    { assets: [null] }, { assets: 'bad' }, { assets: Array(21).fill(IMAGE) },
    { assets: [{ ...IMAGE, log_id: '42' }] }, { assets: [{ ...IMAGE, log_id: Number.MAX_SAFE_INTEGER + 1 }] },
    ...['data:image/png;base64,AAAA', 'javascript:alert(1)', '/image.png', 'https://user:secret@cdn.example/image.png'].map(image_url => ({ assets: [{ ...IMAGE, image_url }] })),
    { assets: [{ ...IMAGE, asset_type: 'video' }] }
  ])('sanitizes malformed/unsafe search results %j', async raw => {
    remote(raw)
    const result = await client.callTool({ name: 'search_images', arguments: { query: 'city' } })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).not.toMatch(/secret|base64|javascript|database|Bearer/)
  })

  it('rejects mismatched detail IDs and drops invalid optional metadata', async () => {
    remote({ asset: { ...IMAGE, log_id: 43 } })
    expect((await client.callTool({ name: 'get_image', arguments: { log_id: 42 } })).isError).toBe(true)
    remote({ asset: { ...IMAGE, prompt: { private: 'private' }, size: [], model: null, score: 'NaN' } })
    expect((await client.callTool({ name: 'get_image', arguments: { log_id: 42 } })).structuredContent).toMatchObject({ asset: { log_id: 42, image_url: IMAGE.image_url } })
  })

  it.each(['/vectdash/mcp', '/ai_history/mcp'])('allows loopback and trusted cloud path %s', async path => {
    for (const origin of ['http://localhost:3456', 'http://127.0.0.1:3456', 'http://[::1]:3456', 'https://open.vectcut.com']) {
      const connected = await connect(origin + path)
      remote()
      expect((await connected.callTool({ name: 'search_images', arguments: { query: 'city' } })).isError).not.toBe(true)
      for (const [url, init] of mockFetch.mock.calls) {
        expect(url).toBe(origin + path)
        expect(new Headers(init.headers).has('authorization')).toBe(origin === 'https://open.vectcut.com')
      }
      mockFetch.mockReset()
    }
  })
  it.each(['https://evil.example/vectdash/mcp', 'http://open.vectcut.com/vectdash/mcp', 'https://open.vectcut.com/other',
    'https://open.vectcut.com/vectdash/mcp/', 'https://user:secret@open.vectcut.com/vectdash/mcp',
    'https://open.vectcut.com/vectdash/mcp?x=1', 'https://open.vectcut.com/ai_history/mcp#x', 'http://localhost.evil.example/vectdash/mcp'])('rejects untrusted endpoint %s', endpoint => {
    expect(() => new AiLibraryServer(endpoint)).toThrow()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('honors the local endpoint environment override without cloud authentication', async () => {
    vi.stubEnv('AI_LIBRARY_MCP_URL', 'http://localhost:3456/ai_history/mcp')
    const connected = await connect()
    remote()
    await connected.callTool({ name: 'search_images', arguments: { query: 'city' } })
    expect(mockFetch.mock.calls.every(([url]) => url === 'http://localhost:3456/ai_history/mcp')).toBe(true)
    expect(mockEnsureToken).not.toHaveBeenCalled()
  })

  it('does not cache shared search results or account credentials', async () => {
    const requests = remote()
    await client.callTool({ name: 'search_images', arguments: { query: 'city' } })
    mockEnsureToken.mockResolvedValue('other-account')
    await client.callTool({ name: 'search_images', arguments: { query: 'city' } })
    expect(requests.filter(request => request.method === 'initialize')).toHaveLength(2)
    expect(requests.filter(request => request.method === 'tools/call')).toHaveLength(2)
    expect(new Headers(mockFetch.mock.calls[5][1].headers).get('authorization')).toBe('Bearer other-account')
  })

  it('sanitizes upstream errors and enforces the shared response byte limit', async () => {
    remote({ error: { message: 'private database provider reference' } })
    const failed = await client.callTool({ name: 'search_images', arguments: { query: 'city' } })
    expect(failed.isError).toBe(true)
    expect(JSON.stringify(failed)).not.toMatch(/private|database|provider|reference/)
    const cancel = vi.fn()
    mockFetch.mockResolvedValue(new Response(new ReadableStream({ cancel }), { headers: {
      'content-type': 'application/json', 'content-length': String(4 * 1024 * 1024 + 1)
    } }))
    expect((await client.callTool({ name: 'search_images', arguments: { query: 'city' } })).isError).toBe(true)
    expect(cancel).toHaveBeenCalledOnce()
  })
})
