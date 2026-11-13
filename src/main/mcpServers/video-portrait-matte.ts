import fsPromises from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loggerService } from '@logger'
import { ossUploadService } from '@main/services/OssUploadService'
import { probeVideoSource } from '@main/utils/prepare-subtitle-audio'
import { preparePortraitMovForJianying } from '@main/utils/prepare-portrait-mov'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Tool, ProgressToken } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
import Store from 'electron-store'
import ipaddr from 'ipaddr.js'
import { net } from 'electron'

const logger = loggerService.withContext('MCPServer:VideoPortraitMatte')
const API_HOST = 'https://open.vectcut.com'
const API_PREFIX = '/llm/animate_move/matte_portrait_video'
const OAUTH_TOKEN_URL = 'https://mlbd8l6vgi13-demo.authing.cn/oidc/token'
const OAUTH_CLIENT_ID = '6901dd145dafc6f1f3143938'
const OAUTH_CLIENT_SECRET = '16a94e467e927cc09b3c8dc7ec92d420'
const POLL_INTERVAL_MS = 5_000
const POLL_TIMEOUT_MS = 35 * 60_000
const MAX_VIDEO_DURATION_SECONDS = 10 * 60
const VIDEO_FILE_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v', '.mpeg', '.mpg', '.ts', '.flv', '.wmv', '.3gp'])
const OUTPUT_FORMATS = ['WEBM', 'MOV'] as const
// MOV is a LOCAL output choice. Backend requests are always WEBM.
const DEFAULT_FORMAT = 'MOV'

// Public contract is deliberately allowlisted: never serialize provider/debug payloads.
function publicResult(result: Record<string, unknown>) {
  const out: Record<string, unknown> = { provider: 'vectcut' }
  for (const key of ['action', 'task', 'task_id', 'success', 'video_url', 'format', 'billing_status']) {
    if (result[key] !== undefined) out[key] = result[key]
  }
  const failed = result.success === false || ['failed', 'error', 'cancelled', 'canceled', 'billing_failed', 'output_validation_failed', 'output_conversion_failed'].includes(String(result.status).toLowerCase())
  const statuses = ['success', 'completed', 'done', 'pending', 'queued', 'processing', 'running', 'submitted', 'ok', 'unknown']
  out.status = failed ? 'failed' : statuses.includes(String(result.status)) ? result.status : 'unknown'
  if (failed) {
    delete out.video_url
    out.error = '任务未完成，请使用任务编号联系支持；请勿重复提交。'
  }
  const progress = Number(result.progress)
  if (Number.isFinite(progress)) out.progress = Math.max(0, Math.min(100, progress))
  const billing = result.billing as Record<string, unknown> | undefined
  if (billing && Number.isFinite(Number(billing.total_consumed_points))) {
    out.billing = { total_consumed_points: Number(billing.total_consumed_points) }
  }
  return out
}

const TOOLS: Tool[] = [
  {
    name: 'submit_video_portrait_matte_task',
    description: 'Person video background removal / portrait matting / human segmentation / transparent video cutout / 人像抠像、视频去背景、人像分割. Remove background from an existing video, keeping the original person with a transparent background. Waits for the finished output video URL and numeric progress. MOV is the default output format. For isolating people, not generating new footage or erasing the subject.',
    inputSchema: {
      type: 'object',
      properties: {
        video_url: { type: 'string', description: 'Source video URL, file:// URL, or absolute local video path (maximum 10 minutes; video files only).' },
        format: { type: 'string', enum: [...OUTPUT_FORMATS], default: DEFAULT_FORMAT, description: `Output format; defaults to ${DEFAULT_FORMAT}.` },
        media_output_destination: { type: 'string', description: 'Optional output destination passed through to the provider.' },
        client_token: { type: 'string', description: 'Optional idempotency token passed through to the provider.' },
        callback_url: { type: 'string', description: 'Optional provider callback URL.' },
        callback_args: { type: 'string', description: 'Optional provider callback arguments.' },
        queue_id: { type: 'string', description: 'Optional provider queue ID.' }
      },
      required: ['video_url'],
      additionalProperties: false
    }
  }
]

const EXTERNAL_TOOLS: Tool[] = [
  { name: 'submit', description: 'Person video background removal / portrait matting / human segmentation / transparent video cutout / 人像抠像、视频去背景、人像分割. Keep the original person and remove the background from an existing video. Submit immediately using a public HTTP(S) video URL; WEBM output only. Poll task_status for the result.', inputSchema: {
    type: 'object', properties: { ...Object.assign({}, ...TOOLS.map(tool => tool.inputSchema.properties)), video_url: { type: 'string', description: 'Public HTTP(S) video URL only.' }, format: { type: 'string', enum: ['WEBM'], default: 'WEBM', description: 'Output format for this endpoint.' } }, required: ['video_url'], additionalProperties: false
  } },
  { name: 'task_status', description: 'Query task status and numeric progress once.', inputSchema: { type: 'object', properties: { task_id: { type: 'string', minLength: 1 } }, required: ['task_id'], additionalProperties: false } }
]

type Extra = {
  signal?: AbortSignal
  _meta?: { progressToken?: ProgressToken }
  sendNotification?: (notification: {
    method: 'notifications/progress'
    params: { progressToken: ProgressToken; progress: number; total: number }
  }) => Promise<void>
}

type TaskResponse = {
  success?: boolean
  task_id?: string
  status?: string
  progress?: number
  message?: string
  error?: string
  video_url?: string
  billing?: Record<string, unknown>
  result?: Record<string, unknown>
  [key: string]: unknown
}

function validateExternalMedia(value: unknown, field = '') {
  if (Array.isArray(value)) { value.forEach((item) => validateExternalMedia(item, field)); return }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) validateExternalMedia(entry, field ? `${field}.${key}` : key)
    return
  }
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

// The matte backend reports billing as a top-level `consumed_points` value, but the
// renderer's points badge only recognizes a nested `billing.total_consumed_points`
// (see mediaGenerationBilling.extractBillingRecord). Normalize so consumption displays.
function matteBilling(result: TaskResponse): Record<string, unknown> | undefined {
  const existing = (result.result?.billing ?? result.billing) as Record<string, unknown> | undefined
  const source = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : undefined
  const raw = source?.total_consumed_points ?? source?.points_consumed ?? source?.deduct_points ?? source?.consume ?? result.consumed_points
  const points = Number(raw)
  if (!Number.isFinite(points)) return source
  return { ...(source || {}), total_consumed_points: points }
}

class VideoPortraitMatteServer {
  public mcpServer: McpServer
  private readonly store = new Store({ name: 'vectcut' })
  private token: { value: string; expiresAt: number } | null = null
  private refreshPromise: Promise<string> | null = null

  constructor(private readonly options: { external?: boolean } = {}) {
    this.mcpServer = new McpServer({ name: 'video-portrait-matte', version: '1.0.0' }, { capabilities: { tools: {} } })
    this.mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: this.options.external ? EXTERNAL_TOOLS : TOOLS }))
    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      try {
        if (this.options.external) return await this.callExternal(request.params.name, request.params.arguments ?? {})
        const tool = TOOLS.find((item) => item.name === request.params.name)
        if (!tool) throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`)
        return await this.submitAndWait(tool, (request.params.arguments ?? {}) as Record<string, unknown>, extra as Extra)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error('Video portrait matte task failed', { error: message })
        return this.options.external ? this.externalResult({ action: request.params.name, task_id: request.params.arguments?.task_id, status: request.params.name === 'task_status' ? 'unknown' : 'failed', success: false, error: message }) : { content: [{ type: 'text' as const, text: '任务未完成，请检查输入或使用任务编号联系支持。' }], isError: true }
      }
    })
  }

  private externalResult(result: Record<string, unknown>) {
    const failed = result.success === false || ['failed', 'error', 'cancelled', 'canceled'].includes(String(result.status).toLowerCase())
    return { content: [{ type: 'text' as const, text: JSON.stringify(publicResult(result), null, 2) }], ...(failed ? { isError: true } : {}) }
  }

  private async callExternal(name: string, args: Record<string, unknown>) {
    if (name === 'task_status') {
      if (typeof args.task_id !== 'string' || !args.task_id.trim()) throw new Error('task_id is required')
      const result = await this.request('task_status', 'GET', undefined, args.task_id.trim())
      const billing = matteBilling(result)
      return this.externalResult({ action: name, task_id: args.task_id, ...result, ...(billing ? { billing } : {}), status: result.status || 'unknown', alpha_verified: false, jianying_compatible: false, format: 'WEBM' })
    }
    if (name !== 'submit') throw new Error(`Unknown tool: ${name}`)
    validateExternalMedia(args)
    const tool = TOOLS[0]
    const fields = Object.keys(tool.inputSchema.properties ?? {})
    if (Object.keys(args).some(key => !fields.includes(key))) throw new Error('Unsupported parameter')
    if (typeof args.video_url !== 'string' || !args.video_url) throw new Error('video_url is required')
    if (args.format !== undefined && args.format !== 'WEBM') throw new Error('Unsupported format for this endpoint')
    const payload = { ...args, format: 'WEBM' }
    const result = await this.request('submit_task', 'POST', payload)
    return this.externalResult({ action: name, ...result, requested_format: payload.format, format: 'WEBM', jianying_compatible: false, alpha_verified: false, success: result.success !== false && Boolean(result.task_id), status: result.status || (result.task_id ? 'submitted' : 'failed') })
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
        return { ...result, success: false, status: result.status || (method === 'GET' ? 'unknown' : 'failed'), error: result.error || result.message || detail || `HTTP ${response.status}` } as TaskResponse
      }
      throw new Error(`Video portrait matte ${endpoint} failed (${response.status}): ${detail || 'unknown error'}`)
    }
    return (await response.json()) as TaskResponse
  }

  private async prepareMedia(value: unknown, field: string): Promise<string> {
    const source = typeof value === 'string' ? value.trim() : ''
    if (!source) throw new McpError(ErrorCode.InvalidParams, `'${field}' is required`)
    if (/^https?:\/\//i.test(source)) {
      await probeVideoSource(source, MAX_VIDEO_DURATION_SECONDS)
      return source
    }
    const filePath = source.startsWith('file://') ? fileURLToPath(source) : source
    if (!path.isAbsolute(filePath)) {
      throw new McpError(ErrorCode.InvalidParams, `'${field}' must be a remote URL, file URL, or absolute local path`)
    }
    const stats = await fsPromises.stat(filePath)
    if (!stats.isFile()) throw new McpError(ErrorCode.InvalidParams, `'${field}' must point to a file`)
    if (!VIDEO_FILE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
      throw new McpError(ErrorCode.InvalidParams, `'${field}' only accepts video files`)
    }
    await probeVideoSource(filePath, MAX_VIDEO_DURATION_SECONDS)
    const uploaded = await ossUploadService.uploadLocalFile(filePath, {
      bucket: 'oss-hangzhou-mp4', region: 'oss-cn-hangzhou',
      folder: 'agent_tmp/{uid}', objectKeyPrefix: 'vectcut_video_portrait_matte_',
      signExpiresSeconds: 60 * 60
    })
    return uploaded.signedPublicUrl
  }

  private async progress(extra: Extra | undefined, value: number) {
    if (!extra?._meta?.progressToken || !extra.sendNotification) return
    await extra.sendNotification({
      method: 'notifications/progress',
      params: { progressToken: extra._meta.progressToken, progress: value, total: 100 }
    })
  }

  private async submitAndWait(tool: Tool, args: Record<string, unknown>, extra?: Extra) {
    extra?.signal?.throwIfAborted()
    const fields = Object.keys(tool.inputSchema.properties ?? {})
    const unexpected = Object.keys(args).find((key) => !fields.includes(key))
    if (unexpected) throw new McpError(ErrorCode.InvalidParams, `Unsupported parameter: ${unexpected}`)
    if (args.format !== undefined && !OUTPUT_FORMATS.includes(args.format as typeof OUTPUT_FORMATS[number])) {
      throw new McpError(ErrorCode.InvalidParams, `Invalid format; use ${OUTPUT_FORMATS.join(', ')}`)
    }
    const outputFormat = (args.format as string) || DEFAULT_FORMAT
    const payload = { ...args, format: 'WEBM', video_url: await this.prepareMedia(args.video_url, 'video_url') }
    extra?.signal?.throwIfAborted()
    await this.progress(extra, 5)
    const submitted = await this.request('submit_task', 'POST', payload)
    const taskId = String(submitted.task_id || '').trim()
    if (!taskId || submitted.success === false) {
      throw new Error(`Video portrait matte submission failed: ${JSON.stringify(submitted)}`)
    }
    const deadline = Date.now() + POLL_TIMEOUT_MS
    let attempt = 0
    let lastBilling: Record<string, unknown> | undefined
    while (Date.now() < deadline) {
      extra?.signal?.throwIfAborted()
      const result = await this.request('task_status', 'GET', undefined, taskId)
      extra?.signal?.throwIfAborted()
      const status = String(result.status || '').toLowerCase()
      const normalizedBilling = matteBilling(result)
      if (normalizedBilling) lastBilling = normalizedBilling
      if (['failed', 'error', 'cancelled', 'canceled', 'billing_failed'].includes(status) || result.success === false) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(publicResult({
            provider: 'vectcut', task: tool.name, task_id: taskId, ...result,
            ...(lastBilling ? { billing: lastBilling } : {})
          }), null, 2) }],
          isError: true
        }
      }
      if (['success', 'completed', 'done'].includes(status)) {
        const videoUrl = result.video_url || result.result?.video_url
        const completed = {
          provider: 'vectcut', action: 'submit_and_wait', task: tool.name, task_id: taskId,
          ...result, video_url: videoUrl, source_video_url: videoUrl, requested_format: outputFormat, backend_format: 'WEBM',
          ...(lastBilling ? { billing: lastBilling } : {})
        }
        if (typeof videoUrl !== 'string' || !videoUrl.trim()) {
          return { content: [{ type: 'text' as const, text: JSON.stringify(publicResult({ ...completed, success: false, status: 'output_validation_failed', provider_status: result.status, error: 'Provider completed without a video URL', alpha_verified: false, jianying_compatible: false }), null, 2) }], isError: true }
        }
        let verification: Record<string, unknown> = {
          format: outputFormat, alpha_verified: false, jianying_compatible: false
        }
        if (outputFormat === 'MOV') {
          await this.progress(extra, 96)
          let prepared: Awaited<ReturnType<typeof preparePortraitMovForJianying>> | undefined
          try {
            prepared = await preparePortraitMovForJianying(videoUrl, extra?.signal)
            extra?.signal?.throwIfAborted()
            const uploaded = await ossUploadService.uploadLocalFile(prepared.videoPath, {
              bucket: 'oss-hangzhou-mp4', region: 'oss-cn-hangzhou',
              folder: 'agent_tmp/{uid}', objectKeyPrefix: 'vectcut_portrait_output_',
              contentType: 'video/quicktime', signExpiresSeconds: 12 * 60 * 60
            })
            extra?.signal?.throwIfAborted()
            if (!uploaded.signedPublicUrl) throw new Error('Converted MOV upload returned no URL')
            verification = {
              ...prepared.verification, transparent: true, video_url: uploaded.signedPublicUrl,
              normalization: prepared.normalization, locally_converted: true,
              // Override nested provider URLs as well, so consumers cannot mistake
              // result.video_url (WebM) for the editor-ready file.
              ...(result.result ? { result: { ...result.result, source_video_url: videoUrl, video_url: uploaded.signedPublicUrl, format: 'MOV' } } : {})
            }
          } catch (error) {
            logger.error('Portrait output processing failed', { taskId, error: String(error) })
            extra?.signal?.throwIfAborted()
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(publicResult({
                ...completed, success: false, status: 'output_conversion_failed', provider_status: result.status,
                error: `透明视频本地转换失败：${error instanceof Error ? error.message : String(error)}`,
                alpha_verified: false, jianying_compatible: false
              }), null, 2) }], isError: true
            }
          } finally {
            await prepared?.cleanup().catch(error => logger.warn('Unable to clean portrait conversion temp files', { error: String(error) }))
          }
        }
        extra?.signal?.throwIfAborted()
        await this.progress(extra, 100)
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(publicResult({ ...completed, ...verification, progress: 100 }), null, 2) }]
        }
      }
      attempt += 1
      const reported = typeof result.progress === 'number'
        ? (result.progress <= 1 ? result.progress * 100 : result.progress)
        : 15 + attempt * 3
      await this.progress(extra, Math.min(95, Math.max(15, reported)))
      await new Promise((resolve) => setTimeout(resolve, Math.min(POLL_INTERVAL_MS, Math.max(0, deadline - Date.now()))))
    }
    throw new Error(`Video portrait matte task ${taskId} timed out after 35 minutes; query task_status with this task_id to check its result`)
  }
}

export default VideoPortraitMatteServer
