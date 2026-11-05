import type { Tool } from '@modelcontextprotocol/sdk/types.js'

import { ASSET_SEARCH_ROUTING } from './asset-search-routing'
import StatelessMediaProxyServer, { isMediaRecord, mediaReference } from './media-proxy'

const TOOL_MAP = {
  search_images: 'search_ai_images',
  search_videos: 'search_ai_videos',
  get_image: 'get_ai_image',
  get_video: 'get_ai_video'
} as const
const AI_ORIGIN = 'All images and videos in this library are AI-generated, including photorealistic results. This is not a library of camera-shot photos or real-world recorded footage. Realistic appearance does not mean the depicted scene or event actually happened. '
const GUIDANCE = 'Search the shared library of already-generated AI assets, not just the current user\'s history. This does not generate new media. You can also consider reusing an existing asset as a potentially cheaper alternative to generating new media. Honor explicit AI generation requests. No generation, billing, download or timeline insertion is performed. Check reuse rights before using a selected asset. '
const SEARCH_FIELDS = {
  query: { type: 'string', minLength: 1, maxLength: 2000, description: 'Describe subject, scene and visual style for semantic search; use a known literal prompt fragment for keyword search.' },
  mode: { type: 'string', enum: ['semantic', 'keyword'], default: 'semantic', description: 'Use semantic for natural-language concepts/style matching. Use keyword only for a known literal prompt substring, newest first; do not run both modes by default.' },
  limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
  size: { type: 'string', minLength: 1, maxLength: 64 },
  model: { type: 'string', minLength: 1, maxLength: 255 }
}
const LOG_ID = { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER, description: 'Exact log_id returned by this library.' }
const TOOLS: Tool[] = [
  { name: 'search_images', title: '\u0041\u0049\u56fe\u7247\u641c\u7d22', description: 'Reuse library of already-generated AI images: choose for matching a described scene/style, stylized or imaginative imagery, or a known prompt fragment when reuse is acceptable. For ordinary real-world photos prefer footage-search.search_images. This is not generation/editing and cannot guarantee exact custom details, identity or reference-image consistency. Use semantic for concepts, keyword for a known literal prompt fragment; start with limit=3-5. Search returns usable image_url; details are optional. ' + ASSET_SEARCH_ROUTING + GUIDANCE },
  { name: 'search_videos', title: '\u0041\u0049\u89c6\u9891\u641c\u7d22', description: 'Reuse library of successful, already-generated AI videos: choose for matching described scenes/styles or prompt fragments when existing generated footage is acceptable. For ordinary filmed B-roll prefer footage-search.search_videos. This does not generate or extend clips, guarantee custom action/reference consistency, or filter by playback duration. Use semantic for concepts, keyword for a known literal prompt fragment; start with limit=3-5. Search returns usable video_url; details are optional. ' + ASSET_SEARCH_ROUTING + GUIDANCE },
  { name: 'get_image', title: '\u0041\u0049\u56fe\u7247\u8be6\u60c5', description: 'Details for one selected existing ai-library image. Accept only log_id from ai-library.search_images. Call only if required metadata is missing; reuse image_url from search otherwise. Do not query every result, pass other library IDs, or mistake log_id for a generation task ID. ' + GUIDANCE },
  { name: 'get_video', title: '\u0041\u0049\u89c6\u9891\u8be6\u60c5', description: 'Details for one selected existing ai-library video. Accept only log_id from ai-library.search_videos. Call only if required metadata is missing; reuse video_url otherwise. This is not task polling and does not supply playback duration; generation elapsed time is not video duration. Do not query every result or use other library IDs. ' + GUIDANCE }
].map(tool => ({
  ...tool,
  description: AI_ORIGIN + tool.description,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  inputSchema: {
    type: 'object', properties: tool.name.startsWith('search_') ? SEARCH_FIELDS : { log_id: LOG_ID },
    required: [tool.name.startsWith('search_') ? 'query' : 'log_id'], additionalProperties: false
  }
}))

function projectAsset(raw: unknown, video: boolean): Record<string, unknown> | undefined {
  if (!isMediaRecord(raw)) throw new Error('Invalid library asset')
  if (video && (typeof raw.status !== 'string' || !['success', 'succeeded', 'completed', 'done'].includes(raw.status.trim().toLowerCase()))) return undefined
  const urlField = video ? 'video_url' : 'image_url'
  const url = mediaReference(raw[urlField])
  if (typeof raw.log_id !== 'number' || !Number.isSafeInteger(raw.log_id) || raw.log_id < 1 || !url ||
    (raw.asset_type !== undefined && raw.asset_type !== (video ? 'video' : 'image'))) throw new Error('Invalid library asset')
  const asset: Record<string, unknown> = { log_id: raw.log_id, [urlField]: url }
  for (const [key, max] of [['prompt', 16000], ['size', 64], ['model', 255]] as const) {
    if (typeof raw[key] === 'string') asset[key] = raw[key].slice(0, max)
  }
  if (typeof raw.score === 'number' && Number.isFinite(raw.score)) asset.score = raw.score
  // duration_ms measures generation latency, not playback duration. Never expose it.
  return asset
}

function projectResult(raw: unknown, name: string, args: Record<string, unknown>): Record<string, unknown> {
  if (!isMediaRecord(raw)) throw new Error('Invalid library response')
  const video = name.endsWith('videos') || name === 'get_video'
  const result: Record<string, unknown> = {
    mediaType: video ? 'video' : 'image',
    usage: AI_ORIGIN + GUIDANCE + 'Media URLs are references only; preserve their query parameters. Video playback duration is not supplied.'
  }
  if (name.startsWith('search_')) {
    if (!Array.isArray(raw.assets) || raw.assets.length > Number(args.limit)) throw new Error('Invalid library results')
    const assets = raw.assets.map(asset => projectAsset(asset, video)).filter((asset): asset is Record<string, unknown> => !!asset)
    result.assets = assets
    result.count = assets.length
    result.mode = args.mode
    for (const key of ['has_more', 'has_more_in_window', 'bounded_retrieval']) {
      if (typeof raw[key] === 'boolean') result[key] = raw[key]
    }
  } else {
    const asset = projectAsset(raw.asset, video)
    if (!asset || asset.log_id !== args.log_id) throw new Error('Library asset is unavailable')
    result.asset = asset
  }
  return result
}

export default class AiLibraryServer extends StatelessMediaProxyServer {
  constructor(endpoint = process.env.AI_LIBRARY_MCP_URL || 'https://open.vectcut.com/vectdash/mcp') {
    super({
      name: 'ai-library', endpoint, allowedPaths: ['/vectdash/mcp', '/ai_history/mcp'],
      tools: TOOLS, upstreamTools: TOOL_MAP, projectResult,
      errorMessage: 'Shared AI asset search or details are unavailable. Check parameters, login and service deployment, or try keyword mode.'
    })
  }
}
