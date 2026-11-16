import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

const { fetchMock, tokenMock } = vi.hoisted(() => ({ fetchMock: vi.fn(), tokenMock: vi.fn() }))
vi.mock('electron', () => ({ net: { fetch: fetchMock } }))
vi.mock('@main/services/agents/services/AgentRuntimeAuthService', () => ({
  agentRuntimeAuthService: { ensureValidAccessToken: tokenMock }
}))
import DouyinShopSearchServer, { buildDouyinShopRequest, DOUYIN_SHOP_TOOLS } from '../douyin-shop-search'

const cases = [
  ['search_products', { keyword: '云南 酸笋', page: 2, search_id: 'next-id' }, 'item-search', { keyword: '云南 酸笋', page: '2', searchId: 'next-id' }],
  ['get_product_details', { item_id: '3808833285870715075' }, 'item-details', { itemId: '3808833285870715075' }],
  ['get_product_skus', { item_id: '123' }, 'item-sku', { itemId: '123' }],
  ['get_product_comments', { item_id: '123', page: 3 }, 'item-comments', { itemId: '123', page: '3' }],
  ['get_shop_products', { shop_id: '53582424', page: 1 }, 'shop-items', { shopId: '53582424', page: '1' }]
] as const

function handler(server: DouyinShopSearchServer, method: string) {
  return (server.mcpServer.server as any)._requestHandlers.get(method)
}
function call(name = 'search_products', args: Record<string, unknown> = { keyword: '酸笋' }, signal = new AbortController().signal) {
  return handler(new DouyinShopSearchServer(), 'tools/call')({ method: 'tools/call', params: { name, arguments: args } }, { signal })
}

describe('Douyin shop search MCP proxy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tokenMock.mockResolvedValue('user-jwt')
  })

  it('lists forty fixed billable tools with shared scrapt workflow and no auth request', async () => {
    const { tools } = await handler(new DouyinShopSearchServer(), 'tools/list')({ method: 'tools/list' }, {})
    expect(tools).toHaveLength(40)
    expect(new Set(tools.map((tool: any) => tool.name)).size).toBe(40)
    for (const tool of tools) {
      expect(tool.title).toBe('联网搜索：联网搜索PRO')
      expect(tool.description).toContain('scrapt')
      expect(tool.description).toContain('anchor_info.extra')
      expect(tool.description).toContain('project_id=48')
      expect(tool.description).toContain('不能归因给某位达人')
      expect(tool.annotations.idempotentHint).toBe(false)
      expect(tool.inputSchema.additionalProperties).toBe(false)
    }
    tools[0].description = 'mutated'
    expect(DOUYIN_SHOP_TOOLS[0].description).not.toBe('mutated')
    expect(tokenMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(cases)('maps %s to the fixed FC GET path with provider parameter names', (name, args, path, query) => {
    const built = buildDouyinShopRequest(name, args)
    const url = new URL(built.url)
    expect(url.origin).toBe('https://open.vectcut.com')
    expect(url.pathname).toBe(`/justoneapi/douyin-ec/${path}`)
    expect(Object.fromEntries(url.searchParams)).toEqual(query)
    expect(built.method).toBe('GET')
  })

  it('rejects missing, invalid, wrong-type and injected arguments before authentication', async () => {
    const invalid: [string, Record<string, unknown>][] = [
      ['search_products', {}], ['search_products', { keyword: '   ' }],
      ['search_products', { keyword: 'a', page: '1' }], ['search_products', { keyword: 'a', page: 0 }],
      ['get_product_details', { item_id: 123 }], ['get_product_details', { item_id: 'https://v.douyin.com/x' }],
      ['get_shop_products', { shop_id: '12x' }], ['get_product_skus', { item_id: '1', token: 'provider-key' }],
      ['get_product_comments', { item_id: '1', user_id: 'other' }],
      ['search_products', { keyword: 'a', project_id: 1 }], ['search_products', { keyword: 'a', resource_amount: 0 }],
      ['search_products', { keyword: 'a', url: 'https://evil.example' }], ['get_product_skus_v1', { item_id: '1' }]
    ]
    for (const [name, args] of invalid) await expect(call(name, args)).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(tokenMock).not.toHaveBeenCalled()
  })

  it('preserves full code=0 response and queued billing without fabricating settled consumption', async () => {
    const billing = { status: 'queued', project_id: 48, billed_units: 1, estimated_points: 2, request_id: 'justoneapi:test' }
    const text = JSON.stringify({ code: 0, billing, data: { summary_promotions: [{ base_model: { product_info: { month_sale: { origin: 4700 } } } }] } })
    fetchMock.mockResolvedValue(new Response(text))
    const result = await call()
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toContain('/justoneapi/douyin-ec/item-search?')
    expect(options.headers).toEqual({ Authorization: 'Bearer user-jwt', Accept: 'application/json', 'X-Client-Type': 'desktop' })
    expect(options.redirect).toBe('error')
    expect(options.signal).toBeInstanceOf(AbortSignal)
    expect(result.content[0].text).toBe(text)
    expect(result.structuredContent).toEqual({ billing })
    expect(result.structuredContent.billing).not.toHaveProperty('total_consumed_points')
    expect(result.isError).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('recognizes code=0 (not scrapt code=200) and invalid JSON as errors without discarding text', async () => {
    for (const [status, text] of [[200, '{"code":601}'], [200, '{"code":200}'], [200, '{"code":0,"success":false}'], [200, 'not json'], [502, '{"code":0}'], [402, '{"errorcode":"VERIFY_DENIED"}']] as const) {
      fetchMock.mockResolvedValue(new Response(text, { status }))
      const result = await call()
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toBe(text)
    }
  })

  it('retains billing from headers and unknown enqueue state without resending success', async () => {
    const billing = { status: 'unknown', project_id: 48, request_id: 'r' }
    fetchMock.mockResolvedValue(new Response('{"code":0,"data":[]}', { headers: { 'X-VectCut-Billing': JSON.stringify(billing) } }))
    const result = await call()
    expect(result.structuredContent).toEqual({ billing })
    expect(result.isError).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('refreshes credentials only on our explicit pre-dispatch UNAUTHORIZED rejection', async () => {
    tokenMock.mockResolvedValueOnce('expired').mockResolvedValueOnce('fresh')
    fetchMock.mockResolvedValueOnce(new Response('{"errorcode":"UNAUTHORIZED"}', { status: 401 }))
      .mockResolvedValueOnce(new Response('{"code":0}'))
    expect((await call()).isError).toBeUndefined()
    expect(tokenMock).toHaveBeenLastCalledWith(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer fresh')
  })

  it('never retries provider errors, gateway errors or network timeouts and does not leak secrets', async () => {
    for (const [status, text] of [[401, '{"code":100}'], [400, '{"Code":"JWTTokenIsMissing"}'], [503, '{"code":503}']] as const) {
      fetchMock.mockClear()
      fetchMock.mockResolvedValue(new Response(text, { status }))
      await call()
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
    fetchMock.mockClear()
    fetchMock.mockRejectedValue(new Error('secret-provider-token https://api.justoneapi.com'))
    const result = await call()
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('不要自动重试')
    expect(result.content[0].text).not.toMatch(/secret-provider|api.justoneapi/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('stops pre-cancelled calls before authentication', async () => {
    const controller = new AbortController()
    controller.abort()
    expect((await call('search_products', { keyword: 'a' }, controller.signal)).isError).toBe(true)
    expect(tokenMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns a sign-in message when runtime credentials are missing', async () => {
    tokenMock.mockRejectedValue(new Error('No refresh token available'))
    const result = await call()
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('请先登录')
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('connects through the actual MCP SDK and exposes raw data plus billing', async () => {
    const server = new DouyinShopSearchServer()
    const client = new Client({ name: 'shop-test', version: '1.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    try {
      await server.mcpServer.connect(serverTransport)
      await client.connect(clientTransport)
      expect((await client.listTools()).tools).toHaveLength(40)
      expect(tokenMock).not.toHaveBeenCalled()
      fetchMock.mockResolvedValue(new Response(JSON.stringify({
        code: 0, data: { products: [{ product_id: '123', month_sales: 5 }] },
        billing: { status: 'queued', project_id: 48, estimated_points: 2 }
      })))
      const result = await client.callTool({ name: 'get_shop_products', arguments: { shop_id: '123' } })
      expect(result.isError).toBeUndefined()
      expect(result.structuredContent).toEqual({ billing: { status: 'queued', project_id: 48, estimated_points: 2 } })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      await client.close()
      await server.mcpServer.close()
    }
  })

  it('has 33 independently callable Xingtu tools plus seven identity/video/commerce tools', () => {
    const xingtu = DOUYIN_SHOP_TOOLS.filter(tool => new URL(buildDouyinShopRequest(tool.name,
      Object.fromEntries((tool.inputSchema.required || []).map(key => [key,
        key === 'keyword' ? '云南' : key.endsWith('_date') ? '2026-11-01' : '123']))).url).pathname.includes('/douyin-xingtu/'))
    expect(xingtu).toHaveLength(33)
    for (const tool of xingtu) {
      const args = Object.fromEntries((tool.inputSchema.required || []).map(key => [key,
        key.endsWith('_date') ? '2026-11-01' : '123']))
      expect(new URL(buildDouyinShopRequest(tool.name, args).url).origin).toBe('https://open.vectcut.com')
      for (const schema of Object.values(tool.inputSchema.properties || {})) {
        const property = schema as any
        if (property.enum && property.default !== undefined) expect(property.enum).toContain(property.default)
      }
    }
  })

  it('maps identity/video and Xingtu boolean/filter parameters to the real FC routes', () => {
    expect(buildDouyinShopRequest('search_users', { keyword: 'APYJ888', user_type: 'personal_user' }).url)
      .toBe('https://open.vectcut.com/justoneapi/douyin/user-search?keyword=APYJ888&userType=personal_user')
    expect(buildDouyinShopRequest('get_video_details', { video_id: '123' }).url)
      .toBe('https://open.vectcut.com/justoneapi/douyin/video-details?videoId=123')
    const live = new URL(buildDouyinShopRequest('get_live_statistics', {
      o_author_id: '123', period: 'DAY_90', live_type: 'ECOMMERCE', only_star_order: false, flow_type: 'INCLUDE'
    }).url)
    expect(live.pathname).toBe('/justoneapi/douyin-xingtu/live-statistics')
    expect(Object.fromEntries(live.searchParams)).toEqual({ oAuthorId: '123', period: 'DAY_90', liveType: 'ECOMMERCE', onlyStarOrder: 'false', flowType: 'INCLUDE' })
    expect(buildDouyinShopRequest('search_creators', { keyword: '', is_superstar: false }).url).toContain('isSuperstar=false')
  })

  it('rejects wrong author IDs, unsupported enums, duplicate naming, invalid dates and parameters', () => {
    for (const [name, args] of [
      ['get_live_statistics', { o_author_id: 'bad' }],
      ['get_live_statistics', { o_author_id: '123', period: '30' }],
      ['get_live_statistics', { o_author_id: '123', only_star_order: 'false' }],
      ['get_live_audience', { o_author_id: '123', period: 'DAY_30' }],
      ['get_conversion_analysis', { o_author_id: '123', platform: 'LIVE' }],
      ['get_daily_fans', { o_author_id: '123', start_date: '2026-02-30', end_date: '2026-03-01' }],
      ['get_daily_fans', { o_author_id: '123', start_date: '2026-11-02', end_date: '2026-11-01' }],
      ['get_creator_tags', { star_author_id: '123', token: 'evil' }],
      ['get_creator_profile', { o_author_id: '123', oAuthorId: '456' }]
    ] as [string, Record<string, unknown>][]) expect(() => buildDouyinShopRequest(name, args)).toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('marks known inner business failures as errors, but preserves missing metrics as data', async () => {
    for (const data of [{ base_resp: { status_code: 10005 } }, { status_code: 2 }]) {
      fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: 0, data })))
      expect((await call('get_live_statistics', { o_author_id: '123' })).isError).toBe(true)
    }
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: 0, data: { base_resp: { status_code: 0 }, avg_sales_amount_range: '-' } })))
    expect((await call('get_conversion_analysis', { o_author_id: '123' })).isError).toBeUndefined()
  })

  it('dispatches each of the forty tools once via its validated fixed route', async () => {
    for (const tool of DOUYIN_SHOP_TOOLS) {
      fetchMock.mockClear()
      fetchMock.mockResolvedValue(new Response('{"code":0,"data":{}}'))
      const args = Object.fromEntries((tool.inputSchema.required || []).map(key => [key,
        key === 'keyword' ? '云南' : key.endsWith('_date') ? '2026-11-01' : '123']))
      const result = await call(tool.name, args)
      expect(result.isError).toBeUndefined()
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock.mock.calls[0][0]).toBe(buildDouyinShopRequest(tool.name, args).url)
    }
  })

})
