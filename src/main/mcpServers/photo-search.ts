import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CallToolRequestSchema, CallToolResultSchema, ListToolsRequestSchema, type Tool } from '@modelcontextprotocol/sdk/types.js'
import { net } from 'electron'
import Store from 'electron-store'

import { agentRuntimeAuthService } from '../services/agents/services/AgentRuntimeAuthService'
import { ASSET_SEARCH_ROUTING } from './asset-search-routing'
import { getStoredVectcutApiKey, requestWithVectcutAuth } from './vectcut-auth'

const MAX_BYTES = 4 * 1024 * 1024
const PROTOCOL_VERSION = '2025-03-26'
const GUIDANCE = 'You can also consider searching existing photos as a potentially cheaper alternative to AI generation. Honor explicit AI generation requests. This service supports still photos only, not video, audio, GIF, SVG or guaranteed transparent stickers. Search and preview must not trigger a download registration. '
const USAGE = 'Preview images using the returned urls without removing query parameters such as ixid. Display photographer credits and source attribution links. Register use with track_download only after the user selects a photo for import, use or download; never on search or preview. Registration is not a media download and must not be automatically retried.'
const TOOL_MAP = { search_images: 'search_photos', get_image: 'get_photo', track_download: 'track_download' } as const
const PHOTO_ID = { type: 'string', pattern: '^[A-Za-z0-9_-]{1,128}$', minLength: 1, maxLength: 128 }
const TOOLS: Tool[] = [
  {
    name: 'search_images', title: '\u56fe\u7247\u641c\u7d22',
    description: 'Photo-only library: choose for photographic mood-board/background imagery or collection-based discovery using collections. For ordinary stock photography without collection needs prefer footage-search.search_images; use this as a photo-specific alternative when those results do not fit. Not an illustration or vector library. Start with per_page=3-5. Results include image versions and credits; request details only if required information is missing. Preserve original URLs and photographer and source credits. ' + ASSET_SEARCH_ROUTING + GUIDANCE,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: {
      type: 'object', properties: {
        query: { type: 'string', minLength: 1, maxLength: 500, description: 'Short photo search phrase; English keywords are recommended.' },
        page: { type: 'integer', minimum: 1, maximum: 10000, default: 1 },
        per_page: { type: 'integer', minimum: 1, maximum: 30, default: 10 },
        order_by: { type: 'string', enum: ['relevant', 'latest'], default: 'relevant' },
        orientation: { type: 'string', enum: ['landscape', 'portrait', 'squarish'] },
        color: { type: 'string', enum: ['black_and_white', 'black', 'white', 'yellow', 'orange', 'red', 'purple', 'magenta', 'green', 'teal', 'blue'] },
        content_filter: { type: 'string', enum: ['low', 'high'], default: 'high' },
        collections: { type: 'string', maxLength: 500, pattern: '^[A-Za-z0-9_-]+(,[A-Za-z0-9_-]+)*$' },
        lang: { type: 'string', pattern: '^[A-Za-z]{2,3}(-[A-Za-z]{2,4})?$', description: 'Optional language filter; availability depends on service configuration.' }
      }, required: ['query'], additionalProperties: false
    }
  },
  {
    name: 'get_image', title: '\u56fe\u7247\u8be6\u60c5',
    description: 'Details for one selected photo-search image, including versions, credits and links.download_location. Accept only a photo ID returned by photo-search.search_images. Call only if the selected result lacks required information; do not fetch every hit or use numeric IDs from other libraries. This is a read-only lookup, not a use registration. ' + GUIDANCE,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: { type: 'object', properties: { photo_id: { ...PHOTO_ID, description: 'Photo ID returned by image search.' } }, required: ['photo_id'], additionalProperties: false }
  },
  {
    name: 'track_download', title: '\u56fe\u7247\u4f7f\u7528\u767b\u8bb0',
    description: 'Usage event for a selected photo-search image only, not a search/detail tool or a media downloader. Call once only after the user explicitly chooses that photo for import/use/download; pass its exact links.download_location. Never register on search, preview, routing comparisons or assets from other libraries; never automatically retry. After an uncertain outcome confirm it before another attempt.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    inputSchema: {
      type: 'object', properties: {
        download_location: { type: 'string', minLength: 1, maxLength: 4096, description: 'Exact links.download_location returned for the selected photo, including original query parameters.' },
        user_selected: { type: 'boolean', const: true, description: 'Must be true only when the user has explicitly selected this photo for use.' }
      }, required: ['download_location', 'user_selected'], additionalProperties: false
    }
  }
]

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

function validDownloadLocation(value: string): boolean {
  try {
    const url = new URL(value)
    return /^[\x21-\x7e]+$/.test(value) && url.origin === 'https://api.unsplash.com' &&
      !url.username && !url.password && !url.hash && /^\/photos\/[A-Za-z0-9_-]{1,128}\/download$/.test(url.pathname) &&
      [...url.searchParams.keys()].every((key) => key === 'ixid')
  } catch { return false }
}

function projectPhoto(photo: Record<string, unknown>): Record<string, unknown> {
  if (typeof photo.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(photo.id) || !record(photo.urls)) throw new Error('Invalid photo result')
  const projected: Record<string, unknown> = { id: photo.id }
  for (const key of ['description', 'alt_description', 'color', 'blur_hash']) {
    if (typeof photo[key] === 'string') projected[key] = photo[key].slice(0, 2048)
  }
  for (const key of ['width', 'height', 'likes']) {
    if (typeof photo[key] === 'number' && Number.isSafeInteger(photo[key]) && photo[key] >= 0) projected[key] = photo[key]
  }
  const urls: Record<string, string> = {}
  for (const key of ['raw', 'full', 'regular', 'small', 'thumb', 'small_s3']) {
    const url = mediaUrl(photo.urls[key])
    if (url) urls[key] = url
  }
  projected.urls = urls
  if (record(photo.links)) {
    const links: Record<string, string> = {}
    const html = mediaUrl(photo.links.html)
    if (html) links.html = html
    if (typeof photo.links.download_location === 'string' && validDownloadLocation(photo.links.download_location)) links.download_location = photo.links.download_location
    projected.links = links
  }
  if (record(photo.user)) {
    const user: Record<string, unknown> = {}
    for (const key of ['id', 'name', 'username']) if (typeof photo.user[key] === 'string') user[key] = photo.user[key].slice(0, 256)
    const profile = record(photo.user.links) ? mediaUrl(photo.user.links.html) : undefined
    if (profile) user.links = { html: profile }
    projected.user = user
  }
  return projected
}

function projectResult(raw: unknown, name: keyof typeof TOOL_MAP): Record<string, unknown> {
  if (!record(raw) || !record(raw.response)) throw new Error('Invalid image search result')
  if (name === 'track_download') {
    const url = mediaUrl(raw.response.url)
    if (!url) throw new Error('Invalid registration result')
    return { registered: true, url, mediaDownloaded: false }
  }
  const result: Record<string, unknown> = { attribution_required: true, download_registration_required: true, usage: USAGE }
  if (name === 'search_images') {
    if (!Array.isArray(raw.response.results) || raw.response.results.length > 30 || !raw.response.results.every(record)) throw new Error('Invalid photo results')
    result.results = raw.response.results.map(projectPhoto)
    for (const key of ['total', 'total_pages']) if (typeof raw.response[key] === 'number' && Number.isSafeInteger(raw.response[key]) && raw.response[key] >= 0) result[key] = raw.response[key]
  } else result.photo = projectPhoto(raw.response)
  if (!Array.isArray(raw.attribution) || raw.attribution.length > 30 || !raw.attribution.every(record)) throw new Error('Missing photo attribution')
  result.attribution = raw.attribution.map((credit) => ({
    photo_id: typeof credit.photo_id === 'string' ? credit.photo_id.slice(0, 128) : undefined,
    photographer: typeof credit.photographer === 'string' ? credit.photographer.slice(0, 256) : undefined,
    photographer_url: mediaUrl(credit.photographer_url), source_url: mediaUrl(credit.unsplash_url)
  }))
  return result
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json') || Number(response.headers.get('content-length')) > MAX_BYTES) {
    await response.body?.cancel()
    throw new Error('Invalid endpoint response')
  }
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Missing endpoint response')
  const chunks: Buffer[] = []
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_BYTES) { await reader.cancel(); throw new Error('Image response is too large') }
      chunks.push(Buffer.from(value))
    }
  } finally { reader.releaseLock() }
  return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'))
}

export default class PhotoSearchServer {
  public readonly mcpServer: McpServer
  private readonly endpoint: URL
  private readonly store = new Store({ name: 'vectcut' })

  constructor(endpoint = process.env.PHOTO_SEARCH_MCP_URL || 'https://open.vectcut.com/unsplash/mcp') {
    this.endpoint = new URL(endpoint)
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(this.endpoint.hostname)
    if ((!local && this.endpoint.origin !== 'https://open.vectcut.com') || !['http:', 'https:'].includes(this.endpoint.protocol) ||
      this.endpoint.username || this.endpoint.password || this.endpoint.search || this.endpoint.hash || this.endpoint.pathname !== '/unsplash/mcp') {
      throw new Error('Photo search requires a trusted endpoint or a local development endpoint')
    }
    this.mcpServer = new McpServer({ name: 'photo-search', version: '1.0.0' }, { capabilities: { tools: {} } })
    this.mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))
    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const isRegistration = request.params.name === 'track_download'
      try {
        const tool = TOOLS.find((item) => item.name === request.params.name)
        if (!tool) throw new Error('Unknown image search tool')
        const args = this.validateArgs(tool, request.params.arguments ?? {})
        const name = tool.name as keyof typeof TOOL_MAP
        const signal = AbortSignal.any([extra.signal, AbortSignal.timeout(65_000)])
        // The endpoint is stateless: negotiate each operation without shared sessions or result caches.
        const initialized = await this.rpc('initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'photo-search', version: '1.0.0' } }, 1, signal)
        if (!record(initialized) || initialized.protocolVersion !== PROTOCOL_VERSION) throw new Error('Unsupported image search protocol')
        await this.rpc('notifications/initialized', {}, undefined, signal)
        const raw = CallToolResultSchema.parse(await this.rpc('tools/call', { name: TOOL_MAP[name], arguments: args }, 2, signal, isRegistration))
        if (raw.isError) throw new Error('Image operation failed')
        const text = raw.content.find((item) => item.type === 'text')
        const data = raw.structuredContent ?? (text?.type === 'text' ? JSON.parse(text.text) : undefined)
        const result = { title: tool.title, mediaType: 'image', ...projectResult(data, name) }
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: result }
      } catch {
        // Never echo provider names, raw error bodies or credentials.
        return { content: [{ type: 'text' as const, text: isRegistration
          ? 'Image use registration was not confirmed and was not automatically retried. Confirm the outcome before attempting another registration.'
          : 'Image search or details are unavailable. Check parameters, login and service deployment, or try again later.' }], isError: true }
      }
    })
  }

  private validateArgs(tool: Tool, args: Record<string, unknown>): Record<string, unknown> {
    const fields = tool.inputSchema.properties as Record<string, { type: string; minimum?: number; maximum?: number; minLength?: number; maxLength?: number; pattern?: string; enum?: string[] }>
    const values: Record<string, unknown> = tool.name === 'search_images' ? { page: 1, per_page: 10, order_by: 'relevant', content_filter: 'high', ...args } : { ...args }
    for (const [key, value] of Object.entries(values)) {
      if (!Object.prototype.hasOwnProperty.call(fields, key)) throw new Error('Unsupported image parameter')
      const field = fields[key]
      if (!field) throw new Error('Unsupported image parameter')
      if (field.type === 'integer') {
        if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < field.minimum! || value > field.maximum!) throw new Error('Invalid image parameter')
      } else if (field.type === 'boolean') {
        if (value !== true) throw new Error('User selection is required')
      } else {
        if (typeof value !== 'string') throw new Error('Invalid image parameter')
        const text = key === 'download_location' ? value : value.trim()
        if (Array.from(text).length < (field.minLength ?? 1) || Array.from(text).length > (field.maxLength ?? 4096) ||
          (field.pattern && !new RegExp(field.pattern).test(text)) || (field.enum && !field.enum.includes(text))) throw new Error('Invalid image parameter')
        values[key] = text
      }
    }
    for (const key of tool.inputSchema.required ?? []) if (values[key] === undefined) throw new Error('Missing image parameter')
    if (tool.name === 'track_download') {
      if (!validDownloadLocation(values.download_location as string)) throw new Error('Invalid download registration location')
      delete values.user_selected
    }
    return values
  }

  private async rpc(method: string, params: Record<string, unknown>, id: number | undefined, signal: AbortSignal, noRetry = false): Promise<unknown> {
    const body = JSON.stringify({ jsonrpc: '2.0', ...(id === undefined ? {} : { id }), method, params })
    const send = (token?: string) => net.fetch(this.endpoint.href, {
      method: 'POST', redirect: 'error', signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'MCP-Protocol-Version': PROTOCOL_VERSION,
        ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body
    })
    let response: Response
    if (this.endpoint.origin !== 'https://open.vectcut.com') response = await send()
    else if (!noRetry) response = await requestWithVectcutAuth(this.store, (force) => agentRuntimeAuthService.ensureValidAccessToken(force), send)
    else {
      let token: string
      try { token = await agentRuntimeAuthService.ensureValidAccessToken() }
      catch { token = getStoredVectcutApiKey(this.store) }
      if (!token) throw new Error('Login is required')
      // A registration records a non-idempotent event: send it exactly once, including on 401.
      response = await send(token)
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error('Image endpoint request failed') }
    if (id === undefined) {
      await response.body?.cancel()
      if (![202, 204].includes(response.status)) throw new Error('Invalid initialized notification response')
      return undefined
    }
    const message = await readJson(response)
    if (!record(message) || message.jsonrpc !== '2.0' || message.id !== id || message.error || !record(message.result)) throw new Error('Invalid image endpoint message')
    return message.result
  }
}
