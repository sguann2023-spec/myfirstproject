import fsPromises from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loggerService } from '@logger'
import { ossUploadService } from '@main/services/OssUploadService'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
import type { ProgressToken } from '@modelcontextprotocol/sdk/types.js'
import Store from 'electron-store'
import { net } from 'electron'

const logger = loggerService.withContext('MCPServer:KouboTemplate')

const API_HOST = 'https://open.vectcut.com'
const KOUBO_TEMPLATE_SUBMIT_ENDPOINT = '/cut_jianying/agent/submit_agent_task'
const KOUBO_TEMPLATE_STATUS_ENDPOINT = '/cut_jianying/agent/task_status'
const OAUTH_TOKEN_URL = 'https://mlbd8l6vgi13-demo.authing.cn/oidc/token'
const OAUTH_CLIENT_ID = '6901dd145dafc6f1f3143938'
const OAUTH_CLIENT_SECRET = '16a94e467e927cc09b3c8dc7ec92d420'
const KOUBO_TEMPLATE_TASK_WAIT_TIME = '5-15 minutes'
const KOUBO_TEMPLATE_POLL_INTERVAL_MS = 5 * 1000
const KOUBO_TEMPLATE_POLL_TIMEOUT_MS = 20 * 60 * 1000
const FILE_UPLOAD_BUCKET = 'oss-hangzhou-mp4'
const FILE_UPLOAD_REGION = 'oss-cn-hangzhou'
const FILE_UPLOAD_FOLDER_TEMPLATE = 'agent_tmp/{uid}'
const FILE_UPLOAD_OBJECT_KEY_PREFIX = 'vectcut_koubo_template_'
const FILE_UPLOAD_SIGN_EXPIRES_SECONDS = 60 * 60
const MAX_LOCAL_VIDEO_FILE_SIZE_BYTES = 500 * 1024 * 1024

const KOUBO_TEMPLATE_AGENT_IDS = {
  knowledge_pip: 'koubo_8f4e3d2a91c74b76a85d2c4e7f8a9b1c',
  classic_detail_yellow: 'koubo_ddfe028229d24696bf080303c95f604c',
  traditional_bilingual: 'koubo_cbbe5e6b468844e782c961fd9ee07b7d',
  national_classic: 'koubo_d8b7f9e05c4a11efb9620242ac120003',
  basic_yellow_white: 'koubo_b82feeb636f3476a9a752ebd745d9750',
  ai_trim_pauses: 'koubo_2dfb2efedde84791b218cfd798531bc8',
  classic_grass_green: 'koubo_a3d4f6b8c1e24f7b9a0d5e6c8f2b1a97',
  international_orange_bilingual: 'koubo_e7c1a9d4b6f24c8e91a3d5b7f0c2e6a8',
  eye_catching_green_bilingual: 'koubo_39ff88a1b2c34d5e9f0a6b7c8d9e0123',
  intellectual_red: 'koubo_f47ac10b58cc4372a5670e02b2c3d479',
  classical_dark_brown: 'koubo_7b2f0c9d4e6a41f8b3c5d7e9a1b2c4d6',
  fisheye_ins: 'koubo_5e7a9c3d1f2b4a6e8c0d5f7b9e1a3c6d',
  luxury_white_bilingual: 'koubo_6a4f2c9e8b1d4f7aa3c5e9d02b6f8c13'
} as const

type KouboTemplateKey = keyof typeof KOUBO_TEMPLATE_AGENT_IDS

const KOUBO_TEMPLATE_REQUIREMENTS: Record<KouboTemplateKey, Array<'media_urls' | 'kongjing_urls'>> = {
  knowledge_pip: ['media_urls'],
  classic_detail_yellow: ['media_urls', 'kongjing_urls'],
  traditional_bilingual: ['media_urls'],
  national_classic: ['media_urls'],
  basic_yellow_white: ['media_urls'],
  ai_trim_pauses: ['media_urls'],
  classic_grass_green: ['media_urls'],
  international_orange_bilingual: ['media_urls'],
  eye_catching_green_bilingual: ['media_urls'],
  intellectual_red: ['media_urls'],
  classical_dark_brown: ['media_urls'],
  fisheye_ins: ['media_urls'],
  luxury_white_bilingual: ['media_urls']
}

const SUBMIT_KOUBO_TEMPLATE_TASK_TOOL: Tool = {
  name: 'submit_koubo_template_task',
  description:
    'Create a VectCut talking-head template result from source speaking video media and wait until the task finishes in the same tool call. Remotely accessible video URLs are accepted directly, and local file URLs or absolute local video paths are also supported and handled internally by the tool. Koubo template only accepts video input.',
  inputSchema: {
    type: 'object',
    properties: {
      template: {
        type: 'string',
        enum: Object.keys(KOUBO_TEMPLATE_AGENT_IDS),
        description: 'Optional built-in template alias. Use this instead of agentId for known templates.'
      },
      agentId: {
        type: 'string',
        description: 'Optional raw agent ID. Required when template is omitted.'
      },
      videoUrl: {
        type: 'string',
        description: 'Single source talking-head video URL. Remotely accessible URLs are accepted directly, and local file URLs or absolute local video paths are handled internally.'
      },
      videoUrls: {
        type: 'array',
        items: {
          type: 'string'
        },
        description: 'Source talking-head video URLs. Remotely accessible URLs are accepted directly, and local file URLs or absolute local video paths are handled internally. Most templates require exactly one.'
      },
      textContent: {
        type: 'string',
        description: 'Optional corrected script text.'
      },
      title: {
        type: 'string',
        description: 'Optional top title text.'
      },
      cover: {
        type: 'string',
        description: 'Optional single cover image URL.'
      },
      coverUrls: {
        type: 'array',
        items: {
          type: 'string'
        },
        description: 'Optional cover image URLs.'
      },
      kongjingUrls: {
        type: 'array',
        items: {
          type: 'string'
        },
        description: 'Optional kongjing material URLs. Required for classic_detail_yellow.'
      },
      author: {
        type: 'string',
        description: 'Optional author name.'
      },
      name: {
        type: 'string',
        description: 'Optional draft name.'
      },
      params: {
        type: 'object',
        description: 'Optional raw params object merged with top-level fields.'
      }
    },
    additionalProperties: true
  }
}

type PendingToken = {
  accessToken: string
  expiresAt: number
}

type ToolExecutionExtra = {
  requestId: string | number
  _meta?: {
    progressToken?: ProgressToken
  }
  sendNotification: (notification: {
    method: 'notifications/progress'
    params: {
      progressToken: ProgressToken
      progress: number
      total?: number
      message?: string
    }
  }) => Promise<void>
}

type PreparedKouboTemplateSource = {
  originalInput: string
  submittedUrl: string
  sourceKind: 'remote_video' | 'local_video'
  fileSizeBytes?: number
}

type KouboTemplateSubmitResponse = {
  task_id?: string
  [key: string]: unknown
}

type KouboTemplateStatusResponse = {
  error?: string
  message?: string
  output?: {
    draft_id?: string
    draft_url?: string
    video_url?: string
    [key: string]: unknown
  }
  purchase_link?: string
  status?: 'processing' | 'success' | 'failed'
  success?: boolean
  task_id?: string
  [key: string]: unknown
}

const isHttpLikeUrl = (value: string) => /^https?:\/\//i.test(value)

class KouboTemplateServer {
  public mcpServer: McpServer
  private readonly store = new Store({ name: 'vectcut' })
  private accessToken: PendingToken | null = null
  private refreshPromise: Promise<string> | null = null

  constructor() {
    this.mcpServer = new McpServer(
      {
        name: 'koubo-template',
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
      tools: [SUBMIT_KOUBO_TEMPLATE_TASK_TOOL]
    }))

    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const toolName = request.params.name
      const args = request.params.arguments ?? {}

      try {
        switch (toolName) {
          case 'submit_koubo_template_task':
            return await this.submitKouboTemplateTask(args as Record<string, unknown>, extra as ToolExecutionExtra)
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
    options: {
      method?: 'GET' | 'POST'
      body?: Record<string, unknown>
      query?: Record<string, string | number | boolean>
    }
  ): Promise<Response> {
    const token = await this.ensureValidAccessToken()
    const method = options.method ?? 'POST'

    const buildUrl = () => {
      const url = new URL(`${API_HOST}${endpoint}`)
      for (const [key, value] of Object.entries(options.query ?? {})) {
        url.searchParams.set(key, String(value))
      }
      return url.toString()
    }

    const doFetch = async (accessToken: string): Promise<Response> =>
      net.fetch(buildUrl(), {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(options.body ? { 'Content-Type': 'application/json' } : {})
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {})
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

  private getStringArray(value: unknown): string[] {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      return trimmed ? [trimmed] : []
    }
    if (!Array.isArray(value)) {
      return []
    }

    return value.map((item) => String(item || '').trim()).filter(Boolean)
  }

  private normalizeSource(value: unknown, fieldName: string): string {
    const raw = String(value || '').trim()
    if (!raw) {
      throw new McpError(ErrorCode.InvalidParams, `'${fieldName}' contains an empty source`)
    }
    if (raw.startsWith('file://')) {
      return fileURLToPath(raw)
    }
    return raw
  }

  private async uploadLocalFile(filePath: string) {
    return ossUploadService.uploadLocalFile(filePath, {
      bucket: FILE_UPLOAD_BUCKET,
      region: FILE_UPLOAD_REGION,
      folder: FILE_UPLOAD_FOLDER_TEMPLATE,
      objectKeyPrefix: FILE_UPLOAD_OBJECT_KEY_PREFIX,
      signExpiresSeconds: FILE_UPLOAD_SIGN_EXPIRES_SECONDS
    })
  }

  private ensureAudioInputNotUsed(args: Record<string, unknown>, payloadParams: Record<string, unknown>) {
    const topLevelAudioInputs = this.getStringArray(args.audioUrls ?? args.audio_urls ?? args.audioUrl ?? args.audio_url)
    const paramAudioInputs = this.getStringArray(payloadParams.audio_urls ?? payloadParams.audio_url)

    if (topLevelAudioInputs.length > 0 || paramAudioInputs.length > 0) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "'audioUrl'/'audioUrls' are not supported for koubo template; this tool requires video input"
      )
    }
  }

  private async prepareVideoSourceForSubmission(input: unknown, fieldName: string): Promise<PreparedKouboTemplateSource> {
    const normalizedSource = this.normalizeSource(input, fieldName)
    if (isHttpLikeUrl(normalizedSource)) {
      return {
        originalInput: normalizedSource,
        submittedUrl: normalizedSource,
        sourceKind: 'remote_video'
      }
    }

    if (!path.isAbsolute(normalizedSource)) {
      throw new McpError(ErrorCode.InvalidParams, `'${fieldName}' must be a remotely accessible URL, file URL, or absolute local path`)
    }

    const stats = await fsPromises.stat(normalizedSource)
    if (!stats.isFile()) {
      throw new McpError(ErrorCode.InvalidParams, `'${fieldName}' must point to a local file when using a local path`)
    }
    if (stats.size > MAX_LOCAL_VIDEO_FILE_SIZE_BYTES) {
      throw new McpError(ErrorCode.InvalidParams, '本地视频文件大小不能超过 500MB， 如有需要请去官网资产库上传：https://www.vectcut.com/materials')
    }

    const uploaded = await this.uploadLocalFile(normalizedSource)
    return {
      originalInput: normalizedSource,
      submittedUrl: uploaded.signedPublicUrl,
      sourceKind: 'local_video',
      fileSizeBytes: stats.size
    }
  }

  private resolveTemplate(args: Record<string, unknown>) {
    const templateValue = typeof args.template === 'string' ? args.template.trim() : ''
    const template = templateValue as KouboTemplateKey
    const agentIdValue = typeof args.agentId === 'string' ? args.agentId : args.agent_id
    const agentId = typeof agentIdValue === 'string' ? agentIdValue.trim() : ''

    if (template && template in KOUBO_TEMPLATE_AGENT_IDS) {
      return {
        template,
        agentId: KOUBO_TEMPLATE_AGENT_IDS[template]
      }
    }

    if (template) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown template: ${template}`)
    }

    if (!agentId) {
      throw new McpError(ErrorCode.InvalidParams, "'template' or 'agentId' is required")
    }

    return {
      template: null,
      agentId
    }
  }

  private async buildSubmitPayload(args: Record<string, unknown>) {
    const resolved = this.resolveTemplate(args)
    const rawParams =
      args.params && typeof args.params === 'object' && !Array.isArray(args.params)
        ? { ...(args.params as Record<string, unknown>) }
        : {}

    const payloadParams: Record<string, unknown> = { ...rawParams }
    this.ensureAudioInputNotUsed(args, payloadParams)

    const videoInputs = this.getStringArray(args.videoUrls ?? args.video_urls ?? args.videoUrl ?? args.video_url)
    const coverUrls = this.getStringArray(args.coverUrls ?? args.cover_urls ?? args.cover)
    const kongjingUrls = this.getStringArray(args.kongjingUrls ?? args.kongjing_urls)

    if (coverUrls.length > 0) {
      payloadParams.cover = coverUrls
    }

    if (kongjingUrls.length > 0) {
      payloadParams.kongjing_urls = kongjingUrls
    }

    const stringFieldMappings: Array<[string, string]> = [
      ['textContent', 'text_content'],
      ['title', 'title'],
      ['author', 'author'],
      ['name', 'name']
    ]

    for (const [argKey, payloadKey] of stringFieldMappings) {
      const value = typeof args[argKey] === 'string' ? args[argKey].trim() : ''
      if (value) {
        payloadParams[payloadKey] = value
      }
    }

    const normalizedVideoInputs = [...this.getStringArray(payloadParams.video_url), ...videoInputs].filter(Boolean)
    if (normalizedVideoInputs.length === 0) {
      throw new McpError(ErrorCode.InvalidParams, "'videoUrl' or 'videoUrls' is required for koubo template")
    }

    const preparedSources: PreparedKouboTemplateSource[] = []
    for (const videoInput of normalizedVideoInputs) {
      preparedSources.push(await this.prepareVideoSourceForSubmission(videoInput, 'videoUrl/videoUrls'))
    }

    payloadParams.video_url = preparedSources.map((source) => source.submittedUrl)
    delete payloadParams.audio_url
    delete payloadParams.audio_urls

    if (resolved.template) {
      const requirements = KOUBO_TEMPLATE_REQUIREMENTS[resolved.template]
      for (const requirement of requirements) {
        if (requirement === 'media_urls' && this.getStringArray(payloadParams.video_url).length === 0) {
          throw new McpError(ErrorCode.InvalidParams, `'${resolved.template}' requires 'videoUrl'/'videoUrls'`)
        }
        if (requirement === 'kongjing_urls' && this.getStringArray(payloadParams.kongjing_urls).length === 0) {
          throw new McpError(ErrorCode.InvalidParams, `'${resolved.template}' requires 'kongjingUrls'`)
        }
      }
    }

    return {
      template: resolved.template,
      preparedSources,
      body: {
        agent_id: resolved.agentId,
        params: payloadParams
      }
    }
  }

  private async sleep(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms))
  }

  private async reportProgress(extra: ToolExecutionExtra | undefined, progress: number, message: string) {
    if (!extra?._meta?.progressToken) {
      return
    }

    await extra.sendNotification({
      method: 'notifications/progress',
      params: {
        progressToken: extra._meta.progressToken,
        progress,
        total: 100,
        message
      }
    })
  }

  private async queryKouboTemplateTaskStatus(taskId: string) {
    const response = await this.requestWithAuth(KOUBO_TEMPLATE_STATUS_ENDPOINT, {
      method: 'GET',
      query: {
        task_id: taskId
      }
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Koubo template status query failed (${response.status}): ${body || 'unknown error'}`)
    }

    const result = (await response.json()) as KouboTemplateStatusResponse

    logger.info('Koubo template task status queried', {
      taskId,
      status: result.status,
      success: result.success
    })

    return result
  }

  private async waitForKouboTemplateTaskResult(taskId: string, extra?: ToolExecutionExtra) {
    const deadline = Date.now() + KOUBO_TEMPLATE_POLL_TIMEOUT_MS
    let latestResult: KouboTemplateStatusResponse | null = null
    let attempt = 0

    while (Date.now() < deadline) {
      attempt += 1
      latestResult = await this.queryKouboTemplateTaskStatus(taskId)
      const status = String(latestResult.status || '').trim().toLowerCase()

      logger.info('Koubo template task poll', {
        taskId,
        attempt,
        status,
        success: latestResult.success,
        message: latestResult.message || ''
      })

      if (status === 'processing') {
        const mappedProgress = Math.min(90, 20 + attempt * 8)
        await this.reportProgress(extra, mappedProgress, latestResult.message || '口播模版处理中')
      }

      if (status === 'success') {
        await this.reportProgress(extra, 100, latestResult.message || '口播模版处理完成')
        return latestResult
      }

      if (status === 'failed' || status === 'error') {
        throw new Error(
          `Koubo template task failed: ${latestResult.error || latestResult.message || latestResult.output?.error || 'unknown error'}`
        )
      }

      await this.sleep(KOUBO_TEMPLATE_POLL_INTERVAL_MS)
    }

    throw new Error(
      `Koubo template task timed out after ${Math.round(KOUBO_TEMPLATE_POLL_TIMEOUT_MS / 60000)} minutes while waiting for completion`
    )
  }

  private async submitKouboTemplateTask(args: Record<string, unknown>, extra?: ToolExecutionExtra) {
    await this.reportProgress(extra, 5, '正在提交口播模版任务')
    const payload = await this.buildSubmitPayload(args)
    const response = await this.requestWithAuth(KOUBO_TEMPLATE_SUBMIT_ENDPOINT, {
      method: 'POST',
      body: payload.body
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Koubo template submission failed (${response.status}): ${body || 'unknown error'}`)
    }

    const result = (await response.json()) as KouboTemplateSubmitResponse

    logger.info('Koubo template task submitted', {
      template: payload.template ?? 'custom',
      agentId: payload.body.agent_id,
      taskId: result.task_id
    })

    const taskId = String(result.task_id || '').trim()
    if (!taskId) {
      throw new Error(`Koubo template submission returned no task ID: ${JSON.stringify(result)}`)
    }

    await this.reportProgress(extra, 12, '口播模版任务已提交，正在处理中')
    const finalResult = await this.waitForKouboTemplateTaskResult(taskId, extra)

    return this.formatJsonResult({
      provider: 'vectcut',
      action: 'submit_and_wait',
      mode: 'koubo_template',
      estimated_wait_time: KOUBO_TEMPLATE_TASK_WAIT_TIME,
      template: payload.template,
      agent_id: payload.body.agent_id,
      source_summary: payload.preparedSources.map((source) => ({
        original_input: source.originalInput,
        submitted_url: source.submittedUrl,
        source_kind: source.sourceKind,
        file_size_bytes: source.fileSizeBytes
      })),
      ...finalResult,
      task_id: undefined
    })
  }
}

export default KouboTemplateServer
