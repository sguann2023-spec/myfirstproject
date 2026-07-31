import { loggerService } from '@logger'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
import Store from 'electron-store'
import { net } from 'electron'

const logger = loggerService.withContext('MCPServer:VoiceConversion')

const API_HOST = 'https://open.vectcut.com'
const VOICE_CONVERSION_SUBMIT_ENDPOINT = '/llm/sts/submit/generate'
const VOICE_CONVERSION_STATUS_ENDPOINT = '/llm/sts/submit/task_status'
const OAUTH_TOKEN_URL = 'https://mlbd8l6vgi13-demo.authing.cn/oidc/token'
const OAUTH_CLIENT_ID = '6901dd145dafc6f1f3143938'
const OAUTH_CLIENT_SECRET = '16a94e467e927cc09b3c8dc7ec92d420'

const SUBMIT_VOICE_CONVERSION_TASK_TOOL: Tool = {
  name: 'submit_voice_conversion_task',
  description:
    'Submit an asynchronous voice conversion task for a remote audio or video URL and a target voice ID. This keeps the source performance and converts the voice timbre instead of re-synthesizing text with TTS.',
  inputSchema: {
    type: 'object',
    properties: {
      audioUrl: {
        type: 'string',
        description: 'Source audio URL. Provide this or videoUrl.'
      },
      audio_url: {
        type: 'string',
        description: 'Alias of audioUrl. Uses the same semantics as the VectCut API docs.'
      },
      videoUrl: {
        type: 'string',
        description: 'Source video URL. Provide this or audioUrl.'
      },
      video_url: {
        type: 'string',
        description: 'Alias of videoUrl. Uses the same semantics as the VectCut API docs.'
      },
      voiceId: {
        type: 'string',
        description: 'Target voice ID. The upstream API currently expects an ElevenLabs voice ID.'
      },
      voice_id: {
        type: 'string',
        description: 'Alias of voiceId. Uses the same semantics as the VectCut API docs.'
      }
    },
    additionalProperties: true
  }
}

const GET_VOICE_CONVERSION_TASK_STATUS_TOOL: Tool = {
  name: 'get_voice_conversion_task_status',
  description: 'Query the status of a voice conversion task by task ID.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'Task ID returned by submit_voice_conversion_task.'
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

type VoiceConversionSubmitResponse = {
  error?: string
  message_id?: string
  queue_name?: string
  status?: string
  success?: boolean
  task_id?: string
  [key: string]: unknown
}

type VoiceConversionTaskStatusResponse = {
  audio_url?: string
  error?: string
  id?: string
  message?: string
  progress?: number
  result?: {
    converted_url?: string
    [key: string]: unknown
  }
  status?: string
  success?: boolean
  task_id?: string
  video_url?: string
  voice_id?: string
  [key: string]: unknown
}

class VoiceConversionServer {
  public mcpServer: McpServer
  private readonly store = new Store({ name: 'vectcut' })
  private accessToken: PendingToken | null = null
  private refreshPromise: Promise<string> | null = null

  constructor() {
    this.mcpServer = new McpServer(
      {
        name: 'voice-conversion',
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
      tools: [SUBMIT_VOICE_CONVERSION_TASK_TOOL, GET_VOICE_CONVERSION_TASK_STATUS_TOOL]
    }))

    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name
      const args = request.params.arguments ?? {}

      try {
        switch (toolName) {
          case 'submit_voice_conversion_task':
            return await this.submitVoiceConversionTask(args as Record<string, unknown>)
          case 'get_voice_conversion_task_status':
            return await this.getVoiceConversionTaskStatus(args as Record<string, unknown>)
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

  private buildSubmitPayload(args: Record<string, unknown>) {
    const audioUrl = typeof args.audioUrl === 'string' ? args.audioUrl.trim() : ''
    const audioUrlAlias = typeof args.audio_url === 'string' ? args.audio_url.trim() : ''
    const videoUrl = typeof args.videoUrl === 'string' ? args.videoUrl.trim() : ''
    const videoUrlAlias = typeof args.video_url === 'string' ? args.video_url.trim() : ''
    const voiceId = typeof args.voiceId === 'string' ? args.voiceId.trim() : ''
    const voiceIdAlias = typeof args.voice_id === 'string' ? args.voice_id.trim() : ''

    const resolvedAudioUrl = audioUrl || audioUrlAlias
    const resolvedVideoUrl = videoUrl || videoUrlAlias
    const resolvedVoiceId = voiceId || voiceIdAlias

    if (!resolvedAudioUrl && !resolvedVideoUrl) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Either 'audioUrl'/'audio_url' or 'videoUrl'/'video_url' is required for submit_voice_conversion_task"
      )
    }

    if (resolvedAudioUrl && resolvedVideoUrl) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Provide only one source URL: either 'audioUrl'/'audio_url' or 'videoUrl'/'video_url'"
      )
    }

    if (!resolvedVoiceId) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "'voiceId'/'voice_id' is required for submit_voice_conversion_task"
      )
    }

    return {
      ...(resolvedAudioUrl ? { audio_url: resolvedAudioUrl } : {}),
      ...(resolvedVideoUrl ? { video_url: resolvedVideoUrl } : {}),
      voice_id: resolvedVoiceId
    }
  }

  private async submitVoiceConversionTask(args: Record<string, unknown>) {
    const payload = this.buildSubmitPayload(args)
    const response = await this.requestWithAuth(VOICE_CONVERSION_SUBMIT_ENDPOINT, {
      method: 'POST',
      body: payload
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Voice conversion submit failed (${response.status}): ${body || 'unknown error'}`)
    }

    const result = (await response.json()) as VoiceConversionSubmitResponse

    logger.info('Voice conversion task submitted', {
      taskId: result.task_id,
      voiceId: payload.voice_id
    })

    return this.formatJsonResult({
      provider: 'vectcut',
      action: 'submit',
      mode: 'voice_conversion',
      request: payload,
      ...result
    })
  }

  private async getVoiceConversionTaskStatus(args: Record<string, unknown>) {
    const taskId =
      typeof args.taskId === 'string'
        ? args.taskId.trim()
        : typeof args.task_id === 'string'
          ? args.task_id.trim()
          : ''

    if (!taskId) {
      throw new McpError(ErrorCode.InvalidParams, "'taskId'/'task_id' is required for get_voice_conversion_task_status")
    }

    const response = await this.requestWithAuth(VOICE_CONVERSION_STATUS_ENDPOINT, {
      method: 'GET',
      query: new URLSearchParams({ task_id: taskId })
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Voice conversion status query failed (${response.status}): ${body || 'unknown error'}`)
    }

    const result = (await response.json()) as VoiceConversionTaskStatusResponse

    logger.info('Voice conversion task status queried', {
      taskId,
      status: result.status,
      success: result.success
    })

    return this.formatJsonResult({
      provider: 'vectcut',
      action: 'status',
      mode: 'voice_conversion',
      ...result
    })
  }
}

export default VoiceConversionServer
