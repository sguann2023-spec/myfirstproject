import { loggerService } from '@logger'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
import Store from 'electron-store'
import { net } from 'electron'

const logger = loggerService.withContext('MCPServer:SpeechGenerate')

const API_HOST = 'https://open.vectcut.com'
const SPEECH_GENERATE_ENDPOINT = '/cut_jianying/generate_speech'
const OAUTH_TOKEN_URL = 'https://mlbd8l6vgi13-demo.authing.cn/oidc/token'
const OAUTH_CLIENT_ID = '6901dd145dafc6f1f3143938'
const OAUTH_CLIENT_SECRET = '16a94e467e927cc09b3c8dc7ec92d420'
const DEFAULT_SPEECH_PROVIDER = 'minimax'
const DEFAULT_SPEECH_VOICE_ID = 'gv_6e52beeb34614e13ab166b64d08fe8c2'

const GENERATE_SPEECH_TOOL: Tool = {
  name: 'generate_speech',
  description:
    'Synthesize speech audio from text via VectCut and optionally add the generated audio into a draft.',
  inputSchema: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'Text to synthesize into speech.'
      },
      provider: {
        type: 'string',
        enum: ['azure', 'volc', 'minimax', 'fish'],
        description: 'Speech provider. Defaults to minimax.'
      },
      model: {
        type: 'string',
        description: 'Optional provider-specific model, such as speech-2.6-turbo.'
      },
      voiceId: {
        type: 'string',
        description: `Optional voice ID. Defaults to ${DEFAULT_SPEECH_VOICE_ID}.`
      },
      speechSpeed: {
        type: 'number',
        description: 'Speech speed, usually between 0.2 and 2.'
      },
      start: {
        type: 'number',
        description: 'Optional audio trim start time in seconds.'
      },
      end: {
        type: 'number',
        description: 'Optional audio trim end time in seconds.'
      },
      draftId: {
        type: 'string',
        description: 'Optional draft ID for adding the generated audio.'
      },
      volume: {
        type: 'number',
        description: 'Optional volume in dB.'
      },
      targetStart: {
        type: 'number',
        description: 'Optional audio start time on the timeline in seconds.'
      },
      speed: {
        type: 'number',
        description: 'Optional playback speed.'
      },
      trackName: {
        type: 'string',
        description: 'Optional target track name. Defaults to audio_speech on the API side.'
      },
      effectType: {
        type: 'string',
        description: 'Optional effect type.'
      },
      effectParams: {
        type: 'array',
        items: {
          type: 'number'
        },
        description: 'Optional effect parameters.'
      },
      width: {
        type: 'integer',
        description: 'Optional video width.'
      },
      height: {
        type: 'integer',
        description: 'Optional video height.'
      },
      fadeInDuration: {
        type: 'number',
        description: 'Optional fade-in duration in seconds.'
      },
      fadeOutDuration: {
        type: 'number',
        description: 'Optional fade-out duration in seconds.'
      }
    },
    required: ['text']
  }
}

type PendingToken = {
  accessToken: string
  expiresAt: number
}

type SpeechGenerateResponse = {
  error?: string
  output?: {
    audio_url?: string
    draft_id?: string
    draft_url?: string
    material_id?: string
    [key: string]: unknown
  }
  purchase_link?: string
  success?: boolean
  [key: string]: unknown
}

const SPEECH_FIELD_ALIASES: Record<string, string> = {
  voiceId: 'voice_id',
  speechSpeed: 'speech_speed',
  draftId: 'draft_id',
  targetStart: 'target_start',
  trackName: 'track_name',
  effectType: 'effect_type',
  effectParams: 'effect_params',
  fadeInDuration: 'fade_in_duration',
  fadeOutDuration: 'fade_out_duration'
}

class SpeechGenerateServer {
  public mcpServer: McpServer
  private readonly store = new Store({ name: 'vectcut' })
  private accessToken: PendingToken | null = null
  private refreshPromise: Promise<string> | null = null

  constructor() {
    this.mcpServer = new McpServer(
      {
        name: 'speech',
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
      tools: [GENERATE_SPEECH_TOOL]
    }))

    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name
      const args = request.params.arguments ?? {}

      try {
        switch (toolName) {
          case 'generate_speech':
            return await this.generateSpeech(args as Record<string, unknown>)
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

  private async requestWithAuth(body: Record<string, unknown>): Promise<Response> {
    const token = await this.ensureValidAccessToken()

    const doFetch = async (accessToken: string): Promise<Response> =>
      net.fetch(`${API_HOST}${SPEECH_GENERATE_ENDPOINT}`, {
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

  private buildSpeechPayload(args: Record<string, unknown>) {
    const text = typeof args.text === 'string' ? args.text.trim() : ''
    const voiceIdRaw = typeof args.voiceId === 'string' ? args.voiceId : args.voice_id
    const voiceId =
      typeof voiceIdRaw === 'string' && voiceIdRaw.trim() ? voiceIdRaw.trim() : DEFAULT_SPEECH_VOICE_ID
    if (!text) {
      throw new McpError(ErrorCode.InvalidParams, "'text' is required for generate_speech")
    }

    const payload: Record<string, unknown> = {
      provider:
        typeof args.provider === 'string' && args.provider.trim() ? args.provider.trim() : DEFAULT_SPEECH_PROVIDER
    }

    for (const [rawKey, value] of Object.entries(args)) {
      if (value === undefined) {
        continue
      }
      const key = SPEECH_FIELD_ALIASES[rawKey] ?? rawKey
      payload[key] = value
    }

    payload.text = text
    payload.voice_id = voiceId
    return payload
  }

  private async generateSpeech(args: Record<string, unknown>) {
    const payload = this.buildSpeechPayload(args)
    const response = await this.requestWithAuth(payload)

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Speech generation failed (${response.status}): ${body || 'unknown error'}`)
    }

    const result = (await response.json()) as SpeechGenerateResponse

    logger.info('Speech generation completed', {
      provider: payload.provider,
      voiceId: payload.voice_id,
      success: result.success
    })

    return this.formatJsonResult({
      provider: 'vectcut',
      action: 'generate_speech',
      request: {
        provider: payload.provider,
        model: payload.model,
        voice_id: payload.voice_id
      },
      ...result
    })
  }
}

export default SpeechGenerateServer
