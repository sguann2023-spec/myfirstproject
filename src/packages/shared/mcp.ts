/**
 * Convert a string to camelCase, ensuring it's a valid JavaScript identifier.
 *
 * - Normalizes to lowercase first, then capitalizes word boundaries
 * - Non-alphanumeric characters are treated as word separators
 * - Non-ASCII characters are dropped (ASCII-only output)
 * - If result starts with a digit, prefixes with underscore
 *
 * @example
 * toCamelCase('my-server') // 'myServer'
 * toCamelCase('MY_SERVER') // 'myServer'
 * toCamelCase('123tool')   // '_123tool'
 */
export function toCamelCase(str: string): string {
  let result = str
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+(.)/g, (_, char) => char.toUpperCase())
    .replace(/[^a-zA-Z0-9]/g, '')

  if (result && !/^[a-zA-Z_]/.test(result)) {
    result = '_' + result
  }

  return result
}

export type McpToolNameOptions = {
  /** Prefix added before the name (e.g., 'mcp__'). Must be JS-identifier-safe. */
  prefix?: string
  /** Delimiter between server and tool parts (e.g., '_' or '__'). Must be JS-identifier-safe. */
  delimiter?: string
  /** Maximum length of the final name. Suffix numbers for uniqueness are included in this limit. */
  maxLength?: number
  /** Mutable Set for collision detection. The final name will be added to this Set. */
  existingNames?: Set<string>
}

/**
 * Build a valid JavaScript function name from server and tool names.
 * Uses camelCase for both parts.
 *
 * @param serverName - The MCP server name (optional)
 * @param toolName - The tool name
 * @param options - Configuration options
 * @returns A valid JS identifier
 */
export function buildMcpToolName(
  serverName: string | undefined,
  toolName: string,
  options: McpToolNameOptions = {}
): string {
  const { prefix = '', delimiter = '_', maxLength, existingNames } = options

  const serverPart = serverName ? toCamelCase(serverName) : ''
  const toolPart = toCamelCase(toolName)
  const baseName = serverPart ? `${prefix}${serverPart}${delimiter}${toolPart}` : `${prefix}${toolPart}`

  if (!existingNames) {
    return maxLength ? truncateToLength(baseName, maxLength) : baseName
  }

  let name = maxLength ? truncateToLength(baseName, maxLength) : baseName
  let counter = 1

  while (existingNames.has(name)) {
    const suffix = String(counter)
    const truncatedBase = maxLength ? truncateToLength(baseName, maxLength - suffix.length) : baseName
    name = `${truncatedBase}${suffix}`
    counter++
  }

  existingNames.add(name)
  return name
}

function truncateToLength(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str
  }
  return str.slice(0, maxLength).replace(/_+$/, '')
}

/**
 * Generate a unique function name from server name and tool name.
 * Format: serverName_toolName (camelCase)
 *
 * @example
 * generateMcpToolFunctionName('github', 'search_issues') // 'github_searchIssues'
 */
export function generateMcpToolFunctionName(
  serverName: string | undefined,
  toolName: string,
  existingNames?: Set<string>
): string {
  return buildMcpToolName(serverName, toolName, { existingNames })
}

/**
 * Builds a valid JavaScript function name for MCP tool calls.
 * Format: mcp__{serverName}__{toolName}
 *
 * @param serverName - The MCP server name
 * @param toolName - The tool name from the server
 * @returns A valid JS identifier in format mcp__{server}__{tool}, max 63 chars
 *
 * @example
 * buildFunctionCallToolName('github', 'search_issues') // 'mcp__github__searchIssues'
 */
export function buildFunctionCallToolName(serverName: string, toolName: string): string {
  return buildMcpToolName(serverName, toolName, {
    prefix: 'mcp__',
    delimiter: '__',
    maxLength: 63
  })
}

export const VECTCUT_MCP_NAMESPACE = 'vectcut'

export const VECTCUT_BUILTIN_MCP_SERVERS = new Set([
  'agent-memory',
  'assistant',
  'browser',
  'claw',
  'copylab',
  'cut-workflow',
  'digital-human',
  'draft-download',
  'draft-elements',
  'draft-management',
  'ffmpeg-media',
  'file-upload',
  'filesystem-server',
  'image',
  'image-understand',
  'koubo-template',
  'materials',
  'search',
  'seed-audio',
  'skills',
  'speech',
  'subtitle-recognition',
  'subtitle-template',
  'system',
  'video',
  'video-understand',
  'voice-conversion'
])

export function buildVectcutMcpToolName(serverName: string, toolName: string): string {
  return `mcp__${VECTCUT_MCP_NAMESPACE}__${serverName}__${toolName}`
}

export function buildVectcutMcpPattern(serverName: string): string {
  return `mcp__${VECTCUT_MCP_NAMESPACE}__${serverName}__*`
}

export function normalizeVectcutMcpToolName(toolName: string): string {
  const normalized = String(toolName || '').trim()
  if (!normalized.startsWith('mcp__') || normalized.startsWith(`mcp__${VECTCUT_MCP_NAMESPACE}__`)) {
    return normalized
  }

  const raw = normalized.slice('mcp__'.length)
  const separatorIndex = raw.indexOf('__')
  if (separatorIndex <= 0) {
    return normalized
  }

  const serverName = raw.slice(0, separatorIndex)
  const rest = raw.slice(separatorIndex + 2)
  if (!serverName || !rest || !VECTCUT_BUILTIN_MCP_SERVERS.has(serverName)) {
    return normalized
  }

  return buildVectcutMcpToolName(serverName, rest)
}
