import { createHash } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from '@modelcontextprotocol/sdk/types.js'
import { net } from 'electron'
import Store from 'electron-store'

import { agentRuntimeAuthService } from '../services/agents/services/AgentRuntimeAuthService'
import { getStoredVectcutApiKey, requestWithVectcutAuth } from './vectcut-auth'

const LANGUAGES = ['cs', 'da', 'de', 'en', 'es', 'fr', 'id', 'it', 'hu', 'nl', 'no', 'pl', 'pt', 'ro', 'sk', 'fi', 'sv', 'tr', 'vi', 'th', 'bg', 'ru', 'el', 'ja', 'ko', 'zh']
const CATEGORIES = ['backgrounds', 'fashion', 'nature', 'science', 'education', 'feelings', 'health', 'people', 'religion', 'places', 'animals', 'industry', 'computer', 'food', 'sports', 'transportation', 'travel', 'buildings', 'business', 'music']
const COLORS = ['grayscale', 'transparent', 'red', 'orange', 'yellow', 'green', 'turquoise', 'blue', 'lilac', 'pink', 'white', 'gray', 'black', 'brown']
const SEARCH_GUIDANCE =
  'Search existing visual assets as a potentially cheaper alternative to AI generation. When a user needs an image, background, B-roll, overlay or sticker, you can also consider searching existing assets first, or try a search before generating a custom asset. This is a recommendation, not a requirement; honor explicit requests for AI generation. Search only, no automatic download or timeline insertion. Download selected images before permanent use and respect the license, attribution requirements and third-party rights of the returned source page. This service does not support music, sound effects or GIF search. '

const COMMON_PROPERTIES = {
  q: { type: 'string', minLength: 1, maxLength: 100, description: 'Search keywords, not a long AI prompt. English keywords usually work well; set lang for other languages.' },
  lang: { type: 'string', enum: LANGUAGES, default: 'en' },
  id: { type: 'string', pattern: '^[0-9]+$', description: 'Retrieve a specific asset by ID instead of keywords.' },
  category: { type: 'string', enum: CATEGORIES },
  min_width: { type: 'integer', minimum: 0 },
  min_height: { type: 'integer', minimum: 0 },
  editors_choice: { type: 'boolean', default: false },
  safesearch: { type: 'boolean', default: true },
  order: { type: 'string', enum: ['popular', 'latest'], default: 'popular' },
  page: { type: 'integer', minimum: 1, default: 1 },
  per_page: { type: 'integer', minimum: 3, maximum: 200, default: 20 }
}

const TOOLS: Tool[] = [
  {
    name: 'search_images',
    title: '\u56fe\u7247\u641c\u7d22',
    description: 'Image search: find photos, illustrations, backgrounds and vector images. ' + SEARCH_GUIDANCE + 'For sticker or cutout candidates, try image_type="illustration" and colors="transparent"; transparency is not guaranteed. For SVG/vector candidates, try image_type="vector"; use vectorURL when available to download the vector file. Never label a raster preview as SVG.',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        ...COMMON_PROPERTIES,
        image_type: { type: 'string', enum: ['all', 'photo', 'illustration', 'vector'], default: 'all' },
        orientation: { type: 'string', enum: ['all', 'horizontal', 'vertical'], default: 'all' },
        colors: { type: 'string', description: `Comma-separated color filters: ${COLORS.join(', ')}.` }
      },
      anyOf: [{ required: ['q'] }, { required: ['id'] }],
      additionalProperties: false
    }
  },
  {
    name: 'search_videos',
    title: '\u89c6\u9891\u641c\u7d22',
    description: 'Video search: find footage, B-roll, animated backgrounds and video overlays. ' + SEARCH_GUIDANCE + 'Returns available MP4 versions with dimensions, size, thumbnails and duration. Animation videos are not GIF files.',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        ...COMMON_PROPERTIES,
        video_type: { type: 'string', enum: ['all', 'film', 'animation'], default: 'all' }
      },
      anyOf: [{ required: ['q'] }, { required: ['id'] }],
      additionalProperties: false
    }
  }
]

type SearchPayload = { total: number; totalHits: number; hits: Record<string, unknown>[] }
type CacheEntry = { expiresAt: number; payload: SearchPayload; bytes: number }
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024
const MAX_CACHE_BYTES = 16 * 1024 * 1024
// Shared across MCP connections so reconnecting does not repeat the same search.
const searchCache = new Map<string, CacheEntry>()
const pendingSearches = new Map<string, Promise<CacheEntry>>()
const MAX_CACHE_ENTRIES = 128

function mediaUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 4096) return undefined
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? value : undefined
  } catch { return undefined }
}

function projectSearchHit(hit: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  // Search results are references, never binary media or arbitrary upstream JSON.
  for (const key of ['pageURL', 'previewURL', 'webformatURL', 'largeImageURL', 'fullHDURL', 'imageURL', 'vectorURL', 'userImageURL']) {
    const url = mediaUrl(hit[key])
    if (url) result[key] = url
  }
  for (const key of ['id', 'user_id', 'previewWidth', 'previewHeight', 'webformatWidth', 'webformatHeight', 'imageWidth', 'imageHeight', 'imageSize', 'duration', 'views', 'downloads', 'collections', 'likes', 'comments']) {
    const value = hit[key]
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER) result[key] = value
  }
  for (const key of ['type', 'tags', 'user', 'picture_id']) {
    if (typeof hit[key] === 'string') result[key] = hit[key].slice(0, key === 'tags' ? 512 : 128)
  }
  if (hit.videos && typeof hit.videos === 'object' && !Array.isArray(hit.videos)) {
    const videos: Record<string, unknown> = {}
    for (const quality of ['large', 'medium', 'small', 'tiny']) {
      const rendition = (hit.videos as Record<string, unknown>)[quality]
      if (!rendition || typeof rendition !== 'object' || Array.isArray(rendition)) continue
      const fields = rendition as Record<string, unknown>
      const url = mediaUrl(fields.url)
      if (!url) continue
      const reference: Record<string, unknown> = { url }
      const thumbnail = mediaUrl(fields.thumbnail)
      if (thumbnail) reference.thumbnail = thumbnail
      for (const key of ['width', 'height', 'size']) {
        const value = fields[key]
        if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) reference[key] = value
      }
      videos[quality] = reference
    }
    result.videos = videos
  }
  return result
}

async function readSearchPayload(response: Response): Promise<SearchPayload> {
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel()
    throw new Error('Search response exceeds the size limit')
  }
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Search response has no body')
  const chunks: Buffer[] = []
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new Error('Search response exceeds the size limit')
      }
      chunks.push(Buffer.from(value))
    }
  } finally { reader.releaseLock() }
  return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8')) as SearchPayload
}

export default class MediaSearchServer {
  public readonly mcpServer: McpServer
  private readonly baseUrl: string
  private readonly requiresAuth: boolean
  private readonly store = new Store({ name: 'vectcut' })

  constructor(baseUrl = process.env.MEDIA_SEARCH_BASE_URL || process.env.PIXABAY_PROXY_BASE_URL || 'https://open.vectcut.com') {
    const url = new URL(baseUrl)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error('Search service URL must be an HTTP(S) base URL without credentials, query or fragment')
    }
    this.baseUrl = url.toString().replace(/\/$/, '')
    // Only attach login credentials to the trusted cloud origin, never custom hosts.
    this.requiresAuth = url.origin === 'https://open.vectcut.com'
    this.mcpServer = new McpServer({ name: 'media-search', version: '1.0.0' }, { capabilities: { tools: {} } })
    this.mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))
    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const tool = TOOLS.find((item) => item.name === request.params.name)
        if (!tool) throw new Error(`Unknown tool: ${request.params.name}`)
        const params = this.validateParams(tool, request.params.arguments ?? {})
        const kind = tool.name === 'search_videos' ? 'video' : 'image'
        const endpoint = kind === 'video' ? '/pixabay/videos/search' : '/pixabay/search'
        const payload = await this.fetchSearch(`${this.baseUrl}${endpoint}?${params}`)
        const result = {
          title: kind === 'video' ? '\u89c6\u9891\u641c\u7d22' : '\u56fe\u7247\u641c\u7d22',
          mediaType: kind,
          licenseURL: 'https://pixabay.com/service/license-summary/',
          usage: 'Download selected images before permanent use. Respect the license, attribution requirements and third-party rights of the returned source page. vectorURL, when present, is the vector download; raster previews are not SVG.',
          page: Number(params.get('page')),
          per_page: Number(params.get('per_page')),
          ...payload
        }
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: result }
      } catch (error) {
        return { content: [{ type: 'text' as const, text: error instanceof Error ? error.message : 'Image or video search failed' }], isError: true }
      }
    })
  }

  private validateParams(tool: Tool, args: Record<string, unknown>): URLSearchParams {
    const properties = tool.inputSchema.properties as Record<string, { type: string; enum?: string[]; minimum?: number; maximum?: number; default?: unknown }>
    const values: Record<string, unknown> = { lang: 'en', safesearch: true, order: 'popular', page: 1, per_page: 20, ...args }
    for (const [key, value] of Object.entries(values)) {
      const schema = properties[key]
      if (!schema) throw new Error(`Unsupported parameter: ${key}`)
      if (schema.type === 'integer') {
        if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (schema.minimum ?? 0) || value > (schema.maximum ?? Number.MAX_SAFE_INTEGER)) {
          throw new Error(`Invalid integer parameter: ${key}`)
        }
      } else if (typeof value !== schema.type || (schema.enum && !schema.enum.includes(value as string))) {
        throw new Error(`Invalid parameter: ${key}`)
      }
      if (typeof value === 'string') values[key] = value.trim()
    }
    if (values.q !== undefined && (!(values.q as string).length || Array.from(values.q as string).length > 100)) {
      throw new Error('q must contain 1-100 characters')
    }
    if (values.id !== undefined && !/^\d+$/.test(values.id as string)) throw new Error('id must be a numeric asset ID')
    if (!values.q && !values.id) throw new Error('Provide q or id to avoid an unbounded browse request')
    if (values.colors !== undefined && !(values.colors as string).split(',').every((color) => COLORS.includes(color.trim()))) {
      throw new Error('Invalid colors filter')
    }
    const params = new URLSearchParams()
    for (const key of Object.keys(values).sort()) params.set(key, String(values[key]))
    return params
  }

  private async fetchSearch(url: string): Promise<SearchPayload> {
    let token: string | undefined
    if (this.requiresAuth) {
      try {
        token = await agentRuntimeAuthService.ensureValidAccessToken()
      } catch {
        token = getStoredVectcutApiKey(this.store)
      }
      if (!token) throw new Error('Please sign in before searching images or videos')
    }
    // Validate login before cache access and isolate results by credential without storing it.
    const cacheKey = token ? `${createHash('sha256').update(token).digest('hex')}:${url}` : url
    const cached = searchCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) return cached.payload
    searchCache.delete(cacheKey)
    const pending = pendingSearches.get(cacheKey)
    if (pending) return (await pending).payload
    const task = this.requestSearch(url, token)
    pendingSearches.set(cacheKey, task)
    try {
      const entry = await task
      for (const [key, entry] of searchCache) {
        if (entry.expiresAt <= Date.now()) searchCache.delete(key)
      }
      let cacheBytes = [...searchCache.values()].reduce((total, cached) => total + cached.bytes, 0)
      while (searchCache.size && (searchCache.size >= MAX_CACHE_ENTRIES || cacheBytes + entry.bytes > MAX_CACHE_BYTES)) {
        const oldest = searchCache.keys().next().value!
        cacheBytes -= searchCache.get(oldest)!.bytes
        searchCache.delete(oldest)
      }
      if (entry.expiresAt > Date.now()) searchCache.set(cacheKey, entry)
      return entry.payload
    } finally {
      pendingSearches.delete(cacheKey)
    }
  }

  private async requestSearch(url: string, token?: string): Promise<CacheEntry> {
    let response: Response
    try {
      const signal = AbortSignal.timeout(185_000)
      const fetchWithToken = (credential?: string) => net.fetch(url, {
        method: 'GET',
        redirect: 'error',
        signal,
        ...(credential ? { headers: { Authorization: `Bearer ${credential}` } } : {})
      })
      response = token
        ? await requestWithVectcutAuth(
          this.store,
          (force) => force ? agentRuntimeAuthService.ensureValidAccessToken(true) : Promise.resolve(token),
          fetchWithToken
        )
        : await fetchWithToken()
    } catch {
      throw new Error('Image or video search failed or timed out; try again later')
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error('Search authorization failed; please sign in again')
      if (response.status === 429) throw new Error('Search requests are too frequent; try again later instead of repeatedly retrying')
      if (response.status === 404 && new URL(url).pathname.endsWith('/videos/search')) {
        throw new Error('Video search is temporarily unavailable; try again later')
      }
      // Upstream error bodies may contain credentials; never echo them to the agent.
      throw new Error(`Image or video search is unavailable (HTTP ${response.status})`)
    }
    // Respect the proxy's remaining freshness instead of restarting its 24h TTL.
    const maxAge = response.headers.get('cache-control')?.match(/(?:^|,)\s*max-age=(\d+)/i)
    const ttlMs = maxAge ? Math.min(Number(maxAge[1]) * 1000, CACHE_TTL_MS) : CACHE_TTL_MS
    const expiresAt = Date.now() + ttlMs
    let payload: SearchPayload
    try {
      payload = await readSearchPayload(response)
    } catch {
      throw new Error('Image or video search returned an unreadable or oversized result; reduce per_page and try again')
    }
    if (!payload || !Array.isArray(payload.hits) || !Number.isFinite(payload.total) || !Number.isFinite(payload.totalHits) ||
      !payload.hits.every((hit) => hit && typeof hit === 'object' && !Array.isArray(hit))) {
      throw new Error('Image or video search returned an invalid result; try again later')
    }
    if (payload.hits.length > 200) throw new Error('Image or video search returned too many results; reduce per_page and try again')
    const projected = { total: payload.total, totalHits: payload.totalHits, hits: payload.hits.map(projectSearchHit) }
    return { expiresAt, payload: projected, bytes: Buffer.byteLength(JSON.stringify(projected), 'utf8') }
  }
}
