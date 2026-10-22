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

import { isWin } from '@main/constant'
import { loggerService } from '@logger'
import { findGitBash, validateGitBashPath } from '@main/utils/process'
import type { MCPProgressEvent } from '@shared/config/types'
import { IpcChannel } from '@shared/IpcChannel'
import { buildVectcutMcpToolName } from '@shared/mcp'
import { limitInlineToolPayload } from '@shared/sessionPayloadLimits'

import type { AgentStreamEvent } from '../../../interfaces/AgentStreamInterface'
import { windowService } from '@main/services/WindowService'
import type { ClaudeRuntimeEnvironment } from '../runtime/build-runtime'
import type { ClaudeCodeInvokeContext } from '../runtime/types'
import type { PendingFileChangeSnapshot } from '../tools/runtime-file-helpers'
import { searchCodemodeTools, type CodemodeSearchEntry } from './codemode-search'
import { resolveMcpProgressCallIds } from './mcp-progress-call-id-map'
import { buildToolOutputPreview } from './tool-output-preview'
import { preserveMcpResult } from './mcp-result-storage'
import { ImageInspectionState } from './image-inspection-state'
import { normalizeImageGenerationArguments } from './image-generation-action'
import { summarizeProviderPayload } from './provider-payload-summary'

const logger = loggerService.withContext('ClaudeCodeHarness')

const MAX_RECORDED_PROJECTION_EVENTS = 200
const WORKSPACE_UPLOAD_TOOL_NAME = buildVectcutMcpToolName('file-upload', 'upload_file_to_oss')
const IMAGE_UNDERSTAND_TOOL_NAME = buildVectcutMcpToolName('image-understand', 'inspect_image')
const WORKSPACE_UPLOAD_TIMEOUT_MS = 3 * 60 * 1000

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

export type PiNestedToolEvent =
  | {
      type: 'update'
      toolCallId: string
      toolName: string
    }
  | {
      type: 'start'
      toolCallId: string
      toolName: string
      input: Record<string, unknown>
    }
  | {
      type: 'success'
      toolCallId: string
      toolName: string
      input: Record<string, unknown>
      result: unknown
    }
  | {
      type: 'error'
      toolCallId: string
      toolName: string
      input: Record<string, unknown>
      error: unknown
    }

type PiAgentCoreModule = typeof import('@earendil-works/pi-agent-core')
type PiNodeModule = {
  NodeExecutionEnv: new (options: {
    cwd: string
    shellPath?: string
    shellEnv?: NodeJS.ProcessEnv
  }) => import('@earendil-works/pi-agent-core').ExecutionEnv
}
type PiAiModule = typeof import('@earendil-works/pi-ai')
type PiCodemodeModule = typeof import('@earendil-works/pi-codemode')
type PiCodemodeTool = import('@earendil-works/pi-codemode').CodemodeTool
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
  agentNode: PiNodeModule
  piAi: PiAiModule
  piCodemode: PiCodemodeModule
  anthropicMessagesApi: PiApiModule
  openAiCompletionsApi: PiApiModule
  openAiResponsesApi: PiApiModule
  azureOpenAiResponsesApi: PiApiModule
}

type PiMcpClientBridge = {
  serverKey: string
  client: Client
  timeoutMs?: number
  longRunning?: boolean
  close(): Promise<void>
}

function resolveRuntimeMcpNamespace(serverKey: string): string {
  if (serverKey === 'filesystem') {
    return 'filesystem-server'
  }
  return serverKey
}

type PiRuntimeBridge = {
  storage: PiInMemorySessionStorage
  session: PiSession
  models: PiMutableModels
  provider: PiProvider
  model: PiModel
  tokenLimits?: ClaudeRuntimeEnvironment['modelTokenLimits']
  harness: PiAgentHarness
  tools: PiAgentHarnessTool[]
  mcpClients: PiMcpClientBridge[]
  subscribeNestedToolEvents(listener: (event: PiNestedToolEvent) => void | Promise<void>): () => void
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
  const [agentCore, agentNode, piAi, piCodemode, anthropicMessagesApi, openAiCompletionsApi, openAiResponsesApi, azureOpenAiResponsesApi] = await Promise.all([
    nativeDynamicImport<PiAgentCoreModule>('@earendil-works/pi-agent-core'),
    nativeDynamicImport<PiNodeModule>('@earendil-works/pi-agent-core/node'),
    nativeDynamicImport<PiAiModule>('@earendil-works/pi-ai'),
    nativeDynamicImport<PiCodemodeModule>('@earendil-works/pi-codemode'),
    nativeDynamicImport<PiApiModule>('@earendil-works/pi-ai/api/anthropic-messages'),
    nativeDynamicImport<PiApiModule>('@earendil-works/pi-ai/api/openai-completions'),
    nativeDynamicImport<PiApiModule>('@earendil-works/pi-ai/api/openai-responses'),
    nativeDynamicImport<PiApiModule>('@earendil-works/pi-ai/api/azure-openai-responses')
  ])

  return {
    agentCore,
    agentNode,
    piAi,
    piCodemode,
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

function resolveWorkspaceUploadArguments(
  invokeContext: ClaudeCodeInvokeContext,
  rawParams: Record<string, unknown>
): Record<string, unknown> {
  const params = { ...rawParams }
  const filePath = typeof params.filePath === 'string' ? params.filePath.trim() : ''
  const base64Data = typeof params.base64Data === 'string' ? params.base64Data.trim() : ''
  const dataUrl = typeof params.dataUrl === 'string' ? params.dataUrl.trim() : ''
  if (filePath || base64Data || dataUrl) {
    return params
  }

  const attachedImages = Array.isArray(invokeContext.runtime.images) ? invokeContext.runtime.images : []
  if (attachedImages.length === 0) {
    return params
  }

  const requestedIndex = Number(params.attachmentIndex ?? params.imageIndex ?? params.image_index ?? (attachedImages.length === 1 ? 1 : 0))
  const normalizedIndex = Number.isFinite(requestedIndex) ? Math.max(1, Math.floor(requestedIndex)) : 0
  const image = normalizedIndex > 0 ? attachedImages[normalizedIndex - 1] : undefined
  if (!image?.data) {
    return params
  }

  params.base64Data = image.data
  params.contentType = typeof params.contentType === 'string' && params.contentType.trim() ? params.contentType : image.mediaType
  params.attachmentIndex = normalizedIndex
  return params
}

export function resolveShellExecutable(env: Record<string, string>): string {
  if (!isWin) {
    return process.env.SHELL || '/bin/bash'
  }

  const configuredGitBashPath = validateGitBashPath(env.CLAUDE_CODE_GIT_BASH_PATH)
  if (configuredGitBashPath) {
    return configuredGitBashPath
  }

  const discoveredGitBashPath = findGitBash()
  if (discoveredGitBashPath) {
    return discoveredGitBashPath
  }

  throw new Error(
    'Git Bash is required for shell execution on Windows, but no valid bash.exe was found. Ensure bundled PortableGit is packaged correctly or set CLAUDE_CODE_GIT_BASH_PATH.'
  )
}

export function buildPiBashTool(input: {
  agentCore: PiAgentCoreModule
  agentNode: PiNodeModule
  cwd: string
  env: Record<string, string>
}): PiAgentHarnessTool {
  const nativeTool = input.agentCore.createBashTool()
  return {
    ...nativeTool,
    name: 'Bash',
    label: 'Bash',
    async execute(toolCallId, params, signal, onUpdate) {
      // Resolve lazily so conversations without shell calls do not require Git Bash.
      const shellPath = resolveShellExecutable(input.env)
      const { NodeExecutionEnv } = input.agentNode
      const env = new NodeExecutionEnv({ cwd: input.cwd, shellPath, shellEnv: input.env })
      try {
        return await nativeTool.execute(
          toolCallId, params as import('@earendil-works/pi-agent-core').BashToolInput, signal, onUpdate, { env }
        )
      } finally {
        await env.cleanup()
      }
    }
  }
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

type PiToolPayload = {
  content: Array<PiTextContent | PiImageContent>
  details: unknown
}

function splitPiToolPayload(value: unknown): PiToolPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      content: toPiContentArray(value),
      details: undefined
    }
  }

  const record = value as Record<string, unknown>
  const contentSource = 'content' in record ? record.content : value

  if ('structuredContent' in record) {
    return {
      content: toPiContentArray(contentSource),
      details: record.structuredContent
    }
  }

  const { content: _content, ...rest } = record
  return {
    content: toPiContentArray(contentSource),
    details: Object.keys(rest).length > 0 ? rest : undefined
  }
}

export function buildLimitedPiToolPayload(value: unknown, label: string): PiToolPayload {
  return splitPiToolPayload(limitInlineToolPayload(value, { label }))
}

function resolveToolPath(filePath: string, cwd: string): string {
  return path.normalize(path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath))
}

const MAX_READ_IMAGE_AS_CONTENT_BYTES = 20 * 1024 * 1024

const IMAGE_MIME_BY_FORMAT: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif'
}

async function validateImageBuffer(buffer: Buffer): Promise<string> {
  if (buffer.length > MAX_READ_IMAGE_AS_CONTENT_BYTES) {
    throw new Error(`Image is too large to load as content (${buffer.length} bytes)`)
  }
  const { default: sharp } = await import('sharp')
  let metadata: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>
  try {
    metadata = await sharp(buffer).metadata()
  } catch {
    throw new Error(
      'ReadImageAsContent requires a valid image, not a video, audio file, or damaged image. For video, use the video-understanding tool or extract a real image frame first.'
    )
  }
  // HEIF containers must actually contain AV1 before being labeled as AVIF.
  const format = metadata.format === 'heif' && metadata.compression === 'av1' ? 'avif' : metadata.format
  const mimeType = format ? IMAGE_MIME_BY_FORMAT[format] : undefined
  if (!mimeType || !metadata.width || !metadata.height) {
    throw new Error(`ReadImageAsContent does not support this image format (${format || 'unknown'}).`)
  }
  return mimeType
}

export async function resolveReadImageAsContentInput(input: {
  source: string
  cwd: string
}): Promise<{ mimeType: string; base64: string; sourceLabel: string; byteLength: number }> {
  const source = String(input.source || '').trim()
  if (!source) {
    throw new Error('ReadImageAsContent requires file_path, path, url, or data_url')
  }

  const dataUrlMatch = source.match(/^data:([^;,]+);base64,([\s\S]*)$/i)
  if (dataUrlMatch) {
    const base64 = dataUrlMatch[2]
    if (!base64 || base64.length > Math.ceil(MAX_READ_IMAGE_AS_CONTENT_BYTES / 3) * 4) {
      throw new Error('Image data URL is empty or too large to load as content')
    }
    if (base64.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(base64)) {
      throw new Error('Image data URL contains invalid base64')
    }
    const buffer = Buffer.from(base64, 'base64')
    if (buffer.toString('base64') !== base64) {
      throw new Error('Image data URL contains invalid base64')
    }
    return {
      mimeType: await validateImageBuffer(buffer),
      base64: buffer.toString('base64'),
      sourceLabel: 'data-url',
      byteLength: buffer.length
    }
  }

  if (/^https?:\/\//i.test(source)) {
    const response = await net.fetch(source)
    if (!response.ok) {
      throw new Error(`Failed to download image: HTTP ${response.status}`)
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    return {
      mimeType: await validateImageBuffer(buffer),
      base64: buffer.toString('base64'),
      sourceLabel: source,
      byteLength: buffer.length
    }
  }

  const resolvedPath = resolveToolPath(source, input.cwd)
  const buffer = await fsp.readFile(resolvedPath)
  return {
    mimeType: await validateImageBuffer(buffer),
    base64: buffer.toString('base64'),
    sourceLabel: resolvedPath,
    byteLength: buffer.length
  }
}

async function executeReadImageAsContent(input: {
  params: Record<string, unknown>
  invokeContext: ClaudeCodeInvokeContext
  cwd: string
}): Promise<{ content: Array<PiTextContent | PiImageContent>; details: Record<string, unknown> }> {
  const { params, invokeContext, cwd } = input
  const source = String(params.file_path || params.path || params.url || params.data_url || '').trim()
  const image = await resolveReadImageAsContentInput({ source, cwd })

  logger.info('[AgentCore] ReadImageAsContent loaded image', {
    traceId: invokeContext.runtime.traceId,
    topicId: invokeContext.projection.topicId,
    piSessionId: invokeContext.projection.piSessionId,
    modelId: invokeContext.runtime.model.id,
    sourceLabel: image.sourceLabel,
    mimeType: image.mimeType,
    byteLength: image.byteLength
  })

  return {
    content: [
      {
        type: 'text',
        text: `Loaded image content from ${image.sourceLabel}. The next model turn can inspect this image directly.`
      },
      { type: 'image', data: image.base64, mimeType: image.mimeType }
    ],
    details: {
      source: image.sourceLabel,
      mimeType: image.mimeType,
      byteLength: image.byteLength
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
  interactiveUpdatedInputs: Map<string, Record<string, unknown>>
}): PiAgentHarnessTool[] {
  const { packageBridge, invokeContext, runtimeEnvironment, interactiveUpdatedInputs } = input
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
      const selectedText = selected.join('\n')
      return {
        ...buildToolOutputPreview({
          toolName: 'Read',
          sections: [
            {
              label: '文件内容',
              text: selectedText,
              startLine: offset + 1
            }
          ],
          emptyText: '(no content)',
          context: {
            filePath: resolvedPath,
            startLine: offset + 1,
            endLine: offset + selected.length,
            ...(typeof limit === 'number' ? { requestedLimit: limit } : {})
          }
        })
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

  const piBashTool = buildPiBashTool({
    agentCore: packageBridge.agentCore,
    agentNode: packageBridge.agentNode,
    cwd,
    env: runtimeEnvironment.env
  })
  const bashTool: PiAgentHarnessTool = {
    ...piBashTool,
    name: 'Bash',
    label: 'Bash',
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
      let result: Awaited<ReturnType<PiAgentHarnessTool['execute']>>
      try {
        result = await piBashTool.execute(toolCallId, params, signal, onUpdate, undefined)
      } catch (error) {
        logger.warn('[AgentCore] builtin tool execute failed', {
          traceId: invokeContext.runtime.traceId,
          topicId: invokeContext.projection.topicId,
          piSessionId: invokeContext.projection.piSessionId,
          toolName: 'Bash',
          toolCallId,
          error: error instanceof Error ? error.message.slice(0, 500) : String(error)
        })
        throw error
      }
      logger.info('[AgentCore] builtin tool execute success', {
        traceId: invokeContext.runtime.traceId,
        topicId: invokeContext.projection.topicId,
        piSessionId: invokeContext.projection.piSessionId,
        toolName: 'Bash',
        toolCallId,
        outputChars: extractToolText(result.content).length,
        details: result.details
      })
      return result
    }
  } as any

  const readImageAsContentTool: PiAgentHarnessTool = {
    name: 'ReadImageAsContent',
    label: 'ReadImageAsContent',
    description:
      'Load a valid local image file, remote image URL, or base64 data URL into the conversation. Images only: never pass video or audio files. For video, use video understanding or extract a real image frame first. This tool attaches the original image without analyzing or converting it.',
    parameters: Type.Object({
      file_path: Type.Optional(Type.String()),
      path: Type.Optional(Type.String()),
      url: Type.Optional(Type.String()),
      data_url: Type.Optional(Type.String())
    }),
    async execute(_toolCallId: string, rawParams: unknown) {
      const params = (rawParams ?? {}) as Record<string, unknown>
      return await executeReadImageAsContent({
        params,
        invokeContext,
        cwd
      })
    }
  } as any

  const askUserQuestionTool: PiAgentHarnessTool = {
    name: 'AskUserQuestion',
    label: 'AskUserQuestion',
    description: 'Ask the user a multiple-choice question card and wait for their selection.',
    parameters: Type.Object({
      questions: Type.Array(
        Type.Object({
          question: Type.String(),
          header: Type.String(),
          options: Type.Array(
            Type.Object({
              label: Type.String(),
              description: Type.Optional(Type.String())
            })
          ),
          multiSelect: Type.Boolean()
        })
      ),
      answers: Type.Optional(Type.Any())
    }),
    async execute(_toolCallId: string, rawParams: unknown) {
      const params =
        interactiveUpdatedInputs.get(_toolCallId) ??
        ((rawParams ?? {}) as Record<string, unknown>)
      interactiveUpdatedInputs.delete(_toolCallId)
      const answers =
        params.answers && typeof params.answers === 'object' && !Array.isArray(params.answers)
          ? (params.answers as Record<string, unknown>)
          : {}

      return {
        content: [
          {
            type: 'text',
            text:
              Object.keys(answers).length > 0
                ? summarizeValue({ questions: params.questions, answers })
                : 'User question card displayed.'
          }
        ],
        details: {
          questions: params.questions,
          answers
        }
      }
    }
  } as any

  const todoWriteTool: PiAgentHarnessTool = {
    name: 'TodoWrite',
    label: 'TodoWrite',
    description: 'Record a task checklist for progress tracking.',
    parameters: Type.Object({}, { additionalProperties: true }),
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
    parameters: Type.Object({}, { additionalProperties: true }),
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
    ['ReadImageAsContent', readImageAsContentTool],
    ['AskUserQuestion', askUserQuestionTool],
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
  const timeoutSeconds =
    typeof (config as { timeout?: unknown }).timeout === 'number' ? Number((config as { timeout?: number }).timeout) : undefined
  const timeoutMs = timeoutSeconds && timeoutSeconds > 0 ? timeoutSeconds * 1000 : undefined
  const longRunning = (config as { longRunning?: unknown }).longRunning === true

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
      timeoutMs,
      longRunning,
      async close() {
        await Promise.allSettled([client.close(), transport.close()])
      }
    }
  }

  if (config.type === 'sdk') {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const serverInstance = (config as {
      instance?: { connect?: (transport: unknown) => Promise<void>; close?: () => Promise<void> }
    }).instance
    if (!serverInstance || typeof serverInstance.connect !== 'function') return null
    await serverInstance.connect(serverTransport)
    await client.connect(clientTransport)
    return {
      serverKey,
      client,
      timeoutMs,
      longRunning,
      async close() {
        await Promise.allSettled([
          client.close(),
          clientTransport.close(),
          serverTransport.close(),
          typeof serverInstance.close === 'function' ? serverInstance.close() : Promise.resolve()
        ])
      }
    }
  }

  return null
}

export async function buildMcpTools(input: {
  packageBridge: PiPackageBridge
  invokeContext: ClaudeCodeInvokeContext
  options: Options
}): Promise<{ tools: PiAgentHarnessTool[]; clients: PiMcpClientBridge[] }> {
  const { packageBridge, invokeContext, options } = input
  const tools: PiAgentHarnessTool[] = []
  const clients: PiMcpClientBridge[] = []
  const imageInspectionState = new ImageInspectionState(invokeContext.runtime.workspacePath)

  for (const [serverKey, config] of Object.entries(options.mcpServers ?? {})) {
    const bridge = await createMcpClientBridge(serverKey, config)
    if (!bridge) continue
    clients.push(bridge)
    const runtimeNamespace = resolveRuntimeMcpNamespace(serverKey)

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
      const namespacedName = buildVectcutMcpToolName(runtimeNamespace, tool.name)
      if (namespacedName === IMAGE_UNDERSTAND_TOOL_NAME && invokeContext.runtime.model.supportsImageInput) {
        logger.info('[AgentCore] skipped image-understand MCP tool for multimodal model', {
          traceId: invokeContext.runtime.traceId,
          topicId: invokeContext.projection.topicId,
          piSessionId: invokeContext.projection.piSessionId,
          modelId: invokeContext.runtime.model.id,
          serverKey,
          toolName: namespacedName
        })
        continue
      }

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
          const originalParams = (rawParams ?? {}) as Record<string, unknown>
          const params =
            namespacedName === WORKSPACE_UPLOAD_TOOL_NAME
              ? resolveWorkspaceUploadArguments(invokeContext, originalParams)
              : normalizeImageGenerationArguments(namespacedName, originalParams)
          const requestTimeoutMs =
            namespacedName === WORKSPACE_UPLOAD_TOOL_NAME ? WORKSPACE_UPLOAD_TIMEOUT_MS : bridge.timeoutMs
          logger.info('[AgentCore] mcp tool execute start', {
            traceId: invokeContext.runtime.traceId,
            topicId: invokeContext.projection.topicId,
            piSessionId: invokeContext.projection.piSessionId,
            toolName: namespacedName,
            toolCallId,
            serverKey,
            paramKeys: Object.keys(params),
            requestTimeoutMs
          })
          let result
          try {
            result = await bridge.client.callTool(
              { name: tool.name, arguments: params },
              undefined,
              {
                signal,
                timeout: requestTimeoutMs,
                resetTimeoutOnProgress: bridge.longRunning,
                maxTotalTimeout: bridge.longRunning ? requestTimeoutMs : undefined,
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
                  const total = Number((progress as { total?: unknown }).total || 1)
                  const current = Number((progress as { progress?: unknown }).progress || 0)
                  const normalizedProgress = total > 0 ? current / total : 0
                  const progressTargets = resolveMcpProgressCallIds(toolCallId)
                  const mainWindow = windowService.getMainWindow()
                  if (mainWindow && progressTargets.length > 0) {
                    for (const progressCallId of progressTargets) {
                      mainWindow.webContents.send(IpcChannel.Mcp_Progress, {
                        callId: progressCallId,
                        progress: normalizedProgress,
                        message: typeof progress.message === 'string' ? progress.message : undefined
                      } satisfies MCPProgressEvent)
                    }
                  }
                  if (typeof progress.message === 'string' && progress.message.trim()) {
                    const progressPayload = buildLimitedPiToolPayload(
                      {
                        content: [{ type: 'text', text: progress.message }],
                        structuredContent: progress
                      },
                      `${namespacedName} 进度`
                    )
                    onUpdate?.({
                      content: progressPayload.content,
                      details: progressPayload.details
                    })
                  }
                }
              }
            )

            if ((result as { isError?: boolean }).isError) {
              const failedOutput = extractToolText((result as { content?: unknown }).content)
              logger.warn('[AgentCore] mcp tool execute failed', {
                traceId: invokeContext.runtime.traceId,
                topicId: invokeContext.projection.topicId,
                piSessionId: invokeContext.projection.piSessionId,
                toolName: namespacedName,
                toolCallId,
                serverKey,
                outputPreview: failedOutput.slice(0, 500)
              })
              throw new Error(failedOutput)
            }
          } catch (error) {
            if (signal?.aborted) throw error
            throw imageInspectionState.inspectionError(namespacedName, params, error)
          }
          imageInspectionState.recordSuccess(namespacedName, params, result)
          const preservedPayload = await preserveMcpResult(result, invokeContext.runtime.workspacePath)
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
            content: toPiContentArray(preservedPayload.content),
            details: preservedPayload.details
          }
        }
      } as any
      tools.push(mcpTool)
    }
  }

  return { tools, clients }
}

export function buildCodemodeTool(input: {
  packageBridge: PiPackageBridge
  mcpTools: PiAgentHarnessTool[]
  invokeContext: ClaudeCodeInvokeContext
  canUseTool?: CanUseTool
  pendingFileChanges: Map<string, PendingFileChangeSnapshot[]>
  emitNestedToolEvent(event: PiNestedToolEvent): Promise<void>
}): PiAgentHarnessTool {
  const { packageBridge, mcpTools, invokeContext, canUseTool, pendingFileChanges, emitNestedToolEvent } = input
  const { Type } = packageBridge.piAi
  const searchableTools: CodemodeSearchEntry[] = mcpTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.parameters as Record<string, unknown>
  }))

  const codemodeTools: PiCodemodeTool[] = mcpTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.parameters as Record<string, unknown>,
    async execute(args, context) {
      const startedAt = Date.now()
      const nestedToolCallId = `codemode-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      const toolArgs =
        args && typeof args === 'object' && !Array.isArray(args)
          ? (args as Record<string, unknown>)
          : {}
      let resolvedArgs: Record<string, unknown> = toolArgs
      logger.info('[CodemodeTiming] nested MCP tool start', {
        traceId: invokeContext.runtime.traceId,
        topicId: invokeContext.projection.topicId,
        toolName: tool.name,
        toolCallId: nestedToolCallId,
        inputChars: summarizeValue(toolArgs).length
      })

      try {
        await capturePendingFileChangeSnapshots({
          toolName: tool.name,
          toolInput: toolArgs,
          toolCallId: nestedToolCallId,
          cwd: invokeContext.runtime.workspacePath,
          pendingFileChanges
        })

        if (canUseTool) {
          const decision = await canUseTool(tool.name, toolArgs, {
            signal: context.signal,
            suggestions: [],
            toolUseID: nestedToolCallId
          })
          if (decision.behavior === 'deny') {
            throw new Error(decision.message || `Permission denied for ${tool.name}`)
          }
          if (
            decision.behavior === 'allow' &&
            decision.updatedInput &&
            typeof decision.updatedInput === 'object' &&
            !Array.isArray(decision.updatedInput)
          ) {
            resolvedArgs = decision.updatedInput
          }
        }

        await emitNestedToolEvent({
          type: 'start',
          toolCallId: nestedToolCallId,
          toolName: tool.name,
          input: resolvedArgs
        })
        const result = await tool.execute(
          nestedToolCallId,
          resolvedArgs as never,
          context.signal,
          () => {
            void emitNestedToolEvent({
              type: 'update',
              toolCallId: nestedToolCallId,
              toolName: tool.name
            })
          },
          undefined
        )
        const text = extractToolText(result.content)
        logger.info('[CodemodeTiming] nested MCP tool end', {
          traceId: invokeContext.runtime.traceId,
          topicId: invokeContext.projection.topicId,
          toolName: tool.name,
          toolCallId: nestedToolCallId,
          elapsedMs: Date.now() - startedAt,
          outputChars: text.length,
          hasStructuredContent: result.details !== undefined
        })
        await emitNestedToolEvent({
          type: 'success',
          toolCallId: nestedToolCallId,
          toolName: tool.name,
          input: resolvedArgs,
          result
        })
        if (result.details !== undefined) {
          let parsed: unknown
          try {
            parsed = JSON.parse(text)
          } catch {
            // Keep non-JSON results as text.
          }
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return { ...parsed, text, content: [{ type: 'text', text }], structuredContent: result.details }
          }
          return {
            text,
            structuredContent: result.details
          }
        }
        return text
      } catch (error) {
        logger.warn('[CodemodeTiming] nested MCP tool failed', {
          traceId: invokeContext.runtime.traceId,
          topicId: invokeContext.projection.topicId,
          toolName: tool.name,
          toolCallId: nestedToolCallId,
          elapsedMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error)
        })
        await emitNestedToolEvent({
          type: 'error',
          toolCallId: nestedToolCallId,
          toolName: tool.name,
          input: resolvedArgs,
          error
        })
        throw error
      }
    }
  }))

  const globals: PiCodemodeTool[] = [
    {
      name: 'searchTools',
      description: 'Search all available MCP tools. Prefer concise English capability keywords.',
      spread: true,
      signature: '(query: string, limit?: number): Promise<Array<{ name: string; description: string }>>',
      async execute(rawArgs) {
        const startedAt = Date.now()
        const args = Array.isArray(rawArgs) ? rawArgs : [rawArgs]
        const query = String(args[0] || '').trim()
        const limit = Number(args[1] ?? 5)
        const results = searchCodemodeTools(searchableTools, query, limit)
        logger.info('[CodemodeTiming] searchTools completed', {
          traceId: invokeContext.runtime.traceId,
          topicId: invokeContext.projection.topicId,
          query,
          limit,
          catalogSize: searchableTools.length,
          resultCount: results.length,
          resultChars: JSON.stringify(results).length,
          elapsedMs: Date.now() - startedAt
        })
        return results
      }
    },
    {
      name: 'describeTool',
      description: 'Return the description and input schema for one exact MCP tool name.',
      spread: true,
      signature: '(name: string): Promise<{ name: string; description: string; inputSchema: object }>',
      async execute(rawArgs) {
        const startedAt = Date.now()
        const args = Array.isArray(rawArgs) ? rawArgs : [rawArgs]
        const requestedName = String(args[0] || '').trim()
        const tool = searchableTools.find((entry) => entry.name === requestedName)
        if (!tool) throw new Error(`Unknown MCP tool: ${requestedName}`)
        logger.info('[CodemodeTiming] describeTool completed', {
          traceId: invokeContext.runtime.traceId,
          topicId: invokeContext.projection.topicId,
          toolName: requestedName,
          schemaChars: JSON.stringify(tool.inputSchema || {}).length,
          elapsedMs: Date.now() - startedAt
        })
        return tool
      }
    }
  ]

  return {
    name: 'codemode',
    label: 'Codemode',
    description: [
      'Run sandboxed JavaScript to discover and call MCP tools without loading their schemas into the main model context.',
      'The script is an async function body with top-level await. It cannot access process, filesystem, network, require, fetch, or timers except through tools.',
      'Discovery: `return await searchTools("generate video", 8)`.',
      'Inspection: `return await describeTool("mcp__vectcut__video__generate_video")`.',
      'Execution: `return await tools["mcp__vectcut__video__generate_video"]({ ...args })`.',
      'JSON tool results are objects: access result.data directly, not JSON.parse(result). Large results include structuredContent.artifact.file_path for Read/Bash. Do not treat a truncated preview as empty or repeat a paid call to recover it.',
      'Tool search returns compact candidates without schemas. Inspect only the best candidate before execution.',
      'Use concise English keywords for discovery. Use Promise.all for independent calls. Return a JSON-serializable value; do not both text() and return the same value.'
    ].join('\n'),
    parameters: Type.Object({
      code: Type.String({
        description: 'JavaScript async function body that discovers or invokes MCP tools.'
      })
    }),
    async execute(
      _toolCallId: string,
      rawParams: unknown,
      signal?: AbortSignal
    ) {
      const startedAt = Date.now()
      const params = (rawParams ?? {}) as Record<string, unknown>
      const code = String(params.code || '').trim()
      if (!code) throw new Error('codemode requires non-empty code')
      logger.info('[CodemodeTiming] sandbox execution start', {
        traceId: invokeContext.runtime.traceId,
        topicId: invokeContext.projection.topicId,
        toolCallId: _toolCallId,
        codeChars: code.length
      })

      const sandbox = new packageBridge.piCodemode.CodemodeSandbox({
        tools: codemodeTools,
        globals,
        timeoutMs: 45 * 60 * 1000,
        memoryLimitBytes: 128 * 1024 * 1024
      })

      try {
        const result = await sandbox.execute(code, { signal })
        const content: Array<PiTextContent | PiImageContent> = result.output.map((item) => {
          if (item.type === 'image') {
            return {
              type: 'image',
              data: item.data,
              mimeType: item.mimeType
            } as PiImageContent
          }
          return {
            type: 'text',
            text: item.text
          } as PiTextContent
        })

        if (result.ok && result.value !== undefined) {
          content.push({
            type: 'text',
            text: typeof result.value === 'string' ? result.value : JSON.stringify(result.value, null, 2)
          })
        }
        if (result.ok === false) {
          throw new Error(result.error.stack || result.error.message)
        }

        const storedOutput = await preserveMcpResult({ content }, invokeContext.runtime.workspacePath)
        const artifact = (storedOutput.details as { artifact?: unknown } | undefined)?.artifact
        const modelContent = artifact
          ? [{
              type: 'text' as const,
              text: JSON.stringify({
                truncated: true,
                reason: 'Output exceeds the inline limit. It is not empty. Read the saved file with Read or Bash; do not repeat the API call.',
                artifact
              })
            }]
          : content
        logger.info('[CodemodeTiming] sandbox execution end', {
          traceId: invokeContext.runtime.traceId,
          topicId: invokeContext.projection.topicId,
          toolCallId: _toolCallId,
          elapsedMs: Date.now() - startedAt,
          callCount: result.calls.length,
          outputItemCount: result.output.length,
          outputChars: content.reduce((total, item) => total + ('text' in item ? item.text.length : 0), 0)
        })
        return {
          content: modelContent.length > 0 ? modelContent : [{ type: 'text', text: '(codemode completed with no output)' }],
          details: {
            calls: result.calls
          }
        }
      } catch (error) {
        logger.warn('[CodemodeTiming] sandbox execution failed', {
          traceId: invokeContext.runtime.traceId,
          topicId: invokeContext.projection.topicId,
          toolCallId: _toolCallId,
          elapsedMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error)
        })
        throw error
      } finally {
        await sandbox.close()
      }
    }
  } as any
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
  let requestSequence = 0

  return {
    stream(model: unknown, context: unknown, options: unknown) {
      const requestIndex = ++requestSequence
      const requestStartedAt = Date.now()
      const typedModel = (model ?? {}) as Record<string, unknown>
      const typedOptions = ((options && typeof options === 'object' ? options : {}) as Record<string, unknown>)
      logger.info('[AgentCore] pi provider wrapper invoked', {
        traceId: invokeContext.runtime.traceId,
        topicId: invokeContext.projection.topicId,
        piSessionId: invokeContext.projection.piSessionId,
        providerApiType,
        method: 'stream',
        requestIndex,
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
          const originalOnPayload = typeof typedOptions.onPayload === "function" ? typedOptions.onPayload : undefined
          const replacement = originalOnPayload ? await originalOnPayload(payload, payloadModel as any) : undefined
          logger.info('[AgentCore] pi provider payload', {
            traceId: invokeContext.runtime.traceId,
            topicId: invokeContext.projection.topicId,
            providerApiType,
            method: 'stream',
            requestIndex,
            modelId: String(typedModel.id || ''),
            ...summarizeProviderPayload(replacement ?? payload)
          })
          return replacement
        },
        onResponse: async (response: unknown, responseModel: unknown) => {
          const providerResponse = (response ?? {}) as Record<string, unknown>
          logger.info('[AgentCore] pi provider response', {
            traceId: invokeContext.runtime.traceId,
            topicId: invokeContext.projection.topicId,
            piSessionId: invokeContext.projection.piSessionId,
            providerApiType,
            method: 'stream',
            requestIndex,
            responseHeadersElapsedMs: Date.now() - requestStartedAt,
            modelId: String((responseModel as Record<string, unknown> | undefined)?.id || typedModel.id || ''),
            baseUrl: String((responseModel as Record<string, unknown> | undefined)?.baseUrl || typedModel.baseUrl || ''),
            status: providerResponse.status
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
      const requestIndex = ++requestSequence
      const requestStartedAt = Date.now()
      const typedModel = (model ?? {}) as Record<string, unknown>
      const typedOptions = ((options && typeof options === 'object' ? options : {}) as Record<string, unknown>)
      logger.info('[AgentCore] pi provider wrapper invoked', {
        traceId: invokeContext.runtime.traceId,
        topicId: invokeContext.projection.topicId,
        piSessionId: invokeContext.projection.piSessionId,
        providerApiType,
        method: 'streamSimple',
        requestIndex,
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
          const originalOnPayload = typeof typedOptions.onPayload === 'function' ? typedOptions.onPayload : undefined
          const replacement = originalOnPayload ? await originalOnPayload(payload, payloadModel as any) : undefined
          logger.info('[AgentCore] pi provider payload', {
            traceId: invokeContext.runtime.traceId,
            topicId: invokeContext.projection.topicId,
            providerApiType,
            method: 'streamSimple',
            requestIndex,
            modelId: String(typedModel.id || ''),
            ...summarizeProviderPayload(replacement ?? payload)
          })
          return replacement
        },
        onResponse: async (response: unknown, responseModel: unknown) => {
          const providerResponse = (response ?? {}) as Record<string, unknown>
          logger.info('[AgentCore] pi provider response', {
            traceId: invokeContext.runtime.traceId,
            topicId: invokeContext.projection.topicId,
            piSessionId: invokeContext.projection.piSessionId,
            providerApiType,
            method: 'streamSimple',
            requestIndex,
            responseHeadersElapsedMs: Date.now() - requestStartedAt,
            modelId: String((responseModel as Record<string, unknown> | undefined)?.id || typedModel.id || ''),
            baseUrl: String((responseModel as Record<string, unknown> | undefined)?.baseUrl || typedModel.baseUrl || ''),
            status: providerResponse.status
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
  const contextWindowTokens = runtimeEnvironment.modelTokenLimits?.contextWindowTokens ?? 200_000
  const maxOutputTokens = Math.min(runtimeEnvironment.modelTokenLimits?.maxOutputTokens ?? 32_000, 32_000)

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
    contextWindowTokens,
    maxInputTokens: runtimeEnvironment.modelTokenLimits?.maxInputTokens,
    maxOutputTokens,
    compactionTriggerTokens: runtimeEnvironment.modelTokenLimits?.compactionTriggerTokens,
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
        contextWindow: contextWindowTokens,
        maxTokens: maxOutputTokens
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

  const interactiveUpdatedInputs = new Map<string, Record<string, unknown>>()
  const nestedToolListeners = new Set<(event: PiNestedToolEvent) => void | Promise<void>>()
  const emitNestedToolEvent = async (event: PiNestedToolEvent): Promise<void> => {
    await Promise.allSettled(Array.from(nestedToolListeners, (listener) => listener(event)))
  }

  const builtinTools = buildBuiltinTools({
    packageBridge,
    invokeContext,
    runtimeEnvironment,
    interactiveUpdatedInputs
  })
  const mcpTools = await buildMcpTools({
    packageBridge,
    invokeContext,
    options
  })
  const codemodeTool = buildCodemodeTool({
    packageBridge,
    mcpTools: mcpTools.tools,
    invokeContext,
    canUseTool,
    pendingFileChanges,
    emitNestedToolEvent
  })
  const tools = [...builtinTools, codemodeTool, ...mcpTools.tools]
  const activeToolNames = [...builtinTools.map((tool) => tool.name), codemodeTool.name]

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

    if (decision.behavior === 'deny') {
      return {
        block: true,
        reason: decision.message
      }
    }

    if (
      decision.behavior === 'allow' &&
      decision.updatedInput &&
      typeof decision.updatedInput === 'object' &&
      !Array.isArray(decision.updatedInput)
    ) {
      interactiveUpdatedInputs.set(context.toolCallId, decision.updatedInput as Record<string, unknown>)
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
    tokenLimits: runtimeEnvironment.modelTokenLimits,
    harness,
    tools,
    mcpClients: mcpTools.clients,
    subscribeNestedToolEvents(listener) {
      nestedToolListeners.add(listener)
      return () => {
        nestedToolListeners.delete(listener)
      }
    }
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
