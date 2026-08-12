import { loggerService } from '@logger'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
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

type SubtitleRecognitionEffectMode = (typeof SUBTITLE_RECOGNITION_EFFECT_MODES)[number]

const SUBMIT_SUBTITLE_RECOGNITION_TASK_TOOL: Tool = {
  name: 'submit_subtitle_recognition_task',
  description:
    'Submit an asynchronous subtitle recognition task for a remote audio or video URL. This extracts subtitle text and timed segments only, without writing anything back into a draft.',
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'Required remotely accessible audio or video URL.'
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

const GET_SUBTITLE_RECOGNITION_TASK_STATUS_TOOL: Tool = {
  name: 'get_subtitle_recognition_task_status',
  description: 'Query the status of a subtitle recognition task by task ID.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'Required task ID returned by submit_subtitle_recognition_task.'
      }
    },
    required: ['taskId'],
    additionalProperties: false
  }
}

type PendingToken = {
  accessToken: string
  expiresAt: number
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
      tools: [SUBMIT_SUBTITLE_RECOGNITION_TASK_TOOL, GET_SUBTITLE_RECOGNITION_TASK_STATUS_TOOL]
    }))

    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name
      const args = request.params.arguments ?? {}

      try {
        switch (toolName) {
          case 'submit_subtitle_recognition_task':
            return await this.submitSubtitleRecognitionTask(args as Record<string, unknown>)
          case 'get_subtitle_recognition_task_status':
            return await this.getSubtitleRecognitionTaskStatus(args as Record<string, unknown>)
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

  private async submitSubtitleRecognitionTask(args: Record<string, unknown>) {
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

    return this.formatJsonResult({
      provider: 'vectcut',
      action: 'submit',
      mode: 'subtitle_recognition',
      task_mode: typeof payload.content === 'string' ? 'sta' : 'asr',
      url: payload.url,
      effect_mode: payload.effect_mode,
      content: payload.content,
      ...result
    })
  }

  private async getSubtitleRecognitionTaskStatus(args: Record<string, unknown>) {
    const taskId = typeof args.taskId === 'string' ? args.taskId.trim() : ''
    if (!taskId) {
      throw new McpError(ErrorCode.InvalidParams, "'taskId' is required for get_subtitle_recognition_task_status")
    }

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

    const responsePayload = {
      provider: 'vectcut',
      action: 'status',
      mode: 'subtitle_recognition',
      ...result
    }

    if (result.result) {
      const artifact = await persistWorkspaceJsonArtifact({
        toolName: 'subtitle-recognition',
        taskId,
        payload: responsePayload,
        workspaceRoot: this.workspacePath
      })

      if (artifact) {
        return this.formatJsonResult({
          provider: 'vectcut',
          action: 'status',
          mode: result.mode || 'subtitle_recognition',
          error: result.error || '',
          message: result.message || '',
          progress: result.progress,
          success: result.success,
          status: result.status,
          task_id: result.task_id,
          url: result.url,
          artifact: {
            storage: 'workspace_file',
            file_path: artifact.filePath,
            relative_path: artifact.relativePath
          },
          result_summary: this.summarizeTaskStatusResult(result)
        })
      }
    }

    return this.formatJsonResult(responsePayload)
  }
}

export default SubtitleRecognitionServer
