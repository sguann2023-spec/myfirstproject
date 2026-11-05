import type { TFunction } from 'i18next'

type McpToolNameParts = {
  serverName?: string
  toolName: string
}

const ACRONYM_WORDS = new Set(['ai', 'api', 'asr', 'http', 'https', 'id', 'json', 'mcp', 'ocr', 'sql', 'url'])
const MATERIAL_SEARCH_TITLES: Record<string, Record<string, string>> = {
  footage_search: {
    search_images: 'Web Search: Web Search',
    get_image: 'Web Search: Web Search',
    search_videos: 'Web Search: Web Search',
    get_video: 'Web Search: Web Search'
  },
  ai_library: {
    search_images: 'Web Search: Web Search',
    get_image: 'Web Search: Web Search',
    search_videos: 'Web Search: Web Search',
    get_video: 'Web Search: Web Search'
  },
  figure_search: {
    search_images: 'Stick Figure Search'
  }
}
const PHOTO_SEARCH_TITLES: Record<string, string> = {
  search_images: 'Photo Search',
  get_image: 'Get Photo',
  track_download: 'Track Photo Download'
}
const STOCK_SEARCH_TITLES: Record<string, string> = {
  search_videos: 'Web Search: Web Search',
  get_video: 'Web Search: Web Search',
  search_audios: 'Web Search: Web Search',
  get_audio: 'Web Search: Web Search'
}

function normalizeKeyPart(value?: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function formatWord(word: string): string {
  const normalized = word.trim().toLowerCase()
  if (!normalized) return ''
  if (ACRONYM_WORDS.has(normalized)) return normalized.toUpperCase()
  return normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

function humanizeName(value?: string): string {
  return String(value || '')
    .trim()
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map(formatWord)
    .join(' ')
}

function translateWithFallback(t: TFunction, key: string, fallback: string): string {
  const translated = t(key)
  return translated === key ? fallback : translated
}

function shouldUseWideColon(...values: string[]): boolean {
  return values.some((value) => /[\u3400-\u9fff]/.test(value))
}

export function parseMcpToolName(rawName?: string): McpToolNameParts {
  const name = String(rawName || '').trim()
  if (name.startsWith('mcp__')) {
    const parts = name.slice('mcp__'.length).split('__')
    if (parts[0] === 'vectcut' && parts.length >= 3) {
      return {
        serverName: parts[1],
        toolName: parts.slice(2).join('__')
      }
    }
    if (parts.length >= 2) {
      return {
        serverName: parts[0],
        toolName: parts.slice(1).join('__')
      }
    }
  }

  const colonIndex = name.indexOf(':')
  if (colonIndex > 0) {
    return {
      serverName: name.slice(0, colonIndex),
      toolName: name.slice(colonIndex + 1)
    }
  }

  return { toolName: name }
}

export function shouldHideSearchToolDetails(rawName?: string, serverName?: string): boolean {
  if (rawName === 'WebSearch') return true
  const parts = parseMcpToolName(rawName)
  const serverKey = normalizeKeyPart(parts.serverName || serverName)
  const toolKey = normalizeKeyPart(parts.toolName)
  if (['scrapt', 'search', 'media_search', 'pixabay'].includes(serverKey)) return true
  if (serverKey === 'stock_search') return Object.hasOwn(STOCK_SEARCH_TITLES, toolKey)
  if (serverKey === 'footage_search' || serverKey === 'ai_library') {
    return Object.hasOwn(MATERIAL_SEARCH_TITLES[serverKey], toolKey)
  }
  return false
}

export function getMcpToolDisplayName(
  args: McpToolNameParts & {
    t: TFunction
  }
): string {
  const rawServerKey = normalizeKeyPart(args.serverName)
  const serverKey = rawServerKey === 'pixabay' ? 'media_search' : rawServerKey
  const toolKey = normalizeKeyPart(args.toolName)
  const fallbackServer = rawServerKey === 'pixabay' ? 'Media Search' : humanizeName(args.serverName)
  const fallbackTool = humanizeName(args.toolName) || args.toolName

  if (serverKey === 'scrapt') {
    return args.t('message.tools.mcp.webSearchPro', { defaultValue: 'Web Search: Web Search PRO' })
  }

  if (Object.prototype.hasOwnProperty.call(MATERIAL_SEARCH_TITLES, serverKey) &&
    Object.prototype.hasOwnProperty.call(MATERIAL_SEARCH_TITLES[serverKey], toolKey)) {
    return args.t(`message.tools.mcp.tools.${serverKey}.${toolKey}`, {
      defaultValue: MATERIAL_SEARCH_TITLES[serverKey][toolKey]
    })
  }

  if (serverKey === 'photo_search' && Object.prototype.hasOwnProperty.call(PHOTO_SEARCH_TITLES, toolKey)) {
    return args.t(`message.tools.mcp.tools.photo_search.${toolKey}`, {
      defaultValue: PHOTO_SEARCH_TITLES[toolKey]
    })
  }

  if (serverKey === 'stock_search' && Object.prototype.hasOwnProperty.call(STOCK_SEARCH_TITLES, toolKey)) {
    return args.t(`message.tools.mcp.tools.stock_search.${toolKey}`, {
      defaultValue: STOCK_SEARCH_TITLES[toolKey]
    })
  }

  // Historical calls share the same provider-neutral title.
  if (serverKey === 'media_search') {
    return args.t('message.tools.mcp.webSearch', { defaultValue: 'Web Search: Web Search' })
  }

  // Standalone titles do not need the internal server name.
  if (serverKey === 'audio_understand' || serverKey === 'draft_render') {
    return args.t(`message.tools.mcp.tools.${serverKey}.${toolKey}`, { defaultValue: fallbackTool })
  }

  const localizedServer = serverKey
    ? translateWithFallback(args.t, `message.tools.mcp.servers.${serverKey}`, fallbackServer)
    : ''

  const localizedTool = serverKey && toolKey
    ? translateWithFallback(args.t, `message.tools.mcp.tools.${serverKey}.${toolKey}`, fallbackTool)
    : fallbackTool

  if (!localizedServer) {
    return localizedTool
  }

  return `${localizedServer}${shouldUseWideColon(localizedServer, localizedTool) ? '：' : ': '}${localizedTool}`
}
