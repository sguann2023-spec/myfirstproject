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
import type { ProgressToken } from '@modelcontextprotocol/sdk/types.js'
import Store from 'electron-store'
import { net } from 'electron'

const logger = loggerService.withContext('MCPServer:DigitalHuman')
const execFileAsync = promisify(execFile)
const ffprobeStatic = require('ffprobe-static') as { path?: string }

const API_HOST = 'https://open.vectcut.com'
const DIGITAL_HUMAN_CREATE_ENDPOINT = '/cut_jianying/digital_human/create'
const DIGITAL_HUMAN_STATUS_ENDPOINT = '/cut_jianying/digital_human/task_status'
const OMNI_DIGITAL_HUMAN_SUBMIT_ENDPOINT = '/cut_jianying/digital_human/omni/submit'
const OMNI_DIGITAL_HUMAN_STATUS_ENDPOINT = '/cut_jianying/digital_human/omni/task_status'
const SEEDANCE_DIGITAL_HUMAN_SUBMIT_ENDPOINT = '/llm/digital_human/seedance/submit'
const SEEDANCE_DIGITAL_HUMAN_STATUS_ENDPOINT = '/llm/digital_human/seedance/task_status'
const OAUTH_TOKEN_URL = 'https://mlbd8l6vgi13-demo.authing.cn/oidc/token'
const OAUTH_CLIENT_ID = '6901dd145dafc6f1f3143938'
const OAUTH_CLIENT_SECRET = '16a94e467e927cc09b3c8dc7ec92d420'
const DEFAULT_OMNI_OUTPUT_RESOLUTION = 1080
const DIGITAL_HUMAN_TASK_WAIT_TIME = '15-30 minutes'
const DIGITAL_HUMAN_POLL_INTERVAL_MS = 5 * 1000
const DIGITAL_HUMAN_POLL_TIMEOUT_MS = 35 * 60 * 1000
const FILE_UPLOAD_BUCKET = 'oss-hangzhou-mp4'
const FILE_UPLOAD_REGION = 'oss-cn-hangzhou'
const FILE_UPLOAD_FOLDER_TEMPLATE = 'agent_tmp/{uid}'
const FILE_UPLOAD_OBJECT_KEY_PREFIX = 'vectcut_digital_human_'
const FILE_UPLOAD_SIGN_EXPIRES_SECONDS = 60 * 60
const FFMPEG_TIMEOUT_MS = 5 * 60 * 1000
const FFPROBE_TIMEOUT_MS = 15 * 1000
const PROCESS_MAX_BUFFER = 1024 * 1024

const CREATE_LIP_SYNC_DIGITAL_HUMAN_TOOL: Tool = {
  name: 'create_lip_sync_digital_human',
  description:
    'Create a lip-sync digital human video from one audio source and one portrait video source, and wait until the same tool call finishes with the final video result. Remote URLs are accepted directly, and local file URLs or absolute local paths are uploaded internally when needed.',
  inputSchema: {
    type: 'object',
    properties: {
      audioUrl: {
        type: 'string',
        description: 'Required source audio URL, file URL, or absolute local path.'
      },
      videoUrl: {
        type: 'string',
        description: 'Required portrait video URL, file URL, or absolute local path.'
      }
    },
    required: ['audioUrl', 'videoUrl'],
    additionalProperties: false
  }
}

const GET_LIP_SYNC_DIGITAL_HUMAN_STATUS_TOOL: Tool = {
  name: 'get_lip_sync_digital_human_status',
  description: 'Backward-compatible status query for a lip-sync digital human task.',
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
  description:
    'Create a Jimeng Omni image-driven digital human video from one audio source, one portrait image, and one scene prompt, and wait until the same tool call finishes with the final video result. Remote URLs are accepted directly, and local file URLs or absolute local paths are uploaded internally when needed.',
  inputSchema: {
    type: 'object',
    properties: {
      audioUrl: {
        type: 'string',
        description: 'Required source audio URL, file URL, or absolute local path. Must not exceed 60 seconds.'
      },
      imageUrl: {
        type: 'string',
        description: 'Required portrait image URL, file URL, or absolute local path.'
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
  description: 'Backward-compatible status query for a Jimeng Omni image-driven digital human task.',
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

const CREATE_OMNI_IMAGE_DRIVEN_DIGITAL_HUMAN_TOOL: Tool = {
  name: 'create_omni_image_driven_digital_human',
  description: CREATE_IMAGE_DRIVEN_DIGITAL_HUMAN_TOOL.description,
  inputSchema: CREATE_IMAGE_DRIVEN_DIGITAL_HUMAN_TOOL.inputSchema
}

const GET_OMNI_IMAGE_DRIVEN_DIGITAL_HUMAN_STATUS_TOOL: Tool = {
  name: 'get_omni_image_driven_digital_human_status',
  description: GET_IMAGE_DRIVEN_DIGITAL_HUMAN_STATUS_TOOL.description,
  inputSchema: GET_IMAGE_DRIVEN_DIGITAL_HUMAN_STATUS_TOOL.inputSchema
}

const CREATE_SEEDANCE_DIGITAL_HUMAN_TOOL: Tool = {
  name: 'create_seedance_digital_human',
  description:
    'Create a Seedance image-driven digital human video from one portrait image, one copywriting text, and one voice ID, and wait until the same tool call finishes with the final video result. Remote image URLs are accepted directly, and local file URLs or absolute local paths are uploaded internally when needed.',
  inputSchema: {
    type: 'object',
    properties: {
      imageUrl: {
        type: 'string',
        description: 'Required portrait image URL, file URL, or absolute local path.'
      },
      copywriting: {
        type: 'string',
        description: 'Required spoken copywriting content.'
      },
      voiceId: {
        type: 'string',
        description: 'Required voice ID used to synthesize the digital human audio.'
      }
    },
    required: ['imageUrl', 'copywriting', 'voiceId'],
    additionalProperties: false
  }
}

const GET_SEEDANCE_DIGITAL_HUMAN_STATUS_TOOL: Tool = {
  name: 'get_seedance_digital_human_status',
  description: 'Backward-compatible status query for a Seedance image-driven digital human task.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'Required Seedance digital human task ID.'
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

type PreparedDigitalHumanSource = {
  fieldName: string
  originalInput: string
  submittedUrl: string
  sourceKind: 'remote_url' | 'local_file'
}

type FfprobeVideoStream = {
  codec_type?: string
  width?: number
  height?: number
  tags?: {
    rotate?: string
  }
  side_data_list?: Array<{
    rotation?: number
  }>
}

type FfprobeResult = {
  streams?: FfprobeVideoStream[]
}

type DigitalHumanCreateResponse = {
  message?: string
  task_id?: string
  status?: string
  success?: boolean
  [key: string]: unknown
}

type DigitalHumanStatusResponse = {
  digital_human_url?: string
  video_url?: string
  task_status?: number | string
  status?: string
  progress?: number | null
  message?: string | null
  success?: boolean
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
        CREATE_IMAGE_DRIVEN_DIGITAL_HUMAN_TOOL,
        CREATE_OMNI_IMAGE_DRIVEN_DIGITAL_HUMAN_TOOL,
        CREATE_SEEDANCE_DIGITAL_HUMAN_TOOL
      ]
    }))

    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const toolName = request.params.name
      const args = request.params.arguments ?? {}

      try {
        switch (toolName) {
          case 'create_lip_sync_digital_human':
            return await this.createLipSyncDigitalHuman(args as Record<string, unknown>, extra as ToolExecutionExtra)
          case 'get_lip_sync_digital_human_status':
            return await this.getLipSyncDigitalHumanStatus(args as Record<string, unknown>)
          case 'create_image_driven_digital_human':
          case 'create_omni_image_driven_digital_human':
            return await this.createImageDrivenDigitalHuman(args as Record<string, unknown>, extra as ToolExecutionExtra)
          case 'get_image_driven_digital_human_status':
          case 'get_omni_image_driven_digital_human_status':
            return await this.getImageDrivenDigitalHumanStatus(args as Record<string, unknown>)
          case 'create_seedance_digital_human':
            return await this.createSeedanceDigitalHuman(args as Record<string, unknown>, extra as ToolExecutionExtra)
          case 'get_seedance_digital_human_status':
            return await this.getSeedanceDigitalHumanStatus(args as Record<string, unknown>)
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

  private normalizeSource(value: string): string {
    if (value.startsWith('file://')) {
      return fileURLToPath(value)
    }
    return value
  }

  private resolveBundledFfmpegPath() {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
    const binaryName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
    const candidate = path.join(getResourcePath(), 'ffmpeg', process.platform, arch, binaryName)
    return fs.existsSync(candidate) ? candidate : null
  }

  private resolveFfprobePath() {
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
      if (candidate === 'ffprobe' || fs.existsSync(candidate)) {
        return candidate
      }
    }

    return 'ffprobe'
  }

  private parseJsonFromFfprobe(rawOutput: string): FfprobeResult {
    const text = String(rawOutput || '').trim()
    const jsonStart = text.indexOf('{')
    if (jsonStart === -1) {
      throw new Error('ffprobe did not return JSON output')
    }
    return JSON.parse(text.slice(jsonStart)) as FfprobeResult
  }

  private async probeVideoOrientation(filePath: string) {
    const ffprobePath = this.resolveFfprobePath()
    const { stdout, stderr } = await execFileAsync(
      ffprobePath,
      [
        '-v',
        'error',
        '-show_streams',
        '-show_entries',
        'stream=codec_type,width,height:stream_tags=rotate',
        '-of',
        'json',
        filePath
      ],
      {
        windowsHide: true,
        timeout: FFPROBE_TIMEOUT_MS,
        maxBuffer: PROCESS_MAX_BUFFER
      }
    )

    const probe = this.parseJsonFromFfprobe(`${String(stdout || '')}\n${String(stderr || '')}`)
    const videoStream = (probe.streams || []).find((stream) => stream.codec_type === 'video') || probe.streams?.[0]
    const width = Number(videoStream?.width || 0)
    const height = Number(videoStream?.height || 0)
    const rawRotation =
      Number(videoStream?.side_data_list?.find((item) => Number.isFinite(item?.rotation))?.rotation || 0) ||
      Number(videoStream?.tags?.rotate || 0)
    const normalizedRotation = ((rawRotation % 360) + 360) % 360

    return {
      width,
      height,
      rotation: normalizedRotation
    }
  }

  private async runFfmpeg(args: string[]) {
    const bundledFfmpegPath = this.resolveBundledFfmpegPath()
    const ffmpegCommand = bundledFfmpegPath || 'ffmpeg'

    await execFileAsync(ffmpegCommand, args, {
      windowsHide: true,
      timeout: FFMPEG_TIMEOUT_MS,
      maxBuffer: PROCESS_MAX_BUFFER
    })
  }

  private async normalizePortraitVideoIfNeeded(filePath: string, fieldName: string) {
    const orientation = await this.probeVideoOrientation(filePath)
    const shouldBakeRotation =
      (orientation.rotation === 90 || orientation.rotation === 270) &&
      orientation.width > 0 &&
      orientation.height > 0 &&
      orientation.width >= orientation.height

    if (!shouldBakeRotation) {
      return filePath
    }

    const outputPath = path.join(
      await fsPromises.mkdtemp(path.join(os.tmpdir(), 'vectcut-digital-human-portrait-')),
      `${path.parse(filePath).name}_portrait_fixed.mp4`
    )

    logger.info('Normalizing local portrait video before digital human upload', {
      fieldName,
      filePath,
      width: orientation.width,
      height: orientation.height,
      rotation: orientation.rotation,
      outputPath
    })

    // Let ffmpeg apply the embedded display rotation while re-encoding so the
    // output pixels become truly portrait and no longer depend on rotation metadata.
    await this.runFfmpeg(['-y', '-i', filePath, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'copy', '-movflags', '+faststart', outputPath])

    return outputPath
  }

  private async uploadLocalFile(filePath: string) {
    return ossUploadService.uploadLocalFile(filePath, {
      bucket: FILE_UPLOAD_BUCKET,
      region: FILE_UPLOAD_REGION,
      folder: FILE_UPLOAD_FOLDER_TEMPLATE,
      objectKeyPrefix: FILE_UPLOAD_OBJECT_KEY_PREFIX,
      signExpiresSeconds: FILE_UPLOAD_SIGN_EXPIRES_SECONDS
    })
  }

  private async prepareSource(source: string, fieldName: string): Promise<PreparedDigitalHumanSource> {
    const normalized = this.normalizeSource(source)
    if (/^https?:\/\//i.test(normalized)) {
      return {
        fieldName,
        originalInput: normalized,
        submittedUrl: normalized,
        sourceKind: 'remote_url'
      }
    }

    if (!path.isAbsolute(normalized)) {
      throw new McpError(ErrorCode.InvalidParams, `'${fieldName}' must be a remote URL, file URL, or absolute local path`)
    }

    const stats = await fsPromises.stat(normalized)
    if (!stats.isFile()) {
      throw new McpError(ErrorCode.InvalidParams, `'${fieldName}' local path must point to a file`)
    }

    let uploadPath = normalized
    if (fieldName === 'videoUrl') {
      try {
        uploadPath = await this.normalizePortraitVideoIfNeeded(normalized, fieldName)
      } catch (error) {
        logger.warn('Failed to normalize local portrait video before digital human upload, fallback to original file', {
          fieldName,
          filePath: normalized,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    const uploaded = await this.uploadLocalFile(uploadPath)
    return {
      fieldName,
      originalInput: normalized,
      submittedUrl: uploaded.signedPublicUrl,
      sourceKind: 'local_file'
    }
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

  private extractVideoUrl(result: DigitalHumanStatusResponse): string | undefined {
    const candidate = typeof result.video_url === 'string' ? result.video_url : result.digital_human_url
    return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined
  }

  private normalizeStatus(value: unknown): string {
    return String(value || '').trim().toLowerCase()
  }

  private isCompleted(mode: 'lip_sync' | 'image_driven' | 'seedance_image_driven', result: DigitalHumanStatusResponse): boolean {
    if (mode === 'lip_sync') {
      return String(result.task_status ?? '').trim() === '1'
    }
    const status = this.normalizeStatus(result.status)
    return Boolean(this.extractVideoUrl(result)) || status === 'success' || status === 'succeeded' || status === 'completed'
  }

  private isFailed(result: DigitalHumanStatusResponse): boolean {
    const status = this.normalizeStatus(result.status)
    return status === 'failed' || status === 'error' || status === 'cancelled' || status === 'not_found'
  }

  private mapProgress(result: DigitalHumanStatusResponse, attempt: number): number {
    if (typeof result.progress === 'number' && Number.isFinite(result.progress)) {
      const numericProgress = result.progress <= 1 ? result.progress * 100 : result.progress
      return Math.max(12, Math.min(95, Math.round(numericProgress)))
    }
    return Math.min(92, 12 + attempt * 5)
  }

  private async queryStatus(endpoint: string, taskId: string): Promise<DigitalHumanStatusResponse> {
    const response = await this.requestWithAuth(endpoint, {
      method: 'GET',
      query: {
        task_id: taskId
      }
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Digital human status query failed (${response.status}): ${body || 'unknown error'}`)
    }

    return (await response.json()) as DigitalHumanStatusResponse
  }

  private async waitForResult(
    mode: 'lip_sync' | 'image_driven' | 'seedance_image_driven',
    taskId: string,
    statusEndpoint: string,
    extra: ToolExecutionExtra | undefined,
    processingMessage: string
  ) {
    const deadline = Date.now() + DIGITAL_HUMAN_POLL_TIMEOUT_MS
    let attempt = 0

    while (Date.now() < deadline) {
      attempt += 1
      const result = await this.queryStatus(statusEndpoint, taskId)

      if (this.isCompleted(mode, result)) {
        await this.reportProgress(extra, 100, result.message || '数字人生成完成')
        return result
      }

      if (this.isFailed(result)) {
        throw new Error(`Digital human task failed: ${result.message || result.status || 'unknown error'}`)
      }

      await this.reportProgress(extra, this.mapProgress(result, attempt), result.message || processingMessage)
      await this.sleep(DIGITAL_HUMAN_POLL_INTERVAL_MS)
    }

    throw new Error('Digital human task timed out after 35 minutes while waiting for completion')
  }

  private async submitAndWait(args: {
    mode: 'lip_sync' | 'image_driven' | 'seedance_image_driven'
    submitEndpoint: string
    statusEndpoint: string
    requestBody: Record<string, unknown>
    outputResolution?: number
    sourceSummary: PreparedDigitalHumanSource[]
    extra?: ToolExecutionExtra
    processingMessage: string
    submitMessage: string
  }) {
    await this.reportProgress(args.extra, 5, args.submitMessage)
    const response = await this.requestWithAuth(args.submitEndpoint, {
      method: 'POST',
      body: args.requestBody
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Digital human creation failed (${response.status}): ${body || 'unknown error'}`)
    }

    const submitResult = (await response.json()) as DigitalHumanCreateResponse
    const taskId = String(submitResult.task_id || '').trim()
    if (!taskId) {
      throw new Error(`Digital human submission returned no task ID: ${JSON.stringify(submitResult)}`)
    }

    await this.reportProgress(args.extra, 12, '数字人任务已提交，预计 15-30 分钟完成')
    const finalResult = await this.waitForResult(args.mode, taskId, args.statusEndpoint, args.extra, args.processingMessage)
    const videoUrl = this.extractVideoUrl(finalResult)

    return this.formatJsonResult({
      provider: 'vectcut',
      mode: args.mode,
      action: 'submit_and_wait',
      estimated_wait_time: DIGITAL_HUMAN_TASK_WAIT_TIME,
      task_id: taskId,
      output_resolution: args.outputResolution,
      source_summary: args.sourceSummary.map((item) => ({
        field_name: item.fieldName,
        original_input: item.originalInput,
        submitted_url: item.submittedUrl,
        source_kind: item.sourceKind
      })),
      output: {
        video_url: videoUrl
      },
      ...submitResult,
      ...finalResult,
      ...(videoUrl ? { video_url: videoUrl } : {})
    })
  }

  private async createLipSyncDigitalHuman(args: Record<string, unknown>, extra?: ToolExecutionExtra) {
    const audioInput = this.getRequiredString(args, 'audioUrl', 'audio_url')
    const videoInput = this.getRequiredString(args, 'videoUrl', 'video_url')
    const preparedAudio = await this.prepareSource(audioInput, 'audioUrl')
    const preparedVideo = await this.prepareSource(videoInput, 'videoUrl')

    return this.submitAndWait({
      mode: 'lip_sync',
      submitEndpoint: DIGITAL_HUMAN_CREATE_ENDPOINT,
      statusEndpoint: DIGITAL_HUMAN_STATUS_ENDPOINT,
      requestBody: {
        audio_url: preparedAudio.submittedUrl,
        video_url: preparedVideo.submittedUrl
      },
      sourceSummary: [preparedAudio, preparedVideo],
      extra,
      processingMessage: '正在生成口型驱动数字人',
      submitMessage: '正在提交口型驱动数字人任务'
    })
  }

  private async getLipSyncDigitalHumanStatus(args: Record<string, unknown>) {
    const taskId = this.getRequiredString(args, 'taskId', 'task_id')
    const result = await this.queryStatus(DIGITAL_HUMAN_STATUS_ENDPOINT, taskId)

    return this.formatJsonResult({
      provider: 'vectcut',
      mode: 'lip_sync',
      action: 'status',
      task_id: taskId,
      ...result
    })
  }

  private async createImageDrivenDigitalHuman(args: Record<string, unknown>, extra?: ToolExecutionExtra) {
    const audioInput = this.getRequiredString(args, 'audioUrl', 'audio_url')
    const imageInput = this.getRequiredString(args, 'imageUrl', 'image_url')
    const prompt = this.getRequiredString(args, 'prompt')
    const outputResolution =
      typeof args.outputResolution === 'number'
        ? args.outputResolution
        : typeof args.output_resolution === 'number'
          ? args.output_resolution
          : DEFAULT_OMNI_OUTPUT_RESOLUTION
    const preparedAudio = await this.prepareSource(audioInput, 'audioUrl')
    const preparedImage = await this.prepareSource(imageInput, 'imageUrl')

    return this.submitAndWait({
      mode: 'image_driven',
      submitEndpoint: OMNI_DIGITAL_HUMAN_SUBMIT_ENDPOINT,
      statusEndpoint: OMNI_DIGITAL_HUMAN_STATUS_ENDPOINT,
      requestBody: {
        audio_url: preparedAudio.submittedUrl,
        image_url: preparedImage.submittedUrl,
        prompt,
        output_resolution: outputResolution
      },
      outputResolution,
      sourceSummary: [preparedAudio, preparedImage],
      extra,
      processingMessage: '正在生成图片驱动数字人',
      submitMessage: '正在提交图片驱动数字人任务'
    })
  }

  private async getImageDrivenDigitalHumanStatus(args: Record<string, unknown>) {
    const taskId = this.getRequiredString(args, 'taskId', 'task_id')
    const result = await this.queryStatus(OMNI_DIGITAL_HUMAN_STATUS_ENDPOINT, taskId)

    return this.formatJsonResult({
      provider: 'vectcut',
      mode: 'image_driven',
      action: 'status',
      task_id: taskId,
      ...result
    })
  }

  private async createSeedanceDigitalHuman(args: Record<string, unknown>, extra?: ToolExecutionExtra) {
    const imageInput = this.getRequiredString(args, 'imageUrl', 'image_url')
    const copywriting = this.getRequiredString(args, 'copywriting')
    const voiceId = this.getRequiredString(args, 'voiceId', 'voice_id')
    const preparedImage = await this.prepareSource(imageInput, 'imageUrl')

    return this.submitAndWait({
      mode: 'seedance_image_driven',
      submitEndpoint: SEEDANCE_DIGITAL_HUMAN_SUBMIT_ENDPOINT,
      statusEndpoint: SEEDANCE_DIGITAL_HUMAN_STATUS_ENDPOINT,
      requestBody: {
        image_url: preparedImage.submittedUrl,
        copywriting,
        voice_id: voiceId
      },
      sourceSummary: [preparedImage],
      extra,
      processingMessage: '正在生成 Seedance 数字人',
      submitMessage: '正在提交 Seedance 数字人任务'
    })
  }

  private async getSeedanceDigitalHumanStatus(args: Record<string, unknown>) {
    const taskId = this.getRequiredString(args, 'taskId', 'task_id')
    const result = await this.queryStatus(SEEDANCE_DIGITAL_HUMAN_STATUS_ENDPOINT, taskId)

    return this.formatJsonResult({
      provider: 'vectcut',
      mode: 'seedance_image_driven',
      action: 'status',
      task_id: taskId,
      ...result
    })
  }
}

export default DigitalHumanServer
