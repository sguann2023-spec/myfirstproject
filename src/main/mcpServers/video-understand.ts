import { randomUUID } from 'node:crypto'
import ipaddr from 'ipaddr.js'
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
import type { ProgressToken } from '@modelcontextprotocol/sdk/types.js'
import Store from 'electron-store'
import { net } from 'electron'

import { persistWorkspaceJsonArtifact } from './workspace-json-artifact'
import { SocialCopywritingBilling } from './social-copywriting-billing'

const logger = loggerService.withContext('MCPServer:VideoUnderstand')
const execFileAsync = promisify(execFile)
const ffprobeStatic = require('ffprobe-static') as { path?: string }

const API_HOST = 'https://open.vectcut.com'
const CHAT_COMPLETIONS_ENDPOINT = '/llm/chat/v1/chat/completions'
const OAUTH_TOKEN_URL = 'https://mlbd8l6vgi13-demo.authing.cn/oidc/token'
const OAUTH_CLIENT_ID = '6901dd145dafc6f1f3143938'
const OAUTH_CLIENT_SECRET = '16a94e467e927cc09b3c8dc7ec92d420'
const VIDEO_UNDERSTAND_MODEL = 'gpt-5.6-luna'
const DEFAULT_SAMPLE_FPS = 3
const DEFAULT_DESCRIPTION_SLICE_SECONDS = 0.3
const MAX_IMAGES_PER_BATCH = 30
const MAX_CONCURRENT_VIDEOS = 10
const GPT_REQUEST_MAX_RETRIES = 3
const FFMPEG_TIMEOUT_MS = 15 * 60 * 1000
const FFPROBE_TIMEOUT_MS = 15 * 1000
const PROCESS_MAX_BUFFER = 4 * 1024 * 1024
const FRAME_MAX_WIDTH = 854
const FRAME_MAX_HEIGHT = 480
const FRAME_JPEG_QUALITY = 70
const INLINE_DATA_URL_PREVIEW = '<data-url-omitted>'
const AUTH_EXPIRED_MESSAGE = '登录已过期，请重新登录后再试'

class VideoTaskQueue {
  private readonly concurrency: number
  private activeCount = 0
  private readonly pendingTasks: Array<() => void> = []

  constructor(concurrency: number) {
    this.concurrency = Math.max(1, Math.floor(concurrency) || 1)
  }

  public async add<T>(task: () => Promise<T>): Promise<T> {
    return await new Promise<T>((resolve, reject) => {
      const runTask = () => {
        this.activeCount += 1
        void task()
          .then(resolve, reject)
          .finally(() => {
            this.activeCount -= 1
            const nextTask = this.pendingTasks.shift()
            if (nextTask) {
              nextTask()
            }
          })
      }

      if (this.activeCount < this.concurrency) {
        runTask()
        return
      }

      this.pendingTasks.push(runTask)
    })
  }
}

const SUBMIT_VIDEO_DETAIL_TASK_TOOL: Tool = {
  name: 'submit_video_detail_task',
  description:
    'Understand one or more videos using frame batches (at most 30 frames, compressed to 480p) with gpt-5.6-luna, plus basic speech recognition without sentence splitting. Videos without audio or detected speech are marked explicitly. Full visual analysis, spoken subtitles and timestamps are saved into workspace files.',
  inputSchema: {
    type: 'object',
    properties: {
      model: {
        type: 'string',
        enum: [VIDEO_UNDERSTAND_MODEL],
        description: 'Optional model. Always uses gpt-5.6-luna.'
      },
      prompt: {
        type: 'string',
        description: 'Optional custom question or instruction for video understanding.'
      },
      question: {
        type: 'string',
        description: 'Alias of prompt.'
      },
      videoUrl: {
        type: 'string',
        description: 'Single video URL, file URL, absolute local path, or workspace-relative local path.'
      },
      video_url: {
        type: 'string',
        description: 'Alias of videoUrl.'
      },
      videoUrls: {
        type: 'array',
        items: {
          type: 'string'
        },
        description: 'Multiple video URLs, file URLs, absolute local paths, or workspace-relative local paths.'
      },
      video_urls: {
        type: 'array',
        items: {
          type: 'string'
        },
        description: 'Alias of videoUrls.'
      },
      fps: {
        type: 'number',
        description: `Optional frame sampling rate. Supports decimal and integer values such as 0.1 or 10. Defaults to ${DEFAULT_SAMPLE_FPS} fps.`
      },
      fps_list: {
        type: 'array',
        items: {
          type: 'number'
        },
        description: 'Optional frame sampling rates aligned with videoUrls/video_urls. Each item supports decimal and integer values such as 0.1 or 10.'
      }
    },
    additionalProperties: true
  }
}

const EXTERNAL_TASK_TIMEOUT_MS = 30 * 60 * 1000
const EXTERNAL_TASK_TTL_MS = 24 * 60 * 60 * 1000
const EXTERNAL_TASK_CAPACITY = 100
const EXTERNAL_TOOLS: Tool[] = [
  {
    ...SUBMIT_VIDEO_DETAIL_TASK_TOOL, name: 'submit',
    description: 'Submit public HTTP(S) videos for background frame and speech analysis. Returns a local task_id immediately; poll task_status. Tasks expire 24 hours after completion and do not survive app restart.',
    inputSchema: {
      ...SUBMIT_VIDEO_DETAIL_TASK_TOOL.inputSchema,
      properties: Object.fromEntries(Object.entries(SUBMIT_VIDEO_DETAIL_TASK_TOOL.inputSchema.properties || {}).map(([key, value]) =>
        [key, ['videoUrl', 'video_url', 'videoUrls', 'video_urls'].includes(key)
          ? { ...(value as object), description: 'Public HTTP(S) video URL(s) only; local/private sources are forbidden.' } : value]))
    }
  },
  { name: 'task_status', description: 'Read a local background task snapshot without contacting the backend.',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string' } }, required: ['task_id'], additionalProperties: false } }
]
type ExternalTask = {
  task_id: string; status: 'running' | 'success' | 'failed'; success: boolean
  created_at: number; completed_at?: number; result?: unknown; error?: string
}

// Syntax-only boundary, like image: no DNS/HEAD probes. This does NOT pin DNS or
// validate redirect destinations; the existing Electron downloader is not a full SSRF sandbox.
function validateExternalVideoReferences(args: Record<string, unknown>) {
  const check = (value: unknown, field: string) => {
    if (Array.isArray(value)) { value.forEach((entry) => check(entry, field)); return }
    if (value && typeof value === 'object') {
      const entries = Object.values(value)
      if (!entries.length) throw new Error(`'${field}' requires public HTTP(S) URLs`)
      entries.forEach((entry) => check(entry, field)); return
    }
    if (typeof value !== 'string' || !value || /[\\\s]/.test(value)) throw new Error(`'${field}' requires public HTTP(S) URLs`)
    let url: URL
    try { url = new URL(value) } catch { throw new Error(`'${field}' requires public HTTP(S) URLs`) }
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '')
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        (!ipaddr.isValid(host) && !host.includes('.')) || /(^|\.)(localhost|local|internal|test|invalid)$/.test(host) ||
        (ipaddr.isValid(host) && ipaddr.parse(host).range() !== 'unicast')) {
      throw new Error(`'${field}' requires public HTTP(S) URLs, not local/private addresses`)
    }
  }
  const visit = (record: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(record)) {
      if (/url|uri|path|file|source|video|image|audio|reference/i.test(key)) check(value, key)
      else if (value && typeof value === 'object') {
        if (Array.isArray(value)) value.forEach((entry) => { if (entry && typeof entry === 'object') visit(entry as Record<string, unknown>) })
        else visit(value as Record<string, unknown>)
      }
    }
  }
  visit(args)
}

type PendingToken = {
  accessToken: string
  expiresAt: number
}

type ToolExecutionExtra = {
  requestId: string | number
  signal?: AbortSignal
  onBilling?: (billing: Record<string, unknown> | null, stage?: string) => void
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

type FfprobeStream = {
  codec_name?: string
  codec_type?: string
  duration?: number | string
  height?: number
  width?: number
}

type FfprobeResult = {
  format?: {
    bit_rate?: string
    duration?: number | string
    format_name?: string
  }
  streams?: FfprobeStream[]
}

type ChatCompletionResponse = {
  id?: string
  model?: string
  billing?: Record<string, unknown>
  usage?: Record<string, unknown>
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>
      reasoning_content?: string
      role?: string
    }
  }>
  [key: string]: unknown
}

type PreparedVideoSource = {
  originalInput: string
  localPath: string
  sourceKind: 'remote_video' | 'local_video'
  cleanupDir: string | null
}

type SampledFrame = {
  frameIndex: number
  timestampStart: number
  timestampEnd: number
  originalPath: string
  compressedPath: string
}

type BatchAnalysisResult = {
  batchIndex: number
  frameCount: number
  frameStartIndex: number
  frameEndIndex: number
  timeRangeStartSeconds: number
  timeRangeEndSeconds: number
  answer: string
  billing: Record<string, unknown> | null
  responseSummary: {
    id?: string
    model: string
    choiceCount: number
  }
  retryCount: number
}

type StructuredVideoAnalysis = {
  title: string
  summary: string
  details: string
}

type VideoSpeechResult = {
  status: 'recognized' | 'no_speech' | 'no_audio' | 'failed'
  effect_mode: 'basic'
  content: string
  segments: Array<{ start?: number; end?: number; text?: string }>
  message?: string
  error_code?: unknown
  billing?: Record<string, unknown>
}

type VideoAnalysisResult = {
  videoIndex: number
  originalInput: string
  absolutePath: string | null
  sourceKind: 'remote_video' | 'local_video'
  fps: number
  durationSeconds: number
  totalFrames: number
  totalBatches: number
  analysis: StructuredVideoAnalysis
  speech?: VideoSpeechResult
  billing: {
    total_consumed_points: number
  }
  batches: BatchAnalysisResult[]
}

type TextArtifactResult = {
  filePath: string
  relativePath: string
}

type VideoResultFileReference = TextArtifactResult & {
  videoIndex: number
  originalInput: string
  absolutePath: string | null
  kind: 'video_result'
}

const isHttpLikeUrl = (value: string) => /^https?:\/\//i.test(value)
const toErrorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))
const sanitizePathSegment = (value: string) =>
  String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')

const asFiniteNumber = (value: unknown): number | null => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const toPositiveNumber = (value: unknown): number | null => {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null
}

const parseJsonFromFfprobe = (rawOutput: string): FfprobeResult => {
  const text = String(rawOutput || '').trim()
  const jsonStart = text.indexOf('{')
  if (jsonStart === -1) {
    throw new Error('ffprobe did not return JSON output')
  }
  return JSON.parse(text.slice(jsonStart)) as FfprobeResult
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

const clampSeconds = (value: number, max: number) => {
  if (!Number.isFinite(value)) return 0
  return Math.min(Math.max(value, 0), Math.max(max, 0))
}

const formatSeconds = (value: number) => {
  const normalized = Math.max(0, Number(value) || 0)
  return normalized.toFixed(3).replace(/\.?0+$/, '')
}

const formatTimeRange = (startSeconds: number, endSeconds: number) =>
  `${formatSeconds(startSeconds)}~${formatSeconds(Math.max(endSeconds, startSeconds))}秒`

const buildFrameLabel = (frame: SampledFrame) =>
  `帧 ${frame.frameIndex + 1}，时间 ${formatTimeRange(frame.timestampStart, frame.timestampEnd)}`

type TimeSlice = {
  startSeconds: number
  endSeconds: number
}

const toSliceIndex = (value: number) => Math.floor((Math.max(value, 0) + 1e-6) / DEFAULT_DESCRIPTION_SLICE_SECONDS)

const buildTimeSlicesForFrames = (frames: SampledFrame[]): TimeSlice[] => {
  if (frames.length === 0) return []

  const firstStart = Math.max(0, frames[0]?.timestampStart ?? 0)
  const lastEnd = Math.max(firstStart, frames[frames.length - 1]?.timestampEnd ?? firstStart)
  const startIndex = toSliceIndex(firstStart)
  const endIndex = Math.max(startIndex, Math.ceil(Math.max(lastEnd, firstStart) / DEFAULT_DESCRIPTION_SLICE_SECONDS) - 1)
  const slices: TimeSlice[] = []

  for (let index = startIndex; index <= endIndex; index += 1) {
    const startSeconds = Number((index * DEFAULT_DESCRIPTION_SLICE_SECONDS).toFixed(3))
    const endSeconds = Number(Math.min((index + 1) * DEFAULT_DESCRIPTION_SLICE_SECONDS, lastEnd).toFixed(3))
    if (endSeconds <= firstStart || startSeconds >= lastEnd + 1e-6) continue
    slices.push({
      startSeconds,
      endSeconds
    })
  }

  return slices
}

const buildBatchPrompt = (options: {
  prompt: string
  batchIndex: number
  batchCount: number
  totalFrames: number
  videoIndex: number
  videoCount: number
  fps: number
  slices: TimeSlice[]
}) => {
  const normalizedPrompt = String(options.prompt || '').trim()
  const sliceRanges = options.slices.map((slice) => formatTimeRange(slice.startSeconds, slice.endSeconds))
  const baseLines = [
    '你将收到同一个视频按时间顺序抽取的一批画面帧。',
    '每张图片前面的文字会给出该帧对应的时间范围。',
    '请严格按时间线理解这些画面，只描述视觉内容，不要臆测听到的音频。',
    `请严格按 0.3 秒时间片输出，禁止合并时间段，禁止遗漏时间片，禁止改写时间范围。`,
    '默认使用中文输出，每一行都必须使用“开始~结束秒的内容：描述”这个格式。',
    '即使相邻时间片内容相同，也要分别单独写一行。',
    '如果画面中有清晰可见的文字，请一并写出。',
    `当前是视频 ${options.videoIndex}/${options.videoCount} 的第 ${options.batchIndex}/${options.batchCount} 批，共 ${options.totalFrames} 帧，采样率 ${options.fps} fps。`,
    `你必须覆盖以下全部时间片：${sliceRanges.join('，')}。`
  ]

  if (normalizedPrompt) {
    baseLines.push(`用户补充要求：${normalizedPrompt}`)
  }

  return baseLines.join('\n')
}

function extractTextFromChunkRecord(record: Record<string, unknown>): string {
  const choices = Array.isArray(record.choices) ? record.choices : []
  const textParts: string[] = []

  for (const choice of choices) {
    if (!choice || typeof choice !== 'object') continue
    const choiceRecord = choice as Record<string, unknown>
    const delta =
      choiceRecord.delta && typeof choiceRecord.delta === 'object'
        ? (choiceRecord.delta as Record<string, unknown>)
        : null
    const message =
      choiceRecord.message && typeof choiceRecord.message === 'object'
        ? (choiceRecord.message as Record<string, unknown>)
        : null

    for (const candidate of [delta, message]) {
      if (!candidate) continue
      for (const key of ['content', 'reasoning_content']) {
        const value = candidate[key]
        if (typeof value === 'string' && value.trim()) {
          textParts.push(value)
          continue
        }
        if (Array.isArray(value)) {
          for (const item of value) {
            if (!item || typeof item !== 'object') continue
            const part = item as Record<string, unknown>
            if (part.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
              textParts.push(part.text)
            }
          }
        }
      }
    }
  }

  return textParts.join('').trim()
}

function extractTextFromSseString(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('data:'))

  if (lines.length === 0) return text

  const textParts: string[] = []
  for (const line of lines) {
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    try {
      const parsed = JSON.parse(payload) as Record<string, unknown>
      const extracted = extractTextFromChunkRecord(parsed)
      if (extracted) {
        textParts.push(extracted)
      }
    } catch {
      return text
    }
  }

  return textParts.join('').trim() || text
}

function parseSseChatCompletionPayload(text: string): ChatCompletionResponse | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('data:'))

  if (lines.length === 0) return null

  const textParts: string[] = []
  let latestId: string | undefined
  let latestModel: string | undefined
  let latestBilling: Record<string, unknown> | undefined
  let latestUsage: Record<string, unknown> | undefined

  for (const line of lines) {
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') continue

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(payload) as Record<string, unknown>
    } catch {
      return null
    }

    const extractedText = extractTextFromChunkRecord(parsed)
    if (extractedText) {
      textParts.push(extractedText)
    }

    if (typeof parsed.id === 'string' && parsed.id.trim()) {
      latestId = parsed.id.trim()
    }
    if (typeof parsed.model === 'string' && parsed.model.trim()) {
      latestModel = parsed.model.trim()
    }
    if (parsed.billing && typeof parsed.billing === 'object' && !Array.isArray(parsed.billing)) {
      latestBilling = parsed.billing as Record<string, unknown>
    }
    if (parsed.usage && typeof parsed.usage === 'object' && !Array.isArray(parsed.usage)) {
      latestUsage = parsed.usage as Record<string, unknown>
    }
  }

  const content = textParts.join('').trim()
  if (!content && !latestBilling && !latestUsage) {
    return null
  }

  return {
    ...(latestId ? { id: latestId } : {}),
    model: latestModel || VIDEO_UNDERSTAND_MODEL,
    ...(latestBilling ? { billing: latestBilling } : {}),
    ...(latestUsage ? { usage: latestUsage } : {}),
    choices: content
      ? [
          {
            message: {
              role: 'assistant',
              content
            }
          }
        ]
      : []
  }
}

function parseChatCompletionPayload(responseText: string): ChatCompletionResponse {
  try {
    return JSON.parse(responseText) as ChatCompletionResponse
  } catch {
    const ssePayload = parseSseChatCompletionPayload(responseText)
    if (!ssePayload) {
      const extractedText = extractTextFromSseString(responseText)
      if (!extractedText || extractedText === responseText) {
        throw new Error(`Unexpected token in video understand response: ${responseText.slice(0, 120)}`)
      }
      return {
        model: VIDEO_UNDERSTAND_MODEL,
        choices: [
          {
            message: {
              role: 'assistant',
              content: extractedText
            }
          }
        ]
      }
    }
    if (!ssePayload.choices || ssePayload.choices.length === 0) {
      throw new Error(`Unexpected token in video understand response: ${responseText.slice(0, 120)}`)
    }
    return ssePayload
  }
}

function extractCompletionText(payload: ChatCompletionResponse): string {
  const choices = Array.isArray(payload.choices) ? payload.choices : []
  const textParts: string[] = []

  for (const choice of choices) {
    const message = choice?.message
    if (!message) continue
    if (typeof message.content === 'string' && message.content.trim()) {
      textParts.push(message.content.trim())
      continue
    }
    if (Array.isArray(message.content)) {
      const contentText = message.content
        .map((item) => (item?.type === 'text' && typeof item.text === 'string' ? item.text : ''))
        .filter(Boolean)
        .join('\n')
        .trim()
      if (contentText) {
        textParts.push(contentText)
      }
    }
  }

  return textParts.join('\n').trim()
}

type ParsedRangeDescription = {
  startSeconds: number
  endSeconds: number
  description: string
}

function parseRangeDescriptions(text: string): ParsedRangeDescription[] {
  const pattern =
    /(\d+(?:\.\d+)?)~(\d+(?:\.\d+)?)秒的内容[:：]\s*([\s\S]*?)(?=(?:\d+(?:\.\d+)?~\d+(?:\.\d+)?秒的内容[:：])|$)/g
  const matches: ParsedRangeDescription[] = []

  for (const match of text.matchAll(pattern)) {
    const startSeconds = Number(match[1])
    const endSeconds = Number(match[2])
    const description = String(match[3] || '')
      .replace(/\s+/g, ' ')
      .trim()

    if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || !description) {
      continue
    }

    matches.push({
      startSeconds,
      endSeconds: Math.max(endSeconds, startSeconds),
      description
    })
  }

  return matches
}

function normalizeAnswerToFixedSlices(rawAnswer: string, slices: TimeSlice[]): string {
  const trimmedAnswer = String(rawAnswer || '').trim()
  if (!trimmedAnswer || slices.length === 0) {
    return trimmedAnswer
  }

  const parsedRanges = parseRangeDescriptions(trimmedAnswer)
  if (parsedRanges.length === 0) {
    return slices.map((slice) => `${formatTimeRange(slice.startSeconds, slice.endSeconds)}的内容：${trimmedAnswer}`).join('\n')
  }

  const normalizedLines = slices.map((slice) => {
    const overlap = parsedRanges.find(
      (item) => item.startSeconds < slice.endSeconds - 1e-6 && item.endSeconds > slice.startSeconds + 1e-6
    )
    const description = overlap?.description || parsedRanges[parsedRanges.length - 1]?.description || '画面信息不足'
    return `${formatTimeRange(slice.startSeconds, slice.endSeconds)}的内容：${description}`
  })

  return Array.from(new Set(normalizedLines)).join('\n')
}

function buildStructuredVideoAnalysis(details: string): StructuredVideoAnalysis {
  const normalizedDetails = String(details || '').trim()
  if (!normalizedDetails) {
    return {
      title: '未产出结果',
      summary: '未产出视频理解结果。',
      details: ''
    }
  }

  const detailDescriptions = normalizedDetails
    .split('\n')
    .map((line) => String(line || '').trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^[^：]+：(.+)$/)
      return String(match?.[1] || line).trim()
    })

  const condensedDescriptions = detailDescriptions.filter((description, index) => description && description !== detailDescriptions[index - 1])
  const titleSource = condensedDescriptions[0] || '视频内容概述'
  const normalizedTitleSource = titleSource.replace(/[。；;，,、]+$/g, '')
  const title = (normalizedTitleSource || '视频内容概述').slice(0, 20)

  const summaryParts: string[] = []
  for (const description of condensedDescriptions) {
    const nextSummary = summaryParts.length === 0 ? description : `${summaryParts.join('；')}；${description}`
    if (nextSummary.length > 200) break
    summaryParts.push(description)
    if (summaryParts.length >= 3) break
  }

  return {
    title: title || '视频内容概述',
    summary: summaryParts.join('；').slice(0, 200) || title || '视频内容概述',
    details: normalizedDetails
  }
}

class VideoUnderstandServer {
  public mcpServer: McpServer
  private readonly store = new Store({ name: 'vectcut' })
  private readonly workspacePath?: string
  private accessToken: PendingToken | null = null
  private refreshPromise: Promise<string> | null = null
  private static readonly videoQueue = new VideoTaskQueue(MAX_CONCURRENT_VIDEOS)

  private readonly external: boolean
  private readonly externalTasks = new Map<string, ExternalTask>()
  private externalWorkCount = 0

  constructor(workspacePathOrOptions?: string | { external?: boolean; workspacePath?: string }, options: { external?: boolean } = {}) {
    this.workspacePath = typeof workspacePathOrOptions === 'string' ? workspacePathOrOptions : workspacePathOrOptions?.workspacePath
    this.external = (typeof workspacePathOrOptions === 'object' ? workspacePathOrOptions.external : options.external) === true
    this.mcpServer = this.createMcpServer()
  }

  public createMcpServer(): McpServer {
    const mcpServer = new McpServer(
      {
        name: 'video-understand',
        version: '2.0.0'
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
      tools: this.external ? EXTERNAL_TOOLS : [SUBMIT_VIDEO_DETAIL_TASK_TOOL]
    }))

    mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const toolName = request.params.name
      const args = request.params.arguments ?? {}

      try {
        if (this.external) {
          if (toolName === 'submit') return await this.submitExternalTask(args)
          if (toolName === 'task_status') {
            this.pruneExternalTasks()
            const task = typeof args.task_id === 'string' ? this.externalTasks.get(args.task_id.trim()) : undefined
            if (!task) throw new Error('Unknown or expired task_id')
            return { ...this.formatJsonResult({ ...task }), ...(task.status === 'failed' ? { isError: true } : {}) }
          }
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`)
        }
        switch (toolName) {
          case 'submit_video_detail_task':
            return await this.submitVideoDetailTask(args as Record<string, unknown>, extra as ToolExecutionExtra)
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

  private pruneExternalTasks() {
    for (const [id, task] of this.externalTasks) {
      if (task.completed_at !== undefined && Date.now() - task.completed_at >= EXTERNAL_TASK_TTL_MS) this.externalTasks.delete(id)
    }
  }

  private async submitExternalTask(args: Record<string, unknown>) {
    validateExternalVideoReferences(args)
    await this.buildJobConfig(args) // Parameter validation only: no downloads or auth.
    this.pruneExternalTasks()
    if (this.externalTasks.size >= EXTERNAL_TASK_CAPACITY || this.externalWorkCount >= MAX_CONCURRENT_VIDEOS) throw new Error('Background task capacity reached; retry after tasks expire')
    const task: ExternalTask = { task_id: randomUUID(), status: 'running', success: true, created_at: Date.now() }
    this.externalTasks.set(task.task_id, task)
    const input = structuredClone(args)
    this.externalWorkCount += 1
    setImmediate(() => {
      const controller = new AbortController()
      let timer: ReturnType<typeof setTimeout>
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('Video understanding timed out after 30 minutes')) }, EXTERNAL_TASK_TIMEOUT_MS)
      })
      // Parsing belongs to the background deadline too. Never use transport cancellation/progress.
      const work = async () => {
        const response = await this.submitVideoDetailTask({ ...input, includeSummaries: true }, { requestId: task.task_id, signal: controller.signal })
        const result = JSON.parse(response.content[0].text)
        return result
      }
      void Promise.race([work().finally(() => { this.externalWorkCount -= 1 }), timeout]).then((result) => {
        const failed = result.success === false || Boolean(result.error)
        Object.assign(task, { status: failed ? 'failed' : 'success', success: !failed, result,
          ...(failed ? { error: String(result.error || 'Video understanding failed') } : {}) })
      }).catch((error) => {
        Object.assign(task, { status: 'failed', success: false, error: toErrorMessage(error) })
      }).finally(() => { clearTimeout(timer!); task.completed_at = Date.now() })
    })
    return this.formatJsonResult({ ...task })
  }

  public async executeDirectRequest(args: Record<string, unknown>, extra: ToolExecutionExtra) {
    const { default: SocialCopywritingServer } = await import('./social-copywriting')
    const parser = new SocialCopywritingServer()
    const stages: Array<{ stage: string; points_consumed?: number }> = []
    let response: Record<string, any> = {}
    const snapshot = (complete: boolean) => {
      const known = stages.filter((stage) => stage.points_consumed !== undefined)
      return {
        ...(known.length ? { total_consumed_points: Number(known.reduce((sum, stage) => sum + stage.points_consumed!, 0).toFixed(10)) } : {}),
        complete: complete && stages.every((stage) => stage.points_consumed !== undefined),
        stages,
      }
    }
    try {
      const sources = Array.isArray(args.videoUrls) ? args.videoUrls : [args.videoUrl]
      const videoUrls: string[] = []
      for (const source of sources) {
        if (extra.signal?.aborted) throw new Error('任务已取消')
        const billing = new SocialCopywritingBilling(['parse_share_link'])
        let resolvedSource: string | undefined
        try {
          resolvedSource = isHttpLikeUrl(String(source))
            ? await parser.resolveVideoShareLink(String(source), billing, extra.signal)
            : String(source)
          videoUrls.push(resolvedSource)
        } finally {
          const charge = billing.snapshot().billing.stages[0]
          if (charge && resolvedSource !== String(source)) {
            stages.push(charge)
          }
        }
      }
      const result = await this.submitVideoDetailTask({ ...args, videoUrls, includeSummaries: true }, {
        ...extra,
        onBilling: (billing, stage = 'video_understand') => {
          const points = asFiniteNumber(billing?.total_consumed_points)
          stages.push({ stage, ...(points !== null ? { points_consumed: points } : {}) })
        },
      })
      response = JSON.parse(result.content[0].text)
      // The tool's aggregate vision billing is already represented by its frame batches.
      if (!stages.some((stage) => stage.stage === 'video_understand')) {
        stages.push({ stage: 'video_understand', points_consumed: Number(response.billing?.total_consumed_points) || 0 })
      }
      return this.formatJsonResult({ ...response, billing: snapshot(true) })
    } catch (error) {
      return {
        ...this.formatJsonResult({ ...response, error: toErrorMessage(error), billing: snapshot(false) }),
        isError: true,
      }
    } finally {
      await parser.mcpServer.close()
    }
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

  private getCachedVectcutApiKey(): string {
    return String(this.store.get('auth.vectcut_api_key') || process.env.VECTCUT_API_KEY || process.env.VECTCUT_APIKEY || '').trim()
  }

  private isAuthRefreshFailure(error: unknown): boolean {
    const message = toErrorMessage(error).toLowerCase()
    return (
      message.includes('invalid_grant') ||
      message.includes('refresh token') ||
      message.includes('no refresh token found') ||
      message.includes('token refresh failed')
    )
  }

  private toFriendlyAuthError(error: unknown): Error {
    if (this.isAuthRefreshFailure(error)) {
      return new Error(AUTH_EXPIRED_MESSAGE)
    }
    return error instanceof Error ? error : new Error(toErrorMessage(error))
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

  private async requestWithAuth(pathname: string, init: { body: Record<string, unknown> }): Promise<Response> {
    const url = new URL(`${API_HOST}${pathname}`)

    const doFetch = async (accessToken: string): Promise<Response> =>
      net.fetch(url.toString(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(init.body)
      })

    let token: string
    try {
      token = await this.ensureValidAccessToken()
    } catch (error) {
      const cachedToken = this.getCachedVectcutApiKey()
      if (!cachedToken) {
        throw this.toFriendlyAuthError(error)
      }
      logger.warn('Video understand failed to refresh access token, falling back to cached vectcut api key', {
        error: toErrorMessage(error)
      })
      token = cachedToken
    }

    let response = await doFetch(token)
    if (response.status === 401) {
      let refreshedToken: string
      try {
        refreshedToken = await this.ensureValidAccessToken(true)
      } catch (error) {
        throw this.toFriendlyAuthError(error)
      }
      response = await doFetch(refreshedToken)
      if (response.status === 401) {
        throw new Error(AUTH_EXPIRED_MESSAGE)
      }
    }

    return response
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

  private async runFfmpeg(args: string[]) {
    const bundledFfmpegPath = this.resolveBundledFfmpegPath()
    const ffmpegCommand = bundledFfmpegPath || 'ffmpeg'

    try {
      await execFileAsync(ffmpegCommand, args, {
        windowsHide: true,
        timeout: FFMPEG_TIMEOUT_MS,
        maxBuffer: PROCESS_MAX_BUFFER
      })
    } catch (error) {
      throw new Error(
        `Failed to run ffmpeg. Checked bundled binary: ${bundledFfmpegPath || 'not found'}, then PATH fallback. ${toErrorMessage(error)}`
      )
    }

    return ffmpegCommand
  }

  private async probeMedia(source: string) {
    const ffprobePath = this.resolveFfprobePath()

    try {
      const { stdout, stderr } = await execFileAsync(
        ffprobePath,
        ['-v', 'error', '-show_entries', 'stream=codec_name,codec_type,width,height,duration:format=duration,format_name,bit_rate', '-of', 'json', source],
        {
          windowsHide: true,
          timeout: FFPROBE_TIMEOUT_MS,
          maxBuffer: PROCESS_MAX_BUFFER
        }
      )
      return {
        ffprobePath,
        probe: parseJsonFromFfprobe(`${String(stdout || '')}\n${String(stderr || '')}`)
      }
    } catch (error) {
      throw new Error(`Failed to probe media with ffprobe (${ffprobePath}): ${toErrorMessage(error)}`)
    }
  }

  private resolveModel(value: unknown): typeof VIDEO_UNDERSTAND_MODEL {
    const normalized = typeof value === 'string' ? value.trim() : ''
    if (!normalized) {
      return VIDEO_UNDERSTAND_MODEL
    }
    if (normalized !== VIDEO_UNDERSTAND_MODEL) {
      throw new McpError(ErrorCode.InvalidParams, `'model' must be ${VIDEO_UNDERSTAND_MODEL}`)
    }
    return VIDEO_UNDERSTAND_MODEL
  }

  private normalizeSource(value: unknown): string {
    const raw = String(value || '').trim()
    if (!raw) {
      throw new McpError(ErrorCode.InvalidParams, 'Video source contains an empty value')
    }
    if (raw.startsWith('file://')) {
      return fileURLToPath(raw)
    }
    return raw
  }

  private resolveLocalPath(source: string): string {
    if (path.isAbsolute(source)) {
      return source
    }
    if (!this.workspacePath) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Local video paths must be absolute when the current workspace path is unavailable'
      )
    }
    return path.resolve(this.workspacePath, source)
  }

  private getRemoteExtension(remoteUrl: string) {
    try {
      const pathname = new URL(remoteUrl).pathname
      const extension = path.extname(pathname)
      return extension || '.mp4'
    } catch {
      return '.mp4'
    }
  }

  private async downloadRemoteVideo(remoteUrl: string, signal?: AbortSignal): Promise<{ filePath: string; cleanupDir: string }> {
    const cleanupDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'vectcut-video-understand-remote-'))
    const filePath = path.join(cleanupDir, `source${this.getRemoteExtension(remoteUrl)}`)
    try {
      const response = await (signal ? net.fetch(remoteUrl, { signal }) : net.fetch(remoteUrl))

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new Error(`Failed to download remote video (${response.status}): ${body || remoteUrl}`)
      }

      const buffer = Buffer.from(await response.arrayBuffer())
      signal?.throwIfAborted()
      await fsPromises.writeFile(filePath, buffer)
      return { filePath, cleanupDir }
    } catch (error) {
      await fsPromises.rm(cleanupDir, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
  }

  private async prepareVideoSource(input: unknown, signal?: AbortSignal): Promise<PreparedVideoSource> {
    const normalizedSource = this.normalizeSource(input)

    if (isHttpLikeUrl(normalizedSource)) {
      const downloaded = await this.downloadRemoteVideo(normalizedSource, signal)
      return {
        originalInput: normalizedSource,
        localPath: downloaded.filePath,
        sourceKind: 'remote_video',
        cleanupDir: downloaded.cleanupDir
      }
    }

    const resolvedPath = this.resolveLocalPath(normalizedSource)
    const stats = await fsPromises.stat(resolvedPath)
    if (!stats.isFile()) {
      throw new McpError(ErrorCode.InvalidParams, 'Local video source must point to a file')
    }

    return {
      originalInput: resolvedPath,
      localPath: resolvedPath,
      sourceKind: 'local_video',
      cleanupDir: null
    }
  }

  private normalizeNumberList(value: unknown, fieldName: string): number[] {
    if (typeof value === 'undefined') return []
    if (!Array.isArray(value)) {
      throw new McpError(ErrorCode.InvalidParams, `'${fieldName}' must be an array of numbers`)
    }
    return value.map((item) => this.normalizeFpsValue(item, fieldName))
  }

  private normalizeFpsValue(value: unknown, fieldName = 'fps') {
    const numeric = Number(value)
    if (!Number.isFinite(numeric) || numeric <= 0) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `'${fieldName}' must be a positive number. Decimal values like 0.1 and integer values like 10 are supported`
      )
    }
    return numeric
  }

  private async buildJobConfig(args: Record<string, unknown>) {
    const videoUrl = typeof args.videoUrl === 'string' ? args.videoUrl.trim() : ''
    const videoUrlAlias = typeof args.video_url === 'string' ? args.video_url.trim() : ''
    const videoUrls = Array.isArray(args.videoUrls)
      ? args.videoUrls.map((item) => String(item || '').trim()).filter(Boolean)
      : []
    const videoUrlsAlias = Array.isArray(args.video_urls)
      ? args.video_urls.map((item) => String(item || '').trim()).filter(Boolean)
      : []
    const prompt = String(args.prompt || args.question || '').trim()
    const model = this.resolveModel(args.model)
    const fps = typeof args.fps !== 'undefined' ? this.normalizeFpsValue(args.fps, 'fps') : DEFAULT_SAMPLE_FPS
    const fpsList = this.normalizeNumberList(args.fps_list, 'fps_list')

    const resolvedVideoUrl = videoUrl || videoUrlAlias
    const resolvedVideoUrls = videoUrls.length > 0 ? videoUrls : videoUrlsAlias

    if (!resolvedVideoUrl && resolvedVideoUrls.length === 0) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Either 'videoUrl'/'video_url' or 'videoUrls'/'video_urls' is required for submit_video_detail_task"
      )
    }

    if (resolvedVideoUrl && resolvedVideoUrls.length > 0) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Provide only one source form: either 'videoUrl'/'video_url' or 'videoUrls'/'video_urls'"
      )
    }

    if (resolvedVideoUrl && fpsList.length > 0) {
      throw new McpError(ErrorCode.InvalidParams, "'fps_list' is only supported with 'videoUrls'/'video_urls'")
    }

    if (resolvedVideoUrls.length > 0 && fpsList.length > 0 && fpsList.length !== resolvedVideoUrls.length) {
      throw new McpError(ErrorCode.InvalidParams, "'fps_list' length must match 'videoUrls'/'video_urls'")
    }

    const rawSources = resolvedVideoUrl ? [resolvedVideoUrl] : resolvedVideoUrls
    const fpsValues =
      rawSources.length === 1
        ? [fps]
        : fpsList.length > 0
          ? fpsList
          : rawSources.map(() => fps)

    return {
      model,
      prompt,
      videos: rawSources.map((source, index) => ({
        source,
        fps: fpsValues[index] || DEFAULT_SAMPLE_FPS
      }))
    }
  }

  private async extractFrames(videoPath: string, fps: number, outputDir: string) {
    await fsPromises.mkdir(outputDir, { recursive: true })
    await this.runFfmpeg([
      '-y',
      '-i',
      videoPath,
      '-vf',
      `fps=${fps}`,
      '-q:v',
      '2',
      path.join(outputDir, 'frame-%06d.jpg')
    ])

    const frameFiles = (await fsPromises.readdir(outputDir))
      .filter((name) => /^frame-\d+\.(jpg|jpeg|png)$/i.test(name))
      .sort((left, right) => left.localeCompare(right))
      .map((name) => path.join(outputDir, name))

    if (frameFiles.length === 0) {
      throw new Error('No frames were extracted from the video')
    }

    return frameFiles
  }

  private async compressFrame(framePath: string, outputPath: string) {
    const sharp = (await import('sharp')).default
    await sharp(framePath)
      .resize(FRAME_MAX_WIDTH, FRAME_MAX_HEIGHT, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .jpeg({
        quality: FRAME_JPEG_QUALITY,
        mozjpeg: true
      })
      .toFile(outputPath)
  }

  private async compressFrames(framePaths: string[], fps: number, durationSeconds: number, outputDir: string) {
    await fsPromises.mkdir(outputDir, { recursive: true })

    const frames: SampledFrame[] = []
    for (const [index, framePath] of framePaths.entries()) {
      const compressedPath = path.join(outputDir, `frame-${String(index + 1).padStart(6, '0')}.jpg`)
      await this.compressFrame(framePath, compressedPath)

      const startSeconds = clampSeconds(index / fps, durationSeconds)
      const endSeconds = clampSeconds((index + 1) / fps, durationSeconds || (index + 1) / fps)
      frames.push({
        frameIndex: index,
        timestampStart: startSeconds,
        timestampEnd: Math.max(endSeconds, startSeconds),
        originalPath: framePath,
        compressedPath
      })
    }

    return frames
  }

  private async encodeFrameAsDataUrl(frame: SampledFrame) {
    const buffer = await fsPromises.readFile(frame.compressedPath)
    return {
      frame,
      dataUrl: `data:image/jpeg;base64,${buffer.toString('base64')}`
    }
  }

  private async analyzeFrameBatch(options: {
    frames: SampledFrame[]
    prompt: string
    videoIndex: number
    videoCount: number
    batchIndex: number
    batchCount: number
    totalFrames: number
    fps: number
  }): Promise<{ completion: ChatCompletionResponse; answer: string; retryCount: number }> {
    const slices = buildTimeSlicesForFrames(options.frames)
    const content: Array<Record<string, unknown>> = [
      {
        type: 'text',
        text: buildBatchPrompt({
          prompt: options.prompt,
          batchIndex: options.batchIndex,
          batchCount: options.batchCount,
          totalFrames: options.totalFrames,
          videoIndex: options.videoIndex,
          videoCount: options.videoCount,
          fps: options.fps,
          slices
        })
      }
    ]

    for (const encodedFrame of await Promise.all(options.frames.map((frame) => this.encodeFrameAsDataUrl(frame)))) {
      content.push({
        type: 'text',
        text: buildFrameLabel(encodedFrame.frame)
      })
      content.push({
        type: 'image_url',
        image_url: {
          url: encodedFrame.dataUrl
        }
      })
    }

    const requestBody = {
      model: VIDEO_UNDERSTAND_MODEL,
      stream: true,
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content
        }
      ]
    }

    let lastError: unknown
    for (let attempt = 1; attempt <= GPT_REQUEST_MAX_RETRIES; attempt += 1) {
      try {
        const response = await this.requestWithAuth(CHAT_COMPLETIONS_ENDPOINT, {
          body: requestBody
        })

        if (!response.ok) {
          const body = await response.text().catch(() => '')
          throw new Error(`Video understand request failed (${response.status}): ${body || 'unknown error'}`)
        }

        const responseText = await response.text()
        const completion = parseChatCompletionPayload(responseText)
        const rawAnswer = extractCompletionText(completion)
        if (!rawAnswer) {
          throw new Error('Video understand returned an empty response')
        }
        const answer = normalizeAnswerToFixedSlices(rawAnswer, slices)

        return {
          completion,
          answer,
          retryCount: attempt - 1
        }
      } catch (error) {
        lastError = error
        if (toErrorMessage(error) === AUTH_EXPIRED_MESSAGE) {
          throw error
        }
        logger.warn('Video understand batch request failed, will retry if possible', {
          attempt,
          maxRetries: GPT_REQUEST_MAX_RETRIES,
          error: toErrorMessage(error)
        })
        if (attempt < GPT_REQUEST_MAX_RETRIES) {
          await this.sleep(attempt * 500)
        }
      }
    }

    throw new Error(`Video understand failed after ${GPT_REQUEST_MAX_RETRIES} attempts: ${toErrorMessage(lastError)}`)
  }

  private sumBillingPoints(values: Array<Record<string, unknown> | null>) {
    return values.reduce((sum, billing) => sum + (asFiniteNumber(billing?.total_consumed_points) || 0), 0)
  }

  private createJobProgressReporter(extra?: ToolExecutionExtra, totalVideos = 1) {
    const perVideoProgress = new Map<number, number>()

    return async (videoIndex: number, fraction: number, message: string) => {
      perVideoProgress.set(videoIndex, Math.max(0, Math.min(1, fraction)))
      const totalFraction =
        totalVideos > 0
          ? Array.from({ length: totalVideos }, (_, index) => perVideoProgress.get(index + 1) || 0).reduce((sum, value) => sum + value, 0) /
            totalVideos
          : 0
      await this.reportProgress(extra, Math.round(totalFraction * 100), message)
    }
  }

  private async recognizeVideoSpeech(
    source: string, signal?: AbortSignal, onBilling?: ToolExecutionExtra['onBilling'],
  ): Promise<VideoSpeechResult> {
    const { default: SubtitleRecognitionServer } = await import('./subtitle-recognition')
    const server = new SubtitleRecognitionServer(this.workspacePath)
    try {
      const result = await server.executeDirectRequest({ url: source, effectMode: 'basic' }, {
        requestId: `video-speech-${Date.now()}`, signal, sendNotification: async () => {},
      })
      const response = JSON.parse(result.content[0].text)
      const billing = new SocialCopywritingBilling(['asr'])
      billing.record('asr', response)
      const points = billing.snapshot().billing.total_consumed_points
      onBilling?.(points !== undefined ? { total_consumed_points: points } : null, 'asr')
      signal?.throwIfAborted()
      const errorCode = response.error_code ?? response.result?.error_code ?? response.result?.code
      const message = String(response.error || response.message || '')
      const noSpeech = String(errorCode) === '20000003' || /\b20000003\b/.test(message)
      const segments = Array.isArray(response.result?.segments) ? response.result.segments : []
      const content = String(response.result?.content || response.content
        || segments.map((segment: { text?: string }) => segment.text || '').join('')).trim()
      return {
        status: noSpeech ? 'no_speech' : result.isError || response.error || response.success === false
          ? 'failed' : content || segments.some((segment: { text?: string }) => segment.text?.trim())
            ? 'recognized' : 'no_speech',
        effect_mode: 'basic', content: noSpeech ? '' : content, segments: noSpeech ? [] : segments,
        ...(message ? { message } : {}),
        ...(errorCode !== undefined ? { error_code: errorCode } : {}),
        ...(points !== undefined ? { billing: { total_consumed_points: points } } : {}),
      }
    } catch (error) {
      signal?.throwIfAborted()
      return { status: 'failed', effect_mode: 'basic', content: '', segments: [], message: toErrorMessage(error) }
    } finally {
      await server.mcpServer.close()
    }
  }

  private async analyzeSingleVideo(options: {
    videoIndex: number
    videoCount: number
    source: string
    fps: number
    prompt: string
    report: (videoIndex: number, fraction: number, message: string) => Promise<void>
    signal?: AbortSignal
    onBilling?: ToolExecutionExtra['onBilling']
  }): Promise<VideoAnalysisResult> {
    let preparedSource: PreparedVideoSource | null = null

    try {
      if (options.signal?.aborted) throw new Error('任务已取消')
      await options.report(options.videoIndex, 0.02, '进度')
      preparedSource = await this.prepareVideoSource(options.source, options.signal)
      options.signal?.throwIfAborted()
      await options.report(options.videoIndex, 0.08, '进度')

      const { probe } = await this.probeMedia(preparedSource.localPath)
      if (!hasVideoStream(probe)) {
        throw new Error('The source does not contain a video stream')
      }

      const durationSeconds = getProbeDurationSeconds(probe)
      if (durationSeconds === null) {
        throw new Error('Could not determine video duration from ffprobe output')
      }

      const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), `vectcut-video-understand-${options.videoIndex}-`))
      const extractedFramesDir = path.join(tempDir, 'frames')
      const compressedFramesDir = path.join(tempDir, 'frames-480p')

      try {
        await options.report(options.videoIndex, 0.15, '进度')
        const extractedFrames = await this.extractFrames(preparedSource.localPath, options.fps, extractedFramesDir)

        options.signal?.throwIfAborted()
        await options.report(options.videoIndex, 0.4, '进度')
        const compressedFrames = await this.compressFrames(extractedFrames, options.fps, durationSeconds, compressedFramesDir)

        const batchCount = Math.ceil(compressedFrames.length / MAX_IMAGES_PER_BATCH)
        const batches: BatchAnalysisResult[] = []
        const batchBillings: Array<Record<string, unknown> | null> = []

        for (let batchIndex = 0; batchIndex < batchCount; batchIndex += 1) {
          if (options.signal?.aborted) throw new Error('任务已取消')
          const batchFrames = compressedFrames.slice(batchIndex * MAX_IMAGES_PER_BATCH, (batchIndex + 1) * MAX_IMAGES_PER_BATCH)
          const batchProgressBase = 0.45 + (batchIndex / Math.max(batchCount, 1)) * 0.5
          await options.report(options.videoIndex, batchProgressBase, '进度')

          const { completion, answer, retryCount } = await this.analyzeFrameBatch({
            frames: batchFrames,
            prompt: options.prompt,
            videoIndex: options.videoIndex,
            videoCount: options.videoCount,
            batchIndex: batchIndex + 1,
            batchCount,
            totalFrames: compressedFrames.length,
            fps: options.fps
          })

          const billing =
            completion.billing && typeof completion.billing === 'object' && !Array.isArray(completion.billing)
              ? (completion.billing as Record<string, unknown>)
              : null

          batchBillings.push(billing)
          options.onBilling?.(billing)
          batches.push({
            batchIndex: batchIndex + 1,
            frameCount: batchFrames.length,
            frameStartIndex: batchFrames[0]?.frameIndex ?? batchIndex * MAX_IMAGES_PER_BATCH,
            frameEndIndex: batchFrames[batchFrames.length - 1]?.frameIndex ?? batchIndex * MAX_IMAGES_PER_BATCH,
            timeRangeStartSeconds: batchFrames[0]?.timestampStart ?? 0,
            timeRangeEndSeconds: batchFrames[batchFrames.length - 1]?.timestampEnd ?? 0,
            answer,
            billing,
            responseSummary: {
              id: String(completion.id || '').trim() || undefined,
              model: String(completion.model || '').trim() || VIDEO_UNDERSTAND_MODEL,
              choiceCount: Array.isArray(completion.choices) ? completion.choices.length : 0
            },
            retryCount
          })
          await options.report(options.videoIndex, 0.45 + ((batchIndex + 1) / Math.max(batchCount, 1)) * 0.5, '进度')
        }

        const details = batches.map((batch) => batch.answer).filter(Boolean).join('\n\n').trim()
        const analysis = buildStructuredVideoAnalysis(details)
        await options.report(options.videoIndex, 0.96, '正在识别语音字幕')
        const speech: VideoSpeechResult = probe.streams?.some((stream) => stream.codec_type === 'audio')
          ? await this.recognizeVideoSpeech(preparedSource.localPath, options.signal, options.onBilling)
          : { status: 'no_audio', effect_mode: 'basic', content: '', segments: [], message: '视频没有音轨，无对白或画外音' }
        await options.report(options.videoIndex, 1, '已完成')

        return {
          videoIndex: options.videoIndex,
          originalInput: preparedSource.originalInput,
          absolutePath: preparedSource.sourceKind === 'local_video' ? preparedSource.localPath : null,
          sourceKind: preparedSource.sourceKind,
          fps: options.fps,
          durationSeconds,
          totalFrames: compressedFrames.length,
          totalBatches: batchCount,
          analysis,
          speech,
          billing: {
            total_consumed_points: this.sumBillingPoints([...batchBillings, speech.billing || null])
          },
          batches
        }
      } finally {
        await fsPromises.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
      }
    } finally {
      if (preparedSource?.cleanupDir) {
        await fsPromises.rm(preparedSource.cleanupDir, { recursive: true, force: true }).catch(() => undefined)
      }
    }
  }

  private speechStatusLabel(speech?: VideoSpeechResult) {
    if (speech?.status === 'recognized') return '已识别对白或画外音'
    if (speech?.status === 'no_audio') return '没有音轨，无对白或画外音'
    if (speech?.status === 'no_speech') return '未检测到可识别的人声（对白或画外音）'
    return '字幕识别失败，不能判定是否有人声'
  }

  private renderMarkdownResult(videos: VideoAnalysisResult[], prompt: string) {
    const lines: string[] = ['# 视频理解结果', '']
    if (prompt) {
      lines.push(`- 用户补充要求：${prompt}`, '')
    }

    for (const video of videos) {
      lines.push(`## 视频 ${video.videoIndex}`)
      lines.push(`- 输入：${video.originalInput}`)
      lines.push(`- 绝对路径：${video.absolutePath || '无（远端视频）'}`)
      lines.push(`- 来源：${video.sourceKind === 'remote_video' ? '远端视频' : '本地视频'}`)
      lines.push(`- 采样率：${video.fps} fps`)
      lines.push(`- 时长：${formatSeconds(video.durationSeconds)}秒`)
      lines.push(`- 抽帧数：${video.totalFrames}`)
      lines.push(`- 批次数：${video.totalBatches}`)
      lines.push(`- 总消耗点数：${video.billing.total_consumed_points.toFixed(2)}`)
      lines.push('', '### 标题', '', video.analysis.title || '未产出结果')
      lines.push('', '### 描述', '', video.analysis.summary || '未产出视频理解结果。')
      lines.push(`- 语音字幕：${this.speechStatusLabel(video.speech)}`)
      lines.push('')
    }

    return lines.join('\n').trim()
  }

  private renderSingleVideoMarkdownResult(video: VideoAnalysisResult, prompt: string) {
    const lines: string[] = [`# 视频 ${video.videoIndex} 理解结果`, '']

    if (prompt) {
      lines.push(`- 用户补充要求：${prompt}`)
    }

    lines.push(`- 输入：${video.originalInput}`)
    lines.push(`- 来源：${video.sourceKind === 'remote_video' ? '远端视频' : '本地视频'}`)
    lines.push(`- 采样率：${video.fps} fps`)
    lines.push(`- 时长：${formatSeconds(video.durationSeconds)}秒`)
    lines.push(`- 抽帧数：${video.totalFrames}`)
    lines.push(`- 批次数：${video.totalBatches}`)
    lines.push(`- 总消耗点数：${video.billing.total_consumed_points.toFixed(2)}`)
    lines.push('', '## 标题', '', video.analysis.title || '未产出结果')
    lines.push('', '## 描述', '', video.analysis.summary || '未产出视频理解结果。')
    lines.push('', '## 时间线详情', '', video.analysis.details || '未产出理解结果')
    lines.push('', '## 语音字幕（basic，不分句）', '', this.speechStatusLabel(video.speech))
    if (video.speech?.message) lines.push('', video.speech.message)
    if (video.speech?.content) lines.push('', video.speech.content)
    for (const segment of video.speech?.segments || []) {
      lines.push(`${segment.start ?? '--'}~${segment.end ?? '--'} 毫秒：${segment.text || ''}`)
    }

    return lines.join('\n').trim()
  }

  private renderResultIndexMarkdown(options: {
    prompt: string
    totalConsumedPoints: number
    totalVideos: number
    videos: VideoAnalysisResult[]
    resultFiles: VideoResultFileReference[]
    aggregateFile: TextArtifactResult | null
  }) {
    const lines: string[] = ['# 视频理解结果文件索引', '']

    if (options.prompt) {
      lines.push(`- 用户补充要求：${options.prompt}`)
    }

    lines.push(`- 视频数量：${options.totalVideos}`)
    lines.push(`- 总消耗点数：${options.totalConsumedPoints.toFixed(2)}`)
    if (options.aggregateFile) {
      lines.push(`- 聚合结果文件：${options.aggregateFile.relativePath}`)
    }
    lines.push('', '## 单视频结果文件', '')

    for (const resultFile of options.resultFiles) {
      const matchedVideo = options.videos.find((video) => video.videoIndex === resultFile.videoIndex)
      lines.push(`- 视频 ${resultFile.videoIndex} 结果文件：${resultFile.relativePath}`)
      lines.push(`- 视频 ${resultFile.videoIndex} 绝对路径：${matchedVideo?.absolutePath || '无（远端视频）'}`)
      lines.push(`- 标题：${matchedVideo?.analysis.title || '未产出标题'}`)
      lines.push(`- 摘要：${matchedVideo?.analysis.summary || '未产出摘要'}`, '')
      lines.push(`- 语音字幕：${this.speechStatusLabel(matchedVideo?.speech)}`, '')
    }

    return lines.join('\n').trim()
  }

  private async persistWorkspaceTextArtifact(options: {
    toolName: string
    taskId: string
    text: string
    extension?: string
  }): Promise<TextArtifactResult | null> {
    const workspaceRoot = String(this.workspacePath || process.env.WORKSPACE_ROOT || '').trim()
    if (!workspaceRoot || !path.isAbsolute(workspaceRoot)) {
      return null
    }

    const toolDirName = sanitizePathSegment(options.toolName) || 'tool-result'
    const taskId = sanitizePathSegment(options.taskId) || `result-${Date.now()}`
    const extension = sanitizePathSegment(options.extension || 'md') || 'md'
    const artifactDir = path.join(workspaceRoot, toolDirName)
    const filePath = path.join(artifactDir, `${taskId}.${extension}`)

    await fsPromises.mkdir(artifactDir, { recursive: true })
    await fsPromises.writeFile(filePath, options.text, 'utf8')

    return {
      filePath,
      relativePath: path.relative(workspaceRoot, filePath) || path.basename(filePath)
    }
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

  private async submitVideoDetailTask(args: Record<string, unknown>, extra?: ToolExecutionExtra) {
    const jobConfig = await this.buildJobConfig(args)
    const jobId = `job-${Date.now()}`
    const report = this.createJobProgressReporter(extra, jobConfig.videos.length)

    await this.reportProgress(
      extra,
      1,
      '进度'
    )

    const videoPromises = jobConfig.videos.map((video, index) =>
      VideoUnderstandServer.videoQueue.add(() =>
        this.analyzeSingleVideo({
          videoIndex: index + 1,
          videoCount: jobConfig.videos.length,
          source: video.source,
          fps: video.fps,
          prompt: jobConfig.prompt,
          report,
          signal: extra?.signal,
          onBilling: extra?.onBilling,
        })
      )
    )

    // Wait for every video before reporting a failure so parallel batch charges are retained.
    const settledVideos = await Promise.allSettled(videoPromises)
    const failedVideo = settledVideos.find((video) => video.status === 'rejected')
    if (failedVideo?.status === 'rejected') throw failedVideo.reason
    const videos = settledVideos.flatMap((video) => video.status === 'fulfilled' ? [video.value] : [])
    const totalConsumedPoints = videos.reduce((sum, video) => sum + video.billing.total_consumed_points, 0)
    const aggregateMarkdownText = this.renderMarkdownResult(videos, jobConfig.prompt)
    const aggregateResultFile = await this.persistWorkspaceTextArtifact({
      toolName: 'video-understand',
      taskId: `${jobId}-all`,
      text: aggregateMarkdownText,
      extension: 'md'
    })
    const videoResultFiles = (
      await Promise.all(
        videos.map(async (video): Promise<VideoResultFileReference | null> => {
          const resultFile = await this.persistWorkspaceTextArtifact({
            toolName: 'video-understand',
            taskId: `${jobId}-video-${video.videoIndex}`,
            text: this.renderSingleVideoMarkdownResult(video, jobConfig.prompt),
            extension: 'md'
          })

          if (!resultFile) return null

          return {
            ...resultFile,
            videoIndex: video.videoIndex,
            originalInput: video.originalInput,
            absolutePath: video.absolutePath,
            kind: 'video_result'
          }
        })
      )
    ).filter((item): item is VideoResultFileReference => Boolean(item))
    const resultIndexFile = await this.persistWorkspaceTextArtifact({
      toolName: 'video-understand',
      taskId: `${jobId}-index`,
      text: this.renderResultIndexMarkdown({
        prompt: jobConfig.prompt,
        totalConsumedPoints,
        totalVideos: videos.length,
        videos,
        resultFiles: videoResultFiles,
        aggregateFile: aggregateResultFile
      }),
      extension: 'md'
    })

    const resultFilesForPayload = [
      ...(resultIndexFile
        ? [
            {
              kind: 'result_index',
              file_path: resultIndexFile.filePath,
              relative_path: resultIndexFile.relativePath
            }
          ]
        : []),
      ...(aggregateResultFile
        ? [
            {
              kind: 'aggregate_result',
              file_path: aggregateResultFile.filePath,
              relative_path: aggregateResultFile.relativePath
            }
          ]
        : []),
      ...videoResultFiles.map((resultFile) => ({
        kind: resultFile.kind,
        video_index: resultFile.videoIndex,
        original_input: resultFile.originalInput,
        absolute_video_path: resultFile.absolutePath,
        file_path: resultFile.filePath,
        relative_path: resultFile.relativePath
      }))
    ]

    const artifactPayload = {
      provider: 'vectcut',
      action: 'inspect_video',
      mode: 'video_understand',
      model: VIDEO_UNDERSTAND_MODEL,
      prompt: jobConfig.prompt,
      default_fps: DEFAULT_SAMPLE_FPS,
      max_images_per_batch: MAX_IMAGES_PER_BATCH,
      max_concurrent_videos: MAX_CONCURRENT_VIDEOS,
      billing: {
        total_consumed_points: totalConsumedPoints
      },
      result_files: resultFilesForPayload,
      videos: videos.map((video) => ({
        video_index: video.videoIndex,
        original_input: video.originalInput,
        absolute_video_path: video.absolutePath,
        source_kind: video.sourceKind,
        fps: video.fps,
        duration_seconds: video.durationSeconds,
        total_frames: video.totalFrames,
        total_batches: video.totalBatches,
        billing: video.billing,
        speech: video.speech,
        analysis: {
          title: video.analysis.title,
          summary: video.analysis.summary,
          details: video.analysis.details
        },
        result_file:
          videoResultFiles.find((resultFile) => resultFile.videoIndex === video.videoIndex)
            ? {
                storage: 'workspace_file',
                file_path: videoResultFiles.find((resultFile) => resultFile.videoIndex === video.videoIndex)?.filePath,
                relative_path: videoResultFiles.find((resultFile) => resultFile.videoIndex === video.videoIndex)?.relativePath
              }
            : null,
        frame_summary: video.batches.map((batch) => ({
          batch_index: batch.batchIndex,
          frame_count: batch.frameCount,
          frame_range: `${batch.frameStartIndex + 1}-${batch.frameEndIndex + 1}`,
          time_range: formatTimeRange(batch.timeRangeStartSeconds, batch.timeRangeEndSeconds),
          retry_count: batch.retryCount,
          billing: batch.billing,
          response_summary: batch.responseSummary,
          answer: batch.answer,
          source_preview: batch.frameCount > 0 ? `data:image/jpeg;base64,${INLINE_DATA_URL_PREVIEW}` : null
        }))
      }))
    }

    const artifact = await persistWorkspaceJsonArtifact({
      toolName: 'video-understand',
      taskId: jobId,
      payload: artifactPayload,
      workspaceRoot: this.workspacePath
    })

    await this.reportProgress(extra, 100, '已完成')

    const totalDurationSeconds = videos.reduce((sum, video) => sum + (video.durationSeconds || 0), 0)

    return this.formatJsonResult({
      provider: 'vectcut',
      action: 'inspect_video',
      mode: 'video_understand',
      model: VIDEO_UNDERSTAND_MODEL,
      prompt: jobConfig.prompt,
      default_fps: DEFAULT_SAMPLE_FPS,
      max_images_per_batch: MAX_IMAGES_PER_BATCH,
      max_concurrent_videos: MAX_CONCURRENT_VIDEOS,
      total_video_count: videos.length,
      total_duration_seconds: totalDurationSeconds,
      ...(args.includeSummaries === true ? {
        video_summaries: videos.slice(0, 5).map((video) => ({
          video_index: video.videoIndex,
          title: video.analysis.title.slice(0, 100),
          summary: video.analysis.summary.slice(0, 300),
          speech_status: video.speech?.status,
          speech_message: this.speechStatusLabel(video.speech),
        })),
      } : {}),
      billing: {
        total_consumed_points: totalConsumedPoints
      },
      result_files: resultFilesForPayload,
      ...(artifact
        ? {
            artifact: {
              storage: 'workspace_file',
              file_path: artifact.filePath,
              relative_path: artifact.relativePath
            }
          }
        : {})
    })
  }
}

export default VideoUnderstandServer
