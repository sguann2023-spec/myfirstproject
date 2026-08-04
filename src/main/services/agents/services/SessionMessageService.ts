import { randomUUID } from 'node:crypto'

import { loggerService } from '@logger'
import type {
  AgentPersistedMessage,
  AgentSessionMessageEntity,
  CreateSessionMessageRequest,
  GetAgentSessionResponse,
  ListOptions
} from '@types'
import type { TextStreamPart } from 'ai'
import { and, desc, eq, not } from 'drizzle-orm'

import { BaseService } from '../BaseService'
import { sessionMessagesTable } from '../database/schema'
import { agentMessageRepository } from '../database/sessionMessageRepository'
import type { AgentStreamEvent } from '../interfaces/AgentStreamInterface'
import ClaudeCodeService from './claudecode'

const claudeCodeService = new ClaudeCodeService()

const logger = loggerService.withContext('SessionMessageService')

type SessionStreamResult = {
  stream: ReadableStream<TextStreamPart<Record<string, any>>>
  streamFinished: Promise<void>
  completion: Promise<{
    userMessage?: AgentSessionMessageEntity
    assistantMessage?: AgentSessionMessageEntity
  }>
}

type HeadlessPersistedBlock = {
  id: string
  messageId: string
  type: string
  createdAt: string
  updatedAt?: string
  status: string
  [key: string]: any
}

type PersistedUsage = {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

export type CreateMessageOptions = {
  /** When true, persist user+assistant messages to DB on stream complete. Use for headless callers (channels, scheduler) where no UI handles persistence. */
  persist?: boolean
  /** Optional display-safe user content for persistence. When set, this is stored instead of req.content (which may contain security wrappers not meant for display). */
  displayContent?: string
  /** User images for persistence and optional multimodal model input. */
  images?: Array<{ data: string; media_type: string }>
}

// Ensure errors emitted through SSE are serializable
function serializeError(error: unknown): { message: string; name?: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack
    }
  }

  if (typeof error === 'string') {
    return { message: error }
  }

  return {
    message: 'Unknown error'
  }
}

function summarizeTextStreamPart(part: TextStreamPart<Record<string, any>>): Record<string, unknown> {
  const chunk = part as any
  const type = String(chunk?.type || 'unknown')
  return {
    type,
    id: typeof chunk?.id === 'string' ? chunk.id : undefined,
    toolCallId: typeof chunk?.toolCallId === 'string' ? chunk.toolCallId : undefined,
    toolName: typeof chunk?.toolName === 'string' ? chunk.toolName : undefined,
    textChars: typeof chunk?.text === 'string' ? chunk.text.length : 0,
    inputPreview:
      chunk?.input !== undefined
        ? String(typeof chunk.input === 'string' ? chunk.input : JSON.stringify(chunk.input)).slice(0, 160)
        : undefined,
    outputPreview:
      chunk?.output !== undefined
        ? String(typeof chunk.output === 'string' ? chunk.output : JSON.stringify(chunk.output)).slice(0, 160)
        : undefined,
    finishReason: typeof chunk?.finishReason === 'string' ? chunk.finishReason : undefined
  }
}

class TextStreamAccumulator {
  private textBuffer = ''
  private totalText = ''
  private readonly toolCalls = new Map<string, { toolName?: string; input?: unknown }>()
  private readonly toolResults = new Map<string, unknown>()
  private readonly toolCallOrder: string[] = []
  private initSlashCommands: string[] = []
  private latestUsage?: PersistedUsage

  add(part: TextStreamPart<Record<string, any>>): void {
    const chunk = part as any
    const partType = chunk.type as string | undefined
    switch (partType) {
      case 'text-start':
        this.textBuffer = ''
        break
      case 'text-delta':
        if (chunk.text) {
          this.textBuffer += chunk.text
        }
        break
      case 'text-end': {
        const blockText = (chunk.providerMetadata?.text?.value as string | undefined) ?? this.textBuffer
        if (blockText) {
          this.totalText += blockText
        }
        this.textBuffer = ''
        break
      }
      case 'tool-call':
        if (chunk.toolCallId) {
          if (!this.toolCalls.has(chunk.toolCallId)) {
            this.toolCallOrder.push(chunk.toolCallId)
          }
          const legacyPart = chunk as {
            args?: unknown
            providerMetadata?: { raw?: { input?: unknown } }
          }
          this.toolCalls.set(chunk.toolCallId, {
            toolName: chunk.toolName,
            input: chunk.input ?? legacyPart.args ?? legacyPart.providerMetadata?.raw?.input
          })
        }
        break
      case 'tool-result':
        if (chunk.toolCallId) {
          const legacyPart = chunk as {
            result?: unknown
            providerMetadata?: { raw?: unknown }
          }
          this.toolResults.set(chunk.toolCallId, chunk.output ?? legacyPart.result ?? legacyPart.providerMetadata?.raw)
        }
        break
      case 'raw': {
        const rawPart = chunk as {
          rawValue?: { type?: string; slash_commands?: unknown }
        }
        const rawValue = rawPart.rawValue
        if (rawValue?.type === 'init' && Array.isArray(rawValue.slash_commands)) {
          this.initSlashCommands = rawValue.slash_commands.filter((cmd): cmd is string => typeof cmd === 'string')
        }
        break
      }
      case 'usage': {
        const usagePart = chunk as {
          usage?: {
            inputTokens?: number | null
            outputTokens?: number | null
            totalTokens?: number | null
          }
        }
        this.setUsageFromSdk(usagePart.usage)
        break
      }
      case 'finish': {
        const finishPart = chunk as {
          totalUsage?: {
            inputTokens?: number | null
            outputTokens?: number | null
            totalTokens?: number | null
          }
        }
        this.setUsageFromSdk(finishPart.totalUsage)
        break
      }
      default:
        break
    }
  }

  private setUsageFromSdk(usage?: {
    inputTokens?: number | null
    outputTokens?: number | null
    totalTokens?: number | null
  }): void {
    if (!usage) {
      return
    }

    const promptTokens = Number(usage.inputTokens ?? 0)
    const completionTokens = Number(usage.outputTokens ?? 0)
    const totalTokens = Number(usage.totalTokens ?? promptTokens + completionTokens)

    if (promptTokens <= 0 && completionTokens <= 0 && totalTokens <= 0) {
      return
    }

    this.latestUsage = {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens
    }
  }

  getText(): string {
    return (this.totalText + this.textBuffer).replace(/\n+$/, '')
  }

  getInitSlashCommands(): string[] {
    return [...this.initSlashCommands]
  }

  getUsage(): PersistedUsage | undefined {
    return this.latestUsage ? { ...this.latestUsage } : undefined
  }

  summarizeState(): Record<string, unknown> {
    return {
      totalTextChars: this.totalText.length,
      textBufferChars: this.textBuffer.length,
      toolCallCount: this.toolCallOrder.length,
      toolResultCount: this.toolResults.size,
      slashCommandCount: this.initSlashCommands.length,
      hasUsage: Boolean(this.latestUsage)
    }
  }

  getAssistantBlocks(
    messageId: string,
    modelId?: string
  ): HeadlessPersistedBlock[] {
    const now = new Date().toISOString()
    const blocks: HeadlessPersistedBlock[] = []

    for (const toolCallId of this.toolCallOrder) {
      const toolCall = this.toolCalls.get(toolCallId)
      if (!toolCall) continue
      const toolResult = this.toolResults.get(toolCallId)
      blocks.push({
        id: randomUUID(),
        messageId,
        type: 'tool',
        createdAt: now,
        updatedAt: now,
        status: toolResult !== undefined ? 'success' : 'processing',
        model: modelId,
        toolId: toolCallId,
        toolName: toolCall.toolName,
        arguments: toolCall.input && typeof toolCall.input === 'object' ? toolCall.input : undefined,
        content: toolResult,
        metadata: {
          rawMcpToolResponse: {
            id: toolCallId,
            tool: {
              id: toolCall.toolName || toolCallId,
              name: toolCall.toolName || toolCallId
            },
            arguments:
              toolCall.input && typeof toolCall.input === 'object'
                ? toolCall.input
                : toolCall.input !== undefined
                  ? String(toolCall.input)
                  : undefined,
            status: toolResult !== undefined ? 'done' : 'pending',
            response: toolResult
          }
        }
      })
    }

    const text = this.getText()
    if (text) {
      blocks.push({
        id: randomUUID(),
        messageId,
        type: 'main_text',
        createdAt: now,
        updatedAt: now,
        status: 'success',
        modelId,
        content: text
      })
    }

    return blocks
  }
}

export class SessionMessageService extends BaseService {
  private static instance: SessionMessageService | null = null

  static getInstance(): SessionMessageService {
    if (!SessionMessageService.instance) {
      SessionMessageService.instance = new SessionMessageService()
    }
    return SessionMessageService.instance
  }

  async sessionMessageExists(id: number): Promise<boolean> {
    const database = await this.getDatabase()
    const result = await database
      .select({ id: sessionMessagesTable.id })
      .from(sessionMessagesTable)
      .where(eq(sessionMessagesTable.id, id))
      .limit(1)

    return result.length > 0
  }

  async listSessionMessages(
    sessionId: string,
    options: ListOptions = {}
  ): Promise<{ messages: AgentSessionMessageEntity[] }> {
    // Get messages with pagination
    const database = await this.getDatabase()
    const baseQuery = database
      .select()
      .from(sessionMessagesTable)
      .where(eq(sessionMessagesTable.session_id, sessionId))
      .orderBy(sessionMessagesTable.created_at)

    const result =
      options.limit !== undefined
        ? options.offset !== undefined
          ? await baseQuery.limit(options.limit).offset(options.offset)
          : await baseQuery.limit(options.limit)
        : await baseQuery

    const messages = result.map((row) => this.deserializeSessionMessage(row))

    return { messages }
  }

  async deleteSessionMessage(sessionId: string, messageId: number): Promise<boolean> {
    const database = await this.getDatabase()
    const result = await database
      .delete(sessionMessagesTable)
      .where(and(eq(sessionMessagesTable.id, messageId), eq(sessionMessagesTable.session_id, sessionId)))

    return result.rowsAffected > 0
  }

  async createSessionMessage(
    session: GetAgentSessionResponse,
    messageData: CreateSessionMessageRequest,
    abortController: AbortController,
    options?: CreateMessageOptions
  ): Promise<SessionStreamResult> {
    return await this.startSessionMessageStream(session, messageData, abortController, options)
  }

  private async startSessionMessageStream(
    session: GetAgentSessionResponse,
    req: CreateSessionMessageRequest,
    abortController: AbortController,
    options?: CreateMessageOptions
  ): Promise<SessionStreamResult> {
    const agentSessionId = await this.getLastAgentSessionId(session.id)
    const claudeStream = await claudeCodeService.invoke(
      req.content,
      session,
      abortController,
      agentSessionId,
      {
        effort: req.effort,
        thinking: req.thinking
      },
      req.model,
      options?.images
    )
    const accumulator = new TextStreamAccumulator()
    const headlessAssistantMsgId = randomUUID()

    let resolveCompletion!: (value: {
      userMessage?: AgentSessionMessageEntity
      assistantMessage?: AgentSessionMessageEntity
    }) => void
    let rejectCompletion!: (reason?: unknown) => void
    let resolveStreamFinished!: () => void
    let streamFinishedResolved = false

    const completion = new Promise<{
      userMessage?: AgentSessionMessageEntity
      assistantMessage?: AgentSessionMessageEntity
    }>((resolve, reject) => {
      resolveCompletion = resolve
      rejectCompletion = reject
    })
    const streamFinished = new Promise<void>((resolve) => {
      resolveStreamFinished = () => {
        if (streamFinishedResolved) return
        streamFinishedResolved = true
        resolve()
      }
    })

    let finished = false
    let firstStreamEventLogged = false

    const cleanup = () => {
      if (finished) return
      finished = true
      claudeStream.removeAllListeners()
    }

    const stream = new ReadableStream<TextStreamPart<Record<string, any>>>({
      start: (controller) => {
        claudeStream.on('data', async (event: AgentStreamEvent) => {
          if (finished) return
          try {
            if (!firstStreamEventLogged) firstStreamEventLogged = true
            switch (event.type) {
              case 'chunk': {
                const chunk = event.chunk as TextStreamPart<Record<string, any>> | undefined
                if (!chunk) {
                  logger.warn('Received agent chunk event without chunk payload')
                  return
                }

                accumulator.add(chunk)
                logger.info('[SessionMessageService][StreamChunk] accumulated chunk', {
                  sessionId: session.id,
                  requestModel: req.model,
                  assistantMessageId: headlessAssistantMsgId,
                  chunk: summarizeTextStreamPart(chunk),
                  accumulator: accumulator.summarizeState()
                })
                controller.enqueue(chunk)
                break
              }

              case 'stream-finished': {
                resolveStreamFinished()
                break
              }

              case 'error': {
                const stderrMessage = (event as any)?.data?.stderr as string | undefined
                const underlyingError = event.error ?? (stderrMessage ? new Error(stderrMessage) : undefined)
                resolveStreamFinished()
                cleanup()
                const streamError = underlyingError ?? new Error('Stream error')
                controller.error(streamError)
                rejectCompletion(serializeError(streamError))
                break
              }

              case 'complete': {
                resolveStreamFinished()
                cleanup()
                controller.close()
                if (options?.persist) {
                  // Read SDK session_id from the stream object (set by ClaudeCodeService on init)
                  const resolvedSessionId = claudeStream.sdkSessionId || agentSessionId
                  const assistantBlocks = accumulator.getAssistantBlocks(headlessAssistantMsgId, req.model)
                  logger.debug('Persisting headless exchange with agent session ID', {
                    sdkSessionId: claudeStream.sdkSessionId,
                    fallback: agentSessionId,
                    resolved: resolvedSessionId,
                    accumulator: accumulator.summarizeState(),
                    assistantBlockCount: assistantBlocks.length,
                    assistantBlockTypes: assistantBlocks.map((block) => block.type)
                  })
                  this.persistHeadlessExchange(
                    session,
                    options?.displayContent ?? req.content,
                    assistantBlocks,
                    resolvedSessionId,
                    headlessAssistantMsgId,
                    options?.images,
                    req.model,
                    accumulator.getUsage()
                  )
                    .then(resolveCompletion)
                    .catch((err) => {
                      logger.error('Failed to persist headless exchange', err as Error)
                      resolveCompletion({})
                    })
                } else {
                  resolveCompletion({})
                }
                break
              }

              case 'cancelled': {
                resolveStreamFinished()
                cleanup()
                controller.close()
                if (options?.persist) {
                  const resolvedSessionId = claudeStream.sdkSessionId || agentSessionId
                  const partialText = accumulator.getText()
                  if (partialText) {
                    this.persistHeadlessExchange(
                      session,
                      options?.displayContent ?? req.content,
                      accumulator.getAssistantBlocks(headlessAssistantMsgId, req.model),
                      resolvedSessionId,
                      headlessAssistantMsgId,
                      options?.images,
                      req.model,
                      accumulator.getUsage()
                    )
                      .then(resolveCompletion)
                      .catch((err) => {
                        logger.error('Failed to persist cancelled exchange', err as Error)
                        resolveCompletion({})
                      })
                  } else {
                    resolveCompletion({})
                  }
                } else {
                  resolveCompletion({})
                }
                break
              }

              default:
                logger.warn('Unknown event type from Claude Code service:', {
                  type: event.type
                })
                break
            }
          } catch (error) {
            cleanup()
            controller.error(error)
            rejectCompletion(serializeError(error))
          }
        })
      },
      cancel: (reason: unknown) => {
        cleanup()
        abortController.abort(typeof reason === 'string' ? reason : 'stream cancelled')
        resolveCompletion({})
      }
    })

    return { stream, streamFinished, completion }
  }

  /**
   * Persist user + assistant messages for headless callers (channels, scheduler)
   * that have no UI to handle persistence via IPC.
   */
  private async persistHeadlessExchange(
    session: GetAgentSessionResponse,
    userContent: string,
    assistantBlocksInput: HeadlessPersistedBlock[],
    agentSessionId: string,
    assistantMsgId: string,
    images?: Array<{ data: string; media_type: string }>,
    modelId?: string,
    usage?: PersistedUsage
  ): Promise<{ userMessage?: AgentSessionMessageEntity; assistantMessage?: AgentSessionMessageEntity }> {
    const now = new Date().toISOString()
    const userMsgId = randomUUID()
    const userBlockId = randomUUID()
    const topicId = `agent-session:${session.id}`

    // Build image blocks for user message
    const imageBlocks: Array<{
      id: string
      messageId: string
      type: string
      createdAt: string
      status: string
      url: string
    }> = []
    if (images && images.length > 0) {
      for (const img of images) {
        imageBlocks.push({
          id: randomUUID(),
          messageId: userMsgId,
          type: 'image',
          createdAt: now,
          status: 'success',
          url: `data:${img.media_type};base64,${img.data}`
        })
      }
    }

    const userPayload = {
      message: {
        id: userMsgId,
        role: 'user' as const,
        assistantId: session.agent_id,
        topicId,
        createdAt: now,
        status: 'success',
        blocks: [userBlockId, ...imageBlocks.map((b) => b.id)]
      },
      blocks: [
        {
          id: userBlockId,
          messageId: userMsgId,
          type: 'main_text',
          createdAt: now,
          status: 'success',
          content: userContent
        },
        ...imageBlocks
      ]
    } as AgentPersistedMessage

    const assistantBlocks: HeadlessPersistedBlock[] = assistantBlocksInput.map((block) => ({
      ...block,
      messageId: assistantMsgId
    }))

    const assistantPayload = {
      message: {
        id: assistantMsgId,
        role: 'assistant' as const,
        assistantId: session.agent_id,
        topicId,
        createdAt: now,
        status: 'success',
        blocks: assistantBlocks.map((block) => block.id),
        modelId: modelId || session.model,
        usage
      },
      blocks: assistantBlocks
    } as AgentPersistedMessage

    const result = await agentMessageRepository.persistExchange({
      sessionId: session.id,
      agentSessionId,
      user: { payload: userPayload, createdAt: now },
      assistant: { payload: assistantPayload, createdAt: now }
    })

    logger.info('Persisted headless exchange', {
      sessionId: session.id,
      userMessageId: userMsgId,
      assistantMessageId: assistantMsgId,
      assistantBlockCount: assistantBlocks.length,
      assistantToolBlockCount: assistantBlocks.filter((block) => block.type === 'tool').length,
      assistantUsage: usage,
      assistantBlockTypes: assistantBlocks.map((block) => String(block.type || 'unknown')),
      assistantTextChars: assistantBlocks
        .filter((block) => typeof (block as { content?: unknown }).content === 'string')
        .reduce((total, block) => total + String((block as { content?: unknown }).content || '').length, 0)
    })

    return result
  }

  private async getLastAgentSessionId(sessionId: string): Promise<string> {
    try {
      const database = await this.getDatabase()
      const result = await database
        .select({ agent_session_id: sessionMessagesTable.agent_session_id })
        .from(sessionMessagesTable)
        .where(and(eq(sessionMessagesTable.session_id, sessionId), not(eq(sessionMessagesTable.agent_session_id, ''))))
        .orderBy(desc(sessionMessagesTable.created_at))
        .limit(1)

      logger.silly('Last agent session ID result:', { agentSessionId: result[0]?.agent_session_id, sessionId })
      return result[0]?.agent_session_id || ''
    } catch (error) {
      logger.error('Failed to get last agent session ID', {
        sessionId,
        error
      })
      return ''
    }
  }

  private deserializeSessionMessage(data: any): AgentSessionMessageEntity {
    if (!data) return data

    const deserialized = { ...data }

    // Parse content JSON
    if (deserialized.content && typeof deserialized.content === 'string') {
      try {
        deserialized.content = JSON.parse(deserialized.content)
      } catch (error) {
        logger.warn(`Failed to parse content JSON:`, error as Error)
      }
    }

    // Parse metadata JSON
    if (deserialized.metadata && typeof deserialized.metadata === 'string') {
      try {
        deserialized.metadata = JSON.parse(deserialized.metadata)
      } catch (error) {
        logger.warn(`Failed to parse metadata JSON:`, error as Error)
      }
    }

    return deserialized
  }
}

export const sessionMessageService = SessionMessageService.getInstance()
