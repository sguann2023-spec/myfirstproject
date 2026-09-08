import { stat as fsStat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loggerService } from '@logger'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
import Store from 'electron-store'
import { net } from 'electron'

import { ossUploadService } from '@main/services/OssUploadService'

import { persistWorkspaceJsonArtifact } from './workspace-json-artifact'

const logger = loggerService.withContext('MCPServer:DraftManagement')

const API_HOST = 'https://open.vectcut.com'
const CREATE_DRAFT_ENDPOINT = '/cut_jianying/create_draft'
const MODIFY_DRAFT_ENDPOINT = '/cut_jianying/modify_draft'
const QUERY_SCRIPT_ENDPOINT = '/cut_jianying/query_script'
const OAUTH_TOKEN_URL = 'https://mlbd8l6vgi13-demo.authing.cn/oidc/token'
const OAUTH_CLIENT_ID = '6901dd145dafc6f1f3143938'
const OAUTH_CLIENT_SECRET = '16a94e467e927cc09b3c8dc7ec92d420'
const FILE_UPLOAD_BUCKET = 'oss-hangzhou-mp4'
const FILE_UPLOAD_REGION = 'oss-cn-hangzhou'
const FILE_UPLOAD_FOLDER_TEMPLATE = 'agent_tmp/{uid}'
const FILE_UPLOAD_OBJECT_KEY_PREFIX = 'vectcut_draft_cover_'
const FILE_UPLOAD_SIGN_EXPIRES_SECONDS = 60 * 60

const CREATE_DRAFT_TOOL: Tool = {
  name: 'create_draft',
  description:
    'Create a new VectCut draft. Use this when the user asks to create or start a draft. Supports optional width, height, cover, and name. The cover can be a remote URL, file URL, or absolute local path; local covers are uploaded internally before submission. Use workspace upload only for inline screenshot/base64 inputs without a stable local file path, or when a reusable public URL is explicitly required.',
  inputSchema: {
    type: 'object',
    properties: {
      width: {
        type: 'integer',
        description: 'Optional video width. Defaults to 1080 on the API side.'
      },
      height: {
        type: 'integer',
        description: 'Optional video height. Defaults to 1920 on the API side.'
      },
      cover: {
        type: 'string',
        description: 'Optional draft cover image URL, file URL, or absolute local path.'
      },
      name: {
        type: 'string',
        description: 'Optional draft name.'
      }
    },
    additionalProperties: false
  }
}

const MODIFY_DRAFT_TOOL: Tool = {
  name: 'modify_draft',
  description:
    'Modify a VectCut draft name or cover. Use this when the user asks to update a draft title, name, or cover without changing timeline elements. The cover can be a remote URL, file URL, or absolute local path; local covers are uploaded internally before submission. Use workspace upload only for inline screenshot/base64 inputs without a stable local file path, or when a reusable public URL is explicitly required.',
  inputSchema: {
    type: 'object',
    properties: {
      draftId: {
        type: 'string',
        description: 'Required draft ID.'
      },
      draft_id: {
        type: 'string',
        description: 'Alias of draftId. Uses the same semantics as the VectCut API docs.'
      },
      name: {
        type: 'string',
        description: 'Optional new draft name.'
      },
      cover: {
        type: 'string',
        description: 'Optional new draft cover image URL, file URL, or absolute local path.'
      }
    },
    additionalProperties: false
  }
}

const QUERY_SCRIPT_TOOL: Tool = {
  name: 'query_script',
  description:
    'Inspect the current script content of a VectCut draft. Use this proactively after complex draft edits or when the user asks to verify whether draft elements were added correctly. The full script is saved into a JSON file in the current workspace, and the tool returns the absolute file path plus a lightweight summary.',
  inputSchema: {
    type: 'object',
    properties: {
      draftId: {
        type: 'string',
        description: 'Required draft ID.'
      },
      draft_id: {
        type: 'string',
        description: 'Alias of draftId. Uses the same semantics as the VectCut API docs.'
      },
      forceUpdate: {
        type: 'boolean',
        description: 'Whether to force refresh the draft query. Defaults to true.'
      },
      force_update: {
        type: 'boolean',
        description: 'Alias of forceUpdate. Uses the same semantics as the VectCut API docs.'
      }
    },
    additionalProperties: false
  }
}

type PendingToken = {
  accessToken: string
  expiresAt: number
}

type DraftMutationResponse = {
  error?: string
  output?: {
    draft_id?: string
    draft_url?: string
    [key: string]: unknown
  }
  purchase_link?: string
  success?: boolean
  [key: string]: unknown
}

type QueryScriptResponse = {
  error?: string
  output?: string
  success?: boolean
  [key: string]: unknown
}

const HTTP_URL_PATTERN = /^https?:\/\//i

class DraftManagementServer {
  public mcpServer: McpServer
  private readonly store = new Store({ name: 'vectcut' })
  private readonly workspacePath?: string
  private accessToken: PendingToken | null = null
  private refreshPromise: Promise<string> | null = null

  constructor(workspacePath?: string) {
    this.workspacePath = workspacePath
    this.mcpServer = new McpServer(
      {
        name: 'draft-management',
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
      tools: [CREATE_DRAFT_TOOL, MODIFY_DRAFT_TOOL, QUERY_SCRIPT_TOOL]
    }))

    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name
      const args = request.params.arguments ?? {}

      try {
        switch (toolName) {
          case 'create_draft':
            return await this.createDraft(args as Record<string, unknown>)
          case 'modify_draft':
            return await this.modifyDraft(args as Record<string, unknown>)
          case 'query_script':
            return await this.queryScript(args as Record<string, unknown>)
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

  private async requestWithAuth(
    endpoint: string,
    body: Record<string, unknown>
  ): Promise<Response> {
    const token = await this.ensureValidAccessToken()

    const doFetch = async (accessToken: string): Promise<Response> =>
      net.fetch(`${API_HOST}${endpoint}`, {
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

  private formatJsonResult(payload: Record<string, unknown>) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(payload, null, 2)
        }
      ]
    }
  }

  private getRequiredDraftId(args: Record<string, unknown>, toolName: string): string {
    const rawValue = typeof args.draftId === 'string' ? args.draftId : args.draft_id
    const draftId = typeof rawValue === 'string' ? rawValue.trim() : ''
    if (!draftId) {
      throw new McpError(ErrorCode.InvalidParams, `'draftId' is required for ${toolName}`)
    }
    return draftId
  }

  private getOptionalBoolean(args: Record<string, unknown>, camelKey: string, snakeKey: string, defaultValue: boolean): boolean {
    const value = args[camelKey] ?? args[snakeKey]
    return typeof value === 'boolean' ? value : defaultValue
  }

  private getOptionalTrimmedString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined
    }
    const normalized = value.trim()
    return normalized || undefined
  }

  private isHttpLikeUrl(value: string) {
    return HTTP_URL_PATTERN.test(value)
  }

  private normalizeCoverInput(value: unknown): string | undefined {
    const raw = this.getOptionalTrimmedString(value)
    if (!raw) return undefined
    if (raw.startsWith('file://')) {
      return fileURLToPath(raw)
    }
    return raw
  }

  private async uploadLocalCover(filePath: string) {
    return ossUploadService.uploadLocalFile(filePath, {
      bucket: FILE_UPLOAD_BUCKET,
      region: FILE_UPLOAD_REGION,
      folder: FILE_UPLOAD_FOLDER_TEMPLATE,
      objectKeyPrefix: FILE_UPLOAD_OBJECT_KEY_PREFIX,
      signExpiresSeconds: FILE_UPLOAD_SIGN_EXPIRES_SECONDS
    })
  }

  private async resolveCoverForSubmission(value: unknown): Promise<string | undefined> {
    const normalizedCover = this.normalizeCoverInput(value)
    if (!normalizedCover) return undefined
    if (this.isHttpLikeUrl(normalizedCover)) return normalizedCover

    if (!path.isAbsolute(normalizedCover)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "'cover' must be a remote URL, file URL, or absolute local path"
      )
    }

    const stats = await fsStat(normalizedCover)
    if (!stats.isFile()) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "'cover' must point to a local file when using an absolute local path"
      )
    }

    const uploaded = await this.uploadLocalCover(normalizedCover)
    return uploaded.signedPublicUrl
  }

  private buildScriptSummary(rawOutput: string | undefined): Record<string, unknown> | undefined {
    if (!rawOutput) {
      return undefined
    }

    try {
      const parsed = JSON.parse(rawOutput) as {
        duration?: number
        fps?: number
        canvas_config?: unknown
        tracks?: unknown[]
        materials?: Record<string, unknown>
      }
      const durationUs = typeof parsed.duration === 'number' ? parsed.duration : undefined
      const trackCount = Array.isArray(parsed.tracks) ? parsed.tracks.length : undefined
      const materialGroupCount =
        parsed.materials && typeof parsed.materials === 'object' && !Array.isArray(parsed.materials)
          ? Object.keys(parsed.materials).length
          : undefined

      return {
        duration_us: durationUs,
        duration_s: typeof durationUs === 'number' ? durationUs / 1_000_000 : undefined,
        fps: typeof parsed.fps === 'number' ? parsed.fps : undefined,
        canvas: parsed.canvas_config,
        track_count: trackCount,
        material_group_count: materialGroupCount
      }
    } catch {
      return undefined
    }
  }

  private buildScriptArtifactPayload(rawOutput: string | undefined): unknown {
    if (!rawOutput) {
      return {}
    }

    try {
      return JSON.parse(rawOutput)
    } catch {
      return {
        raw_output: rawOutput
      }
    }
  }

  private async buildCreateDraftPayload(args: Record<string, unknown>) {
    const payload: Record<string, unknown> = {}

    if (typeof args.width === 'number' && Number.isFinite(args.width)) {
      payload.width = Math.trunc(args.width)
    }
    if (typeof args.height === 'number' && Number.isFinite(args.height)) {
      payload.height = Math.trunc(args.height)
    }

    const cover = await this.resolveCoverForSubmission(args.cover)
    const name = this.getOptionalTrimmedString(args.name)
    if (cover) payload.cover = cover
    if (name) payload.name = name

    return payload
  }

  private async buildModifyDraftPayload(args: Record<string, unknown>) {
    const draftId = this.getRequiredDraftId(args, 'modify_draft')
    const payload: Record<string, unknown> = {
      draft_id: draftId
    }

    const name = this.getOptionalTrimmedString(args.name)
    const cover = await this.resolveCoverForSubmission(args.cover)
    if (name) payload.name = name
    if (cover) payload.cover = cover

    if (!name && !cover) {
      throw new McpError(ErrorCode.InvalidParams, "At least one of 'name' or 'cover' is required for modify_draft")
    }

    return payload
  }

  private buildQueryScriptPayload(args: Record<string, unknown>) {
    return {
      draft_id: this.getRequiredDraftId(args, 'query_script'),
      force_update: this.getOptionalBoolean(args, 'forceUpdate', 'force_update', true)
    }
  }

  private async createDraft(args: Record<string, unknown>) {
    const payload = await this.buildCreateDraftPayload(args)
    const response = await this.requestWithAuth(CREATE_DRAFT_ENDPOINT, payload)

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Create draft failed (${response.status}): ${body || 'unknown error'}`)
    }

    const result = (await response.json()) as DraftMutationResponse

    logger.info('Draft created', {
      success: result.success,
      draftId: result.output?.draft_id
    })

    return this.formatJsonResult({
      provider: 'vectcut',
      action: 'create_draft',
      ...result
    })
  }

  private async modifyDraft(args: Record<string, unknown>) {
    const payload = await this.buildModifyDraftPayload(args)
    const response = await this.requestWithAuth(MODIFY_DRAFT_ENDPOINT, payload)

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Modify draft failed (${response.status}): ${body || 'unknown error'}`)
    }

    const result = (await response.json()) as DraftMutationResponse

    logger.info('Draft metadata updated', {
      success: result.success,
      draftId: result.output?.draft_id ?? payload.draft_id
    })

    return this.formatJsonResult({
      provider: 'vectcut',
      action: 'modify_draft',
      ...result
    })
  }

  private async queryScript(args: Record<string, unknown>) {
    const payload = this.buildQueryScriptPayload(args)
    const response = await this.requestWithAuth(QUERY_SCRIPT_ENDPOINT, payload)

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Query draft script failed (${response.status}): ${body || 'unknown error'}`)
    }

    const result = (await response.json()) as QueryScriptResponse
    const scriptSummary = this.buildScriptSummary(result.output)
    const artifact = await persistWorkspaceJsonArtifact({
      toolName: 'draft-script',
      taskId: payload.draft_id,
      payload: this.buildScriptArtifactPayload(result.output),
      workspaceRoot: this.workspacePath,
      relativeDirSegments: ['']
    })

    if (!artifact) {
      throw new Error('No workspace root available to persist the draft script file')
    }

    logger.info('Draft script queried', {
      success: result.success,
      draftId: payload.draft_id
    })

    return this.formatJsonResult({
      provider: 'vectcut',
      action: 'query_script',
      draft_id: payload.draft_id,
      script_summary: scriptSummary,
      script_file_path: artifact.filePath,
      script_relative_path: artifact.relativePath,
      success: result.success,
      error: result.error
    })
  }
}

export default DraftManagementServer
