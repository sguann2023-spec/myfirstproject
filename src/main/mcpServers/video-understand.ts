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

import { persistWorkspaceJsonArtifact } from './workspace-json-artifact'

const logger = loggerService.withContext('MCPServer:VideoUnderstand')

const API_HOST = 'https://open.vectcut.com'
const VIDEO_DETAIL_SUBMIT_ENDPOINT = '/llm/video_detail/submit/submit_video_detail_task'
const VIDEO_DETAIL_STATUS_ENDPOINT = '/llm/video_detail/submit/task_status'
const OAUTH_TOKEN_URL = 'https://mlbd8l6vgi13-demo.authing.cn/oidc/token'
const OAUTH_CLIENT_ID = '6901dd145dafc6f1f3143938'
const OAUTH_CLIENT_SECRET = '16a94e467e927cc09b3c8dc7ec92d420'
const VIDEO_UNDERSTAND_MODEL = 'gpt-5.6-luna'
const VIDEO_UNDERSTAND_TASK_WAIT_TIME = '15-30 minutes'
const VIDEO_UNDERSTAND_POLL_INTERVAL_MS = 5 * 1000
const VIDEO_UNDERSTAND_POLL_TIMEOUT_MS = 35 * 60 * 1000
const FILE_UPLOAD_BUCKET = 'oss-hangzhou-mp4'
const FILE_UPLOAD_REGION = 'oss-cn-hangzhou'
const FILE_UPLOAD_FOLDER_TEMPLATE = 'agent_tmp/{uid}'
const FILE_UPLOAD_OBJECT_KEY_PREFIX = 'vectcut_video_understand_'
const FILE_UPLOAD_SIGN_EXPIRES_SECONDS = 60 * 60

const SUBMIT_VIDEO_DETAIL_TASK_TOOL: Tool = {
  name: 'submit_video_detail_task',
  description:
    'Submit a video understanding task, automatically upload local video files when needed, and wait until the same tool call finishes with the final result. This analyzes visual content only and does not describe audio.',
  inputSchema: {
    type: 'object',
    properties: {
      model: {
        type: 'string',
        enum: [VIDEO_UNDERSTAND_MODEL],
        description: 'Optional model. Always uses gpt-5.6-luna.'
      },
      prompt: {
        type: 'string',
        description: 'Optional custom video understanding prompt.'
      },
      videoUrl: {
        type: 'string',
        description: 'Single video URL, file URL, or absolute local video path.'
      },
      video_url: {
        type: 'string',
        description: 'Alias of videoUrl. Uses the same semantics as the VectCut API docs.'
      },
      videoUrls: {
        type: 'array',
        items: {
          type: 'string'
        },
        description: 'Multiple video URLs, file URLs, or absolute local video paths.'
      },
      video_urls: {
        type: 'array',
        items: {
          type: 'string'
        },
        description: 'Alias of videoUrls. Uses the same semantics as the VectCut API docs.'
      },
      fps: {
        type: 'number',
        description: 'Optional frame sampling rate for single-video analysis.'
      },
      fps_list: {
        type: 'array',
        items: {
          type: 'number'
        },
        description: 'Optional frame sampling rates aligned with video_urls.'
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
  sendNotification?: (notification: {
    method: 'notifications/progress'
    params: {
      progressToken: ProgressToken
      progress: number
      total?: number
      message?: string
    }
  }) => Promise<void>
}

type PreparedVideoSource = {
  originalInput: string
  submittedUrl: string
  sourceKind: 'remote_video' | 'local_video'
}

type VideoUnderstandSubmitResponse = {
  error?: string
  message?: string
  message_id?: string
  queue_name?: string
  status?: string
  success?: boolean
  task_id?: string
  [key: string]: unknown
}

type VideoUnderstandTaskStatusResponse = {
  error?: string
  message?: string | null
  progress?: number | null
  prompt?: string | null
  result?: Record<string, unknown> | null
  status?: string
  success?: boolean
  task_id?: string
  video_url?: string | null
  [key: string]: unknown
}

const isHttpLikeUrl = (value: string) => /^https?:\/\//i.test(value)

class VideoUnderstandServer {
  public mcpServer: McpServer
  private readonly store = new Store({ name: 'vectcut' })
  private readonly workspacePath?: string
  private accessToken: PendingToken | null = null
  private refreshPromise: Promise<string> | null = null

  constructor(workspacePath?: string) {
    this.workspacePath = workspacePath
    this.mcpServer = new McpServer(
      {
        name: 'video-understand',
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
      tools: [SUBMIT_VIDEO_DETAIL_TASK_TOOL]
    }))

    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const toolName = request.params.name
      const args = request.params.arguments ?? {}

      try {
        switch (toolName) {
          case 'submit_video_detail_task':
            return await this.submitVideoDetailTask(args as Record<string, unknown>, extra as ToolExecutionExtra)
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
    path: string,
    init: {
      method: 'GET' | 'POST'
      body?: Record<string, unknown>
      query?: URLSearchParams
    }
  ): Promise<Response> {
    const token = await this.ensureValidAccessToken()
    const url = new URL(`${API_HOST}${path}`)
    if (init.query) {
      url.search = init.query.toString()
    }

    const doFetch = async (accessToken: string): Promise<Response> =>
      net.fetch(url.toString(), {
        method: init.method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: init.body ? JSON.stringify(init.body) : undefined
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

  private summarizeTaskStatusResult(result: VideoUnderstandTaskStatusResponse) {
    const resultObject = result.result && typeof result.result === 'object' ? result.result : null
    const output = resultObject && typeof resultObject.output === 'object' ? (resultObject.output as Record<string, unknown>) : null
    const videoDetail = typeof output?.video_detail === 'string' ? output.video_detail : ''

    return {
      has_result: Boolean(resultObject),
      result_keys: resultObject ? Object.keys(resultObject) : [],
      output_keys: output ? Object.keys(output) : [],
      video_detail_chars: videoDetail.length
    }
  }

  private resolveModel(value: unknown): typeof VIDEO_UNDERSTAND_MODEL {
    const normalized = typeof value === 'string' ? value.trim() : ''
    if (!normalized) {
      return VIDEO_UNDERSTAND_MODEL
    }
    if (normalized !== VIDEO_UNDERSTAND_MODEL) {
      throw new McpError(ErrorCode.InvalidParams, `'model' must be ${VIDEO_UNDERSTAND_MODEL}`)
    }
    return VIDEO_UNDERSTAND_MODEL
  }

  private normalizeSource(value: unknown): string {
    const raw = String(value || '').trim()
    if (!raw) {
      throw new McpError(ErrorCode.InvalidParams, 'Video source contains an empty value')
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

  private async prepareVideoSource(input: unknown): Promise<PreparedVideoSource> {
    const normalizedSource = this.normalizeSource(input)
    if (isHttpLikeUrl(normalizedSource)) {
      return {
        originalInput: normalizedSource,
        submittedUrl: normalizedSource,
        sourceKind: 'remote_video'
      }
    }

    if (!path.isAbsolute(normalizedSource)) {
      throw new McpError(ErrorCode.InvalidParams, 'Video source must be a remote URL, file URL, or absolute local path')
    }

    const stats = await fsPromises.stat(normalizedSource)
    if (!stats.isFile()) {
      throw new McpError(ErrorCode.InvalidParams, 'Local video source must point to a file')
    }

    const uploaded = await this.uploadLocalFile(normalizedSource)
    return {
      originalInput: normalizedSource,
      submittedUrl: uploaded.signedPublicUrl,
      sourceKind: 'local_video'
    }
  }

  private normalizeNumberList(value: unknown, fieldName: string): number[] {
    if (typeof value === 'undefined') return []
    if (!Array.isArray(value)) {
      throw new McpError(ErrorCode.InvalidParams, `'${fieldName}' must be an array of numbers`)
    }
    return value.map((item) => {
      const numeric = Number(item)
      if (!Number.isFinite(numeric)) {
        throw new McpError(ErrorCode.InvalidParams, `'${fieldName}' must contain only numbers`)
      }
      return numeric
    })
  }

  private async buildSubmitPayload(args: Record<string, unknown>) {
    const videoUrl = typeof args.videoUrl === 'string' ? args.videoUrl.trim() : ''
    const videoUrlAlias = typeof args.video_url === 'string' ? args.video_url.trim() : ''
    const videoUrls = Array.isArray(args.videoUrls)
      ? args.videoUrls.map((item) => String(item || '').trim()).filter(Boolean)
      : []
    const videoUrlsAlias = Array.isArray(args.video_urls)
      ? args.video_urls.map((item) => String(item || '').trim()).filter(Boolean)
      : []
    const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
    const model = this.resolveModel(args.model)
    const fps = typeof args.fps !== 'undefined' ? Number(args.fps) : undefined
    const fpsList = this.normalizeNumberList(args.fps_list, 'fps_list')

    const resolvedVideoUrl = videoUrl || videoUrlAlias
    const resolvedVideoUrls = videoUrls.length > 0 ? videoUrls : videoUrlsAlias

    if (!resolvedVideoUrl && resolvedVideoUrls.length === 0) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Either 'videoUrl'/'video_url' or 'videoUrls'/'video_urls' is required for submit_video_detail_task"
      )
    }

    if (resolvedVideoUrl && resolvedVideoUrls.length > 0) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Provide only one source form: either 'videoUrl'/'video_url' or 'videoUrls'/'video_urls'"
      )
    }

    if (typeof fps !== 'undefined' && !Number.isFinite(fps)) {
      throw new McpError(ErrorCode.InvalidParams, "'fps' must be a number")
    }

    if (resolvedVideoUrl && fpsList.length > 0) {
      throw new McpError(ErrorCode.InvalidParams, "'fps_list' is only supported with 'videoUrls'/'video_urls'")
    }

    if (resolvedVideoUrls.length > 0 && fpsList.length > 0 && fpsList.length !== resolvedVideoUrls.length) {
      throw new McpError(ErrorCode.InvalidParams, "'fps_list' length must match 'videoUrls'/'video_urls'")
    }

    const rawSources = resolvedVideoUrl ? [resolvedVideoUrl] : resolvedVideoUrls
    const preparedSources: PreparedVideoSource[] = []
    for (const source of rawSources) {
      preparedSources.push(await this.prepareVideoSource(source))
    }

    const payload: Record<string, unknown> = {
      ...(resolvedVideoUrl ? { video_url: preparedSources[0].submittedUrl } : {}),
      ...(resolvedVideoUrls.length > 0 ? { video_urls: preparedSources.map((source) => source.submittedUrl) } : {}),
      model
    }

    if (prompt) {
      payload.prompt = prompt
    }
    if (typeof fps !== 'undefined' && Number.isFinite(fps)) {
      payload.fps = fps
    }
    if (fpsList.length > 0) {
      payload.fps_list = fpsList
    }

    return {
      payload,
      preparedSources
    }
  }

  private async sleep(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms))
  }

  private async reportProgress(extra: ToolExecutionExtra | undefined, progress: number, message: string) {
    if (!extra?._meta?.progressToken || typeof extra.sendNotification !== 'function') {
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

  private normalizeTaskStatus(value: unknown): string {
    return String(value || '').trim().toLowerCase()
  }

  private isTaskCompleted(result: VideoUnderstandTaskStatusResponse): boolean {
    const status = this.normalizeTaskStatus(result.status)
    return status === 'success' || status === 'completed' || result.success === true
  }

  private isTaskFailed(result: VideoUnderstandTaskStatusResponse): boolean {
    const status = this.normalizeTaskStatus(result.status)
    return status === 'failed' || status === 'error' || status === 'cancelled'
  }

  private mapProgress(result: VideoUnderstandTaskStatusResponse, attempt: number): number {
    if (typeof result.progress === 'number' && Number.isFinite(result.progress)) {
      const numericProgress = result.progress <= 1 ? result.progress * 100 : result.progress
      return Math.max(15, Math.min(95, Math.round(numericProgress)))
    }
    return Math.min(92, 15 + attempt * 4)
  }

  private async queryVideoDetailTaskStatus(taskId: string) {
    const response = await this.requestWithAuth(VIDEO_DETAIL_STATUS_ENDPOINT, {
      method: 'GET',
      query: new URLSearchParams({ task_id: taskId })
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Video understand status query failed (${response.status}): ${body || 'unknown error'}`)
    }

    const result = (await response.json()) as VideoUnderstandTaskStatusResponse

    logger.info('Video understand task status queried', {
      taskId,
      status: result.status,
      success: result.success
    })

    return result
  }

  private async waitForVideoDetailTaskResult(taskId: string, extra?: ToolExecutionExtra) {
    const deadline = Date.now() + VIDEO_UNDERSTAND_POLL_TIMEOUT_MS
    let attempt = 0

    while (Date.now() < deadline) {
      attempt += 1
      const result = await this.queryVideoDetailTaskStatus(taskId)
      const status = this.normalizeTaskStatus(result.status)

      logger.info('Video understand task poll', {
        taskId,
        attempt,
        status,
        success: result.success,
        progress: result.progress,
        message: result.message || ''
      })

      if (this.isTaskCompleted(result)) {
        await this.reportProgress(extra, 100, result.message || '视频理解完成')
        return result
      }

      if (this.isTaskFailed(result)) {
        throw new Error(`Video understand task failed: ${result.error || result.message || 'unknown error'}`)
      }

      await this.reportProgress(extra, this.mapProgress(result, attempt), result.message || '正在理解视频内容')
      await this.sleep(VIDEO_UNDERSTAND_POLL_INTERVAL_MS)
    }

    throw new Error(
      `Video understand task timed out after ${Math.round(VIDEO_UNDERSTAND_POLL_TIMEOUT_MS / 60000)} minutes while waiting for completion`
    )
  }

  private async submitVideoDetailTask(args: Record<string, unknown>, extra?: ToolExecutionExtra) {
    await this.reportProgress(extra, 5, '正在提交视频理解任务')
    const { payload, preparedSources } = await this.buildSubmitPayload(args)
    const response = await this.requestWithAuth(VIDEO_DETAIL_SUBMIT_ENDPOINT, {
      method: 'POST',
      body: payload
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Video understand submit failed (${response.status}): ${body || 'unknown error'}`)
    }

    const submitResult = (await response.json()) as VideoUnderstandSubmitResponse

    logger.info('Video understand task submitted', {
      taskId: submitResult.task_id,
      mode: payload.model
    })

    const taskId = String(submitResult.task_id || '').trim()
    if (!taskId) {
      throw new Error(`Video understand submission returned no task ID: ${JSON.stringify(submitResult)}`)
    }

    await this.reportProgress(extra, 12, '视频理解任务已提交，预计 15-30 分钟完成')
    const finalResult = await this.waitForVideoDetailTaskResult(taskId, extra)

    const artifactPayload = {
      provider: 'vectcut',
      action: 'submit_and_wait',
      mode: 'video_understand',
      estimated_wait_time: VIDEO_UNDERSTAND_TASK_WAIT_TIME,
      request: payload,
      source_summary: preparedSources.map((source) => ({
        original_input: source.originalInput,
        submitted_url: source.submittedUrl,
        source_kind: source.sourceKind
      })),
      ...finalResult
    }

    if (finalResult.result) {
      const artifact = await persistWorkspaceJsonArtifact({
        toolName: 'video-understand',
        taskId,
        payload: artifactPayload,
        workspaceRoot: this.workspacePath
      })

      if (artifact) {
        return this.formatJsonResult({
          provider: 'vectcut',
          action: 'submit_and_wait',
          mode: 'video_understand',
          estimated_wait_time: VIDEO_UNDERSTAND_TASK_WAIT_TIME,
          task_id: finalResult.task_id,
          status: finalResult.status,
          progress: finalResult.progress,
          message: finalResult.message || '',
          prompt: finalResult.prompt,
          video_url: finalResult.video_url,
          error: finalResult.error || '',
          success: finalResult.success,
          source_summary: artifactPayload.source_summary,
          artifact: {
            storage: 'workspace_file',
            file_path: artifact.filePath,
            relative_path: artifact.relativePath
          },
          result_summary: this.summarizeTaskStatusResult(finalResult)
        })
      }
    }

    return this.formatJsonResult(artifactPayload)
  }
}

export default VideoUnderstandServer
