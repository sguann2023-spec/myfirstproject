import { stat as fsStat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loggerService } from '@logger'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
import Store from 'electron-store'
import { net } from 'electron'

import { ossUploadService } from '@main/services/OssUploadService'

const logger = loggerService.withContext('MCPServer:ImageGenerate')

const API_HOST = 'https://open.vectcut.com'
const IMAGE_GENERATE_ENDPOINT = '/llm/image/submit_task/generate'
const IMAGE_TASK_STATUS_ENDPOINT = '/llm/image/submit_task/task_status'
const IMAGE_MODEL_CAPABILITIES_ENDPOINT = '/llm/image/model_capabilities'
const OAUTH_TOKEN_URL = 'https://mlbd8l6vgi13-demo.authing.cn/oidc/token'
const OAUTH_CLIENT_ID = '6901dd145dafc6f1f3143938'
const OAUTH_CLIENT_SECRET = '16a94e467e927cc09b3c8dc7ec92d420'
const PRIMARY_IMAGE_TOOL_NAME = 'generate_or_edit_image'
const LEGACY_IMAGE_TOOL_NAME = 'generate_image'
const IMAGE_TASK_WAIT_TIME = '3-5 minutes'
const IMAGE_CAPABILITIES_CACHE_TTL_MS = 5 * 60 * 1000
const FILE_UPLOAD_BUCKET = 'oss-hangzhou-mp4'
const FILE_UPLOAD_REGION = 'oss-cn-hangzhou'
const FILE_UPLOAD_FOLDER_TEMPLATE = 'agent_tmp/{uid}'
const FILE_UPLOAD_OBJECT_KEY_PREFIX = 'vectcut_ai_image_reference_'
const FILE_UPLOAD_SIGN_EXPIRES_SECONDS = 60 * 60

const IMAGE_GENERATE_TOOL: Tool = {
  name: PRIMARY_IMAGE_TOOL_NAME,
  description:
    'Create, generate, edit, restyle, or query asynchronous AI image tasks via VectCut. Use this for text-to-image, image-to-image, retouching, photo editing, changing backgrounds, replacing objects, applying style changes, or generating from one or more reference images. Reference images may be remote URLs, file URLs, or absolute local paths; local files are uploaded automatically before submission. These tasks are asynchronous and typically take 3-5 minutes. After submitting a task, if the response contains a taskId and the status is not final, you should continue polling with action="status" automatically instead of stopping and waiting for the user to ask again. Treat image generation and image editing as long-running tasks. Only stop when the task reaches a final status such as success, failed, or error, or when a reasonable timeout is reached. Omit action to submit a new generation/edit task, or use action="status" with taskId to query an existing task.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['submit', 'status'],
        description:
          'submit creates a new long-running task, status queries a previous task. After submit returns a taskId, keep using status to poll automatically until the task finishes. Defaults to submit.'
      },
      prompt: {
        type: 'string',
        description:
          'Instruction for generating or editing the image. Required when action is submit. Describe what to create, or what to change in the supplied image(s).'
      },
      taskId: {
        type: 'string',
        description:
          'Task ID returned by submit. Required when action is status. Use this to continue polling long-running image tasks until they reach a final status.'
      },
      model: {
        type: 'string',
        description:
          'Optional image model, such as seedream-4.5 or nano_banana_2. If a non-standard alias is provided, the server will try to map it to the closest supported model returned by capabilities.'
      },
      size: {
        type: 'string',
        description: 'Optional output size, such as 1024x1024.'
      },
      referenceImages: {
        type: 'array',
        items: {
          type: 'string'
        },
        description:
          'Optional multiple source/reference image URLs, file URLs, or absolute local paths. Local files are uploaded automatically before submission.'
      },
      sourceImage: {
        type: 'string',
        description:
          'Alias of referenceImages. Optional single source image URL, file URL, or absolute local path for editing or image-to-image tasks.'
      },
      sourceImages: {
        type: 'array',
        items: {
          type: 'string'
        },
        description:
          'Alias of referenceImages. Optional multiple source image URLs, file URLs, or absolute local paths for editing or fusion tasks.'
      },
      baseImage: {
        type: 'string',
        description: 'Alias of referenceImages. Optional base image URL, file URL, or absolute local path to modify, enhance, or restyle.'
      },
      editImage: {
        type: 'string',
        description: 'Alias of referenceImages. Optional image URL, file URL, or absolute local path to edit or retouch.'
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
    'Get supported image creation/editing models, resolutions, reference image support for image-to-image or editing workflows, and optional pricing information from VectCut.',
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
  display_name?: string
  description?: string
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

type CachedImageCapabilities = {
  capabilities: Record<string, ModelCapability>
  prices: Record<string, ModelPrice>
  expiresAt: number
}

type CachedImageModelList = {
  models: string[]
  expiresAt: number
}

type PreparedReferenceImage = {
  originalInput: string
  submittedUrl: string
  sourceKind: 'remote_url' | 'local_file'
}

const IMAGE_SUBMIT_FIELD_ALIASES: Record<string, string> = {
  referenceImages: 'reference_images',
  sourceImage: 'reference_images',
  sourceImages: 'reference_images',
  baseImage: 'reference_images',
  editImage: 'reference_images',
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

const isHttpLikeUrl = (value: string) => /^https?:\/\//i.test(value)
const LOCAL_IMAGE_PATH_HINT_PATTERN =
  /^(file:\/\/|\.{1,2}[\\/]|~[\\/]|\/|[A-Za-z]:[\\/])|[\\/]|.+\.(png|jpe?g|webp|gif|bmp|svg|heic|tiff?)(?:[?#].*)?$/i
const IMAGE_MODEL_ALIASES: Record<string, string[]> = {
  gptimage2: ['gpt-image-2-all'],
  'gpt-image-2': ['gpt-image-2-all'],
  'gpt-image-2-all': ['gpt-image-2-all']
}

class ImageGenerateServer {
  public mcpServer: McpServer
  private readonly store = new Store({ name: 'vectcut' })
  private accessToken: PendingToken | null = null
  private refreshPromise: Promise<string> | null = null
  private capabilitiesCache: CachedImageCapabilities | null = null
  private imageModelListCache: CachedImageModelList | null = null

  constructor() {
    this.mcpServer = this.createMcpServer()
  }

  public createMcpServer(): McpServer {
    const mcpServer = new McpServer(
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
    this.setupHandlers(mcpServer)
    return mcpServer
  }

  private setupHandlers(mcpServer: McpServer) {
    mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [IMAGE_GENERATE_TOOL, IMAGE_CAPABILITIES_TOOL]
    }))

    mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name
      const args = request.params.arguments ?? {}

      try {
        switch (toolName) {
          case PRIMARY_IMAGE_TOOL_NAME:
          case LEGACY_IMAGE_TOOL_NAME:
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

  private normalizeReferenceImageInput(value: unknown, fieldName: string) {
    const raw = String(value || '').trim()
    if (!raw) {
      throw new McpError(ErrorCode.InvalidParams, `'${fieldName}' contains an empty image reference`)
    }
    if (raw.startsWith('file://')) {
      return fileURLToPath(raw)
    }
    return raw
  }

  private async uploadLocalReferenceImage(filePath: string) {
    return ossUploadService.uploadLocalFile(filePath, {
      bucket: FILE_UPLOAD_BUCKET,
      region: FILE_UPLOAD_REGION,
      folder: FILE_UPLOAD_FOLDER_TEMPLATE,
      objectKeyPrefix: FILE_UPLOAD_OBJECT_KEY_PREFIX,
      signExpiresSeconds: FILE_UPLOAD_SIGN_EXPIRES_SECONDS
    })
  }

  private async prepareReferenceImageForSubmission(
    input: unknown,
    fieldName: string
  ): Promise<PreparedReferenceImage> {
    const normalizedSource = this.normalizeReferenceImageInput(input, fieldName)

    if (isHttpLikeUrl(normalizedSource)) {
      return {
        originalInput: normalizedSource,
        submittedUrl: normalizedSource,
        sourceKind: 'remote_url'
      }
    }

    if (!path.isAbsolute(normalizedSource)) {
      const message = `'${fieldName}' must use remote URLs, file URLs, or absolute local paths; upload local reference images first if needed`
      if (LOCAL_IMAGE_PATH_HINT_PATTERN.test(normalizedSource)) {
        throw new McpError(ErrorCode.InvalidParams, message)
      }
      throw new McpError(ErrorCode.InvalidParams, message)
    }

    const stats = await fsStat(normalizedSource)
    if (!stats.isFile()) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `'${fieldName}' must point to a local file when using an absolute local path`
      )
    }

    const uploaded = await this.uploadLocalReferenceImage(normalizedSource)
    return {
      originalInput: normalizedSource,
      submittedUrl: uploaded.signedPublicUrl,
      sourceKind: 'local_file'
    }
  }

  public async getImageModelList(forceRefresh = false) {
    if (!forceRefresh && this.imageModelListCache && Date.now() < this.imageModelListCache.expiresAt) {
      return {
        models: this.imageModelListCache.models,
        defaultModel: ''
      }
    }

    if (!forceRefresh && this.capabilitiesCache && Date.now() < this.capabilitiesCache.expiresAt) {
      const models = Object.keys(this.capabilitiesCache.capabilities)
      this.imageModelListCache = {
        models,
        expiresAt: this.capabilitiesCache.expiresAt
      }
      return {
        models,
        defaultModel: ''
      }
    }

    const capabilitiesPayload = await this.fetchImageCapabilitiesPayload(forceRefresh)
    const models = Object.keys(capabilitiesPayload.capabilities)
    this.imageModelListCache = {
      models,
      expiresAt: capabilitiesPayload.expiresAt
    }

    return {
      models,
      defaultModel: ''
    }
  }

  public async listImageCapabilities(filters: { model?: string; tier?: string; ratio?: string; includePrices?: boolean } = {}) {
    const modelFilter = typeof filters.model === 'string' ? filters.model.trim() : ''
    const tier = typeof filters.tier === 'string' ? filters.tier.trim() : ''
    const ratio = typeof filters.ratio === 'string' ? filters.ratio.trim() : ''
    const includePrices = typeof filters.includePrices === 'boolean' ? filters.includePrices : true

    const { capabilities, prices } = await this.fetchImageCapabilitiesPayload()

    const availableModels = Object.keys(capabilities)
    const resolvedModelFilter = modelFilter ? this.findClosestModelMatch(modelFilter, availableModels) : null
    if (modelFilter && !resolvedModelFilter) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown image model: ${modelFilter}`)
    }

    const targetModels = modelFilter ? [resolvedModelFilter!.model] : availableModels
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

    return {
      requestedModel: modelFilter || undefined,
      resolvedModel: resolvedModelFilter?.model,
      models
    }
  }

  private async fetchImageCapabilitiesPayload(forceRefresh = false): Promise<CachedImageCapabilities> {
    if (!forceRefresh && this.capabilitiesCache && Date.now() < this.capabilitiesCache.expiresAt) {
      return this.capabilitiesCache
    }

    const response = await this.requestWithAuth(IMAGE_MODEL_CAPABILITIES_ENDPOINT, {
      method: 'GET'
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Image model capabilities query failed (${response.status}): ${body || 'unknown error'}`)
    }

    const payload = (await response.json()) as ImageCapabilitiesResponse
    this.capabilitiesCache = {
      capabilities: payload.capabilities ?? {},
      prices: payload.prices ?? {},
      expiresAt: Date.now() + IMAGE_CAPABILITIES_CACHE_TTL_MS
    }
    this.imageModelListCache = {
      models: Object.keys(this.capabilitiesCache.capabilities),
      expiresAt: this.capabilitiesCache.expiresAt
    }

    return this.capabilitiesCache
  }

  private normalizeModelName(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '')
  }

  private levenshtein(a: string, b: string): number {
    if (a === '' || b === '') {
      return Math.max(a.length, b.length)
    }

    const matrix = Array.from({ length: a.length + 1 }, (_, i) =>
      Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
    )

    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1
        matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost)
      }
    }

    return matrix[a.length][b.length]
  }

  private findClosestModelMatch(requestedModel: string, availableModels: string[]) {
    const trimmedRequestedModel = requestedModel.trim()
    if (!trimmedRequestedModel || availableModels.length === 0) {
      return null
    }

    const exactMatch = availableModels.find((model) => model === trimmedRequestedModel)
    if (exactMatch) {
      return { model: exactMatch, score: 1, matchType: 'exact' }
    }

    const requestedLower = trimmedRequestedModel.toLowerCase()
    const caseInsensitiveMatch = availableModels.find((model) => model.toLowerCase() === requestedLower)
    if (caseInsensitiveMatch) {
      return { model: caseInsensitiveMatch, score: 0.99, matchType: 'case_insensitive' }
    }

    const normalizedRequestedModel = this.normalizeModelName(trimmedRequestedModel)
    if (!normalizedRequestedModel) {
      return null
    }

    const aliasedModels = IMAGE_MODEL_ALIASES[normalizedRequestedModel] ?? []
    for (const aliasTarget of aliasedModels) {
      const matchedAliasTarget = availableModels.find((model) => model === aliasTarget)
      if (matchedAliasTarget) {
        return { model: matchedAliasTarget, score: 0.995, matchType: 'alias' }
      }
    }

    let bestMatch: { model: string; score: number; matchType: string } | null = null

    for (const candidate of availableModels) {
      const normalizedCandidate = this.normalizeModelName(candidate)
      if (!normalizedCandidate) {
        continue
      }

      let score = 0
      let matchType = 'fuzzy'

      if (normalizedCandidate === normalizedRequestedModel) {
        score = 0.98
        matchType = 'normalized'
      } else if (normalizedCandidate.startsWith(normalizedRequestedModel)) {
        score = 0.94 - (normalizedCandidate.length - normalizedRequestedModel.length) / 100
        matchType = 'prefix'
      } else if (normalizedCandidate.includes(normalizedRequestedModel)) {
        score = 0.9 - (normalizedCandidate.length - normalizedRequestedModel.length) / 100
        matchType = 'contains'
      } else if (normalizedRequestedModel.includes(normalizedCandidate)) {
        score = 0.82 - (normalizedRequestedModel.length - normalizedCandidate.length) / 100
        matchType = 'reverse_contains'
      } else {
        const distance = this.levenshtein(normalizedRequestedModel, normalizedCandidate)
        const maxLength = Math.max(normalizedRequestedModel.length, normalizedCandidate.length)
        const similarity = maxLength === 0 ? 0 : 1 - distance / maxLength
        score = similarity
      }

      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { model: candidate, score, matchType }
      }
    }

    if (!bestMatch || bestMatch.score < 0.55) {
      return null
    }

    return bestMatch
  }

  private async resolveImageModelName(requestedModel: string) {
    const trimmedRequestedModel = requestedModel.trim()
    if (!trimmedRequestedModel) {
      return null
    }

    const { models: availableModels } = await this.getImageModelList()
    const closestMatch = this.findClosestModelMatch(trimmedRequestedModel, availableModels)

    if (!closestMatch) {
      return {
        requestedModel: trimmedRequestedModel,
        resolvedModel: trimmedRequestedModel,
        matchType: 'unresolved'
      }
    }

    return {
      requestedModel: trimmedRequestedModel,
      resolvedModel: closestMatch.model,
      matchType: closestMatch.matchType
    }
  }

  private async buildImageSubmitPayload(args: Record<string, unknown>) {
    const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
    if (!prompt) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "'prompt' is required when submitting an image generation or editing task"
      )
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

    if (typeof args.referenceImage === 'string' && args.referenceImage.trim()) {
      payload.reference_images = [args.referenceImage.trim()]
    }

    delete payload.referenceImage

    if (typeof payload.reference_images === 'string') {
      payload.reference_images = payload.reference_images.trim() ? [payload.reference_images.trim()] : []
    }

    if (Array.isArray(payload.reference_images)) {
      payload.reference_images = payload.reference_images
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    }

    const preparedReferenceImages = Array.isArray(payload.reference_images)
      ? await Promise.all(
          payload.reference_images.map((item) => this.prepareReferenceImageForSubmission(item, 'reference_images'))
        )
      : []
    if (preparedReferenceImages.length > 0) {
      payload.reference_images = preparedReferenceImages.map((item) => item.submittedUrl)
    }

    const rawModel = typeof payload.model === 'string' ? payload.model.trim() : ''
    const modelResolution = rawModel ? await this.resolveImageModelName(rawModel) : null
    if (modelResolution?.resolvedModel) {
      payload.model = modelResolution.resolvedModel
    }

    payload.prompt = prompt
    return {
      payload,
      modelResolution,
      preparedReferenceImages
    }
  }

  private async submitImageTask(args: Record<string, unknown>) {
    const { payload, modelResolution, preparedReferenceImages } = await this.buildImageSubmitPayload(args)
    const hasUploadedLocalReferenceImage = preparedReferenceImages.some((item) => item.sourceKind === 'local_file')
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
      model: typeof payload.model === 'string' ? payload.model : undefined,
      requestedModel: modelResolution?.requestedModel,
      modelMatchType: modelResolution?.matchType
    })

    return this.formatJsonResult({
      provider: 'vectcut',
      action: 'submit',
      estimated_wait_time: IMAGE_TASK_WAIT_TIME,
      polling_hint: 'AI image tasks are asynchronous and usually finish in 3-5 minutes. Use action="status" with taskId to query progress.',
      ...(modelResolution?.requestedModel
        ? {
            requested_model: modelResolution.requestedModel,
            resolved_model: modelResolution.resolvedModel,
            model_match_type: modelResolution.matchType
          }
        : {}),
      ...(hasUploadedLocalReferenceImage
        ? {
            reference_images: preparedReferenceImages.map((item) => item.submittedUrl),
            reference_images_prepared: preparedReferenceImages
          }
        : {}),
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
      ...(result.status && !['success', 'failed', 'error'].includes(result.status)
        ? {
            estimated_wait_time: IMAGE_TASK_WAIT_TIME,
            polling_hint: 'AI image tasks are asynchronous and may take around 3-5 minutes before completion.'
          }
        : {}),
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
      display_name: typeof capability?.display_name === 'string' ? capability.display_name : undefined,
      description: typeof capability?.description === 'string' ? capability.description : undefined,
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
    const { requestedModel, resolvedModel, models } = await this.listImageCapabilities({
      model: modelFilter,
      tier,
      ratio,
      includePrices
    })

    logger.info('Image model capabilities queried', {
      model: resolvedModel ?? (requestedModel || undefined),
      requestedModel: requestedModel || undefined,
      tier: tier || undefined,
      ratio: ratio || undefined,
      count: models.length
    })

    return this.formatJsonResult({
      provider: 'vectcut',
      action: 'capabilities',
      ...(requestedModel
        ? {
            requested_model: requestedModel,
            resolved_model: resolvedModel
          }
        : {}),
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
