import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetch, mockRefresh, mockStoreGet, mockStoreSet } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockRefresh: vi.fn(),
  mockStoreGet: vi.fn(),
  mockStoreSet: vi.fn()
}))

vi.mock('@main/services/agents/services/AgentRuntimeAuthService', () => ({
  agentRuntimeAuthService: { ensureValidAccessToken: mockRefresh }
}))
vi.mock('@main/services/network/MainHttpClient', () => ({
  mainHttpClient: { fetch: mockFetch }
}))
vi.mock('@main/services/OssUploadService', () => ({
  ossUploadService: { uploadLocalFile: vi.fn() }
}))
vi.mock('electron-store', () => ({
  default: class {
    get = mockStoreGet
    set = mockStoreSet
  }
}))
vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ error: vi.fn() }) }
}))

import VoiceLibraryServer from '../voice-library'

async function callTool(server: VoiceLibraryServer, args: Record<string, unknown> = {}, name = 'list_voices') {
  const handlers = (server.mcpServer.server as any)._requestHandlers
  return handlers.get('tools/call')({ method: 'tools/call', params: { name, arguments: args } }, {})
}

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

describe('VoiceLibraryServer', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockRefresh.mockResolvedValue('access-token')
    mockFetch.mockResolvedValue(jsonResponse({ success: true, items: [] }))
  })

  it('exposes read-only queries and a non-idempotent clone tool', async () => {
    const server = new VoiceLibraryServer()
    const handlers = (server.mcpServer.server as any)._requestHandlers
    const result = await handlers.get('tools/list')({ method: 'tools/list', params: {} }, {})
    expect(result.tools.map((tool: any) => tool.name)).toEqual(['list_voices', 'get_voice_filter_options', 'clone_voice'])
    expect(result.tools.slice(0, 2).every((tool: any) => tool.annotations.readOnlyHint)).toBe(true)
    expect(result.tools[2].annotations).toMatchObject({ readOnlyHint: false, idempotentHint: false })
  })

  it('queries backend defaults without storing voice selections', async () => {
    const server = new VoiceLibraryServer()
    await callTool(server)
    expect(mockFetch).toHaveBeenCalledWith('https://open.vectcut.com/llm/tts/voice_library', {
      method: 'GET', headers: { Authorization: 'Bearer access-token' }
    })
    expect(mockStoreSet).not.toHaveBeenCalled()
  })

  it('encodes all filters, multiple providers and pagination while preserving backend fields', async () => {
    const backend = {
      success: true,
      filters: { keyword: '中文 & narration' },
      pagination: { limit: 100, offset: 20, total: 123 },
      items: [{
        global_voice_id: 'gv_test',
        providers: 'minimax,elevenlabs',
        try_listen_url: 'https://example.com/listen.mp3',
        tts_price: 4.8,
        extra_field: 'preserved'
      }]
    }
    mockFetch.mockResolvedValueOnce(jsonResponse(backend))
    const args = {
      provider: 'minimax,elevenlabs', gender: 'Female', language: 'zh',
      locale: 'zh-CN', style: 'narration', keyword: ' 中文 & narration ',
      global_voice_id: 'gv_test', sort_type: 'hot', only_active: false, limit: 100, offset: 20
    }
    const result = await callTool(new VoiceLibraryServer(), args)
    const url = new URL(mockFetch.mock.calls[0][0])
    expect(Object.fromEntries(url.searchParams)).toEqual(
      Object.fromEntries(Object.entries(args).map(([key, value]) => [key, String(value).trim()]))
    )
    expect(JSON.parse(result.content[0].text)).toEqual({ provider: 'vectcut', action: 'list_voices', ...backend })
  })

  it('queries available filters on the separate backend endpoint', async () => {
    const backend = { success: true, options: { language: ['zh'] }, readable_language: { zh: 'Chinese' } }
    mockFetch.mockResolvedValueOnce(jsonResponse(backend))
    const result = await callTool(new VoiceLibraryServer(), {
      provider: 'fish', gender: 'Male', language: 'zh', only_active: false
    }, 'get_voice_filter_options')
    const url = new URL(mockFetch.mock.calls[0][0])
    expect(url.pathname).toBe('/llm/tts/voice_library/filter_options')
    expect(url.searchParams.get('only_active')).toBe('false')
    expect(JSON.parse(result.content[0].text).options).toEqual(backend.options)
  })

  it.each([
    { limit: 0 }, { limit: 101 }, { limit: 1.5 }, { limit: '20' },
    { offset: -1 }, { offset: NaN }, { only_active: 'false' },
    { keyword: null }, { provider: ['fish'] }, { sort_type: 'invalid' },
    { endpoint: '/other' }
  ])('rejects invalid parameters before authentication: %j', async (args) => {
    const result = await callTool(new VoiceLibraryServer(), args)
    expect(result.isError).toBe(true)
    expect(mockRefresh).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('rejects list-only fields and multiple providers for filter options', async () => {
    const server = new VoiceLibraryServer()
    for (const args of [{ keyword: 'test' }, { provider: 'fish,minimax' }]) {
      const result = await callTool(server, args, 'get_voice_filter_options')
      expect(result.isError).toBe(true)
    }
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('refreshes authentication once when backend rejects the token', async () => {
    mockRefresh.mockResolvedValueOnce('old-token').mockResolvedValueOnce('new-token')
    mockFetch.mockResolvedValueOnce(jsonResponse({}, 401)).mockResolvedValueOnce(jsonResponse({ success: true, items: [] }))
    const result = await callTool(new VoiceLibraryServer(), { limit: 1, offset: 0 })
    expect(result.isError).not.toBe(true)
    expect(mockRefresh.mock.calls).toEqual([[undefined], [true]])
    expect(mockFetch.mock.calls.map(([, init]) => init.headers.Authorization)).toEqual(['Bearer old-token', 'Bearer new-token'])
    expect(mockFetch.mock.calls[0][0]).toBe(mockFetch.mock.calls[1][0])
  })

  it('falls back to existing API-key authentication', async () => {
    mockRefresh.mockRejectedValue(new Error('No refresh token found'))
    mockStoreGet.mockImplementation((key: string) => key === 'auth.vectcut_api_key' ? 'api-key' : undefined)
    const result = await callTool(new VoiceLibraryServer())
    expect(result.isError).not.toBe(true)
    expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer api-key')
  })

  it('reports missing credentials without requesting the backend', async () => {
    mockRefresh.mockRejectedValue(new Error('Please sign in first'))
    const result = await callTool(new VoiceLibraryServer())
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Please sign in first')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it.each([
    [jsonResponse({ error: 'backend unavailable' }, 500), '500'],
    [jsonResponse({ success: false, error: 'query failed' }), 'query failed'],
    [new Response('not json'), 'Error:']
  ])('returns MCP errors for backend failures', async (response, message) => {
    mockFetch.mockResolvedValueOnce(response)
    const result = await callTool(new VoiceLibraryServer())
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain(message)
  })

  it('reports transport failures', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network unavailable'))
    const result = await callTool(new VoiceLibraryServer())
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('network unavailable')
  })

  it('rejects unknown tools without network access', async () => {
    const result = await callTool(new VoiceLibraryServer(), {}, 'unknown')
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Unknown tool')
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
