import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loggerService } from '@logger'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
import Store from 'electron-store'
import { net } from 'electron'

import { persistWorkspaceJsonArtifact } from './workspace-json-artifact'

const logger = loggerService.withContext('MCPServer:ImageUnderstand')

const API_HOST = 'https://open.vectcut.com'
const CHAT_COMPLETIONS_ENDPOINT = '/llm/chat/v1/chat/completions'
const OAUTH_TOKEN_URL = 'https://mlbd8l6vgi13-demo.authing.cn/oidc/token'
const OAUTH_CLIENT_ID = '6901dd145dafc6f1f3143938'
const OAUTH_CLIENT_SECRET = '16a94e467e927cc09b3c8dc7ec92d420'
const IMAGE_UNDERSTAND_MODEL = 'gpt-5.6-luna'
const INLINE_DATA_URL_PREVIEW = '<data-url-omitted>'

const INSPECT_IMAGE_TOOL: Tool = {
  name: 'inspect_image',
  description:
    'Inspect an image with the fixed VectCut vision model gpt-5.6-luna. Remote image URLs are sent directly without downloading, while local image paths are converted into data URLs automatically.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Absolute or workspace-relative local image path.'
      },
      path: {
        type: 'string',
        description: 'Alias of file_path.'
      },
      url: {
        type: 'string',
        description: 'Remote image URL, file URL, data URL, or local image path.'
      },
      image_url: {
        type: 'string',
        description: 'Alias of url.'
      },
      question: {
        type: 'string',
        description: 'Optional question about the image.'
      },
      prompt: {
        type: 'string',
        description: 'Alias of question.'
      }
    },
    additionalProperties: true
  }
}

type PendingToken = {
  accessToken: string
  expiresAt: number
}

type PreparedImageSource = {
  originalInput: string
  requestUrl: string
  summaryUrl: string
  sourceKind: 'remote_image' | 'local_image' | 'inline_image'
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

const isHttpLikeUrl = (value: string) => /^https?:\/\//i.test(value)
const DATA_URL_PATTERN = /^data:([^;,]+)?;base64,(.+)$/i

function extractTextFromChunkRecord(record: Record<string, unknown>): string {
  const choices = Array.isArray(record.choices) ? record.choices : []
  const textParts: string[] = []

  for (const choice of choices) {
    if (!choice || typeof choice !== 'object') continue
    const choiceRecord = choice as Record<string, unknown>
    const delta = choiceRecord.delta && typeof choiceRecord.delta === 'object'
      ? (choiceRecord.delta as Record<string, unknown>)
      : null
    const message = choiceRecord.message && typeof choiceRecord.message === 'object'
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
    model: latestModel || IMAGE_UNDERSTAND_MODEL,
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
        throw new Error(`Unexpected token in image understand response: ${responseText.slice(0, 120)}`)
      }
      return {
        model: IMAGE_UNDERSTAND_MODEL,
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
      throw new Error(`Unexpected token in image understand response: ${responseText.slice(0, 120)}`)
    }
    return ssePayload
  }
}

const guessImageMimeType = (source: string, fallback = 'image/png'): string => {
  const normalized = String(source || '').trim().toLowerCase()
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg'
  if (normalized.endsWith('.webp')) return 'image/webp'
  if (normalized.endsWith('.gif')) return 'image/gif'
  if (normalized.endsWith('.bmp')) return 'image/bmp'
  if (normalized.endsWith('.svg')) return 'image/svg+xml'
  if (normalized.endsWith('.avif')) return 'image/avif'
  if (normalized.endsWith('.heic')) return 'image/heic'
  return fallback
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
    'Reply in Chinese by default unless the user clearly asks in another language.',
    'Include any clearly visible text exactly when possible.'
  ].join('\n')
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

class ImageUnderstandServer {
  public mcpServer: McpServer
  private readonly store = new Store({ name: 'vectcut' })
  private readonly workspacePath?: string
  private accessToken: PendingToken | null = null
  private refreshPromise: Promise<string> | null = null

  constructor(workspacePath?: string) {
    this.workspacePath = workspacePath
    this.mcpServer = new McpServer(
      {
        name: 'image-understand',
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
      tools: [INSPECT_IMAGE_TOOL]
    }))

    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name
      const args = request.params.arguments ?? {}

      try {
        switch (toolName) {
          case 'inspect_image':
            return await this.inspectImage(args as Record<string, unknown>)
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

  private async requestWithAuth(pathname: string, init: { body: Record<string, unknown> }): Promise<Response> {
    const token = await this.ensureValidAccessToken()
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

    let response = await doFetch(token)
    if (response.status === 401) {
      const refreshedToken = await this.ensureValidAccessToken(true)
      response = await doFetch(refreshedToken)
    }

    return response
  }

  private normalizeSource(value: unknown): string {
    const raw = String(value || '').trim()
    if (!raw) {
      throw new McpError(ErrorCode.InvalidParams, 'Image source contains an empty value')
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
        'Local image paths must be absolute when the current workspace path is unavailable'
      )
    }
    return path.resolve(this.workspacePath, source)
  }

  private async prepareImageSource(input: unknown): Promise<PreparedImageSource> {
    const normalizedSource = this.normalizeSource(input)

    if (isHttpLikeUrl(normalizedSource)) {
      return {
        originalInput: normalizedSource,
        requestUrl: normalizedSource,
        summaryUrl: normalizedSource,
        sourceKind: 'remote_image'
      }
    }

    const inlineDataUrlMatch = normalizedSource.match(DATA_URL_PATTERN)
    if (inlineDataUrlMatch) {
      const mediaType = String(inlineDataUrlMatch[1] || 'image/png').trim() || 'image/png'
      return {
        originalInput: 'data-url',
        requestUrl: normalizedSource,
        summaryUrl: `data:${mediaType};base64,${INLINE_DATA_URL_PREVIEW}`,
        sourceKind: 'inline_image'
      }
    }

    const resolvedPath = this.resolveLocalPath(normalizedSource)
    const stats = await fs.stat(resolvedPath)
    if (!stats.isFile()) {
      throw new McpError(ErrorCode.InvalidParams, 'Local image source must point to a file')
    }

    const buffer = await fs.readFile(resolvedPath)
    const mimeType = guessImageMimeType(resolvedPath)
    const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`
    return {
      originalInput: resolvedPath,
      requestUrl: dataUrl,
      summaryUrl: `data:${mimeType};base64,${INLINE_DATA_URL_PREVIEW}`,
      sourceKind: 'local_image'
    }
  }

  private async inspectImage(args: Record<string, unknown>) {
    const sourceInput = args.file_path || args.path || args.image_url || args.url
    const question = String(args.question || args.prompt || '').trim()

    if (!sourceInput) {
      throw new McpError(ErrorCode.InvalidParams, "One of 'file_path', 'path', 'image_url', or 'url' is required")
    }

    const preparedSource = await this.prepareImageSource(sourceInput)
    const requestBody = {
      model: IMAGE_UNDERSTAND_MODEL,
      stream: true,
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: buildInspectImagePrompt(question)
            },
            {
              type: 'image_url',
              image_url: {
                url: preparedSource.requestUrl
              }
            }
          ]
        }
      ]
    }

    const response = await this.requestWithAuth(CHAT_COMPLETIONS_ENDPOINT, {
      body: requestBody
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Image understand request failed (${response.status}): ${body || 'unknown error'}`)
    }

    const responseText = await response.text()
    const completion = parseChatCompletionPayload(responseText)
    const answer = extractCompletionText(completion)
    if (!answer) {
      throw new Error('Image understand returned an empty response')
    }

    const artifactPayload = {
      provider: 'vectcut',
      action: 'inspect_image',
      mode: 'image_understand',
      request: {
        model: IMAGE_UNDERSTAND_MODEL,
        question,
        source: preparedSource.summaryUrl
      },
      source_summary: [
        {
          original_input: preparedSource.originalInput,
          submitted_url: preparedSource.summaryUrl,
          source_kind: preparedSource.sourceKind
        }
      ],
      response: completion,
      answer
    }

    const artifact = await persistWorkspaceJsonArtifact({
      toolName: 'image-understand',
      taskId: `inspect-${Date.now()}`,
      payload: artifactPayload,
      workspaceRoot: this.workspacePath
    })

    const resultPayload = {
      provider: 'vectcut',
      action: 'inspect_image',
      mode: 'image_understand',
      model: IMAGE_UNDERSTAND_MODEL,
      question,
      answer,
      ...(completion.billing && typeof completion.billing === 'object'
        ? {
            billing: completion.billing
          }
        : {}),
      source_summary: [
        {
          original_input: preparedSource.originalInput,
          submitted_url: preparedSource.summaryUrl,
          source_kind: preparedSource.sourceKind
        }
      ],
      ...(artifact
        ? {
            artifact: {
              storage: 'workspace_file',
              file_path: artifact.filePath,
              relative_path: artifact.relativePath
            }
          }
        : {}),
      response_summary: {
        id: String(completion.id || '').trim() || undefined,
        model: String(completion.model || '').trim() || IMAGE_UNDERSTAND_MODEL,
        choice_count: Array.isArray(completion.choices) ? completion.choices.length : 0
      }
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(resultPayload, null, 2)
        }
      ]
    }
  }
}

export default ImageUnderstandServer
