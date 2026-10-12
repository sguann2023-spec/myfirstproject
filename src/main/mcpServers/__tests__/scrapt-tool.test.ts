import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv'
import catalog from '../scrapt-catalog.json'

const { fetchMock, tokenMock } = vi.hoisted(() => ({ fetchMock: vi.fn(), tokenMock: vi.fn() }))
vi.mock('electron', () => ({ net: { fetch: fetchMock } }))
vi.mock('@main/services/agents/services/AgentRuntimeAuthService', () => ({
  agentRuntimeAuthService: { ensureValidAccessToken: tokenMock }
}))
import ScraptToolServer, { buildScraptRequest, SCRAPT_TOOLS } from '../scrapt-tool'

function handler(server: ScraptToolServer, method: string) {
  return (server.mcpServer.server as any)._requestHandlers.get(method)
}
function call(name: string, args: Record<string, unknown>, signal = new AbortController().signal) {
  return handler(new ScraptToolServer(), 'tools/call')({
    method: 'tools/call', params: { name, arguments: args }
  }, { signal })
}

describe('Bundled social-media tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tokenMock.mockResolvedValue('user-jwt')
  })

  it('lists 998 functional tools locally, without the generic tool or provider branding', async () => {
    const result = await handler(new ScraptToolServer(), 'tools/list')({ method: 'tools/list' }, {})
    expect(result.tools).toHaveLength(998)
    expect(catalog.count).toBe(998)
    expect(new Set(result.tools.map((tool: any) => tool.name)).size).toBe(998)
    expect(result.tools.some((tool: any) => tool.name === 'scrapt_request')).toBe(false)
    expect(JSON.stringify(result)).not.toMatch(/tikhub/i)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(tokenMock).not.toHaveBeenCalled()
  })

  it('has a real fixed route for every tool and compilable schemas', () => {
    const validator = new AjvJsonSchemaValidator()
    for (const entry of catalog.entries) {
      expect(entry.route.path).toMatch(/^\/api\/v1\//)
      expect(entry.route.method).toMatch(/^(GET|POST)$/)
      expect(() => validator.getValidator(entry.tool.inputSchema)).not.toThrow()
      expect(JSON.stringify(entry.tool)).not.toContain('$ref')
    }
  })

  it('forwards individual tool arguments to the backend and returns raw text', async () => {
    const text = '{ "code": 200, "data": {"title":"中文"} }'
    fetchMock.mockResolvedValue(new Response(text))
    const result = await call('douyin_web_fetch_one_video', { aweme_id: '123', need_anchor_info: false })
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('https://open.vectcut.com/scrapt/proxy/api/v1/douyin/web/fetch_one_video?aweme_id=123&need_anchor_info=false')
    expect(options.headers.Authorization).toBe('Bearer user-jwt')
    expect(options.headers['X-Client-Type']).toBe('desktop')
    expect(options.redirect).toBe('error')
    expect(result.content[0].text).toBe(text)
    expect(result.isError).toBeUndefined()
  })

  it('maps legacy Instagram names to actual v1 routes', () => {
    const built = buildScraptRequest('instagram_fetch_user_info_by_username', { username: 'example' })
    expect(new URL(built.url).pathname).toBe('/scrapt/proxy/api/v1/instagram/v1/fetch_user_info_by_username')
  })

  it('exposes REST parameter guidance without rewriting explicit arguments', () => {
    const tool = SCRAPT_TOOLS.find((item) => item.name === 'tiktok_web_fetch_search_video')!
    expect(tool.inputSchema.properties?.count).toMatchObject({
      default: 20,
      description: expect.stringContaining('default of 20')
    })
    expect(tool.inputSchema.properties?.search_id).toMatchObject({
      description: expect.stringContaining('paging')
    })
    const built = buildScraptRequest(tool.name, { keyword: 'outfit fashion', count: 25 })
    expect(new URL(built.url).searchParams.get('count')).toBe('25')
  })

  it('preserves case-sensitive algorithm route names', () => {
    const entry = catalog.entries.find((item) => item.tool.name === 'tiktok_web_generate_real_mstoken')!
    expect(entry.route.path).toBe('/api/v1/tiktok/web/generate_real_msToken')
  })

  it('recovers missing POST fields from the API contract and sends JSON', async () => {
    const tool = SCRAPT_TOOLS.find((item) => item.name === 'tiktok_web_fetch_home_feed')!
    expect(tool.inputSchema.properties).toHaveProperty('count')
    fetchMock.mockResolvedValue(new Response('{"code":200}'))
    await call('tiktok_web_fetch_home_feed', { count: 12, region: 'US', cookie: '' })
    const [, options] = fetchMock.mock.calls[0]
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toEqual({ count: 12, region: 'US', cookie: '' })
    expect(options.headers['Content-Type']).toBe('application/json')
  })

  it('rejects missing, invalid and extra arguments before authentication', async () => {
    for (const args of [{}, { aweme_id: 123 }, { aweme_id: '123', path: '/api/v1/example' }]) {
      await expect(call('douyin_web_fetch_one_video', args)).rejects.toThrow()
    }
    await expect(call('scrapt_request', { path: '/api/v1/example' })).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(tokenMock).not.toHaveBeenCalled()
  })

  it('omits all upstream service-account tools and rejects their old names', async () => {
    const accounts = catalog.entries.filter((entry) => entry.route.path.startsWith('/api/v1/tikhub/user/'))
    expect(accounts).toHaveLength(0)
    for (const name of [
      'media_user_get_user_info', 'media_user_get_user_daily_usage',
      'media_user_calculate_price', 'media_user_get_tiered_discount_info',
      'media_user_get_endpoint_info', 'media_user_get_all_endpoints_info'
    ]) {
      expect(SCRAPT_TOOLS.some((tool) => tool.name === name)).toBe(false)
      await expect(call(name, {})).rejects.toThrow('Unknown tool')
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('marks HTTP and business errors without changing response text', async () => {
    for (const [status, text] of [[402, '{"errorcode":"VERIFY_DENIED"}'], [200, '{"code":400}']] as const) {
      fetchMock.mockResolvedValue(new Response(text, { status }))
      const result = await call('douyin_web_fetch_one_video', { aweme_id: '123' })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toBe(text)
    }
  })

  it('preserves proxy billing metadata alongside raw output', async () => {
    const billing = { total_consumed_points: 2.5, status: 'queued', request_id: 'scrapt:test' }
    fetchMock.mockResolvedValue(new Response('raw response', {
      headers: { 'X-VectCut-Billing': JSON.stringify(billing) }
    }))
    const result = await call('douyin_web_fetch_one_video', { aweme_id: '123' })
    expect(result.content[0].text).toBe('raw response')
    expect(result.structuredContent).toEqual({ billing })
  })

  it('refreshes only on local authentication rejection', async () => {
    tokenMock.mockResolvedValueOnce('expired').mockResolvedValueOnce('fresh')
    fetchMock.mockResolvedValueOnce(new Response('{"errorcode":"UNAUTHORIZED"}', { status: 401 }))
      .mockResolvedValueOnce(new Response('{"code":200}'))
    await call('douyin_web_fetch_one_video', { aweme_id: '123' })
    expect(tokenMock).toHaveBeenLastCalledWith(true)
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer fresh')
  })

  it('does not retry upstream errors or network failures', async () => {
    for (const status of [401, 503]) {
      fetchMock.mockClear()
      fetchMock.mockResolvedValue(new Response('{"code":401}', { status }))
      await call('douyin_web_fetch_one_video', { aweme_id: '123' })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
    fetchMock.mockClear()
    fetchMock.mockRejectedValue(new Error('https://provider.example secret-token'))
    const result = await call('douyin_web_fetch_one_video', { aweme_id: '123' })
    expect(result.content[0].text).not.toMatch(/provider|secret-token/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('stops cancelled calls before authentication', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await call('douyin_web_fetch_one_video', { aweme_id: '123' }, controller.signal)
    expect(result.isError).toBe(true)
    expect(tokenMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('extracts billing from JSON when the gateway omits the billing header', async () => {
    const billing = { total_consumed_points: 2, status: 'queued' }
    const text = JSON.stringify({ billing, code: 200, data: {} })
    fetchMock.mockResolvedValue(new Response(text))
    const result = await call('douyin_web_fetch_one_video', { aweme_id: '123' })
    expect(result.structuredContent).toEqual({ billing })
    expect(result.content[0].text).toBe(text)
  })
})
