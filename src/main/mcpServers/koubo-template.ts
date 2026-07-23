import { loggerService } from '@logger'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
import Store from 'electron-store'
import { net } from 'electron'

const logger = loggerService.withContext('MCPServer:KouboTemplate')

const API_HOST = 'https://open.vectcut.com'
const KOUBO_TEMPLATE_SUBMIT_ENDPOINT = '/cut_jianying/agent/submit_agent_task'
const KOUBO_TEMPLATE_STATUS_ENDPOINT = '/cut_jianying/agent/task_status'
const OAUTH_TOKEN_URL = 'https://mlbd8l6vgi13-demo.authing.cn/oidc/token'
const OAUTH_CLIENT_ID = '6901dd145dafc6f1f3143938'
const OAUTH_CLIENT_SECRET = '16a94e467e927cc09b3c8dc7ec92d420'

const KOUBO_TEMPLATE_AGENT_IDS = {
  knowledge_pip: 'koubo_8f4e3d2a91c74b76a85d2c4e7f8a9b1c',
  classic_detail_yellow: 'koubo_ddfe028229d24696bf080303c95f604c',
  traditional_bilingual: 'koubo_cbbe5e6b468844e782c961fd9ee07b7d',
  national_classic: 'koubo_d8b7f9e05c4a11efb9620242ac120003',
  basic_yellow_white: 'koubo_b82feeb636f3476a9a752ebd745d9750',
  ai_trim_pauses: 'koubo_2dfb2efedde84791b218cfd798531bc8',
  advanced_yellow_double: 'koubo_d47e8a905f1b48798e76123456789abc',
  advanced_red_bilingual: 'koubo_1f9c8d7e6a2b4c0d9e8f123456789abc',
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
  advanced_yellow_double: ['media_urls'],
  advanced_red_bilingual: ['media_urls'],
  luxury_white_bilingual: ['media_urls']
}

const SUBMIT_KOUBO_TEMPLATE_TASK_TOOL: Tool = {
  name: 'submit_koubo_template_task',
  description:
    'Submit an asynchronous VectCut talking-head template task for source speaking video or audio media, with optional title, subtitles, effects, cover, and kongjing clips.',
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
        description: 'Single source talking-head video URL.'
      },
      videoUrls: {
        type: 'array',
        items: {
          type: 'string'
        },
        description: 'Source video URLs. Most templates require exactly one.'
      },
      audioUrl: {
        type: 'string',
        description: 'Single source talking-head audio URL.'
      },
      audioUrls: {
        type: 'array',
        items: {
          type: 'string'
        },
        description: 'Source audio URLs. Use this when the template should process uploaded audio directly.'
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

const GET_KOUBO_TEMPLATE_TASK_STATUS_TOOL: Tool = {
  name: 'get_koubo_template_task_status',
  description: 'Query the status of a VectCut talking-head template task by task ID.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'Required task ID returned by submit_koubo_template_task.'
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
      tools: [SUBMIT_KOUBO_TEMPLATE_TASK_TOOL, GET_KOUBO_TEMPLATE_TASK_STATUS_TOOL]
    }))

    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name
      const args = request.params.arguments ?? {}

      try {
        switch (toolName) {
          case 'submit_koubo_template_task':
            return await this.submitKouboTemplateTask(args as Record<string, unknown>)
          case 'get_koubo_template_task_status':
            return await this.getKouboTemplateTaskStatus(args as Record<string, unknown>)
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

  private getRequiredTaskId(args: Record<string, unknown>): string {
    const taskIdValue = typeof args.taskId === 'string' ? args.taskId : args.task_id
    const taskId = typeof taskIdValue === 'string' ? taskIdValue.trim() : ''
    if (!taskId) {
      throw new McpError(ErrorCode.InvalidParams, "'taskId' is required")
    }
    return taskId
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

  private buildSubmitPayload(args: Record<string, unknown>) {
    const resolved = this.resolveTemplate(args)
    const rawParams =
      args.params && typeof args.params === 'object' && !Array.isArray(args.params)
        ? { ...(args.params as Record<string, unknown>) }
        : {}

    const payloadParams: Record<string, unknown> = { ...rawParams }
    const videoUrls = this.getStringArray(args.videoUrls ?? args.video_urls ?? args.videoUrl ?? args.video_url)
    const audioUrls = this.getStringArray(args.audioUrls ?? args.audio_urls ?? args.audioUrl ?? args.audio_url)
    const coverUrls = this.getStringArray(args.coverUrls ?? args.cover_urls ?? args.cover)
    const kongjingUrls = this.getStringArray(args.kongjingUrls ?? args.kongjing_urls)

    if (videoUrls.length > 0) {
      payloadParams.video_url = videoUrls
    }

    if (audioUrls.length > 0) {
      payloadParams.audio_urls = audioUrls
      delete payloadParams.audio_url
    }

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

    const normalizedVideoUrls = this.getStringArray(payloadParams.video_url)
    const normalizedAudioUrls = this.getStringArray(payloadParams.audio_urls ?? payloadParams.audio_url)
    if (normalizedVideoUrls.length === 0 && normalizedAudioUrls.length === 0) {
      throw new McpError(ErrorCode.InvalidParams, "'videoUrl', 'videoUrls', 'audioUrl', or 'audioUrls' is required")
    }
    if (normalizedVideoUrls.length > 0) {
      payloadParams.video_url = normalizedVideoUrls
    }
    if (normalizedAudioUrls.length > 0) {
      payloadParams.audio_urls = normalizedAudioUrls
      delete payloadParams.audio_url
    }

    if (resolved.template) {
      const requirements = KOUBO_TEMPLATE_REQUIREMENTS[resolved.template]
      for (const requirement of requirements) {
        if (
          requirement === 'media_urls' &&
          this.getStringArray(payloadParams.video_url).length === 0 &&
          this.getStringArray(payloadParams.audio_urls).length === 0
        ) {
          throw new McpError(ErrorCode.InvalidParams, `'${resolved.template}' requires 'videoUrl'/'videoUrls' or 'audioUrl'/'audioUrls'`)
        }
        if (requirement === 'kongjing_urls' && this.getStringArray(payloadParams.kongjing_urls).length === 0) {
          throw new McpError(ErrorCode.InvalidParams, `'${resolved.template}' requires 'kongjingUrls'`)
        }
      }
    }

    return {
      template: resolved.template,
      body: {
        agent_id: resolved.agentId,
        params: payloadParams
      }
    }
  }

  private async submitKouboTemplateTask(args: Record<string, unknown>) {
    const payload = this.buildSubmitPayload(args)
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

    return this.formatJsonResult({
      provider: 'vectcut',
      action: 'submit',
      mode: 'koubo_template',
      template: payload.template,
      agent_id: payload.body.agent_id,
      ...result
    })
  }

  private async getKouboTemplateTaskStatus(args: Record<string, unknown>) {
    const taskId = this.getRequiredTaskId(args)
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

    return this.formatJsonResult({
      provider: 'vectcut',
      action: 'status',
      mode: 'koubo_template',
      ...result
    })
  }
}

export default KouboTemplateServer
