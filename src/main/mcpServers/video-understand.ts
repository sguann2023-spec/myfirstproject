import { loggerService } from '@logger'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
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

const SUBMIT_VIDEO_DETAIL_TASK_TOOL: Tool = {
  name: 'submit_video_detail_task',
  description:
    'Submit an asynchronous video understanding task for one or more remote video URLs. This analyzes visual content only and does not describe audio. If the source is a local file, run workspace upload first and pass the returned URL here.',
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
        description: 'Single remote video URL. Use workspace upload first for local files.'
      },
      video_url: {
        type: 'string',
        description: 'Alias of videoUrl. Uses the same semantics as the VectCut API docs. Use workspace upload first for local files.'
      },
      videoUrls: {
        type: 'array',
        items: {
          type: 'string'
        },
        description: 'Multiple remote video URLs. Use workspace upload first for local files.'
      },
      video_urls: {
        type: 'array',
        items: {
          type: 'string'
        },
        description: 'Alias of videoUrls. Uses the same semantics as the VectCut API docs. Use workspace upload first for local files.'
      }
    },
    additionalProperties: true
  }
}

const GET_VIDEO_DETAIL_TASK_STATUS_TOOL: Tool = {
  name: 'get_video_detail_task_status',
  description: 'Query the status of a video understanding task by task ID.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'Task ID returned by submit_video_detail_task.'
      },
      task_id: {
        type: 'string',
        description: 'Alias of taskId. Uses the same semantics as the VectCut API docs.'
      }
    },
    additionalProperties: false
  }
}

type PendingToken = {
  accessToken: string
  expiresAt: number
}

type VideoUnderstandSubmitResponse = {
  error?: string
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
      tools: [SUBMIT_VIDEO_DETAIL_TASK_TOOL, GET_VIDEO_DETAIL_TASK_STATUS_TOOL]
    }))

    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name
      const args = request.params.arguments ?? {}

      try {
        switch (toolName) {
          case 'submit_video_detail_task':
            return await this.submitVideoDetailTask(args as Record<string, unknown>)
          case 'get_video_detail_task_status':
            return await this.getVideoDetailTaskStatus(args as Record<string, unknown>)
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

  private buildSubmitPayload(args: Record<string, unknown>) {
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

    const payload: Record<string, unknown> = {
      ...(resolvedVideoUrl ? { video_url: resolvedVideoUrl } : {}),
      ...(resolvedVideoUrls.length > 0 ? { video_urls: resolvedVideoUrls } : {})
    }

    payload.model = model
    if (prompt) {
      payload.prompt = prompt
    }

    return payload
  }

  private async submitVideoDetailTask(args: Record<string, unknown>) {
    const payload = this.buildSubmitPayload(args)
    const response = await this.requestWithAuth(VIDEO_DETAIL_SUBMIT_ENDPOINT, {
      method: 'POST',
      body: payload
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Video understand submit failed (${response.status}): ${body || 'unknown error'}`)
    }

    const result = (await response.json()) as VideoUnderstandSubmitResponse

    logger.info('Video understand task submitted', {
      taskId: result.task_id,
      mode: payload.model
    })

    return this.formatJsonResult({
      provider: 'vectcut',
      action: 'submit',
      mode: 'video_understand',
      request: payload,
      ...result
    })
  }

  private async getVideoDetailTaskStatus(args: Record<string, unknown>) {
    const taskId =
      typeof args.taskId === 'string'
        ? args.taskId.trim()
        : typeof args.task_id === 'string'
          ? args.task_id.trim()
          : ''

    if (!taskId) {
      throw new McpError(ErrorCode.InvalidParams, "'taskId'/'task_id' is required for get_video_detail_task_status")
    }

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

    const responsePayload = {
      provider: 'vectcut',
      action: 'status',
      mode: 'video_understand',
      ...result
    }

    if (result.result) {
      const artifact = await persistWorkspaceJsonArtifact({
        toolName: 'video-understand',
        taskId,
        payload: responsePayload,
        workspaceRoot: this.workspacePath
      })

      if (artifact) {
        return this.formatJsonResult({
          provider: 'vectcut',
          action: 'status',
          mode: 'video_understand',
          task_id: result.task_id,
          status: result.status,
          progress: result.progress,
          message: result.message || '',
          prompt: result.prompt,
          video_url: result.video_url,
          error: result.error || '',
          success: result.success,
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

export default VideoUnderstandServer
