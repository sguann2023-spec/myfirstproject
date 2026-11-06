import type { Tool } from '@modelcontextprotocol/sdk/types.js'

import { ASSET_SEARCH_ROUTING, PUBLIC_FOOTAGE_RETRIEVAL_GUIDANCE, suggestYouTubeSearch, YOUTUBE_VIDEO_FALLBACK_GUIDANCE } from './asset-search-routing'
import StatelessMediaProxyServer, { isMediaRecord, mediaReference } from './media-proxy'

const GUIDANCE = 'Consider existing assets as a potentially cheaper alternative to custom generation. Honor explicit AI generation requests. Search and details only; no automatic download or timeline insertion. This library supports still photos and stock videos, not audio, GIF or guaranteed transparent stickers. Preserve original media URLs and query parameters, show the returned source link prominently and credit creators where possible. Check asset licenses and third-party rights before publication or redistribution; this is not a blanket restriction on searching or retrieving selected media. '
const LOCALES = [
  'en-US', 'pt-BR', 'es-ES', 'ca-ES', 'de-DE', 'it-IT', 'fr-FR', 'sv-SE',
  'id-ID', 'pl-PL', 'ja-JP', 'zh-TW', 'zh-CN', 'ko-KR', 'th-TH', 'nl-NL',
  'hu-HU', 'vi-VN', 'cs-CZ', 'da-DK', 'fi-FI', 'uk-UA', 'el-GR', 'ro-RO',
  'nb-NO', 'sk-SK', 'tr-TR', 'ru-RU'
]
const SEARCH_FIELDS = {
  query: { type: 'string', minLength: 1, maxLength: 500, description: 'Short media search phrase; English keywords are recommended.' },
  page: { type: 'integer', minimum: 1, maximum: 10000, default: 1 },
  per_page: { type: 'integer', minimum: 1, maximum: 80, default: 15 },
  orientation: { type: 'string', enum: ['landscape', 'portrait', 'square'] },
  size: { type: 'string', enum: ['large', 'medium', 'small'], description: 'Minimum size: photos 24/12/4 MP; videos 4K/Full HD/HD.' },
  locale: { type: 'string', enum: LOCALES }
}
const MEDIA_ID = { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }
const UPSTREAM_TOOLS = {
  search_images: 'search_photos', get_image: 'get_photo', search_videos: 'search_videos', get_video: 'get_video'
} as const
const TOOLS: Tool[] = [
  {
    name: 'search_images', title: '\u56fe\u7247\u641c\u7d22',
    description: 'Default starting library for ordinary real-world stock photos: people, places, products, lifestyle and background shots. Choose when orientation, photo resolution tier, named color or #RRGGBB filtering is useful. For illustrations/vectors/cutouts prefer media-search.search_images; for photo collection discovery prefer photo-search.search_images; for explicitly reusable AI-style imagery prefer ai-library.search_images. Start with per_page=3-5. Results already include image versions and credits; get details only if required information is missing. ' + ASSET_SEARCH_ROUTING + GUIDANCE,
    inputSchema: {
      type: 'object', properties: {
        ...SEARCH_FIELDS,
        color: { type: 'string', pattern: '^(?:red|orange|yellow|green|turquoise|blue|violet|pink|brown|black|gray|white|#[0-9A-Fa-f]{6})$', description: 'Named color or #RRGGBB hexadecimal color.' }
      }, required: ['query'], additionalProperties: false
    }
  },
  {
    name: 'get_image', title: '\u56fe\u7247\u8be6\u60c5',
    description: 'Details for one selected footage-search photograph. Accept only the numeric ID returned by footage-search.search_images. Call only when that result lacks required image versions or credits; otherwise reuse its src URLs. Do not fetch details for every hit, repeat a search, or use IDs from another library. ' + GUIDANCE,
    inputSchema: { type: 'object', properties: { photo_id: { ...MEDIA_ID, description: 'Numeric photo ID returned by image search.' } }, required: ['photo_id'], additionalProperties: false }
  },
  {
    name: 'search_videos', title: '\u89c6\u9891\u641c\u7d22',
    description: 'Default starting library for ordinary filmed B-roll: real-world people, locations, activities and establishing/background shots. Choose for landscape/portrait/square framing or HD/Full HD/4K minimum-size tiers. For animation-type filtering prefer media-search.search_videos; for category/trending filters prefer stock-search.search_videos; for reusable generated footage prefer ai-library.search_videos. Start with per_page=3-5. Results include preview, duration and video_files resolutions/URLs; get details only if required information is missing. ' + ASSET_SEARCH_ROUTING + GUIDANCE,
    inputSchema: { type: 'object', properties: SEARCH_FIELDS, required: ['query'], additionalProperties: false }
  },
  {
    name: 'get_video', title: '\u89c6\u9891\u8be6\u60c5',
    description: 'Details for one selected footage-search video. Accept only its numeric ID from footage-search.search_videos. Call only when required file versions, duration or credits are missing; otherwise reuse video_files from the search result. Do not fetch details for every hit, repeat a search, or pass IDs from other libraries. ' + GUIDANCE,
    inputSchema: { type: 'object', properties: { video_id: { ...MEDIA_ID, description: 'Numeric video ID returned by video search.' } }, required: ['video_id'], additionalProperties: false }
  }
]
for (const tool of TOOLS) {
  tool.annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  if (tool.name === 'search_videos') tool.description = YOUTUBE_VIDEO_FALLBACK_GUIDANCE + tool.description
}

function copyNumbers(source: Record<string, unknown>, target: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) target[key] = value
  }
}

function copyLinks(source: Record<string, unknown>, keys: string[]): Record<string, string> {
  const links: Record<string, string> = {}
  for (const key of keys) {
    const url = mediaReference(source[key])
    if (url) links[key] = url
  }
  return links
}

function projectAsset(asset: Record<string, unknown>, video: boolean): Record<string, unknown> {
  if (typeof asset.id !== 'number' || !Number.isSafeInteger(asset.id) || asset.id < 1) throw new Error('Invalid media ID')
  const result: Record<string, unknown> = { id: asset.id, ...copyLinks(asset, ['url']) }
  copyNumbers(asset, result, ['width', 'height'])
  if (!video) {
    if (!isMediaRecord(asset.src)) throw new Error('Missing image references')
    result.src = copyLinks(asset.src, ['original', 'large2x', 'large', 'medium', 'small', 'portrait', 'landscape', 'tiny'])
    for (const key of ['alt', 'avg_color', 'photographer']) {
      if (typeof asset[key] === 'string') result[key] = asset[key].slice(0, key === 'alt' ? 2048 : 256)
    }
    Object.assign(result, copyLinks(asset, ['photographer_url']))
    copyNumbers(asset, result, ['photographer_id'])
  } else {
    if (!Array.isArray(asset.video_files) || asset.video_files.length > 80 || !asset.video_files.every(isMediaRecord)) throw new Error('Invalid video files')
    copyNumbers(asset, result, ['duration'])
    Object.assign(result, copyLinks(asset, ['image']))
    result.video_files = asset.video_files.flatMap((file) => {
      const link = mediaReference(file.link)
      if (!link) return []
      const projected: Record<string, unknown> = { link }
      copyNumbers(file, projected, ['id', 'width', 'height', 'fps', 'file_size'])
      for (const key of ['quality', 'file_type']) if (typeof file[key] === 'string') projected[key] = file[key].slice(0, 128)
      return [projected]
    })
    if (isMediaRecord(asset.user)) {
      const user: Record<string, unknown> = { ...copyLinks(asset.user, ['url']) }
      copyNumbers(asset.user, user, ['id'])
      if (typeof asset.user.name === 'string') user.name = asset.user.name.slice(0, 256)
      result.user = user
    }
    if (Array.isArray(asset.video_pictures)) {
      result.video_pictures = asset.video_pictures.slice(0, 80).filter(isMediaRecord).flatMap((picture) => {
        const url = mediaReference(picture.picture)
        if (!url) return []
        const projected: Record<string, unknown> = { picture: url }
        copyNumbers(picture, projected, ['id', 'nr'])
        return [projected]
      })
    }
  }
  return result
}

function projectResult(data: unknown, name: string, args: Record<string, unknown>): Record<string, unknown> {
  if (!isMediaRecord(data) || !isMediaRecord(data.response)) throw new Error('Invalid footage result')
  const video = name.includes('video')
  const search = name.startsWith('search_')
  const response = data.response
  const items = search ? response[video ? 'videos' : 'photos'] : [response]
  if (!Array.isArray(items) || items.length > (search ? Number(args.per_page) : 1) || !items.every(isMediaRecord)) throw new Error('Invalid media results')
  if (!Array.isArray(data.attribution) || data.attribution.length !== items.length || !data.attribution.every(isMediaRecord)) throw new Error('Missing media credits')
  const assets = items.map((asset) => projectAsset(asset, video))
  const result: Record<string, unknown> = {
    mediaType: video ? 'video' : 'image', attribution_required: true,
    usage: (video ? YOUTUBE_VIDEO_FALLBACK_GUIDANCE + PUBLIC_FOOTAGE_RETRIEVAL_GUIDANCE : '') + GUIDANCE,
    ...(search ? { results: assets } : { [video ? 'video' : 'photo']: assets[0] }),
    attribution: data.attribution.map((credit) => {
      const projected: Record<string, unknown> = { ...copyLinks(credit, ['media_url', 'creator_url']) }
      copyNumbers(credit, projected, ['media_id'])
      if (typeof credit.creator === 'string') projected.creator = credit.creator.slice(0, 256)
      const source = mediaReference(credit.pexels_url)
      if (source) projected.source_url = source
      return projected
    })
  }
  if (search) {
    for (const key of ['page', 'per_page', 'total_results']) {
      const value = response[key]
      if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) result[key] = value
    }
    result.has_next_page = !!mediaReference(response.next_page)
    result.has_prev_page = !!mediaReference(response.prev_page)
  }
  return result
}

export default class FootageSearchServer extends StatelessMediaProxyServer {
  constructor(endpoint = process.env.FOOTAGE_SEARCH_MCP_URL || 'https://open.vectcut.com/pexels/mcp') {
    super({
      name: 'footage-search', endpoint, allowedPaths: ['/pexel/mcp', '/pexels/mcp'], tools: TOOLS,
      upstreamTools: UPSTREAM_TOOLS, projectResult,
      suggestNextSearch: (name, args) => name === 'search_videos'
        ? suggestYouTubeSearch(args.query as string, 'The stock video search failed.') : undefined
    })
  }
}
