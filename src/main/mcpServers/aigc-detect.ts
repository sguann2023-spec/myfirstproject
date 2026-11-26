import { SOCIAL_MEDIA_SOURCE_ROUTING } from './social-media-source-routing'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { loggerService } from '@logger'
import { getResourcePath } from '@main/utils'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
import { getVectcutStore } from './vectcut-store'
import { net } from 'electron'

const logger = loggerService.withContext('MCPServer:AigcDetect')
const execFileAsync = promisify(execFile)
const ffprobeStatic = require('ffprobe-static') as { path?: string }

const API_HOST = 'https://open.vectcut.com'
const TFS_IMAGE_DETECT_ENDPOINT = '/tfs/image/detect'
const OAUTH_TOKEN_URL = 'https://mlbd8l6vgi13-demo.authing.cn/oidc/token'
const OAUTH_CLIENT_ID = '6901dd145dafc6f1f3143938'
const OAUTH_CLIENT_SECRET = '16a94e467e927cc09b3c8dc7ec92d420'

const MAX_VIDEO_DURATION_SECONDS = 600
const DEFAULT_VIDEO_PRECHECK_SECONDS = 5
const DEFAULT_VIDEO_FPS = 1
const MAX_CONCURRENT_IMAGE_DETECTS = 3

const FFMPEG_TIMEOUT_MS = 15 * 60 * 1000
const FFPROBE_TIMEOUT_MS = 15 * 1000
const PROCESS_MAX_BUFFER = 4 * 1024 * 1024
const VIDEO_DETECT_IMAGE_TIMEOUT_MS = 30_000
const VIDEO_DETECT_BASE64_TIMEOUT_MS = 45_000
const AUTH_EXPIRED_MESSAGE = '登录已过期，请重新登录后再试'

const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const IMAGE_MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif'
}

const isHttpLikeUrl = (value: string) => /^https?:\/\//i.test(value)
const toErrorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** 命中任意这些 label 就视为 AI */
const AI_LABELS = new Set([
  'aigc',
  'risk_aigc',
  'risk_edit',
  'risk_fake'
])

const DETECT_AIGC_IMAGE_TOOL: Tool = {
  name: 'detect_aigc_image',
  description: [
    'Detect whether an image is AI-generated / AI-synthesized / AI-edited / AI-faked (AIGC verification).',
    'Accepts a public image URL, a local absolute file path, a file:// URL, or base64 (data:image/*;base64,... or plain base64).',
    'Consumes 3 points per call. Detection failure (e.g. upstream timeout) may still incur charges; do not auto-retry.',
    'Use THIS tool instead of image-understand/inspect_image when the user asks about AI origin, authenticity, forgery, or AIGC traces of an image. image-understand answers "what is in the image"; THIS tool answers "was this image made by AI". Even if you can see the image yourself, AI-authenticity questions must be answered from this tool result, not from your own visual guess.',
    'This tool MUST be triggered when the user asks any of the following (Chinese or English):',
    '  Chinese: "这张图是不是 AI 生成的" / "是不是 AI 画的" / "AI 生成的吗" / "AI 合成的吗" / "帮我看看这张图是 AI 画的还是实拍" / "有没有 AI 痕迹" / "检测/鉴别这张图片是否 AI 生成" / "判断真伪" / "鉴定真伪" / "这张图有没有 AI 生成标识/水印元数据"',
    '  Chinese keywords to watch for: AI生成 | AI合成 | AI做的 | AI痕迹 | 实拍还是AI | 鉴别 | 鉴定真伪 | AI标识 | AI生成标识',
    '  English: "is this image AI" / "is this image AI-generated" / "is this image real or AI" / "check if this image is AI" / "verify if this image is AI-generated" / "AI fake?" / "forgery check"',
    '  Any image attached together with "is it AI" / "AI generated?"',
    'Returns the FULL unmodified API payload: code, message, is_ai(bool) + label + confidence(%) + risk_level + service + data_id + request_id + image_url + results[](label/confidence/risk_level/description) + aigc_data + billing; no field is trimmed.'
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      image_url: {
        type: 'string',
        description:
          '公网可访问的图片地址，仅支持 http:// 或 https://，长度不超过 2048。本地图片请用 image 传路径。'
      },
      image: {
        type: 'string',
        description:
          '本地图片。推荐直接传本地绝对路径、file:// URL 或相对工作区路径（工具内部读取并转 base64 后再请求服务端）；也可传 base64（data:image/png;base64,... 或纯 base64）。图片不超过 20MB。与 image_url 二选一。'
      }
    },
    additionalProperties: true
  }
}

const DETECT_AIGC_VIDEO_TOOL: Tool = {
  name: 'detect_aigc_video',
  description: [
    SOCIAL_MEDIA_SOURCE_ROUTING,
    'Locate segments within a video that are suspected to be AI-generated / AI-synthesized / AI-created (AIGC video verification).',
    'Pipeline: local ffmpeg frame extraction (default 1fps, default first 5 seconds only) → per-frame AIGC detection → consecutive AI-hit frames merged into time ranges.',
    'Billing: 3 points per frame; default precheck of 5 seconds ≈ 5 frames ≈ 15 points; expand range by passing explicit end_sec (or 0 for full-scan). Hard cap 600 seconds.',
    'Use THIS tool instead of video-understand when the user asks about AI generation / AI authenticity / AI segments / AIGC traces of a video.',
    'video-understand answers "what happens in this video"; THIS tool answers "which parts of this video were made by AI".',
    'When the user asks BOTH (e.g. "analyze this video AND tell me which parts are AI"), do both in sequence: first call THIS tool for AI verification, then call video-understand for content analysis.',
    'This tool MUST be triggered when the user asks any of the following (Chinese or English):',
    '  Chinese: "这个视频是不是 AI 生成的" / "检测视频里哪些片段是 AI 生成的" / "哪些片段是 AI" / "帮我定位视频里 AI 做的那几秒" / "哪段是 AI" / "这条视频是实拍还是 AI 合成" / "实拍还是 AI" / "鉴别这个视频有没有 AI 痕迹" / "鉴别真伪" / "检测视频第 X 秒到第 Y 秒是不是 AI" / "视频里混了 AI 片段，帮我找出来" / "视频 AI 做的" / "前30秒哪些时间是AI生成" / "哪些时间是 AI"',
    '  Chinese keywords to watch for: AI生成 | AI合成 | AI做的 | AI痕迹 | 哪些片段是AI | 实拍还是AI | 鉴别 | 鉴定真伪 | AI标识',
    '  English: "is this video AI" / "is this video AI-generated" / "is this video real or AI" / "which parts of this video are AI" / "find the AI parts in this video" / "locate AI segments" / "check if this clip is AI" / "which time range is AI"',
    '  Any video attached together with "is it AI" / "which part is AI" / "which time is AI"',
    'Returns: is_ai(bool, authoritative; true if any frame is AI-suspected) + aigc_segments[] (start_sec / end_sec / is_ai / label / confidence / risk_level / hit_labels) + frames[] (timestamp / is_ai / confidence / risk_level) + hit_labels[] + verdict (pure_real|mixed|mostly_ai|pure_ai) + billing.',
    'Label semantics: risk_aigc = AI-generated, risk_edit = AI-edited, risk_fake = forged. All three count as is_ai=true per the TFS API — do not downgrade risk_edit/risk_fake to "not AI".'
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      videoUrl: {
        type: 'string',
        description: 'Resolved direct-media URL, file URL, absolute local path, or workspace-relative media path.'
      },
      video_url: {
        type: 'string',
        description: 'Alias of videoUrl.'
      },
      fps: {
        type: 'number',
        description: `Optional frame sampling rate. Defaults to ${DEFAULT_VIDEO_FPS}.`
      },
      start_sec: {
        type: 'number',
        description: 'Optional detection window start (seconds). Default 0.'
      },
      end_sec: {
        type: 'number',
        description: 'Optional detection window end (seconds). Defaults to start_sec + 5 (precheck). Pass 0 after start_sec to scan whole video.'
      }
    },
    additionalProperties: true
  }
}

type PendingToken = {
  accessToken: string
  expiresAt: number
}

type TfsImageDetectResult = {
  code: number
  message: string
  data: {
    is_ai?: boolean
    label?: string
    confidence?: number
    risk_level?: string
    service?: string
    data_id?: string
    request_id?: string
    image_url?: string
    results?: Array<{
      label: string
      confidence: number
      risk_level: string
      description?: string
    }>
    aigc_data?: unknown
  } | null
  billing?: { consume?: number }
}

type VideoFrameSample = {
  index: number
  timestamp: number
  filePath: string
}

type AigcSegment = {
  start_sec: number
  end_sec: number
  /** 以接口 is_ai 为准：命中任一非 ugc/nonLabel/normal 标签即为 true */
  is_ai: boolean
  label: string
  confidence: number
  risk_level: string
  /** 该段内各帧命中的全部标签（去重） */
  hit_labels: string[]
}

type FrameDetectRecord = {
  timestamp: number
  is_ai: boolean
  label?: string
  confidence?: number
  risk_level?: string
  hit_labels?: string[]
  consume?: number
  error?: string
}

export default class AigcDetectServer {
  public mcpServer: McpServer
  private get store() {
    return getVectcutStore()
  }
  private readonly workspacePath?: string
  private accessToken: PendingToken | null = null
  private refreshPromise: Promise<string> | null = null

  constructor(workspacePath?: string) {
    this.workspacePath = workspacePath
    this.mcpServer = this.createMcpServer()
  }

  public createMcpServer(): McpServer {
    const mcpServer = new McpServer(
      { name: 'aigc-detect', version: '1.0.0' },
      { capabilities: { tools: {} } }
    )
    this.setupHandlers(mcpServer)
    return mcpServer
  }

  private setupHandlers(mcpServer: McpServer) {
    mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [DETECT_AIGC_IMAGE_TOOL, DETECT_AIGC_VIDEO_TOOL]
    }))

    mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name
      const args = request.params.arguments ?? {}

      try {
        switch (toolName) {
          case 'detect_aigc_image':
            return this.formatJsonResult(await this.detectAigcImage(args as Record<string, unknown>))
          case 'detect_aigc_video':
            return this.formatJsonResult(await this.detectAigcVideo(args as Record<string, unknown>))
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

  // ==================== 鉴权 ====================

  private async ensureValidAccessToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.accessToken && Date.now() < this.accessToken.expiresAt - 30_000) {
      return this.accessToken.accessToken
    }
    if (!forceRefresh && this.refreshPromise) {
      return this.refreshPromise
    }

    const refreshToken = String(this.store.get('auth.refresh_token') || '').trim()
    if (!refreshToken) throw new Error('No refresh token found, please sign in first')

    this.refreshPromise = this.refreshAccessToken(refreshToken)
    try {
      return await this.refreshPromise
    } finally {
      this.refreshPromise = null
    }
  }

  private getCachedVectcutApiKey(): string {
    return String(this.store.get('auth.vectcut_api_key') || process.env.VECTCUT_API_KEY || process.env.VECTCUT_APIKEY || '').trim()
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
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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
    if (!accessToken) throw new Error('Token refresh returned no access token')

    const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : 3600
    this.accessToken = { accessToken, expiresAt: Date.now() + expiresIn * 1000 }

    if (typeof payload.refresh_token === 'string' && payload.refresh_token.trim()) {
      this.store.set('auth.refresh_token', payload.refresh_token.trim())
    }

    return accessToken
  }

  private toFriendlyAuthError(error: unknown): Error {
    const message = toErrorMessage(error).toLowerCase()
    if (message.includes('invalid_grant') || message.includes('refresh token') || message.includes('no refresh token found')) {
      return new Error(AUTH_EXPIRED_MESSAGE)
    }
    return error instanceof Error ? error : new Error(toErrorMessage(error))
  }

  private async detectImageWithAuth(
    payload: Record<string, unknown>,
    timeoutMs: number
  ): Promise<TfsImageDetectResult> {
    const url = `${API_HOST}${TFS_IMAGE_DETECT_ENDPOINT}`

    const doFetch = async (accessToken: string, signal?: AbortSignal): Promise<Response> => {
      return net.fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal
      } as any)
    }

    let token: string
    try {
      token = await this.ensureValidAccessToken()
    } catch (error) {
      const cachedToken = this.getCachedVectcutApiKey()
      if (!cachedToken) throw this.toFriendlyAuthError(error)
      logger.warn('AIGC detect auth refresh failed, falling back to cached vectcut api key', { error: toErrorMessage(error) })
      token = cachedToken
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    let response: Response
    try {
      response = await doFetch(token, controller.signal)
      if (response.status === 401) {
        try {
          const refreshed = await this.ensureValidAccessToken(true)
          response = await doFetch(refreshed)
          if (response.status === 401) throw new Error(AUTH_EXPIRED_MESSAGE)
        } catch (inner) {
          throw this.toFriendlyAuthError(inner)
        }
      }
    } finally {
      clearTimeout(timer)
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`AIGC detect request failed (${response.status}): ${text || 'unknown error'}`)
    }

    return (await response.json()) as TfsImageDetectResult
  }

  // ==================== 图片检测 ====================

  /**
   * 本地图片（file:// / 绝对路径 / 相对 workspace 的路径）转 base64 data URL。
   * 非本地路径（公网 URL / 纯 base64）返回 null，交由原有逻辑处理。
   * 注意：TFS 接口只接受公网 image_url 或 base64 image，本地路径必须在本地转码后才会发出去。
   */
  private async resolveLocalImageToDataUrl(raw: string): Promise<{ dataUrl: string; filePath: string } | null> {
    const candidates: string[] = []
    if (raw.startsWith('file://')) {
      try {
        candidates.push(fileURLToPath(raw))
      } catch {
        return null
      }
    } else if (raw.startsWith('~/')) {
      candidates.push(path.join(os.homedir(), raw.slice(2)))
    } else if (path.isAbsolute(raw)) {
      candidates.push(raw)
    } else if (this.workspacePath) {
      candidates.push(path.resolve(this.workspacePath, raw))
    }

    for (const candidate of candidates) {
      let stat: Awaited<ReturnType<typeof fsPromises.stat>>
      try {
        stat = await fsPromises.stat(candidate)
      } catch {
        continue
      }
      if (!stat.isFile()) continue
      if (stat.size > MAX_IMAGE_BYTES) {
        throw new McpError(ErrorCode.InvalidParams, `Local image exceeds 20MB: ${candidate}`)
      }
      const mime = IMAGE_MIME_BY_EXT[path.extname(candidate).toLowerCase()] ?? 'image/jpeg'
      const buffer = await fsPromises.readFile(candidate)
      return { dataUrl: `data:${mime};base64,${buffer.toString('base64')}`, filePath: candidate }
    }
    return null
  }

  private async detectAigcImage(args: Record<string, unknown>) {
    let imageUrl = typeof args.image_url === 'string' ? args.image_url.trim() : ''
    let image = typeof args.image === 'string' ? args.image.trim() : ''

    if (!imageUrl && !image) {
      throw new McpError(ErrorCode.InvalidParams, 'Missing required param: image_url or image (public URL, local path, or base64)')
    }
    if (imageUrl && image) {
      logger.info('Both image_url and image supplied; preferring image_url per TFS API contract')
    }
    // 模型有时把公网 URL 塞进 image，这里纠正回 image_url
    if (!imageUrl && isHttpLikeUrl(image)) {
      imageUrl = image
      image = ''
    }

    // 模型常把本地路径/file:// 塞进 image_url（接口只收公网 URL），这里统一兜底成本地 base64
    let localImagePath: string | undefined
    for (const field of ['image_url', 'image'] as const) {
      const value = field === 'image_url' ? imageUrl : image
      if (!value) continue
      if (field === 'image_url' && isHttpLikeUrl(value)) continue
      const resolved = await this.resolveLocalImageToDataUrl(value)
      if (!resolved) continue
      image = resolved.dataUrl
      localImagePath = resolved.filePath
      if (field === 'image_url') imageUrl = ''
      break
    }

    if (imageUrl) {
      if (imageUrl.length > 2048) {
        throw new McpError(ErrorCode.InvalidParams, 'image_url length must not exceed 2048')
      }
      if (!isHttpLikeUrl(imageUrl)) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `image_url must be a public HTTP(S) URL (length <= 2048). For local images pass the file path in "image" instead: ${imageUrl.slice(0, 120)}`
        )
      }
    } else {
      // 硬保证：TFS 只接受 base64，本地路径绝不能透传出去。
      // base64 字符集不含 "." 和 "\"，出现即说明是路径而非编码内容。
      const isDataUrl = /^data:image\/[a-z0-9.+-]+;base64,/i.test(image)
      const isPlainBase64 = !image.includes('.') && !image.includes('\\') && /^[A-Za-z0-9+/\s]*={0,2}$/.test(image)
      if (!isDataUrl && !isPlainBase64) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `"image" must be base64 (optionally data:image/...;base64,<data>) — local paths are never forwarded to the API. Pass an existing local file path (it is encoded locally) or pre-encoded base64: ${image.slice(0, 120)}`
        )
      }
    }

    const inputKind = imageUrl ? 'url' : localImagePath ? 'local_file' : 'base64'
    logger.info('detect_aigc_image: start', {
      inputKind,
      urlPreview: imageUrl ? imageUrl.slice(0, 80) : localImagePath ?? undefined
    })

    const t0 = Date.now()
    const payload: Record<string, unknown> = imageUrl ? { image_url: imageUrl } : { image }
    const timeoutMs = imageUrl ? VIDEO_DETECT_IMAGE_TIMEOUT_MS : VIDEO_DETECT_BASE64_TIMEOUT_MS
    const result = await this.detectImageWithAuth(payload, timeoutMs)
    const built = this.buildImageDetectResponse(result)

    logger.info('detect_aigc_image: done', {
      costMs: Date.now() - t0,
      is_ai: built.is_ai,
      label: built.label,
      risk_level: built.risk_level,
      confidence: built.confidence,
      billing: built.billing
    })

    return built
  }

  private buildImageDetectResponse(result: TfsImageDetectResult) {
    const { code, message, data, billing } = result

    if (code !== 0) {
      const hint = this.tfsErrorCodeHint(code)
      const errMessage = hint ? `${message}。${hint}` : message
      const errCode = this.mapTfsErrorCodeToMcp(code)
      throw new McpError(errCode, errMessage)
    }

    const results = Array.isArray(data?.results)
      ? data!.results.map((r) => ({
          label: r.label,
          confidence: typeof r.confidence === 'number' ? Number(r.confidence.toFixed(2)) : r.confidence,
          risk_level: r.risk_level,
          ...(r.description ? { description: r.description } : {})
        }))
      : []

    // 完整透出接口返回的全部字段（见 API.md 3.4），不做裁剪
    return {
      code,
      message,
      is_ai: Boolean(data?.is_ai),
      label: data?.label ?? '',
      confidence: typeof data?.confidence === 'number' ? Number(data.confidence.toFixed(2)) : 0,
      risk_level: data?.risk_level ?? '',
      service: data?.service ?? '',
      data_id: data?.data_id ?? '',
      request_id: data?.request_id ?? '',
      image_url: data?.image_url ?? '',
      results,
      aigc_data: data?.aigc_data ?? {},
      billing: { consume: typeof billing?.consume === 'number' ? Number(billing.consume.toFixed(2)) : 0 },
      tool: 'detect_aigc_image'
    }
  }

  // ==================== 视频抽帧 ====================

  private resolveBundledFfmpegPath(): string | null {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
    const binaryName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
    const candidate = path.join(getResourcePath(), 'ffmpeg', process.platform, arch, binaryName)
    return fs.existsSync(candidate) ? candidate : null
  }

  private resolveFfprobePath(): string {
    const executableName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
    let packaged = ''
    if (process.resourcesPath) {
      if (process.platform === 'darwin') {
        packaged = path.join(process.resourcesPath, '..', 'Frameworks', 'ffprobe', 'darwin', process.arch, executableName)
      } else if (process.platform === 'win32') {
        packaged = path.join(process.resourcesPath, 'ffprobe', 'win32', process.arch, executableName)
      }
    }
    const bundled = String((ffprobeStatic as { path?: string } | undefined)?.path || '').trim()
    const unpacked = bundled.replace(/app\.asar([\\/])/g, 'app.asar.unpacked$1')
    const candidates = [packaged, bundled, unpacked, 'ffprobe'].filter(Boolean)

    for (const candidate of candidates) {
      if (candidate === 'ffprobe' || fs.existsSync(candidate)) return candidate
    }
    return 'ffprobe'
  }

  private async runFfmpeg(args: string[]): Promise<string> {
    const binary = this.resolveBundledFfmpegPath() || 'ffmpeg'
    try {
      await execFileAsync(binary, args, {
        windowsHide: true,
        timeout: FFMPEG_TIMEOUT_MS,
        maxBuffer: PROCESS_MAX_BUFFER
      })
    } catch (error) {
      throw new Error(`Failed to run ffmpeg (checked bundled binary then PATH fallback): ${toErrorMessage(error)}`)
    }
    return binary
  }

  private async probeMedia(source: string) {
    const probePath = this.resolveFfprobePath()
    const { stdout, stderr } = await execFileAsync(
      probePath,
      ['-v', 'error', '-show_entries', 'format=duration,format_name:stream=codec_name,codec_type,width,height,duration', '-of', 'json', source],
      {
        windowsHide: true,
        timeout: FFPROBE_TIMEOUT_MS,
        maxBuffer: PROCESS_MAX_BUFFER
      }
    ).catch((error) => {
      throw new Error(`Failed to probe media with ffprobe (${probePath}): ${toErrorMessage(error)}`)
    })

    const raw = `${String(stdout || '')}\n${String(stderr || '')}`
    const jsonStart = raw.indexOf('{')
    if (jsonStart === -1) throw new Error('ffprobe did not return JSON output')
    return JSON.parse(raw.slice(jsonStart)) as {
      format?: { duration?: number | string; format_name?: string }
      streams?: Array<{ codec_type?: string; duration?: number | string }>
    }
  }

  /** ffprobe 的 duration 可能是字符串、"N/A" 或缺失，统一解析为秒数 */
  private parseDurationSeconds(value: unknown): number | null {
    if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (!trimmed || /^n\/?a$/i.test(trimmed)) return null
      const parsed = Number(trimmed)
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null
    }
    return null
  }

  /** 依次尝试 format.duration → stream.duration，取最大有效值 */
  private pickDurationFromProbe(probe: {
    format?: { duration?: number | string }
    streams?: Array<{ codec_type?: string; duration?: number | string }>
  }): number | null {
    const candidates: number[] = []
    const formatDuration = this.parseDurationSeconds(probe.format?.duration)
    if (formatDuration) candidates.push(formatDuration)
    for (const stream of probe.streams || []) {
      if (stream.codec_type !== 'video') continue
      const streamDuration = this.parseDurationSeconds(stream.duration)
      if (streamDuration) candidates.push(streamDuration)
    }
    return candidates.length ? Math.max(...candidates) : null
  }

  /** ffprobe 拿不到时长时（如某些 mp4/fMP4），从 ffmpeg 的 stderr "Duration: HH:MM:SS.xx" 兜底解析 */
  private async probeDurationWithFfmpeg(source: string): Promise<number | null> {
    const binary = this.resolveBundledFfmpegPath() || 'ffmpeg'
    let output = ''
    try {
      const { stderr } = await execFileAsync(binary, ['-hide_banner', '-nostdin', '-i', source], {
        windowsHide: true,
        timeout: FFPROBE_TIMEOUT_MS,
        maxBuffer: PROCESS_MAX_BUFFER
      })
      output = String(stderr || '')
    } catch (error) {
      // ffmpeg 在没有输出文件时会以非 0 退出，但 stderr 里仍带媒体信息
      output = String((error as { stderr?: string | Buffer } | null)?.stderr || '')
    }
    const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(output)
    if (!match) return null
    const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null
  }

  private async extractFramesInRange(
    videoPath: string,
    fps: number,
    startSec: number,
    endSec: number,
    outputDir: string
  ): Promise<VideoFrameSample[]> {
    await fsPromises.mkdir(outputDir, { recursive: true })
    const durationSec = Math.max(0, endSec - startSec)

    // 先截到 range 的临时片段（-ss + -t），再抽帧。单条 ffmpeg 命令也可，但分两步更直观。
    const tempClip = path.join(outputDir, 'clip.mp4')
    await this.runFfmpeg([
      '-y',
      '-ss', String(startSec),
      '-i', videoPath,
      '-t', String(durationSec),
      '-an',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-preset', 'ultrafast',
      '-crf', '35',
      tempClip
    ])

    await this.runFfmpeg([
      '-y',
      '-i', tempClip,
      '-vf', `fps=${fps}`,
      '-q:v', '3',
      path.join(outputDir, 'frame-%06d.jpg')
    ])

    const frameFiles = (await fsPromises.readdir(outputDir))
      .filter((name) => /^frame-\d+\.(jpg|jpeg)$/i.test(name))
      .sort((a, b) => a.localeCompare(b))
      .map((name) => path.join(outputDir, name))

    const totalFrames = frameFiles.length
    if (totalFrames === 0) throw new Error('No frames were extracted from the video range')

    return frameFiles.map((filePath, index) => ({
      index,
      timestamp: Number((startSec + index / fps).toFixed(2)),
      filePath
    }))
  }

  private async prepareVideoSource(input: string, signal?: AbortSignal): Promise<{ localPath: string; cleanupDir: string | null; sourceKind: 'remote_video' | 'local_video' }> {
    let normalized = input
    if (normalized.startsWith('file://')) normalized = fileURLToPath(normalized)

    if (isHttpLikeUrl(normalized)) {
      const cleanupDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'aigc-detect-remote-'))
      const ext = (() => {
        try {
          const url = new URL(normalized)
          return path.extname(url.pathname) || '.mp4'
        } catch {
          return '.mp4'
        }
      })()
      const filePath = path.join(cleanupDir, `source${ext}`)
      try {
        const response = signal ? await net.fetch(normalized, { signal }) : await net.fetch(normalized)
        if (!response.ok) {
          const body = await response.text().catch(() => '')
          throw new Error(`Failed to download remote video (${response.status}): ${body || normalized}`)
        }
        const buffer = Buffer.from(await response.arrayBuffer())
        await fsPromises.writeFile(filePath, buffer)
        return { localPath: filePath, cleanupDir, sourceKind: 'remote_video' }
      } catch (error) {
        await fsPromises.rm(cleanupDir, { recursive: true, force: true }).catch(() => undefined)
        throw error
      }
    }

    let resolved = normalized
    if (!path.isAbsolute(resolved)) {
      if (!this.workspacePath) throw new McpError(ErrorCode.InvalidParams, 'Local video paths must be absolute when workspace is unavailable')
      resolved = path.resolve(this.workspacePath, resolved)
    }
    const stats = await fsPromises.stat(resolved)
    if (!stats.isFile()) throw new McpError(ErrorCode.InvalidParams, 'Local video source must point to a file')
    return { localPath: resolved, cleanupDir: null, sourceKind: 'local_video' }
  }

  // ==================== 视频检测 ====================

  private async detectAigcVideo(args: Record<string, unknown>) {
    const rawSource = typeof args.videoUrl === 'string' ? args.videoUrl.trim()
      : typeof args.video_url === 'string' ? args.video_url.trim()
      : ''

    if (!rawSource) {
      throw new McpError(ErrorCode.InvalidParams, "'videoUrl' or 'video_url' is required for detect_aigc_video")
    }

    const fpsValue = typeof args.fps === 'number' && args.fps > 0 ? args.fps : DEFAULT_VIDEO_FPS
    const startSec = typeof args.start_sec === 'number' && args.start_sec >= 0 ? args.start_sec : 0

    // 未显式给 end_sec 时，默认只检测前 DEFAULT_VIDEO_PRECHECK_SECONDS 秒
    let endSec: number
    if (typeof args.end_sec === 'number') {
      if (args.end_sec <= startSec) {
        // 用户传 0 或 <= start_sec 视为"全量扫描"
        endSec = Infinity
      } else {
        endSec = args.end_sec
      }
    } else {
      endSec = startSec + DEFAULT_VIDEO_PRECHECK_SECONDS
    }

    logger.info('detect_aigc_video: start', {
      source: rawSource.slice(0, 100),
      fps: fpsValue,
      start_sec: startSec,
      end_sec_in: typeof args.end_sec === 'number' ? args.end_sec : 'precheck'
    })

    const t0 = Date.now()
    const { localPath, cleanupDir } = await this.prepareVideoSource(rawSource)
    let framesDir: string | null = null

    try {
      const probe = await this.probeMedia(localPath)
      const hasVideoStream = (probe.streams || []).some((s) => s.codec_type === 'video')
      if (!hasVideoStream) throw new McpError(ErrorCode.InvalidParams, 'Source has no video stream')

      // ffprobe 的 duration 可能是字符串 / "N/A" / 缺失，逐级兜底
      let duration = this.pickDurationFromProbe(probe)
      if (duration === null) duration = await this.probeDurationWithFfmpeg(localPath)

      if (duration === null && !Number.isFinite(endSec)) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'Unable to determine video duration; please pass an explicit end_sec to bound the detection window'
        )
      }

      // 时长未知时不做 clamp，直接按请求窗口交给 ffmpeg（-t 会自然截断）
      const effectiveEnd = duration !== null
        ? (Number.isFinite(endSec) ? Math.min(endSec, duration) : duration)
        : endSec
      const rangeDuration = Math.max(0, effectiveEnd - startSec)

      if (rangeDuration <= 0) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Invalid detection window: start_sec=${startSec}, end_sec=${effectiveEnd}, video duration=${duration === null ? 'unknown' : `${duration.toFixed(2)}s`}`
        )
      }

      if (effectiveEnd - startSec > MAX_VIDEO_DURATION_SECONDS) {
        throw new McpError(ErrorCode.InvalidParams, `Detection window exceeds ${MAX_VIDEO_DURATION_SECONDS}s; narrow start_sec/end_sec`)
      }

      framesDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'aigc-detect-frames-'))
      const frames = await this.extractFramesInRange(localPath, fpsValue, startSec, effectiveEnd, framesDir)

      logger.info('detect_aigc_video: frames extracted', {
        costMs: Date.now() - t0,
        frames: frames.length,
        videoDuration: duration === null ? 'unknown' : duration.toFixed(2),
        window: `${startSec.toFixed(1)}~${effectiveEnd.toFixed(1)}`
      })

      // 并发检测（限流）
      const records = await this.detectAllFramesConcurrently(frames)

      const result = this.buildVideoDetectResponse({
        source: rawSource,
        fps: fpsValue,
        duration: duration ?? effectiveEnd,
        startSec,
        endSec: effectiveEnd,
        framesCount: frames.length,
        records
      })

      logger.info('detect_aigc_video: done', {
        costMs: Date.now() - t0,
        frames_checked: result.frames_checked,
        ai_frame_count: result.ai_frame_count,
        ai_ratio: result.ai_ratio,
        verdict: result.verdict,
        segments: result.aigc_segments.length,
        billing: result.billing
      })

      return result
    } finally {
      if (framesDir) await fsPromises.rm(framesDir, { recursive: true, force: true }).catch(() => undefined)
      if (cleanupDir) await fsPromises.rm(cleanupDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private async detectAllFramesConcurrently(frames: VideoFrameSample[]): Promise<FrameDetectRecord[]> {
    const records: FrameDetectRecord[] = []
    let cursor = 0

    const worker = async (): Promise<void> => {
      while (cursor < frames.length) {
        const idx = cursor++
        const frame = frames[idx]
        const dataUrl = await fsPromises.readFile(frame.filePath, 'base64')
        try {
          const result = await this.detectImageWithAuth({ image: `data:image/jpeg;base64,${dataUrl}` }, VIDEO_DETECT_BASE64_TIMEOUT_MS)
          if (result.code !== 0) {
            const reason = this.tfsErrorCodeHint(result.code) || result.message
            logger.warn('detect_aigc_video: frame detect rejected', {
              timestamp: frame.timestamp,
              code: result.code,
              reason
            })
            records[idx] = {
              timestamp: frame.timestamp,
              is_ai: false,
              error: reason,
              consume: 0
            }
          } else {
            records[idx] = {
              timestamp: frame.timestamp,
              is_ai: Boolean(result.data?.is_ai),
              label: result.data?.label ?? undefined,
              confidence: typeof result.data?.confidence === 'number' ? result.data.confidence : undefined,
              risk_level: result.data?.risk_level ?? undefined,
              hit_labels: Array.isArray(result.data?.results)
                ? Array.from(new Set(result.data.results.map((r) => r.label).filter((label) => typeof label === 'string')))
                : undefined,
              consume: result.billing?.consume ?? 0
            }
          }
        } catch (err) {
          logger.warn('detect_aigc_video: frame detect failed', {
            timestamp: frame.timestamp,
            error: toErrorMessage(err)
          })
          records[idx] = {
            timestamp: frame.timestamp,
            is_ai: false,
            error: toErrorMessage(err),
            consume: 0
          }
        }
      }
    }

    const workers = Array.from({ length: Math.min(MAX_CONCURRENT_IMAGE_DETECTS, frames.length) }, () => worker())
    await Promise.all(workers)
    return records
  }

  private buildVideoDetectResponse(params: {
    source: string
    fps: number
    duration: number
    startSec: number
    endSec: number
    framesCount: number
    records: FrameDetectRecord[]
  }) {
    const { records } = params

    // 合并连续 AI 帧为时间段（精确到秒）
    const segments: AigcSegment[] = []
    let pending: { start: number; end: number; labels: string[]; confidences: number[]; riskLevels: string[]; hitLabels: string[] } | null = null
    const createPending = (timestamp: number) => ({
      start: Math.round(timestamp),
      end: Math.round(timestamp),
      labels: [] as string[],
      confidences: [] as number[],
      riskLevels: [] as string[],
      hitLabels: [] as string[]
    })

    for (const record of records) {
      if (record.is_ai) {
        if (!pending) {
          pending = createPending(record.timestamp)
        } else {
          // 不允许超过 2 秒空隙，否则断段
          const gap = Math.round(record.timestamp) - pending.end
          if (gap > 2) {
            segments.push(this.finalizeSegment(pending))
            pending = createPending(record.timestamp)
          } else {
            pending.end = Math.round(record.timestamp)
          }
        }
        if (record.label) pending.labels.push(record.label)
        if (typeof record.confidence === 'number') pending.confidences.push(record.confidence)
        if (record.risk_level) pending.riskLevels.push(record.risk_level)
        for (const hitLabel of record.hit_labels || []) pending.hitLabels.push(hitLabel)
      } else if (pending) {
        segments.push(this.finalizeSegment(pending))
        pending = null
      }
    }
    if (pending) segments.push(this.finalizeSegment(pending))

    // 判定 verdict
    const aiFrames = records.filter((r) => r.is_ai).length
    const checkedFrames = records.filter((r) => !r.error).length
    const aiRatio = checkedFrames > 0 ? aiFrames / checkedFrames : 0
    let verdict: 'pure_real' | 'mixed' | 'mostly_ai' | 'pure_ai'
    if (aiFrames === 0) verdict = 'pure_real'
    else if (aiRatio >= 0.8) verdict = 'pure_ai'
    else if (aiRatio >= 0.3) verdict = 'mostly_ai'
    else verdict = 'mixed'

    const errors = records.filter((r) => r.error).map((r) => ({ timestamp: r.timestamp, error: r.error! }))
    const totalConsume = records.reduce((sum, r) => sum + (r.consume || 0), 0)
    const allHitLabels = Array.from(new Set(records.flatMap((r) => r.hit_labels || [])))

    return {
      source: params.source,
      duration_seconds: Number(params.duration.toFixed(2)),
      detection_window: {
        start_sec: params.startSec,
        end_sec: Number(params.endSec.toFixed(2))
      },
      fps: params.fps,
      /** 与 /tfs/image/detect 的 data.is_ai 语义一致：任一帧命中即 true */
      is_ai: aiFrames > 0,
      frames_checked: checkedFrames,
      frames_skipped_due_to_error: errors.length,
      ai_frame_count: aiFrames,
      ai_ratio: Number(aiRatio.toFixed(4)),
      hit_labels: allHitLabels,
      verdict,
      aigc_segments: segments,
      /** 逐帧透出时间戳、is_ai、置信度与风险等级 */
      frames: records.map((r) => ({
        timestamp: r.timestamp,
        is_ai: r.is_ai,
        confidence: typeof r.confidence === 'number' ? Number(r.confidence.toFixed(2)) : 0,
        risk_level: r.risk_level ?? '',
        ...(r.error ? { error: r.error } : {})
      })),
      ...(errors.length ? { frame_errors: errors } : {}),
      ...(totalConsume > 0 ? { billing: { points_consumed: Number(totalConsume.toFixed(2)) } } : {}),
      note: [
        'is_ai follows the TFS API: hitting ANY label other than ugc/nonLabel/normal counts as AI-suspected, including risk_edit (AI-edited) and risk_fake (forged).',
        'label is the single highest-confidence conclusion within a segment; hit_labels lists every detected dimension.',
        params.endSec - params.startSec <= DEFAULT_VIDEO_PRECHECK_SECONDS + 0.01
          ? 'Detected only the first 5 seconds by default. To scan the whole video, pass end_sec=0 (full) or explicit end_sec.'
          : ''
      ].filter(Boolean).join(' '),
      tool: 'detect_aigc_video'
    }
  }

  private finalizeSegment(pending: {
    start: number; end: number; labels: string[]; confidences: number[]; riskLevels: string[]; hitLabels: string[]
  }): AigcSegment {
    const label = pending.labels.length > 0
      ? pending.labels.reduce((best, cur) =>
          AI_LABELS.has(cur) && !AI_LABELS.has(best) ? cur : best
        , pending.labels[0])
      : ''
    const confidence = pending.confidences.length > 0
      ? Number((pending.confidences.reduce((s, v) => s + v, 0) / pending.confidences.length).toFixed(2))
      : 0
    const riskLevel = pending.riskLevels.length > 0
      ? pending.riskLevels.reduce((best, cur) =>
          (cur === 'high' || (cur === 'medium' && best === 'low')) ? cur : best
        , pending.riskLevels[0])
      : ''
    return {
      start_sec: pending.start,
      end_sec: pending.end,
      is_ai: true,
      label,
      confidence,
      risk_level: riskLevel,
      hit_labels: Array.from(new Set(pending.hitLabels))
    }
  }

  // ==================== TFS 错误码辅助 ====================

  private mapTfsErrorCodeToMcp(code: number): ErrorCode {
    switch (code) {
      case 10000: return ErrorCode.InvalidParams
      case 10003: return ErrorCode.InvalidParams // 余额不足 -> 视为 params 级别的用户问题
      default: return ErrorCode.InternalError
    }
  }

  private tfsErrorCodeHint(code: number): string {
    switch (code) {
      case 10000: return '参数错误或鉴权失败，请修正后重试'
      case 10001: return '上游检测失败（如图片不可访问、下载超时、阿里云内部错误），可换素材重试；此错误也可能已扣费'
      case 10002: return '服务内部异常，请稍后重试'
      case 10003: return '积分不足，请充值后重试'
      default: return ''
    }
  }

  // ==================== 输出格式化 ====================

  private formatJsonResult(data: unknown) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(data, null, 2)
      }]
    }
  }
}
