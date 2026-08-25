import { stat as fsStat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loggerService } from '@logger'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
import type { ProgressToken } from '@modelcontextprotocol/sdk/types.js'
import Store from 'electron-store'
import { net } from 'electron'

import { ossUploadService } from '@main/services/OssUploadService'

const logger = loggerService.withContext('MCPServer:VideoGenerate')

const API_HOST = 'https://open.vectcut.com'
const VIDEO_GENERATE_ENDPOINT = '/cut_jianying/generate_ai_video'
const VIDEO_TASK_STATUS_ENDPOINT = '/cut_jianying/aivideo/task_status'
const VIDEO_MODEL_CAPABILITIES_ENDPOINT = '/llm/video/model_capabilities'
const OAUTH_TOKEN_URL = 'https://mlbd8l6vgi13-demo.authing.cn/oidc/token'
const OAUTH_CLIENT_ID = '6901dd145dafc6f1f3143938'
const OAUTH_CLIENT_SECRET = '16a94e467e927cc09b3c8dc7ec92d420'
const PRIMARY_VIDEO_TOOL_NAME = 'generate_video'
const VIDEO_TASK_WAIT_TIME = '5-30 minutes'
const VIDEO_CAPABILITIES_CACHE_TTL_MS = 5 * 60 * 1000
const FILE_UPLOAD_BUCKET = 'oss-hangzhou-mp4'
const FILE_UPLOAD_REGION = 'oss-cn-hangzhou'
const FILE_UPLOAD_FOLDER_TEMPLATE = 'agent_tmp/{uid}'
const FILE_UPLOAD_OBJECT_KEY_PREFIX = 'vectcut_ai_video_reference_'
const FILE_UPLOAD_SIGN_EXPIRES_SECONDS = 60 * 60

const VIDEO_GENERATE_TOOL: Tool = {
  name: PRIMARY_VIDEO_TOOL_NAME,
  description:
    'Create, generate, or extend AI videos via VectCut and wait until the same tool call finishes with the final video result. Use this for text-to-video, image-to-video, first-frame or first-last-frame guided generation, multimodal reference-driven generation, or related video generation workflows. The default behavior is submit-and-wait. The legacy action="submit" and action="status" forms remain available only for backward compatibility. For Seedance multimodal workflows, pass content items such as {type:"text", text:"..."}, {type:"image_url", image_url:{url:"..."}, role:"reference_image"}, {type:"video_url", video_url:{url:"..."}, role:"reference_video"}, or {type:"audio_url", audio_url:{url:"..."}, role:"reference_audio"}. If the user provides a reference video, preserve it as a video reference via video_url/reference_video. Do not silently decompose a reference video into extracted frames plus audio unless the user explicitly asks for frame extraction or audio separation. Remote references are accepted directly, and local file URLs or absolute local paths inside those references are uploaded automatically before submission.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['submit', 'submit_and_wait', 'status'],
        description:
          'Optional backward-compatible override. Omit this field to submit and wait for the final result. submit returns immediately after task creation, submit_and_wait waits until completion, and status queries an existing task.'
      },
      prompt: {
        type: 'string',
        description:
          'Optional text prompt for generic text-to-video or image-to-video workflows. Provide this or a content array with at least one text item.'
      },
      taskId: {
        type: 'string',
        description:
          'Backward-compatible task ID returned by the legacy submit mode. Required only when action is status.'
      },
      model: {
        type: 'string',
        description:
          'Optional video model, such as seedance-2.0, seedance-2.0-fast, veo3.1, veo3.1-pro, or grok-video-3. If a non-standard alias is provided, the server will try to map it to the closest supported model returned by capabilities.'
      },
      resolution: {
        type: 'string',
        description: 'Optional output resolution, such as 1280x720 or 1080x1920.'
      },
      gen_duration: {
        type: 'number',
        description: 'Optional generation duration in seconds for video generation.'
      },
      generateAudio: {
        type: 'boolean',
        description: 'Alias of generate_audio. Whether the generated video should include audio when the chosen model supports it.'
      },
      generate_audio: {
        type: 'boolean',
        description: 'Whether the generated video should include audio when the chosen model supports it.'
      },
      content: {
        type: 'array',
        items: {
          type: 'object'
        },
        description:
          'Optional multimodal content array for Seedance-style workflows. Example items: {type:"text", text:"..."}, {type:"image_url", image_url:{url:"..."}, role:"reference_image"}, {type:"video_url", video_url:{url:"..."}, role:"reference_video"}, {type:"audio_url", audio_url:{url:"..."}, role:"reference_audio"}. Prefer remotely accessible URLs produced by workspace upload for local files. Local file URLs or absolute local paths in the nested url fields remain supported as a compatibility fallback and are uploaded automatically.'
      },
      generationMode: {
        type: 'string',
        enum: ['text_to_video', 'first_frame', 'first_last_frame', 'reference'],
        description:
          'Optional generation mode hint. For seedance-1.5-pro images[] uses positional semantics: 1 image = first frame, 2 images = first and last frame, >2 images = first frame, last frame, then extra reference images. For seedance-2.0 this hint helps map images into content roles such as first_frame, last_frame, or reference_image.'
      },
      generation_mode: {
        type: 'string',
        enum: ['text_to_video', 'first_frame', 'first_last_frame', 'reference'],
        description: 'Alias of generationMode.'
      },
      firstFrameImage: {
        type: 'string',
        description:
          'Optional explicit first frame image URL, file URL, or absolute local path. For seedance-1.5-pro it becomes the first item in images[]. For seedance-2.0 it becomes a content item with role first_frame.'
      },
      lastFrameImage: {
        type: 'string',
        description:
          'Optional explicit last frame image URL, file URL, or absolute local path. For seedance-1.5-pro it becomes the second item in images[] when present. For seedance-2.0 it becomes a content item with role last_frame.'
      },
      referenceImages: {
        type: 'array',
        items: {
          type: 'string'
        },
        description:
          'Optional convenience alias for reference images. For seedance-2.0 these become content items with role reference_image. For seedance-1.5-pro they are appended after the first or last frame positions in images[].'
      },
      referenceVideos: {
        type: 'array',
        items: {
          type: 'string'
        },
        description:
          'Optional convenience alias for appending reference_video items into content. Prefer remote URLs, typically produced by workspace upload for local files. File URLs and absolute local paths remain supported as a compatibility fallback.'
      },
      referenceAudios: {
        type: 'array',
        items: {
          type: 'string'
        },
        description:
          'Optional convenience alias for appending reference_audio items into content. Prefer remote URLs, typically produced by workspace upload for local files. File URLs and absolute local paths remain supported as a compatibility fallback.'
      },
      images: {
        type: 'array',
        items: {
          type: 'string'
        },
        description:
          'Optional image list for non-Seedance-2.0 models such as seedance-1.5-pro or veo. The first image is typically treated as the start frame, the second as the end frame, and remaining images as reference images.'
      }
    },
    additionalProperties: true
  }
}

const VIDEO_CAPABILITIES_TOOL: Tool = {
  name: 'get_video_capabilities',
  description:
    'Get supported AI video generation models, generation duration options, supported resolutions, first-frame or first-last-frame support, multimodal reference support, audio generation support, super-resolution support, and optional pricing information from VectCut.',
  inputSchema: {
    type: 'object',
    properties: {
      model: {
        type: 'string',
        description: 'Optional model name to inspect, such as seedance-2.0, veo3.1, or grok-video-3.'
      },
      tier: {
        type: 'string',
        description: 'Optional resolution tier filter, such as 480p, 720p, or 1080p.'
      },
      ratio: {
        type: 'string',
        description: 'Optional aspect ratio filter, such as 16:9 or 9:16.'
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

type ToolExecutionExtra = {
  requestId: string | number
  _meta?: {
    progressToken?: ProgressToken
  }
  sendNotification?: (notification: {
    method: 'notifications/progress'
    params: {
      progressToken: ProgressToken
      progress: number
      total?: number
      message?: string
    }
  }) => Promise<void>
}

type VideoSubmitResponse = {
  status?: string
  task_id?: string
  error?: string
  [key: string]: unknown
}

type VideoTaskStatusResponse = {
  draft_error?: string
  draft_id?: string
  draft_url?: string
  id?: string
  progress?: number
  status?: string
  task_id?: string
  video_url?: string
  error?: string
  [key: string]: unknown
}

type ResolutionItem = {
  ratio?: string
  size?: string
}

type VideoGenerationMode = {
  value?: string
  label?: string
  price_group?: string
  offline_price_group?: string
}

type VideoPriceEntry = {
  project_id?: string
  resource_points_per_unit?: number
}

type VideoModelPrice = Record<string, Record<string, VideoPriceEntry>>

type VideoModelCapability = {
  display_name?: string
  description?: string
  reference_supported?: boolean
  first_frame_extend_supported?: boolean
  first_last_frame_supported?: boolean
  multi_image_reference_supported?: boolean
  generate_audio_supported?: boolean
  seedance_offline_supported?: boolean
  super_resolve_supported?: boolean
  gen_durations?: number[]
  generation_modes?: VideoGenerationMode[]
  resolutions?: Record<string, ResolutionItem[]>
}

type VideoCapabilitiesResponse = {
  capabilities?: Record<string, VideoModelCapability>
  prices?: Record<string, VideoModelPrice>
  [key: string]: unknown
}

type CachedVideoCapabilities = {
  capabilities: Record<string, VideoModelCapability>
  prices: Record<string, VideoModelPrice>
  expiresAt: number
}

type CachedVideoModelList = {
  models: string[]
  expiresAt: number
}

type PreparedReferenceAsset = {
  originalInput: string
  submittedUrl: string
  sourceKind: 'remote_url' | 'local_file'
  mediaType: 'image' | 'video' | 'audio'
  role?: string
}

const VIDEO_SUBMIT_FIELD_ALIASES: Record<string, string> = {
  generateAudio: 'generate_audio',
  draftId: 'draft_id',
  composeDraft: 'compose_draft',
  trackName: 'track_name',
  generationMode: 'generation_mode'
}

const MULTIMODAL_REFERENCE_FIELD_MAP = {
  image_url: 'image',
  video_url: 'video',
  audio_url: 'audio'
} as const
const VIDEO_GENERATION_MODE_SET = new Set(['text_to_video', 'first_frame', 'first_last_frame', 'reference'])

const isHttpLikeUrl = (value: string) => /^https?:\/\//i.test(value)
const LOCAL_MEDIA_PATH_HINT_PATTERN =
  /^(file:\/\/|\.{1,2}[\\/]|~[\\/]|\/|[A-Za-z]:[\\/])|[\\/]|.+\.(png|jpe?g|webp|gif|bmp|svg|heic|tiff?|mp4|mov|m4v|avi|mkv|webm|mp3|wav|m4a|aac|flac|ogg)(?:[?#].*)?$/i
const VIDEO_MODEL_ALIASES: Record<string, string[]> = {
  seedance20: ['seedance-2.0'],
  'seedance-2-0': ['seedance-2.0'],
  seedance20fast: ['seedance-2.0-fast'],
  'seedance-2-0-fast': ['seedance-2.0-fast'],
  doubaoseedance20: ['seedance-2.0'],
  doubaoseedance20260128: ['seedance-2.0'],
  doubaoseedance20fast: ['seedance-2.0-fast'],
  doubaoseedance20fast260128: ['seedance-2.0-fast']
}

class VideoGenerateServer {
  public mcpServer: McpServer
  private readonly store = new Store({ name: 'vectcut' })
  private accessToken: PendingToken | null = null
  private refreshPromise: Promise<string> | null = null
  private capabilitiesCache: CachedVideoCapabilities | null = null
  private videoModelListCache: CachedVideoModelList | null = null

  constructor() {
    this.mcpServer = this.createMcpServer()
  }

  public createMcpServer(): McpServer {
    const mcpServer = new McpServer(
      {
        name: 'video',
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
      tools: [VIDEO_GENERATE_TOOL, VIDEO_CAPABILITIES_TOOL]
    }))

    mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const toolName = request.params.name
      const args = request.params.arguments ?? {}

      try {
        switch (toolName) {
          case PRIMARY_VIDEO_TOOL_NAME:
            return await this.generateVideo(args as Record<string, unknown>, extra as ToolExecutionExtra)
          case 'get_video_capabilities':
            return await this.getVideoCapabilities(args as Record<string, unknown>)
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

  private normalizeReferenceInput(value: unknown, fieldName: string) {
    const raw = String(value || '').trim()
    if (!raw) {
      throw new McpError(ErrorCode.InvalidParams, `'${fieldName}' contains an empty media reference`)
    }
    if (raw.startsWith('file://')) {
      return fileURLToPath(raw)
    }
    return raw
  }

  private async uploadLocalReferenceFile(filePath: string) {
    return ossUploadService.uploadLocalFile(filePath, {
      bucket: FILE_UPLOAD_BUCKET,
      region: FILE_UPLOAD_REGION,
      folder: FILE_UPLOAD_FOLDER_TEMPLATE,
      objectKeyPrefix: FILE_UPLOAD_OBJECT_KEY_PREFIX,
      signExpiresSeconds: FILE_UPLOAD_SIGN_EXPIRES_SECONDS
    })
  }

  private async prepareReferenceForSubmission(
    input: unknown,
    fieldName: string,
    mediaType: 'image' | 'video' | 'audio',
    role?: string
  ): Promise<PreparedReferenceAsset> {
    const normalizedSource = this.normalizeReferenceInput(input, fieldName)

    if (isHttpLikeUrl(normalizedSource)) {
      return {
        originalInput: normalizedSource,
        submittedUrl: normalizedSource,
        sourceKind: 'remote_url',
        mediaType,
        role
      }
    }

    if (!path.isAbsolute(normalizedSource)) {
      const message = `'${fieldName}' must use remote URLs, file URLs, or absolute local paths; upload local references first if needed`
      if (LOCAL_MEDIA_PATH_HINT_PATTERN.test(normalizedSource)) {
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

    const uploaded = await this.uploadLocalReferenceFile(normalizedSource)
    return {
      originalInput: normalizedSource,
      submittedUrl: uploaded.signedPublicUrl,
      sourceKind: 'local_file',
      mediaType,
      role
    }
  }

  public async getVideoModelList(forceRefresh = false) {
    if (!forceRefresh && this.videoModelListCache && Date.now() < this.videoModelListCache.expiresAt) {
      return {
        models: this.videoModelListCache.models,
        defaultModel: ''
      }
    }

    if (!forceRefresh && this.capabilitiesCache && Date.now() < this.capabilitiesCache.expiresAt) {
      const models = Object.keys(this.capabilitiesCache.capabilities)
      this.videoModelListCache = {
        models,
        expiresAt: this.capabilitiesCache.expiresAt
      }
      return {
        models,
        defaultModel: ''
      }
    }

    const capabilitiesPayload = await this.fetchVideoCapabilitiesPayload(forceRefresh)
    const models = Object.keys(capabilitiesPayload.capabilities)
    this.videoModelListCache = {
      models,
      expiresAt: capabilitiesPayload.expiresAt
    }

    return {
      models,
      defaultModel: ''
    }
  }

  public async listVideoCapabilities(
    filters: { model?: string; tier?: string; ratio?: string; includePrices?: boolean } = {}
  ) {
    const modelFilter = typeof filters.model === 'string' ? filters.model.trim() : ''
    const tier = typeof filters.tier === 'string' ? filters.tier.trim() : ''
    const ratio = typeof filters.ratio === 'string' ? filters.ratio.trim() : ''
    const includePrices = typeof filters.includePrices === 'boolean' ? filters.includePrices : true

    const { capabilities, prices } = await this.fetchVideoCapabilitiesPayload()
    const availableModels = Object.keys(capabilities)
    const resolvedModelFilter = modelFilter ? this.findClosestModelMatch(modelFilter, availableModels) : null

    if (modelFilter && !resolvedModelFilter) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown video model: ${modelFilter}`)
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

    logger.info('Video model capabilities queried', {
      model: resolvedModelFilter?.model ?? (modelFilter || undefined),
      requestedModel: modelFilter || undefined,
      tier: tier || undefined,
      ratio: ratio || undefined,
      count: models.length
    })

    return {
      requestedModel: modelFilter || undefined,
      resolvedModel: resolvedModelFilter?.model,
      models
    }
  }

  private async fetchVideoCapabilitiesPayload(forceRefresh = false): Promise<CachedVideoCapabilities> {
    if (!forceRefresh && this.capabilitiesCache && Date.now() < this.capabilitiesCache.expiresAt) {
      return this.capabilitiesCache
    }

    const response = await this.requestWithAuth(VIDEO_MODEL_CAPABILITIES_ENDPOINT, {
      method: 'GET'
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Video model capabilities query failed (${response.status}): ${body || 'unknown error'}`)
    }

    const payload = (await response.json()) as VideoCapabilitiesResponse
    this.capabilitiesCache = {
      capabilities: payload.capabilities ?? {},
      prices: payload.prices ?? {},
      expiresAt: Date.now() + VIDEO_CAPABILITIES_CACHE_TTL_MS
    }
    this.videoModelListCache = {
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

    const aliasedModels = VIDEO_MODEL_ALIASES[normalizedRequestedModel] ?? []
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
        score = maxLength === 0 ? 0 : 1 - distance / maxLength
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

  private async resolveVideoModelName(requestedModel: string) {
    const trimmedRequestedModel = requestedModel.trim()
    if (!trimmedRequestedModel) {
      return null
    }

    const { models: availableModels } = await this.getVideoModelList()
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

  private normalizeContentArray(content: unknown) {
    if (!Array.isArray(content)) {
      return [] as Record<string, unknown>[]
    }

    return content
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
      .map((item) => ({ ...item }))
  }

  private getStringArray(value: unknown) {
    if (typeof value === 'string' && value.trim()) {
      return [value.trim()]
    }

    if (!Array.isArray(value)) {
      return [] as string[]
    }

    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
  }

  private isSeedance20Model(model: string) {
    return /^seedance-2\.0(?:-fast)?$/i.test(model.trim())
  }

  private normalizeGenerationMode(mode: unknown) {
    if (typeof mode !== 'string') {
      return ''
    }
    const normalized = mode.trim().toLowerCase()
    return VIDEO_GENERATION_MODE_SET.has(normalized) ? normalized : ''
  }

  private extractMediaUrlFromContentItem(item: Record<string, unknown>, fieldName: keyof typeof MULTIMODAL_REFERENCE_FIELD_MAP) {
    const value = item[fieldName]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
    if (value && typeof value === 'object' && !Array.isArray(value) && typeof (value as { url?: unknown }).url === 'string') {
      return String((value as { url: string }).url).trim()
    }
    return ''
  }

  private extractImageRoleFromContentItem(item: Record<string, unknown>) {
    const role = typeof item.role === 'string' ? item.role.trim() : ''
    if (role === 'first_frame' || role === 'last_frame' || role === 'reference_image') {
      return role
    }
    return ''
  }

  private appendConvenienceReferenceContent(
    payload: Record<string, unknown>,
    args: Record<string, unknown>,
    generationMode: string
  ) {
    const content = this.normalizeContentArray(payload.content)
    const explicitFirstFrameImage = this.getStringArray(args.firstFrameImage)[0] || ''
    const explicitLastFrameImage = this.getStringArray(args.lastFrameImage)[0] || ''
    const orderedImages = this.getStringArray(payload.images)
    const referenceImages = this.getStringArray(args.referenceImages)

    const appendImage = (url: string, role: 'first_frame' | 'last_frame' | 'reference_image') => {
      if (!url) {
        return
      }
      content.push({
        type: 'image_url',
        image_url: {
          url
        },
        role
      })
    }

    const appendItems = (
      input: unknown,
      mediaField: 'video_url' | 'audio_url',
      role: 'reference_video' | 'reference_audio'
    ) => {
      if (!Array.isArray(input)) {
        return
      }

      for (const item of input) {
        if (typeof item !== 'string' || !item.trim()) {
          continue
        }
        content.push({
          type: mediaField,
          [mediaField]: {
            url: item.trim()
          },
          role
        })
      }
    }

    appendImage(explicitFirstFrameImage, 'first_frame')
    appendImage(explicitLastFrameImage, 'last_frame')

    if (!explicitFirstFrameImage && orderedImages.length > 0) {
      if (generationMode === 'first_frame' || generationMode === 'first_last_frame') {
        appendImage(orderedImages[0], 'first_frame')
      }
    }

    if (!explicitLastFrameImage && orderedImages.length > 1 && generationMode === 'first_last_frame') {
      appendImage(orderedImages[1], 'last_frame')
    }

    const inferredReferenceImages =
      generationMode === 'first_last_frame'
        ? orderedImages.slice(2)
        : generationMode === 'first_frame'
          ? orderedImages.slice(1)
          : orderedImages

    for (const item of [...referenceImages, ...inferredReferenceImages]) {
      appendImage(item, 'reference_image')
    }

    appendItems(args.referenceVideos, 'video_url', 'reference_video')
    appendItems(args.referenceAudios, 'audio_url', 'reference_audio')

    if (content.length > 0) {
      payload.content = content
    } else {
      delete payload.content
    }
    delete payload.images
  }

  private async prepareContentReferences(content: Record<string, unknown>[]) {
    const preparedReferenceAssets: PreparedReferenceAsset[] = []

    const normalizedContent = await Promise.all(
      content.map(async (item, index) => {
        const nextItem = { ...item }
        const role = typeof nextItem.role === 'string' ? nextItem.role : undefined

        for (const [fieldName, mediaType] of Object.entries(MULTIMODAL_REFERENCE_FIELD_MAP) as Array<
          [keyof typeof MULTIMODAL_REFERENCE_FIELD_MAP, (typeof MULTIMODAL_REFERENCE_FIELD_MAP)[keyof typeof MULTIMODAL_REFERENCE_FIELD_MAP]]
        >) {
          const currentValue = nextItem[fieldName]
          if (typeof currentValue === 'string' && currentValue.trim()) {
            const prepared = await this.prepareReferenceForSubmission(
              currentValue,
              `content[${index}].${fieldName}`,
              mediaType,
              role
            )
            nextItem[fieldName] = prepared.submittedUrl
            preparedReferenceAssets.push(prepared)
            continue
          }

          if (
            currentValue &&
            typeof currentValue === 'object' &&
            !Array.isArray(currentValue) &&
            typeof (currentValue as { url?: unknown }).url === 'string'
          ) {
            const prepared = await this.prepareReferenceForSubmission(
              (currentValue as { url: string }).url,
              `content[${index}].${fieldName}.url`,
              mediaType,
              role
            )
            nextItem[fieldName] = {
              ...(currentValue as Record<string, unknown>),
              url: prepared.submittedUrl
            }
            preparedReferenceAssets.push(prepared)
          }
        }

        return nextItem
      })
    )

    return {
      content: normalizedContent,
      preparedReferenceAssets
    }
  }

  private async prepareImageReferences(images: unknown, fieldName: string) {
    const preparedReferenceAssets: PreparedReferenceAsset[] = []
    const normalizedImages = await Promise.all(
      this.getStringArray(images).map(async (input, index) => {
        const prepared = await this.prepareReferenceForSubmission(input, `${fieldName}[${index}]`, 'image', 'reference_image')
        preparedReferenceAssets.push(prepared)
        return prepared.submittedUrl
      })
    )

    return {
      images: normalizedImages,
      preparedReferenceAssets
    }
  }

  private collectOrderedImageInputsForClassicModels(
    payload: Record<string, unknown>,
    args: Record<string, unknown>,
    generationMode: string
  ) {
    const explicitFirstFrameImage = this.getStringArray(args.firstFrameImage)[0] || ''
    const explicitLastFrameImage = this.getStringArray(args.lastFrameImage)[0] || ''
    const orderedImages = this.getStringArray(payload.images)
    const referenceImages = this.getStringArray(args.referenceImages)
    const normalizedContent = this.normalizeContentArray(payload.content)

    let inferredFirstFrameImage = ''
    let inferredLastFrameImage = ''
    const inferredReferenceImages: string[] = []

    for (const item of normalizedContent) {
      const imageUrl = this.extractMediaUrlFromContentItem(item, 'image_url')
      if (!imageUrl) {
        continue
      }
      const role = this.extractImageRoleFromContentItem(item)
      if (role === 'first_frame' && !inferredFirstFrameImage) {
        inferredFirstFrameImage = imageUrl
      } else if (role === 'last_frame' && !inferredLastFrameImage) {
        inferredLastFrameImage = imageUrl
      } else {
        inferredReferenceImages.push(imageUrl)
      }
    }

    const fallbackImages = [...orderedImages]
    let firstFrameImage = explicitFirstFrameImage || inferredFirstFrameImage
    let lastFrameImage = explicitLastFrameImage || inferredLastFrameImage

    if (!firstFrameImage && (generationMode === 'first_frame' || generationMode === 'first_last_frame')) {
      firstFrameImage = fallbackImages.shift() || ''
    }
    if (!lastFrameImage && generationMode === 'first_last_frame') {
      if (firstFrameImage && fallbackImages[0] === firstFrameImage) {
        fallbackImages.shift()
      }
      lastFrameImage = fallbackImages.shift() || ''
    }

    const images = [
      ...(firstFrameImage ? [firstFrameImage] : []),
      ...(lastFrameImage ? [lastFrameImage] : []),
      ...referenceImages,
      ...fallbackImages,
      ...inferredReferenceImages
    ]

    return {
      images,
      normalizedContent
    }
  }

  private async buildVideoSubmitPayload(args: Record<string, unknown>) {
    if (typeof args.duration === 'number' || typeof args.genDuration === 'number') {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Video generation only accepts 'gen_duration' for the target duration in seconds. Do not use 'duration' or 'genDuration'."
      )
    }

    const payload: Record<string, unknown> = {}

    for (const [rawKey, value] of Object.entries(args)) {
      if (value === undefined) {
        continue
      }

      if (
        rawKey === 'action' ||
        rawKey === 'taskId' ||
        rawKey === 'task_id' ||
        rawKey === 'referenceImages' ||
        rawKey === 'referenceVideos' ||
        rawKey === 'referenceAudios' ||
        rawKey === 'firstFrameImage' ||
        rawKey === 'lastFrameImage'
      ) {
        continue
      }

      const key = VIDEO_SUBMIT_FIELD_ALIASES[rawKey] ?? rawKey
      payload[key] = value
    }

    if (typeof payload.prompt === 'string') {
      payload.prompt = payload.prompt.trim()
    }

    const rawModel = typeof payload.model === 'string' ? payload.model.trim() : ''
    const generationMode = this.normalizeGenerationMode(payload.generation_mode ?? args.generationMode)
    const modelResolution = rawModel ? await this.resolveVideoModelName(rawModel) : null
    if (modelResolution?.resolvedModel) {
      payload.model = modelResolution.resolvedModel
    }

    const resolvedModel = typeof payload.model === 'string' ? payload.model.trim() : ''
    const contentForRouting = this.normalizeContentArray(payload.content)
    const hasImplicitSeedance20Reference =
      !resolvedModel &&
      (this.getStringArray(args.referenceVideos).length > 0 ||
        this.getStringArray(args.referenceAudios).length > 0 ||
        contentForRouting.some(
          (item) =>
            Boolean(this.extractMediaUrlFromContentItem(item, 'video_url')) ||
            Boolean(this.extractMediaUrlFromContentItem(item, 'audio_url'))
        ))
    const isSeedance20 = this.isSeedance20Model(resolvedModel) || hasImplicitSeedance20Reference
    let preparedReferenceAssets: PreparedReferenceAsset[] = []

    if (isSeedance20) {
      this.appendConvenienceReferenceContent(payload, args, generationMode)

      const normalizedContent = this.normalizeContentArray(payload.content)
      const hasPrompt = typeof payload.prompt === 'string' && payload.prompt.length > 0
      const hasContent = normalizedContent.length > 0

      if (!hasPrompt && !hasContent) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Either 'prompt' or 'content' is required when submitting a video generation task"
        )
      }

      const preparedContent = hasContent ? await this.prepareContentReferences(normalizedContent) : null
      if (preparedContent && preparedContent.content.length > 0) {
        payload.content = preparedContent.content
        preparedReferenceAssets = preparedContent.preparedReferenceAssets
      } else {
        delete payload.content
      }

      delete payload.generation_mode
    } else {
      const { images: collectedImageInputs, normalizedContent } = this.collectOrderedImageInputsForClassicModels(
        payload,
        args,
        generationMode
      )
      const promptSegments: string[] = []
      let hasVideoReference = this.getStringArray(args.referenceVideos).length > 0
      let hasAudioReference = this.getStringArray(args.referenceAudios).length > 0

      for (const item of normalizedContent) {
        if (typeof item.text === 'string' && item.text.trim()) {
          promptSegments.push(item.text.trim())
        }

        if (this.extractMediaUrlFromContentItem(item, 'video_url')) {
          hasVideoReference = true
        }

        if (this.extractMediaUrlFromContentItem(item, 'audio_url')) {
          hasAudioReference = true
        }
      }

      if (hasVideoReference || hasAudioReference) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Model '${resolvedModel || rawModel || 'current'}' does not support Seedance 2.0 style video/audio reference inputs. Use only prompt + images for this model, or switch to seedance-2.0 / seedance-2.0-fast.`
        )
      }

      if ((!payload.prompt || typeof payload.prompt !== 'string' || !payload.prompt.trim()) && promptSegments.length > 0) {
        payload.prompt = promptSegments.join('\n')
      }

      const hasPrompt = typeof payload.prompt === 'string' && payload.prompt.trim().length > 0
      if (!hasPrompt) {
        if (normalizedContent.length === 0 && collectedImageInputs.length === 0) {
          throw new McpError(
            ErrorCode.InvalidParams,
            "Either 'prompt' or 'content' is required when submitting a video generation task"
          )
        }
        throw new McpError(
          ErrorCode.InvalidParams,
          "A non-Seedance-2.0 video model requires 'prompt'. If you passed Seedance-style content, include at least one text item or a top-level prompt."
        )
      }

      if (collectedImageInputs.length > 0) {
        const preparedImages = await this.prepareImageReferences(collectedImageInputs, 'images')
        payload.images = preparedImages.images
        preparedReferenceAssets = preparedImages.preparedReferenceAssets
      } else {
        delete payload.images
      }

      delete payload.content
      delete payload.generation_mode
    }

    return {
      payload,
      modelResolution,
      preparedReferenceAssets
    }
  }

  private async submitVideoTask(args: Record<string, unknown>) {
    const { payload, modelResolution, preparedReferenceAssets } = await this.buildVideoSubmitPayload(args)
    const hasUploadedLocalReference = preparedReferenceAssets.some((item) => item.sourceKind === 'local_file')
    const response = await this.requestWithAuth(VIDEO_GENERATE_ENDPOINT, {
      method: 'POST',
      body: payload
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Video generation task submission failed (${response.status}): ${body || 'unknown error'}`)
    }

    const result = (await response.json()) as VideoSubmitResponse

    logger.info('AI video generation task submitted', {
      taskId: result.task_id,
      model: typeof payload.model === 'string' ? payload.model : undefined,
      requestedModel: modelResolution?.requestedModel,
      modelMatchType: modelResolution?.matchType
    })

    return this.formatJsonResult({
      provider: 'vectcut',
      action: 'submit',
      estimated_wait_time: VIDEO_TASK_WAIT_TIME,
      polling_hint:
        'AI video tasks are asynchronous and may take several minutes or longer. Use action="status" with taskId to query progress until a final status is reached.',
      ...(modelResolution?.requestedModel
        ? {
            requested_model: modelResolution.requestedModel,
            resolved_model: modelResolution.resolvedModel,
            model_match_type: modelResolution.matchType
          }
        : {}),
      ...(hasUploadedLocalReference
        ? {
            prepared_references: preparedReferenceAssets
          }
        : {}),
      ...result
    })
  }

  private async getVideoTaskStatus(taskId: string) {
    const response = await this.requestWithAuth(VIDEO_TASK_STATUS_ENDPOINT, {
      method: 'GET',
      query: {
        task_id: taskId
      }
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Video generation task status query failed (${response.status}): ${body || 'unknown error'}`)
    }

    const result = (await response.json()) as VideoTaskStatusResponse

    logger.info('AI video generation task status queried', {
      taskId,
      status: result.status,
      progress: result.progress
    })

    return this.formatJsonResult({
      provider: 'vectcut',
      action: 'status',
      ...(result.status && !['succeeded', 'failed', 'not_found'].includes(result.status)
        ? {
            estimated_wait_time: VIDEO_TASK_WAIT_TIME,
            polling_hint: 'AI video tasks are asynchronous and may remain queued or running for several minutes.'
          }
        : {}),
      ...result,
      ...(result.task_id ? {} : { task_id: taskId })
    })
  }

  private async queryVideoTaskStatus(taskId: string): Promise<VideoTaskStatusResponse> {
    const response = await this.requestWithAuth(VIDEO_TASK_STATUS_ENDPOINT, {
      method: 'GET',
      query: {
        task_id: taskId
      }
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Video generation task status query failed (${response.status}): ${body || 'unknown error'}`)
    }

    const result = (await response.json()) as VideoTaskStatusResponse

    logger.info('AI video generation task status queried', {
      taskId,
      status: result.status,
      progress: result.progress
    })

    return result
  }

  private async sleep(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms))
  }

  private async reportProgress(extra: ToolExecutionExtra | undefined, progress: number, message: string) {
    if (!extra?._meta?.progressToken || typeof extra.sendNotification !== 'function') {
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

  private normalizeVideoTaskStatus(status: unknown): string {
    return String(status || '').trim().toLowerCase()
  }

  private isVideoTaskCompleted(result: VideoTaskStatusResponse): boolean {
    const status = this.normalizeVideoTaskStatus(result.status)
    return status === 'succeeded' || status === 'success'
  }

  private isVideoTaskFailed(result: VideoTaskStatusResponse): boolean {
    const status = this.normalizeVideoTaskStatus(result.status)
    return status === 'failed' || status === 'not_found' || status === 'error'
  }

  private mapVideoProgress(result: VideoTaskStatusResponse, attempt: number): number {
    if (typeof result.progress === 'number' && Number.isFinite(result.progress)) {
      const numericProgress = result.progress <= 1 ? result.progress * 100 : result.progress
      return Math.max(12, Math.min(95, Math.round(numericProgress)))
    }
    return Math.min(92, 12 + attempt * 5)
  }

  private async submitAndWaitVideoTask(args: Record<string, unknown>, extra?: ToolExecutionExtra) {
    await this.reportProgress(extra, 5, '正在提交视频生成任务')
    const { payload, modelResolution, preparedReferenceAssets } = await this.buildVideoSubmitPayload(args)
    const hasUploadedLocalReference = preparedReferenceAssets.some((item) => item.sourceKind === 'local_file')
    const response = await this.requestWithAuth(VIDEO_GENERATE_ENDPOINT, {
      method: 'POST',
      body: payload
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Video generation task submission failed (${response.status}): ${body || 'unknown error'}`)
    }

    const submitResult = (await response.json()) as VideoSubmitResponse
    const taskId = typeof submitResult.task_id === 'string' ? submitResult.task_id.trim() : ''
    if (!taskId) {
      throw new Error(`Video generation task submission returned no task ID: ${JSON.stringify(submitResult)}`)
    }

    await this.reportProgress(extra, 12, '视频生成任务已提交，预计 5-30 分钟完成')

    const deadline = Date.now() + 35 * 60 * 1000
    let attempt = 0
    while (Date.now() < deadline) {
      attempt += 1
      const result = await this.queryVideoTaskStatus(taskId)
      if (this.isVideoTaskCompleted(result)) {
        await this.reportProgress(extra, 100, '视频生成完成')
        return this.formatJsonResult({
          provider: 'vectcut',
          action: 'submit_and_wait',
          estimated_wait_time: VIDEO_TASK_WAIT_TIME,
          ...(modelResolution?.requestedModel
            ? {
                requested_model: modelResolution.requestedModel,
                resolved_model: modelResolution.resolvedModel,
                model_match_type: modelResolution.matchType
              }
            : {}),
          ...(hasUploadedLocalReference
            ? {
                prepared_references: preparedReferenceAssets
              }
            : {}),
          output: {
            draft_id: result.draft_id,
            draft_url: result.draft_url,
            video_url: result.video_url
          },
          ...result,
          ...(result.task_id ? {} : { task_id: taskId })
        })
      }

      if (this.isVideoTaskFailed(result)) {
        throw new Error(`Video generation task failed: ${result.error || result.draft_error || result.status || 'unknown error'}`)
      }

      await this.reportProgress(extra, this.mapVideoProgress(result, attempt), '正在生成视频')
      await this.sleep(5 * 1000)
    }

    throw new Error('Video generation task timed out after 35 minutes while waiting for completion')
  }

  private normalizeModelCapability(
    model: string,
    capability: VideoModelCapability | undefined,
    prices: Record<string, VideoModelPrice>,
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
      first_frame_extend_supported: Boolean(capability?.first_frame_extend_supported),
      first_last_frame_supported: Boolean(capability?.first_last_frame_supported),
      multi_image_reference_supported: Boolean(capability?.multi_image_reference_supported),
      generate_audio_supported: Boolean(capability?.generate_audio_supported),
      seedance_offline_supported: Boolean(capability?.seedance_offline_supported),
      super_resolve_supported: Boolean(capability?.super_resolve_supported),
      gen_durations: Array.isArray(capability?.gen_durations) ? capability.gen_durations : [],
      generation_modes: Array.isArray(capability?.generation_modes)
        ? capability.generation_modes.map((item) => ({
            value: typeof item?.value === 'string' ? item.value : '',
            label: typeof item?.label === 'string' ? item.label : '',
            price_group: typeof item?.price_group === 'string' ? item.price_group : '',
            offline_price_group: typeof item?.offline_price_group === 'string' ? item.offline_price_group : ''
          }))
        : [],
      resolutions: normalizedResolutions
    }

    if (filters.includePrices && prices[model]) {
      normalized.price = prices[model]
    }

    return normalized
  }

  private async getVideoCapabilities(args: Record<string, unknown>) {
    const result = await this.listVideoCapabilities({
      model: typeof args.model === 'string' ? args.model : undefined,
      tier: typeof args.tier === 'string' ? args.tier : undefined,
      ratio: typeof args.ratio === 'string' ? args.ratio : undefined,
      includePrices: typeof args.includePrices === 'boolean' ? args.includePrices : undefined
    })

    return this.formatJsonResult({
      provider: 'vectcut',
      action: 'capabilities',
      ...(result.requestedModel ? { requested_model: result.requestedModel } : {}),
      ...(result.resolvedModel ? { resolved_model: result.resolvedModel } : {}),
      models: result.models
    })
  }

  private async generateVideo(args: Record<string, unknown>, extra?: ToolExecutionExtra) {
    const actionRaw = typeof args.action === 'string' ? args.action.trim().toLowerCase() : ''
    const action = actionRaw || 'submit_and_wait'

    if (action === 'status') {
      const taskId =
        typeof args.taskId === 'string' && args.taskId.trim()
          ? args.taskId.trim()
          : typeof args.task_id === 'string' && args.task_id.trim()
            ? args.task_id.trim()
            : ''

      if (!taskId) {
        throw new McpError(ErrorCode.InvalidParams, "'taskId'/'task_id' is required for video task status queries")
      }
      return this.getVideoTaskStatus(taskId)
    }

    if (action !== 'submit') {
      if (action !== 'submit_and_wait') {
        throw new McpError(ErrorCode.InvalidParams, `Unsupported action: ${action}`)
      }
      return this.submitAndWaitVideoTask(args, extra)
    }

    return this.submitVideoTask(args)
  }
}

export default VideoGenerateServer
