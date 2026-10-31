import ipaddr from 'ipaddr.js'
import { createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

import { loggerService } from '@logger'
import { agentRuntimeAuthService } from '@main/services/agents/services/AgentRuntimeAuthService'
import { mainHttpClient } from '@main/services/network/MainHttpClient'
import { ossUploadService } from '@main/services/OssUploadService'
import { prepareAudioUnderstanding } from '@main/utils/prepare-subtitle-audio'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { ProgressToken, Tool } from '@modelcontextprotocol/sdk/types.js'
import Store from 'electron-store'

import { requestWithVectcutAuth } from './vectcut-auth'
import { persistWorkspaceJsonArtifact } from './workspace-json-artifact'

const logger = loggerService.withContext('MCPServer:AudioUnderstand')
const MODEL = 'qwen3.8-omni-flash'
const API_ROOT = 'https://open.vectcut.com/llm/chat/submit_task'
const POLL_TIMEOUT_MS = 35 * 60 * 1000
const TOOL: Tool = {
  name: 'submit_audio_understanding_task',
  description:
    'Deeply understand the audio of an audio or video source using the fixed qwen3.8-omni-flash model and your prompt. Analyze speech, vocal emotion, music, environmental sounds, animal calls, and audible events, not just subtitle text. This is audio-only understanding, not visual inspection, speaker identity verification, or precise subtitle alignment. Specify the information and output format you need in prompt; distinguish audible evidence from uncertain inference. Downloads remote media, extracts and uploads a temporary audio track, submits one chat task, and waits for the answer. Only the first 15 minutes are analyzed for longer sources; the result explicitly reports truncation. Original media is unchanged.',
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'Audio/video HTTP(S) URL, file URL, or absolute local path.'
      },
      prompt: {
        type: 'string',
        description:
          'Question or instructions describing the desired audio analysis, including output language/format and approximate event timestamps when needed.'
      }
    },
    required: ['url', 'prompt'],
    additionalProperties: false
  }
}

type Extra = {
  signal?: AbortSignal
  _meta?: { progressToken?: ProgressToken }
  sendNotification?: (notification: {
    method: 'notifications/progress'
    params: {
      progressToken: ProgressToken
      progress: number
      total: number
      message: string
    }
  }) => Promise<void>
}
type Completion = {
  billing?: Record<string, unknown>
  usage?: Record<string, unknown>
  choices?: Array<{
    message?: { content?: string | Array<{ text?: string }> }
  }>
}
type TaskStatus = {
  status?: string
  success?: boolean
  message?: string
  error?: string
  error_code?: unknown
  progress?: number
  billing?: Record<string, unknown>
  result?: {
    assistant?: string
    response?: Completion
    billing?: Record<string, unknown>
    error?: string
  }
}

// Validate before alias resolution. No DNS, redirects or media probing here;
// the backend must enforce those policies at its download boundary.
function publicMediaUrl(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value || /[\\\s]/.test(value))
    throw new Error(`'${field}' requires a public HTTP(S) URL`)
  const url = new URL(value)
  const host = url.hostname
    .replace(/^\[|\]$/g, '')
    .toLowerCase()
    .replace(/\.$/, '')
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (!ipaddr.isValid(host) && !host.includes('.')) ||
    /(^|\.)(localhost|local|internal|test|invalid)$/.test(host) ||
    (ipaddr.isValid(host) && ipaddr.parse(host).range() !== 'unicast')
  )
    throw new Error(`'${field}' requires a public HTTP(S) URL`)
  return value
}

function externalFailure(result: Record<string, unknown>): boolean {
  return (
    result.success === false ||
    ['failed', 'error', 'cancelled', 'canceled', 'failure'].includes(String(result.status || '').toLowerCase())
  )
}

const EXTERNAL_TOOLS: Tool[] = [
  {
    name: 'submit',
    description:
      'Submit directly to the backend and return task_id immediately. Public HTTP(S) media URLs only; no preprocessing or waiting.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Public HTTP(S) media URL only.'
        },
        prompt: {
          type: 'string',
          description: 'prompt'
        }
      },
      additionalProperties: false,
      required: ['url', 'prompt']
    }
  },
  {
    name: 'task_status',
    description: 'Query the backend once. Preserve results, billing and failures without downloading or waiting.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          minLength: 1
        }
      },
      required: ['task_id'],
      additionalProperties: false
    }
  }
]

export default class AudioUnderstandServer {
  public readonly mcpServer: McpServer
  private readonly store = new Store({ name: 'vectcut' })

  constructor(
    private readonly workspacePath?: string,
    private readonly options: { external?: boolean } = {}
  ) {
    this.mcpServer = new McpServer({ name: 'audio-understand', version: '1.0.0' }, { capabilities: { tools: {} } })
    this.mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.options.external ? EXTERNAL_TOOLS : [TOOL]
    }))
    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      if (this.options.external)
        return this.executeExternalRequest(request.params.name, request.params.arguments ?? {}, extra as Extra)
      if (request.params.name !== TOOL.name) return this.format({ error: `Unknown tool: ${request.params.name}` }, true)
      return this.executeDirectRequest(request.params.arguments ?? {}, extra as Extra)
    })
  }

  private async executeExternalRequest(name: string, args: Record<string, unknown>, extra?: Extra) {
    let taskId = ''
    try {
      if (!['submit', 'task_status'].includes(name)) throw new Error(`Unknown external tool: ${name}`)
      const allowed = name === 'task_status' ? ['task_id'] : ['url', 'prompt']
      if (Object.keys(args).some((key) => !allowed.includes(key))) throw new Error('Unsupported external argument')
      if (name === 'task_status') {
        if (typeof args.task_id !== 'string' || !args.task_id.trim()) throw new Error("'task_id' is required")
        taskId = args.task_id.trim()
        const result = (await this.request(
          `task_status?${new URLSearchParams({ task_id: taskId })}`,
          undefined,
          extra?.signal
        )) as Record<string, unknown>
        return this.format({ ...result, task_id: taskId }, externalFailure(result))
      }
      const url = publicMediaUrl(args.url, 'url')
      if (typeof args.prompt !== 'string' || !args.prompt.trim()) throw new Error("'prompt' is required")
      const payload = {
        model: MODEL,
        stream: false,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'audio_url', audio_url: { url } },
              { type: 'text', text: args.prompt.trim() }
            ]
          }
        ]
      }
      const result = (await this.request('submit_chat_task', payload, extra?.signal)) as Record<string, unknown>
      const failed = externalFailure(result) || typeof result.task_id !== 'string' || !result.task_id.trim()
      return this.format(
        {
          ...result,
          ...(failed
            ? {
                success: false,
                error: result.error || 'Backend submission failed or returned no task ID'
              }
            : { status: result.status || 'submitted' })
        },
        failed
      )
    } catch (error) {
      return this.format(
        {
          ...(taskId ? { task_id: taskId, status: 'unknown' } : {}),
          error: error instanceof Error ? error.message : String(error)
        },
        true
      )
    }
  }

  private format(payload: Record<string, unknown>, isError = false) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
      ...(isError ? { isError: true } : {})
    }
  }

  private async progress(extra: Extra | undefined, progress: number, message: string) {
    const progressToken = extra?._meta?.progressToken
    if (progressToken === undefined || !extra?.sendNotification) return
    await extra.sendNotification({ method: 'notifications/progress', params: { progressToken, progress, total: 100, message } })
  }

  private async request(endpoint: string, body?: Record<string, unknown>, signal?: AbortSignal) {
    const response = await requestWithVectcutAuth(
      this.store,
      (force) => agentRuntimeAuthService.ensureValidAccessToken(force),
      (token) => mainHttpClient.fetch(`${API_ROOT}/${endpoint}`, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal
      })
    )
    if (!response.ok) throw new Error(`Audio understanding request failed (${response.status}): ${await response.text()}`)
    return response.json()
  }

  private async prepareSource(input: string, extra?: Extra) {
    const source = input.startsWith('file://') ? fileURLToPath(input) : input
    const remote = /^https?:\/\//i.test(source)
    if (!remote && !path.isAbsolute(source)) throw new Error("'url' must be an HTTP(S) URL, file URL, or absolute local path")
    let tempDir: string | undefined
    try {
      let localPath = source
      if (remote) {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vectcut-audio-understand-'))
        localPath = path.join(tempDir, 'source')
        const response = await mainHttpClient.fetch(source, { signal: extra?.signal })
        if (!response.ok || !response.body) throw new Error(`Audio source download failed (${response.status})`)
        await pipeline(Readable.fromWeb(response.body as any), createWriteStream(localPath), { signal: extra?.signal })
      }
      if (!(await fs.stat(localPath)).isFile()) throw new Error("'url' must point to a media file")
      await this.progress(extra, 5, '正在准备分析音频')
      const audio = await prepareAudioUnderstanding(localPath, extra?.signal)
      try {
        extra?.signal?.throwIfAborted()
        await this.progress(extra, 8, audio.truncated ? '音频已截取前 15 分钟，正在上传' : '正在上传分析音频')
        const uploaded = await ossUploadService.uploadLocalFile(audio.audioPath, {
          bucket: 'oss-hangzhou-mp4',
          region: 'oss-cn-hangzhou',
          folder: 'agent_tmp/{uid}',
          objectKeyPrefix: 'vectcut_audio_understand_',
          signExpiresSeconds: 60 * 60
        })
        return {
          submitted_url: uploaded.signedPublicUrl,
          original_input: input,
          source_kind: remote ? 'remote_media' : 'local_media',
          source_duration_seconds: audio.durationSeconds,
          analyzed_start_seconds: 0,
          analyzed_end_seconds: audio.analyzedDurationSeconds,
          analyzed_duration_seconds: audio.analyzedDurationSeconds,
          truncated: audio.truncated
        }
      } finally {
        await audio.cleanup()
      }
    } finally {
      if (tempDir) await fs.rm(tempDir, { recursive: true, force: true })
    }
  }

  public async executeDirectRequest(args: Record<string, unknown>, extra?: Extra) {
    if (this.options.external) return this.format({ error: 'Internal long-running tool is unavailable externally' }, true)
    try {
      const url = typeof args.url === 'string' ? args.url.trim() : ''
      const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
      if (!url || !prompt) throw new Error("'url' and 'prompt' are required")
      extra?.signal?.throwIfAborted()
      const source = await this.prepareSource(url, extra)
      extra?.signal?.throwIfAborted()
      const submitted = await this.request('submit_chat_task', {
        model: MODEL,
        stream: false,
        messages: [{
          role: 'user',
          content: [
            { type: 'audio_url', audio_url: { url: source.submitted_url } },
            { type: 'text', text: prompt }
          ]
        }]
      }, extra?.signal) as { task_id?: string; success?: boolean; error?: string }
      if (submitted.success === false || !submitted.task_id) throw new Error(submitted.error || 'Audio understanding returned no task ID')
      const deadline = Date.now() + POLL_TIMEOUT_MS
      await this.progress(extra, 12, '音频理解任务已提交')
      let final: TaskStatus | undefined
      while (Date.now() < deadline) {
        extra?.signal?.throwIfAborted()
        const status = await this.request(`task_status?${new URLSearchParams({ task_id: submitted.task_id })}`, undefined, extra?.signal) as TaskStatus
        const normalized = String(status.status || '').toLowerCase()
        if (['success', 'completed', 'done', 'failed', 'error', 'cancelled'].includes(normalized)) {
          final = status
          break
        }
        if (status.success === false) throw new Error(status.error || status.message || 'Audio understanding status query failed')
        const progress = typeof status.progress === 'number' && Number.isFinite(status.progress) ? status.progress : 12
        await this.progress(extra, Math.max(12, Math.min(95, progress)), status.message || '正在理解音频')
        await delay(5000, undefined, { signal: extra?.signal })
      }
      if (!final) throw new Error('Audio understanding timed out after 35 minutes')
      const failed = ['failed', 'error', 'cancelled'].includes(String(final.status).toLowerCase())
      const response = final.result?.response
      const messageContent = response?.choices?.[0]?.message?.content
      const content = final.result?.assistant ?? (typeof messageContent === 'string' ? messageContent : messageContent?.map((part) => part.text || '').join('')) ?? ''
      const billing = response?.billing ?? final.result?.billing ?? final.billing
      const payload = {
        provider: 'vectcut',
        mode: 'audio_understanding',
        model: MODEL,
        task_id: submitted.task_id,
        status: final.status,
        success: !failed,
        prompt,
        content,
        source_summary: [source],
        ...(source.truncated ? { warning: '仅分析了前 15 分钟，后续音频未上传分析。' } : {}),
        ...(billing ? { billing } : {}),
        ...(response?.usage ? { usage: response.usage } : {}),
        error: final.error || final.result?.error || (failed ? final.message || 'Audio understanding failed' : ''),
        error_code: final.error_code
      }
      const artifact = await persistWorkspaceJsonArtifact({
        toolName: 'audio-understand', taskId: submitted.task_id, workspaceRoot: this.workspacePath,
        relativeDirSegments: [], payload: { ...payload, result: final.result }
      })
      if (!failed) await this.progress(extra, 100, '音频理解完成')
      return this.format({
        ...payload,
        ...(artifact ? { artifact: { storage: 'workspace_file', file_path: artifact.filePath, relative_path: artifact.relativePath } } : {})
      }, failed)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Audio understanding failed', { error: message })
      return this.format({ error: message }, true)
    }
  }
}
