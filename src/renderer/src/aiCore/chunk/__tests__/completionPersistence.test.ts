import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createBaseCallbacks } from '../../../services/messageStreaming/callbacks/baseCallbacks'
import { AssistantMessageStatus, MessageBlockStatus, MessageBlockType } from '../../../types/newMessage'
import { hasAbnormalTermination } from '../../../pages/home/Messages/Blocks/foldState'

const { emitMock, errorMock } = vi.hoisted(() => ({ emitMock: vi.fn(), errorMock: vi.fn() }))
vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ error: errorMock, debug: vi.fn() }) } }))
vi.mock('@renderer/hooks/useTopic', () => ({ autoRenameTopic: vi.fn() }))
vi.mock('@renderer/i18n', () => ({ default: { t: (key: string) => key } }))
vi.mock('@renderer/services/EventService', () => ({ EVENT_NAMES: { MESSAGE_COMPLETE: 'MESSAGE_COMPLETE' }, EventEmitter: { emit: emitMock } }))
vi.mock('@renderer/services/NotificationService', () => ({ NotificationService: { getInstance: () => ({ send: vi.fn() }) } }))
vi.mock('@renderer/services/TokenService', () => ({ estimateMessagesUsage: vi.fn() }))
vi.mock('@renderer/store/messageBlock', () => ({ isTodoWriteBlock: () => false, updateOneBlock: vi.fn() }))
vi.mock('@renderer/store/newMessage', () => ({ selectMessagesForTopic: () => [], newMessagesActions: { updateMessage: (payload: unknown) => ({ type: 'update', payload }) } }))
vi.mock('@renderer/store/toolPermissions', () => ({ selectPendingPermission: vi.fn(), toolPermissionsActions: { clearPending: () => ({ type: 'clearPending' }) } }))
vi.mock('@renderer/utils', () => ({ uuid: () => 'id' }))
vi.mock('@renderer/utils/agentSession', () => ({ isAgentSessionTopicId: () => false }))
vi.mock('@renderer/utils/analytics', () => ({ trackTokenUsage: vi.fn() }))
vi.mock('@renderer/utils/error', () => ({ isAbortError: (error: Error) => error.name === 'AbortError', isTimeoutError: () => false, serializeError: (error: Error) => ({ message: error.message }) }))
vi.mock('@renderer/utils/messageUtils/create', () => ({ createBaseMessageBlock: vi.fn(), createErrorBlock: vi.fn(), createMainTextBlock: vi.fn() }))
vi.mock('@renderer/utils/messageUtils/find', () => ({ findAllBlocks: (message: any) => message.blocks, getMainTextContent: () => 'answer' }))
vi.mock('@renderer/utils/window', () => ({ isFocused: () => true, isOnHomePage: () => true }))

describe('interrupted completion', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each(['between tools', 'streaming text', 'before first block'])('persists pause and ignores finish %s, including while pause persistence is pending', async (phase) => {
    const block = { id: 'text', type: phase === 'between tools' ? MessageBlockType.TOOL : MessageBlockType.MAIN_TEXT, content: 'partial', status: phase === 'streaming text' ? MessageBlockStatus.STREAMING : MessageBlockStatus.SUCCESS }
    const message = { id: 'assistant', status: AssistantMessageStatus.PROCESSING, blocks: phase === 'before first block' ? [] : [block] }
    let finishSave!: () => void
    const saveUpdatesToDB = vi.fn((..._args: any[]) => new Promise<void>((resolve) => { finishSave = resolve }))
    const dispatch = vi.fn((action: any) => {
      if (action.type === 'update') Object.assign(message, action.payload.updates)
    })
    const blockManager = {
      lastBlockType: MessageBlockType.MAIN_TEXT,
      smartBlockUpdate: vi.fn((_id: string, changes: any) => Object.assign(block, changes)),
      handleBlockTransition: vi.fn()
    }
    const callbacks = createBaseCallbacks({
      blockManager: blockManager as any, dispatch,
      getState: () => ({ messages: { entities: { assistant: message } }, messageBlocks: { entities: { text: block } } }),
      topicId: 'topic', assistantMsgId: 'assistant', saveUpdatesToDB, assistant: {} as any
    })

    const paused = callbacks.onError(new DOMException('Stopped', 'AbortError') as any)
    await callbacks.onComplete(AssistantMessageStatus.SUCCESS)
    expect(message.status).toBe(AssistantMessageStatus.PAUSED)
    expect(saveUpdatesToDB).toHaveBeenCalledTimes(1)
    expect(saveUpdatesToDB.mock.calls[0][2]).toMatchObject({ status: AssistantMessageStatus.PAUSED })
    expect(blockManager.handleBlockTransition).not.toHaveBeenCalled()
    expect(block.status).not.toBe(MessageBlockStatus.ERROR)
    expect(blockManager.smartBlockUpdate.mock.calls.every((call) => call[1].status !== MessageBlockStatus.SUCCESS)).toBe(true)

    finishSave()
    await paused
    await callbacks.onComplete(AssistantMessageStatus.SUCCESS)
    expect(message.status).toBe(AssistantMessageStatus.PAUSED)
    expect(saveUpdatesToDB).toHaveBeenCalledTimes(1)
    expect(emitMock).toHaveBeenCalledTimes(1)
    expect(emitMock).toHaveBeenCalledWith('MESSAGE_COMPLETE', expect.objectContaining({ status: 'pause' }))
    // Reloading with only completed historical blocks must still keep the process expanded.
    const reloaded = { ...message, ...saveUpdatesToDB.mock.calls[0][2] }
    expect(hasAbnormalTermination(reloaded as any, [{ ...block, status: MessageBlockStatus.SUCCESS }] as any)).toBe(true)
  })
})

describe('completion persistence boundary', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each(['success', 'failure'])('emits completion without waiting for a DB %s', async (outcome) => {
    let resolve!: () => void
    let reject!: (error: Error) => void
    const pendingWrite = new Promise<void>((res, rej) => { resolve = res; reject = rej })
    const saveUpdatesToDB = vi.fn(() => pendingWrite)
    const block = { id: 'text', type: MessageBlockType.MAIN_TEXT, content: 'answer' }
    const message = { id: 'assistant', blocks: [block] }
    const dispatch = vi.fn()
    const callbacks = createBaseCallbacks({
      blockManager: { smartBlockUpdate: vi.fn(), lastBlockType: MessageBlockType.MAIN_TEXT } as any,
      dispatch,
      getState: () => ({ messages: { entities: { assistant: message } }, messageBlocks: { entities: { text: block } } }),
      topicId: 'topic',
      assistantMsgId: 'assistant',
      saveUpdatesToDB,
      assistant: { id: 'agent', model: { provider: 'openai' } } as any
    })

    await callbacks.onComplete(AssistantMessageStatus.SUCCESS)
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ updates: expect.objectContaining({ status: AssistantMessageStatus.SUCCESS }) }) }))
    expect(emitMock).toHaveBeenCalledWith('MESSAGE_COMPLETE', { id: 'assistant', topicId: 'topic', status: AssistantMessageStatus.SUCCESS })
    expect(saveUpdatesToDB).toHaveBeenCalledTimes(1)
    expect(errorMock).not.toHaveBeenCalled()

    if (outcome === 'success') resolve()
    else reject(new Error('write failed'))
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(errorMock).toHaveBeenCalledTimes(outcome === 'success' ? 0 : 1)
    expect(emitMock).toHaveBeenCalledTimes(1)
  })
})

const telemetry = (revision = 1, runtimeSessionId = 'runtime-a') => ({
  version: 1 as const,
  requests: [{ id: 'request-a', revision, runtimeSessionId, invocationId: 'invocation-a', sequence: 0,
    modelId: 'model', providerId: 'provider', operation: 'reply', status: 'prepared' as const,
    startedAt: 1, attempts: 1, input: { categories: { user: 10 }, total: 10, status: 'estimated' as const, method: 'test' } }]
})

it.each(['complete', 'error', 'abort'])('keeps telemetry-only updates and revision upserts through %s persistence', async terminal => {
  const block = { id: 'text', type: MessageBlockType.MAIN_TEXT, content: 'answer', status: MessageBlockStatus.SUCCESS }
  const message: any = { id: 'assistant', blocks: [block], usage: { total_tokens: 42 } }
  const saveUpdatesToDB = vi.fn()
  const callbacks = createBaseCallbacks({
    blockManager: { smartBlockUpdate: vi.fn(), lastBlockType: MessageBlockType.MAIN_TEXT, handleBlockTransition: vi.fn() } as any,
    dispatch: (action: any) => { if (action.type === 'update') Object.assign(message, action.payload.updates) },
    getState: () => ({ messages: { entities: { assistant: message } }, messageBlocks: { entities: { text: block } } }),
    topicId: 'topic', assistantMsgId: 'assistant', saveUpdatesToDB, assistant: {} as any
  })
  callbacks.onLLMResponseInProgress({ tokenTelemetry: telemetry(1) })
  callbacks.onLLMResponseInProgress({ tokenTelemetry: telemetry(2) })
  callbacks.onLLMResponseInProgress({ tokenTelemetry: telemetry(1) })
  expect(message.tokenTelemetry.requests).toHaveLength(1)
  expect(message.tokenTelemetry.requests[0].revision).toBe(2)
  expect(message.usage).toEqual({ total_tokens: 42 })
  if (terminal === 'complete') await callbacks.onComplete(AssistantMessageStatus.SUCCESS)
  else await callbacks.onError((terminal === 'abort' ? new DOMException('Stopped', 'AbortError') : new Error('failed')) as any)
  expect(saveUpdatesToDB.mock.calls[0][2].tokenTelemetry).toEqual(telemetry(2))
})
