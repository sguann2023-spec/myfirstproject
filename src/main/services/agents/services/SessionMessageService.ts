import { readMessageProjection } from '../database/messageEventStore'
import type { SessionMessageRow } from '../database/schema'
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
import { OrderedTaskQueue } from '../database/orderedTaskQueue'
import type { AgentInvocationIds, AgentStream, AgentStreamEvent } from '../interfaces/AgentStreamInterface'
import { agentMessageRepository } from '../database/sessionMessageRepository'
import { allocateAgentInvocationIds } from './agent-invocation-ids'
import ClaudeCodeService from './claudecode'
import { TextStreamAccumulator, type HeadlessPersistedBlock } from './session-stream-accumulator'

const claudeCodeService = new ClaudeCodeService()

const logger = loggerService.withContext('SessionMessageService')

type SessionStreamResult = {
  stream: ReadableStream<TextStreamPart<Record<string, any>>>
  streamFinished: Promise<void>
  runtimeFinished?: Promise<void>
  /** Optional history notification; never part of the message lifecycle. */
  historyPersisted?: Promise<{
    userMessage?: AgentSessionMessageEntity
    assistantMessage?: AgentSessionMessageEntity
  }>
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
    const rows = (await readMessageProjection<SessionMessageRow>(database, 'session_messages', sessionId))
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id)
    const result = options.limit === undefined ? rows : rows.slice(options.offset ?? 0, (options.offset ?? 0) + options.limit)

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
    // A queued lazy migration may have inserted the canonical copy after the
    // initial tombstone lookup. Hide the source first, then close that window.
    if (rows.length > 0 && !canonicalDeleted) await agentTranscriptRepository.tombstoneMessage(sessionId, logicalMessageId)
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
      void Promise.allSettled([result.streamFinished, result.completion, result.runtimeFinished]).then(
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
    const throwIfCancelled = () => {
      if (abortController.signal.aborted) throw new DOMException('Request was aborted', 'AbortError')
    }
    throwIfCancelled()
    const agentSessionId = await this.getLastAgentSessionId(session.id)
    throwIfCancelled()
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
    const persistenceQueue = new OrderedTaskQueue()
    const persistedParts = new Map<string, string>()
    let persistedUsage = ''
    let finished = false
    let readerCancelled = false
    let acceptingEvents = true

    const queuePersistence = <T>(operation: () => Promise<T>, failureMessage: string): Promise<T | undefined> =>
      persistenceQueue.run(operation).catch((error) => {
        logger.error(failureMessage, error as Error)
        return undefined
      })

    const persistStreamParts = () => {
      try {
        // Capture before enqueueing: later events may mutate nested tool inputs/results.
        const parts = structuredClone(this.canonicalAssistantParts({
          sessionId: session.id,
          messageId: headlessAssistantMsgId,
          blocks: accumulator.getAssistantBlocks(headlessAssistantMsgId, req.model),
          partIds: canonicalPartIds,
          createdAtIso
        }).map((part) => ({ ...part, data: { ...part.data, status: 'streaming' } })))
        const usage = this.canonicalUsage(accumulator.getUsage())
        void queuePersistence(async () => {
          const changed = parts.filter((part) => persistedParts.get(part.id) !== JSON.stringify(part.data))
          if (changed.length) {
            await agentTranscriptRepository.upsertParts(changed)
            for (const part of changed) persistedParts.set(part.id, JSON.stringify(part.data))
          }
          if (usage && JSON.stringify(usage) !== persistedUsage) {
            await agentTranscriptRepository.upsertMessage({
              id: headlessAssistantMsgId, sessionId: session.id, turnId: invocationIds.turnId,
              role: 'assistant', status: 'streaming', usage, createdAt: createdAtIso
            })
            persistedUsage = JSON.stringify(usage)
          }
        }, 'Failed to persist streaming assistant parts')
      } catch (error) {
        logger.error('Failed to capture streaming assistant parts', error as Error)
      }
    }

    void queuePersistence(() => this.persistCanonicalTurnStart({
      session,
      invocationIds,
      userContent: options?.displayContent ?? req.content,
      modelId: req.model,
      createdAtIso,
      userTextPartId: canonicalPartIds.userText,
      images: options?.images
    }), 'Failed to persist canonical turn at stream start')

    throwIfCancelled()
    if (options?.persist) {
      // Best-effort history writes never delay runtime dispatch or UI rendering.
      void queuePersistence(() => this.persistHeadlessUserMessage(
        session,
        options?.displayContent ?? req.content,
        agentSessionId,
        headlessUserMsgId,
        options?.images,
        options?.userMessageExtras,
        req.createdAt
      ), 'Failed to persist headless user message at stream start')
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
        invocationIds,
        {
          onQuestionReceived: (question, signal) => {
            if (finished || !acceptingEvents || signal.aborted || abortController.signal.aborted) {
              throw new DOMException('Request was aborted', 'AbortError')
            }
            const ids = [question.toolCallId, question.rawToolCallId, ...question.aliases].filter(Boolean)
            const existing = accumulator.getAssistantBlocks(headlessAssistantMsgId, req.model)
              .find((block) => block.type === 'tool' && ids.includes(block.toolId))
            const toolCallId = existing?.toolId ?? question.aliases[question.aliases.length - 1] ?? question.rawToolCallId ?? question.toolCallId
            accumulator.add({ type: 'tool-call', toolCallId, toolName: question.toolName, input: question.input } as TextStreamPart<any>)
            persistStreamParts()
          }
        }
      )
    } catch (error) {
      finished = true
      acceptingEvents = false
      const serialized = serializeError(error)
      const blocks = structuredClone(accumulator.getAssistantBlocks(headlessAssistantMsgId, req.model))
      const usage = accumulator.getUsage()
      void queuePersistence(() => this.finalizeCanonicalAssistant({
        sessionId: session.id,
        invocationIds,
        modelId: req.model,
        blocks,
        usage,
        createdAtIso,
        status: 'failed',
        partIds: canonicalPartIds,
        error: serialized
      }), 'Failed to persist invocation initialization error')
      void queuePersistence(async () => {
        const turn = await agentTurnRepository.getById(invocationIds.turnId)
        if (turn?.status === 'running') {
          await agentTurnRepository.update(invocationIds.turnId, {
            status: 'failed',
            completedAt: new Date().toISOString()
          })
        }
      }, 'Failed to finalize agent turn after initialization error')
      throw error
    }

    let resolveHistoryPersisted!: (value: {
      userMessage?: AgentSessionMessageEntity
      assistantMessage?: AgentSessionMessageEntity
    }) => void
    let resolveCompletion!: (value: {}) => void
    let resolveStreamFinished!: () => void
    let streamFinishedResolved = false

    const historyPersisted = new Promise<{
      userMessage?: AgentSessionMessageEntity
      assistantMessage?: AgentSessionMessageEntity
    }>((resolve) => {
      resolveHistoryPersisted = resolve
    })
    const completion = new Promise<{}>((resolve) => { resolveCompletion = resolve })
    const streamFinished = new Promise<void>((resolve) => {
      resolveStreamFinished = () => {
        if (streamFinishedResolved) return
        streamFinishedResolved = true
        resolve()
      }
    })

    const cleanup = () => {
      if (finished) return
      finished = true
      acceptingEvents = false
      claudeStream.removeAllListeners()
    }

    const finishPersistence = (
      status: 'completed' | 'cancelled' | 'failed',
      error?: unknown,
      persistExchange = false
    ) => {
      try {
        const assistantBlocks = structuredClone(accumulator.getAssistantBlocks(headlessAssistantMsgId, req.model))
        const usage = structuredClone(accumulator.getUsage())
        const usageSteps = structuredClone(accumulator.getUsageSteps())
        const resolvedSessionId = claudeStream.sdkSessionId || agentSessionId
        const serializedError = status === 'failed' ? serializeError(error) : undefined
        const finalized = queuePersistence(() => this.finalizeCanonicalAssistant({
          sessionId: session.id,
          invocationIds,
          modelId: req.model,
          blocks: assistantBlocks,
          usage,
          createdAtIso,
          status,
          partIds: canonicalPartIds,
          error: serializedError,
          finish: status === 'failed' ? undefined : { reason: status === 'completed' ? 'complete' : 'cancelled' }
        }), 'Failed to finalize canonical assistant state')
        if (options?.persist && persistExchange && (status === 'completed' || assistantBlocks.length > 0 || usage)) {
          void queuePersistence(() => this.persistHeadlessExchange(
            session,
            options?.displayContent ?? req.content,
            assistantBlocks,
            resolvedSessionId,
            headlessAssistantMsgId,
            options?.images,
            options?.userMessageExtras,
            req.model,
            usage,
            usageSteps,
            req.createdAt,
            status === 'cancelled',
            headlessUserMsgId
          ), 'Failed to persist headless exchange').then((result) => resolveHistoryPersisted(result ?? {}))
        } else {
          void finalized.then(() => resolveHistoryPersisted({}))
        }
      } catch (captureError) {
        logger.error('Failed to capture final assistant history', captureError as Error)
        resolveHistoryPersisted({})
      }
    }

    const stream = new ReadableStream<TextStreamPart<Record<string, any>>>({
      start: (controller) => {
        const processEvent = (event: AgentStreamEvent) => {
          if (finished || !acceptingEvents) return
          try {
            switch (event.type) {
              case 'chunk': {
                const chunk = event.chunk as TextStreamPart<Record<string, any>> | undefined
                if (!chunk) {
                  logger.warn('Received agent chunk event without chunk payload')
                  return
                }
                accumulator.add(chunk)
                if (!readerCancelled) controller.enqueue(chunk)
                persistStreamParts()
                break
              }

              case 'stream-finished': {
                resolveStreamFinished()
                break
              }

              case 'error': {
                const stderrMessage = (event as any)?.data?.stderr as string | undefined
                const streamError = event.error ?? (stderrMessage ? new Error(stderrMessage) : new Error('Stream error'))
                resolveStreamFinished()
                cleanup()
                if (!readerCancelled) controller.error(streamError)
                resolveCompletion({})
                finishPersistence('failed', streamError)
                break
              }

              case 'complete': {
                resolveStreamFinished()
                cleanup()
                if (!readerCancelled) controller.close()
                resolveCompletion({})
                finishPersistence('completed', undefined, true)
                break
              }

              case 'cancelled': {
                resolveStreamFinished()
                cleanup()
                if (!readerCancelled) controller.close()
                resolveCompletion({})
                finishPersistence('cancelled', undefined, true)
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
            resolveStreamFinished()
            abortController.abort(error)
            if (!readerCancelled) controller.error(error)
            resolveCompletion({})
            finishPersistence('failed', error)
          }
        }
        claudeStream.on('data', processEvent)
      },
      cancel: (reason: unknown) => {
        readerCancelled = true
        if (finished) return
        cleanup()
        resolveStreamFinished()
        resolveCompletion({})
        abortController.abort(typeof reason === 'string' ? reason : 'stream cancelled')
        finishPersistence('cancelled')
      }
    })

    return { stream, streamFinished, completion, historyPersisted, runtimeFinished: claudeStream.runtimeFinished }
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
        data: { ...block, id: undefined, messageId: undefined, createdAt: undefined, updatedAt: undefined },
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

  private async finalizeCanonicalAssistant(params: {
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
    // Publish terminal message status only after its content has been acknowledged.
    if (parts.length > 0) await agentTranscriptRepository.upsertParts(parts)
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

    const result = await agentMessageRepository.persistExchange({
      sessionId: session.id,
      agentSessionId,
      user: { payload: userPayload, createdAt: normalizedUserCreatedAt },
      assistant: { payload: assistantPayload, createdAt: normalizedAssistantCreatedAt }
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
