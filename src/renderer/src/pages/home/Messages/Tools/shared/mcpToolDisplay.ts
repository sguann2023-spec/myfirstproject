import type { TFunction } from 'i18next'

type McpToolNameParts = {
  serverName?: string
  toolName: string
}

const ACRONYM_WORDS = new Set(['ai', 'api', 'asr', 'http', 'https', 'id', 'json', 'mcp', 'ocr', 'sql', 'url'])

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

  // Historical calls share the provider-neutral search titles.
  if (serverKey === 'media_search' &&
    (toolKey === 'search_images' || toolKey === 'search_videos')) {
    return args.t(`message.tools.mcp.tools.media_search.${toolKey}`, {
      defaultValue: toolKey === 'search_images' ? 'Image Search' : 'Video Search'
    })
  }

  // Standalone titles do not need the internal server name.
  if (serverKey === 'scrapt' || serverKey === 'audio_understand' || serverKey === 'draft_render') {
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
