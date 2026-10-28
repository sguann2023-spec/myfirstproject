import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { app, net } from 'electron'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from '@modelcontextprotocol/sdk/types.js'
import DraftManagementServer from './draft-management'
import { loggerService } from '@logger'

const logger = loggerService.withContext('DraftRenderServer')

const execFileAsync = promisify(execFile)
const ffprobeStatic = require('ffprobe-static') as { path?: string }
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const TIMEOUT_MS = 5 * 60 * 1000
const POLL_MS = 2000

type ObjectValue = Record<string, any>
type ExecutionExtra = {
  signal?: AbortSignal
  _meta?: { progressToken?: string | number }
  sendNotification?: (notification: any) => Promise<void>
}
const TOOL: Tool = {
  name: 'render_draft',
  description: '草稿渲染（云渲染 / 渲染 / 预渲染，cloud draft render / preview）：用于字幕验收、动画时序、轨道层叠、声音效果、声音大小、字体效果、转场效果、组合画面的真实效果验收。Verify subtitles, animation timing, track layering, audio effects and volume, fonts, transitions and compositing. Prefer lightweight preview tools first; use render_draft as a last resort when those cannot verify the actual result. Render an existing cloud draft_id. If the working draft exceeds the limits, create a separate cloud test draft <=5 seconds reproducing the relevant layers, timing, styles and audio, then render it without changing the working draft; do not abandon verification because the working draft is too long. Use cloud-accessible HTTP(S) assets; full video/audio sources must be <=20 seconds and images <=20 MiB. Prepare eligible short source assets when needed: timeline trimming alone does not shorten the full source. No draft JSON, local output path, or MP4 download. Returns a cloud video URL and actual billing when reported.',
  inputSchema: {
    type: 'object',
    properties: {
      draft_id: { type: 'string', minLength: 1 },
      draftId: { type: 'string', minLength: 1 },
      resolution: { type: 'string', default: '720P', minLength: 1 },
      framerate: { type: 'string', default: '24', pattern: '^[1-9][0-9]*$' }
    },
    anyOf: [{ required: ['draft_id'] }, { required: ['draftId'] }],
    additionalProperties: false
  }
}

function remoteUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try { return ['http:', 'https:'].includes(new URL(value).protocol) } catch { return false }
}
function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}
function probePath(): string {
  const executable = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
  const packaged = app.isPackaged
    ? process.platform === 'darwin'
      ? path.join(process.resourcesPath, '..', 'Frameworks', 'ffprobe', 'darwin', process.arch, executable)
      : path.join(process.resourcesPath, 'ffprobe', 'win32', process.arch, executable)
    : ''
  const bundled = ffprobeStatic.path || ''
  return [packaged, bundled, bundled.replace('app.asar', 'app.asar.unpacked')].find(p => p && existsSync(p)) || 'ffprobe'
}

/** All validation is internal and completes before the paid render submission. */
export async function validateRenderDraft(script: ObjectValue, signal: AbortSignal): Promise<void> {
  if (script.duration === 0) throw new Error('Cannot render an empty draft: duration is 0.')
  const duration = positiveNumber(script.duration)
  if (!duration || duration > 5_000_000) throw new Error('Cannot safely render: draft duration must be known and <=5 seconds (microsecond duration field).')
  const media: Array<{ value: ObjectValue; location: string; kind: string }> = []
  const references: Array<{ url: string; location: string; kind: string; owner: ObjectValue }> = []
  const referenceKey = /^(?:(?:.*_)?(?:path|url|uri)|.*(?:Path|Url|URL|Uri)|src|source|filename|file_name)$/
  for (const [group, kind] of Object.entries({ videos: 'video', audios: 'audio', images: 'image', photos: 'image' })) {
    const items = script.materials?.[group]
    if (!Array.isArray(items)) continue
    for (const [index, object] of items.entries()) {
      if (!object || typeof object !== 'object') continue
      const location = `materials.${group}[${index}]`
      const type = String(object.type || '').toLowerCase()
      const resolvedKind = /^(photo|image|still)$/.test(type) ? 'image' : kind
      media.push({ value: object, location, kind: resolvedKind })
      // Only source fields on media records are checked; effect/template dependencies
      // may use local cache paths that the render service resolves by resource id.
      for (const [key, child] of Object.entries(object)) {
        if (typeof child !== 'string' || !child.trim() || !referenceKey.test(key)) continue
        const field = `${location}.${key}`
        if (!remoteUrl(child)) {
          // Never echo user directory names, credentials, or unbounded source values.
          throw new Error(`Local or unverifiable ${resolvedKind} asset at ${field}: [redacted local reference]. Replace it with a cloud-accessible HTTP(S) URL.`)
        }
        references.push({ url: child, location: field, kind: resolvedKind, owner: object })
      }
    }
  }
  // Explicit material records must prove their source, not just carry an opaque material id.
  for (const item of media) {
    if (!references.some(ref => ref.location.startsWith(`${item.location}.`))) {
      throw new Error(`Cannot verify ${item.kind} source at ${item.location}; supply a cloud-accessible material URL.`)
    }
  }
  const checked = new Set<string>()
  for (const ref of references) {
    signal.throwIfAborted()
    const kind = !['video', 'audio'].includes(ref.kind) && /\.(png|jpe?g|webp|gif|avif|bmp|heic)(?:[?#]|$)/i.test(ref.url) ? 'image' : ref.kind
    const cacheKey = `${kind}:${ref.url}`
    if (kind === 'image' && checked.has(cacheKey)) continue
    checked.add(cacheKey)
    if (kind === 'image') {
      await verifyImageSize(ref.url, ref.location, signal)
    } else if (kind === 'video' || kind === 'audio') {
      // Jianying material.duration is full source length in microseconds. Never use
      // source_timerange/target_timerange (trimmed timeline lengths) as source metadata.
      const sourceUs = positiveNumber(ref.owner.duration)
      let seconds = sourceUs === undefined ? undefined : sourceUs / 1_000_000
      if (seconds === undefined) {
        try {
          const { stdout } = await execFileAsync(probePath(), [
            '-v', 'error', '-protocol_whitelist', 'http,https,tcp,tls,crypto',
            '-rw_timeout', '15000000', '-show_entries', 'format=duration', '-of', 'json', ref.url
          ], { timeout: 20_000, maxBuffer: 256 * 1024, signal })
          const raw = JSON.parse(stdout).format?.duration
          seconds = typeof raw === 'string' && raw.trim() ? Number(raw) : undefined
        } catch {
          throw new Error(`Cannot verify full ${kind} source duration at ${ref.location}; provide reliable source metadata or a probeable remote URL.`)
        }
      }
      if (!seconds || !Number.isFinite(seconds) || seconds <= 0 || seconds > 20) {
        throw new Error(`Full ${kind} source at ${ref.location} must be verifiably <=20 seconds (not its trimmed timeline length).`)
      }
    }
  }
}

async function verifyImageSize(url: string, location: string, signal: AbortSignal) {
  const imageSignal = AbortSignal.any([signal, AbortSignal.timeout(20_000)])
  let head: Response | undefined
  try { head = await net.fetch(url, { method: 'HEAD', signal: imageSignal }) } catch { imageSignal.throwIfAborted() }
  const length = head?.headers.get('content-length')
  if (head?.ok && length && /^\d+$/.test(length)) {
    if (Number(length) > MAX_IMAGE_BYTES) throw new Error(`Image at ${location} exceeds 20 MiB.`)
    if (Number(length) > 0) return
  }
  const response = await net.fetch(url, { signal: imageSignal })
  const reader = response.body?.getReader()
  if (!response.ok || !reader) {
    await reader?.cancel()
    throw new Error(`Cannot verify image size at ${location}; remote image must be <=20 MiB.`)
  }
  let bytes = 0
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > MAX_IMAGE_BYTES) throw new Error(`Image at ${location} exceeds 20 MiB.`)
    }
    if (!bytes) throw new Error(`Cannot verify empty image at ${location}.`)
  } finally {
    await reader.cancel().catch(() => {})
  }
}

class DraftRenderServer {
  public readonly mcpServer: McpServer
  private readonly drafts: DraftManagementServer

  constructor(workspacePath?: string) {
    this.drafts = new DraftManagementServer(workspacePath)
    this.mcpServer = new McpServer({ name: 'draft-render', version: '1.0.0' }, { capabilities: { tools: {} } })
    this.mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [TOOL] }))
    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      if (request.params.name !== TOOL.name) return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Unknown tool' }) }] }
      return this.render(request.params.arguments || {}, extra as ExecutionExtra)
    })
  }

  private async render(args: ObjectValue, extra: ExecutionExtra) {
    const deadline = new AbortController()
    const timeout = setTimeout(() => deadline.abort(new Error('Cloud render timed out after 5 minutes')), TIMEOUT_MS)
    const signal = extra.signal ? AbortSignal.any([extra.signal, deadline.signal]) : deadline.signal
    let draftId: string | undefined
    let taskId: string | undefined
    let billing: { total_consumed_points: number; currency: string } | null = null
    let progress = 0
    const notify = async (message: string) => {
      if (extra._meta?.progressToken !== undefined && extra.sendNotification) {
        progress = message === 'Cloud render complete' ? 100 : Math.min(progress + 1, 95)
        await extra.sendNotification({ method: 'notifications/progress', params: { progressToken: extra._meta.progressToken, progress, total: 100, message } }).catch(() => {})
      }
    }
    const wait = (milliseconds = POLL_MS) => new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(signal.reason) }
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, milliseconds)
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
    })
    const request = async (endpoint: string, body: ObjectValue, requestSignal = signal) => {
      requestSignal.throwIfAborted()
      // Race both headers and body against abort: a late/hung response must not
      // exceed the supplementary budget or mutate the billing snapshot later.
      let abort: () => void = () => {}
      const aborted = new Promise<never>((_, reject) => {
        abort = () => reject(requestSignal.reason)
        requestSignal.addEventListener('abort', abort, { once: true })
        if (requestSignal.aborted) abort()
      })
      let response: Response
      let data: ObjectValue
      try {
        ;[response, data] = await Promise.race([
          (async () => {
            const response = await this.drafts.requestWithAuth(`/cut_jianying/${endpoint}`, body, requestSignal)
            return [response, await response.json() as ObjectValue] as const
          })(),
          aborted
        ])
        requestSignal.throwIfAborted()
      } finally {
        requestSignal.removeEventListener('abort', abort)
      }
      // Task status repeats task totals: replace the snapshot, NEVER add poll totals.
      const raw = data.billing?.total_consumed_points ?? data.output?.billing?.total_consumed_points
        ?? data.total_consumed_points ?? data.output?.total_consumed_points
        ?? data.billing?.points_consumed ?? data.output?.billing?.points_consumed
        ?? data.points_consumed ?? data.output?.points_consumed
        ?? data.billing?.consume ?? data.output?.billing?.consume ?? data.consume ?? data.output?.consume
        ?? (typeof data.output?.billing === 'number' ? data.output.billing : undefined)
        ?? (typeof data.billing === 'number' ? data.billing : undefined)
      const points = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN
      if (Number.isFinite(points) && points >= 0) billing = { total_consumed_points: points, currency: 'points' }
      // task_status.output.success stays false until completion; status controls polling.
      if (!response.ok || data.success === false || (endpoint !== 'task_status' && data.output?.success === false)) {
        throw new Error(`Cloud ${endpoint} failed (${response.status}).`)
      }
      return data.output as ObjectValue
    }
    const result = (status: string, error?: string, url?: string) => {
      // Like image generation, place billing before potentially long output URLs.
      // Also preserve structured metadata through codemode/details and preview storage.
      const payload = {
        provider: 'vectcut', action: 'render_draft', draft_id: draftId, task_id: taskId, status, billing,
        ...(error ? { error } : {}), ...(url ? { video_url: url, temporary_video: true } : {})
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
        ...(error ? { isError: true } : {})
      }
    }
    try {
      if (Object.keys(args).some(key => !['draft_id', 'draftId', 'resolution', 'framerate'].includes(key))) throw new Error('Only draft_id/draftId, resolution and framerate are accepted; no JSON or output paths.')
      for (const key of ['draft_id', 'draftId', 'resolution', 'framerate']) {
        if (args[key] !== undefined && (typeof args[key] !== 'string' || !args[key].trim())) throw new Error(`${key} must be a nonempty string.`)
      }
      draftId = args.draft_id?.trim() || args.draftId?.trim()
      if (!draftId || (args.draft_id && args.draftId && args.draft_id.trim() !== args.draftId.trim())) throw new Error('A cloud draft_id is required; draft_id and draftId must agree.')
      if (args.framerate && !/^[1-9][0-9]*$/.test(args.framerate)) throw new Error('framerate must be a positive integer string.')
      signal.throwIfAborted()
      await notify('Checking cloud draft and source limits')
      const script = await this.drafts.queryScriptInMemory(draftId, signal)
      await validateRenderDraft(script, signal)
      await notify('Submitting cloud render')
      const submitted = await request('generate_video', { draft_id: draftId, resolution: args.resolution || '720P', framerate: args.framerate || '24' })
      taskId = typeof submitted?.task_id === 'string' ? submitted.task_id : undefined
      if (!taskId) throw new Error('Cloud generate_video returned no task_id.')
      for (;;) {
        const output = await request('task_status', { task_id: taskId })
        const status = String(output?.status || '').toUpperCase()
        if (status === 'SUCCESS') {
          if (!remoteUrl(output.result)) throw new Error('Cloud render succeeded without a usable HTTP(S) result URL.')
          if (billing === null) {
            const billingDeadline = Date.now() + 10_000
            try {
              for (let attempt = 0; attempt < 5 && billing === null; attempt++) {
                const waitRemaining = billingDeadline - Date.now()
                if (waitRemaining <= 0) break
                await wait(Math.min(POLL_MS, waitRemaining))
                if (waitRemaining < POLL_MS) break
                const remaining = billingDeadline - Date.now()
                if (remaining < 0) break
                const supplement = new AbortController()
                const timer = setTimeout(() => supplement.abort(new Error('Billing wait expired')), remaining)
                try {
                  await request('task_status', { task_id: taskId }, AbortSignal.any([signal, supplement.signal]))
                } finally {
                  clearTimeout(timer)
                }
              }
            } catch {
              // Billing is best effort after a usable video exists. Only explicit
              // cancellation retains the existing cancellation result semantics.
              extra.signal?.throwIfAborted()
            }
          }
          extra.signal?.throwIfAborted()
          await notify('Cloud render complete')
          return result('SUCCESS', undefined, output.result)
        }
        if (status === 'FAILURE') return result('FAILURE', 'Cloud render task failed (FAILURE).')
        if (!['PENDING', 'PROCESSING', 'UPLOADING', 'DOWNLOADING', 'EXPORTING'].includes(status)) throw new Error(`Cloud render returned an unsupported task status: ${status.slice(0, 40)}`)
        await notify(`Cloud render ${status.toLowerCase()}`)
        await wait()
      }
    } catch (error) {
      const status = signal.aborted ? deadline.signal.aborted ? 'TIMEOUT' : 'CANCELLED' : 'FAILED'
      // Network/probe errors can contain URLs/local paths; expose only our bounded validation messages.
      const message = error instanceof Error ? error.message : 'Cloud render failed'
      const safeMessage = /^(Cannot |Local |Full |Image |Only |A cloud |Cloud |Query |draft_|draftId |resolution |framerate )/.test(message) ? message.slice(0, 700) : 'Cloud render failed; check authentication, remote source access, or retry.'
      return result(status, signal.aborted ? status === 'TIMEOUT' ? 'Cloud render timed out after 5 minutes.' : 'Cloud render cancelled; remote task may still run.' : safeMessage)
    } finally {
      clearTimeout(timeout)
    }
  }
}

export default DraftRenderServer
