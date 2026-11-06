import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { normalizeVectcutMcpToolName } from '../../../packages/shared/mcp'
import { preserveMcpResult, projectMcpArtifactForContext } from '../../services/agents/services/claudecode/harness/mcp-result-storage'

const { mockFetch, mockEnsureToken, mockStoreGet } = vi.hoisted(() => ({
  mockFetch: vi.fn(), mockEnsureToken: vi.fn(), mockStoreGet: vi.fn()
}))
vi.mock('electron', () => ({ net: { fetch: mockFetch } }))
vi.mock('electron-store', () => ({ default: class { get = mockStoreGet } }))
vi.mock('../../services/agents/services/AgentRuntimeAuthService', () => ({
  agentRuntimeAuthService: { ensureValidAccessToken: mockEnsureToken }
}))

import MediaSearchServer from '../media-search'

describe('Media Search MCP', () => {
  let client: Client
  let server: MediaSearchServer
  let sequence = 0

  beforeEach(async () => {
    mockFetch.mockReset()
    mockEnsureToken.mockReset().mockResolvedValue('login-token')
    mockStoreGet.mockReset()
    server = new MediaSearchServer(`https://proxy.example/test-${++sequence}`)
    client = new Client({ name: 'media-search-test', version: '1.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.mcpServer.connect(serverTransport)
    await client.connect(clientTransport)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await client.close()
    await server.mcpServer.close()
  })

  it('exposes only supported types with optional stock-before-AI guidance', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((tool) => tool.name)).toEqual(['search_images', 'search_videos'])
    expect(tools[0].description).toContain('potentially cheaper alternative to AI generation')
    expect(tools[0].description).toContain('honor explicit requests for AI generation')
    expect(tools[0].description).toContain('does not support music, sound effects or GIF search')
    expect(tools[0].description).toContain('Never label a raster preview as SVG')
    expect(tools[1].description).toContain('scrapt.youtube_web_search_video with search_query')
    expect(tools[1].description).toContain('establishing shots, scenic backgrounds')
    expect(tools[1].description).toContain('YouTube fallback is not limited to one call')
    expect(tools[1].description).toContain('Never use YouTube as an animation, vector or AI-only asset fallback')
    expect(tools[1].description).toContain('automatically downloading the selected video')
    expect(tools[1].description).toContain('filesystem.download(url, file_path)')
    expect(tools[1].description).toContain('ffmpeg-media.trim_media_segment')
    expect(tools[1].description).toContain('scrapt.youtube_web_v2_get_video_streams')
    expect(tools[1].description).toContain('only to search or preview')
    expect(tools.map((tool) => tool.description).join(' ')).not.toMatch(/license|third-party rights|permission|authorization/i)
    expect(tools.map((tool) => tool.title)).toEqual([
      '\u8054\u7f51\u641c\u7d22\uff1a\u7d20\u6750\u641c\u7d22',
      '\u8054\u7f51\u641c\u7d22\uff1a\u7d20\u6750\u641c\u7d22'
    ])
    expect(JSON.stringify(tools)).not.toMatch(/pixabay|proxy|public API|full API access/i)
    expect(normalizeVectcutMcpToolName('mcp__media-search__search_images')).toBe('mcp__vectcut__media-search__search_images')
  })

  it.each(['mcp__pixabay__search_images', 'mcp__vectcut__pixabay__search_images'])('migrates legacy search permissions: %s', (name) => {
    expect(normalizeVectcutMcpToolName(name)).toBe('mcp__vectcut__media-search__search_images')
  })

  it('encodes image keywords and preserves provenance and optional vector URLs', async () => {
    const hit = { id: 12, pageURL: 'https://pixabay.com/images/id-12/', user: 'artist', vectorURL: 'https://cdn.example/12.svg', previewURL: 'https://cdn.example/12.jpg' }
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ total: 1, totalHits: 1, hits: [hit] })))
    const result = await client.callTool({ name: 'search_images', arguments: { q: '\u900f\u660e\u82b1\u6735 & sticker', lang: 'zh', image_type: 'vector', colors: 'transparent', safesearch: false } })
    const url = new URL(mockFetch.mock.calls[0][0])
    expect(url.pathname).toMatch(/\/pixabay\/search$/)
    expect(url.searchParams.get('q')).toBe('\u900f\u660e\u82b1\u6735 & sticker')
    expect(url.searchParams.get('safesearch')).toBe('false')
    expect(url.searchParams.get('image_type')).toBe('vector')
    expect(url.searchParams.has('key')).toBe(false)
    expect(mockFetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
    expect(result.structuredContent).toMatchObject({ title: '\u8054\u7f51\u641c\u7d22\uff1a\u7d20\u6750\u641c\u7d22', mediaType: 'image', hits: [hit], page: 1, per_page: 20 })
    expect(result.structuredContent).not.toHaveProperty('source')
    expect((result.structuredContent as Record<string, unknown> | undefined)?.usage).not.toMatch(/pixabay|proxy/i)
  })

  it('uses the separate video route and preserves renditions and duration', async () => {
    const hit = { id: 21, duration: 9, videos: { medium: { url: 'https://cdn.example/21.mp4', width: 1920, height: 1080, size: 1200, thumbnail: 'https://cdn.example/21.jpg' } } }
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ total: 1, totalHits: 1, hits: [hit] })))
    const result = await client.callTool({ name: 'search_videos', arguments: { id: '21', video_type: 'animation' } })
    const url = new URL(mockFetch.mock.calls[0][0])
    expect(url.pathname).toMatch(/\/pixabay\/videos\/search$/)
    expect(url.searchParams.get('id')).toBe('21')
    expect(url.searchParams.get('safesearch')).toBe('true')
    expect(result.structuredContent).toMatchObject({ mediaType: 'video', hits: [hit] })
    expect(result.structuredContent).not.toHaveProperty('suggestedNextSearch')
  })

  it('suggests a conditional YouTube fallback for an empty initial video keyword search without calling it', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ total: 0, totalHits: 0, hits: [] })))
    const result = await client.callTool({ name: 'search_videos', arguments: { q: 'Kyoto street walking', video_type: 'film', per_page: 3 } })
    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toMatchObject({
      hits: [],
      suggestedNextSearch: {
        tool: 'scrapt.youtube_web_search_video',
        arguments: { search_query: 'Kyoto street walking' },
        guidance: expect.stringContaining('Skip it for animation or AI-only requests')
      }
    })
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(result.structuredContent).toMatchObject({
      suggestedNextSearch: { guidance: expect.stringContaining('this fallback is not limited to one call') }
    })
  })

  it.each([
    { name: 'search_images', arguments: { q: 'empty photo' } },
    { name: 'search_videos', arguments: { q: 'empty animation', video_type: 'animation' } },
    { name: 'search_videos', arguments: { id: '999' } },
    { name: 'search_videos', arguments: { q: 'empty mixed lookup', id: '999' } },
    { name: 'search_videos', arguments: { q: 'empty last page', page: 2 } }
  ])('does not suggest YouTube for unrelated empty searches: %j', async (request) => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ total: 0, totalHits: 0, hits: [] })))
    const result = await client.callTool(request)
    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).not.toHaveProperty('suggestedNextSearch')
  })

  async function callCloudTool(q: string) {
    const cloud = new MediaSearchServer('https://open.vectcut.com')
    const cloudClient = new Client({ name: 'cloud-search-test', version: '1.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await cloud.mcpServer.connect(serverTransport)
    await cloudClient.connect(clientTransport)
    try {
      return await cloudClient.callTool({ name: 'search_images', arguments: { q } })
    } finally {
      await cloudClient.close()
      await cloud.mcpServer.close()
    }
  }

  it('sends the login Bearer token to the cloud gateway and blocks redirects', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ total: 0, totalHits: 0, hits: [] })))
    expect((await callCloudTool('authenticated search')).isError).not.toBe(true)
    expect(mockFetch.mock.calls[0][1]).toMatchObject({ headers: { Authorization: 'Bearer login-token' }, redirect: 'error' })
  })

  it('refreshes an expired login token on 401', async () => {
    mockEnsureToken.mockResolvedValueOnce('expired-token').mockResolvedValueOnce('refreshed-token')
    mockFetch.mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ total: 0, totalHits: 0, hits: [] })))
    expect((await callCloudTool('refresh authorization')).isError).not.toBe(true)
    expect(mockEnsureToken).toHaveBeenLastCalledWith(true)
    expect(mockFetch.mock.calls[1][1].headers.Authorization).toBe('Bearer refreshed-token')
  })

  it('uses the stored cloud API credential when token refresh is unavailable', async () => {
    mockEnsureToken.mockRejectedValue(new Error('no refresh token'))
    mockStoreGet.mockImplementation((key) => key === 'auth.vectcut_api_key' ? 'stored-credential' : undefined)
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ total: 0, totalHits: 0, hits: [] })))
    expect((await callCloudTool('stored authorization')).isError).not.toBe(true)
    expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer stored-credential')
  })

  it('does not share cached cloud results between credentials or serve them after logout', async () => {
    mockFetch.mockImplementation(async () => new Response(JSON.stringify({ total: 0, totalHits: 0, hits: [] })))
    await callCloudTool('account-specific cache')
    mockEnsureToken.mockResolvedValue('other-account-token')
    await callCloudTool('account-specific cache')
    expect(mockFetch).toHaveBeenCalledTimes(2)
    mockEnsureToken.mockRejectedValue(new Error('signed out'))
    expect((await callCloudTool('account-specific cache')).isError).toBe(true)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('never sends cloud login credentials to custom search hosts', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ total: 0, totalHits: 0, hits: [] })))
    await client.callTool({ name: 'search_images', arguments: { q: 'untrusted host' } })
    expect(mockEnsureToken).not.toHaveBeenCalled()
    expect(mockFetch.mock.calls[0][1].headers).toBeUndefined()
  })

  it('keeps only media references and bounded metadata instead of inline or arbitrary upstream data', async () => {
    const inline = `data:image/png;base64,${'A'.repeat(32 * 1024)}`
    const hit = { id: 21, tags: 'x'.repeat(2000), previewURL: inline, imageURL: 'https://cdn.example/image.jpg',
      vectorURL: 'javascript:alert(1)', userImageURL: 'https://user:secret@cdn.example/avatar.jpg',
      rawOutput: { data: inline }, image_base64: inline, extra: { nested: inline },
      videos: { medium: { url: 'https://cdn.example/video.mp4', size: 5_000_000_000, width: 1920, height: 1080,
        thumbnail: inline, data: inline }, large: { url: 'data:video/mp4;base64,AAAA' } } }
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ total: 1, totalHits: 1, hits: [hit] })))
    const result = await client.callTool({ name: 'search_videos', arguments: { q: 'flower' } })
    expect(result.isError).not.toBe(true)
    const projected = (result.structuredContent as any).hits[0]
    expect(projected).toEqual({ id: 21, tags: 'x'.repeat(512), imageURL: hit.imageURL,
      videos: { medium: { url: hit.videos.medium.url, size: 5_000_000_000, width: 1920, height: 1080 } } })
    expect(JSON.stringify(result)).not.toMatch(/base64|secret|javascript:|rawOutput/)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it.each(['search_images', 'search_videos'])('offloads large %s results before they enter PI history, without fetching the media', async name => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'media-search-results-'))
    try {
      const hits = Array.from({ length: 200 }, (_, id) => ({ id, pageURL: `https://pixabay.com/assets/${id}/`,
        tags: 'nature, landscape, mountains, sky',
        ...(name === 'search_images' ? { previewURL: `https://cdn.example/${id}.jpg`, largeImageURL: `https://cdn.example/${id}-large.jpg` }
          : { duration: 20, videos: { medium: { url: `https://cdn.example/${id}.mp4`, width: 1920, height: 1080, size: 5_000_000_000 } } }) }))
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ total: 500, totalHits: 500, hits })))
      const result = await client.callTool({ name, arguments: { q: 'mountains', per_page: 200 } })
      expect(result.isError).not.toBe(true)
      const preserved = await preserveMcpResult({ content: result.content, structuredContent: result.structuredContent }, workspace)
      const context = projectMcpArtifactForContext(preserved, workspace)!
      expect(context).toBeDefined()
      expect(Buffer.byteLength(JSON.stringify(context))).toBeLessThan(16 * 1024)
      expect(context.details).not.toHaveProperty('hits')
      const artifact = context.details.artifact as { file_path: string; bytes: number }
      const saved = JSON.parse(await readFile(artifact.file_path, 'utf8'))
      expect(saved.structuredContent.hits).toEqual(hits)
      expect(artifact.bytes).toBeGreaterThan(16 * 1024)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    } finally { await rm(workspace, { recursive: true, force: true }) }
  })

  it.each([false, true])('rejects oversized responses with or without a declared length (header=%s)', async withHeader => {
    const oversized = JSON.stringify({ total: 1, totalHits: 1, hits: [{ id: 1, data: 'A'.repeat(4 * 1024 * 1024) }] })
    mockFetch.mockImplementation(async () => new Response(oversized, withHeader ? { headers: { 'Content-Length': String(Buffer.byteLength(oversized)) } } : undefined))
    const request = { name: 'search_images', arguments: { q: 'flower' } }
    const result = await client.callTool(request)
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).toContain('reduce per_page')
    await client.callTool(request)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it.each([
    {}, { q: ' ' }, { q: 'a'.repeat(101) }, { id: '../secret' }, { q: 'flower', key: 'injected' },
    { q: 'flower', per_page: 2 }, { q: 'flower', page: 1.5 }, { q: 'flower', min_width: -1 },
    { q: 'flower', image_type: 'gif' }, { q: 'flower', colors: 'invisible' }, { q: 'flower', safesearch: 'true' }
  ])('rejects invalid image arguments without requesting the proxy: %j', async (args) => {
    const result = await client.callTool({ name: 'search_images', arguments: args })
    expect(result.isError).toBe(true)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('rejects image-only parameters in video searches', async () => {
    const result = await client.callTool({ name: 'search_videos', arguments: { q: 'flower', orientation: 'vertical' } })
    expect(result.isError).toBe(true)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('caches successful empty results for 24 hours, then refreshes', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    mockFetch.mockImplementation(async () => new Response(JSON.stringify({ total: 0, totalHits: 0, hits: [] })))
    const request = { name: 'search_images', arguments: { q: 'flower' } }
    await client.callTool(request)
    now.mockReturnValue(1_000_000 + 24 * 60 * 60 * 1000 - 1)
    const cached = await client.callTool(request)
    expect(cached.structuredContent).toMatchObject({ hits: [] })
    expect(mockFetch).toHaveBeenCalledTimes(1)
    now.mockReturnValue(1_000_000 + 24 * 60 * 60 * 1000)
    await client.callTool(request)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('coalesces concurrent identical searches', async () => {
    let resolve!: (response: Response) => void
    mockFetch.mockImplementation(() => new Promise<Response>((done) => { resolve = done }))
    const request = { name: 'search_images', arguments: { q: 'flower' } }
    const first = client.callTool(request)
    const second = client.callTool(request)
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    resolve(new Response(JSON.stringify({ total: 0, totalHits: 0, hits: [] })))
    await Promise.all([first, second])
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('respects the proxy remaining max-age rather than extending cached URL freshness', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    mockFetch.mockImplementation(async () => new Response(JSON.stringify({ total: 0, totalHits: 0, hits: [] }), {
      headers: { 'Cache-Control': 'private,max-age=10' }
    }))
    const request = { name: 'search_images', arguments: { q: 'flower' } }
    await client.callTool(request)
    now.mockReturnValue(1_009_999)
    await client.callTool(request)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    now.mockReturnValue(1_010_000)
    await client.callTool(request)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it.each([429, 500, 403])('returns sanitized HTTP %i errors and does not cache failures', async (status) => {
    mockFetch.mockImplementation(async () => new Response('secret-api-key', { status }))
    const request = { name: 'search_images', arguments: { q: 'flower' } }
    const result = await client.callTool(request)
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).not.toContain('secret-api-key')
    await client.callTool(request)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('reports unavailable video search without exposing implementation details', async () => {
    mockFetch.mockResolvedValue(new Response('Not found', { status: 404 }))
    const result = await client.callTool({ name: 'search_videos', arguments: { q: 'flower' } })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).toContain('Video search is temporarily unavailable')
    expect(JSON.stringify(result)).not.toMatch(/pixabay|proxy|deploy/i)
  })

  it.each(['not JSON', JSON.stringify({ hits: [] }), JSON.stringify({ total: 1, totalHits: 1, hits: [null] })])('handles malformed upstream responses: %s', async (body) => {
    mockFetch.mockResolvedValue(new Response(body))
    expect((await client.callTool({ name: 'search_images', arguments: { q: 'flower' } })).isError).toBe(true)
  })

  it('handles network failures without leaking error details', async () => {
    mockFetch.mockRejectedValue(new Error('secret-api-key'))
    const result = await client.callTool({ name: 'search_images', arguments: { q: 'flower' } })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).toContain('failed or timed out')
    expect(JSON.stringify(result)).not.toContain('secret-api-key')
  })
})
