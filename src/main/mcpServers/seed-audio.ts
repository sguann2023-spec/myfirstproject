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

const logger = loggerService.withContext('MCPServer:SeedAudio')

const API_HOST = 'https://open.vectcut.com'
const SEED_AUDIO_GENERATE_ENDPOINT = '/llm/tts/seed_audio/generate'
const OAUTH_TOKEN_URL = 'https://mlbd8l6vgi13-demo.authing.cn/oidc/token'
const OAUTH_CLIENT_ID = '6901dd145dafc6f1f3143938'
const OAUTH_CLIENT_SECRET = '16a94e467e927cc09b3c8dc7ec92d420'
const DEFAULT_SEED_AUDIO_MODEL = 'seed-audio-1.0'

// 根据火山方舟 seed-audio 文档约束：
// - 参考音频最多 3 条，单条 ≤ 10MB，支持 wav/mp3/pcm/ogg_opus
// - 参考图片最多 1 张，≤ 10MB，支持 jpeg/png/webp
// - 图片参考与音频参考互斥
const MAX_AUDIO_REFERENCES = 3
const MAX_AUDIO_REFERENCE_BYTES = 10 * 1024 * 1024
const SUPPORTED_AUDIO_EXTENSIONS = new Set(['wav', 'mp3', 'pcm', 'ogg', 'ogg_opus', 'opus'])
const SUPPORTED_AUDIO_MIME = new Set([
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/mpeg',
  'audio/mp3',
  'audio/ogg',
  'audio/opus',
  'audio/pcm',
  'audio/basic'
])

const MAX_IMAGE_REFERENCES = 1
const MAX_IMAGE_REFERENCE_BYTES = 10 * 1024 * 1024
const SUPPORTED_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp'])
const SUPPORTED_IMAGE_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp'])

const FILE_UPLOAD_BUCKET = 'oss-hangzhou-mp4'
const FILE_UPLOAD_REGION = 'oss-cn-hangzhou'
const FILE_UPLOAD_FOLDER_TEMPLATE = 'agent_tmp/{uid}'
const FILE_UPLOAD_AUDIO_PREFIX = 'vectcut_seed_audio_reference_'
const FILE_UPLOAD_IMAGE_PREFIX = 'vectcut_seed_audio_image_reference_'
const FILE_UPLOAD_SIGN_EXPIRES_SECONDS = 60 * 60

const GENERATE_SEED_AUDIO_TOOL: Tool = {
  name: 'generate_seed_audio',
  description:
    'Generate rich audio with Doubao seed-audio from a creative prompt instead of plain TTS. Use this for prompt-based audio generation with optional speaker, reference audio, reference image, background music, sound effects, or multi-speaker style control. Reference audio and image inputs accept remote URLs, file:// URLs, or absolute local paths; local files are uploaded internally before submission. Constraints: up to 3 audio references (<=10MB each, wav/mp3/pcm/ogg_opus); up to 1 image reference (<=10MB, jpeg/png/webp); image and audio references are mutually exclusive.',
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
        description: 'Optional voice or speaker ID. Mutually exclusive with audio_url / audio_data.'
      },
      voice_id: {
        type: 'string',
        description: 'Alias of voiceId.'
      },
      speaker: {
        type: 'string',
        description: 'Optional speaker descriptor. Mutually exclusive with audio_url / audio_data.'
      },
      referenceAudios: {
        type: 'array',
        description:
          'Optional reference audio inputs (<=3 items, <=10MB each, wav/mp3/pcm/ogg_opus). Remote URLs, file:// URLs, and absolute local paths are all accepted. Local files are uploaded internally before submission.',
        items: {
          type: 'string'
        }
      },
      reference_audios: {
        type: 'array',
        description: 'Alias of referenceAudios.',
        items: {
          type: 'string'
        }
      },
      audioUrl: {
        type: 'string',
        description:
          'Optional single reference audio URL, file:// URL, or absolute local path. Local files are uploaded internally. Convenience field equivalent to referenceAudios with one item.'
      },
      audio_url: {
        type: 'string',
        description: 'Alias of audioUrl.'
      },
      audioData: {
        type: 'string',
        description: 'Optional base64-encoded reference audio data (<=10MB).'
      },
      audio_data: {
        type: 'string',
        description: 'Alias of audioData.'
      },
      referenceImage: {
        type: 'string',
        description:
          'Optional reference image URL, file:// URL, or absolute local path (<=10MB, jpeg/png/webp). Local files are uploaded internally. Cannot be used together with audio references or speaker.'
      },
      reference_image: {
        type: 'string',
        description: 'Alias of referenceImage.'
      },
      imageUrl: {
        type: 'string',
        description:
          'Optional reference image URL (deprecated alias of referenceImage; local paths also supported and uploaded internally).'
      },
      image_url: {
        type: 'string',
        description: 'Alias of imageUrl.'
      },
      imageData: {
        type: 'string',
        description: 'Optional base64-encoded reference image data (<=10MB, jpeg/png/webp).'
      },
      image_data: {
        type: 'string',
        description: 'Alias of imageData.'
      },
      audioConfig: {
        type: 'object',
        description: 'Optional audio output configuration such as format, sample rate, or speech rate.'
      },
      audio_config: {
        type: 'object',
        description: 'Alias of audioConfig.'
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

const DATA_URL_PATTERN = /^data:([^;,]+)?;base64,(.+)$/i
const isHttpLikeUrl = (value: string) => /^https?:\/\//i.test(value)

const parseBase64DataUrl = (value: string): { mediaType: string; data: string } | null => {
  const normalized = String(value || '').trim()
  const match = normalized.match(DATA_URL_PATTERN)
  if (!match) return null
  return {
    mediaType: String(match[1] || '').trim(),
    data: String(match[2] || '').trim()
  }
}

const getFileExtensionFromName = (source: string): string => {
  const normalized = String(source || '').trim().toLowerCase()
  if (!normalized) return ''
  const cleaned = normalized.split('?')[0].split('#')[0]
  const idx = cleaned.lastIndexOf('.')
  if (idx < 0 || idx === cleaned.length - 1) return ''
  return cleaned.slice(idx + 1)
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

  private normalizeLocalPath(input: string, fieldName: string): string {
    const raw = String(input || '').trim()
    if (!raw) {
      throw new McpError(ErrorCode.InvalidParams, `'${fieldName}' contains an empty reference`)
    }
    if (raw.startsWith('file://')) {
      return fileURLToPath(raw)
    }
    return raw
  }

  private validateAudioExtension(filePath: string, fieldName: string) {
    const ext = getFileExtensionFromName(filePath)
    if (!ext || !SUPPORTED_AUDIO_EXTENSIONS.has(ext)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `'${fieldName}' only supports wav/mp3/pcm/ogg_opus (got: ${ext || 'unknown'})`
      )
    }
  }

  private validateImageExtension(filePath: string, fieldName: string) {
    const ext = getFileExtensionFromName(filePath)
    if (!ext || !SUPPORTED_IMAGE_EXTENSIONS.has(ext)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `'${fieldName}' only supports jpeg/png/webp (got: ${ext || 'unknown'})`
      )
    }
  }

  private validateAudioMimeType(mimeType: string, fieldName: string) {
    const normalized = String(mimeType || '').trim().toLowerCase()
    if (!normalized) return
    if (!SUPPORTED_AUDIO_MIME.has(normalized) && !normalized.startsWith('audio/')) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `'${fieldName}' only supports wav/mp3/pcm/ogg_opus (got MIME: ${normalized})`
      )
    }
  }

  private validateImageMimeType(mimeType: string, fieldName: string) {
    const normalized = String(mimeType || '').trim().toLowerCase()
    if (!normalized) return
    if (!SUPPORTED_IMAGE_MIME.has(normalized)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `'${fieldName}' only supports jpeg/png/webp (got MIME: ${normalized})`
      )
    }
  }

  private async prepareAudioReferenceUrl(input: unknown, fieldName: string): Promise<string> {
    const normalizedSource = this.normalizeLocalPath(String(input || ''), fieldName)
    const parsedDataUrl = parseBase64DataUrl(normalizedSource)

    if (parsedDataUrl) {
      this.validateAudioMimeType(parsedDataUrl.mediaType, fieldName)
      const buffer = Buffer.from(parsedDataUrl.data, 'base64')
      if (buffer.length > MAX_AUDIO_REFERENCE_BYTES) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `'${fieldName}' exceeds 10MB limit (got ${buffer.length} bytes)`
        )
      }
      const uploaded = await ossUploadService.uploadImageBase64(parsedDataUrl.data, parsedDataUrl.mediaType)
      return uploaded.publicUrl
    }

    if (isHttpLikeUrl(normalizedSource)) {
      return normalizedSource
    }

    if (!path.isAbsolute(normalizedSource)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `'${fieldName}' must be a remote URL, file:// URL, or absolute local path`
      )
    }

    this.validateAudioExtension(normalizedSource, fieldName)
    const stats = await fsStat(normalizedSource)
    if (!stats.isFile()) {
      throw new McpError(ErrorCode.InvalidParams, `'${fieldName}' must point to a local file`)
    }
    if (stats.size > MAX_AUDIO_REFERENCE_BYTES) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `'${fieldName}' exceeds 10MB limit (got ${stats.size} bytes)`
      )
    }

    const uploaded = await ossUploadService.uploadLocalFile(normalizedSource, {
      bucket: FILE_UPLOAD_BUCKET,
      region: FILE_UPLOAD_REGION,
      folder: FILE_UPLOAD_FOLDER_TEMPLATE,
      objectKeyPrefix: FILE_UPLOAD_AUDIO_PREFIX,
      signExpiresSeconds: FILE_UPLOAD_SIGN_EXPIRES_SECONDS
    })
    return uploaded.signedPublicUrl
  }

  private async prepareImageReferenceUrl(input: unknown, fieldName: string): Promise<string> {
    const normalizedSource = this.normalizeLocalPath(String(input || ''), fieldName)
    const parsedDataUrl = parseBase64DataUrl(normalizedSource)

    if (parsedDataUrl) {
      this.validateImageMimeType(parsedDataUrl.mediaType, fieldName)
      const buffer = Buffer.from(parsedDataUrl.data, 'base64')
      if (buffer.length > MAX_IMAGE_REFERENCE_BYTES) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `'${fieldName}' exceeds 10MB limit (got ${buffer.length} bytes)`
        )
      }
      const uploaded = await ossUploadService.uploadImageBase64(parsedDataUrl.data, parsedDataUrl.mediaType)
      return uploaded.publicUrl
    }

    if (isHttpLikeUrl(normalizedSource)) {
      return normalizedSource
    }

    if (!path.isAbsolute(normalizedSource)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `'${fieldName}' must be a remote URL, file:// URL, or absolute local path`
      )
    }

    this.validateImageExtension(normalizedSource, fieldName)
    const stats = await fsStat(normalizedSource)
    if (!stats.isFile()) {
      throw new McpError(ErrorCode.InvalidParams, `'${fieldName}' must point to a local file`)
    }
    if (stats.size > MAX_IMAGE_REFERENCE_BYTES) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `'${fieldName}' exceeds 10MB limit (got ${stats.size} bytes)`
      )
    }

    const uploaded = await ossUploadService.uploadLocalFile(normalizedSource, {
      bucket: FILE_UPLOAD_BUCKET,
      region: FILE_UPLOAD_REGION,
      folder: FILE_UPLOAD_FOLDER_TEMPLATE,
      objectKeyPrefix: FILE_UPLOAD_IMAGE_PREFIX,
      signExpiresSeconds: FILE_UPLOAD_SIGN_EXPIRES_SECONDS
    })
    return uploaded.signedPublicUrl
  }

  private async validateAudioDataField(value: unknown, fieldName: string): Promise<string> {
    const raw = String(value || '').trim()
    if (!raw) {
      throw new McpError(ErrorCode.InvalidParams, `'${fieldName}' is empty`)
    }
    const parsed = parseBase64DataUrl(raw)
    const base64 = parsed ? parsed.data : raw
    if (parsed) {
      this.validateAudioMimeType(parsed.mediaType, fieldName)
    }
    const buffer = Buffer.from(base64, 'base64')
    if (buffer.length === 0) {
      throw new McpError(ErrorCode.InvalidParams, `'${fieldName}' is not valid base64 audio data`)
    }
    if (buffer.length > MAX_AUDIO_REFERENCE_BYTES) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `'${fieldName}' exceeds 10MB limit (got ${buffer.length} bytes)`
      )
    }
    return base64
  }

  private async validateImageDataField(value: unknown, fieldName: string): Promise<string> {
    const raw = String(value || '').trim()
    if (!raw) {
      throw new McpError(ErrorCode.InvalidParams, `'${fieldName}' is empty`)
    }
    const parsed = parseBase64DataUrl(raw)
    const base64 = parsed ? parsed.data : raw
    if (parsed) {
      this.validateImageMimeType(parsed.mediaType, fieldName)
    }
    const buffer = Buffer.from(base64, 'base64')
    if (buffer.length === 0) {
      throw new McpError(ErrorCode.InvalidParams, `'${fieldName}' is not valid base64 image data`)
    }
    if (buffer.length > MAX_IMAGE_REFERENCE_BYTES) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `'${fieldName}' exceeds 10MB limit (got ${buffer.length} bytes)`
      )
    }
    return base64
  }

  private async buildSeedAudioPayload(args: Record<string, unknown>) {
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
      // 收集参考资源相关字段，稍后统一处理
      if (
        rawKey === 'referenceAudios' ||
        rawKey === 'reference_audios' ||
        rawKey === 'referenceImage' ||
        rawKey === 'reference_image'
      ) {
        continue
      }
      const key = SEED_AUDIO_FIELD_ALIASES[rawKey] ?? rawKey
      payload[key] = value
    }

    payload.text_prompt = prompt
    payload.model =
      typeof payload.model === 'string' && String(payload.model).trim()
        ? String(payload.model).trim()
        : DEFAULT_SEED_AUDIO_MODEL

    // 聚合音频参考输入：audioUrl / audio_url / referenceAudios / reference_audios
    const audioInputs: string[] = []
    const pushAudioInput = (value: unknown) => {
      if (Array.isArray(value)) {
        value.forEach((item) => {
          if (typeof item === 'string' && item.trim()) audioInputs.push(item.trim())
        })
      } else if (typeof value === 'string' && value.trim()) {
        audioInputs.push(value.trim())
      }
    }
    pushAudioInput(args.referenceAudios)
    pushAudioInput(args.reference_audios)
    // audio_url 已经在 payload 里，取出后由数组统一控制
    if (typeof payload.audio_url === 'string' && payload.audio_url.trim()) {
      audioInputs.push(payload.audio_url.trim())
    }
    delete payload.audio_url

    // 聚合图片参考输入
    const imageInputs: string[] = []
    if (typeof args.referenceImage === 'string' && args.referenceImage.trim()) {
      imageInputs.push(args.referenceImage.trim())
    }
    if (typeof args.reference_image === 'string' && args.reference_image.trim()) {
      imageInputs.push(args.reference_image.trim())
    }
    if (typeof payload.image_url === 'string' && payload.image_url.trim()) {
      imageInputs.push(payload.image_url.trim())
    }
    delete payload.image_url

    // 图片与音频参考互斥；speaker/voice_id 与 audio 互斥
    const hasImageInput = imageInputs.length > 0 || Boolean(payload.image_data)
    const hasAudioInput = audioInputs.length > 0 || Boolean(payload.audio_data)
    const hasSpeaker =
      Boolean(payload.speaker && String(payload.speaker).trim()) ||
      Boolean(payload.voice_id && String(payload.voice_id).trim())

    if (hasImageInput && hasAudioInput) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Reference image and reference audio cannot be used together per seed-audio API'
      )
    }
    if (hasImageInput && hasSpeaker) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Reference image cannot be used together with speaker/voice_id per seed-audio API'
      )
    }

    // 数量约束
    if (audioInputs.length > MAX_AUDIO_REFERENCES) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `At most ${MAX_AUDIO_REFERENCES} reference audio items are allowed (got ${audioInputs.length})`
      )
    }
    if (imageInputs.length > MAX_IMAGE_REFERENCES) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `At most ${MAX_IMAGE_REFERENCES} reference image is allowed (got ${imageInputs.length})`
      )
    }

    // 校验 base64 字段大小与格式
    if (typeof payload.audio_data === 'string' && payload.audio_data) {
      payload.audio_data = await this.validateAudioDataField(payload.audio_data, 'audio_data')
    }
    if (typeof payload.image_data === 'string' && payload.image_data) {
      payload.image_data = await this.validateImageDataField(payload.image_data, 'image_data')
    }

    // 上传并解析远程 URL（本地文件 -> OSS，远程 URL -> 原样）
    const resolvedAudioUrls = await Promise.all(
      audioInputs.map((item, idx) => this.prepareAudioReferenceUrl(item, `reference_audio[${idx}]`))
    )
    const resolvedImageUrls = await Promise.all(
      imageInputs.map((item, idx) => this.prepareImageReferenceUrl(item, `reference_image[${idx}]`))
    )

    // 构造 references 数组（文档约定：参考资源列表，顺序对应 text_prompt 中 @音频N）
    const references: Array<Record<string, unknown>> = []
    resolvedAudioUrls.forEach((url) => {
      references.push({ type: 'audio', audio_url: url })
    })
    resolvedImageUrls.forEach((url) => {
      references.push({ type: 'image', image_url: url })
    })

    if (references.length > 0) {
      payload.references = references
      // 同时填充单值字段以兼容仅支持 audio_url / image_url 的后端
      if (resolvedAudioUrls.length > 0) {
        payload.audio_url = resolvedAudioUrls[0]
      }
      if (resolvedImageUrls.length > 0) {
        payload.image_url = resolvedImageUrls[0]
      }
    }

    return {
      payload,
      resolvedAudioUrls,
      resolvedImageUrls
    }
  }

  private async generateSeedAudio(args: Record<string, unknown>) {
    const { payload, resolvedAudioUrls, resolvedImageUrls } = await this.buildSeedAudioPayload(args)
    const response = await this.requestWithAuth(payload)

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Seed audio generation failed (${response.status}): ${body || 'unknown error'}`)
    }

    const result = (await response.json()) as SeedAudioGenerateResponse

    logger.info('Seed audio generation completed', {
      model: payload.model,
      success: result.success,
      durationSeconds: result.duration_seconds,
      audioReferenceCount: resolvedAudioUrls.length,
      imageReferenceCount: resolvedImageUrls.length
    })

    return this.formatJsonResult({
      provider: 'vectcut',
      action: 'generate_seed_audio',
      request: {
        model: payload.model,
        prompt: payload.text_prompt,
        voice_id: payload.voice_id,
        speaker: payload.speaker,
        reference_audios: resolvedAudioUrls,
        reference_images: resolvedImageUrls
      },
      ...result
    })
  }

  // Keep for backwards compatibility with any existing readFile users.
}

export default SeedAudioServer
