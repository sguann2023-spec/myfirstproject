import fsPromises from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loggerService } from '@logger'
import { ossUploadService } from '@main/services/OssUploadService'
import { probeVideoSource } from '@main/utils/prepare-subtitle-audio'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Tool, ProgressToken } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
import Store from 'electron-store'
import ipaddr from 'ipaddr.js'
import { net } from 'electron'

const logger = loggerService.withContext('MCPServer:RemoveBg')
const API_HOST = 'https://open.vectcut.com'
const API_PREFIX = '/process/remove_bg/submit_task'
const OAUTH_TOKEN_URL = 'https://mlbd8l6vgi13-demo.authing.cn/oidc/token'
const OAUTH_CLIENT_ID = '6901dd145dafc6f1f3143938'
const OAUTH_CLIENT_SECRET = '16a94e467e927cc09b3c8dc7ec92d420'
const POLL_INTERVAL_MS = 5_000
const POLL_TIMEOUT_MS = 35 * 60_000
const MAX_VIDEO_DURATION_SECONDS = 10 * 60
const VIDEO_FILE_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v', '.mpeg', '.mpg', '.ts', '.flv', '.wmv', '.3gp'])
const PIP_TEMPLATES = [
  'left_down', 'left_up', 'right_up', 'right_down',
  'fixed_left_down', 'fixed_left_up', 'fixed_right_up', 'fixed_right_down'
]

const TOOLS: Tool[] = [
  {
    name: 'submit_remove_bg_text_behind_task',
    description: 'Add text behind a person in a video, optionally into an existing draft. Submits and waits for the finished draft in this one long-running call (up to 35 minutes).',
    inputSchema: {
      type: 'object',
      properties: {
        video_url: { type: 'string', description: 'Video URL, file:// URL, or absolute local video path (maximum 10 minutes; video files only).' },
        text: { type: 'string', description: 'Text to put behind the person.' },
        text_preset_id: { type: 'string', description: 'Text preset ID; defaults to fc6982de-c94e-447a-82d0-ab361cb27217.' },
        draft_id: { type: 'string', description: 'Optional existing draft ID.' },
        target_start: { type: 'number', description: 'Insertion time in seconds; defaults to 0.' },
        track_name: { type: 'string' },
        relative_index: { type: 'integer' },
        text_track_name: { type: 'string' },
        text_relative_index: { type: 'integer' },
        base_video_track_name: { type: 'string' },
        base_video_relative_index: { type: 'integer' },
        base_video_volume: { type: 'number' },
        volume: { type: 'number' }
      },
      required: ['video_url', 'text'],
      additionalProperties: false
    }
  },
  {
    name: 'submit_remove_bg_pip_task',
    description: 'Create a portrait cutout picture-in-picture over an image or video background, optionally in an existing draft. Submits and waits for the finished draft in one long-running call (up to 35 minutes).',
    inputSchema: {
      type: 'object',
      properties: {
        video_url: { type: 'string', description: 'Video URL, file:// URL, or absolute local video path (maximum 10 minutes; video files only).' },
        background_image_url: { type: 'string', description: 'Background image URL, file:// URL, or absolute local path; choose exactly one background.' },
        background_video_url: { type: 'string', description: 'Background video URL, file:// URL, or absolute local video path (maximum 10 minutes); choose exactly one background.' },
        template: { type: 'string', enum: PIP_TEMPLATES },
        draft_id: { type: 'string' },
        speed: { type: 'number' },
        target_start: { type: 'number' },
        track_name: { type: 'string' },
        relative_index: { type: 'integer' },
        background_track_name: { type: 'string' },
        background_relative_index: { type: 'integer' },
        background_volume: { type: 'number', description: 'Use -100 to mute background video.' },
        volume: { type: 'number' }
      },
      required: ['video_url', 'template'],
      additionalProperties: false
    }
  },
  {
    name: 'submit_remove_bg_task',
    description: 'Cut a person out of a video. By default writes the result into a draft; set compose_draft=false to return mask and inverted_mask URLs only. Submits and waits in one long-running call (up to 35 minutes).',
    inputSchema: {
      type: 'object',
      properties: {
        video_url: { type: 'string', description: 'Source video URL, file:// URL, or absolute local video path (maximum 10 minutes; video files only).' },
        compose_draft: { type: 'boolean', description: 'Whether to compose a draft; defaults to true.' },
        start: { type: 'number' },
        end: { type: 'number' },
        draft_id: { type: 'string' },
        transform_y: { type: 'number' },
        transform_y_px: { type: 'integer' },
        scale_x: { type: 'number' },
        scale_y: { type: 'number' },
        transform_x: { type: 'number' },
        transform_x_px: { type: 'integer' },
        speed: { type: 'number' },
        target_start: { type: 'number' },
        track_name: { type: 'string' },
        relative_index: { type: 'integer' },
        intro_animation: { type: 'string' },
        intro_animation_duration: { type: 'number' },
        outro_animation: { type: 'string' },
        outro_animation_duration: { type: 'number' },
        duration: { type: 'number' },
        transition: { type: 'string' },
        transition_duration: { type: 'number' },
        volume: { type: 'number' },
        mask_type: { type: 'string' },
        mask_center_x: { type: 'number' },
        mask_center_y: { type: 'number' },
        mask_size: { type: 'number' },
        mask_rotation: { type: 'number' },
        mask_feather: { type: 'number' },
        mask_invert: { type: 'boolean' },
        mask_rect_width: { type: 'number' },
        mask_round_corner: { type: 'number' },
        background_blur: { type: 'number' },
        alpha: { type: 'number' },
        flip_horizontal: { type: 'boolean' },
        mix_type: { type: 'string' }
      },
      required: ['video_url'],
      additionalProperties: false
    }
  }
]

const MODES = { remove_bg: 'submit_remove_bg_task', text_behind: 'submit_remove_bg_text_behind_task', pip: 'submit_remove_bg_pip_task' } as const
const EXTERNAL_TOOLS: Tool[] = [
  { name: 'submit', description: 'Submit a backend cutout task immediately. Public HTTP(S) media URLs only; poll task_status separately.', inputSchema: {
    type: 'object', properties: { ...Object.assign({}, ...TOOLS.map(tool => tool.inputSchema.properties)), mode: { type: 'string', enum: Object.keys(MODES) }, video_url: { type: 'string', description: 'Public HTTP(S) video URL only.' }, background_image_url: { type: 'string', description: 'Public HTTP(S) image URL only.' }, background_video_url: { type: 'string', description: 'Public HTTP(S) video URL only.' } }, required: ['mode', 'video_url'], additionalProperties: false
  } },
  { name: 'task_status', description: 'Query a backend task once without waiting or downloading.', inputSchema: { type: 'object', properties: { task_id: { type: 'string', minLength: 1 }, mode: { type: 'string', enum: Object.keys(MODES) } }, required: ['task_id'], additionalProperties: false } }
]

type Extra = {
  signal?: AbortSignal
  _meta?: { progressToken?: ProgressToken }
  sendNotification?: (notification: {
    method: 'notifications/progress'
    params: { progressToken: ProgressToken; progress: number; total: number; message: string }
  }) => Promise<void>
}

type TaskResponse = {
  success?: boolean
  task_id?: string
  status?: string
  progress?: number
  message?: string
  error?: string
  draft_error?: string
  billing?: Record<string, unknown>
  result?: Record<string, unknown>
  draft_id?: string
  draft_url?: string
  [key: string]: unknown
}

function validateExternalMedia(value: unknown, field = '') {
  if (Array.isArray(value)) { value.forEach((item) => validateExternalMedia(item, field)); return }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) validateExternalMedia(entry, field ? `${field}.${key}` : key)
    return
  }
  if (/(^|\.)(base_video_track_name|base_video_relative_index|base_video_volume)$/.test(field)) return
  if (!/(url|path|image|video|audio|frame|source|reference)/i.test(field) || ['type', 'role', 'generateAudio', 'generate_audio'].includes(field)) return
  if (typeof value !== 'string' || !value || /[\\\s]/.test(value)) throw new Error(`'${field}' requires a public HTTP(S) URL`)
  let url: URL
  try { url = new URL(value) } catch { throw new Error(`'${field}' requires a public HTTP(S) URL`) }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '')
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      (!ipaddr.isValid(host) && !host.includes('.')) || /(^|\.)(localhost|local|internal|test|invalid)$/.test(host) ||
      (ipaddr.isValid(host) && ipaddr.parse(host).range() !== 'unicast')) {
    throw new Error(`'${field}' requires a public HTTP(S) URL, not a local/private address`)
  }
}

class RemoveBgServer {
  public mcpServer: McpServer
  private readonly store = new Store({ name: 'vectcut' })
  private token: { value: string; expiresAt: number } | null = null
  private refreshPromise: Promise<string> | null = null

  constructor(private readonly options: { external?: boolean } = {}) {
    this.mcpServer = new McpServer({ name: 'remove-bg', version: '1.0.0' }, { capabilities: { tools: {} } })
    this.mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: this.options.external ? EXTERNAL_TOOLS : TOOLS }))
    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      try {
        if (this.options.external) return await this.callExternal(request.params.name, request.params.arguments ?? {})
        const tool = TOOLS.find((item) => item.name === request.params.name)
        if (!tool) throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`)
        return await this.submitAndWait(tool, (request.params.arguments ?? {}) as Record<string, unknown>, extra as Extra)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error('Remove background task failed', { error: message })
        return this.options.external ? this.externalResult({ action: request.params.name, task_id: request.params.arguments?.task_id, status: request.params.name === 'task_status' ? 'unknown' : 'failed', success: false, error: message }) : { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true }
      }
    })
  }

  private externalResult(result: Record<string, unknown>) {
    const failed = result.success === false || ['failed', 'error', 'cancelled', 'canceled'].includes(String(result.status).toLowerCase())
    return { content: [{ type: 'text' as const, text: JSON.stringify({ provider: 'vectcut', ...result }, null, 2) }], ...(failed ? { isError: true } : {}) }
  }

  private async callExternal(name: string, args: Record<string, unknown>) {
    if (name === 'task_status') {
      if (typeof args.task_id !== 'string' || !args.task_id.trim()) throw new Error('task_id is required')
      const result = await this.request('task_status', 'GET', undefined, args.task_id.trim())
      return this.externalResult({ action: name, task_id: args.task_id, ...result, mode: result.mode ?? args.mode, status: result.status || 'unknown' })
    }
    if (name !== 'submit') throw new Error(`Unknown tool: ${name}`)
    validateExternalMedia(args)
    if (!Object.prototype.hasOwnProperty.call(MODES, String(args.mode))) throw new Error('Invalid mode')
    const mode = args.mode as keyof typeof MODES
    const tool = TOOLS.find(tool => tool.name === MODES[mode])!
    const { mode: _mode, ...payload } = args
    const fields = Object.keys(tool.inputSchema.properties ?? {})
    if (Object.keys(payload).some(key => !fields.includes(key))) throw new Error('Unsupported parameter')
    if (typeof payload.video_url !== 'string' || !payload.video_url) throw new Error('video_url is required')
    if (mode === 'text_behind' && (typeof payload.text !== 'string' || !payload.text.trim())) throw new Error('text is required')
    if (mode === 'pip' && (Boolean(payload.background_image_url) === Boolean(payload.background_video_url) || !PIP_TEMPLATES.includes(String(payload.template)))) throw new Error('Provide one background and a valid template')
    const result = await this.request(tool.name, 'POST', payload)
    return this.externalResult({ action: name, ...result, mode, success: result.success !== false && Boolean(result.task_id), status: result.status || (result.task_id ? 'submitted' : 'failed') })
  }

  private async refreshToken(): Promise<string> {
    const refreshToken = String(this.store.get('auth.refresh_token') || '').trim()
    if (!refreshToken) throw new Error('No refresh token found, please sign in first')
    const response = await net.fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      ...(this.options.external ? { signal: AbortSignal.timeout(30_000) } : {}),
      body: new URLSearchParams({
        grant_type: 'refresh_token', refresh_token: refreshToken,
        client_id: OAUTH_CLIENT_ID, client_secret: OAUTH_CLIENT_SECRET
      }).toString()
    })
    if (!response.ok) throw new Error(`Token refresh failed (${response.status}): ${await response.text()}`)
    const payload = (await response.json()) as { access_token?: string; refresh_token?: string; expires_in?: number }
    if (!payload.access_token) throw new Error('Token refresh returned no access token')
    this.token = { value: payload.access_token, expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000 }
    if (payload.refresh_token) this.store.set('auth.refresh_token', payload.refresh_token)
    return payload.access_token
  }

  private async getToken(force = false): Promise<string> {
    if (!force && this.token && Date.now() < this.token.expiresAt - 30_000) return this.token.value
    if (!force && this.refreshPromise) return this.refreshPromise
    this.refreshPromise = this.refreshToken()
    try {
      return await this.refreshPromise
    } finally {
      this.refreshPromise = null
    }
  }

  private async request(endpoint: string, method: 'GET' | 'POST', body?: Record<string, unknown>, taskId?: string) {
    const url = new URL(`${API_HOST}${API_PREFIX}/${endpoint}`)
    if (taskId) url.searchParams.set('task_id', taskId)
    const fetchWithToken = (token: string) => net.fetch(url.toString(), {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      ...(this.options.external ? { signal: AbortSignal.timeout(30_000) } : {})
    })
    let response = await fetchWithToken(await this.getToken())
    if (response.status === 401) response = await fetchWithToken(await this.getToken(true))
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      if (this.options.external) {
        let result: Record<string, unknown> = {}
        try { result = JSON.parse(detail) } catch { /* retain non-JSON failure detail */ }
        return { ...result, success: false, status: result.status || (method === 'GET' ? 'unknown' : 'failed'), error: result.error || detail || `HTTP ${response.status}` } as TaskResponse
      }
      throw new Error(`Remove background ${endpoint} failed (${response.status}): ${detail || 'unknown error'}`)
    }
    return (await response.json()) as TaskResponse
  }

  private async prepareMedia(value: unknown, field: string): Promise<string> {
    const source = typeof value === 'string' ? value.trim() : ''
    if (!source) throw new McpError(ErrorCode.InvalidParams, `'${field}' is required`)
    const isVideo = field !== 'background_image_url'
    if (/^https?:\/\//i.test(source)) {
      if (isVideo) await probeVideoSource(source, MAX_VIDEO_DURATION_SECONDS)
      return source
    }
    const filePath = source.startsWith('file://') ? fileURLToPath(source) : source
    if (!path.isAbsolute(filePath)) {
      throw new McpError(ErrorCode.InvalidParams, `'${field}' must be a remote URL, file URL, or absolute local path`)
    }
    const stats = await fsPromises.stat(filePath)
    if (!stats.isFile()) throw new McpError(ErrorCode.InvalidParams, `'${field}' must point to a file`)
    if (isVideo) {
      if (!VIDEO_FILE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
        throw new McpError(ErrorCode.InvalidParams, `'${field}' only accepts video files`)
      }
      await probeVideoSource(filePath, MAX_VIDEO_DURATION_SECONDS)
    }
    const uploaded = await ossUploadService.uploadLocalFile(filePath, {
      bucket: 'oss-hangzhou-mp4', region: 'oss-cn-hangzhou',
      folder: 'agent_tmp/{uid}', objectKeyPrefix: 'vectcut_remove_bg_',
      signExpiresSeconds: 60 * 60
    })
    return uploaded.signedPublicUrl
  }

  private async progress(extra: Extra | undefined, value: number, message: string) {
    if (!extra?._meta?.progressToken || !extra.sendNotification) return
    await extra.sendNotification({
      method: 'notifications/progress',
      params: { progressToken: extra._meta.progressToken, progress: value, total: 100, message }
    })
  }

  private async submitAndWait(tool: Tool, args: Record<string, unknown>, extra?: Extra) {
    extra?.signal?.throwIfAborted()
    const fields = Object.keys(tool.inputSchema.properties ?? {})
    const unexpected = Object.keys(args).find((key) => !fields.includes(key))
    if (unexpected) throw new McpError(ErrorCode.InvalidParams, `Unsupported parameter: ${unexpected}`)
    if (tool.name === 'submit_remove_bg_text_behind_task' && !String(args.text || '').trim()) {
      throw new McpError(ErrorCode.InvalidParams, "'text' is required")
    }
    if (tool.name === 'submit_remove_bg_pip_task') {
      if (Boolean(args.background_image_url) === Boolean(args.background_video_url)) {
        throw new McpError(ErrorCode.InvalidParams, 'Provide exactly one of background_image_url or background_video_url')
      }
      if (!PIP_TEMPLATES.includes(String(args.template || ''))) {
        throw new McpError(ErrorCode.InvalidParams, `Invalid template; use ${PIP_TEMPLATES.join(', ')}`)
      }
    }
    const payload = { ...args, video_url: await this.prepareMedia(args.video_url, 'video_url') }
    for (const field of ['background_image_url', 'background_video_url'] as const) {
      if (args[field]) payload[field] = await this.prepareMedia(args[field], field)
    }
    extra?.signal?.throwIfAborted()
    await this.progress(extra, 5, '正在提交抠像任务')
    const submitted = await this.request(tool.name, 'POST', payload)
    const taskId = String(submitted.task_id || '').trim()
    if (!taskId || submitted.success === false) {
      throw new Error(`Remove background submission failed: ${JSON.stringify(submitted)}`)
    }
    const deadline = Date.now() + POLL_TIMEOUT_MS
    let attempt = 0
    let lastBilling: Record<string, unknown> | undefined
    while (Date.now() < deadline) {
      extra?.signal?.throwIfAborted()
      const result = await this.request('task_status', 'GET', undefined, taskId)
      extra?.signal?.throwIfAborted()
      const status = String(result.status || '').toLowerCase()
      const resultBilling = result.result?.billing ?? result.billing
      if (resultBilling && typeof resultBilling === 'object' && !Array.isArray(resultBilling)) {
        lastBilling = resultBilling as Record<string, unknown>
      }
      if (['failed', 'error', 'cancelled', 'canceled'].includes(status) || result.success === false) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            provider: 'vectcut', mode: tool.name, task_id: taskId, ...result,
            ...(lastBilling ? { billing: lastBilling } : {})
          }, null, 2) }],
          isError: true
        }
      }
      if (['success', 'completed', 'done'].includes(status)) {
        await this.progress(extra, 100, result.message || '抠像任务完成')
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            provider: 'vectcut', action: 'submit_and_wait', mode: tool.name, task_id: taskId,
            ...result, draft_id: result.result?.draft_id || result.draft_id,
            draft_url: result.result?.draft_url || result.draft_url,
            ...(lastBilling ? { billing: lastBilling } : {})
          }, null, 2) }]
        }
      }
      attempt += 1
      const reported = typeof result.progress === 'number'
        ? (result.progress <= 1 ? result.progress * 100 : result.progress)
        : 15 + attempt * 3
      await this.progress(extra, Math.min(95, Math.max(15, reported)), result.message || '正在处理抠像任务')
      await new Promise((resolve) => setTimeout(resolve, Math.min(POLL_INTERVAL_MS, Math.max(0, deadline - Date.now()))))
    }
    throw new Error(`Remove background task ${taskId} timed out after 35 minutes; query task_status with this task_id to check its result`)
  }
}

export default RemoveBgServer
