import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CallToolRequestSchema, CallToolResultSchema, ListToolsRequestSchema, type Tool } from '@modelcontextprotocol/sdk/types.js'
import { net } from 'electron'
import Store from 'electron-store'

import { agentRuntimeAuthService } from '../services/agents/services/AgentRuntimeAuthService'
import { ASSET_SEARCH_ROUTING, PUBLIC_FOOTAGE_RETRIEVAL_GUIDANCE, suggestYouTubeSearch, YOUTUBE_VIDEO_FALLBACK_GUIDANCE } from './asset-search-routing'
import { requestWithVectcutAuth } from './vectcut-auth'

const CONTEXT = 'Searching existing media assets to find suitable background material for an editing project while avoiding unnecessary custom generation costs.'
const GUIDANCE = 'You can also consider searching existing assets as a potentially cheaper alternative to AI generation, or try a search before generating custom media. Honor explicit AI generation requests. Search and details only; no automatic download or timeline insertion. Check the selected asset license and third-party rights before publication or redistribution; this is not a blanket restriction on searching or retrieving selected media. '
const MAX_BYTES = 4 * 1024 * 1024
const TOOL_MAP = {
  search_videos: 'get_videos',
  get_video: 'get_video',
  search_audios: 'get_audios',
  get_audio: 'get_audio'
} as const

const SEARCH_PROPERTIES = {
  query: { type: 'string', minLength: 1, maxLength: 200, description: 'Short search keywords; English keywords usually work well.' },
  page: { type: 'integer', minimum: 0, default: 0, description: 'Zero-based page number.' },
  page_size: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
  sort_by: { type: 'string', enum: ['date', 'popular'], description: 'Sort by newest or popularity.' }
}

const TOOLS: Tool[] = [
  {
    name: 'search_videos', title: '\u89c6\u9891\u641c\u7d22',
    description: 'Video-and-music library: choose video search when category, trending/popularity sorting or an is_vertical filter is useful, or when sourcing both footage and background music from one library. For ordinary filmed B-roll without these needs prefer footage-search.search_videos. Start with page=0 and page_size=3-5. Call this library\'s get_video only for a selected result whose required media references or metadata are missing. ' + ASSET_SEARCH_ROUTING + GUIDANCE,
    inputSchema: {
      type: 'object', properties: {
        ...SEARCH_PROPERTIES,
        sort_by: { ...SEARCH_PROPERTIES.sort_by, enum: ['date', 'popular', 'trending'] },
        category: { type: 'string', minLength: 1, maxLength: 128, description: 'Optional category slug.' },
        filter: { type: 'string', minLength: 1, maxLength: 512, description: 'Optional video filter, for example is_vertical:true.' }
      }, required: ['query'], additionalProperties: false
    }
  },
  {
    name: 'get_video', title: '\u89c6\u9891\u8be6\u60c5',
    description: 'Details for one selected stock-search video. Accept only an ID returned by stock-search.search_videos, never IDs from other libraries. Call only when the selected search result lacks required media URLs or metadata; do not fetch details for every hit or repeat a search to inspect the same asset. ' + GUIDANCE,
    inputSchema: { type: 'object', properties: { id: { type: 'string', minLength: 1, maxLength: 128, description: 'Video ID returned by video search.' } }, required: ['id'], additionalProperties: false }
  },
  {
    name: 'search_audios', title: '\u97f3\u9891\u641c\u7d22',
    description: 'Preferred existing-music search among these asset libraries: choose for background music, music beds and soundtrack tracks. Search using mood, genre or instrumentation keywords; start with page=0 and page_size=3-5. Do not query visual libraries for music. This is not speech/TTS or newly composed music. Do not assume dedicated sound effects are available. Get details only for a selected track whose required references or metadata are missing. ' + ASSET_SEARCH_ROUTING + GUIDANCE,
    inputSchema: { type: 'object', properties: SEARCH_PROPERTIES, required: ['query'], additionalProperties: false }
  },
  {
    name: 'get_audio', title: '\u97f3\u9891\u8be6\u60c5',
    description: 'Details for one selected stock-search music track, including preview/download references. Accept only an ID returned by stock-search.search_audios. Call only when required references or metadata are missing; do not fetch every track, repeat searches, or pass video IDs or IDs from other libraries. ' + GUIDANCE,
    inputSchema: { type: 'object', properties: { id: { type: 'string', minLength: 1, maxLength: 128, description: 'Audio ID returned by audio search.' } }, required: ['id'], additionalProperties: false }
  }
]
for (const tool of TOOLS) {
  tool.annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: true }
  if (tool.name === 'search_videos') tool.description = YOUTUBE_VIDEO_FALLBACK_GUIDANCE + tool.description
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function mediaUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 4096) return undefined
  try {
    const url = new URL(value)
    if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) return value
  } catch { /* Invalid media reference. */ }
  return undefined
}

function urlReferences(value: unknown, depth = 0): Record<string, unknown> {
  const result: Record<string, unknown> = Object.create(null)
  if (!record(value) || depth > 4) return result
  for (const [key, field] of Object.entries(value).slice(0, 32)) {
    const url = mediaUrl(field)
    if (url) result[key] = url
    else if (record(field)) {
      const nested = urlReferences(field, depth + 1)
      if (Object.keys(nested).length) result[key] = nested
    }
  }
  return result
}

function projectAsset(asset: Record<string, unknown>): Record<string, unknown> {
  const projected: Record<string, unknown> = {}
  for (const key of ['id', 'videoId', 'audioId', 'title', 'name', 'description', 'aspectRatio', 'tempo', 'slug']) {
    if (typeof asset[key] === 'string') projected[key] = asset[key].slice(0, key === 'description' ? 2048 : 256)
  }
  for (const key of ['duration', 'fps', 'maxHeight', 'maxWidth', 'downloads', 'views', 'likes', 'listens']) {
    const value = asset[key]
    const number = typeof value === 'string' && value.trim() ? Number(value) : value
    if (typeof number === 'number' && Number.isFinite(number) && number >= 0) projected[key] = number
  }
  for (const key of ['isVertical', 'isPremium', 'isAiGenerated']) {
    if (typeof asset[key] === 'boolean') projected[key] = asset[key]
  }
  for (const key of ['tags', 'genres', 'instruments', 'videoThemes', 'moods']) {
    if (Array.isArray(asset[key])) projected[key] = asset[key].filter((value) => typeof value === 'string').slice(0, 32).map((value: string) => value.slice(0, 128))
  }
  for (const key of ['poster', 'thumbnail', 'pageURL']) {
    const url = mediaUrl(asset[key])
    if (url) projected[key] = url
  }
  const urls = urlReferences(asset.urls)
  if (Object.keys(urls).length) projected.urls = urls
  return projected
}

function projectResult(raw: unknown, search: boolean): Record<string, unknown> {
  if (!record(raw)) throw new Error('Search returned an invalid result')
  if (!search) {
    const asset = record(raw.video) ? raw.video : record(raw.audio) ? raw.audio : raw
    const projected = projectAsset(asset)
    if (!projected.id) throw new Error('Media details returned an invalid result')
    return { asset: projected }
  }
  if (!Array.isArray(raw.hits) || raw.hits.length > 100 || !raw.hits.every(record)) throw new Error('Search returned invalid or too many results')
  const result: Record<string, unknown> = { hits: raw.hits.map(projectAsset) }
  for (const key of ['page', 'pages', 'pageSize', 'total']) {
    if (typeof raw[key] === 'number' && Number.isSafeInteger(raw[key]) && raw[key] >= 0) result[key] = raw[key]
  }
  return result
}

async function boundedResponse(response: Response): Promise<Response> {
  if (Number(response.headers.get('content-length')) > MAX_BYTES) {
    await response.body?.cancel()
    throw new Error('Search response is too large')
  }
  if (!response.body) return response
  const reader = response.body.getReader()
  let bytes = 0
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) { reader.releaseLock(); controller.close(); return }
        bytes += value.byteLength
        if (bytes > MAX_BYTES) {
          await reader.cancel()
          throw new Error('Search response is too large')
        }
        controller.enqueue(value)
      } catch (error) { controller.error(error) }
    },
    async cancel(reason: unknown) { await reader.cancel(reason) }
  })
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
}

export default class StockSearchServer {
  public readonly mcpServer: McpServer
  private readonly endpoint: URL
  private readonly store = new Store({ name: 'vectcut' })

  constructor(endpoint = process.env.STOCK_SEARCH_MCP_URL || 'https://open.vectcut.com/coverr/mcp') {
    this.endpoint = new URL(endpoint)
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(this.endpoint.hostname)
    if ((!local && this.endpoint.origin !== 'https://open.vectcut.com') ||
      !['http:', 'https:'].includes(this.endpoint.protocol) || this.endpoint.username || this.endpoint.password ||
      this.endpoint.search || this.endpoint.hash || this.endpoint.pathname !== '/coverr/mcp') {
      throw new Error('Stock search requires a trusted search endpoint or a local development endpoint')
    }
    this.mcpServer = new McpServer({ name: 'stock-search', version: '1.0.0' }, { capabilities: { tools: {} } })
    this.mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))
    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      let fallbackQuery: string | undefined
      try {
        const tool = TOOLS.find((item) => item.name === request.params.name)
        if (!tool) throw new Error('Unknown stock search tool')
        const args = this.validateArgs(tool, request.params.arguments ?? {})
        if (tool.name === 'search_videos') fallbackQuery = args.query as string
        const result = await this.callRemote(tool.name as keyof typeof TOOL_MAP, args, extra.signal)
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: result }
      } catch {
        // Never expose upstream provider names, raw JSON-RPC errors or credentials.
        const message = 'Stock media search failed. Check search parameters and login, or try again later.'
        const result = fallbackQuery && !extra.signal.aborted ? {
          error: message,
          suggestedNextSearch: suggestYouTubeSearch(fallbackQuery, 'The stock video search failed.')
        } : undefined
        return {
          content: [{ type: 'text' as const, text: result ? JSON.stringify(result) : message }],
          ...(result ? { structuredContent: result } : {}),
          isError: true
        }
      }
    })
  }

  private validateArgs(tool: Tool, args: Record<string, unknown>): Record<string, unknown> {
    const properties = tool.inputSchema.properties as Record<string, { type: string; minimum?: number; maximum?: number; minLength?: number; maxLength?: number; enum?: string[] }>
    const values: Record<string, unknown> = tool.name.startsWith('search_') ? { page: 0, page_size: 20, ...args } : { ...args }
    for (const [key, value] of Object.entries(values)) {
      const schema = properties[key]
      if (!schema) throw new Error('Unsupported search parameter')
      if (schema.type === 'integer') {
        if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (schema.minimum ?? 0) || value > (schema.maximum ?? Number.MAX_SAFE_INTEGER)) throw new Error('Invalid search parameter')
      } else {
        if (typeof value !== 'string') throw new Error('Invalid search parameter')
        const text = value.trim()
        if (text.length < (schema.minLength ?? 0) || text.length > (schema.maxLength ?? 512) || (schema.enum && !schema.enum.includes(text))) throw new Error('Invalid search parameter')
        values[key] = text
      }
    }
    for (const key of tool.inputSchema.required ?? []) if (!values[key]) throw new Error('Missing search parameter')
    return { ...values, context: CONTEXT }
  }

  private async callRemote(name: keyof typeof TOOL_MAP, args: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>> {
    // Keep each read-only operation in its own session, isolated across accounts and concurrent calls.
    const operationSignal = AbortSignal.any([signal, AbortSignal.timeout(95_000)])
    const client = new Client({ name: 'stock-search', version: '1.0.0' }, { capabilities: {} })
    const transport = new StreamableHTTPClientTransport(this.endpoint, {
      fetch: async (input, init) => {
        const url = new URL(input.toString())
        if (url.href !== this.endpoint.href) throw new Error('Unexpected search request destination')
        const signals = [operationSignal]
        if (init?.method === 'DELETE') signals.push(AbortSignal.timeout(5_000))
        if (init?.signal) signals.push(init.signal)
        const fetchWithToken = (token?: string) => {
          const headers = new Headers(init?.headers)
          if (token) headers.set('Authorization', `Bearer ${token}`)
          return net.fetch(url.href, { ...init, headers, redirect: 'error', signal: AbortSignal.any(signals) })
        }
        const response = this.endpoint.origin === 'https://open.vectcut.com'
          ? await requestWithVectcutAuth(this.store, (force) => agentRuntimeAuthService.ensureValidAccessToken(force), fetchWithToken)
          : await fetchWithToken()
        return boundedResponse(response)
      }
    })
    try {
      await client.connect(transport)
      const response = CallToolResultSchema.parse(await client.callTool({ name: TOOL_MAP[name], arguments: args }, undefined, { timeout: 95_000, signal: operationSignal }))
      if (response.isError) throw new Error('Search returned an error')
      let raw: unknown = response.structuredContent
      if (!raw) {
        const text = response.content.find((item) => item.type === 'text')
        if (!text || text.type !== 'text' || Buffer.byteLength(text.text, 'utf8') > MAX_BYTES) throw new Error('Invalid search response')
        raw = JSON.parse(text.text)
      }
      return { title: TOOLS.find((tool) => tool.name === name)!.title, mediaType: name.includes('video') ? 'video' : 'audio',
        usage: (name.includes('video') ? YOUTUBE_VIDEO_FALLBACK_GUIDANCE + PUBLIC_FOOTAGE_RETRIEVAL_GUIDANCE : '') +
          'Check the selected asset license and third-party rights before publication or redistribution; this is not a blanket restriction on searching or retrieving selected media. URLs are media references; no download or timeline insertion has been performed.',
        ...projectResult(raw, name.startsWith('search_')) }
    } finally {
      await transport.terminateSession().catch(() => {})
      await client.close().catch(() => {})
      await transport.close().catch(() => {})
    }
  }
}
