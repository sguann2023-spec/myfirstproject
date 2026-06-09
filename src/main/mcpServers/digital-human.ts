import { loggerService } from '@logger'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
import Store from 'electron-store'
import { net } from 'electron'

const logger = loggerService.withContext('MCPServer:DigitalHuman')

const API_HOST = 'https://open.vectcut.com'
const DIGITAL_HUMAN_CREATE_ENDPOINT = '/cut_jianying/digital_human/create'
const DIGITAL_HUMAN_STATUS_ENDPOINT = '/cut_jianying/digital_human/task_status'
const OMNI_DIGITAL_HUMAN_SUBMIT_ENDPOINT = '/cut_jianying/digital_human/omni/submit'
const OMNI_DIGITAL_HUMAN_STATUS_ENDPOINT = '/cut_jianying/digital_human/omni/task_status'
const OAUTH_TOKEN_URL = 'https://mlbd8l6vgi13-demo.authing.cn/oidc/token'
const OAUTH_CLIENT_ID = '6901dd145dafc6f1f3143938'
const OAUTH_CLIENT_SECRET = '16a94e467e927cc09b3c8dc7ec92d420'
const DEFAULT_OMNI_OUTPUT_RESOLUTION = 1080

const CREATE_LIP_SYNC_DIGITAL_HUMAN_TOOL: Tool = {
  name: 'create_lip_sync_digital_human',
  description: 'Create a lip-sync digital human video from an audio URL and a portrait video URL.',
  inputSchema: {
    type: 'object',
    properties: {
      audioUrl: {
        type: 'string',
        description: 'Required source audio URL.'
      },
      videoUrl: {
        type: 'string',
        description: 'Required portrait video URL.'
      }
    },
    required: ['audioUrl', 'videoUrl'],
    additionalProperties: false
  }
}

const GET_LIP_SYNC_DIGITAL_HUMAN_STATUS_TOOL: Tool = {
  name: 'get_lip_sync_digital_human_status',
  description: 'Query the status of a lip-sync digital human task by task ID.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'Required lip-sync digital human task ID.'
      }
    },
    required: ['taskId'],
    additionalProperties: false
  }
}

const CREATE_IMAGE_DRIVEN_DIGITAL_HUMAN_TOOL: Tool = {
  name: 'create_image_driven_digital_human',
  description: 'Create an image-driven Omni digital human video from an audio URL, image URL, and prompt.',
  inputSchema: {
    type: 'object',
    properties: {
      audioUrl: {
        type: 'string',
        description: 'Required source audio URL. Must not exceed 60 seconds.'
      },
      imageUrl: {
        type: 'string',
        description: 'Required portrait image URL.'
      },
      prompt: {
        type: 'string',
        description: 'Required scene prompt for the generated video.'
      },
      outputResolution: {
        type: 'integer',
        enum: [720, 1080],
        description: 'Optional output resolution. Defaults to 1080.'
      }
    },
    required: ['audioUrl', 'imageUrl', 'prompt'],
    additionalProperties: false
  }
}

const GET_IMAGE_DRIVEN_DIGITAL_HUMAN_STATUS_TOOL: Tool = {
  name: 'get_image_driven_digital_human_status',
  description: 'Query the status of an image-driven Omni digital human task by task ID.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'Required image-driven digital human task ID.'
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

type DigitalHumanCreateResponse = {
  message?: string
  task_id?: string
  [key: string]: unknown
}

type DigitalHumanStatusResponse = {
  digital_human_url?: string
  message?: string
  [key: string]: unknown
}

class DigitalHumanServer {
  public mcpServer: McpServer
  private readonly store = new Store({ name: 'vectcut' })
  private accessToken: PendingToken | null = null
  private refreshPromise: Promise<string> | null = null

  constructor() {
    this.mcpServer = new McpServer(
      {
        name: 'digital-human',
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
      tools: [
        CREATE_LIP_SYNC_DIGITAL_HUMAN_TOOL,
        GET_LIP_SYNC_DIGITAL_HUMAN_STATUS_TOOL,
        CREATE_IMAGE_DRIVEN_DIGITAL_HUMAN_TOOL,
        GET_IMAGE_DRIVEN_DIGITAL_HUMAN_STATUS_TOOL
      ]
    }))

    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name
      const args = request.params.arguments ?? {}

      try {
        switch (toolName) {
          case 'create_lip_sync_digital_human':
            return await this.createLipSyncDigitalHuman(args as Record<string, unknown>)
          case 'get_lip_sync_digital_human_status':
            return await this.getLipSyncDigitalHumanStatus(args as Record<string, unknown>)
          case 'create_image_driven_digital_human':
            return await this.createImageDrivenDigitalHuman(args as Record<string, unknown>)
          case 'get_image_driven_digital_human_status':
            return await this.getImageDrivenDigitalHumanStatus(args as Record<string, unknown>)
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

  private getRequiredString(args: Record<string, unknown>, primaryKey: string, fallbackKey?: string): string {
    const value = typeof args[primaryKey] === 'string' ? args[primaryKey] : fallbackKey ? args[fallbackKey] : undefined
    const normalized = typeof value === 'string' ? value.trim() : ''
    if (!normalized) {
      throw new McpError(ErrorCode.InvalidParams, `'${primaryKey}' is required`)
    }
    return normalized
  }

  private async createLipSyncDigitalHuman(args: Record<string, unknown>) {
    const audioUrl = this.getRequiredString(args, 'audioUrl', 'audio_url')
    const videoUrl = this.getRequiredString(args, 'videoUrl', 'video_url')
    const response = await this.requestWithAuth(DIGITAL_HUMAN_CREATE_ENDPOINT, {
      method: 'POST',
      body: {
        audio_url: audioUrl,
        video_url: videoUrl
      }
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Lip-sync digital human creation failed (${response.status}): ${body || 'unknown error'}`)
    }

    const result = (await response.json()) as DigitalHumanCreateResponse

    logger.info('Lip-sync digital human task created', {
      taskId: result.task_id
    })

    return this.formatJsonResult({
      provider: 'vectcut',
      mode: 'lip_sync',
      action: 'submit',
      ...result
    })
  }

  private async getLipSyncDigitalHumanStatus(args: Record<string, unknown>) {
    const taskId = this.getRequiredString(args, 'taskId', 'task_id')
    const response = await this.requestWithAuth(DIGITAL_HUMAN_STATUS_ENDPOINT, {
      method: 'GET',
      query: {
        task_id: taskId
      }
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Lip-sync digital human status query failed (${response.status}): ${body || 'unknown error'}`)
    }

    const result = (await response.json()) as DigitalHumanStatusResponse

    logger.info('Lip-sync digital human status queried', {
      taskId
    })

    return this.formatJsonResult({
      provider: 'vectcut',
      mode: 'lip_sync',
      action: 'status',
      task_id: taskId,
      ...result
    })
  }

  private async createImageDrivenDigitalHuman(args: Record<string, unknown>) {
    const audioUrl = this.getRequiredString(args, 'audioUrl', 'audio_url')
    const imageUrl = this.getRequiredString(args, 'imageUrl', 'image_url')
    const prompt = this.getRequiredString(args, 'prompt')
    const outputResolution =
      typeof args.outputResolution === 'number'
        ? args.outputResolution
        : typeof args.output_resolution === 'number'
          ? args.output_resolution
          : DEFAULT_OMNI_OUTPUT_RESOLUTION

    const response = await this.requestWithAuth(OMNI_DIGITAL_HUMAN_SUBMIT_ENDPOINT, {
      method: 'POST',
      body: {
        audio_url: audioUrl,
        image_url: imageUrl,
        prompt,
        output_resolution: outputResolution
      }
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Image-driven digital human creation failed (${response.status}): ${body || 'unknown error'}`)
    }

    const result = (await response.json()) as Record<string, unknown>

    logger.info('Image-driven digital human task created', {
      taskId: result.task_id
    })

    return this.formatJsonResult({
      provider: 'vectcut',
      mode: 'image_driven',
      action: 'submit',
      output_resolution: outputResolution,
      ...result
    })
  }

  private async getImageDrivenDigitalHumanStatus(args: Record<string, unknown>) {
    const taskId = this.getRequiredString(args, 'taskId', 'task_id')
    const response = await this.requestWithAuth(OMNI_DIGITAL_HUMAN_STATUS_ENDPOINT, {
      method: 'GET',
      query: {
        task_id: taskId
      }
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Image-driven digital human status query failed (${response.status}): ${body || 'unknown error'}`)
    }

    const result = (await response.json()) as Record<string, unknown>

    logger.info('Image-driven digital human status queried', {
      taskId
    })

    return this.formatJsonResult({
      provider: 'vectcut',
      mode: 'image_driven',
      action: 'status',
      task_id: taskId,
      ...result
    })
  }
}

export default DigitalHumanServer
