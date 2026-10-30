import { expect, it, vi } from 'vitest'
vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) } }))
vi.mock('@renderer/hooks/useTopic', () => ({ autoRenameTopic: vi.fn() }))
vi.mock('@renderer/i18n', () => ({ default: { t: (s: string) => s } }))
vi.mock('@renderer/services/EventService', () => ({ EVENT_NAMES: {}, EventEmitter: { emit: vi.fn() } }))
vi.mock('@renderer/services/NotificationService', () => ({ NotificationService: { getInstance: () => ({ send: vi.fn() }) } }))
vi.mock('@renderer/services/TokenService', () => ({ estimateMessagesUsage: vi.fn() }))
vi.mock('@renderer/store/messageBlock', () => ({ isTodoWriteBlock: () => false, updateOneBlock: (payload: unknown) => ({ type: 'block', payload }) }))
vi.mock('@renderer/store/newMessage', () => ({ selectMessagesForTopic: () => [], newMessagesActions: { updateMessage: (payload: unknown) => ({ type: 'message', payload }) } }))
vi.mock('@renderer/utils', () => ({ uuid: () => 'id' }))
vi.mock('@renderer/utils/agentSession', () => ({ isAgentSessionTopicId: () => false }))
vi.mock('@renderer/utils/analytics', () => ({ trackTokenUsage: vi.fn() }))
vi.mock('@renderer/utils/error', () => ({ isAbortError: (e: Error) => e.name === 'AbortError', isTimeoutError: () => false, serializeError: (e: Error) => ({ message: e.message }) }))
vi.mock('@renderer/utils/messageUtils/create', () => ({ createErrorBlock: () => ({ id: 'error' }), createBaseMessageBlock: vi.fn(), createMainTextBlock: vi.fn() }))
vi.mock('@renderer/utils/messageUtils/find', () => ({ findAllBlocks: () => [{ id: 'ask' }], getMainTextContent: () => '' }))
vi.mock('@renderer/utils/window', () => ({ isFocused: () => true, isOnHomePage: () => true }))
import { createBaseCallbacks } from '../../../services/messageStreaming/callbacks/baseCallbacks'
import { MessageBlockType, MessageBlockStatus } from '../../../types/newMessage'
import { toolPermissionsActions, default as permissionReducer } from '../../../store/toolPermissions'
import { parseAskUserQuestionToolInput } from '../../../pages/home/Messages/Tools/MessageAgentTools/types'

it('exception and active abort keep identical question summaries after clearPending and persistence', async () => {
  const summaries: unknown[] = []
  for (const abort of [false, true]) {
    const input = { questions: [{ header: '方向', question: '请选择方向', options: [], multiSelect: false }] }
    const state: any = { messages: { entities: { assistant: {} } }, messageBlocks: { entities: {
      ask: { id: 'ask', type: MessageBlockType.TOOL, status: MessageBlockStatus.PENDING,
        metadata: { rawMcpToolResponse: { id: 'call', tool: { name: 'AskUserQuestion' }, arguments: {}, status: 'pending' } } }
    } }, toolPermissions: { requests: { request: { requestId: 'request', toolCallId: 'call', toolName: 'AskUserQuestion', status: 'pending', input } }, resolvedInputs: {} } }
    const save = vi.fn()
    const callbacks = createBaseCallbacks({ assistantMsgId: 'assistant', topicId: 'topic', assistant: {} as any,
      blockManager: { smartBlockUpdate: vi.fn(), handleBlockTransition: vi.fn() } as any,
      getState: () => state, saveUpdatesToDB: save,
      dispatch: (action: any) => {
        if (action.type === 'block') Object.assign(state.messageBlocks.entities[action.payload.id], action.payload.changes)
        if (action.type === toolPermissionsActions.clearPending.type) state.toolPermissions = permissionReducer(state.toolPermissions, action)
      } })
    const error = new Error('stream ended')
    if (abort) error.name = 'AbortError'
    await callbacks.onError(error as any)
    expect(state.toolPermissions.requests).toEqual({})
    const savedBlock = save.mock.calls[0][3].find((b: any) => b.id === 'ask')
    const questions = parseAskUserQuestionToolInput(savedBlock.metadata.rawMcpToolResponse.arguments)?.questions
    expect(questions).toEqual(input.questions)
    summaries.push(questions?.map(({ header, question }) => ({ header, question })))
  }
  expect(summaries[0]).toEqual(summaries[1])
})
