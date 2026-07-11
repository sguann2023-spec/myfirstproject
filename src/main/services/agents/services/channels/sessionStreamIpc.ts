import { modelsService } from '@main/apiServer/services/models'
import { loggerService } from '@logger'
import { getDataPath } from '@main/utils'
import { IpcChannel } from '@shared/IpcChannel'
import { sql } from 'drizzle-orm'
import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { windowService } from '../../../WindowService'
import { agentsTable } from '../../database/schema'
import { sessionService } from '../SessionService'
import { CHERRY_CLAW_AGENT_ID } from '../builtin/BuiltinAgentIds'
import { sessionStreamBus, type SessionStreamChunk } from './SessionStreamBus'

const activeSubscriptions = new Map<string, () => void>()
const activeAbortControllers = new Map<string, { controller: AbortController; requestId: string }>()
let sessionStreamIpcRegistered = false
let sessionMessageServicePromise: Promise<import('../SessionMessageService').SessionMessageService | null> | null = null
let channelMessageHandlerPromise: Promise<import('./ChannelMessageHandler').ChannelMessageHandler | null> | null = null
let agentServicePromise: Promise<import('../AgentService').AgentService | null> | null = null
const providerModelIdCache = new Map<string, string>()
const logger = loggerService.withContext('SessionStreamIpc')
const DEFAULT_RUNTIME_AGENT_ID = CHERRY_CLAW_AGENT_ID

function getDefaultAgentWorkspacePath(agentId: string): string {
  return path.join(getDataPath(), 'Agents', agentId)
}

async function getSessionMessageService() {
  if (!sessionMessageServicePromise) {
    sessionMessageServicePromise = import('../SessionMessageService')
      .then((mod) => {
        if (!mod?.sessionMessageService) {
          throw new Error('SessionMessageService export not found')
        }
        return mod.sessionMessageService
      })
  }
  return await sessionMessageServicePromise
}

async function getChannelMessageHandler() {
  if (!channelMessageHandlerPromise) {
    channelMessageHandlerPromise = import('./ChannelMessageHandler')
      .then((mod) => mod.channelMessageHandler)
      .catch(() => null)
  }
  return await channelMessageHandlerPromise
}

async function getAgentService() {
  if (!agentServicePromise) {
    agentServicePromise = import('../AgentService')
      .then((mod) => mod.agentService)
      .catch(() => null)
  }
  return await agentServicePromise
}

async function normalizeProviderModelId(model: unknown): Promise<string> {
  const startedAt = Date.now()
  const raw = String(model || '').trim()
  if (!raw) return ''
  if (raw.includes(':')) {
    logger.info('[SessionStreamIpc][ModelNormalize] already normalized', {
      raw,
      elapsedMs: Date.now() - startedAt
    })
    return raw
  }

  const cached = providerModelIdCache.get(raw)
  if (cached) {
    logger.info('[SessionStreamIpc][ModelNormalize] cache hit', {
      raw,
      normalized: cached,
      cacheSize: providerModelIdCache.size,
      elapsedMs: Date.now() - startedAt
    })
    return cached
  }

  try {
    const listed = await modelsService.getModels({})
    const rows = Array.isArray(listed?.data) ? listed.data : []
    const sample = rows.slice(0, 5).map((item: any) => ({
      id: String(item?.id || '').trim(),
      provider_model_id: String(item?.provider_model_id || '').trim(),
      provider: String(item?.provider || '').trim()
    }))
    const hit = rows.find((item: any) => {
      const id = String(item?.id || '').trim()
      if (!id) return false
      return id === raw || id.endsWith(`:${raw}`)
    })
    const normalized = String(hit?.id || '').trim()
    if (normalized.includes(':')) {
      providerModelIdCache.set(raw, normalized)
      logger.info('[SessionStreamIpc][ModelNormalize] normalized', {
        raw,
        normalized,
        rowsCount: rows.length,
        sample,
        elapsedMs: Date.now() - startedAt
      })
      return normalized
    }
    logger.warn('[SessionStreamIpc][ModelNormalize] unable to normalize model', {
      raw,
      rowsCount: rows.length,
      sample,
      elapsedMs: Date.now() - startedAt
    })
  } catch (error) {
    logger.error('[SessionStreamIpc][ModelNormalize] getModels failed', error as Error, {
      raw,
      elapsedMs: Date.now() - startedAt
    })
  }

  return ''
}

async function ensureDefaultAgentExists(modelHint?: string): Promise<boolean> {
  const agentService = await getAgentService()
  if (!agentService) return false

  const workspacePath = getDefaultAgentWorkspacePath(DEFAULT_RUNTIME_AGENT_ID)
  try {
    fs.mkdirSync(workspacePath, { recursive: true })
  } catch {
    // best effort, DB write below still proceeds
  }

  const existing = await agentService.getAgent(DEFAULT_RUNTIME_AGENT_ID)
  if (existing) {
    const hasPath = Array.isArray((existing as any).accessible_paths) && (existing as any).accessible_paths.length > 0
    const normalizedHintModel = await normalizeProviderModelId(String(modelHint || '').trim())
    const existingModel = String((existing as any).model || '').trim()
    const shouldBackfillModel = !existingModel && !!normalizedHintModel

    if (!hasPath || shouldBackfillModel) {
      try {
        const database = await (agentService as any).getDatabase()
        const updatePayload: Record<string, unknown> = {
          updated_at: new Date().toISOString()
        }
        if (!hasPath) {
          updatePayload.accessible_paths = JSON.stringify([workspacePath])
        }
        if (shouldBackfillModel) {
          updatePayload.model = normalizedHintModel
        }
        await database
          .update(agentsTable)
          .set(updatePayload)
          .where(sql`${agentsTable.id} = ${DEFAULT_RUNTIME_AGENT_ID}`)
      } catch {
        // ignore race / transient DB issues
      }
    }
    return true
  }

  let modelId = await normalizeProviderModelId(modelHint)
  if (!modelId) {
    const preferred = await modelsService.getModels({ providerType: 'anthropic', limit: 1 })
    modelId = String(preferred?.data?.[0]?.id || '').trim()
  }
  if (!modelId) {
    const fallback = await modelsService.getModels({ limit: 1 })
    modelId = String(fallback?.data?.[0]?.id || '').trim()
  }
  if (!modelId) return false

  const now = new Date().toISOString()

  try {
    const database = await (agentService as any).getDatabase()
    await database.transaction(async (tx: any) => {
      await tx.update(agentsTable).set({ sort_order: sql`${agentsTable.sort_order} + 1` })
      await tx.insert(agentsTable).values({
        id: DEFAULT_RUNTIME_AGENT_ID,
        type: 'claude-code',
        name: 'Default Agent',
        description: 'Default agent for chat runtime',
        instructions: 'You are a helpful assistant.',
        model: modelId,
        accessible_paths: JSON.stringify([workspacePath]),
        configuration: JSON.stringify({
          permission_mode: 'bypassPermissions',
          max_turns: 100,
          soul_enabled: true,
          env_vars: {}
        }),
        sort_order: 0,
        created_at: now,
        updated_at: now
      })
    })
  } catch {
    // ignore duplicate/parallel insert races
  }

  return Boolean(await agentService.getAgent(DEFAULT_RUNTIME_AGENT_ID))
}

const LegacyChannels = Object.freeze({
  SessionCreate: 'agent:session:create',
  SessionGet: 'agent:session:get',
  SessionList: 'agent:session:list',
  SessionMessageCreate: 'agent:session:message:create',
  SessionMessageList: 'agent:session:message:list',
  SessionAbort: 'agent:session:abort'
})

const CherryChannels = Object.freeze({
  SessionCreate: IpcChannel.CherryChatStream_SessionCreate,
  SessionGet: IpcChannel.CherryChatStream_SessionGet,
  SessionUpdate: IpcChannel.CherryChatStream_SessionUpdate,
  SessionList: IpcChannel.CherryChatStream_SessionList,
  SessionMessageCreate: IpcChannel.CherryChatStream_MessageCreate,
  SessionMessageList: IpcChannel.CherryChatStream_MessageList,
  SessionAbort: IpcChannel.CherryChatStream_Abort,
  SessionStreamSubscribe: IpcChannel.CherryChatStream_Subscribe,
  SessionStreamUnsubscribe: IpcChannel.CherryChatStream_Unsubscribe,
  SessionStreamChunk: IpcChannel.CherryChatStream_Chunk
})

function buildSubscriptionKey(channel: string, sessionId: string): string {
  return `${channel}::${sessionId}`
}

async function resolveSessionById(sessionId: string, preferredAgentId?: string) {
  const candidateAgentId = String(preferredAgentId || '').trim()
  if (candidateAgentId) {
    const direct = await sessionService.getSession(candidateAgentId, sessionId)
    if (direct) return direct
  }
  const listed = await sessionService.listSessions(undefined, { limit: 2000 })
  const matched = listed.sessions.find((item) => item.id === sessionId)
  if (!matched) return null
  return await sessionService.getSession(matched.agent_id, sessionId)
}

export function registerSessionStreamIpc(): void {
  if (sessionStreamIpcRegistered) {
    logger.info('[SessionStreamIpc] Skip duplicate IPC registration')
    return
  }

  const registerStreamSubscribeHandler = (subscribeChannel: string, chunkChannel: string) => {
    ipcMain.handle(subscribeChannel, (_event, { sessionId }: { sessionId: string }) => {
      const key = buildSubscriptionKey(subscribeChannel, sessionId)
      if (activeSubscriptions.has(key)) return { success: true }

      const unsubscribe = sessionStreamBus.subscribe(sessionId, (chunk: SessionStreamChunk) => {
        const mainWindow = windowService.getMainWindow()
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(chunkChannel, chunk)
        }
      })

      activeSubscriptions.set(key, unsubscribe)
      logger.info('[SessionStreamIpc] Registered stream subscription', {
        sessionId,
        subscribeChannel,
        chunkChannel,
        hasSubscribers: sessionStreamBus.hasSubscribers(sessionId),
        subscriberCount: sessionStreamBus.subscriberCount(sessionId)
      })
      return { success: true }
    })
  }

  const registerStreamUnsubscribeHandler = (subscribeChannel: string, unsubscribeChannel: string) => {
    ipcMain.handle(unsubscribeChannel, (_event, { sessionId }: { sessionId: string }) => {
      const key = buildSubscriptionKey(subscribeChannel, sessionId)
      const unsub = activeSubscriptions.get(key)
      if (unsub) {
        unsub()
        activeSubscriptions.delete(key)
        logger.info('[SessionStreamIpc] Unregistered stream subscription', {
          sessionId,
          subscribeChannel,
          unsubscribeChannel,
          hasSubscribers: sessionStreamBus.hasSubscribers(sessionId),
          subscriberCount: sessionStreamBus.subscriberCount(sessionId)
        })
      }
      return { success: true }
    })
  }

  const registerAbortHandler = (abortChannel: string) => {
    ipcMain.handle(abortChannel, async (_event, { sessionId }: { sessionId: string }) => {
      const activeRequest = activeAbortControllers.get(sessionId)
      if (activeRequest) {
        logger.info('[SessionStreamIpc] Abort requested for active stream', {
          sessionId,
          requestId: activeRequest.requestId,
          hasSubscribers: sessionStreamBus.hasSubscribers(sessionId),
          subscriberCount: sessionStreamBus.subscriberCount(sessionId)
        })
        activeRequest.controller.abort()
        activeAbortControllers.delete(sessionId)
        sessionStreamBus.publish(sessionId, {
          sessionId,
          agentId: '',
          requestId: activeRequest.requestId,
          type: 'cancelled',
          error: { message: 'Request aborted by user', code: 'ABORTED' }
        })
        return { success: true }
      }
      const handler = await getChannelMessageHandler()
      const aborted = handler ? handler.abortSession(sessionId) : false
      return { success: aborted }
    })
  }

  registerStreamSubscribeHandler(IpcChannel.AgentSessionStream_Subscribe, IpcChannel.AgentSessionStream_Chunk)
  registerStreamUnsubscribeHandler(IpcChannel.AgentSessionStream_Subscribe, IpcChannel.AgentSessionStream_Unsubscribe)
  registerAbortHandler(IpcChannel.AgentSessionStream_Abort)

  registerStreamSubscribeHandler(CherryChannels.SessionStreamSubscribe, CherryChannels.SessionStreamChunk)
  registerStreamUnsubscribeHandler(CherryChannels.SessionStreamSubscribe, CherryChannels.SessionStreamUnsubscribe)
  registerAbortHandler(CherryChannels.SessionAbort)

  ipcMain.handle(LegacyChannels.SessionAbort, async (_event, { sessionId }: { sessionId: string }) => {
    const handler = await getChannelMessageHandler()
    return { success: handler ? handler.abortSession(sessionId) : false }
  })

  const handleSessionGet = async (_event: unknown, payload: any = {}) => {
    try {
      const sessionId = String(payload?.sessionId || '').trim()
      if (!sessionId) return { ok: false, error: 'sessionId is required' }
      const session = await resolveSessionById(sessionId, payload?.agent_id)
      if (!session) return { ok: false, error: 'session not found' }
      return { ok: true, session }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  const handleSessionUpdate = async (_event: unknown, payload: any = {}) => {
    try {
      const sessionId = String(payload?.sessionId || payload?.id || '').trim()
      if (!sessionId) return { ok: false, error: 'sessionId is required' }
      const existing = await resolveSessionById(sessionId, payload?.agent_id)
      if (!existing) return { ok: false, error: 'session not found' }

      const { sessionId: _sessionId, id: _id, ...updates } = payload || {}
      if (existing.agent_id === DEFAULT_RUNTIME_AGENT_ID) {
        const ensured = await ensureDefaultAgentExists(String(updates?.model || '').trim())
        if (!ensured) return { ok: false, error: 'Agent not found' }
      }
      const session = await sessionService.updateSession(existing.agent_id, sessionId, updates)
      if (!session) return { ok: false, error: 'session not found' }
      broadcastSessionChanged(existing.agent_id, sessionId, true)
      return { ok: true, session }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  const handleSessionList = async (_event: unknown, payload: any = {}) => {
    try {
      const agentId = String(payload?.agent_id || '').trim() || undefined
      const { sessions, total } = await sessionService.listSessions(agentId)
      return { ok: true, sessions, total }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error), sessions: [] }
    }
  }

  const handleSessionMessageList = async (_event: unknown, payload: any = {}) => {
    try {
      const sessionId = String(payload?.sessionId || '').trim()
      if (!sessionId) return { ok: false, error: 'sessionId is required', messages: [] }
      const sessionMessageService = await getSessionMessageService()
      const { messages } = await sessionMessageService.listSessionMessages(sessionId)
      return { ok: true, messages }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error), messages: [] }
    }
  }

  const handleSessionMessageCreate = async (_event: unknown, payload: any = {}) => {
    try {
      const sessionId = String(payload?.sessionId || '').trim()
      const content = String(payload?.content || '').trim()
      const requestId = String(payload?.requestId || '').trim() || randomUUID()
      const images = Array.isArray(payload?.images)
        ? payload.images.filter(
            (item: unknown): item is { data: string; media_type: string } =>
              !!item &&
              typeof item === 'object' &&
              typeof (item as { data?: unknown }).data === 'string' &&
              typeof (item as { media_type?: unknown }).media_type === 'string'
          )
        : undefined
      if (!sessionId) return { ok: false, error: 'sessionId is required' }
      if (!content) return { ok: false, error: 'content is required' }

      let session = await resolveSessionById(sessionId, payload?.agent_id)
      if (!session) return { ok: false, error: 'session not found' }
      const sessionMessageService = await getSessionMessageService()
      const rawModel = String(payload?.model || '').trim()
      if (session.agent_id === DEFAULT_RUNTIME_AGENT_ID) {
        const ensured = await ensureDefaultAgentExists(rawModel)
        if (!ensured) return { ok: false, error: 'Agent not found' }
      }
      const normalizedModel = await normalizeProviderModelId(rawModel)
      const effectiveModel = normalizedModel || rawModel
      logger.info('[SessionStreamIpc] SessionMessageCreate model resolved', {
        sessionId,
        rawModel,
        normalizedModel,
        effectiveModel,
        imageCount: images?.length ?? 0
      })
      if (effectiveModel && effectiveModel !== String(session.model || '').trim()) {
        const updatedSession = await sessionService.updateSession(session.agent_id, sessionId, {
          model: effectiveModel
        })
        if (updatedSession) {
          session = updatedSession
        }
      }

      const abortController = new AbortController()
      activeAbortControllers.set(sessionId, { controller: abortController, requestId })
      sessionStreamBus.publish(sessionId, {
        sessionId,
        agentId: session.agent_id,
        requestId,
        type: 'started'
      })
      const streamStartedAt = Date.now()
      const { stream, streamFinished, completion } = await sessionMessageService.createSessionMessage(
        session,
        { content, model: effectiveModel || undefined, effort: payload?.effort, thinking: payload?.thinking },
        abortController,
        { persist: true, displayContent: content, images }
      )
      logger.info('[SessionStreamIpc][TRACE] createSessionMessage resolved', {
        sessionId,
        elapsedMs: Date.now() - streamStartedAt
      })
      void streamFinished.then(() => {
        logger.info('[SessionStreamIpc] Publishing stream-finished event to session stream bus', {
          sessionId,
          requestId,
          hasSubscribers: sessionStreamBus.hasSubscribers(sessionId),
          subscriberCount: sessionStreamBus.subscriberCount(sessionId)
        })
        sessionStreamBus.publish(sessionId, {
          sessionId,
          agentId: session.agent_id,
          requestId,
          type: 'stream-finished'
        })
      })

      void (async () => {
        try {
          const reader = stream.getReader()
          let chunkCount = 0
          let firstChunkLogged = false
          const firstChunkWarnTimer = setTimeout(() => {
            if (firstChunkLogged) return
            logger.warn('[SessionStreamIpc][TRACE] waiting too long for first chunk', {
              sessionId,
              requestId,
              waitMs: Date.now() - streamStartedAt,
              hasSubscribers: sessionStreamBus.hasSubscribers(sessionId),
              subscriberCount: sessionStreamBus.subscriberCount(sessionId)
            })
          }, 8000)
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            chunkCount += 1
            if (!firstChunkLogged) {
              firstChunkLogged = true
              clearTimeout(firstChunkWarnTimer)
              logger.info('[SessionStreamIpc][TRACE] first chunk received', {
                sessionId,
                requestId,
                elapsedMs: Date.now() - streamStartedAt,
                chunkType: (value as any)?.type || '',
                hasSubscribers: sessionStreamBus.hasSubscribers(sessionId),
                subscriberCount: sessionStreamBus.subscriberCount(sessionId)
              })
            }
            sessionStreamBus.publish(sessionId, {
              sessionId,
              agentId: session.agent_id,
              requestId,
              type: 'chunk',
              chunk: value
            })
          }
          clearTimeout(firstChunkWarnTimer)
          logger.info('[SessionStreamIpc][TRACE] reader loop completed', {
            sessionId,
            requestId,
            chunkCount,
            elapsedMs: Date.now() - streamStartedAt
          })
          const completionResult = await completion
          const persistedAssistantBlocks = Array.isArray(
            (completionResult?.assistantMessage as any)?.content?.blocks
          )
            ? ((completionResult?.assistantMessage as any).content.blocks as unknown[])
            : []
          logger.info('[SessionStreamIpc] Headless completion persisted', {
            sessionId,
            requestId,
            userMessageId: completionResult?.userMessage?.id,
            assistantMessageId: completionResult?.assistantMessage?.id,
            persistedAssistantBlockCount: persistedAssistantBlocks.length
          })
          logger.info('[SessionStreamIpc] Publishing complete event to session stream bus', {
            sessionId,
            requestId,
            hasSubscribers: sessionStreamBus.hasSubscribers(sessionId),
            subscriberCount: sessionStreamBus.subscriberCount(sessionId)
          })
          // Persist runs in main process for this IPC route, so force renderer
          // to reload from DB to pick up non-text blocks (e.g. tool blocks).
          broadcastSessionChanged(session.agent_id, sessionId, true)
          sessionStreamBus.publish(sessionId, {
            sessionId,
            agentId: session.agent_id,
            requestId,
            type: 'complete'
          })
        } catch (error) {
          sessionStreamBus.publish(sessionId, {
            sessionId,
            agentId: session.agent_id,
            requestId,
            type: 'error',
            error: { message: error instanceof Error ? error.message : String(error) }
          })
        } finally {
          const activeRequest = activeAbortControllers.get(sessionId)
          if (activeRequest?.requestId === requestId) {
            activeAbortControllers.delete(sessionId)
          }
        }
      })()

      return { ok: true, requestId }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  const handleSessionCreate = async (_event: unknown, payload: any = {}) => {
    try {
      const agentId = String(payload?.agent_id || DEFAULT_RUNTIME_AGENT_ID).trim() || DEFAULT_RUNTIME_AGENT_ID
      const { agent_id, ...req } = payload || {}
      const normalizedReq: any = { ...req }
      const rawModel = String(normalizedReq?.model || '').trim()
      const normalizedModel = await normalizeProviderModelId(rawModel)
      const effectiveModel = normalizedModel || rawModel
      if (effectiveModel) {
        normalizedReq.model = effectiveModel
      } else {
        delete normalizedReq.model
      }

      if (!Array.isArray(normalizedReq.accessible_paths)) {
        normalizedReq.accessible_paths = []
      }

      if (agentId === DEFAULT_RUNTIME_AGENT_ID) {
        const ensured = await ensureDefaultAgentExists(normalizedReq.model)
        if (!ensured) {
          return { ok: false, error: 'Agent not found' }
        }
      }

      const session = await sessionService.createSession(agentId, normalizedReq)
      return { ok: true, session }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  ipcMain.handle(LegacyChannels.SessionCreate, handleSessionCreate)
  ipcMain.handle(LegacyChannels.SessionGet, handleSessionGet)
  ipcMain.handle(LegacyChannels.SessionList, handleSessionList)
  ipcMain.handle(LegacyChannels.SessionMessageList, handleSessionMessageList)
  ipcMain.handle(LegacyChannels.SessionMessageCreate, handleSessionMessageCreate)

  ipcMain.handle(CherryChannels.SessionCreate, handleSessionCreate)
  ipcMain.handle(CherryChannels.SessionGet, handleSessionGet)
  ipcMain.handle(CherryChannels.SessionUpdate, handleSessionUpdate)
  ipcMain.handle(CherryChannels.SessionList, handleSessionList)
  ipcMain.handle(CherryChannels.SessionMessageList, handleSessionMessageList)
  ipcMain.handle(CherryChannels.SessionMessageCreate, handleSessionMessageCreate)

  sessionStreamIpcRegistered = true
  logger.info('[SessionStreamIpc] IPC registration completed')
}

export function broadcastSessionChanged(agentId: string, sessionId: string, headless?: boolean): void {
  const mainWindow = windowService.getMainWindow()
  if (mainWindow && !mainWindow.isDestroyed()) {
    logger.info('[SessionStreamIpc] Broadcasting AgentSession_Changed', {
      agentId,
      sessionId,
      headless: !!headless
    })
    mainWindow.webContents.send(IpcChannel.AgentSession_Changed, { agentId, sessionId, headless: !!headless })
  } else {
    logger.warn('[SessionStreamIpc] Skipped AgentSession_Changed broadcast: main window unavailable', {
      agentId,
      sessionId,
      headless: !!headless
    })
  }
}
