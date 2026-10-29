import { randomUUID } from 'node:crypto'
import { workspaceActivity } from './workspaceRename'

import { loggerService } from '@logger'
import type {
  AgentPersistedMessage,
  AgentSessionMessageEntity,
  CreateSessionMessageRequest,
  GetAgentSessionResponse,
  ListOptions
} from '@types'
import type { TextStreamPart } from 'ai'
import { and, desc, eq, not, sql } from 'drizzle-orm'

import { BaseService } from '../BaseService'
import { sessionMessagesTable } from '../database/schema'
import { agentTranscriptRepository } from '../database/repositories/agentTranscriptRepository'
import { agentTurnRepository } from '../database/repositories/agentTurnRepository'
import type { AgentInvocationIds, AgentStream, AgentStreamEvent } from '../interfaces/AgentStreamInterface'
import { agentMessageRepository } from '../database/sessionMessageRepository'
import { allocateAgentInvocationIds } from './agent-invocation-ids'
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
  /** Stable identities supplied by a retrying caller. Omit for first acceptance. */
  invocationIds?: AgentInvocationIds
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

  async deleteSessionMessage(sessionId: string, messageId: string | number): Promise<boolean> {
    const logicalMessageId = String(messageId)
    const canonicalDeleted = await agentTranscriptRepository.tombstoneMessage(sessionId, logicalMessageId)

    const database = await this.getDatabase()
    const rows = await database
      .select()
      .from(sessionMessagesTable)
      .where(
        and(
          eq(sessionMessagesTable.session_id, sessionId),
          sql`json_extract(${sessionMessagesTable.content}, '$.message.id') = ${logicalMessageId}`
        )
      )
    if (rows.length > 0) {
      const now = new Date().toISOString()
      for (const row of rows) {
        const content = this.deserializeSessionMessage(row).content as Record<string, any>
        const tombstoned = {
          ...content,
          message: { ...(content?.message ?? {}), visibility: 'hidden', deletedAt: now, tombstone: true }
        }
        await database
          .update(sessionMessagesTable)
          .set({ content: JSON.stringify(tombstoned), updated_at: now })
          .where(eq(sessionMessagesTable.id, row.id))
      }
    }
    if (canonicalDeleted || rows.length > 0) return true

    // Compatibility for callers still passing the legacy integer row id. Keep
    // the row for downgrade/fallback safety and mark its payload invisible.
    const numericId = typeof messageId === 'number' ? messageId : Number(messageId)
    if (!Number.isInteger(numericId)) return false
    const [row] = await database
      .select()
      .from(sessionMessagesTable)
      .where(and(eq(sessionMessagesTable.id, numericId), eq(sessionMessagesTable.session_id, sessionId)))
      .limit(1)
    if (!row) return false
    const content = this.deserializeSessionMessage(row).content as Record<string, any>
    const now = new Date().toISOString()
    const tombstoned = {
      ...content,
      message: { ...(content?.message ?? {}), visibility: 'hidden', deletedAt: now, tombstone: true }
    }
    await database
      .update(sessionMessagesTable)
      .set({ content: JSON.stringify(tombstoned), updated_at: now })
      .where(and(eq(sessionMessagesTable.id, numericId), eq(sessionMessagesTable.session_id, sessionId)))
    const canonicalId = String(content?.message?.id ?? '').trim()
    if (canonicalId) await agentTranscriptRepository.tombstoneMessage(sessionId, canonicalId)
    return true
  }

  async createSessionMessage(
    session: GetAgentSessionResponse,
    messageData: CreateSessionMessageRequest,
    abortController: AbortController,
    options?: CreateMessageOptions
  ): Promise<SessionStreamResult> {
    if (workspaceActivity.renaming) throw new Error('工作空间正在重命名，请稍后重试')
    workspaceActivity.runs++
    try {
      const result = await this.startSessionMessageStream(session, messageData, abortController, options)
      void Promise.allSettled([result.streamFinished, result.completion]).then(
        () => { workspaceActivity.runs-- })
      return result
    } catch (error) {
      workspaceActivity.runs--
      throw error
    }
  }

  private async startSessionMessageStream(
    session: GetAgentSessionResponse,
    req: CreateSessionMessageRequest,
    abortController: AbortController,
    options?: CreateMessageOptions
  ): Promise<SessionStreamResult> {
    const agentSessionId = await this.getLastAgentSessionId(session.id)
    const accumulator = new TextStreamAccumulator()
    const invocationIds = options?.invocationIds ?? allocateAgentInvocationIds()
    const headlessAssistantMsgId = invocationIds.assistantMessageId
    const headlessUserMsgId = invocationIds.userMessageId
    const createdAtIso = SessionMessageService.toIsoCreatedAt(req.createdAt, new Date().toISOString())
    const canonicalPartIds = {
      userText: `part_${randomUUID()}`,
      assistantText: `part_${randomUUID()}`,
      assistantReasoning: `part_${randomUUID()}`,
      assistantTools: new Map<string, string>()
    }

    await this.persistCanonicalTurnStart({
      session,
      invocationIds,
      userContent: options?.displayContent ?? req.content,
      modelId: req.model,
      createdAtIso,
      userTextPartId: canonicalPartIds.userText,
      images: options?.images
    })

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

    let claudeStream: AgentStream
    try {
      claudeStream = await claudeCodeService.invoke(
        req.content,
        session,
        abortController,
        agentSessionId,
        {
          effort: req.effort,
          thinking: req.thinking
        },
        req.model,
        options?.images,
        invocationIds
      )
    } catch (error) {
      const serialized = serializeError(error)
      await this.finalizeCanonicalAssistant({
        sessionId: session.id,
        invocationIds,
        modelId: req.model,
        blocks: [],
        createdAtIso,
        status: 'failed',
        partIds: canonicalPartIds,
        error: serialized
      })
      const turn = await agentTurnRepository.getById(invocationIds.turnId)
      if (turn?.status === 'running') {
        await agentTurnRepository.update(invocationIds.turnId, {
          status: 'failed',
          completedAt: new Date().toISOString()
        })
      }
      throw error
    }

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
    // mid-stream keeps the partial reply. Canonical persistence owns this for
    // every main-path request; legacy UI persistence remains opt-in.
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
          await this.checkpointCanonicalAssistant({
            sessionId: session.id,
            invocationIds,
            modelId: req.model,
            blocks: snapshotBlocks,
            usage: accumulator.getUsage(),
            createdAtIso,
            status: 'streaming',
            partIds: canonicalPartIds
          })
          if (options?.persist) {
            await this.persistHeadlessAssistantSnapshot(
              session,
              claudeStream.sdkSessionId || agentSessionId,
              headlessAssistantMsgId,
              req.model,
              snapshotBlocks,
              accumulator.getUsage(),
              req.createdAt
            )
          }
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

    streamingPersistTimer = setInterval(() => {
      void persistStreamingSnapshot()
    }, HEADLESS_STREAMING_PERSIST_INTERVAL_MS)

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
                await streamingPersistChain.catch(() => undefined)
                await this.finalizeCanonicalAssistantSafely({
                  sessionId: session.id,
                  invocationIds,
                  modelId: req.model,
                  blocks: accumulator.getAssistantBlocks(headlessAssistantMsgId, req.model),
                  usage: accumulator.getUsage(),
                  createdAtIso,
                  status: 'failed',
                  partIds: canonicalPartIds,
                  error: serializeError(streamError)
                })
                controller.error(streamError)
                rejectCompletion(serializeError(streamError))
                break
              }

              case 'complete': {
                resolveStreamFinished()
                cleanup()
                controller.close()
                const assistantBlocks = accumulator.getAssistantBlocks(headlessAssistantMsgId, req.model)
                await streamingPersistChain.catch(() => undefined)
                await this.finalizeCanonicalAssistantSafely({
                  sessionId: session.id,
                  invocationIds,
                  modelId: req.model,
                  blocks: assistantBlocks,
                  usage: accumulator.getUsage(),
                  createdAtIso,
                  status: 'completed',
                  partIds: canonicalPartIds,
                  finish: { reason: 'complete' }
                })
                if (options?.persist) {
                  // Read SDK session_id from the stream object (set by ClaudeCodeService on init)
                  const resolvedSessionId = claudeStream.sdkSessionId || agentSessionId
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
                const resolvedSessionId = claudeStream.sdkSessionId || agentSessionId
                const assistantBlocks = accumulator.getAssistantBlocks(headlessAssistantMsgId, req.model)
                const usage = accumulator.getUsage()
                await streamingPersistChain.catch(() => undefined)
                await this.finalizeCanonicalAssistantSafely({
                  sessionId: session.id,
                  invocationIds,
                  modelId: req.model,
                  blocks: assistantBlocks,
                  usage,
                  createdAtIso,
                  status: 'cancelled',
                  partIds: canonicalPartIds,
                  finish: { reason: 'cancelled' }
                })
                if (options?.persist && (assistantBlocks.length > 0 || usage)) {
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
        const assistantBlocks = accumulator.getAssistantBlocks(headlessAssistantMsgId, req.model)
        cleanup()
        abortController.abort(typeof reason === 'string' ? reason : 'stream cancelled')
        void streamingPersistChain
          .then(() =>
            this.finalizeCanonicalAssistant({
              sessionId: session.id,
              invocationIds,
              modelId: req.model,
              blocks: assistantBlocks,
              usage: accumulator.getUsage(),
              createdAtIso,
              status: 'cancelled',
              partIds: canonicalPartIds,
              finish: { reason: 'cancelled' }
            })
          )
          .catch((error) => {
            logger.error('Failed to finalize canonical assistant after stream cancellation', error as Error)
          })
          .finally(() => resolveCompletion({}))
      }
    })

    return { stream, streamFinished, completion }
  }

  private async persistCanonicalTurnStart(params: {
    session: GetAgentSessionResponse
    invocationIds: AgentInvocationIds
    userContent: string
    modelId?: string
    createdAtIso: string
    userTextPartId: string
    images?: Array<{ data: string; media_type: string }>
  }): Promise<void> {
    const { session, invocationIds, userContent, modelId, createdAtIso, userTextPartId, images } = params
    await agentTranscriptRepository.upsertMessages([
      {
        id: invocationIds.userMessageId,
        sessionId: session.id,
        turnId: invocationIds.turnId,
        role: 'user',
        status: 'completed',
        semantics: { origin: 'real_user', uiVisibility: 'visible', providerVisibility: 'visible' },
        createdAt: createdAtIso,
        completedAt: createdAtIso
      },
      {
        id: invocationIds.assistantMessageId,
        sessionId: session.id,
        turnId: invocationIds.turnId,
        parentMessageId: invocationIds.userMessageId,
        role: 'assistant',
        status: 'streaming',
        semantics: { origin: 'agent_runtime', uiVisibility: 'visible', providerVisibility: 'visible' },
        provider: { modelId, requestId: invocationIds.traceId },
        createdAt: createdAtIso
      }
    ])
    await agentTranscriptRepository.upsertParts([
      {
        id: userTextPartId,
        sessionId: session.id,
        messageId: invocationIds.userMessageId,
        type: 'text',
        data: { text: userContent },
        createdAt: createdAtIso
      },
      ...(images ?? []).map((image, index) => ({
        id: `part_${invocationIds.userMessageId}_image_${index}`,
        sessionId: session.id,
        messageId: invocationIds.userMessageId,
        type: 'image',
        data: { mediaType: image.media_type, data: image.data },
        createdAt: createdAtIso
      }))
    ])
  }

  private canonicalAssistantParts(params: {
    sessionId: string
    messageId: string
    blocks: HeadlessPersistedBlock[]
    partIds: {
      assistantText: string
      assistantReasoning: string
      assistantTools: Map<string, string>
    }
    createdAtIso: string
  }) {
    const { sessionId, messageId, blocks, partIds, createdAtIso } = params
    const text = blocks
      .filter((block) => block.type === 'main_text')
      .map((block) => String(block.content ?? ''))
      .join('')
    const reasoning = blocks
      .filter((block) => block.type === 'thinking')
      .map((block) => String(block.content ?? ''))
      .join('\n\n')
    const parts: Array<{
      id: string
      sessionId: string
      messageId: string
      type: string
      data: Record<string, unknown>
      createdAt: string
    }> = []
    if (reasoning) {
      parts.push({
        id: partIds.assistantReasoning,
        sessionId,
        messageId,
        type: 'reasoning',
        data: { text: reasoning, status: 'streaming' },
        createdAt: createdAtIso
      })
    }
    if (text) {
      parts.push({
        id: partIds.assistantText,
        sessionId,
        messageId,
        type: 'text',
        data: { text, status: 'streaming' },
        createdAt: createdAtIso
      })
    }
    for (const block of blocks.filter((candidate) => candidate.type === 'tool')) {
      const toolCallId = String(block.toolId || block.id)
      let partId = partIds.assistantTools.get(toolCallId)
      if (!partId) {
        partId = `part_${randomUUID()}`
        partIds.assistantTools.set(toolCallId, partId)
      }
      parts.push({
        id: partId,
        sessionId,
        messageId,
        type: 'tool',
        data: { ...block, id: undefined, messageId: undefined },
        createdAt: createdAtIso
      })
    }
    return parts
  }

  private canonicalUsage(usage?: PersistedUsage): Record<string, number> | undefined {
    if (!usage) return undefined
    return {
      inputTokens: usage.prompt_tokens,
      outputTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
      cacheReadTokens: Number(usage.cache_read_input_tokens ?? 0),
      cacheWriteTokens: Number(usage.cache_creation_input_tokens ?? 0)
    }
  }

  private async checkpointCanonicalAssistant(params: {
    sessionId: string
    invocationIds: AgentInvocationIds
    modelId?: string
    blocks: HeadlessPersistedBlock[]
    usage?: PersistedUsage
    createdAtIso: string
    status: 'streaming' | 'completed' | 'cancelled' | 'failed'
    partIds: {
      assistantText: string
      assistantReasoning: string
      assistantTools: Map<string, string>
    }
    error?: { message: string; name?: string; stack?: string }
    finish?: { reason: string }
  }): Promise<void> {
    const now = new Date().toISOString()
    await agentTranscriptRepository.upsertMessage({
      id: params.invocationIds.assistantMessageId,
      sessionId: params.sessionId,
      turnId: params.invocationIds.turnId,
      parentMessageId: params.invocationIds.userMessageId,
      role: 'assistant',
      status: params.status,
      semantics: { origin: 'agent_runtime', uiVisibility: 'visible', providerVisibility: 'visible' },
      provider: { modelId: params.modelId, requestId: params.invocationIds.traceId },
      usage: this.canonicalUsage(params.usage),
      error: params.error,
      finish: params.finish,
      createdAt: params.createdAtIso,
      completedAt: params.status === 'streaming' ? undefined : now,
      updatedAt: now
    })
    const parts = this.canonicalAssistantParts({
      sessionId: params.sessionId,
      messageId: params.invocationIds.assistantMessageId,
      blocks: params.blocks,
      partIds: params.partIds,
      createdAtIso: params.createdAtIso
    }).map((part) => ({
      ...part,
      data: { ...part.data, status: params.status === 'streaming' ? 'streaming' : params.status }
    }))
    if (parts.length > 0) await agentTranscriptRepository.upsertParts(parts)
  }

  private async finalizeCanonicalAssistant(
    params: Parameters<SessionMessageService['checkpointCanonicalAssistant']>[0]
  ): Promise<void> {
    await this.checkpointCanonicalAssistant(params)
  }

  /**
   * Terminal persistence best effort: a database hiccup (e.g. transient
   * SQLITE_BUSY) must never turn a completed or user-cancelled stream into a
   * stream error for the UI. The last checkpoint stays durable and the
   * deferred maintenance/retry paths reconcile the record later.
   */
  private async finalizeCanonicalAssistantSafely(
    params: Parameters<SessionMessageService['checkpointCanonicalAssistant']>[0]
  ): Promise<void> {
    try {
      await this.finalizeCanonicalAssistant(params)
    } catch (error) {
      logger.error('Failed to finalize canonical assistant state', {
        sessionId: params.sessionId,
        assistantMessageId: params.invocationIds.assistantMessageId,
        status: params.status,
        error: error instanceof Error ? error.message : String(error)
      })
    }
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
