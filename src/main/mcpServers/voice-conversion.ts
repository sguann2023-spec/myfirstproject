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

const logger = loggerService.withContext('MCPServer:VoiceConversion')
const execFileAsync = promisify(execFile)
const ffprobeStatic = require('ffprobe-static') as { path?: string }

const API_HOST = 'https://open.vectcut.com'
const VOICE_CONVERSION_SUBMIT_ENDPOINT = '/llm/sts/submit/generate'
const VOICE_CONVERSION_STATUS_ENDPOINT = '/llm/sts/submit/task_status'
const OAUTH_TOKEN_URL = 'https://mlbd8l6vgi13-demo.authing.cn/oidc/token'
const OAUTH_CLIENT_ID = '6901dd145dafc6f1f3143938'
const OAUTH_CLIENT_SECRET = '16a94e467e927cc09b3c8dc7ec92d420'
const FILE_UPLOAD_BUCKET = 'oss-hangzhou-mp4'
const FILE_UPLOAD_REGION = 'oss-cn-hangzhou'
const FILE_UPLOAD_FOLDER_TEMPLATE = 'agent_tmp/{uid}'
const FILE_UPLOAD_OBJECT_KEY_PREFIX = 'vectcut_voice_conversion_'
const FILE_UPLOAD_SIGN_EXPIRES_SECONDS = 60 * 60
const MAX_VOICE_CONVERSION_DURATION_SECONDS = 5 * 60
const MAX_LOCAL_MEDIA_FILE_SIZE_BYTES = 500 * 1024 * 1024
const PROCESS_TIMEOUT_MS = 15 * 60 * 1000
const FFPROBE_TIMEOUT_MS = 30 * 1000
const PROCESS_MAX_BUFFER = 1024 * 1024
const VOICE_CONVERSION_TASK_WAIT_TIME = '1-5 minutes'
const VOICE_CONVERSION_POLL_INTERVAL_MS = 5 * 1000
const VOICE_CONVERSION_POLL_TIMEOUT_MS = 10 * 60 * 1000
const isHttpLikeUrl = (value: string) => /^https?:\/\//i.test(value)

type VoiceConversionOutputMediaKind = 'audio' | 'video'

const SUBMIT_VOICE_CONVERSION_TASK_TOOL: Tool = {
  name: 'submit_voice_conversion_task',
  description:
    'Submit a voice conversion task for an audio or video source and a target ElevenLabs voice ID, then wait inside this tool call until the final converted result is ready. This keeps the source performance and converts the voice timbre instead of re-synthesizing text with TTS. Remote URLs are accepted directly, and local file URLs or absolute local paths are uploaded internally when needed.',
  inputSchema: {
    type: 'object',
    properties: {
      audioUrl: {
        type: 'string',
        description: 'Source audio URL, file URL, or absolute local path. Provide this or videoUrl.'
      },
      audio_url: {
        type: 'string',
        description: 'Alias of audioUrl. Uses the same semantics as the VectCut API docs.'
      },
      videoUrl: {
        type: 'string',
        description: 'Source video URL, file URL, or absolute local path. Provide this or audioUrl.'
      },
      video_url: {
        type: 'string',
        description: 'Alias of videoUrl. Uses the same semantics as the VectCut API docs.'
      },
      voiceId: {
        type: 'string',
        description: 'Target voice ID. The upstream API currently expects an ElevenLabs voice ID.'
      },
      voice_id: {
        type: 'string',
        description: 'Alias of voiceId. Uses the same semantics as the VectCut API docs.'
      }
    },
    additionalProperties: true
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

type VoiceConversionSubmitResponse = {
  error?: string
  message_id?: string
  queue_name?: string
  status?: string
  success?: boolean
  task_id?: string
  [key: string]: unknown
}

type VoiceConversionTaskStatusResponse = {
  audio_url?: string
  billing?: Record<string, unknown>
  error?: string
  id?: string
  message?: string
  progress?: number
  result?: {
    billing?: Record<string, unknown>
    converted_url?: string
    [key: string]: unknown
  }
  status?: string
  success?: boolean
  task_id?: string
  video_url?: string
  voice_id?: string
  [key: string]: unknown
}

type VoiceConversionMediaProbe = {
  durationSeconds: number | null
  hasAudio: boolean
  hasVideo: boolean
}

type PreparedVoiceConversionSource = {
  cleanup?: () => Promise<void>
  inputMediaKind?: 'audio' | 'video'
  localVideoJob?: LocalVideoMergeJob
  originalInput: string
  preprocessing?: string
  submittedField: 'audio_url' | 'video_url'
  submittedUrl: string
  sourceKind: 'remote_media' | 'local_media'
}

type LocalVideoMergeJob = {
  convertedAudioUrl?: string
  mergedVideoPath?: string
  originalVideoPath: string
  outputPath?: string
  submittedAudioUrl: string
}

type WorkspaceMediaArtifact = {
  contentType?: string
  filePath: string
  mediaKind: VoiceConversionOutputMediaKind
  relativePath: string
  sizeBytes?: number
}

function sanitizePathSegment(value: string): string {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

class VoiceConversionServer {
  public mcpServer: McpServer
  private readonly store = new Store({ name: 'vectcut' })
  private readonly workspacePath?: string
  private accessToken: PendingToken | null = null
  private refreshPromise: Promise<string> | null = null
  private readonly localVideoTasks = new Map<string, LocalVideoMergeJob>()

  constructor(workspacePath?: string) {
    this.workspacePath = workspacePath
    this.mcpServer = new McpServer(
      {
        name: 'voice-conversion',
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
      tools: [SUBMIT_VOICE_CONVERSION_TASK_TOOL]
    }))

    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const toolName = request.params.name
      const args = request.params.arguments ?? {}

      try {
        switch (toolName) {
          case 'submit_voice_conversion_task':
            return await this.submitVoiceConversionTask(args as Record<string, unknown>, extra as ToolExecutionExtra | undefined)
          case 'get_voice_conversion_task_status':
            return await this.getVoiceConversionTaskStatus(args as Record<string, unknown>)
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

  private resolveWorkspaceRoot(): string {
    const workspaceRoot = String(this.workspacePath || process.env.WORKSPACE_ROOT || '').trim()
    if (!workspaceRoot || !path.isAbsolute(workspaceRoot)) {
      return ''
    }
    return path.normalize(path.resolve(workspaceRoot))
  }

  private inferResultExtension(source: string, mediaKind: VoiceConversionOutputMediaKind, contentType?: string) {
    const normalizedContentType = String(contentType || '').toLowerCase()
    if (normalizedContentType.includes('audio/mpeg') || normalizedContentType.includes('audio/mp3')) return '.mp3'
    if (normalizedContentType.includes('audio/wav')) return '.wav'
    if (normalizedContentType.includes('audio/mp4') || normalizedContentType.includes('audio/aac')) return '.m4a'
    if (normalizedContentType.includes('video/mp4')) return '.mp4'
    if (normalizedContentType.includes('video/quicktime')) return '.mov'
    if (normalizedContentType.includes('video/webm')) return '.webm'

    try {
      const pathname = isHttpLikeUrl(source) ? new URL(source).pathname : source
      const ext = path.extname(pathname).toLowerCase()
      if (/^\.(mp3|wav|m4a|aac|ogg|flac|mp4|mov|m4v|webm|mkv|avi)$/.test(ext)) {
        return ext
      }
    } catch {
      // Fall back below when the URL/path cannot be parsed.
    }

    return mediaKind === 'video' ? '.mp4' : '.mp3'
  }

  private buildWorkspaceResultPath(taskId: string, mediaKind: VoiceConversionOutputMediaKind, source: string, contentType?: string) {
    const workspaceRoot = this.resolveWorkspaceRoot()
    if (!workspaceRoot) {
      return null
    }
    const safeTaskId = sanitizePathSegment(taskId) || `result-${Date.now()}`
    const ext = this.inferResultExtension(source, mediaKind, contentType)
    return path.join(workspaceRoot, `voice-conversion-${safeTaskId}${ext}`)
  }

  private async persistRemoteResultToWorkspace(input: {
    taskId: string
    mediaKind: VoiceConversionOutputMediaKind
    url: string
  }): Promise<WorkspaceMediaArtifact | null> {
    const response = await net.fetch(input.url)
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`Voice conversion result download failed (${response.status}): ${text || 'unknown error'}`)
    }

    const contentType = response.headers.get('content-type') || undefined
    const outputPath = this.buildWorkspaceResultPath(input.taskId, input.mediaKind, input.url, contentType)
    if (!outputPath) {
      return null
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    await fsPromises.mkdir(path.dirname(outputPath), { recursive: true })
    await fsPromises.writeFile(outputPath, buffer)

    const workspaceRoot = this.resolveWorkspaceRoot()
    return {
      contentType,
      filePath: outputPath,
      mediaKind: input.mediaKind,
      relativePath: path.relative(workspaceRoot, outputPath) || path.basename(outputPath),
      sizeBytes: buffer.length
    }
  }

  private async persistLocalResultToWorkspace(input: {
    taskId: string
    mediaKind: VoiceConversionOutputMediaKind
    filePath: string
  }): Promise<WorkspaceMediaArtifact | null> {
    const normalizedPath = input.filePath.startsWith('file://') ? fileURLToPath(input.filePath) : input.filePath
    const outputPath = this.buildWorkspaceResultPath(input.taskId, input.mediaKind, normalizedPath)
    if (!outputPath) {
      return null
    }

    await fsPromises.mkdir(path.dirname(outputPath), { recursive: true })
    if (path.resolve(normalizedPath) !== path.resolve(outputPath)) {
      await fsPromises.copyFile(normalizedPath, outputPath)
    }
    const stats = await fsPromises.stat(outputPath)
    const workspaceRoot = this.resolveWorkspaceRoot()
    return {
      filePath: outputPath,
      mediaKind: input.mediaKind,
      relativePath: path.relative(workspaceRoot, outputPath) || path.basename(outputPath),
      sizeBytes: stats.size
    }
  }

  private async persistResultToWorkspace(input: {
    convertedUrl: string
    localVideoMerge?: Record<string, unknown>
    request?: Record<string, unknown>
    taskId: string
  }): Promise<WorkspaceMediaArtifact | null> {
    if (!this.resolveWorkspaceRoot()) {
      return null
    }

    const localMergedVideoPath = typeof input.localVideoMerge?.merged_video_path === 'string'
      ? input.localVideoMerge.merged_video_path.trim()
      : ''
    if (localMergedVideoPath) {
      return this.persistLocalResultToWorkspace({
        taskId: input.taskId,
        mediaKind: 'video',
        filePath: localMergedVideoPath
      })
    }

    if (!input.convertedUrl) {
      return null
    }

    const mediaKind: VoiceConversionOutputMediaKind = input.request?.video_url ? 'video' : 'audio'
    const normalizedUrl = input.convertedUrl.startsWith('file://') ? fileURLToPath(input.convertedUrl) : input.convertedUrl
    if (isHttpLikeUrl(normalizedUrl)) {
      return this.persistRemoteResultToWorkspace({
        taskId: input.taskId,
        mediaKind,
        url: normalizedUrl
      })
    }
    if (path.isAbsolute(normalizedUrl)) {
      return this.persistLocalResultToWorkspace({
        taskId: input.taskId,
        mediaKind,
        filePath: normalizedUrl
      })
    }

    return null
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

  private normalizeVoiceConversionTaskStatus(status: unknown): string {
    return String(status || '').trim().toLowerCase()
  }

  private isVoiceConversionTaskCompleted(result: VoiceConversionTaskStatusResponse): boolean {
    const status = this.normalizeVoiceConversionTaskStatus(result.status)
    return status === 'success' || status === 'completed' || status === 'finished' || status === 'done'
  }

  private isVoiceConversionTaskFailed(result: VoiceConversionTaskStatusResponse): boolean {
    const status = this.normalizeVoiceConversionTaskStatus(result.status)
    return status === 'failed' || status === 'error' || status === 'cancelled' || status === 'canceled'
  }

  private mapVoiceConversionProgress(result: VoiceConversionTaskStatusResponse, attempt: number): number {
    if (typeof result.progress === 'number' && Number.isFinite(result.progress)) {
      const numericProgress = result.progress <= 1 ? result.progress * 100 : result.progress
      return Math.max(12, Math.min(95, Math.round(numericProgress)))
    }
    return Math.min(92, 12 + attempt * 6)
  }

  private normalizeSource(value: unknown, fieldName: string): string {
    const raw = typeof value === 'string' ? value.trim() : ''
    if (!raw) {
      throw new McpError(ErrorCode.InvalidParams, `'${fieldName}' cannot be empty`)
    }
    if (raw.startsWith('file://')) {
      return fileURLToPath(raw)
    }
    return raw
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

  private resolveFfmpegPath() {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
    const binaryName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
    const candidate = path.join(getResourcePath(), 'ffmpeg', process.platform, arch, binaryName)
    return fs.existsSync(candidate) ? candidate : 'ffmpeg'
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
    return [packaged, bundled, unpacked, 'ffprobe'].find((candidate) =>
      candidate && (candidate === 'ffprobe' || fs.existsSync(candidate))
    ) || 'ffprobe'
  }

  private parseProbeDuration(probe: { streams?: { duration?: number | string }[]; format?: { duration?: number | string } }) {
    const values = [probe.format?.duration, ...(probe.streams || []).map((stream) => stream.duration)]
      .map(Number)
      .filter((value) => Number.isFinite(value) && value > 0)
    return values.length ? Math.max(...values) : null
  }

  private async probeMedia(source: string): Promise<VoiceConversionMediaProbe> {
    let probeOutput = ''
    try {
      const { stdout, stderr } = await execFileAsync(
        this.resolveFfprobePath(),
        ['-v', 'error', '-show_entries', 'stream=codec_type,duration:format=duration', '-of', 'json', source],
        { windowsHide: true, timeout: FFPROBE_TIMEOUT_MS, maxBuffer: PROCESS_MAX_BUFFER }
      )
      probeOutput = `${stdout || ''}\n${stderr || ''}`
    } catch (error) {
      throw new Error(`无法读取音视频信息：${error instanceof Error ? error.message : String(error)}`)
    }

    const jsonStart = probeOutput.indexOf('{')
    if (jsonStart < 0) {
      throw new Error('无法读取音视频信息')
    }

    let probe: { streams?: { codec_type?: string; duration?: number | string }[]; format?: { duration?: number | string } }
    try {
      probe = JSON.parse(probeOutput.slice(jsonStart))
    } catch {
      throw new Error('无法解析音视频信息')
    }

    const streams = probe.streams || []
    return {
      durationSeconds: this.parseProbeDuration(probe),
      hasAudio: streams.some((stream) => stream.codec_type === 'audio'),
      hasVideo: streams.some((stream) => stream.codec_type === 'video')
    }
  }

  private assertMediaWithinVoiceConversionLimits(fieldName: string, stats: { size: number }, probe: VoiceConversionMediaProbe) {
    if (stats.size > MAX_LOCAL_MEDIA_FILE_SIZE_BYTES) {
      throw new McpError(ErrorCode.InvalidParams, `'${fieldName}' local file size cannot exceed 500MB`)
    }
    if (!probe.hasAudio) {
      throw new McpError(ErrorCode.InvalidParams, `'${fieldName}' must contain an audio track`)
    }
    if (probe.durationSeconds === null) {
      throw new McpError(ErrorCode.InvalidParams, `Could not determine '${fieldName}' duration`)
    }
    if (probe.durationSeconds > MAX_VOICE_CONVERSION_DURATION_SECONDS) {
      throw new McpError(ErrorCode.InvalidParams, `'${fieldName}' duration cannot exceed 5 minutes`)
    }
  }

  private async extractAudioForVoiceConversion(videoPath: string) {
    const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'vectcut-voice-conversion-'))
    const audioPath = path.join(tempDir, 'source-audio.mp3')
    try {
      await execFileAsync(
        this.resolveFfmpegPath(),
        ['-nostdin', '-y', '-i', videoPath, '-map', '0:a:0', '-vn', '-c:a', 'libmp3lame', '-q:a', '2', audioPath],
        { windowsHide: true, timeout: PROCESS_TIMEOUT_MS, maxBuffer: PROCESS_MAX_BUFFER }
      )
      return {
        audioPath,
        cleanup: () => fsPromises.rm(tempDir, { recursive: true, force: true })
      }
    } catch (error) {
      await fsPromises.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
      throw new Error(`提取本地视频音频失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async buildMergedVideoOutputPath(videoPath: string, taskId: string) {
    const workspaceOutputPath = this.buildWorkspaceResultPath(taskId, 'video', videoPath)
    if (workspaceOutputPath) {
      return workspaceOutputPath
    }

    const safeTaskId = sanitizePathSegment(taskId) || 'task'
    const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'vectcut-voice-conversion-merge-'))
    return path.join(tempDir, `voice-conversion-${safeTaskId}.mp4`)
  }

  private async mergeConvertedAudioIntoVideo(taskId: string, job: LocalVideoMergeJob, convertedAudioUrl: string) {
    if (job.mergedVideoPath && job.convertedAudioUrl === convertedAudioUrl) {
      return job.mergedVideoPath
    }

    const outputPath = job.outputPath || await this.buildMergedVideoOutputPath(job.originalVideoPath, taskId)
    await execFileAsync(
      this.resolveFfmpegPath(),
      [
        '-nostdin',
        '-y',
        '-i',
        job.originalVideoPath,
        '-i',
        convertedAudioUrl,
        '-map',
        '0:v:0',
        '-map',
        '1:a:0',
        '-c:v',
        'copy',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-shortest',
        outputPath
      ],
      { windowsHide: true, timeout: PROCESS_TIMEOUT_MS, maxBuffer: PROCESS_MAX_BUFFER }
    )

    job.convertedAudioUrl = convertedAudioUrl
    job.mergedVideoPath = outputPath
    return outputPath
  }

  private async prepareSource(input: unknown, fieldName: 'audio_url' | 'video_url'): Promise<PreparedVoiceConversionSource> {
    const normalizedSource = this.normalizeSource(input, fieldName)
    if (isHttpLikeUrl(normalizedSource)) {
      return {
        originalInput: typeof input === 'string' ? input.trim() : normalizedSource,
        submittedField: fieldName,
        submittedUrl: normalizedSource,
        sourceKind: 'remote_media'
      }
    }

    if (!path.isAbsolute(normalizedSource)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `'${fieldName}' must be a remote URL, file URL, or absolute local path`
      )
    }

    const stats = await fsPromises.stat(normalizedSource)
    if (!stats.isFile()) {
      throw new McpError(ErrorCode.InvalidParams, `'${fieldName}' must point to a local file`)
    }

    const probe = await this.probeMedia(normalizedSource)
    this.assertMediaWithinVoiceConversionLimits(fieldName, stats, probe)

    if (probe.hasVideo) {
      const extracted = await this.extractAudioForVoiceConversion(normalizedSource)
      try {
        const uploaded = await this.uploadLocalFile(extracted.audioPath)
        return {
          cleanup: extracted.cleanup,
          inputMediaKind: 'video',
          localVideoJob: {
            originalVideoPath: normalizedSource,
            submittedAudioUrl: uploaded.signedPublicUrl
          },
          originalInput: typeof input === 'string' ? input.trim() : normalizedSource,
          preprocessing: 'extracted_audio_from_local_video',
          submittedField: 'audio_url',
          submittedUrl: uploaded.signedPublicUrl,
          sourceKind: 'local_media'
        }
      } catch (error) {
        await extracted.cleanup().catch(() => undefined)
        throw error
      }
    }

    const uploaded = await this.uploadLocalFile(normalizedSource)
    return {
      inputMediaKind: 'audio',
      originalInput: typeof input === 'string' ? input.trim() : normalizedSource,
      submittedField: 'audio_url',
      submittedUrl: uploaded.signedPublicUrl,
      sourceKind: 'local_media'
    }
  }

  private async buildSubmitPayload(args: Record<string, unknown>) {
    const audioUrl = typeof args.audioUrl === 'string' ? args.audioUrl.trim() : ''
    const audioUrlAlias = typeof args.audio_url === 'string' ? args.audio_url.trim() : ''
    const videoUrl = typeof args.videoUrl === 'string' ? args.videoUrl.trim() : ''
    const videoUrlAlias = typeof args.video_url === 'string' ? args.video_url.trim() : ''
    const voiceId = typeof args.voiceId === 'string' ? args.voiceId.trim() : ''
    const voiceIdAlias = typeof args.voice_id === 'string' ? args.voice_id.trim() : ''

    const resolvedAudioUrl = audioUrl || audioUrlAlias
    const resolvedVideoUrl = videoUrl || videoUrlAlias
    const resolvedVoiceId = voiceId || voiceIdAlias

    if (!resolvedAudioUrl && !resolvedVideoUrl) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Either 'audioUrl'/'audio_url' or 'videoUrl'/'video_url' is required for submit_voice_conversion_task"
      )
    }

    if (resolvedAudioUrl && resolvedVideoUrl) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Provide only one source URL: either 'audioUrl'/'audio_url' or 'videoUrl'/'video_url'"
      )
    }

    if (!resolvedVoiceId) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "'voiceId'/'voice_id' is required for submit_voice_conversion_task"
      )
    }

    const preparedSource = resolvedAudioUrl
      ? await this.prepareSource(resolvedAudioUrl, 'audio_url')
      : await this.prepareSource(resolvedVideoUrl, 'video_url')

    return {
      payload: {
        [preparedSource.submittedField]: preparedSource.submittedUrl,
        voice_id: resolvedVoiceId
      },
      pendingLocalVideoJob: preparedSource.localVideoJob,
      sourceSummary: [
        {
          ...(preparedSource.inputMediaKind ? { input_media_kind: preparedSource.inputMediaKind } : {}),
          original_input: preparedSource.originalInput,
          ...(preparedSource.preprocessing ? { preprocessing: preparedSource.preprocessing } : {}),
          submitted_field: preparedSource.submittedField,
          submitted_url: preparedSource.submittedUrl,
          source_kind: preparedSource.sourceKind
        }
      ],
      cleanup: preparedSource.cleanup
    }
  }

  private async queryVoiceConversionTaskStatus(taskId: string): Promise<VoiceConversionTaskStatusResponse> {
    const response = await this.requestWithAuth(VOICE_CONVERSION_STATUS_ENDPOINT, {
      method: 'GET',
      query: new URLSearchParams({ task_id: taskId })
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Voice conversion status query failed (${response.status}): ${body || 'unknown error'}`)
    }

    const result = (await response.json()) as VoiceConversionTaskStatusResponse
    logger.info('Voice conversion task status queried', {
      taskId,
      status: result.status,
      success: result.success
    })
    return result
  }

  private async buildVoiceConversionTaskResultPayload(input: {
    action?: 'status' | 'submit_and_wait'
    request?: Record<string, unknown>
    result: VoiceConversionTaskStatusResponse
    sourceSummary?: Record<string, unknown>[]
    localVideoJob?: LocalVideoMergeJob
  }) {
    const { action = 'submit_and_wait', request, result, sourceSummary, localVideoJob } = input
    const taskId = String(result.task_id || result.id || '').trim()
    const convertedAudioUrl = String(result.result?.converted_url || '').trim()
    let localVideoMerge: Record<string, unknown> | undefined

    if (localVideoJob && convertedAudioUrl && taskId) {
      const mergedVideoPath = await this.mergeConvertedAudioIntoVideo(taskId, localVideoJob, convertedAudioUrl)
      localVideoMerge = {
        converted_audio_url: convertedAudioUrl,
        merged_video_path: mergedVideoPath,
        original_video_path: localVideoJob.originalVideoPath,
        status: 'merged'
      }
    } else if (localVideoJob) {
      localVideoMerge = {
        original_video_path: localVideoJob.originalVideoPath,
        status: 'waiting_for_converted_audio'
      }
    }

    const workspaceArtifact = taskId
      ? await this.persistResultToWorkspace({
        convertedUrl: convertedAudioUrl,
        localVideoMerge,
        request,
        taskId
      })
      : null
    if (workspaceArtifact && localVideoMerge) {
      localVideoMerge.workspace_file_path = workspaceArtifact.filePath
      localVideoMerge.workspace_relative_path = workspaceArtifact.relativePath
    }

    const nestedBilling = result.result?.billing
    const topLevelBilling = result.billing
    const normalized: Record<string, unknown> = {
      provider: 'vectcut',
      action,
      mode: 'voice_conversion',
      estimated_wait_time: VOICE_CONVERSION_TASK_WAIT_TIME,
      success: result.success,
      id: result.id,
      task_id: result.task_id || result.id,
      status: result.status,
      progress: result.progress,
      message: result.message,
      error: result.error,
      audio_url: result.audio_url,
      video_url: result.video_url,
      voice_id: result.voice_id
    }

    if (request) {
      normalized.request = request
    }
    if (Array.isArray(sourceSummary) && sourceSummary.length > 0) {
      normalized.source_summary = sourceSummary
    }
    if (nestedBilling && typeof nestedBilling === 'object' && !Array.isArray(nestedBilling)) {
      normalized.billing = nestedBilling
    } else if (topLevelBilling && typeof topLevelBilling === 'object' && !Array.isArray(topLevelBilling)) {
      normalized.billing = topLevelBilling
    }
    if (localVideoMerge) {
      normalized.local_video_merge = localVideoMerge
    }
    if (workspaceArtifact) {
      normalized.artifact = {
        storage: 'workspace_file',
        file_path: workspaceArtifact.filePath,
        relative_path: workspaceArtifact.relativePath,
        media_kind: workspaceArtifact.mediaKind,
        ...(workspaceArtifact.contentType ? { content_type: workspaceArtifact.contentType } : {}),
        ...(typeof workspaceArtifact.sizeBytes === 'number' ? { size_bytes: workspaceArtifact.sizeBytes } : {})
      }
    }
    if (result.result && (convertedAudioUrl || localVideoMerge?.merged_video_path)) {
      const workspaceResultUrl = workspaceArtifact?.filePath || ''
      const playableUrl = workspaceResultUrl || convertedAudioUrl
      if (convertedAudioUrl) {
        normalized.remote_url = convertedAudioUrl
      }
      if (playableUrl) {
        normalized.url = playableUrl
      }
      normalized.output = {
        ...(playableUrl ? { url: playableUrl } : {}),
        ...(playableUrl && workspaceArtifact?.mediaKind === 'video' ? { video_url: playableUrl } : {}),
        ...(playableUrl && workspaceArtifact?.mediaKind !== 'video' ? { audio_url: playableUrl } : {}),
        converted_url: result.result.converted_url,
        ...(convertedAudioUrl ? { remote_url: convertedAudioUrl } : {}),
        ...(localVideoMerge?.merged_video_path ? { merged_video_path: localVideoMerge.merged_video_path } : {})
      }
    }
    if (result.result) {
      normalized.result = {
        ...result.result,
        ...(workspaceArtifact
          ? {
            workspace_artifact: {
              storage: 'workspace_file',
              file_path: workspaceArtifact.filePath,
              relative_path: workspaceArtifact.relativePath,
              media_kind: workspaceArtifact.mediaKind
            }
          }
          : {}),
        ...(localVideoMerge ? { local_video_merge: localVideoMerge } : {})
      }
    }

    return normalized
  }

  private async submitVoiceConversionTask(args: Record<string, unknown>, extra?: ToolExecutionExtra) {
    await this.reportProgress(extra, 5, '正在提交变声任务')
    const { payload, sourceSummary, pendingLocalVideoJob, cleanup } = await this.buildSubmitPayload(args)
    try {
      const response = await this.requestWithAuth(VOICE_CONVERSION_SUBMIT_ENDPOINT, {
        method: 'POST',
        body: payload
      })

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new Error(`Voice conversion submit failed (${response.status}): ${body || 'unknown error'}`)
      }

      const result = (await response.json()) as VoiceConversionSubmitResponse
      const taskId = typeof result.task_id === 'string' ? result.task_id.trim() : ''
      if (!taskId) {
        throw new Error(`Voice conversion task submission returned no task ID: ${JSON.stringify(result)}`)
      }
      if (pendingLocalVideoJob) {
        this.localVideoTasks.set(taskId, pendingLocalVideoJob)
      }

      logger.info('Voice conversion task submitted', {
        taskId,
        voiceId: payload.voice_id
      })

      await this.reportProgress(extra, 12, '变声任务已提交，正在等待处理完成')

      const deadline = Date.now() + VOICE_CONVERSION_POLL_TIMEOUT_MS
      let attempt = 0
      while (Date.now() < deadline) {
        attempt += 1
        const statusResult = await this.queryVoiceConversionTaskStatus(taskId)
        if (this.isVoiceConversionTaskCompleted(statusResult)) {
          await this.reportProgress(extra, 100, statusResult.message || '变声处理完成')
          return this.formatJsonResult(
            await this.buildVoiceConversionTaskResultPayload({
              request: payload,
              result: statusResult,
              sourceSummary,
              localVideoJob: pendingLocalVideoJob
            })
          )
        }

        if (this.isVoiceConversionTaskFailed(statusResult)) {
          throw new Error(`Voice conversion task failed: ${statusResult.error || statusResult.message || 'unknown error'}`)
        }

        await this.reportProgress(
          extra,
          this.mapVoiceConversionProgress(statusResult, attempt),
          statusResult.message || '正在处理变声任务'
        )
        await this.sleep(VOICE_CONVERSION_POLL_INTERVAL_MS)
      }

      throw new Error('Voice conversion task timed out after 10 minutes while waiting for completion')
    } finally {
      await cleanup?.().catch(() => undefined)
    }
  }

  private async getVoiceConversionTaskStatus(args: Record<string, unknown>) {
    const taskId =
      typeof args.taskId === 'string'
        ? args.taskId.trim()
        : typeof args.task_id === 'string'
          ? args.task_id.trim()
          : ''

    if (!taskId) {
      throw new McpError(ErrorCode.InvalidParams, "'taskId'/'task_id' is required for get_voice_conversion_task_status")
    }

    const result = await this.queryVoiceConversionTaskStatus(taskId)
    const localVideoJob = this.localVideoTasks.get(taskId)
    return this.formatJsonResult(await this.buildVoiceConversionTaskResultPayload({
      action: 'status',
      result,
      localVideoJob
    }))
  }
}

export default VoiceConversionServer
