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
import { TextStreamAccumulator, type HeadlessPersistedBlock } from './session-stream-accumulator'

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

type PersistedUsage = {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  prompt_tokens_details?: {
    cached_tokens?: number
    cache_creation_input_tokens?: number
    cache_write_tokens?: number
  }
  input_tokens_details?: {
    cached_tokens?: number
    cache_creation_input_tokens?: number
    cache_write_tokens?: number
  }
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
                    accumulator.getUsage(),
                    accumulator.getUsageSteps(),
                    req.createdAt
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
                  const assistantBlocks = accumulator.getAssistantBlocks(headlessAssistantMsgId, req.model)
                  const usage = accumulator.getUsage()
                  if (assistantBlocks.length > 0 || usage) {
                    this.persistHeadlessExchange(
                      session,
                      options?.displayContent ?? req.content,
                      assistantBlocks,
                      resolvedSessionId,
                      headlessAssistantMsgId,
                      options?.images,
                      req.model,
                      usage,
                      accumulator.getUsageSteps(),
                      req.createdAt
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
    usage?: PersistedUsage,
    usageSteps?: PersistedUsage[],
    userCreatedAt?: number
  ): Promise<{ userMessage?: AgentSessionMessageEntity; assistantMessage?: AgentSessionMessageEntity }> {
    const now = new Date().toISOString()
    const normalizedUserCreatedAt =
      typeof userCreatedAt === 'number' && Number.isFinite(userCreatedAt)
        ? new Date(userCreatedAt).toISOString()
        : now
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
          createdAt: normalizedUserCreatedAt,
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
        createdAt: normalizedUserCreatedAt,
        status: 'success',
        blocks: [userBlockId, ...imageBlocks.map((b) => b.id)]
      },
      blocks: [
        {
          id: userBlockId,
          messageId: userMsgId,
          type: 'main_text',
          createdAt: normalizedUserCreatedAt,
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
        usage,
        usageSteps: Array.isArray(usageSteps) && usageSteps.length > 0 ? usageSteps : undefined
      },
      blocks: assistantBlocks
    } as AgentPersistedMessage

    const result = await agentMessageRepository.persistExchange({
      sessionId: session.id,
      agentSessionId,
      user: { payload: userPayload, createdAt: normalizedUserCreatedAt },
      assistant: { payload: assistantPayload, createdAt: now }
    })

    logger.info('Persisted headless exchange', {
      sessionId: session.id,
      userMessageId: userMsgId,
      assistantMessageId: assistantMsgId,
      assistantBlockCount: assistantBlocks.length,
      assistantToolBlockCount: assistantBlocks.filter((block) => block.type === 'tool').length,
      assistantUsage: usage,
      assistantUsageStepsCount: usageSteps?.length ?? 0,
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
