import { execFile } from 'node:child_process'
import { createHmac, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { loggerService } from '@logger'
import { windowService } from '@main/services/WindowService'
import { getResourcePath } from '@main/utils'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
import type { ProgressToken } from '@modelcontextprotocol/sdk/types.js'
import type { MCPProgressEvent } from '@shared/config/types'
import { IpcChannel } from '@shared/IpcChannel'
import Store from 'electron-store'
import { net } from 'electron'

const logger = loggerService.withContext('MCPServer:SocialCopywriting')

const API_HOST = 'https://open.vectcut.com'
const OAUTH_TOKEN_URL = 'https://mlbd8l6vgi13-demo.authing.cn/oidc/token'
const OAUTH_CLIENT_ID = '6901dd145dafc6f1f3143938'
const OAUTH_CLIENT_SECRET = '16a94e467e927cc09b3c8dc7ec92d420'
const PUBLIC_ENDPOINT = 'https://player.install-ai-guider.top'
const SIGN_EXPIRES_SECONDS = 24 * 60 * 60
const MAX_FILE_SIZE = 500 * 1024 * 1024
const ASR_SUBMIT_ENDPOINT = '/llm/asr/asr_llm/submit_task/submit_asr_llm_task'
const ASR_STATUS_ENDPOINT = '/llm/asr/asr_llm/submit_task/task_status'
const CHAT_SUBMIT_ENDPOINT = '/llm/chat/submit_task/submit_chat_task'
const CHAT_STATUS_ENDPOINT = '/llm/chat/submit_task/task_status'
const ASR_POLL_INTERVAL_MS = 3_000
const ASR_POLL_TIMEOUT_MS = 3 * 60 * 1000
const CHAT_POLL_INTERVAL_MS = 3_000
const CHAT_POLL_TIMEOUT_MS = 3 * 60 * 1000
const INTERNAL_TOOL_CALL_ID_KEY = '__toolCallId'
const SOCIAL_COPYWRITING_TOOL_NAME = 'derive_copy_prompt'
const SOCIAL_COPYWRITING_SERVER_NAME = 'copylab'

const SOCIAL_COPYWRITING_TOOL: Tool = {
  name: SOCIAL_COPYWRITING_TOOL_NAME,
  description:
    'Extract a reusable copywriting prompt from a social-media share link or share text. Use this when the user wants to imitate, reverse-engineer, or derive prompts from Douyin, Xiaohongshu, Kuaishou, Bilibili, TikTok, or YouTube videos.',
  inputSchema: {
    type: 'object',
    properties: {
      shareText: {
        type: 'string',
        description: 'Required share link or share text containing a supported social-media URL.'
      },
      platform: {
        type: 'string',
        enum: ['auto', 'douyin', 'xiaohongshu', 'kuaishou', 'bilibili', 'tiktok', 'youtube'],
        description: 'Optional platform override. Defaults to auto.'
      },
      topic: {
        type: 'string',
        description: 'Optional new topic or subject that the future prompt should adapt to.'
      },
      analysisModel: {
        type: 'string',
        description:
          'Optional VectCut chat model for reverse engineering. Defaults to gpt-5.5, which the VectCut API may remap to its default supported model.'
      },
      keepTempFiles: {
        type: 'boolean',
        description: 'Whether to keep temporary downloaded video and extracted mp3 files for debugging. Defaults to false.'
      }
    },
    required: ['shareText'],
    additionalProperties: false
  }
}

type PendingToken = {
  accessToken: string
  expiresAt: number
}

type PlatformName = 'douyin' | 'xiaohongshu' | 'kuaishou' | 'bilibili' | 'tiktok' | 'youtube'

type SocialParseResponse = {
  success?: boolean
  data?: {
    platform?: string
    title?: string
    desc?: string
    original_url?: string
    type?: string
    author?: {
      nickname?: string
      [key: string]: unknown
    }
    video?: {
      url?: string
      duration?: number
      width?: number
      height?: number
      size?: number
      [key: string]: unknown
    } | null
    [key: string]: unknown
  }
  [key: string]: unknown
}

type AsrSubmitResponse = {
  success?: boolean
  task_id?: string
  status?: string
  effect_mode?: string
  error?: string
  [key: string]: unknown
}

type AsrTaskStatusResponse = {
  success?: boolean
  task_id?: string
  status?: string
  progress?: number
  error?: string
  message?: string
  result?: {
    content?: string
    mode?: string
    effect_mode?: string
    error?: string
    segments?: Array<Record<string, unknown>>
    [key: string]: unknown
  }
  [key: string]: unknown
}

type ChatSubmitResponse = {
  success?: boolean
  task_id?: string
  status?: string
  model?: string
  message?: string
  error?: string
  [key: string]: unknown
}

type ChatCompletionResponse = {
  id?: string
  model?: string
  choices?: Array<{
    message?: {
      content?: string
      reasoning_content?: string
      role?: string
    }
  }>
  [key: string]: unknown
}

type ChatTaskStatusResponse = {
  success?: boolean
  task_id?: string
  status?: string
  progress?: number
  message?: string
  error?: string
  model?: string
  result?: {
    assistant?: string
    response?: ChatCompletionResponse
    [key: string]: unknown
  }
  [key: string]: unknown
}

type TempArtifacts = {
  tempDir: string
  videoPath: string
  audioPath: string
}

type StepLogContext = {
  platform?: string
  shareText?: string
  taskId?: string
  [key: string]: unknown
}

type ToolExecutionExtra = {
  signal: AbortSignal
  requestId: string | number
  _meta?: {
    progressToken?: ProgressToken
  }
  toolCallId?: string
  sendNotification: (notification: {
    method: 'notifications/progress'
    params: {
      progressToken: ProgressToken
      progress: number
      total?: number
      message?: string
    }
  }) => Promise<void>
}

const PLATFORM_ENDPOINTS: Record<PlatformName, string> = {
  douyin: '/scrapt/douyin/parse',
  xiaohongshu: '/scrapt/xiaohongshu/parse',
  kuaishou: '/scrapt/kuaishou/parse',
  bilibili: '/scrapt/bilibili/parse',
  tiktok: '/scrapt/tiktok/parse',
  youtube: '/scrapt/youtube/parse'
}

const PLATFORM_HOST_RULES: Array<{ platform: PlatformName; patterns: RegExp[] }> = [
  { platform: 'douyin', patterns: [/douyin\.com/i, /iesdouyin\.com/i] },
  { platform: 'xiaohongshu', patterns: [/xiaohongshu\.com/i, /xhslink\.com/i] },
  { platform: 'kuaishou', patterns: [/kuaishou\.com/i, /v\.kuaishou\.com/i, /chenzhongtech\.com/i] },
  { platform: 'bilibili', patterns: [/bilibili\.com/i, /b23\.tv/i] },
  { platform: 'tiktok', patterns: [/tiktok\.com/i, /vm\.tiktok\.com/i] },
  { platform: 'youtube', patterns: [/youtube\.com/i, /youtu\.be/i] }
]

const execFileAsync = promisify(execFile)

class SocialCopywritingServer {
  public mcpServer: McpServer
  private readonly store = new Store({ name: 'vectcut' })
  private accessToken: PendingToken | null = null
  private refreshPromise: Promise<string> | null = null

  constructor() {
    this.mcpServer = new McpServer(
      {
        name: SOCIAL_COPYWRITING_SERVER_NAME,
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
      tools: [SOCIAL_COPYWRITING_TOOL]
    }))

    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const toolName = request.params.name
      const args = request.params.arguments ?? {}

      try {
        switch (toolName) {
          case SOCIAL_COPYWRITING_TOOL_NAME:
            return await this.extractSocialCopywritingPrompt(args as Record<string, unknown>, extra as ToolExecutionExtra)
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

  private async requestJson(
    endpoint: string,
    options: {
      method?: 'GET' | 'POST'
      body?: Record<string, unknown>
      query?: URLSearchParams
      headers?: Record<string, string>
    } = {}
  ): Promise<Response> {
    const token = await this.ensureValidAccessToken()
    const method = options.method ?? 'POST'
    const queryString = options.query ? `?${options.query.toString()}` : ''

    const doFetch = async (accessToken: string) =>
      net.fetch(`${API_HOST}${endpoint}${queryString}`, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
          ...(options.headers ?? {})
        },
        ...(method === 'POST' && options.body ? { body: JSON.stringify(options.body) } : {})
      })

    let response = await doFetch(token)
    if (response.status === 401) {
      const refreshedToken = await this.ensureValidAccessToken(true)
      response = await doFetch(refreshedToken)
    }
    return response
  }

  private getRequiredString(args: Record<string, unknown>, ...keys: string[]) {
    for (const key of keys) {
      const value = args[key]
      if (typeof value === 'string' && value.trim()) {
        return value.trim()
      }
    }
    throw new McpError(ErrorCode.InvalidParams, `'${keys[0]}' is required`)
  }

  private detectPlatform(rawInput: string, override: unknown): PlatformName {
    if (typeof override === 'string' && override.trim() && override !== 'auto') {
      const normalized = override.trim().toLowerCase() as PlatformName
      if (normalized in PLATFORM_ENDPOINTS) {
        return normalized
      }
      throw new McpError(ErrorCode.InvalidParams, `Unsupported platform override: ${override}`)
    }

    for (const rule of PLATFORM_HOST_RULES) {
      if (rule.patterns.some((pattern) => pattern.test(rawInput))) {
        return rule.platform
      }
    }

    throw new McpError(
      ErrorCode.InvalidParams,
      'Unable to detect platform from shareText. Supported platforms: douyin, xiaohongshu, kuaishou, bilibili, tiktok, youtube.'
    )
  }

  private sanitizeBasename(value: string) {
    return value.replace(/[^a-zA-Z0-9._-]+/g, '_')
  }

  private getVideoFileExtension(url: string) {
    try {
      const pathname = new URL(url).pathname || ''
      const ext = path.extname(pathname)
      return ext && ext.length <= 10 ? ext : '.mp4'
    } catch {
      return '.mp4'
    }
  }

  private async parseSocialLink(platform: PlatformName, shareText: string) {
    const endpoint = PLATFORM_ENDPOINTS[platform]
    const response = await this.requestJson(endpoint, {
      method: 'POST',
      body: {
        url: shareText
      }
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Failed to parse ${platform} link (${response.status}): ${body || 'unknown error'}`)
    }

    const payload = (await response.json()) as SocialParseResponse
    const videoUrl = String(payload?.data?.video?.url || '').trim()
    if (!payload?.success) {
      throw new Error(`Failed to parse ${platform} link: ${JSON.stringify(payload)}`)
    }
    if (!videoUrl) {
      throw new Error(`Parsed ${platform} content did not include data.video.url`)
    }

    return payload
  }

  private async createTempArtifacts(videoUrl: string): Promise<TempArtifacts> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vectcut-social-copy-'))
    const videoPath = path.join(tempDir, `source${this.getVideoFileExtension(videoUrl)}`)
    const audioPath = path.join(tempDir, 'audio_tmp.mp3')
    return { tempDir, videoPath, audioPath }
  }

  private async downloadToFile(url: string, filePath: string) {
    const response = await net.fetch(url)
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Failed to download media (${response.status}): ${body || 'unknown error'}`)
    }

    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.byteLength > MAX_FILE_SIZE) {
      throw new Error('Downloaded media exceeds MAX_FILE_SIZE')
    }

    await fs.writeFile(filePath, bytes)
    return bytes.byteLength
  }

  private resolveBundledFfmpegPath() {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
    const binaryName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
    const candidate = path.join(getResourcePath(), 'ffmpeg', process.platform, arch, binaryName)
    return existsSync(candidate) ? candidate : null
  }

  private async extractAudioToMp3(videoPath: string, audioPath: string) {
    const bundledFfmpegPath = this.resolveBundledFfmpegPath()
    const ffmpegCommand = bundledFfmpegPath || 'ffmpeg'

    try {
      await execFileAsync(ffmpegCommand, [
        '-y',
        '-i',
        videoPath,
        '-vn',
        '-ac',
        '1',
        '-ar',
        '16000',
        '-c:a',
        'libmp3lame',
        '-b:a',
        '64k',
        audioPath
      ])
    } catch (error) {
      throw new Error(
        `Failed to extract mp3 with ffmpeg. Checked bundled binary: ${bundledFfmpegPath || 'not found'}, then PATH fallback. ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  private buildKeyPrefix(kraw?: unknown) {
    const value = typeof kraw === 'string' && kraw.trim() ? kraw.trim() : 'uploads'
    return value.endsWith('/') ? value : `${value}/`
  }

  private buildPublicUrl(bucket: string, publicEndpoint: string, defaultHost: string, key: string) {
    const endpoint = String(publicEndpoint || '')
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '')
    if (!endpoint) {
      return `${defaultHost}/${key}`
    }
    const isCname = !endpoint.includes('aliyuncs.com') && !endpoint.includes('oss-')
    return isCname ? `https://${endpoint}/${key}` : `https://${bucket}.${endpoint}/${key}`
  }

  private buildSignedPublicUrl(
    bucket: string,
    publicEndpoint: string,
    key: string,
    accessKeyId: string,
    accessKeySecret: string,
    securityToken: string,
    uploadHost: string
  ) {
    const endpoint = String(publicEndpoint || '')
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '')
    const isOfficial = endpoint.includes('aliyuncs.com') || endpoint.includes('oss-')
    const expires = Math.floor(Date.now() / 1000) + SIGN_EXPIRES_SECONDS
    const canonicalResource = `/${bucket}/${key}${securityToken ? `?security-token=${securityToken}` : ''}`
    const stringToSign = `GET\n\n\n${expires}\n${canonicalResource}`
    const signature = createHmac('sha1', accessKeySecret).update(stringToSign).digest('base64')
    const base = endpoint
      ? isOfficial
        ? `https://${bucket}.${endpoint}/${key}`
        : `https://${endpoint}/${key}`
      : `${uploadHost}/${key}`
    const query = new URLSearchParams({
      OSSAccessKeyId: accessKeyId,
      Expires: String(expires),
      Signature: signature
    })
    if (securityToken) {
      query.set('security-token', securityToken)
    }
    return `${base}?${query.toString()}`
  }

  private makePolicyBase64(minutes: number, keyPrefix: string, securityToken: string) {
    const expiration = new Date(Date.now() + minutes * 60 * 1000).toISOString()
    const conditions: Array<Record<string, string> | unknown[]> = [
      ['starts-with', '$key', keyPrefix],
      ['content-length-range', 0, MAX_FILE_SIZE],
      { success_action_status: '200' },
      ['starts-with', '$Content-Type', '']
    ]
    if (securityToken) {
      conditions.push({ 'x-oss-security-token': securityToken })
    }
    return Buffer.from(
      JSON.stringify({
        expiration,
        conditions
      })
    ).toString('base64')
  }

  private async uploadLocalFileToTempOss(filePath: string, mimeType: string) {
    const stats = await fs.stat(filePath)
    if (stats.size > MAX_FILE_SIZE) {
      throw new Error('FILE_TOO_LARGE')
    }

    const credentialsResponse = await this.requestJson('/sts/get_credentials', {
      method: 'POST',
      body: {}
    })

    if (!credentialsResponse.ok) {
      const body = await credentialsResponse.text().catch(() => '')
      throw new Error(`Failed to get STS credentials (${credentialsResponse.status}): ${body || 'unknown error'}`)
    }

    const resp = (await credentialsResponse.json()) as {
      bucket_name?: string
      region?: string
      key_prefix?: string
      credentials?: {
        AccessKeyId?: string
        AccessKeySecret?: string
        SecurityToken?: string
      }
    }

    const bucket = resp.bucket_name || 'jianying-upload-tmp'
    const region = resp.region || 'oss-cn-hangzhou'
    const uploadHost = `https://${bucket}.${region}.aliyuncs.com`
    const ak = String(resp.credentials?.AccessKeyId || '').trim()
    const sk = String(resp.credentials?.AccessKeySecret || '').trim()
    const st = String(resp.credentials?.SecurityToken || '').trim()
    if (!ak || !sk) {
      throw new Error('STS_INVALID')
    }

    const keyPrefix = this.buildKeyPrefix(resp.key_prefix)
    const ext = path.extname(filePath) || '.mp3'
    const key = `${keyPrefix}vectcut_koubo_tmp_file_${randomUUID()}${ext}`
    const policy = this.makePolicyBase64(30, keyPrefix, st)
    const signature = createHmac('sha1', sk).update(policy).digest('base64')
    const bytes = await fs.readFile(filePath)
    const form = new FormData()
    form.append('key', key)
    form.append('policy', policy)
    form.append('OSSAccessKeyId', ak)
    form.append('x-oss-security-token', st)
    form.append('success_action_status', '200')
    form.append('Signature', signature)
    form.append('Content-Type', mimeType || 'application/octet-stream')
    form.append('file', new Blob([bytes], { type: mimeType || 'application/octet-stream' }), this.sanitizeBasename(path.basename(filePath)))

    const uploadResponse = await net.fetch(uploadHost, {
      method: 'POST',
      body: form as unknown as BodyInit
    })

    if (!uploadResponse.ok) {
      const body = await uploadResponse.text().catch(() => '')
      throw new Error(`UPLOAD_FAILED:${uploadResponse.status}:${body}`)
    }

    const publicUrl = this.buildPublicUrl(bucket, PUBLIC_ENDPOINT, uploadHost, key)
    const signedPublicUrl = this.buildSignedPublicUrl(bucket, PUBLIC_ENDPOINT, key, ak, sk, st, uploadHost)
    return {
      objectKey: key,
      publicUrl,
      signedPublicUrl
    }
  }

  private async submitAsrTask(audioUrl: string) {
    const response = await this.requestJson(ASR_SUBMIT_ENDPOINT, {
      method: 'POST',
      body: {
        url: audioUrl,
        effect_mode: 'basic'
      }
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Failed to submit ASR task (${response.status}): ${body || 'unknown error'}`)
    }

    const payload = (await response.json()) as AsrSubmitResponse
    const taskId = String(payload.task_id || '').trim()
    if (!payload.success || !taskId) {
      throw new Error(`ASR submit failed: ${JSON.stringify(payload)}`)
    }

    return payload
  }

  private async waitForAsrResult(taskId: string, extra?: ToolExecutionExtra) {
    const deadline = Date.now() + ASR_POLL_TIMEOUT_MS
    let latestPayload: AsrTaskStatusResponse | null = null

    while (Date.now() < deadline) {
      if (extra) {
        this.ensureNotAborted(extra)
      }

      const response = await this.requestJson(ASR_STATUS_ENDPOINT, {
        method: 'GET',
        query: new URLSearchParams({
          task_id: taskId
        })
      })

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new Error(`Failed to query ASR task (${response.status}): ${body || 'unknown error'}`)
      }

      latestPayload = (await response.json()) as AsrTaskStatusResponse
      const status = String(latestPayload.status || '').toLowerCase()
      if (extra) {
        const normalizedTaskProgress =
          typeof latestPayload.progress === 'number' && Number.isFinite(latestPayload.progress)
            ? Math.max(0, Math.min(100, latestPayload.progress))
            : null
        const mappedProgress =
          normalizedTaskProgress === null ? 75 : Math.round(70 + normalizedTaskProgress * 0.18)
        const progressMessage =
          normalizedTaskProgress === null
            ? `正在等待字幕识别结果（${status || 'processing'}）`
            : `正在识别字幕 ${normalizedTaskProgress}%`
        await this.reportProgress(extra, mappedProgress, progressMessage)
      }
      if (status === 'success') {
        return latestPayload
      }
      if (status === 'failed' || status === 'error') {
        throw new Error(
          `ASR task failed: ${latestPayload.result?.error || latestPayload.error || latestPayload.message || 'unknown error'}`
        )
      }

      await new Promise((resolve) => setTimeout(resolve, ASR_POLL_INTERVAL_MS))
    }

    throw new Error(`ASR task timed out after ${ASR_POLL_TIMEOUT_MS}ms: ${JSON.stringify(latestPayload)}`)
  }

  private buildAnalysisPrompts(input: {
    topic: string
    transcript: string
    parsed: SocialParseResponse['data']
  }) {
    const systemPrompt = [
      '你是一名资深短视频内容拆解与提示词工程专家。',
      '你的任务是根据给定的社媒视频字幕、标题、描述和作者信息，反推出一条可复用的文案生成提示词。',
      '输出必须是 JSON，不要输出 Markdown，不要输出额外解释。',
      '请特别关注：开头钩子、叙事节奏、人群定位、情绪调性、论证方式、结尾 CTA、口语化习惯、句长节奏、常用修辞。',
      '生成的 prompt 应该允许用户只输入一个主题，就能产出类似风格的文案。',
      '如果提供了新 topic，请在 prompt_template 中体现如何围绕新 topic 生成相同风格的内容。'
    ].join('\n')

    const userInput = JSON.stringify(
      {
        task: '请反推用于生成类似文案的高质量提示词',
        topic: input.topic || '',
        source: {
          platform: input.parsed?.platform || '',
          title: input.parsed?.title || '',
          desc: input.parsed?.desc || '',
          author: input.parsed?.author?.nickname || '',
          transcript: input.transcript
        },
        output_schema: {
          summary: '一句话总结这条内容的写法',
          audience: '目标受众',
          hook_pattern: '开头钩子公式',
          structure: ['按顺序列出内容结构步骤'],
          tone: ['调性标签'],
          persuasion_techniques: ['说服方式'],
          reusable_prompt: '最终可复用提示词，保留 {topic} 占位符',
          user_prompt_template: '给最终用户的简短调用模板',
          guardrails: ['生成时要遵守的限制'],
          mimic_signals: ['需要模仿的显著风格信号']
        }
      },
      null,
      2
    )

    return {
      systemPrompt,
      userInput
    }
  }

  private tryParseJson(text: string) {
    try {
      return JSON.parse(text)
    } catch {
      return null
    }
  }

  private ensureNotAborted(extra: ToolExecutionExtra) {
    if (extra.signal.aborted) {
      throw new Error('Tool execution aborted by user')
    }
  }

  private createStepTimer(step: string, context: StepLogContext = {}) {
    const startedAt = Date.now()
    logger.info(`[social-copywriting] ${step}:start`, context)

    return {
      success: (extra: StepLogContext = {}) => {
        logger.info(`[social-copywriting] ${step}:success`, {
          ...context,
          ...extra,
          elapsedMs: Date.now() - startedAt
        })
      },
      fail: (error: unknown, extra: StepLogContext = {}) => {
        logger.error(
          `[social-copywriting] ${step}:fail`,
          error instanceof Error ? error : new Error(String(error)),
          {
            ...context,
            ...extra,
            elapsedMs: Date.now() - startedAt
          }
        )
      }
    }
  }

  private async reportProgress(extra: ToolExecutionExtra, progress: number, message: string) {
    const directToolCallId = extra.toolCallId
    if (directToolCallId) {
      const mainWindow = windowService.getMainWindow()
      if (mainWindow) {
        mainWindow.webContents.send(IpcChannel.Mcp_Progress, {
          callId: directToolCallId,
          progress: Math.max(0, Math.min(1, progress / 100)),
          message
        } as MCPProgressEvent)
      }
    }

    if (extra._meta?.progressToken === undefined) {
      logger.debug('[social-copywriting] progress notification fallback skipped: no progressToken', {
        requestId: extra.requestId,
        toolCallId: directToolCallId,
        progress,
        message
      })
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

    logger.debug('[social-copywriting] progress notification sent', {
      requestId: extra.requestId,
      toolCallId: directToolCallId,
      progress,
      message
    })
  }

  private async analyzeTranscript(
    transcript: string,
    parsed: SocialParseResponse['data'],
    topic: string,
    analysisModel: string,
    extra?: ToolExecutionExtra
  ) {
    const prompts = this.buildAnalysisPrompts({ topic, transcript, parsed })
    const response = await this.requestJson(CHAT_SUBMIT_ENDPOINT, {
      method: 'POST',
      body: {
        system_prompt: prompts.systemPrompt,
        user_input: prompts.userInput,
        model: analysisModel || 'gpt-5.5',
        response_format: 'json',
        stream: false
      }
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Failed to analyze transcript (${response.status}): ${body || 'unknown error'}`)
    }

    const payload = (await response.json()) as ChatSubmitResponse
    const taskId = String(payload.task_id || '').trim()
    if (!payload.success || !taskId) {
      throw new Error(`Chat submit failed: ${JSON.stringify(payload)}`)
    }

    const result = await this.waitForChatResult(taskId, analysisModel, extra)
    return result
  }

  private async waitForChatResult(taskId: string, analysisModel: string, extra?: ToolExecutionExtra) {
    const deadline = Date.now() + CHAT_POLL_TIMEOUT_MS
    let latestPayload: ChatTaskStatusResponse | null = null
    let attempts = 0

    while (Date.now() < deadline) {
      attempts += 1
      if (extra) {
        this.ensureNotAborted(extra)
      }

      const response = await this.requestJson(CHAT_STATUS_ENDPOINT, {
        method: 'GET',
        query: new URLSearchParams({
          task_id: taskId
        })
      })

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new Error(`Failed to query chat task (${response.status}): ${body || 'unknown error'}`)
      }

      latestPayload = (await response.json()) as ChatTaskStatusResponse
      const status = String(latestPayload.status || '').toLowerCase()
      const normalizedTaskProgress =
        typeof latestPayload.progress === 'number' && Number.isFinite(latestPayload.progress)
          ? Math.max(0, Math.min(100, latestPayload.progress))
          : null

      logger.info('[social-copywriting] wait_chat_result:poll', {
        taskId,
        attempt: attempts,
        status,
        progress: normalizedTaskProgress,
        message: latestPayload.message || ''
      })

      if (extra) {
        const mappedProgress =
          normalizedTaskProgress === null ? 92 : Math.round(90 + normalizedTaskProgress * 0.09)
        const progressMessage =
          status === 'pending'
            ? '正在排队分析文案'
            : normalizedTaskProgress === null
              ? `正在反推提示词（${status || 'processing'}）`
              : `正在反推提示词 ${normalizedTaskProgress}%`
        await this.reportProgress(extra, mappedProgress, progressMessage)
      }

      if (status === 'success') {
        const rawContent = String(
          latestPayload.result?.response?.choices?.[0]?.message?.content || latestPayload.result?.assistant || ''
        ).trim()
        if (!rawContent) {
          throw new Error(`Chat task succeeded but returned empty content: ${JSON.stringify(latestPayload)}`)
        }

        return {
          model: String(latestPayload.model || latestPayload.result?.response?.model || analysisModel || 'unknown'),
          raw: rawContent,
          parsed: this.tryParseJson(rawContent)
        }
      }

      if (status === 'failed' || status === 'error') {
        throw new Error(`Chat task failed: ${latestPayload.error || latestPayload.message || 'unknown error'}`)
      }

      await new Promise((resolve) => setTimeout(resolve, CHAT_POLL_INTERVAL_MS))
    }

    throw new Error(`Chat task timed out after ${CHAT_POLL_TIMEOUT_MS}ms: ${JSON.stringify(latestPayload)}`)
  }

  private async cleanupTempArtifacts(artifacts: TempArtifacts) {
    await fs.rm(artifacts.tempDir, { recursive: true, force: true }).catch(() => undefined)
  }

  private async extractSocialCopywritingPrompt(args: Record<string, unknown>, extra: ToolExecutionExtra) {
    const toolCallId = typeof args[INTERNAL_TOOL_CALL_ID_KEY] === 'string' ? String(args[INTERNAL_TOOL_CALL_ID_KEY]) : ''
    if (toolCallId) {
      extra.toolCallId = toolCallId
      logger.info('[social-copywriting] direct progress bridge attached', {
        requestId: extra.requestId,
        toolCallId
      })
    }
    const shareText = this.getRequiredString(args, 'shareText', 'url', 'share_text')
    const platform = this.detectPlatform(shareText, args.platform)
    const keepTempFiles = Boolean(args.keepTempFiles)
    const topic = typeof args.topic === 'string' ? args.topic.trim() : ''
    const analysisModel =
      typeof args.analysisModel === 'string' && args.analysisModel.trim() ? args.analysisModel.trim() : 'gpt-5.5'
    const flowLogContext: StepLogContext = {
      platform,
      shareText: shareText.slice(0, 200),
      keepTempFiles,
      topic,
      analysisModel
    }
    const overallTimer = this.createStepTimer('extract_prompt', flowLogContext)
    let artifacts: TempArtifacts | null = null

    try {
      this.ensureNotAborted(extra)
      await this.reportProgress(extra, 5, 'AI正在解析...')
      const parseTimer = this.createStepTimer('parse_share_link', flowLogContext)
      const parsed = await this.parseSocialLink(platform, shareText)
      const videoUrl = String(parsed.data?.video?.url || '').trim()
      parseTimer.success({
        resolvedPlatform: parsed.data?.platform || platform,
        hasVideoUrl: Boolean(videoUrl),
        title: parsed.data?.title || '',
        author: parsed.data?.author?.nickname || ''
      })
      artifacts = await this.createTempArtifacts(videoUrl)

      this.ensureNotAborted(extra)
      await this.reportProgress(extra, 15, 'AI正在分析视频结构...')
      const downloadTimer = this.createStepTimer('download_video', {
        ...flowLogContext,
        videoUrl
      })
      const videoSize = await this.downloadToFile(videoUrl, artifacts.videoPath)
      downloadTimer.success({
        videoPath: artifacts.videoPath,
        videoSize
      })

      this.ensureNotAborted(extra)
      await this.reportProgress(extra, 30, 'AI正在分析文案...')
      const extractAudioTimer = this.createStepTimer('extract_audio', {
        ...flowLogContext,
        videoPath: artifacts.videoPath
      })
      await this.extractAudioToMp3(artifacts.videoPath, artifacts.audioPath)
      extractAudioTimer.success({
        audioPath: artifacts.audioPath
      })

      this.ensureNotAborted(extra)
      await this.reportProgress(extra, 45, '深度思考文案特色...')
      const uploadTimer = this.createStepTimer('upload_audio_to_oss', {
        ...flowLogContext,
        audioPath: artifacts.audioPath
      })
      const uploadedAudio = await this.uploadLocalFileToTempOss(artifacts.audioPath, 'audio/mpeg')
      uploadTimer.success({
        objectKey: uploadedAudio.objectKey,
        audioOssUrl: uploadedAudio.publicUrl
      })

      this.ensureNotAborted(extra)
      await this.reportProgress(extra, 60, '深度思考文案结构...')
      const asrSubmitTimer = this.createStepTimer('submit_asr_task', {
        ...flowLogContext,
        audioOssUrl: uploadedAudio.publicUrl
      })
      const asrSubmit = await this.submitAsrTask(uploadedAudio.signedPublicUrl || uploadedAudio.publicUrl)
      asrSubmitTimer.success({
        taskId: asrSubmit.task_id,
        effectMode: asrSubmit.effect_mode || 'basic'
      })

      this.ensureNotAborted(extra)
      await this.reportProgress(extra, 70, '深度思考用词习惯...')
      const asrWaitTimer = this.createStepTimer('wait_asr_result', {
        ...flowLogContext,
        taskId: asrSubmit.task_id
      })
      const asrStatus = await this.waitForAsrResult(String(asrSubmit.task_id), extra)
      asrWaitTimer.success({
        taskId: asrSubmit.task_id,
        status: asrStatus.status,
        taskProgress: asrStatus.progress ?? null
      })
      const transcript = String(asrStatus.result?.content || '').trim()
      if (!transcript) {
        throw new Error('ASR completed but result.content is empty')
      }
      logger.info('[social-copywriting] transcript:ready', {
        ...flowLogContext,
        taskId: asrSubmit.task_id,
        transcriptLength: transcript.length
      })

      this.ensureNotAborted(extra)
      await this.reportProgress(extra, 90, '正在分析文案结构并反推提示词')
      const analysisTimer = this.createStepTimer('analyze_prompt', {
        ...flowLogContext,
        taskId: asrSubmit.task_id,
        transcriptLength: transcript.length
      })
      const analysis = await this.analyzeTranscript(transcript, parsed.data, topic, analysisModel, extra)
      analysisTimer.success({
        model: analysis.model,
        parsedJson: Boolean(analysis.parsed),
        rawResponseLength: analysis.raw.length
      })
      const resultPayload = {
        provider: 'vectcut',
        action: SOCIAL_COPYWRITING_TOOL_NAME,
        request: {
          platform,
          shareText,
          topic,
          analysisModel
        },
        parsed_source: {
          platform: parsed.data?.platform || platform,
          title: parsed.data?.title || '',
          desc: parsed.data?.desc || '',
          author: parsed.data?.author?.nickname || '',
          original_url: parsed.data?.original_url || '',
          source_video_url: videoUrl
        },
        media: {
          downloaded_video_size: videoSize,
          audio_oss_url: uploadedAudio.publicUrl,
          audio_oss_signed_url: uploadedAudio.signedPublicUrl
        },
        asr: {
          task_id: asrSubmit.task_id,
          effect_mode: asrSubmit.effect_mode || 'basic',
          status: asrStatus.status,
          transcript
        },
        analysis: {
          model: analysis.model,
          prompt_json: analysis.parsed,
          raw_response: analysis.raw
        }
      }

      logger.info('Extracted social copywriting prompt', {
        platform,
        taskId: asrSubmit.task_id,
        model: analysis.model
      })

      await this.reportProgress(extra, 100, '提示词提取完成')
      overallTimer.success({
        taskId: asrSubmit.task_id,
        model: analysis.model
      })

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(resultPayload, null, 2)
          }
        ]
      }
    } catch (error) {
      overallTimer.fail(error)
      throw error
    } finally {
      if (!keepTempFiles && artifacts) {
        logger.info('[social-copywriting] cleanup_temp:start', {
          ...flowLogContext
        })
        await this.cleanupTempArtifacts(artifacts)
        logger.info('[social-copywriting] cleanup_temp:success', {
          ...flowLogContext,
          tempDir: artifacts.tempDir
        })
      }
    }
  }
}

export default SocialCopywritingServer
