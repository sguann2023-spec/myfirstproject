import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createBaseCallbacks } from '../../../services/messageStreaming/callbacks/baseCallbacks'
import { AssistantMessageStatus, MessageBlockType } from '../../../types/newMessage'

const { emitMock, errorMock } = vi.hoisted(() => ({ emitMock: vi.fn(), errorMock: vi.fn() }))
vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ error: errorMock, debug: vi.fn() }) } }))
vi.mock('@renderer/hooks/useTopic', () => ({ autoRenameTopic: vi.fn() }))
vi.mock('@renderer/i18n', () => ({ default: { t: (key: string) => key } }))
vi.mock('@renderer/services/EventService', () => ({ EVENT_NAMES: { MESSAGE_COMPLETE: 'MESSAGE_COMPLETE' }, EventEmitter: { emit: emitMock } }))
vi.mock('@renderer/services/NotificationService', () => ({ NotificationService: { getInstance: () => ({ send: vi.fn() }) } }))
vi.mock('@renderer/services/TokenService', () => ({ estimateMessagesUsage: vi.fn() }))
vi.mock('@renderer/store/messageBlock', () => ({ isTodoWriteBlock: () => false, updateOneBlock: vi.fn() }))
vi.mock('@renderer/store/newMessage', () => ({ selectMessagesForTopic: () => [], newMessagesActions: { updateMessage: (payload: unknown) => ({ type: 'update', payload }) } }))
vi.mock('@renderer/store/toolPermissions', () => ({ selectPendingPermission: vi.fn(), toolPermissionsActions: {} }))
vi.mock('@renderer/utils', () => ({ uuid: () => 'id' }))
vi.mock('@renderer/utils/agentSession', () => ({ isAgentSessionTopicId: () => false }))
vi.mock('@renderer/utils/analytics', () => ({ trackTokenUsage: vi.fn() }))
vi.mock('@renderer/utils/error', () => ({ isAbortError: vi.fn(), isTimeoutError: vi.fn(), serializeError: vi.fn() }))
vi.mock('@renderer/utils/messageUtils/create', () => ({ createBaseMessageBlock: vi.fn(), createErrorBlock: vi.fn(), createMainTextBlock: vi.fn() }))
vi.mock('@renderer/utils/messageUtils/find', () => ({ findAllBlocks: (message: any) => message.blocks, getMainTextContent: () => 'answer' }))
vi.mock('@renderer/utils/window', () => ({ isFocused: () => true, isOnHomePage: () => true }))

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
