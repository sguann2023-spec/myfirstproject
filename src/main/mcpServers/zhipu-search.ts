import { loggerService } from '@logger'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
import Store from 'electron-store'
import { app, net } from 'electron'

const logger = loggerService.withContext('MCPServer:WebSearch')

const API_HOST = 'https://open.vectcut.com'
const SEARCH_ENDPOINT = '/search/zhipu'
const EXA_MCP_URL = 'https://mcp.exa.ai/mcp?tools=web_search_exa'
const OAUTH_TOKEN_URL = 'https://mlbd8l6vgi13-demo.authing.cn/oidc/token'
const OAUTH_CLIENT_ID = '6901dd145dafc6f1f3143938'
const OAUTH_CLIENT_SECRET = '16a94e467e927cc09b3c8dc7ec92d420'

const WEB_SEARCH_TOOL: Tool = {
  name: 'web_search',
  description:
    'Search the web with Exa first, then automatically fall back to VectCut Zhipu search when Exa is unavailable or rate limited.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query text'
      },
      numResults: {
        type: 'number',
        description: 'Maximum number of results to return (default: 5)'
      },
      searchIntent: {
        type: 'boolean',
        description: 'Whether to enable search intent analysis (default: false)'
      }
    },
    required: ['query']
  }
}

type SearchResult = {
  title?: string
  content?: string
  url?: string
}

type SearchResponse = {
  query?: string
  results?: SearchResult[]
  meta?: {
    request_id?: string
    provider?: string
  }
}

type PendingToken = {
  accessToken: string
  expiresAt: number
}

class ZhipuSearchServer {
  public mcpServer: McpServer
  private readonly store = new Store({ name: 'vectcut' })
  private accessToken: PendingToken | null = null
  private refreshPromise: Promise<string> | null = null
  private exaClient: Client | null = null

  constructor() {
    this.mcpServer = new McpServer(
      {
        name: 'search',
        version: '1.0.0'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    )
    this.setupHandlers()
  }

  private setupHandlers() {
    this.mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [WEB_SEARCH_TOOL]
    }))

    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name
      const args = request.params.arguments ?? {}

      try {
        switch (toolName) {
          case 'web_search':
            return await this.webSearch(args as Record<string, unknown>)
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error(`Tool error: ${toolName}`, { error: message })
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          isError: true
        }
      }
    })
  }

  private async ensureValidAccessToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.accessToken && Date.now() < this.accessToken.expiresAt - 30_000) {
      return this.accessToken.accessToken
    }

    if (!forceRefresh && this.refreshPromise) {
      return this.refreshPromise
    }

    const refreshToken = String(this.store.get('auth.refresh_token') || '').trim()
    if (!refreshToken) {
      throw new Error('No refresh token found, please sign in first')
    }

    this.refreshPromise = this.refreshAccessToken(refreshToken)

    try {
      return await this.refreshPromise
    } finally {
      this.refreshPromise = null
    }
  }

  private async getExaClient(): Promise<Client> {
    if (this.exaClient) {
      return this.exaClient
    }

    const client = new Client({ name: 'VectCut', version: app.getVersion() }, { capabilities: {} })
    const transport = new StreamableHTTPClientTransport(new URL(EXA_MCP_URL), {
      fetch: async (url, init) => net.fetch(typeof url === 'string' ? url : url.toString(), init)
    })

    await client.connect(transport)

    this.exaClient = client
    return client
  }

  private async resetExaClient(): Promise<void> {
    const client = this.exaClient
    this.exaClient = null

    if (client && typeof client.close === 'function') {
      await client.close().catch((error: unknown) => {
        logger.warn('Failed to close Exa client', { error: error instanceof Error ? error.message : String(error) })
      })
    }
  }

  private extractTextContent(result: unknown): string {
    const content = Array.isArray((result as { content?: unknown[] })?.content)
      ? ((result as { content?: Array<{ type?: string; text?: string }> }).content ?? [])
      : []

    const textParts = content
          .filter((item) => item?.type === 'text' && typeof item.text === 'string')
          .map((item) => item.text!.trim())
          .filter(Boolean)

    return textParts.join('\n\n').trim()
  }

  private hasMeaningfulContent(result: unknown): boolean {
    const content = Array.isArray((result as { content?: unknown[] })?.content)
      ? ((result as { content?: Array<{ type?: string; text?: string }> }).content ?? [])
      : []

    if (content.length === 0) {
      return false
    }

    return content.some((item) => {
      if (!item) return false
      if (item.type !== 'text') return true
      return typeof item.text === 'string' && item.text.trim().length > 0
    })
  }

  private async searchWithExa(query: string, numResults: number) {
    try {
      const client = await this.getExaClient()
      const result = await client.callTool(
        {
          name: 'web_search_exa',
          arguments: {
            query,
            numResults
          }
        },
        undefined,
        {
          timeout: 60_000
        }
      )

      if (result.isError) {
        throw new Error(this.extractTextContent(result) || 'Exa search returned an error')
      }

      if (!this.hasMeaningfulContent(result)) {
        throw new Error('Exa search returned no content')
      }

      logger.info('Web search completed via Exa', { query, countHint: numResults })
      return result
    } catch (error) {
      await this.resetExaClient()
      throw error
    }
  }

  private async refreshAccessToken(refreshToken: string): Promise<string> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: OAUTH_CLIENT_ID,
      client_secret: OAUTH_CLIENT_SECRET
    }).toString()

    const response = await net.fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`Token refresh failed (${response.status}): ${text || 'unknown error'}`)
    }

    const payload = (await response.json()) as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
    }

    const accessToken = String(payload.access_token || '').trim()
    if (!accessToken) {
      throw new Error('Token refresh returned no access token')
    }

    const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : 3600
    this.accessToken = {
      accessToken,
      expiresAt: Date.now() + expiresIn * 1000
    }

    if (typeof payload.refresh_token === 'string' && payload.refresh_token.trim()) {
      this.store.set('auth.refresh_token', payload.refresh_token.trim())
    }

    return accessToken
  }

  private async fetchWithAuth(body: Record<string, unknown>): Promise<Response> {
    const token = await this.ensureValidAccessToken()

    const doFetch = async (accessToken: string): Promise<Response> =>
      net.fetch(`${API_HOST}${SEARCH_ENDPOINT}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      })

    let response = await doFetch(token)
    if (response.status === 401) {
      const refreshedToken = await this.ensureValidAccessToken(true)
      response = await doFetch(refreshedToken)
    }
    return response
  }

  private async searchWithZhipu(query: string, numResults: number, searchIntent: boolean) {
    const response = await this.fetchWithAuth({
      query,
      max_results: numResults,
      search_engine: 'search_std',
      search_intent: searchIntent
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Zhipu search failed (${response.status}): ${body || 'unknown error'}`)
    }

    const payload = (await response.json()) as SearchResponse
    const items = Array.isArray(payload.results) ? payload.results : []
    const normalized = items.map((item, index) => ({
      index: index + 1,
      title: item.title || 'No title',
      url: item.url || '',
      content: item.content || ''
    }))

    logger.info('Web search completed via Zhipu fallback', {
      query,
      count: normalized.length,
      requestId: payload.meta?.request_id
    })

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              provider: 'zhipu',
              query: payload.query || query,
              results: normalized
            },
            null,
            2
          )
        }
      ]
    }
  }

  private async webSearch(args: Record<string, unknown>) {
    const query = typeof args.query === 'string' ? args.query.trim() : ''
    if (!query) {
      throw new McpError(ErrorCode.InvalidParams, "'query' is required for web_search")
    }

    const numResultsRaw = typeof args.numResults === 'number' ? args.numResults : 5
    const numResults = Math.max(1, Math.min(10, Math.floor(numResultsRaw)))
    const searchIntent = typeof args.searchIntent === 'boolean' ? args.searchIntent : false

    try {
      return await this.searchWithExa(query, numResults)
    } catch (exaError) {
      const exaMessage = exaError instanceof Error ? exaError.message : String(exaError)
      logger.warn('Exa search failed, falling back to Zhipu', {
        query,
        error: exaMessage
      })
    }

    return await this.searchWithZhipu(query, numResults, searchIntent)
  }
}

export default ZhipuSearchServer
