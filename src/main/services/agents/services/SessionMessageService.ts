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

const HEADLESS_STREAMING_PERSIST_INTERVAL_MS = 2000

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
  /** Extra user-message metadata that should survive persisted hydrate. */
  userMessageExtras?: Record<string, unknown>
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
    const accumulator = new TextStreamAccumulator()
    const headlessAssistantMsgId = randomUUID()
    const headlessUserMsgId = randomUUID()

    if (options?.persist) {
      // Persist the user message as soon as the turn is accepted, so a hard
      // kill mid-stream cannot lose the prompt. The complete-time exchange
      // persist reuses the same message id and updates this row.
      void this.persistHeadlessUserMessage(
        session,
        options?.displayContent ?? req.content,
        agentSessionId,
        headlessUserMsgId,
        options?.images,
        options?.userMessageExtras,
        req.createdAt
      ).catch((error) => {
        logger.error('Failed to persist headless user message at stream start', error as Error)
      })
    }

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
    let streamingPersistTimer: ReturnType<typeof setInterval> | null = null
    let streamingPersistChain: Promise<void> = Promise.resolve()
    let lastSnapshotSignature = ''

    const cleanup = () => {
      if (finished) return
      finished = true
      if (streamingPersistTimer) {
        clearInterval(streamingPersistTimer)
        streamingPersistTimer = null
      }
      claudeStream.removeAllListeners()
    }

    // Periodically checkpoint the in-progress assistant message so a hard kill
    // mid-stream keeps the partial reply. The final exchange persist waits for
    // the checkpoint chain and overwrites the same row.
    const persistStreamingSnapshot = (): Promise<void> => {
      if (finished) return streamingPersistChain
      const snapshotBlocks = accumulator.getAssistantBlocks(headlessAssistantMsgId, req.model)
      const snapshotSignature = `${snapshotBlocks.length}:${accumulator.getText().length}:${accumulator.getReasoningText().length}`
      if (!snapshotBlocks.length || snapshotSignature === lastSnapshotSignature) {
        return streamingPersistChain
      }
      lastSnapshotSignature = snapshotSignature
      streamingPersistChain = streamingPersistChain
        .then(async () => {
          if (finished) return
          await this.persistHeadlessAssistantSnapshot(
            session,
            claudeStream.sdkSessionId || agentSessionId,
            headlessAssistantMsgId,
            req.model,
            snapshotBlocks,
            accumulator.getUsage(),
            req.createdAt
          )
        })
        .catch((error) => {
          logger.warn('Failed to persist streaming assistant snapshot', {
            sessionId: session.id,
            assistantMessageId: headlessAssistantMsgId,
            error: error instanceof Error ? error.message : String(error)
          })
        })
      return streamingPersistChain
    }

    if (options?.persist) {
      streamingPersistTimer = setInterval(() => {
        void persistStreamingSnapshot()
      }, HEADLESS_STREAMING_PERSIST_INTERVAL_MS)
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
                  streamingPersistChain
                    .then(() =>
                      this.persistHeadlessExchange(
                        session,
                        options?.displayContent ?? req.content,
                        assistantBlocks,
                        resolvedSessionId,
                        headlessAssistantMsgId,
                        options?.images,
                        options?.userMessageExtras,
                        req.model,
                        accumulator.getUsage(),
                        accumulator.getUsageSteps(),
                        req.createdAt,
                        undefined,
                        headlessUserMsgId
                      )
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
                    streamingPersistChain
                      .then(() =>
                        this.persistHeadlessExchange(
                          session,
                          options?.displayContent ?? req.content,
                          assistantBlocks,
                          resolvedSessionId,
                          headlessAssistantMsgId,
                          options?.images,
                          options?.userMessageExtras,
                          req.model,
                          usage,
                          accumulator.getUsageSteps(),
                          req.createdAt,
                          true,
                          headlessUserMsgId
                        )
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
   * Persist the user message for headless callers as soon as the turn starts,
   * so a hard kill mid-stream cannot lose the prompt. The complete-time
   * exchange persist must reuse the same message id to update this row.
   */
  private async persistHeadlessUserMessage(
    session: GetAgentSessionResponse,
    userContent: string,
    agentSessionId: string,
    userMsgId: string,
    images?: Array<{ data: string; media_type: string }>,
    userMessageExtras?: Record<string, unknown>,
    userCreatedAt?: number
  ): Promise<void> {
    const createdAtIso = SessionMessageService.toIsoCreatedAt(userCreatedAt, new Date().toISOString())
    const userPayload = this.buildHeadlessUserPayload({
      session,
      userContent,
      userMsgId,
      createdAtIso,
      images,
      userMessageExtras
    })

    await agentMessageRepository.persistUserMessage({
      sessionId: session.id,
      agentSessionId,
      payload: userPayload,
      createdAt: createdAtIso
    })

    logger.info('Persisted headless user message at stream start', {
      sessionId: session.id,
      userMessageId: userMsgId,
      agentSessionId: agentSessionId || ''
    })
  }

  private static toIsoCreatedAt(userCreatedAt: number | undefined, fallbackIso: string): string {
    return typeof userCreatedAt === 'number' && Number.isFinite(userCreatedAt)
      ? new Date(userCreatedAt).toISOString()
      : fallbackIso
  }

  private buildHeadlessUserPayload(params: {
    session: GetAgentSessionResponse
    userContent: string
    userMsgId: string
    createdAtIso: string
    images?: Array<{ data: string; media_type: string }>
    userMessageExtras?: Record<string, unknown>
  }): AgentPersistedMessage {
    const { session, userContent, userMsgId, createdAtIso, images, userMessageExtras } = params
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
          createdAt: createdAtIso,
          status: 'success',
          url: `data:${img.media_type};base64,${img.data}`
        })
      }
    }

    return {
      message: {
        id: userMsgId,
        role: 'user' as const,
        assistantId: session.agent_id,
        topicId,
        createdAt: createdAtIso,
        status: 'success',
        blocks: [userBlockId, ...imageBlocks.map((b) => b.id)],
        ...(userMessageExtras && typeof userMessageExtras === 'object' ? userMessageExtras : {})
      },
      blocks: [
        {
          id: userBlockId,
          messageId: userMsgId,
          type: 'main_text',
          createdAt: createdAtIso,
          status: 'success',
          content: userContent
        },
        ...imageBlocks
      ]
    } as AgentPersistedMessage
  }

  private buildHeadlessAssistantPayload(params: {
    session: GetAgentSessionResponse
    assistantMsgId: string
    blocks: HeadlessPersistedBlock[]
    createdAtIso: string
    updatedAtIso: string
    modelId?: string
    usage?: PersistedUsage
    usageSteps?: PersistedUsage[]
    aborted: boolean
    status: string
  }): AgentPersistedMessage {
    const {
      session,
      assistantMsgId,
      blocks,
      createdAtIso,
      updatedAtIso,
      modelId,
      usage,
      usageSteps,
      aborted,
      status
    } = params
    const assistantDurationMs = Math.max(0, Date.parse(updatedAtIso) - Date.parse(createdAtIso))
    const assistantBlocks: HeadlessPersistedBlock[] = blocks.map((block) => ({
      ...block,
      messageId: assistantMsgId,
      createdAt: createdAtIso,
      updatedAt: updatedAtIso
    }))

    return {
      message: {
        id: assistantMsgId,
        role: 'assistant' as const,
        assistantId: session.agent_id,
        topicId: `agent-session:${session.id}`,
        createdAt: createdAtIso,
        updatedAt: updatedAtIso,
        status,
        aborted,
        blocks: assistantBlocks.map((block) => block.id),
        modelId: modelId || session.model,
        metrics: {
          completion_tokens: Number(usage?.completion_tokens ?? 0),
          time_completion_millsec: assistantDurationMs
        },
        usage,
        usageSteps: Array.isArray(usageSteps) && usageSteps.length > 0 ? usageSteps : undefined
      },
      blocks: assistantBlocks
    } as AgentPersistedMessage
  }

  /**
   * Checkpoint an in-progress assistant message during streaming so a hard
   * kill mid-turn keeps the partial reply. The complete-time exchange persist
   * overwrites this row with the final state.
   */
  private async persistHeadlessAssistantSnapshot(
    session: GetAgentSessionResponse,
    agentSessionId: string,
    assistantMsgId: string,
    modelId: string | undefined,
    blocks: HeadlessPersistedBlock[],
    usage: PersistedUsage | undefined,
    userCreatedAt?: number
  ): Promise<void> {
    const now = new Date().toISOString()
    const createdAtIso = SessionMessageService.toIsoCreatedAt(userCreatedAt, now)
    const assistantPayload = this.buildHeadlessAssistantPayload({
      session,
      assistantMsgId,
      blocks,
      createdAtIso,
      updatedAtIso: now,
      modelId,
      usage,
      aborted: false,
      status: 'streaming'
    })

    await agentMessageRepository.persistAssistantMessage({
      sessionId: session.id,
      agentSessionId,
      payload: assistantPayload,
      createdAt: createdAtIso
    })

    logger.debug('Persisted streaming assistant snapshot', {
      sessionId: session.id,
      assistantMessageId: assistantMsgId,
      blockCount: blocks.length
    })
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
    userMessageExtras?: Record<string, unknown>,
    modelId?: string,
    usage?: PersistedUsage,
    usageSteps?: PersistedUsage[],
    userCreatedAt?: number,
    aborted = false,
    userMsgId?: string
  ): Promise<{ userMessage?: AgentSessionMessageEntity; assistantMessage?: AgentSessionMessageEntity }> {
    const now = new Date().toISOString()
    const normalizedUserCreatedAt = SessionMessageService.toIsoCreatedAt(userCreatedAt, now)
    const normalizedAssistantCreatedAt = normalizedUserCreatedAt
    const resolvedUserMsgId = userMsgId || randomUUID()

    const userPayload = this.buildHeadlessUserPayload({
      session,
      userContent,
      userMsgId: resolvedUserMsgId,
      createdAtIso: normalizedUserCreatedAt,
      images,
      userMessageExtras
    })

    const assistantPayload = this.buildHeadlessAssistantPayload({
      session,
      assistantMsgId,
      blocks: assistantBlocksInput,
      createdAtIso: normalizedAssistantCreatedAt,
      updatedAtIso: now,
      modelId,
      usage,
      usageSteps,
      aborted,
      status: aborted ? 'cancelled' : 'success'
    })
    const assistantBlocks: HeadlessPersistedBlock[] = assistantPayload.blocks as HeadlessPersistedBlock[]

    const result = await agentMessageRepository.persistExchange({
      sessionId: session.id,
      agentSessionId,
      user: { payload: userPayload, createdAt: normalizedUserCreatedAt },
      assistant: { payload: assistantPayload, createdAt: normalizedAssistantCreatedAt }
    })

    logger.info('Persisted headless exchange', {
      sessionId: session.id,
      userMessageId: resolvedUserMsgId,
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
