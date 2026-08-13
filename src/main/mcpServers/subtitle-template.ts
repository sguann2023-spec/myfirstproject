import { execFile } from 'node:child_process'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { loggerService } from '@logger'
import { ossUploadService } from '@main/services/OssUploadService'
import { getResourcePath } from '@main/utils'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
import Store from 'electron-store'
import { net } from 'electron'

const logger = loggerService.withContext('MCPServer:SubtitleTemplate')
const execFileAsync = promisify(execFile)
const ffprobeStatic = require('ffprobe-static') as { path?: string }

const API_HOST = 'https://open.vectcut.com'
const SUBTITLE_TEMPLATE_GENERATE_ENDPOINT = '/cut_jianying/generate_smart_subtitle'
const SUBTITLE_TEMPLATE_STATUS_ENDPOINT = '/cut_jianying/smart_subtitle_task_status'
const OAUTH_TOKEN_URL = 'https://mlbd8l6vgi13-demo.authing.cn/oidc/token'
const OAUTH_CLIENT_ID = '6901dd145dafc6f1f3143938'
const OAUTH_CLIENT_SECRET = '16a94e467e927cc09b3c8dc7ec92d420'
const DEFAULT_SUBTITLE_TEMPLATE_AGENT_ID = 'asr_42da310c1e4347ddb2c96dd2a5d055c2'
const FILE_UPLOAD_BUCKET = 'oss-hangzhou-mp4'
const FILE_UPLOAD_REGION = 'oss-cn-hangzhou'
const FILE_UPLOAD_FOLDER_TEMPLATE = 'agent_tmp/{uid}'
const FILE_UPLOAD_OBJECT_KEY_PREFIX = 'vectcut_subtitle_template_'
const FILE_UPLOAD_SIGN_EXPIRES_SECONDS = 60 * 60
const LONG_VIDEO_THRESHOLD_SECONDS = 10 * 60
const FFMPEG_TIMEOUT_MS = 5 * 60 * 1000
const FFPROBE_TIMEOUT_MS = 15 * 1000
const PROCESS_MAX_BUFFER = 1024 * 1024

const SUBTITLE_TEMPLATE_AGENT_IDS = {
  luxury_black_shadow: 'asr_42da310c1e4347ddb2c96dd2a5d055c2',
  postmodern_scroll: 'asr_60348d11a5f54d2a98afb52f6acdb916',
  smoky_song_word_by_word: 'asr_601e98ed739a43b5a310a17e327fbe01',
  yansong_line_scroll: 'asr_9d550677d16a4c879a19bfeee1623a38',
  split_white_yellow: 'asr_f5f42fbfdd9045409c9b783bfdf4ba14',
  centered_white_shadow: 'asr_cdd33f5245e0491889f12fb6c491d1ea',
  bottom_white_shadow: 'asr_ecd4a44d490543b68920724aa0c23813',
  bottom_word_highlight: 'asr_28ac1b65432746129b952e05bc719183',
  hk_traditional_bilingual: 'asr_e8d06597e17c46a8a6d9b5c60a757c26',
  new_youth_double: 'asr_21d0bfcb2fe943d5adcd56bdc26d7c9a',
  new_youth_double_alt: 'sta_5d91f5d3e56d474bbaab2c8f581233f5',
  red_white_bilingual: 'asr_1f9c8d7e6a2b4c0d9e8f123456789abc'
} as const

type SubtitleTemplateKey = keyof typeof SUBTITLE_TEMPLATE_AGENT_IDS

const GENERATE_SMART_SUBTITLE_TOOL: Tool = {
  name: 'generate_smart_subtitle',
  description:
    'Add a subtitle template to an audio or video source, optionally continue editing an existing draft, and create a new VectCut draft with stylized subtitles. Prefer a remotely accessible source URL, typically obtained by running workspace upload first for local files. File URLs and absolute local paths remain supported as a compatibility fallback; local files are uploaded automatically, and local videos longer than 10 minutes are converted to audio before upload.',
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description:
          'Required source audio or video URL. Prefer a remotely accessible URL produced by workspace upload for local files. File URLs and absolute local paths remain supported as a compatibility fallback. Local videos longer than 10 minutes are converted to audio before upload.'
      },
      template: {
        type: 'string',
        enum: Object.keys(SUBTITLE_TEMPLATE_AGENT_IDS),
        description:
          'Optional built-in subtitle template alias. Defaults to luxury_black_shadow when omitted.'
      },
      agentId: {
        type: 'string',
        description:
          'Optional raw subtitle template agent ID. Use this when you already know the exact template ID.'
      },
      draftId: {
        type: 'string',
        description: 'Optional draft ID. When provided, the subtitle template is added onto the existing draft.'
      },
      addMedia: {
        type: 'boolean',
        description: 'Whether to also add the input audio or video into the draft. Defaults to true.'
      },
      textContent: {
        type: 'string',
        description: 'Optional corrected transcript used to calibrate ASR results, recommended for dialects or non-standard speech.'
      }
    },
    required: ['url'],
    additionalProperties: true
  }
}

const GET_SMART_SUBTITLE_TASK_STATUS_TOOL: Tool = {
  name: 'get_smart_subtitle_task_status',
  description: 'Query the status of a subtitle template task by task ID.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'Required task ID returned by generate_smart_subtitle.'
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

type FfprobeStream = {
  codec_type?: string
  duration?: number | string
}

type FfprobeResult = {
  format?: {
    duration?: number | string
  }
  streams?: FfprobeStream[]
}

type PreparedSubtitleTemplateSource = {
  originalInput: string
  submittedUrl: string
  sourceKind: 'remote_url' | 'local_audio' | 'local_video' | 'local_video_audio_extracted'
  extractedAudio: boolean
  durationSeconds?: number | null
}

type SmartSubtitleGenerateResponse = {
  task_id?: string
  [key: string]: unknown
}

type SmartSubtitleStatusResponse = {
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

const isHttpLikeUrl = (value: string) => /^https?:\/\//i.test(value)

const toPositiveNumber = (value: unknown) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null
}

const getProbeDurationSeconds = (probe: FfprobeResult) => {
  const formatDuration = toPositiveNumber(probe.format?.duration)
  if (formatDuration !== null) {
    return formatDuration
  }
  const streamDurations = (probe.streams || [])
    .map((stream) => toPositiveNumber(stream.duration))
    .filter((value): value is number => value !== null)
  return streamDurations.length > 0 ? Math.max(...streamDurations) : null
}

const hasVideoStream = (probe: FfprobeResult) => (probe.streams || []).some((stream) => stream.codec_type === 'video')

const hasAudioStream = (probe: FfprobeResult) => (probe.streams || []).some((stream) => stream.codec_type === 'audio')

const parseJsonFromFfprobe = (rawOutput: string): FfprobeResult => {
  const text = String(rawOutput || '').trim()
  const jsonStart = text.indexOf('{')
  if (jsonStart === -1) {
    throw new Error('ffprobe did not return JSON output')
  }
  return JSON.parse(text.slice(jsonStart)) as FfprobeResult
}

const sanitizeFileName = (value: string) => value.replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '') || 'media'

const getSourceBaseName = (source: string) => sanitizeFileName(path.parse(source).name || 'media')

class SubtitleTemplateServer {
  public mcpServer: McpServer
  private readonly store = new Store({ name: 'vectcut' })
  private accessToken: PendingToken | null = null
  private refreshPromise: Promise<string> | null = null

  constructor() {
    this.mcpServer = new McpServer(
      {
        name: 'subtitle-template',
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
      tools: [GENERATE_SMART_SUBTITLE_TOOL, GET_SMART_SUBTITLE_TASK_STATUS_TOOL]
    }))

    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name
      const args = request.params.arguments ?? {}

      try {
        switch (toolName) {
          case 'generate_smart_subtitle':
            return await this.generateSmartSubtitle(args as Record<string, unknown>)
          case 'get_smart_subtitle_task_status':
            return await this.getSmartSubtitleTaskStatus(args as Record<string, unknown>)
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

  private normalizeSource(value: unknown): string {
    const raw = String(value || '').trim()
    if (!raw) {
      throw new McpError(ErrorCode.InvalidParams, "'url' is required for generate_smart_subtitle")
    }
    if (raw.startsWith('file://')) {
      return fileURLToPath(raw)
    }
    return raw
  }

  private resolveBundledFfmpegPath() {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
    const binaryName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
    const candidate = path.join(getResourcePath(), 'ffmpeg', process.platform, arch, binaryName)
    return fs.existsSync(candidate) ? candidate : null
  }

  private resolveFfprobePath() {
    const executableName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
    const bundled = String((ffprobeStatic as { path?: string } | undefined)?.path || '').trim()
    const unpacked = bundled.replace(/app\.asar([\\/])/g, 'app.asar.unpacked$1')
    const candidates = [bundled, unpacked, 'ffprobe'].filter(Boolean)

    for (const candidate of candidates) {
      if (candidate === 'ffprobe' || fs.existsSync(candidate)) {
        return candidate
      }
    }

    return executableName
  }

  private async probeMedia(source: string) {
    const ffprobePath = this.resolveFfprobePath()
    const { stdout, stderr } = await execFileAsync(
      ffprobePath,
      ['-v', 'error', '-show_entries', 'stream=codec_type,duration:format=duration', '-of', 'json', source],
      {
        windowsHide: true,
        timeout: FFPROBE_TIMEOUT_MS,
        maxBuffer: PROCESS_MAX_BUFFER
      }
    )

    return parseJsonFromFfprobe(`${String(stdout || '')}\n${String(stderr || '')}`)
  }

  private async runFfmpeg(args: string[]) {
    const ffmpegCommand = this.resolveBundledFfmpegPath() || 'ffmpeg'
    await execFileAsync(ffmpegCommand, args, {
      windowsHide: true,
      timeout: FFMPEG_TIMEOUT_MS,
      maxBuffer: PROCESS_MAX_BUFFER
    })
  }

  private async uploadLocalFile(filePath: string, contentType?: string) {
    return ossUploadService.uploadLocalFile(filePath, {
      bucket: FILE_UPLOAD_BUCKET,
      region: FILE_UPLOAD_REGION,
      folder: FILE_UPLOAD_FOLDER_TEMPLATE,
      contentType,
      objectKeyPrefix: FILE_UPLOAD_OBJECT_KEY_PREFIX,
      signExpiresSeconds: FILE_UPLOAD_SIGN_EXPIRES_SECONDS
    })
  }

  private async extractAudioForSubtitleTemplate(source: string): Promise<string> {
    const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'vectcut-subtitle-template-'))
    const outputPath = path.join(tempDir, `${getSourceBaseName(source)}_audio.mp3`)
    await this.runFfmpeg(['-y', '-i', source, '-vn', '-c:a', 'libmp3lame', '-q:a', '2', outputPath])
    return outputPath
  }

  private async prepareSourceForSubmission(input: unknown): Promise<PreparedSubtitleTemplateSource> {
    const normalizedSource = this.normalizeSource(input)
    if (isHttpLikeUrl(normalizedSource)) {
      return {
        originalInput: normalizedSource,
        submittedUrl: normalizedSource,
        sourceKind: 'remote_url',
        extractedAudio: false
      }
    }

    if (!path.isAbsolute(normalizedSource)) {
      throw new McpError(ErrorCode.InvalidParams, "'url' must be a remote URL, file URL, or absolute local path")
    }

    const stats = await fsPromises.stat(normalizedSource)
    if (!stats.isFile()) {
      throw new McpError(ErrorCode.InvalidParams, "'url' must point to a local file when using a local path")
    }

    const probe = await this.probeMedia(normalizedSource)
    const durationSeconds = getProbeDurationSeconds(probe)

    if (hasVideoStream(probe)) {
      if (!hasAudioStream(probe)) {
        throw new McpError(ErrorCode.InvalidParams, 'The local video does not contain an audio stream')
      }

      if (durationSeconds !== null && durationSeconds > LONG_VIDEO_THRESHOLD_SECONDS) {
        const extractedAudioPath = await this.extractAudioForSubtitleTemplate(normalizedSource)
        try {
          const uploaded = await this.uploadLocalFile(extractedAudioPath, 'audio/mpeg')
          return {
            originalInput: normalizedSource,
            submittedUrl: uploaded.signedPublicUrl,
            sourceKind: 'local_video_audio_extracted',
            extractedAudio: true,
            durationSeconds
          }
        } finally {
          await fsPromises.unlink(extractedAudioPath).catch(() => undefined)
        }
      }

      const uploaded = await this.uploadLocalFile(normalizedSource)
      return {
        originalInput: normalizedSource,
        submittedUrl: uploaded.signedPublicUrl,
        sourceKind: 'local_video',
        extractedAudio: false,
        durationSeconds
      }
    }

    if (!hasAudioStream(probe)) {
      throw new McpError(ErrorCode.InvalidParams, 'The local file is not a supported audio or video media file')
    }

    const uploaded = await this.uploadLocalFile(normalizedSource)
    return {
      originalInput: normalizedSource,
      submittedUrl: uploaded.signedPublicUrl,
      sourceKind: 'local_audio',
      extractedAudio: false,
      durationSeconds
    }
  }

  private resolveAgentId(template?: string, agentId?: string): { agentId: string; template: string } {
    const normalizedTemplate = typeof template === 'string' ? template.trim() : ''
    const rawAgentId = typeof agentId === 'string' ? agentId.trim() : ''

    if (normalizedTemplate) {
      if (!(normalizedTemplate in SUBTITLE_TEMPLATE_AGENT_IDS)) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Unknown subtitle template '${normalizedTemplate}'. Supported templates: ${Object.keys(SUBTITLE_TEMPLATE_AGENT_IDS).join(', ')}`
        )
      }

      return {
        agentId: SUBTITLE_TEMPLATE_AGENT_IDS[normalizedTemplate as SubtitleTemplateKey],
        template: normalizedTemplate
      }
    }

    if (rawAgentId) {
      return {
        agentId: rawAgentId,
        template: 'custom'
      }
    }

    return {
      agentId: DEFAULT_SUBTITLE_TEMPLATE_AGENT_ID,
      template: 'luxury_black_shadow'
    }
  }

  private buildGeneratePayload(args: Record<string, unknown>, preparedSource: PreparedSubtitleTemplateSource) {
    const resolved = this.resolveAgentId(
      typeof args.template === 'string' ? args.template : undefined,
      typeof args.agentId === 'string' ? args.agentId : undefined
    )

    const payload: Record<string, unknown> = {
      agent_id: resolved.agentId,
      url: preparedSource.submittedUrl
    }

    if (typeof args.draftId === 'string' && args.draftId.trim()) {
      payload.draft_id = args.draftId.trim()
    }

    if (typeof args.addMedia === 'boolean') {
      payload.add_media = args.addMedia
    }

    if (typeof args.textContent === 'string' && args.textContent.trim()) {
      payload.text_content = args.textContent.trim()
    }

    return {
      payload,
      template: resolved.template
    }
  }

  private async generateSmartSubtitle(args: Record<string, unknown>) {
    const preparedSource = await this.prepareSourceForSubmission(args.url)
    const { payload, template } = this.buildGeneratePayload(args, preparedSource)
    const response = await this.requestWithAuth(SUBTITLE_TEMPLATE_GENERATE_ENDPOINT, {
      method: 'POST',
      body: payload
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Subtitle template generation failed (${response.status}): ${body || 'unknown error'}`)
    }

    const result = (await response.json()) as SmartSubtitleGenerateResponse

    logger.info('Subtitle template task submitted', {
      template,
      taskId: result.task_id
    })

    return this.formatJsonResult({
      provider: 'vectcut',
      action: 'submit',
      mode: 'subtitle_template',
      template,
      agent_id: payload.agent_id,
      source_kind: preparedSource.sourceKind,
      source_url: preparedSource.submittedUrl,
      original_input: preparedSource.originalInput,
      extracted_audio: preparedSource.extractedAudio,
      duration_seconds: preparedSource.durationSeconds ?? undefined,
      draft_id: payload.draft_id,
      task_id: result.task_id
    })
  }

  private async getSmartSubtitleTaskStatus(args: Record<string, unknown>) {
    const taskId = typeof args.taskId === 'string' ? args.taskId.trim() : ''
    if (!taskId) {
      throw new McpError(ErrorCode.InvalidParams, "'taskId' is required for get_smart_subtitle_task_status")
    }

    const response = await this.requestWithAuth(SUBTITLE_TEMPLATE_STATUS_ENDPOINT, {
      method: 'GET',
      query: new URLSearchParams({ task_id: taskId })
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Subtitle template status query failed (${response.status}): ${body || 'unknown error'}`)
    }

    const result = (await response.json()) as SmartSubtitleStatusResponse

    logger.info('Subtitle template task status queried', {
      taskId,
      status: result.status,
      success: result.success
    })

    return this.formatJsonResult({
      provider: 'vectcut',
      action: 'status',
      mode: 'subtitle_template',
      ...result
    })
  }
}

export default SubtitleTemplateServer
