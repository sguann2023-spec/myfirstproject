import { loggerService } from '@logger'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
import Store from 'electron-store'
import { net } from 'electron'

const logger = loggerService.withContext('MCPServer:ImageGenerate')

const API_HOST = 'https://open.vectcut.com'
const IMAGE_GENERATE_ENDPOINT = '/llm/image/submit_task/generate'
const IMAGE_TASK_STATUS_ENDPOINT = '/llm/image/submit_task/task_status'
const IMAGE_MODEL_CAPABILITIES_ENDPOINT = '/llm/image/model_capabilities'
const OAUTH_TOKEN_URL = 'https://mlbd8l6vgi13-demo.authing.cn/oidc/token'
const OAUTH_CLIENT_ID = '6901dd145dafc6f1f3143938'
const OAUTH_CLIENT_SECRET = '16a94e467e927cc09b3c8dc7ec92d420'

const IMAGE_GENERATE_TOOL: Tool = {
  name: 'generate_image',
  description:
    'Submit or query asynchronous AI image generation tasks via VectCut. Omit action to submit a new task, or use action="status" with taskId to query an existing task.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['submit', 'status'],
        description: 'submit creates a new task, status queries a previous task. Defaults to submit.'
      },
      prompt: {
        type: 'string',
        description: 'Image generation prompt. Required when action is submit.'
      },
      taskId: {
        type: 'string',
        description: 'Task ID returned by submit. Required when action is status.'
      },
      model: {
        type: 'string',
        description: 'Optional image model, such as seedream-4.5 or nano_banana_2.'
      },
      size: {
        type: 'string',
        description: 'Optional output size, such as 1024x1024.'
      },
      referenceImage: {
        type: 'string',
        description: 'Optional single reference image URL.'
      },
      referenceImages: {
        type: 'array',
        items: {
          type: 'string'
        },
        description: 'Optional multiple reference image URLs.'
      },
      composeDraft: {
        type: 'boolean',
        description: 'Whether to add the generated image into a draft. Defaults to true on the API side.'
      },
      draftId: {
        type: 'string',
        description: 'Optional target draft ID.'
      },
      trackName: {
        type: 'string',
        description: 'Optional target track name for draft composition.'
      }
    },
    additionalProperties: true
  }
}

const IMAGE_CAPABILITIES_TOOL: Tool = {
  name: 'get_image_capabilities',
  description:
    'Get supported image generation models, resolutions, reference image support, and optional pricing information from VectCut.',
  inputSchema: {
    type: 'object',
    properties: {
      model: {
        type: 'string',
        description: 'Optional model name to inspect, such as seedream-4.5 or nano_banana_2.'
      },
      tier: {
        type: 'string',
        description: 'Optional resolution tier filter, such as 1K, 2K, 3K, or 4K.'
      },
      ratio: {
        type: 'string',
        description: 'Optional aspect ratio filter, such as 1:1 or 16:9.'
      },
      includePrices: {
        type: 'boolean',
        description: 'Whether to include prices in the response. Defaults to true.'
      }
    },
    additionalProperties: false
  }
}

type PendingToken = {
  accessToken: string
  expiresAt: number
}

type ImageSubmitResponse = {
  success?: boolean
  task_id?: string
  message_id?: string
  status?: string
  queue_name?: string
  error?: string
  [key: string]: unknown
}

type ImageTaskStatusResponse = {
  success?: boolean
  task_id?: string
  status?: string
  progress?: number
  message?: string
  error?: string
  result?: {
    image?: string
    draft_id?: string
    draft_url?: string
    reused_from_history?: boolean
    error?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

type ResolutionItem = {
  ratio?: string
  size?: string
}

type ModelCapability = {
  reference_supported?: boolean
  resolutions?: Record<string, ResolutionItem[]>
}

type ModelPrice = {
  project_id?: string
  resource_points_per_unit?: number
}

type ImageCapabilitiesResponse = {
  capabilities?: Record<string, ModelCapability>
  prices?: Record<string, ModelPrice>
  [key: string]: unknown
}

const IMAGE_SUBMIT_FIELD_ALIASES: Record<string, string> = {
  referenceImage: 'reference_image',
  referenceImages: 'reference_images',
  composeDraft: 'compose_draft',
  draftId: 'draft_id',
  transformX: 'transform_x',
  transformXPx: 'transform_x_px',
  transformY: 'transform_y',
  transformYPx: 'transform_y_px',
  scaleX: 'scale_x',
  scaleY: 'scale_y',
  trackName: 'track_name',
  relativeIndex: 'relative_index',
  introAnimation: 'intro_animation',
  introAnimationDuration: 'intro_animation_duration',
  outroAnimation: 'outro_animation',
  outroAnimationDuration: 'outro_animation_duration',
  comboAnimation: 'combo_animation',
  comboAnimationDuration: 'combo_animation_duration',
  transitionDuration: 'transition_duration',
  maskType: 'mask_type',
  maskCenterX: 'mask_center_x',
  maskCenterY: 'mask_center_y',
  maskSize: 'mask_size',
  maskRotation: 'mask_rotation',
  maskFeather: 'mask_feather',
  maskInvert: 'mask_invert',
  maskRectWidth: 'mask_rect_width',
  maskRoundCorner: 'mask_round_corner',
  backgroundBlur: 'background_blur',
  flipHorizontal: 'flip_horizontal',
  mixType: 'mix_type'
}

class ImageGenerateServer {
  public mcpServer: McpServer
  private readonly store = new Store({ name: 'vectcut' })
  private accessToken: PendingToken | null = null
  private refreshPromise: Promise<string> | null = null

  constructor() {
    this.mcpServer = new McpServer(
      {
        name: 'image',
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
      tools: [IMAGE_GENERATE_TOOL, IMAGE_CAPABILITIES_TOOL]
    }))

    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name
      const args = request.params.arguments ?? {}

      try {
        switch (toolName) {
          case 'generate_image':
            return await this.generateImage(args as Record<string, unknown>)
          case 'get_image_capabilities':
            return await this.getImageCapabilities(args as Record<string, unknown>)
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

  private buildImageSubmitPayload(args: Record<string, unknown>) {
    const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
    if (!prompt) {
      throw new McpError(ErrorCode.InvalidParams, "'prompt' is required when submitting an image generation task")
    }

    const payload: Record<string, unknown> = {}

    for (const [rawKey, value] of Object.entries(args)) {
      if (value === undefined) {
        continue
      }

      if (rawKey === 'action' || rawKey === 'taskId' || rawKey === 'task_id') {
        continue
      }

      const key = IMAGE_SUBMIT_FIELD_ALIASES[rawKey] ?? rawKey
      payload[key] = value
    }

    payload.prompt = prompt
    return payload
  }

  private async submitImageTask(args: Record<string, unknown>) {
    const payload = this.buildImageSubmitPayload(args)
    const response = await this.requestWithAuth(IMAGE_GENERATE_ENDPOINT, {
      method: 'POST',
      body: payload
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Image generation task submission failed (${response.status}): ${body || 'unknown error'}`)
    }

    const result = (await response.json()) as ImageSubmitResponse

    logger.info('AI image generation task submitted', {
      taskId: result.task_id,
      model: typeof payload.model === 'string' ? payload.model : undefined
    })

    return this.formatJsonResult({
      provider: 'vectcut',
      action: 'submit',
      ...result
    })
  }

  private async getImageTaskStatus(taskId: string) {
    const response = await this.requestWithAuth(IMAGE_TASK_STATUS_ENDPOINT, {
      method: 'GET',
      query: {
        task_id: taskId
      }
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Image generation task status query failed (${response.status}): ${body || 'unknown error'}`)
    }

    const result = (await response.json()) as ImageTaskStatusResponse

    logger.info('AI image generation task status queried', {
      taskId,
      status: result.status,
      progress: result.progress
    })

    return this.formatJsonResult({
      provider: 'vectcut',
      action: 'status',
      ...result
    })
  }

  private normalizeModelCapability(
    model: string,
    capability: ModelCapability | undefined,
    prices: Record<string, ModelPrice>,
    filters: {
      tier?: string
      ratio?: string
      includePrices: boolean
    }
  ) {
    const tierFilter = filters.tier?.trim()
    const ratioFilter = filters.ratio?.trim()
    const resolutions = capability?.resolutions ?? {}
    const normalizedResolutions = Object.entries(resolutions).reduce<Record<string, ResolutionItem[]>>((acc, [tier, items]) => {
      if (tierFilter && tier !== tierFilter) {
        return acc
      }

      const normalizedItems = (Array.isArray(items) ? items : []).filter((item) => {
        if (!ratioFilter) {
          return true
        }
        return item?.ratio === ratioFilter
      })

      if (normalizedItems.length > 0) {
        acc[tier] = normalizedItems.map((item) => ({
          ratio: item?.ratio ?? '',
          size: item?.size ?? ''
        }))
      }

      return acc
    }, {})

    const normalized: Record<string, unknown> = {
      model,
      reference_supported: Boolean(capability?.reference_supported),
      resolutions: normalizedResolutions
    }

    if (filters.includePrices && prices[model]) {
      normalized.price = prices[model]
    }

    return normalized
  }

  private async getImageCapabilities(args: Record<string, unknown>) {
    const modelFilter = typeof args.model === 'string' ? args.model.trim() : ''
    const tier = typeof args.tier === 'string' ? args.tier.trim() : ''
    const ratio = typeof args.ratio === 'string' ? args.ratio.trim() : ''
    const includePrices = typeof args.includePrices === 'boolean' ? args.includePrices : true

    const response = await this.requestWithAuth(IMAGE_MODEL_CAPABILITIES_ENDPOINT, {
      method: 'GET'
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Image model capabilities query failed (${response.status}): ${body || 'unknown error'}`)
    }

    const payload = (await response.json()) as ImageCapabilitiesResponse
    const capabilities = payload.capabilities ?? {}
    const prices = payload.prices ?? {}

    const availableModels = Object.keys(capabilities)
    if (modelFilter && !availableModels.includes(modelFilter)) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown image model: ${modelFilter}`)
    }

    const targetModels = modelFilter ? [modelFilter] : availableModels
    const models = targetModels
      .map((model) =>
        this.normalizeModelCapability(model, capabilities[model], prices, {
          tier: tier || undefined,
          ratio: ratio || undefined,
          includePrices
        })
      )
      .filter(
        (item) =>
          Object.keys((item.resolutions as Record<string, ResolutionItem[]>) ?? {}).length > 0 || (!tier && !ratio)
      )

    logger.info('Image model capabilities queried', {
      model: modelFilter || undefined,
      tier: tier || undefined,
      ratio: ratio || undefined,
      count: models.length
    })

    return this.formatJsonResult({
      provider: 'vectcut',
      action: 'capabilities',
      models
    })
  }

  private async generateImage(args: Record<string, unknown>) {
    const actionRaw = typeof args.action === 'string' ? args.action.trim().toLowerCase() : 'submit'
    const action = actionRaw || 'submit'

    if (action === 'status') {
      const taskIdValue = typeof args.taskId === 'string' ? args.taskId : args.task_id
      const taskId = typeof taskIdValue === 'string' ? taskIdValue.trim() : ''
      if (!taskId) {
        throw new McpError(ErrorCode.InvalidParams, "'taskId' is required when action is 'status'")
      }
      return await this.getImageTaskStatus(taskId)
    }

    if (action !== 'submit') {
      throw new McpError(ErrorCode.InvalidParams, "'action' must be either 'submit' or 'status'")
    }

    return await this.submitImageTask(args)
  }
}

export default ImageGenerateServer
