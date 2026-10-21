import { loggerService } from '@logger'
import { agentRuntimeAuthService } from '@main/services/agents/services/AgentRuntimeAuthService'
import { mainHttpClient } from '@main/services/network/MainHttpClient'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
import Store from 'electron-store'

import { requestWithVectcutAuth } from './vectcut-auth'
import { CLONE_VOICE_TOOL, prepareCloneVoiceRequest } from './voice-clone'

const logger = loggerService.withContext('MCPServer:VoiceLibrary')
const API_HOST = 'https://open.vectcut.com'
const VOICE_LIBRARY_ENDPOINT = '/llm/tts/voice_library'

const FILTER_PROPERTIES = {
  provider: {
    type: 'string',
    description: 'Provider filter, such as azure, volc, minimax, fish or elevenlabs. For list_voices, multiple providers may be comma-separated.'
  },
  gender: { type: 'string', description: 'Exact gender value returned by get_voice_filter_options.' },
  language: { type: 'string', description: 'Language code, such as zh or en. Use get_voice_filter_options for available values.' },
  only_active: { type: 'boolean', description: 'Return only active voices. Defaults to true.' }
}

const LIST_VOICES_TOOL: Tool = {
  name: 'list_voices',
  description:
    'Fetch the live VectCut voice library with filters and pagination. Returns voice IDs, provider mappings, descriptions, audition URLs and pricing as supplied by the backend. Use an item global_voice_id as voice_id in generate_speech. This is a read-only query and does not change the selected voice.',
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  inputSchema: {
    type: 'object',
    properties: {
      ...FILTER_PROPERTIES,
      locale: { type: 'string', description: 'Locale or dialect filter.' },
      style: { type: 'string', description: 'Voice style filter.' },
      keyword: { type: 'string', description: 'Search keyword for matching voices.' },
      global_voice_id: { type: 'string', description: 'Look up an exact global voice ID.' },
      sort_type: {
        type: 'string',
        enum: ['recommend', 'latest', 'hot'],
        description: 'Sort order. Defaults to recommend.'
      },
      limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Page size, from 1 to 100. Defaults to 20.' },
      offset: { type: 'integer', minimum: 0, description: 'Pagination offset. Defaults to 0.' }
    },
    additionalProperties: false
  }
}

const FILTER_OPTIONS_TOOL: Tool = {
  name: 'get_voice_filter_options',
  description:
    'Fetch available provider, gender and language filters from the live VectCut voice library, including readable language names. Pass a single provider for this query.',
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  inputSchema: { type: 'object', properties: FILTER_PROPERTIES, additionalProperties: false }
}

function buildQuery(args: Record<string, unknown>, tool: Tool): URLSearchParams {
  const query = new URLSearchParams()
  const properties = tool.inputSchema.properties ?? {}
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined) continue
    if (!Object.prototype.hasOwnProperty.call(properties, key)) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown parameter: ${key}`)
    }
    if (key === 'limit' || key === 'offset') {
      const minimum = key === 'limit' ? 1 : 0
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || (key === 'limit' && value > 100)) {
        throw new McpError(ErrorCode.InvalidParams, `Invalid ${key}: expected ${key === 'limit' ? 'an integer from 1 to 100' : 'a non-negative integer'}`)
      }
      query.set(key, String(value))
    } else if (key === 'only_active') {
      if (typeof value !== 'boolean') {
        throw new McpError(ErrorCode.InvalidParams, 'only_active must be a boolean')
      }
      query.set(key, String(value))
    } else {
      if (typeof value !== 'string') {
        throw new McpError(ErrorCode.InvalidParams, `${key} must be a string`)
      }
      const normalized = value.trim()
      if (key === 'sort_type' && !['recommend', 'latest', 'hot'].includes(normalized)) {
        throw new McpError(ErrorCode.InvalidParams, 'sort_type must be recommend, latest or hot')
      }
      if (tool.name === FILTER_OPTIONS_TOOL.name && key === 'provider' && normalized.includes(',')) {
        throw new McpError(ErrorCode.InvalidParams, 'get_voice_filter_options accepts a single provider')
      }
      if (normalized) query.set(key, normalized)
    }
  }
  return query
}

class VoiceLibraryServer {
  public mcpServer: McpServer
  private readonly store = new Store({ name: 'vectcut' })

  constructor() {
    this.mcpServer = new McpServer(
      { name: 'voice-library', version: '1.0.0' },
      { capabilities: { tools: {} } }
    )
    this.setupHandlers()
  }

  private setupHandlers() {
    this.mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [LIST_VOICES_TOOL, FILTER_OPTIONS_TOOL, CLONE_VOICE_TOOL]
    }))
    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name
      try {
        if (toolName === CLONE_VOICE_TOOL.name) {
          return await this.cloneVoice(request.params.arguments ?? {})
        }
        const tool = [LIST_VOICES_TOOL, FILTER_OPTIONS_TOOL].find((item) => item.name === toolName)
        if (!tool) throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`)
        const query = buildQuery(request.params.arguments ?? {}, tool)
        const endpoint = tool === LIST_VOICES_TOOL ? VOICE_LIBRARY_ENDPOINT : `${VOICE_LIBRARY_ENDPOINT}/filter_options`
        const url = new URL(endpoint, API_HOST)
        url.search = query.toString()
        const response = await requestWithVectcutAuth(
          this.store,
          (forceRefresh) => agentRuntimeAuthService.ensureValidAccessToken(forceRefresh),
          (token) => mainHttpClient.fetch(url.toString(), {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` }
          })
        )
        if (!response.ok) {
          const body = await response.text().catch(() => '')
          throw new Error(`Voice library request failed (${response.status}): ${body || 'unknown error'}`)
        }
        const result = await response.json() as Record<string, unknown>
        if (result.success === false) {
          throw new Error(String(result.error || 'Voice library request failed'))
        }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ provider: 'vectcut', action: toolName, ...result }, null, 2) }]
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error(`Tool error: ${toolName}`, { error: message })
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true }
      }
    })
  }

  private async cloneVoice(args: Record<string, unknown>) {
    const { provider, endpoint, payload } = await prepareCloneVoiceRequest(args)
    const response = await requestWithVectcutAuth(
      this.store,
      (forceRefresh) => agentRuntimeAuthService.ensureValidAccessToken(forceRefresh),
      (token) => mainHttpClient.fetch(new URL(endpoint, API_HOST).toString(), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
    )
    const body = await response.text()
    let result: Record<string, unknown>
    try {
      result = JSON.parse(body)
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Invalid response')
    } catch {
      throw new Error(`Voice cloning failed (${response.status}): ${body || 'invalid JSON response'}`)
    }
    if (response.ok && result.success !== false && !String(result.voice_id || '').trim()) {
      throw new Error('Voice cloning returned no voice_id')
    }
    // Preserve membership, slot and billing details so callers can explain backend rejections.
    const isError = !response.ok || result.success === false
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          ...result,
          provider: 'vectcut',
          action: 'clone_voice',
          request: { provider },
          ...(isError ? { http_status: response.status } : {})
        }, null, 2)
      }],
      ...(isError ? { isError: true } : {})
    }
  }
}

export default VoiceLibraryServer
