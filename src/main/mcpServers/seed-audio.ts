import { loggerService } from '@logger'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
import Store from 'electron-store'
import { net } from 'electron'

const logger = loggerService.withContext('MCPServer:SeedAudio')

const API_HOST = 'https://open.vectcut.com'
const SEED_AUDIO_GENERATE_ENDPOINT = '/llm/tts/seed_audio/generate'
const OAUTH_TOKEN_URL = 'https://mlbd8l6vgi13-demo.authing.cn/oidc/token'
const OAUTH_CLIENT_ID = '6901dd145dafc6f1f3143938'
const OAUTH_CLIENT_SECRET = '16a94e467e927cc09b3c8dc7ec92d420'
const DEFAULT_SEED_AUDIO_MODEL = 'seed-audio-1.0'

const GENERATE_SEED_AUDIO_TOOL: Tool = {
  name: 'generate_seed_audio',
  description:
    'Generate rich audio with Doubao seed-audio from a creative prompt instead of plain TTS. Use this for prompt-based audio generation with optional speaker, reference audio, reference image, background music, sound effects, or multi-speaker style control.',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description:
          'Required prompt describing the target audio scene, speaking style, speakers, background music, or sound effects. This is not TTS input text.'
      },
      prompt_text: {
        type: 'string',
        description: 'Alias of prompt.'
      },
      textPrompt: {
        type: 'string',
        description: 'Backward-compatible alias of prompt.'
      },
      text_prompt: {
        type: 'string',
        description: 'Backward-compatible alias of prompt. Normalized to the upstream API field.'
      },
      model: {
        type: 'string',
        description: `Optional model name. Defaults to ${DEFAULT_SEED_AUDIO_MODEL}.`
      },
      voiceId: {
        type: 'string',
        description: 'Optional voice or speaker ID.'
      },
      voice_id: {
        type: 'string',
        description: 'Alias of voiceId. Uses the same semantics as the VectCut API docs.'
      },
      speaker: {
        type: 'string',
        description: 'Optional speaker descriptor.'
      },
      references: {
        type: 'array',
        description: 'Optional reference items, usually audio or image references.',
        items: {
          type: 'object',
          additionalProperties: true
        }
      },
      audioUrl: {
        type: 'string',
        description: 'Optional reference audio URL.'
      },
      audio_url: {
        type: 'string',
        description: 'Alias of audioUrl. Uses the same semantics as the VectCut API docs.'
      },
      audioData: {
        type: 'string',
        description: 'Optional base64-encoded reference audio data.'
      },
      audio_data: {
        type: 'string',
        description: 'Alias of audioData. Uses the same semantics as the VectCut API docs.'
      },
      imageUrl: {
        type: 'string',
        description: 'Optional reference image URL.'
      },
      image_url: {
        type: 'string',
        description: 'Alias of imageUrl. Uses the same semantics as the VectCut API docs.'
      },
      imageData: {
        type: 'string',
        description: 'Optional base64-encoded reference image data.'
      },
      image_data: {
        type: 'string',
        description: 'Alias of imageData. Uses the same semantics as the VectCut API docs.'
      },
      audioConfig: {
        type: 'object',
        description: 'Optional audio output configuration such as format, sample rate, or speech rate.'
      },
      audio_config: {
        type: 'object',
        description: 'Alias of audioConfig. Uses the same semantics as the VectCut API docs.'
      },
      watermark: {
        type: 'object',
        description: 'Optional watermark configuration.'
      }
    },
    required: ['prompt'],
    additionalProperties: true
  }
}

type PendingToken = {
  accessToken: string
  expiresAt: number
}

type SeedAudioGenerateResponse = {
  success?: boolean
  provider?: string
  model?: string
  url?: string
  text_prompt?: string
  voice_id?: string | null
  duration_seconds?: number
  resource_amount?: number
  project_id?: number
  [key: string]: unknown
}

const SEED_AUDIO_FIELD_ALIASES: Record<string, string> = {
  prompt: 'text_prompt',
  prompt_text: 'text_prompt',
  textPrompt: 'text_prompt',
  voiceId: 'voice_id',
  audioUrl: 'audio_url',
  audioData: 'audio_data',
  imageUrl: 'image_url',
  imageData: 'image_data',
  audioConfig: 'audio_config'
}

class SeedAudioServer {
  public mcpServer: McpServer
  private readonly store = new Store({ name: 'vectcut' })
  private accessToken: PendingToken | null = null
  private refreshPromise: Promise<string> | null = null

  constructor() {
    this.mcpServer = new McpServer(
      {
        name: 'seed-audio',
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
      tools: [GENERATE_SEED_AUDIO_TOOL]
    }))

    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name
      const args = request.params.arguments ?? {}

      try {
        switch (toolName) {
          case 'generate_seed_audio':
            return await this.generateSeedAudio(args as Record<string, unknown>)
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
      net.fetch(`${API_HOST}${SEED_AUDIO_GENERATE_ENDPOINT}`, {
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

  private buildSeedAudioPayload(args: Record<string, unknown>) {
    const rawPrompt =
      typeof args.prompt === 'string'
        ? args.prompt
        : typeof args.prompt_text === 'string'
          ? args.prompt_text
          : typeof args.textPrompt === 'string'
            ? args.textPrompt
            : args.text_prompt
    const prompt = typeof rawPrompt === 'string' ? rawPrompt.trim() : ''
    if (!prompt) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "'prompt' is required for generate_seed_audio (textPrompt/text_prompt are compatibility aliases)"
      )
    }

    const payload: Record<string, unknown> = {}
    for (const [rawKey, value] of Object.entries(args)) {
      if (value === undefined) continue
      const key = SEED_AUDIO_FIELD_ALIASES[rawKey] ?? rawKey
      payload[key] = value
    }

    payload.text_prompt = prompt
    payload.model =
      typeof payload.model === 'string' && String(payload.model).trim()
        ? String(payload.model).trim()
        : DEFAULT_SEED_AUDIO_MODEL

    return payload
  }

  private async generateSeedAudio(args: Record<string, unknown>) {
    const payload = this.buildSeedAudioPayload(args)
    const response = await this.requestWithAuth(payload)

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Seed audio generation failed (${response.status}): ${body || 'unknown error'}`)
    }

    const result = (await response.json()) as SeedAudioGenerateResponse

    logger.info('Seed audio generation completed', {
      model: payload.model,
      success: result.success,
      durationSeconds: result.duration_seconds
    })

    return this.formatJsonResult({
      provider: 'vectcut',
      action: 'generate_seed_audio',
      request: {
        model: payload.model,
        prompt: payload.text_prompt,
        voice_id: payload.voice_id,
        speaker: payload.speaker
      },
      ...result
    })
  }
}

export default SeedAudioServer
