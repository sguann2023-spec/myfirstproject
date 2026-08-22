import { loggerService } from '@logger'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
import type { ProgressToken } from '@modelcontextprotocol/sdk/types.js'
import Store from 'electron-store'
import { net } from 'electron'

import { persistWorkspaceJsonArtifact } from './workspace-json-artifact'

const logger = loggerService.withContext('MCPServer:SubtitleRecognition')

const API_HOST = 'https://open.vectcut.com'
const SUBTITLE_RECOGNITION_SUBMIT_ENDPOINT = '/llm/asr/asr_llm/submit_task/submit_asr_llm_task'
const SUBTITLE_RECOGNITION_STATUS_ENDPOINT = '/llm/asr/asr_llm/submit_task/task_status'
const OAUTH_TOKEN_URL = 'https://mlbd8l6vgi13-demo.authing.cn/oidc/token'
const OAUTH_CLIENT_ID = '6901dd145dafc6f1f3143938'
const OAUTH_CLIENT_SECRET = '16a94e467e927cc09b3c8dc7ec92d420'
const SUBTITLE_RECOGNITION_EFFECT_MODES = ['basic', 'nlp', 'llm', 'llm_vad'] as const
const SUBTITLE_RECOGNITION_TASK_WAIT_TIME = '15-30 minutes'
const SUBTITLE_RECOGNITION_POLL_INTERVAL_MS = 5 * 1000
const SUBTITLE_RECOGNITION_POLL_TIMEOUT_MS = 35 * 60 * 1000

type SubtitleRecognitionEffectMode = (typeof SUBTITLE_RECOGNITION_EFFECT_MODES)[number]

const SUBMIT_SUBTITLE_RECOGNITION_TASK_TOOL: Tool = {
  name: 'submit_subtitle_recognition_task',
  description:
    'Run subtitle recognition for a remote audio or video URL and wait until the same tool call finishes. This extracts subtitle text and timed segments only, without writing anything back into a draft. If the source is a local file, run workspace upload first and pass the returned URL here.',
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'Required remotely accessible audio or video URL. Use workspace upload first for local files.'
      },
      effectMode: {
        type: 'string',
        enum: [...SUBTITLE_RECOGNITION_EFFECT_MODES],
        description:
          'Optional recognition strength. Use basic for fast baseline ASR, nlp for fast short-video sentence splitting with a 12-character limit per line, llm for smarter splitting plus translation and keywords, and llm_vad for the llm mode with extra cleanup of pauses, repeats, and incorrect words. Defaults to llm.'
      },
      content: {
        type: 'string',
        description: 'Optional target transcript for STA alignment mode. Omit this for plain ASR recognition.'
      }
    },
    required: ['url'],
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

type SubtitleRecognitionSubmitResponse = {
  success?: boolean
  task_id?: string
  message_id?: string
  status?: string
  effect_mode?: string
  error?: string
  [key: string]: unknown
}

type SubtitleRecognitionTaskStatusResponse = {
  error?: string
  message?: string
  mode?: string
  progress?: number
  result?: {
    content?: string
    error?: string
    mode?: string
    effect_mode?: string
    segments?: unknown[]
    [key: string]: unknown
  }
  success?: boolean
  status?: string
  task_id?: string
  url?: string
  [key: string]: unknown
}

class SubtitleRecognitionServer {
  public mcpServer: McpServer
  private readonly store = new Store({ name: 'vectcut' })
  private readonly workspacePath?: string
  private accessToken: PendingToken | null = null
  private refreshPromise: Promise<string> | null = null

  constructor(workspacePath?: string) {
    this.workspacePath = workspacePath
    this.mcpServer = new McpServer(
      {
        name: 'subtitle-recognition',
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
      tools: [SUBMIT_SUBTITLE_RECOGNITION_TASK_TOOL]
    }))

    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const toolName = request.params.name
      const args = request.params.arguments ?? {}

      try {
        switch (toolName) {
          case 'submit_subtitle_recognition_task':
            return await this.submitSubtitleRecognitionTask(args as Record<string, unknown>, extra as ToolExecutionExtra)
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

  private summarizeTaskStatusResult(result: SubtitleRecognitionTaskStatusResponse) {
    const content = typeof result.result?.content === 'string' ? result.result.content : ''
    const segments = Array.isArray(result.result?.segments) ? result.result.segments : []

    return {
      has_result: Boolean(result.result),
      content_chars: content.length,
      segment_count: segments.length,
      result_mode: result.result?.mode,
      effect_mode: result.result?.effect_mode,
      error: result.result?.error || ''
    }
  }

  private resolveEffectMode(value: unknown): SubtitleRecognitionEffectMode {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
    if (!normalized) {
      return 'llm'
    }
    if (!SUBTITLE_RECOGNITION_EFFECT_MODES.includes(normalized as SubtitleRecognitionEffectMode)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `'effectMode' must be one of: ${SUBTITLE_RECOGNITION_EFFECT_MODES.join(', ')}`
      )
    }
    return normalized as SubtitleRecognitionEffectMode
  }

  private buildSubmitPayload(args: Record<string, unknown>) {
    const url = typeof args.url === 'string' ? args.url.trim() : ''
    if (!url) {
      throw new McpError(ErrorCode.InvalidParams, "'url' is required for submit_subtitle_recognition_task")
    }

    const payload: Record<string, unknown> = {
      url,
      effect_mode: this.resolveEffectMode(args.effectMode)
    }

    if (typeof args.content === 'string' && args.content.trim()) {
      payload.content = args.content.trim()
    }

    return payload
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

  private normalizeTaskStatus(value: unknown): string {
    return String(value || '').trim().toLowerCase()
  }

  private isTaskCompleted(result: SubtitleRecognitionTaskStatusResponse): boolean {
    const status = this.normalizeTaskStatus(result.status)
    if (status === 'success' || status === 'completed' || status === 'done') {
      return true
    }
    return false
  }

  private isTaskFailed(result: SubtitleRecognitionTaskStatusResponse): boolean {
    const status = this.normalizeTaskStatus(result.status)
    return status === 'failed' || status === 'error' || status === 'cancelled'
  }

  private mapProgress(result: SubtitleRecognitionTaskStatusResponse, attempt: number): number {
    if (typeof result.progress === 'number' && Number.isFinite(result.progress)) {
      const numericProgress = result.progress <= 1 ? result.progress * 100 : result.progress
      return Math.max(15, Math.min(95, Math.round(numericProgress)))
    }
    return Math.min(92, 15 + attempt * 4)
  }

  private async querySubtitleRecognitionTaskStatus(taskId: string) {
    const response = await this.requestWithAuth(SUBTITLE_RECOGNITION_STATUS_ENDPOINT, {
      method: 'GET',
      query: new URLSearchParams({ task_id: taskId })
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Subtitle recognition status query failed (${response.status}): ${body || 'unknown error'}`)
    }

    const result = (await response.json()) as SubtitleRecognitionTaskStatusResponse

    logger.info('Subtitle recognition task status queried', {
      taskId,
      status: result.status,
      success: result.success
    })

    return result
  }

  private async waitForSubtitleRecognitionTaskResult(taskId: string, extra?: ToolExecutionExtra) {
    const deadline = Date.now() + SUBTITLE_RECOGNITION_POLL_TIMEOUT_MS
    let attempt = 0

    while (Date.now() < deadline) {
      attempt += 1
      const result = await this.querySubtitleRecognitionTaskStatus(taskId)
      const status = this.normalizeTaskStatus(result.status)

      logger.info('Subtitle recognition task poll', {
        taskId,
        attempt,
        status,
        success: result.success,
        progress: result.progress,
        message: result.message || ''
      })

      if (this.isTaskCompleted(result)) {
        await this.reportProgress(extra, 100, result.message || '字幕识别完成')
        return result
      }

      if (this.isTaskFailed(result)) {
        throw new Error(
          `Subtitle recognition task failed: ${result.error || result.result?.error || result.message || 'unknown error'}`
        )
      }

      await this.reportProgress(extra, this.mapProgress(result, attempt), result.message || '正在识别字幕')
      await this.sleep(SUBTITLE_RECOGNITION_POLL_INTERVAL_MS)
    }

    throw new Error(
      `Subtitle recognition task timed out after ${Math.round(SUBTITLE_RECOGNITION_POLL_TIMEOUT_MS / 60000)} minutes while waiting for completion`
    )
  }

  private async submitSubtitleRecognitionTask(args: Record<string, unknown>, extra?: ToolExecutionExtra) {
    await this.reportProgress(extra, 5, '正在提交字幕识别任务')
    const payload = this.buildSubmitPayload(args)
    const response = await this.requestWithAuth(SUBTITLE_RECOGNITION_SUBMIT_ENDPOINT, {
      method: 'POST',
      body: payload
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Subtitle recognition submit failed (${response.status}): ${body || 'unknown error'}`)
    }

    const result = (await response.json()) as SubtitleRecognitionSubmitResponse

    logger.info('Subtitle recognition task submitted', {
      effectMode: payload.effect_mode,
      taskId: result.task_id
    })

    const taskId = typeof result.task_id === 'string' ? result.task_id.trim() : ''
    if (!taskId) {
      throw new Error(`Subtitle recognition submission returned no task ID: ${JSON.stringify(result)}`)
    }

    await this.reportProgress(extra, 12, '字幕识别任务已提交，正在处理中')
    const finalResult = await this.waitForSubtitleRecognitionTaskResult(taskId, extra)

    const summaryPayload = {
      provider: 'vectcut',
      action: 'submit_and_wait',
      mode: 'subtitle_recognition',
      estimated_wait_time: SUBTITLE_RECOGNITION_TASK_WAIT_TIME,
      task_mode: typeof payload.content === 'string' ? 'sta' : 'asr',
      url: payload.url,
      effect_mode: payload.effect_mode,
      source_summary: [
        {
          original_input: payload.url,
          submitted_url: payload.url,
          source_kind: 'remote_media'
        }
      ],
      error: finalResult.error || '',
      message: finalResult.message || '',
      progress: finalResult.progress,
      success: finalResult.success,
      status: finalResult.status,
      content: typeof finalResult.result?.content === 'string' ? finalResult.result.content : '',
      recognition_mode: finalResult.mode,
      recognition_url: finalResult.url,
      task_id: undefined
    }

    if (finalResult.result) {
      const artifactPayload = {
        ...summaryPayload,
        result: finalResult.result
      }

      const artifact = await persistWorkspaceJsonArtifact({
        toolName: 'subtitle-recognition',
        taskId,
        payload: artifactPayload,
        workspaceRoot: this.workspacePath,
        relativeDirSegments: []
      })

      if (artifact) {
        return this.formatJsonResult({
          ...summaryPayload,
          artifact: {
            storage: 'workspace_file',
            file_path: artifact.filePath,
            relative_path: artifact.relativePath
          },
          result_summary: this.summarizeTaskStatusResult(finalResult)
        })
      }
    }

    return this.formatJsonResult({
      ...summaryPayload,
      result_summary: this.summarizeTaskStatusResult(finalResult)
    })
  }
}

export default SubtitleRecognitionServer
