import { spawn } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

import type { CanUseTool, Options } from '@anthropic-ai/claude-agent-sdk'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { Tool as McpTool } from '@modelcontextprotocol/sdk/types.js'
import type { TextStreamPart } from 'ai'
import { net } from 'electron'

import { loggerService } from '@logger'

import type { AgentStreamEvent } from '../../../interfaces/AgentStreamInterface'
import type { ClaudeRuntimeEnvironment } from '../runtime/build-runtime'
import type { ClaudeCodeInvokeContext } from '../runtime/types'
import type { PendingFileChangeSnapshot } from '../tools/runtime-file-helpers'

const logger = loggerService.withContext('ClaudeCodeHarness')

const MAX_RECORDED_PROJECTION_EVENTS = 200

export type ClaudeCodeHarnessProjectionEvent = {
  kind: 'chunk' | 'lifecycle' | 'error'
  streamEventType: AgentStreamEvent['type']
  timestamp: string
  traceId: string
  topicId: string
  turnId?: string
  segmentId?: string
  piSessionId: string
  chunkType?: TextStreamPart<any>['type']
  errorMessage?: string
}

type PiAgentCoreModule = typeof import('@earendil-works/pi-agent-core')
type PiAiModule = typeof import('@earendil-works/pi-ai')
type PiApiModule = {
  stream: unknown
  streamSimple: unknown
}
type PiSession = import('@earendil-works/pi-agent-core').Session
type PiAgentHarness = import('@earendil-works/pi-agent-core').AgentHarness
type PiInMemorySessionStorage = import('@earendil-works/pi-agent-core').InMemorySessionStorage
type PiMutableModels = import('@earendil-works/pi-ai').MutableModels
type PiModel = import('@earendil-works/pi-ai').Model<string>
type PiProvider = import('@earendil-works/pi-ai').Provider<string>
type PiStopReason = import('@earendil-works/pi-ai').StopReason
type PiUsage = import('@earendil-works/pi-ai').Usage
type PiTextContent = import('@earendil-works/pi-ai').TextContent
type PiImageContent = import('@earendil-works/pi-ai').ImageContent
type PiAgentHarnessTool = import('@earendil-works/pi-agent-core').AgentHarnessTool<any>

type PiPackageBridge = {
  agentCore: PiAgentCoreModule
  piAi: PiAiModule
  anthropicMessagesApi: PiApiModule
  openAiCompletionsApi: PiApiModule
  openAiResponsesApi: PiApiModule
  azureOpenAiResponsesApi: PiApiModule
}

type PiMcpClientBridge = {
  serverKey: string
  client: Client
  close(): Promise<void>
}

type PiRuntimeBridge = {
  storage: PiInMemorySessionStorage
  session: PiSession
  models: PiMutableModels
  provider: PiProvider
  model: PiModel
  harness: PiAgentHarness
  tools: PiAgentHarnessTool[]
  mcpClients: PiMcpClientBridge[]
}

export type ClaudeCodeHarnessAdapter = {
  enabled: boolean
  mode: 'disabled' | 'local-adapter' | 'pi-npm'
  importStrategy: 'local-adapter' | 'npm-native-import'
  invokeContext: ClaudeCodeInvokeContext
  packageBridge?: PiPackageBridge
  runtimeBridge?: PiRuntimeBridge
  packageStatus?: {
    agentCoreLoaded: boolean
    piAiLoaded: boolean
    runtimeBootstrapped?: boolean
    bootstrapProviderId?: string
    bootstrapModelId?: string
    bridgedToolCount?: number
    bridgedMcpServerCount?: number
    agentCoreExportsPreview: string[]
    piAiExportsPreview: string[]
    loaderError?: string
  }
  appendUserPrompt(text: string): void
  appendAssistantResponse(input: { text: string; stopReason?: PiStopReason; errorMessage?: string }): void
  recordProjectionEvent(event: Omit<ClaudeCodeHarnessProjectionEvent, 'timestamp'>): void
  getProjectionEvents(): ClaudeCodeHarnessProjectionEvent[]
}

function persistSessionEntry(promise: Promise<unknown>, entryType: string, traceId: string): void {
  void promise.catch((error) => {
    logger.warn('[AgentCore] failed to persist pi session entry', {
      entryType,
      traceId,
      error: error instanceof Error ? error.message : String(error)
    })
  })
}

function createEmptyUsage(): PiUsage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0
    }
  }
}

const nativeDynamicImport = new Function('specifier', 'return import(specifier)') as <TModule>(
  specifier: string
) => Promise<TModule>

async function tryLoadPiPackageBridge(): Promise<PiPackageBridge> {
  const [agentCore, piAi, anthropicMessagesApi, openAiCompletionsApi, openAiResponsesApi, azureOpenAiResponsesApi] = await Promise.all([
    nativeDynamicImport<PiAgentCoreModule>('@earendil-works/pi-agent-core'),
    nativeDynamicImport<PiAiModule>('@earendil-works/pi-ai'),
    nativeDynamicImport<PiApiModule>('@earendil-works/pi-ai/api/anthropic-messages'),
    nativeDynamicImport<PiApiModule>('@earendil-works/pi-ai/api/openai-completions'),
    nativeDynamicImport<PiApiModule>('@earendil-works/pi-ai/api/openai-responses'),
    nativeDynamicImport<PiApiModule>('@earendil-works/pi-ai/api/azure-openai-responses')
  ])

  return {
    agentCore,
    piAi,
    anthropicMessagesApi,
    openAiCompletionsApi,
    openAiResponsesApi,
    azureOpenAiResponsesApi
  }
}

function mapProviderApiType(runtimeEnvironment: ClaudeRuntimeEnvironment): 'anthropic-messages' | 'openai-completions' {
  const providerType = String(runtimeEnvironment.modelInfo.provider?.type || '').trim()
  if (providerType === 'anthropic') return 'anthropic-messages'
  return 'openai-completions'
}

function summarizeValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function matchAllowedTool(allowedTools: string[], toolName: string): boolean {
  if (allowedTools.length === 0) return true
  return allowedTools.some((pattern) => (pattern.endsWith('*') ? toolName.startsWith(pattern.slice(0, -1)) : pattern === toolName))
}

async function executeShellCommand(input: {
  command: string
  cwd: string
  env: Record<string, string>
  timeoutSeconds?: number
  signal?: AbortSignal
  onUpdate?: (text: string) => void
}): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const { command, cwd, env, timeoutSeconds, signal, onUpdate } = input

  return await new Promise((resolve, reject) => {
    const child = spawn(process.env.SHELL || '/bin/bash', ['-lc', command], {
      cwd,
      env: {
        ...process.env,
        ...env
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    let timeoutHandle: NodeJS.Timeout | undefined

    const finalize = (callback: () => void) => {
      if (settled) return
      settled = true
      if (timeoutHandle) clearTimeout(timeoutHandle)
      signal?.removeEventListener('abort', abortHandler)
      callback()
    }

    const abortHandler = () => {
      child.kill('SIGTERM')
      finalize(() => reject(new Error('Operation aborted')))
    }

    signal?.addEventListener('abort', abortHandler, { once: true })

    if (timeoutSeconds && timeoutSeconds > 0) {
      timeoutHandle = setTimeout(() => {
        child.kill('SIGTERM')
        finalize(() => reject(new Error(`Command timed out after ${timeoutSeconds} seconds`)))
      }, timeoutSeconds * 1000)
    }

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString()
      onUpdate?.(stdout)
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString()
      onUpdate?.([stdout, stderr].filter(Boolean).join('\n'))
    })
    child.on('error', (error) => finalize(() => reject(error)))
    child.on('close', (code) => finalize(() => resolve({ stdout, stderr, exitCode: code })))
  })
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let fromIndex = 0
  while (true) {
    const index = haystack.indexOf(needle, fromIndex)
    if (index < 0) break
    count += 1
    fromIndex = index + needle.length
  }
  return count
}

function toPiContentArray(value: unknown): Array<PiTextContent | PiImageContent> {
  if (typeof value === 'string') {
    return [{ type: 'text', text: value }]
  }

  if (Array.isArray(value)) {
    const mapped: Array<PiTextContent | PiImageContent> = []
    for (const entry of value) {
      if (!entry || typeof entry !== 'object') continue
      const record = entry as Record<string, unknown>

      if (record.type === 'text' && typeof record.text === 'string') {
        mapped.push({ type: 'text', text: record.text } satisfies PiTextContent)
        continue
      }

      if (record.type === 'image' && typeof record.data === 'string' && typeof record.mimeType === 'string') {
        mapped.push({ type: 'image', data: record.data, mimeType: record.mimeType } satisfies PiImageContent)
        continue
      }

      if (record.type === 'resource_link' && typeof record.uri === 'string') {
        mapped.push({ type: 'text', text: record.uri } satisfies PiTextContent)
      }
    }

    if (mapped.length > 0) return mapped
  }

  return [{ type: 'text', text: summarizeValue(value) }]
}

function extractToolText(value: unknown): string {
  return toPiContentArray(value)
    .map((part) => (part.type === 'text' ? part.text : `[image:${part.mimeType}]`))
    .join('\n')
}

function resolveToolPath(filePath: string, cwd: string): string {
  return path.normalize(path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath))
}

const MAX_INSPECT_IMAGE_BYTES = 20 * 1024 * 1024

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif'
}

function guessImageMimeType(input: { contentType?: string; sourcePath?: string }): string {
  const contentType = String(input.contentType || '')
    .split(';')[0]
    .trim()
    .toLowerCase()
  if (contentType.startsWith('image/')) {
    return contentType
  }

  const extension = path.extname(String(input.sourcePath || '')).toLowerCase()
  return IMAGE_MIME_BY_EXTENSION[extension] || 'image/png'
}

function buildInspectImagePrompt(question: string): string {
  const normalizedQuestion = String(question || '').trim()
  if (normalizedQuestion) {
    return [
      'Inspect the image carefully and answer the user question directly.',
      'Reply in the same language as the user question whenever possible.',
      'If the user asks about text in the image, transcribe the visible text as accurately as possible.',
      `Question: ${normalizedQuestion}`
    ].join('\n')
  }

  return [
    'Inspect the image carefully and describe the main visual content.',
    'Reply in the same language as the surrounding conversation when it is clear from the request.',
    'Include any clearly visible text exactly when possible.'
  ].join('\n')
}

function extractInspectImageTextFromRecord(payload: Record<string, unknown>): string {
  const anthropicContent = Array.isArray(payload.content) ? payload.content : []
  const anthropicText = anthropicContent
    .map((item) => {
      if (!item || typeof item !== 'object') return ''
      const record = item as Record<string, unknown>
      return record.type === 'text' && typeof record.text === 'string' ? record.text : ''
    })
    .filter(Boolean)
    .join('\n')
    .trim()
  if (anthropicText) return anthropicText

  const choices = Array.isArray(payload.choices) ? payload.choices : []
  const textParts: string[] = []
  for (const choice of choices) {
    if (!choice || typeof choice !== 'object') continue
    const choiceRecord = choice as Record<string, unknown>

    const message = choiceRecord.message && typeof choiceRecord.message === 'object'
      ? (choiceRecord.message as Record<string, unknown>)
      : null
    if (message) {
      const content = message.content
      if (typeof content === 'string' && content.trim()) {
        textParts.push(content.trim())
      } else if (Array.isArray(content)) {
        const messageText = content
          .map((item) => {
            if (!item || typeof item !== 'object') return ''
            const record = item as Record<string, unknown>
            return record.type === 'text' && typeof record.text === 'string' ? record.text : ''
          })
          .filter(Boolean)
          .join('\n')
          .trim()
        if (messageText) {
          textParts.push(messageText)
        }
      }
    }

    const delta = choiceRecord.delta && typeof choiceRecord.delta === 'object'
      ? (choiceRecord.delta as Record<string, unknown>)
      : null
    if (!delta) continue

    const deltaContent = delta.content
    if (typeof deltaContent === 'string' && deltaContent.trim()) {
      textParts.push(deltaContent)
    } else if (Array.isArray(deltaContent)) {
      const deltaText = deltaContent
        .map((item) => {
          if (!item || typeof item !== 'object') return ''
          const record = item as Record<string, unknown>
          return record.type === 'text' && typeof record.text === 'string' ? record.text : ''
        })
        .filter(Boolean)
        .join('\n')
        .trim()
      if (deltaText) {
        textParts.push(deltaText)
      }
    }
  }

  return textParts.join('').trim()
}

function extractInspectImageTextFromSseString(responseText: string): string {
  const raw = String(responseText || '').trim()
  if (!raw.includes('data:')) return raw

  const chunks = raw
    .split(/(?=data:\s*(?:\{|\[DONE\]))/g)
    .map((chunk) => chunk.trim())
    .filter(Boolean)

  const textParts: string[] = []
  for (const chunk of chunks) {
    if (!chunk.startsWith('data:')) continue
    const payloadText = chunk.slice(5).trim()
    if (!payloadText || payloadText === '[DONE]') continue

    try {
      const payload = JSON.parse(payloadText) as Record<string, unknown>
      const extracted = extractInspectImageTextFromRecord(payload)
      if (extracted) {
        textParts.push(extracted)
      }
    } catch {
      return raw
    }
  }

  return textParts.join('').trim() || raw
}

function extractInspectImageText(responsePayload: unknown): string {
  if (typeof responsePayload === 'string') {
    return extractInspectImageTextFromSseString(responsePayload)
  }

  if (!responsePayload || typeof responsePayload !== 'object') {
    return summarizeValue(responsePayload).trim()
  }

  const extracted = extractInspectImageTextFromRecord(responsePayload as Record<string, unknown>)
  if (extracted) return extracted

  return summarizeValue(responsePayload).trim()
}

async function resolveInspectImageInput(input: {
  source: string
  cwd: string
}): Promise<{ mimeType: string; base64: string; sourceLabel: string }> {
  const source = String(input.source || '').trim()
  if (!source) {
    throw new Error('InspectImage requires file_path, path, or url')
  }

  const dataUrlMatch = source.match(/^data:([^;,]+);base64,(.+)$/i)
  if (dataUrlMatch) {
    return {
      mimeType: guessImageMimeType({ contentType: dataUrlMatch[1] }),
      base64: dataUrlMatch[2],
      sourceLabel: 'data-url'
    }
  }

  if (/^https?:\/\//i.test(source)) {
    const response = await net.fetch(source)
    if (!response.ok) {
      throw new Error(`Failed to download image: HTTP ${response.status}`)
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > MAX_INSPECT_IMAGE_BYTES) {
      throw new Error(`Image is too large to inspect (${buffer.length} bytes)`)
    }

    return {
      mimeType: guessImageMimeType({
        contentType: response.headers.get('content-type') || '',
        sourcePath: source
      }),
      base64: buffer.toString('base64'),
      sourceLabel: source
    }
  }

  const resolvedPath = resolveToolPath(source, input.cwd)
  const buffer = await fsp.readFile(resolvedPath)
  if (buffer.length > MAX_INSPECT_IMAGE_BYTES) {
    throw new Error(`Image is too large to inspect (${buffer.length} bytes)`)
  }

  return {
    mimeType: guessImageMimeType({ sourcePath: resolvedPath }),
    base64: buffer.toString('base64'),
    sourceLabel: resolvedPath
  }
}

async function executeInspectImage(input: {
  params: Record<string, unknown>
  invokeContext: ClaudeCodeInvokeContext
  runtimeEnvironment: ClaudeRuntimeEnvironment
  cwd: string
  signal?: AbortSignal
}): Promise<{ content: Array<PiTextContent>; details: Record<string, unknown> }> {
  const { params, invokeContext, runtimeEnvironment, cwd, signal } = input
  const source = String(params.file_path || params.path || params.url || '').trim()
  const question = String(params.question || params.prompt || '').trim()
  const image = await resolveInspectImageInput({ source, cwd })

  const providerApiType = mapProviderApiType(runtimeEnvironment)
  const providerApiHost = String(runtimeEnvironment.modelInfo.provider?.apiHost || '').trim()
  const providerAnthropicHost = String(runtimeEnvironment.modelInfo.provider?.anthropicApiHost || '').trim()
  const baseUrl =
    providerApiType === 'openai-completions'
      ? ensureOpenAiApiVersionBaseUrl(providerApiHost)
      : String(providerAnthropicHost || providerApiHost || '').trim()
  const requestTarget = describePiRequestTarget({ providerApiType, baseUrl })
  const runtimeGatewayToken =
    providerApiType === 'anthropic-messages'
      ? String(runtimeEnvironment.env.ANTHROPIC_API_KEY || runtimeEnvironment.env.ANTHROPIC_AUTH_TOKEN || '').trim()
      : String(runtimeEnvironment.modelInfo.provider?.apiKey || runtimeEnvironment.env.ANTHROPIC_API_KEY || runtimeEnvironment.env.ANTHROPIC_AUTH_TOKEN || '').trim()

  if (!requestTarget.expectedRequestUrl) {
    throw new Error('InspectImage could not resolve a provider request URL')
  }
  if (!runtimeGatewayToken) {
    throw new Error('InspectImage could not resolve a provider auth token')
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${runtimeGatewayToken}`
  }

  const payload =
    providerApiType === 'anthropic-messages'
      ? {
          model: invokeContext.runtime.model.id,
          max_tokens: 1024,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: buildInspectImagePrompt(question) },
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: image.mimeType,
                    data: image.base64
                  }
                }
              ]
            }
          ]
        }
      : {
          model: invokeContext.runtime.model.id,
          stream: false,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: buildInspectImagePrompt(question) },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${image.mimeType};base64,${image.base64}`
                  }
                }
              ]
            }
          ]
        }

  if (providerApiType === 'anthropic-messages') {
    headers['anthropic-version'] = '2023-06-01'
  }

  logger.info('[AgentCore] InspectImage request start', {
    traceId: invokeContext.runtime.traceId,
    topicId: invokeContext.projection.topicId,
    piSessionId: invokeContext.projection.piSessionId,
    modelId: invokeContext.runtime.model.id,
    providerApiType,
    requestUrl: requestTarget.expectedRequestUrl,
    sourceLabel: image.sourceLabel,
    mimeType: image.mimeType,
    hasQuestion: Boolean(question)
  })

  const response = await fetch(requestTarget.expectedRequestUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal
  })
  const responseText = await response.text()
  if (!response.ok) {
    throw new Error(responseText || `InspectImage failed with HTTP ${response.status}`)
  }

  let responsePayload: unknown
  try {
    responsePayload = JSON.parse(responseText)
  } catch {
    responsePayload = responseText
  }

  const answer = extractInspectImageText(responsePayload)
  if (!answer) {
    throw new Error('InspectImage returned an empty response')
  }

  logger.info('[AgentCore] InspectImage request success', {
    traceId: invokeContext.runtime.traceId,
    topicId: invokeContext.projection.topicId,
    piSessionId: invokeContext.projection.piSessionId,
    modelId: invokeContext.runtime.model.id,
    providerApiType,
    responseChars: answer.length
  })

  return {
    content: [{ type: 'text', text: answer }],
    details: {
      source: image.sourceLabel,
      mimeType: image.mimeType,
      providerApiType
    }
  }
}

async function capturePendingFileChangeSnapshots(input: {
  toolName: string
  toolInput: unknown
  toolCallId: string
  cwd: string
  pendingFileChanges: Map<string, PendingFileChangeSnapshot[]>
}): Promise<void> {
  const { toolName, toolInput, toolCallId, cwd, pendingFileChanges } = input
  const normalizedToolName = toolName.startsWith('builtin_') ? toolName.slice('builtin_'.length) : toolName
  const record = toolInput && typeof toolInput === 'object' && !Array.isArray(toolInput) ? (toolInput as Record<string, unknown>) : null
  if (!record) return

  const rawPath = String(record.file_path || record.path || '').trim()
  if (!rawPath) return

  let operation: PendingFileChangeSnapshot['operation'] | null = null
  if (normalizedToolName === 'Write') operation = fs.existsSync(resolveToolPath(rawPath, cwd)) ? 'update' : 'create'
  if (normalizedToolName === 'Edit' || normalizedToolName === 'MultiEdit' || normalizedToolName === 'NotebookEdit') {
    operation = 'update'
  }
  if (!operation) return

  const filePath = resolveToolPath(rawPath, cwd)
  let beforeSnapshot: string | undefined
  let beforeHash: string | undefined
  const existedBefore = fs.existsSync(filePath)

  if (existedBefore) {
    try {
      beforeSnapshot = await fsp.readFile(filePath, 'utf8')
    } catch {
      beforeSnapshot = undefined
    }
  }

  if (beforeSnapshot !== undefined) {
    beforeHash = String(beforeSnapshot.length)
  }

  pendingFileChanges.set(toolCallId, [
    {
      filePath,
      operation,
      existedBefore,
      beforeSnapshot,
      beforeHash
    }
  ])
}

function buildBuiltinTools(input: {
  packageBridge: PiPackageBridge
  invokeContext: ClaudeCodeInvokeContext
  runtimeEnvironment: ClaudeRuntimeEnvironment
}): PiAgentHarnessTool[] {
  const { packageBridge, invokeContext, runtimeEnvironment } = input
  const { Type } = packageBridge.piAi
  const cwd = invokeContext.runtime.workspacePath

  const readTool: PiAgentHarnessTool = {
    name: 'Read',
    label: 'Read',
    description: 'Read a file from the workspace. Supports file_path or path and optional offset/limit.',
    parameters: Type.Object({
      file_path: Type.Optional(Type.String()),
      path: Type.Optional(Type.String()),
      offset: Type.Optional(Type.Number()),
      limit: Type.Optional(Type.Number())
    }),
    async execute(_toolCallId: string, rawParams: unknown) {
      const params = rawParams as Record<string, unknown>
      const rawPath = String(params.file_path || params.path || '').trim()
      if (!rawPath) throw new Error('Read requires file_path or path')
      const resolvedPath = resolveToolPath(rawPath, cwd)
      const content = await fsp.readFile(resolvedPath, 'utf8')
      const lines = content.split('\n')
      const offset = Math.max(0, Number(params.offset ?? 1) - 1)
      const limit = typeof params.limit === 'number' ? Math.max(1, Number(params.limit)) : undefined
      const selected = limit ? lines.slice(offset, offset + limit) : lines.slice(offset)
      return {
        content: [{ type: 'text', text: selected.join('\n') }],
        details: undefined
      }
    }
  } as any

  const writeTool: PiAgentHarnessTool = {
    name: 'Write',
    label: 'Write',
    description: 'Write content to a file. Creates parent directories automatically.',
    parameters: Type.Object({
      file_path: Type.Optional(Type.String()),
      path: Type.Optional(Type.String()),
      content: Type.String()
    }),
    async execute(_toolCallId: string, rawParams: unknown) {
      const params = rawParams as Record<string, unknown>
      const rawPath = String(params.file_path || params.path || '').trim()
      if (!rawPath) throw new Error('Write requires file_path or path')
      const resolvedPath = resolveToolPath(rawPath, cwd)
      await fsp.mkdir(path.dirname(resolvedPath), { recursive: true })
      await fsp.writeFile(resolvedPath, String(params.content ?? ''), 'utf8')
      return {
        content: [{ type: 'text', text: `Successfully wrote ${resolvedPath}` }],
        details: undefined
      }
    }
  } as any

  const editSchema = Type.Object({
    file_path: Type.Optional(Type.String()),
    path: Type.Optional(Type.String()),
    old_string: Type.Optional(Type.String()),
    new_string: Type.Optional(Type.String()),
    replace_all: Type.Optional(Type.Boolean()),
    edits: Type.Optional(
      Type.Array(
        Type.Object({
          old_string: Type.Optional(Type.String()),
          new_string: Type.Optional(Type.String()),
          oldText: Type.Optional(Type.String()),
          newText: Type.Optional(Type.String())
        })
      )
    )
  })

  const editTool: PiAgentHarnessTool = {
    name: 'Edit',
    label: 'Edit',
    description: 'Edit a file using exact string replacement.',
    parameters: editSchema,
    async execute(_toolCallId: string, rawParams: unknown) {
      const params = rawParams as Record<string, unknown>
      const rawPath = String(params.file_path || params.path || '').trim()
      if (!rawPath) throw new Error('Edit requires file_path or path')
      const resolvedPath = resolveToolPath(rawPath, cwd)
      let content = await fsp.readFile(resolvedPath, 'utf8')

      const edits = Array.isArray(params.edits)
        ? params.edits.map((entry) => {
            const record = (entry ?? {}) as Record<string, unknown>
            return {
              oldText: String(record.old_string ?? record.oldText ?? ''),
              newText: String(record.new_string ?? record.newText ?? '')
            }
          })
        : [
            {
              oldText: String(params.old_string ?? ''),
              newText: String(params.new_string ?? '')
            }
          ]

      const replaceAll = Boolean(params.replace_all)

      for (const edit of edits) {
        if (!edit.oldText) throw new Error('Edit requires old_string/oldText')
        const occurrenceCount = countOccurrences(content, edit.oldText)
        if (!replaceAll && occurrenceCount !== 1) {
          throw new Error(`Edit expected exactly one match for target text, received ${occurrenceCount}`)
        }
        content = replaceAll ? content.split(edit.oldText).join(edit.newText) : content.replace(edit.oldText, edit.newText)
      }

      await fsp.writeFile(resolvedPath, content, 'utf8')
      return {
        content: [{ type: 'text', text: `Successfully edited ${resolvedPath}` }],
        details: undefined
      }
    }
  } as any

  const multiEditTool: PiAgentHarnessTool = {
    ...editTool,
    name: 'MultiEdit',
    label: 'MultiEdit',
    description: 'Apply multiple exact string replacements to a file.'
  } as any

  const bashTool: PiAgentHarnessTool = {
    name: 'Bash',
    label: 'Bash',
    description: 'Execute a shell command in the current workspace and return stdout/stderr.',
    parameters: Type.Object({
      command: Type.String(),
      timeout: Type.Optional(Type.Number())
    }),
    async execute(
      toolCallId: string,
      rawParams: unknown,
      signal?: AbortSignal,
      onUpdate?: (value: { content: Array<PiTextContent | PiImageContent>; details: unknown }) => void
    ) {
      const params = rawParams as Record<string, unknown>
      logger.info('[AgentCore] builtin tool execute start', {
        traceId: invokeContext.runtime.traceId,
        topicId: invokeContext.projection.topicId,
        piSessionId: invokeContext.projection.piSessionId,
        toolName: 'Bash',
        toolCallId,
        command: String(params.command ?? ''),
        timeout: typeof params.timeout === 'number' ? params.timeout : undefined
      })
      const result = await executeShellCommand({
        command: String(params.command ?? ''),
        cwd,
        env: runtimeEnvironment.env,
        timeoutSeconds: typeof params.timeout === 'number' ? params.timeout : undefined,
        signal,
        onUpdate: (text) => {
          logger.info('[AgentCore] builtin tool execute update', {
            traceId: invokeContext.runtime.traceId,
            topicId: invokeContext.projection.topicId,
            piSessionId: invokeContext.projection.piSessionId,
            toolName: 'Bash',
            toolCallId,
            outputChars: String(text || '').length
          })
          onUpdate?.({
            content: [{ type: 'text', text: text || '(no output yet)' }],
            details: undefined
          })
        }
      })
      const output = [result.stdout, result.stderr].filter(Boolean).join(result.stdout && result.stderr ? '\n' : '')
      if (result.exitCode && result.exitCode !== 0) {
        logger.warn('[AgentCore] builtin tool execute failed', {
          traceId: invokeContext.runtime.traceId,
          topicId: invokeContext.projection.topicId,
          piSessionId: invokeContext.projection.piSessionId,
          toolName: 'Bash',
          toolCallId,
          exitCode: result.exitCode,
          outputPreview: output.slice(0, 500)
        })
        throw new Error(output || `Command exited with code ${result.exitCode}`)
      }
      logger.info('[AgentCore] builtin tool execute success', {
        traceId: invokeContext.runtime.traceId,
        topicId: invokeContext.projection.topicId,
        piSessionId: invokeContext.projection.piSessionId,
        toolName: 'Bash',
        toolCallId,
        exitCode: result.exitCode,
        stdoutChars: result.stdout.length,
        stderrChars: result.stderr.length
      })
      return {
        content: [{ type: 'text', text: output || '(no output)' }],
        details: undefined
      }
    }
  } as any

  const globTool: PiAgentHarnessTool = {
    name: 'Glob',
    label: 'Glob',
    description: 'Find files matching a glob pattern using ripgrep file discovery.',
    parameters: Type.Object({
      pattern: Type.String(),
      path: Type.Optional(Type.String())
    }),
    async execute(_toolCallId: string, rawParams: unknown) {
      const params = rawParams as Record<string, unknown>
      const result = await executeShellCommand({
        command: `rg --files -g ${JSON.stringify(String(params.pattern ?? ''))} ${JSON.stringify(String(params.path || '.'))}`,
        cwd,
        env: runtimeEnvironment.env
      })
      if (result.exitCode && result.exitCode !== 0 && result.exitCode !== 1) {
        throw new Error(result.stderr || `Glob failed with exit code ${result.exitCode}`)
      }
      return {
        content: [{ type: 'text', text: result.stdout.trim() || '(no matches)' }],
        details: undefined
      }
    }
  } as any

  const grepTool: PiAgentHarnessTool = {
    name: 'Grep',
    label: 'Grep',
    description: 'Search file contents with ripgrep and return matching lines with line numbers.',
    parameters: Type.Object({
      pattern: Type.String(),
      path: Type.Optional(Type.String())
    }),
    async execute(_toolCallId: string, rawParams: unknown) {
      const params = rawParams as Record<string, unknown>
      const result = await executeShellCommand({
        command: `rg -n ${JSON.stringify(String(params.pattern ?? ''))} ${JSON.stringify(String(params.path || '.'))}`,
        cwd,
        env: runtimeEnvironment.env
      })
      if (result.exitCode && result.exitCode !== 0 && result.exitCode !== 1) {
        throw new Error(result.stderr || `Grep failed with exit code ${result.exitCode}`)
      }
      return {
        content: [{ type: 'text', text: result.stdout.trim() || '(no matches)' }],
        details: undefined
      }
    }
  } as any

  const inspectImageTool: PiAgentHarnessTool = {
    name: 'InspectImage',
    label: 'InspectImage',
    description:
      'Inspect an image from a local file path or URL with the current model multimodal capability. 支持查看本地图片或图片链接，并返回图片理解结果。',
    parameters: Type.Object({
      file_path: Type.Optional(Type.String()),
      path: Type.Optional(Type.String()),
      url: Type.Optional(Type.String()),
      question: Type.Optional(Type.String()),
      prompt: Type.Optional(Type.String())
    }),
    async execute(_toolCallId: string, rawParams: unknown, signal?: AbortSignal) {
      const params = (rawParams ?? {}) as Record<string, unknown>
      return await executeInspectImage({
        params,
        invokeContext,
        runtimeEnvironment,
        cwd,
        signal
      })
    }
  } as any

  const todoWriteTool: PiAgentHarnessTool = {
    name: 'TodoWrite',
    label: 'TodoWrite',
    description: 'Record a task checklist for progress tracking.',
    parameters: Type.Any(),
    async execute(_toolCallId: string, rawParams: unknown) {
      const params = rawParams as Record<string, unknown>
      return {
        content: [{ type: 'text', text: summarizeValue(params) || 'Updated todo list.' }],
        details: params
      }
    }
  } as any

  const taskTool: PiAgentHarnessTool = {
    name: 'Task',
    label: 'Task',
    description: 'Record a delegated subtask request. Full sub-agent dispatch is not yet wired in the pi bridge.',
    parameters: Type.Any(),
    async execute(_toolCallId: string, rawParams: unknown) {
      const params = rawParams as Record<string, unknown>
      return {
        content: [{ type: 'text', text: `Recorded task request:\n${summarizeValue(params)}` }],
        details: params
      }
    }
  } as any

  const notebookReadTool: PiAgentHarnessTool = {
    ...readTool,
    name: 'NotebookRead',
    label: 'NotebookRead',
    description: 'Read notebook content from a file path.'
  } as any

  const notebookEditTool: PiAgentHarnessTool = {
    ...editTool,
    name: 'NotebookEdit',
    label: 'NotebookEdit',
    description: 'Edit notebook content in a file path.'
  } as any

  const toolsByName = new Map<string, PiAgentHarnessTool>([
    ['Read', readTool],
    ['Write', writeTool],
    ['Edit', editTool],
    ['MultiEdit', multiEditTool],
    ['Bash', bashTool],
    ['Glob', globTool],
    ['Grep', grepTool],
    ['InspectImage', inspectImageTool],
    ['TodoWrite', todoWriteTool],
    ['Task', taskTool],
    ['NotebookRead', notebookReadTool],
    ['NotebookEdit', notebookEditTool]
  ])

  return invokeContext.tools.activeToolNames
    .map((toolName) => toolsByName.get(toolName))
    .filter((tool): tool is PiAgentHarnessTool => Boolean(tool))
}

async function createMcpClientBridge(serverKey: string, config: NonNullable<Options['mcpServers']>[string]): Promise<PiMcpClientBridge | null> {
  const client = new Client({ name: 'CapCutHelper', version: 'pi-bridge' }, { capabilities: {} })

  if (config.type === 'http') {
    const transport = new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: {
        headers: config.headers ?? {}
      }
    })
    await client.connect(transport)
    return {
      serverKey,
      client,
      async close() {
        await transport.close()
      }
    }
  }

  if (config.type === 'sdk') {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const serverInstance = (config as { instance?: { connect?: (transport: unknown) => Promise<void> } }).instance
    if (!serverInstance || typeof serverInstance.connect !== 'function') return null
    await serverInstance.connect(serverTransport)
    await client.connect(clientTransport)
    return {
      serverKey,
      client,
      async close() {
        await clientTransport.close()
        await serverTransport.close()
      }
    }
  }

  return null
}

async function buildMcpTools(input: {
  packageBridge: PiPackageBridge
  invokeContext: ClaudeCodeInvokeContext
  options: Options
}): Promise<{ tools: PiAgentHarnessTool[]; clients: PiMcpClientBridge[] }> {
  const { packageBridge, invokeContext, options } = input
  const tools: PiAgentHarnessTool[] = []
  const clients: PiMcpClientBridge[] = []

  for (const [serverKey, config] of Object.entries(options.mcpServers ?? {})) {
    const bridge = await createMcpClientBridge(serverKey, config)
    if (!bridge) continue
    clients.push(bridge)

    let listedTools: McpTool[] = []
    try {
      const response = await bridge.client.listTools()
      listedTools = response.tools ?? []
    } catch (error) {
      logger.warn('[AgentCore] failed to list tools for bridged MCP server', {
        serverKey,
        error: error instanceof Error ? error.message : String(error)
      })
      continue
    }

    for (const tool of listedTools) {
      const namespacedName = `mcp__${serverKey}__${tool.name}`
      if (!matchAllowedTool(invokeContext.tools.allowedTools, namespacedName)) continue

      const mcpTool: PiAgentHarnessTool = {
        name: namespacedName,
        label: namespacedName,
        description: tool.description ? `[${serverKey}] ${tool.description}` : `[${serverKey}] ${tool.name}`,
        parameters: (tool.inputSchema as any) ?? packageBridge.piAi.Type.Any(),
        async execute(
          toolCallId: string,
          rawParams: unknown,
          signal?: AbortSignal,
          onUpdate?: (value: { content: Array<PiTextContent | PiImageContent>; details: unknown }) => void
        ) {
          const params = (rawParams ?? {}) as Record<string, unknown>
          logger.info('[AgentCore] mcp tool execute start', {
            traceId: invokeContext.runtime.traceId,
            topicId: invokeContext.projection.topicId,
            piSessionId: invokeContext.projection.piSessionId,
            toolName: namespacedName,
            toolCallId,
            serverKey,
            paramKeys: Object.keys(params)
          })
          const result = await bridge.client.callTool(
            { name: tool.name, arguments: params },
            undefined,
            {
              signal,
              onprogress(progress) {
                logger.info('[AgentCore] mcp tool execute update', {
                  traceId: invokeContext.runtime.traceId,
                  topicId: invokeContext.projection.topicId,
                  piSessionId: invokeContext.projection.piSessionId,
                  toolName: namespacedName,
                  toolCallId,
                  serverKey,
                  messageChars: typeof progress.message === 'string' ? progress.message.length : 0
                })
                if (typeof progress.message === 'string' && progress.message.trim()) {
                  onUpdate?.({
                    content: [{ type: 'text', text: progress.message }],
                    details: progress
                  })
                }
              }
            }
          )

          if ((result as { isError?: boolean }).isError) {
            logger.warn('[AgentCore] mcp tool execute failed', {
              traceId: invokeContext.runtime.traceId,
              topicId: invokeContext.projection.topicId,
              piSessionId: invokeContext.projection.piSessionId,
              toolName: namespacedName,
              toolCallId,
              serverKey,
              outputPreview: extractToolText((result as { content?: unknown }).content).slice(0, 500)
            })
            throw new Error(extractToolText((result as { content?: unknown }).content))
          }

          logger.info('[AgentCore] mcp tool execute success', {
            traceId: invokeContext.runtime.traceId,
            topicId: invokeContext.projection.topicId,
            piSessionId: invokeContext.projection.piSessionId,
            toolName: namespacedName,
            toolCallId,
            serverKey,
            contentPreview: extractToolText((result as { content?: unknown }).content).slice(0, 500)
          })
          return {
            content: toPiContentArray((result as { content?: unknown }).content),
            details: (result as { structuredContent?: unknown }).structuredContent ?? result
          }
        }
      } as any
      tools.push(mcpTool)
    }
  }

  return { tools, clients }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function ensureOpenAiApiVersionBaseUrl(value: string): string {
  const normalized = trimTrailingSlash(String(value || '').trim())
  if (!normalized) return ''
  if (normalized.endsWith('/v1')) return normalized
  return `${normalized}/v1`
}

function describePiRequestTarget(input: {
  providerApiType: 'anthropic-messages' | 'openai-completions'
  baseUrl: string
}): { expectedPathSuffix: string; expectedRequestUrl: string } {
  const { providerApiType, baseUrl } = input
  const normalizedBaseUrl = trimTrailingSlash(String(baseUrl || '').trim())
  const expectedPathSuffix =
    providerApiType === 'anthropic-messages'
      ? '/v1/messages'
      : '/chat/completions'

  return {
    expectedPathSuffix,
    expectedRequestUrl: normalizedBaseUrl ? `${normalizedBaseUrl}${expectedPathSuffix}` : expectedPathSuffix
  }
}

function summarizeProviderHeaders(headers: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!headers) return {}
  const summary: Record<string, unknown> = {}
  for (const [key, rawValue] of Object.entries(headers)) {
    if (rawValue == null) continue
    const value = String(rawValue)
    const lowerKey = key.toLowerCase()
    if (lowerKey === 'authorization') {
      const scheme = value.split(/\s+/, 1)[0] || 'unknown'
      summary[key] = `${scheme} <redacted>`
      continue
    }
    summary[key] = value.length > 160 ? `${value.slice(0, 160)}...` : value
  }
  return summary
}

function summarizeProviderPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      type: Array.isArray(payload) ? 'array' : typeof payload,
      preview: summarizeValue(payload).slice(0, 240)
    }
  }

  const record = payload as Record<string, unknown>
  const messages = Array.isArray(record.messages) ? record.messages : []
  const input = Array.isArray(record.input) ? record.input : []
  const tools = Array.isArray(record.tools) ? record.tools : []

  return {
    keys: Object.keys(record),
    model: typeof record.model === 'string' ? record.model : undefined,
    stream: typeof record.stream === 'boolean' ? record.stream : undefined,
    messageCount: messages.length,
    inputCount: input.length,
    toolCount: tools.length,
    toolChoice:
      typeof record.tool_choice === 'string'
        ? record.tool_choice
        : record.tool_choice && typeof record.tool_choice === 'object'
          ? summarizeValue(record.tool_choice)
          : undefined,
    hasSystem: record.system !== undefined,
    hasInstructions: record.instructions !== undefined,
    enableThinking: typeof record.enable_thinking === 'boolean' ? record.enable_thinking : undefined,
    thinking:
      record.thinking && typeof record.thinking === 'object'
        ? summarizeValue(record.thinking)
        : undefined,
    reasoning: record.reasoning && typeof record.reasoning === 'object' ? Object.keys(record.reasoning as Record<string, unknown>) : undefined
  }
}

function normalizeProviderPayload(input: {
  payload: unknown
  providerApiType: 'anthropic-messages' | 'openai-completions'
  invokeContext: ClaudeCodeInvokeContext
}): void {
  const { payload } = input
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return

  const record = payload as Record<string, unknown>
  delete record.enable_thinking
  delete record.thinking
  delete record.reasoning
  delete record.reasoning_effort
  delete record.chat_template_kwargs

  const tools = Array.isArray(record.tools) ? record.tools : []
  if (tools.length === 0) return
  if (record.tool_choice !== undefined) return

  record.tool_choice = 'auto'
}

function wrapPiApiModuleWithLogging(input: {
  apiModule: PiApiModule
  invokeContext: ClaudeCodeInvokeContext
  providerApiType: 'anthropic-messages' | 'openai-completions'
}): PiApiModule {
  const { apiModule, invokeContext, providerApiType } = input

  return {
    stream(model: unknown, context: unknown, options: unknown) {
      const typedModel = (model ?? {}) as Record<string, unknown>
      const typedOptions = ((options && typeof options === 'object' ? options : {}) as Record<string, unknown>)
      logger.info('[AgentCore] pi provider wrapper invoked', {
        traceId: invokeContext.runtime.traceId,
        topicId: invokeContext.projection.topicId,
        piSessionId: invokeContext.projection.piSessionId,
        providerApiType,
        method: 'stream',
        modelId: String(typedModel.id || ''),
        baseUrl: String(typedModel.baseUrl || ''),
        hasHeaders: Boolean(typedOptions.headers),
        hasApiKey: Boolean(typedOptions.apiKey)
      })
      const requestOptions = {
        ...typedOptions,
        onPayload: async (payload: unknown, payloadModel: unknown) => {
          normalizeProviderPayload({
            payload,
            providerApiType,
            invokeContext
          })
          logger.info('[AgentCore] pi provider request payload', {
            traceId: invokeContext.runtime.traceId,
            topicId: invokeContext.projection.topicId,
            piSessionId: invokeContext.projection.piSessionId,
            providerApiType,
            modelId: String((payloadModel as Record<string, unknown> | undefined)?.id || typedModel.id || ''),
            baseUrl: String((payloadModel as Record<string, unknown> | undefined)?.baseUrl || typedModel.baseUrl || ''),
            headers: summarizeProviderHeaders((typedOptions.headers as Record<string, unknown> | undefined) || undefined),
            hasApiKey: Boolean(typedOptions.apiKey),
            timeoutMs: typedOptions.timeoutMs,
            payload: summarizeProviderPayload(payload)
          })
          const originalOnPayload = typeof typedOptions.onPayload === "function" ? typedOptions.onPayload : undefined
          return originalOnPayload ? await originalOnPayload(payload, payloadModel as any) : undefined
        },
        onResponse: async (response: unknown, responseModel: unknown) => {
          const providerResponse = (response ?? {}) as Record<string, unknown>
          logger.info('[AgentCore] pi provider response', {
            traceId: invokeContext.runtime.traceId,
            topicId: invokeContext.projection.topicId,
            piSessionId: invokeContext.projection.piSessionId,
            providerApiType,
            modelId: String((responseModel as Record<string, unknown> | undefined)?.id || typedModel.id || ''),
            baseUrl: String((responseModel as Record<string, unknown> | undefined)?.baseUrl || typedModel.baseUrl || ''),
            status: providerResponse.status,
            headers: summarizeProviderHeaders((providerResponse.headers as Record<string, unknown> | undefined) || undefined)
          })
          const originalOnResponse = typeof typedOptions.onResponse === "function" ? typedOptions.onResponse : undefined
          if (originalOnResponse) {
            await originalOnResponse(response as any, responseModel as any)
          }
        }
      }

      return (apiModule.stream as any)(model, context, requestOptions)
    },
    streamSimple(model: unknown, context: unknown, options: unknown) {
      const typedModel = (model ?? {}) as Record<string, unknown>
      const typedOptions = ((options && typeof options === 'object' ? options : {}) as Record<string, unknown>)
      logger.info('[AgentCore] pi provider wrapper invoked', {
        traceId: invokeContext.runtime.traceId,
        topicId: invokeContext.projection.topicId,
        piSessionId: invokeContext.projection.piSessionId,
        providerApiType,
        method: 'streamSimple',
        modelId: String(typedModel.id || ''),
        baseUrl: String(typedModel.baseUrl || ''),
        hasHeaders: Boolean(typedOptions.headers),
        hasApiKey: Boolean(typedOptions.apiKey)
      })
      const requestOptions = {
        ...typedOptions,
        onPayload: async (payload: unknown, payloadModel: unknown) => {
          normalizeProviderPayload({
            payload,
            providerApiType,
            invokeContext
          })
          logger.info('[AgentCore] pi provider request payload', {
            traceId: invokeContext.runtime.traceId,
            topicId: invokeContext.projection.topicId,
            piSessionId: invokeContext.projection.piSessionId,
            providerApiType,
            method: 'streamSimple',
            modelId: String((payloadModel as Record<string, unknown> | undefined)?.id || typedModel.id || ''),
            baseUrl: String((payloadModel as Record<string, unknown> | undefined)?.baseUrl || typedModel.baseUrl || ''),
            headers: summarizeProviderHeaders((typedOptions.headers as Record<string, unknown> | undefined) || undefined),
            hasApiKey: Boolean(typedOptions.apiKey),
            timeoutMs: typedOptions.timeoutMs,
            payload: summarizeProviderPayload(payload)
          })
          const originalOnPayload = typeof typedOptions.onPayload === 'function' ? typedOptions.onPayload : undefined
          return originalOnPayload ? await originalOnPayload(payload, payloadModel as any) : undefined
        },
        onResponse: async (response: unknown, responseModel: unknown) => {
          const providerResponse = (response ?? {}) as Record<string, unknown>
          logger.info('[AgentCore] pi provider response', {
            traceId: invokeContext.runtime.traceId,
            topicId: invokeContext.projection.topicId,
            piSessionId: invokeContext.projection.piSessionId,
            providerApiType,
            method: 'streamSimple',
            modelId: String((responseModel as Record<string, unknown> | undefined)?.id || typedModel.id || ''),
            baseUrl: String((responseModel as Record<string, unknown> | undefined)?.baseUrl || typedModel.baseUrl || ''),
            status: providerResponse.status,
            headers: summarizeProviderHeaders((providerResponse.headers as Record<string, unknown> | undefined) || undefined)
          })
          const originalOnResponse = typeof typedOptions.onResponse === 'function' ? typedOptions.onResponse : undefined
          if (originalOnResponse) {
            await originalOnResponse(response as any, responseModel as any)
          }
        }
      }

      return (apiModule.streamSimple as any)(model, context, requestOptions)
    }
  }
}

async function buildPiRuntimeBridge(input: {
  packageBridge: PiPackageBridge
  invokeContext: ClaudeCodeInvokeContext
  runtimeEnvironment: ClaudeRuntimeEnvironment
  options: Options
  canUseTool?: CanUseTool
  pendingFileChanges: Map<string, PendingFileChangeSnapshot[]>
}): Promise<PiRuntimeBridge> {
  const { packageBridge, invokeContext, runtimeEnvironment, options, canUseTool, pendingFileChanges } = input
  const providerApiType = mapProviderApiType(runtimeEnvironment)
  const providerId = `capcuthelper-claudecode-${providerApiType}`
  const modelId = invokeContext.runtime.model.id || 'claudecode-bootstrap-model'
  const providerApiHost = String(runtimeEnvironment.modelInfo.provider?.apiHost || '').trim()
  const providerAnthropicHost = String(runtimeEnvironment.modelInfo.provider?.anthropicApiHost || '').trim()
  const baseUrl =
    providerApiType === 'openai-completions'
      ? ensureOpenAiApiVersionBaseUrl(providerApiHost)
      : String(providerAnthropicHost || providerApiHost || '').trim()
  const runtimeGatewayToken =
    providerApiType === 'anthropic-messages'
      ? String(runtimeEnvironment.env.ANTHROPIC_API_KEY || runtimeEnvironment.env.ANTHROPIC_AUTH_TOKEN || '').trim()
      : String(runtimeEnvironment.modelInfo.provider?.apiKey || runtimeEnvironment.env.ANTHROPIC_API_KEY || runtimeEnvironment.env.ANTHROPIC_AUTH_TOKEN || '').trim()

  const rawApiModule =
    providerApiType === 'openai-completions'
      ? packageBridge.openAiCompletionsApi
      : packageBridge.anthropicMessagesApi
  const apiModule = wrapPiApiModuleWithLogging({
    apiModule: rawApiModule,
    invokeContext,
    providerApiType
  })
  const requestTarget = describePiRequestTarget({
    providerApiType,
    baseUrl
  })

  logger.info('[AgentCore] resolved pi provider request target', {
    traceId: invokeContext.runtime.traceId,
    topicId: invokeContext.projection.topicId,
    piSessionId: invokeContext.projection.piSessionId,
    modelId,
    providerType: String(runtimeEnvironment.modelInfo.provider?.type || '').trim(),
    providerApiType,
    providerApiHost,
    providerAnthropicHost,
    baseUrl,
    baseUrlSource:
      providerApiType === 'anthropic-messages'
        ? providerAnthropicHost
          ? 'provider_anthropic_api_host'
          : providerApiHost
            ? 'provider_api_host'
            : 'empty'
        : providerApiHost
          ? 'provider_api_host'
          : 'empty',
    hasRuntimeGatewayToken: Boolean(runtimeGatewayToken),
    expectedPathSuffix: requestTarget.expectedPathSuffix,
    expectedRequestUrl: requestTarget.expectedRequestUrl
  })

  const models = packageBridge.piAi.createModels()
  const provider = packageBridge.piAi.createProvider({
    id: providerId,
    name: 'CapCutHelper ClaudeCode',
    baseUrl,
    auth: {
      apiKey: {
        name: 'CapCutHelper runtime API key',
        async resolve() {
          if (!runtimeGatewayToken) return undefined
          return {
            auth: {
              headers: {
                Authorization: `Bearer ${runtimeGatewayToken}`
              }
            }
          }
        }
      }
    },
    models: [
      {
        id: modelId,
        name: `CapCutHelper ${modelId}`,
        api: providerApiType,
        provider: providerId,
        baseUrl,
        reasoning: false,
        input: ['text', 'image'],
        compat:
          providerApiType === 'openai-completions'
            ? {
                supportsDeveloperRole: false
              }
            : undefined,
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0
        },
        contextWindow: 200_000,
        maxTokens: 32_000
      }
    ],
    api: apiModule as any
  })
  models.setProvider(provider)

  const storage = new packageBridge.agentCore.InMemorySessionStorage({
    metadata: {
      id: invokeContext.projection.piSessionId,
      createdAt: new Date().toISOString()
    }
  })
  const session = new packageBridge.agentCore.Session(storage)

  const model = models.getModel(providerId, modelId) as PiModel | undefined
  if (!model) {
    throw new Error(`Failed to resolve pi model ${providerId}/${modelId}`)
  }

  const builtinTools = buildBuiltinTools({
    packageBridge,
    invokeContext,
    runtimeEnvironment
  })
  const mcpTools = await buildMcpTools({
    packageBridge,
    invokeContext,
    options
  })
  const tools = [...builtinTools, ...mcpTools.tools]
  const activeToolNames = tools.map((tool) => tool.name)

  const harness = new packageBridge.agentCore.AgentHarness({
    session,
    models,
    model,
    systemPrompt: invokeContext.prompt.systemPrompt,
    tools,
    activeToolNames,
    resources: {
      skills: invokeContext.prompt.resources.skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        content: skill.content,
        filePath: skill.filePath
      })),
      promptTemplates: invokeContext.prompt.resources.promptTemplates.map((template) => ({
        name: template.name,
        description: template.description,
        content: template.content
      }))
    }
  })

  harness.on('tool_call', async (context: any) => {
    logger.info('[AgentCore] harness tool_call received', {
      traceId: invokeContext.runtime.traceId,
      topicId: invokeContext.projection.topicId,
      piSessionId: invokeContext.projection.piSessionId,
      toolName: context.toolName,
      toolCallId: context.toolCallId,
      inputPreview: summarizeValue(context.input).slice(0, 500)
    })
    await capturePendingFileChangeSnapshots({
      toolName: context.toolName,
      toolInput: context.input,
      toolCallId: context.toolCallId,
      cwd: invokeContext.runtime.workspacePath,
      pendingFileChanges
    })

    if (!canUseTool) return undefined

    const decision = await canUseTool(context.toolName, context.input, {
      signal: new AbortController().signal,
      suggestions: [],
      toolUseID: context.toolCallId
    })

    logger.info('[AgentCore] harness tool_call decision', {
      traceId: invokeContext.runtime.traceId,
      topicId: invokeContext.projection.topicId,
      piSessionId: invokeContext.projection.piSessionId,
      toolName: context.toolName,
      toolCallId: context.toolCallId,
      behavior: decision.behavior,
      message: 'message' in decision ? decision.message : undefined
    })

    if (decision.behavior === 'deny') {
      return {
        block: true,
        reason: decision.message
      }
    }

    return undefined
  })

  persistSessionEntry(
    session.appendSessionName(`ClaudeCode ${invokeContext.runtime.sessionId}`),
    'session_name',
    invokeContext.runtime.traceId
  )
  persistSessionEntry(
    session.appendCustomEntry('claudecode_invoke_context', {
      runtime: invokeContext.runtime,
      skills: invokeContext.skills,
      tools: {
        activeToolNames: invokeContext.tools.activeToolNames,
        bridgedActiveToolNames: activeToolNames,
        allowedTools: invokeContext.tools.allowedTools,
        selectedCapabilities: invokeContext.tools.selectedCapabilities,
        toolLayer: invokeContext.tools.toolLayer,
        mountedMcpServers: invokeContext.tools.mountedMcpServers
      },
      projection: invokeContext.projection
    }),
    'claudecode_invoke_context',
    invokeContext.runtime.traceId
  )

  return {
    storage,
    session,
    models,
    provider,
    model,
    harness,
    tools,
    mcpClients: mcpTools.clients
  }
}

export async function createClaudeCodeHarness(input: {
  invokeContext: ClaudeCodeInvokeContext
  runtimeEnvironment: ClaudeRuntimeEnvironment
  options: Options
  canUseTool?: CanUseTool
  pendingFileChanges: Map<string, PendingFileChangeSnapshot[]>
}): Promise<ClaudeCodeHarnessAdapter> {
  const { invokeContext } = input
  const projectionEvents: ClaudeCodeHarnessProjectionEvent[] = []

  const createAdapter = (
    mode: ClaudeCodeHarnessAdapter['mode'],
    importStrategy: ClaudeCodeHarnessAdapter['importStrategy'],
    extras?: Pick<ClaudeCodeHarnessAdapter, 'packageBridge' | 'runtimeBridge' | 'packageStatus'>
  ): ClaudeCodeHarnessAdapter => ({
    enabled: mode !== 'disabled',
    mode,
    importStrategy,
    invokeContext,
    packageBridge: extras?.packageBridge,
    runtimeBridge: extras?.runtimeBridge,
    packageStatus: extras?.packageStatus,
    appendUserPrompt(text) {
      const normalizedText = String(text || '').trim()
      if (!normalizedText || !extras?.runtimeBridge) return

      persistSessionEntry(
        extras.runtimeBridge.session.appendMessage({
          role: 'user',
          content: normalizedText,
          timestamp: Date.now()
        }),
        'message:user',
        invokeContext.runtime.traceId
      )
    },
    appendAssistantResponse(entry) {
      const normalizedText = String(entry.text || '').trim()
      if (!normalizedText || !extras?.runtimeBridge) return

      persistSessionEntry(
        extras.runtimeBridge.session.appendMessage({
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: normalizedText
            }
          ],
          api: extras.runtimeBridge.model.api,
          provider: extras.runtimeBridge.model.provider,
          model: extras.runtimeBridge.model.id,
          usage: createEmptyUsage(),
          stopReason: entry.stopReason ?? 'stop',
          errorMessage: entry.errorMessage,
          timestamp: Date.now()
        }),
        'message:assistant',
        invokeContext.runtime.traceId
      )
    },
    recordProjectionEvent(event) {
      if (mode === 'disabled') return

      const persistedEvent = {
        ...event,
        timestamp: new Date().toISOString()
      }

      projectionEvents.push(persistedEvent)

      if (projectionEvents.length > MAX_RECORDED_PROJECTION_EVENTS) {
        projectionEvents.splice(0, projectionEvents.length - MAX_RECORDED_PROJECTION_EVENTS)
      }

      if (extras?.runtimeBridge) {
        persistSessionEntry(
          extras.runtimeBridge.session.appendCustomEntry('claudecode_projection_event', persistedEvent),
          'claudecode_projection_event',
          invokeContext.runtime.traceId
        )
      }
    },
    getProjectionEvents() {
      return [...projectionEvents]
    }
  })

  try {
    const packageBridge = await tryLoadPiPackageBridge()
    const runtimeBridge = await buildPiRuntimeBridge({
      packageBridge,
      invokeContext,
      runtimeEnvironment: input.runtimeEnvironment,
      options: input.options,
      canUseTool: input.canUseTool,
      pendingFileChanges: input.pendingFileChanges
    })
    const packageStatus = {
      agentCoreLoaded: true,
      piAiLoaded: true,
      runtimeBootstrapped: true,
      bootstrapProviderId: runtimeBridge.model.provider,
      bootstrapModelId: runtimeBridge.model.id,
      bridgedToolCount: runtimeBridge.tools.length,
      bridgedMcpServerCount: runtimeBridge.mcpClients.length,
      agentCoreExportsPreview: Object.keys(packageBridge.agentCore).slice(0, 12),
      piAiExportsPreview: Object.keys(packageBridge.piAi).slice(0, 12)
    }

    logger.info('[AgentCore] enabled pi harness adapter from npm packages', {
      traceId: invokeContext.runtime.traceId,
      topicId: invokeContext.projection.topicId,
      piSessionId: invokeContext.projection.piSessionId,
      importStrategy: 'npm-native-import',
      bootstrapProviderId: packageStatus.bootstrapProviderId,
      bootstrapModelId: packageStatus.bootstrapModelId,
      bridgedToolCount: packageStatus.bridgedToolCount,
      bridgedMcpServerCount: packageStatus.bridgedMcpServerCount,
      agentCoreExportsPreview: packageStatus.agentCoreExportsPreview,
      piAiExportsPreview: packageStatus.piAiExportsPreview
    })

    return createAdapter('pi-npm', 'npm-native-import', {
      packageBridge,
      runtimeBridge,
      packageStatus
    })
  } catch (error) {
    const loaderError = error instanceof Error ? error.message : String(error)
    logger.error('[AgentCore] failed to bootstrap mandatory pi harness', {
      traceId: invokeContext.runtime.traceId,
      topicId: invokeContext.projection.topicId,
      piSessionId: invokeContext.projection.piSessionId,
      importStrategy: 'npm-native-import',
      loaderError
    })
    throw new Error(`Failed to bootstrap pi harness: ${loaderError}`)
  }
}
