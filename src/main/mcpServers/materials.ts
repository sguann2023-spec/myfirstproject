import { loggerService } from '@logger'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
import Store from 'electron-store'
import { net } from 'electron'

import { persistWorkspaceJsonArtifact } from './workspace-json-artifact'

const logger = loggerService.withContext('MCPServer:Materials')

const API_HOST = 'https://open.vectcut.com'
const FOLDER_SHARE_LINKS_ENDPOINT = `${API_HOST}/sts/folder/share_links`
const OAUTH_TOKEN_URL = 'https://mlbd8l6vgi13-demo.authing.cn/oidc/token'
const OAUTH_CLIENT_ID = '6901dd145dafc6f1f3143938'
const OAUTH_CLIENT_SECRET = '16a94e467e927cc09b3c8dc7ec92d420'

const FOLDER_LINKS_TOOL: Tool = {
  name: 'folder_links',
  description:
    'Get file links under a materials folder. The full result is written into the current workspace, and the tool returns only the saved file path plus a concise summary.',
  inputSchema: {
    type: 'object',
    properties: {
      folderId: {
        type: ['string', 'number'],
        description: 'Required materials folder ID.'
      },
      folder_id: {
        type: ['string', 'number'],
        description: 'Required materials folder ID alias of folderId.'
      },
      limit: {
        type: 'integer',
        description: 'Optional maximum number of files to return. Defaults to 100 and cannot exceed 100.'
      }
    },
    additionalProperties: true
  }
}

type PendingToken = {
  accessToken: string
  expiresAt: number
}

type NormalizedFolderLink = {
  name?: string
  object_key?: string
  folder_path?: string
  file_size_bytes?: number
  updated_at?: string | null
  url: string
}

class MaterialsServer {
  public mcpServer: McpServer
  private readonly store = new Store({ name: 'vectcut' })
  private readonly workspacePath?: string
  private accessToken: PendingToken | null = null
  private refreshPromise: Promise<string> | null = null

  constructor(workspacePath?: string) {
    this.workspacePath = workspacePath
    this.mcpServer = new McpServer(
      {
        name: 'materials',
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
      tools: [FOLDER_LINKS_TOOL]
    }))

    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name
      const args = request.params.arguments ?? {}

      try {
        switch (toolName) {
          case 'folder_links':
            return await this.folderLinks(args as Record<string, unknown>)
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

  private resolveFolderId(args: Record<string, unknown>): string {
    const rawFolderId = args.folderId ?? args.folder_id
    if (typeof rawFolderId !== 'string' && typeof rawFolderId !== 'number') {
      throw new McpError(ErrorCode.InvalidParams, "'folderId' or 'folder_id' is required")
    }

    const folderId = String(rawFolderId).trim()
    if (!folderId) {
      throw new McpError(ErrorCode.InvalidParams, "'folderId' or 'folder_id' cannot be empty")
    }

    return folderId
  }

  private resolveLimit(args: Record<string, unknown>): number {
    const rawLimit = args.limit
    if (rawLimit == null || rawLimit === '') return 100

    const limit = Number(rawLimit)
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new McpError(ErrorCode.InvalidParams, "'limit' must be an integer between 1 and 100")
    }

    return limit
  }

  private async parseResponseBody(response: Response): Promise<unknown> {
    const text = await response.text().catch(() => '')
    if (!text) return {}

    try {
      return JSON.parse(text)
    } catch {
      return {
        raw_text: text
      }
    }
  }

  private async requestFolderLinks(folderId: string, limit: number, accessToken: string): Promise<unknown> {
    const response = await net.fetch(FOLDER_SHARE_LINKS_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        folder_id: folderId,
        limit
      })
    })

    const payload = await this.parseResponseBody(response)
    if (response.ok) {
      return payload
    }

    const payloadText =
      typeof payload === 'object' && payload !== null ? JSON.stringify(payload) : String(payload || '').trim()
    throw new Error(
      `POST ${FOLDER_SHARE_LINKS_ENDPOINT} failed (${response.status}): ${payloadText || response.statusText || 'unknown error'}`
    )
  }

  private findLinkArrayCandidate(value: unknown, depth = 0): unknown[] | null {
    if (depth > 4 || value == null) {
      return null
    }

    if (Array.isArray(value)) {
      if (
        value.every((item) => typeof item === 'string') ||
        value.some((item) => this.extractLinkFromItem(item))
      ) {
        return value
      }
      for (const item of value) {
        const nested = this.findLinkArrayCandidate(item, depth + 1)
        if (nested) return nested
      }
      return null
    }

    if (typeof value !== 'object') {
      return null
    }

    const record = value as Record<string, unknown>
    for (const key of ['items', 'files', 'links', 'list', 'results', 'data', 'records']) {
      const nested = this.findLinkArrayCandidate(record[key], depth + 1)
      if (nested) return nested
    }

    for (const nestedValue of Object.values(record)) {
      const nested = this.findLinkArrayCandidate(nestedValue, depth + 1)
      if (nested) return nested
    }

    return null
  }

  private extractLinkFromItem(item: unknown): string | undefined {
    if (typeof item === 'string') {
      const trimmed = item.trim()
      if (/^https?:\/\//i.test(trimmed)) {
        return trimmed
      }
      return undefined
    }

    if (!item || typeof item !== 'object') {
      return undefined
    }

    const record = item as Record<string, unknown>
    for (const key of [
      'url',
      'link',
      'file_url',
      'fileUrl',
      'download_url',
      'downloadUrl',
      'signed_url',
      'signedUrl',
      'public_signed_url',
      'publicSignedUrl',
      'public_url',
      'publicUrl'
    ]) {
      const value = record[key]
      if (typeof value === 'string' && /^https?:\/\//i.test(value.trim())) {
        return value.trim()
      }
    }

    return undefined
  }

  private normalizeFolderLinks(payload: unknown): NormalizedFolderLink[] {
    const arrayCandidate = this.findLinkArrayCandidate(payload)
    if (!arrayCandidate) {
      return []
    }

    return arrayCandidate
      .map((item): NormalizedFolderLink | null => {
        const url = this.extractLinkFromItem(item)
        if (!url) return null

        if (typeof item === 'string') {
          return { url }
        }

        const record = item as Record<string, unknown>
        return {
          name:
            typeof record.name === 'string'
              ? record.name.trim() || undefined
              : typeof record.file_name === 'string'
                ? record.file_name.trim() || undefined
                : undefined,
          object_key: typeof record.object_key === 'string' ? record.object_key.trim() || undefined : undefined,
          folder_path: typeof record.folder_path === 'string' ? record.folder_path.trim() || undefined : undefined,
          file_size_bytes: typeof record.file_size_bytes === 'number' ? record.file_size_bytes : undefined,
          updated_at:
            typeof record.updated_at === 'string' || record.updated_at === null ? (record.updated_at as string | null) : undefined,
          url
        }
      })
      .filter((item): item is NormalizedFolderLink => Boolean(item))
  }

  private async folderLinks(args: Record<string, unknown>) {
    const folderId = this.resolveFolderId(args)
    const limit = this.resolveLimit(args)
    const accessToken = await this.ensureValidAccessToken()
    const payload = await this.requestFolderLinks(folderId, limit, accessToken)
    const payloadRecord = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>

    const normalizedLinks = this.normalizeFolderLinks(payload)
    const artifactPayload = {
      provider: 'vectcut',
      action: 'folder_links',
      folder_id: folderId,
      folder_path: typeof payloadRecord.folder_path === 'string' ? payloadRecord.folder_path : '',
      include_subfolders: typeof payloadRecord.include_subfolders === 'boolean' ? payloadRecord.include_subfolders : undefined,
      count: typeof payloadRecord.count === 'number' ? payloadRecord.count : normalizedLinks.length,
      requested_limit: limit,
      fetched_via: {
        method: 'POST',
        endpoint: FOLDER_SHARE_LINKS_ENDPOINT
      },
      file_count: normalizedLinks.length,
      links: normalizedLinks,
      raw_result: payload
    }

    const artifact = await persistWorkspaceJsonArtifact({
      toolName: 'materials',
      taskId: `folder-links-${folderId}`,
      payload: artifactPayload,
      workspaceRoot: this.workspacePath,
      relativeDirSegments: ['materials']
    })

    if (!artifact) {
      throw new Error('folder_links requires a workspace root to persist the result file')
    }

    const responsePayload = {
      provider: 'vectcut',
      action: 'folder_links',
      folder_id: folderId,
      folder_path: typeof payloadRecord.folder_path === 'string' ? payloadRecord.folder_path : '',
      file_count: normalizedLinks.length,
      artifact: {
        storage: 'workspace_file',
        file_path: artifact.filePath,
        relative_path: artifact.relativePath
      }
    }

    logger.info('Materials folder links fetched and persisted', {
      folderId,
      fileCount: normalizedLinks.length,
      filePath: artifact.filePath
    })

    return {
      structuredContent: responsePayload,
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(responsePayload, null, 2)
        }
      ]
    }
  }
}

export default MaterialsServer
