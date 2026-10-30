import { describe, expect, it, vi } from 'vitest'
import { createToolCallbacks } from '../../../services/messageStreaming/callbacks/toolCallbacks'
vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ warn: vi.fn(), error: vi.fn() }) } }))
vi.mock('@renderer/store/toolPermissions', async (importOriginal) => ({
  ...await importOriginal<any>(),
  selectUniqueActivePermissionByToolName: () => undefined,
  toolPermissionsActions: { removeByToolCallId: (payload: unknown) => ({ type: 'remove', payload }) }
}))
vi.mock('@renderer/utils/messageUtils/create', () => ({
  createToolBlock: (messageId: string, id: string, rest: object) => ({ id: `block-${id}`, messageId, ...rest }),
  createCitationBlock: vi.fn(), createErrorBlock: vi.fn()
}))
describe('tool callback terminal lifecycle', () => {
  it.each(['done', 'error', 'cancelled'])('recovers missing mapping and preserves %s against late starts', (status) => {
    const entities: Record<string, any> = {}
    const manager = {
      hasInitialPlaceholder: false,
      handleBlockTransition: vi.fn((block) => { entities[block.id] = block }),
      smartBlockUpdate: vi.fn((id, changes) => { entities[id] = { ...entities[id], ...changes } })
    }
    const callbacks = createToolCallbacks({ blockManager: manager as any, assistantMsgId: 'assistant', userMessageId: 'user', dispatch: vi.fn(), getState: () => ({ messageBlocks: { entities }, toolPermissions: { requests: {}, resolvedInputs: {} } }) })
    const response = { id: 'bash', toolCallId: 'bash', tool: { name: 'Bash' }, arguments: {}, status, response: { content: [] } } as any
    callbacks.onToolCallComplete(response)
    callbacks.onToolCallPending({ ...response, status: 'pending' })
    callbacks.onToolArgumentStreaming({ ...response, status: 'streaming' })
    callbacks.onToolCallComplete({ ...response, status: 'error' })
    expect(manager.handleBlockTransition).toHaveBeenCalledTimes(1)
    expect(manager.smartBlockUpdate).toHaveBeenCalledTimes(1)
    expect(entities['block-bash'].metadata.rawMcpToolResponse.status).toBe(status)
  })
})

 it('recovers an existing card after callback-local mapping loss without duplicating it', () => {
  const response = { id: 'recover', toolCallId: 'recover', tool: { name: 'Bash' }, arguments: {}, status: 'pending' } as any
  const entities: Record<string, any> = { old: { id: 'old', messageId: 'assistant', metadata: { rawMcpToolResponse: response } } }
  const manager = { hasInitialPlaceholder: false, handleBlockTransition: vi.fn(), smartBlockUpdate: vi.fn((id, changes) => { entities[id] = { ...entities[id], ...changes } }) }
  const callbacks = createToolCallbacks({ blockManager: manager as any, assistantMsgId: 'assistant', userMessageId: 'user', dispatch: vi.fn(), getState: () => ({ messageBlocks: { entities }, toolPermissions: { requests: {}, resolvedInputs: {} } }) })
  callbacks.onToolCallComplete({ ...response, status: 'done', response: { content: [] } })
  callbacks.onToolCallPending(response)
  expect(manager.handleBlockTransition).not.toHaveBeenCalled()
  expect(manager.smartBlockUpdate).toHaveBeenCalledTimes(1)
  expect(entities.old.metadata.rawMcpToolResponse.status).toBe('done')
 })

const questionInput = { questions: [{ header: '方向', question: '选择哪种方向？', options: [{ label: 'A', description: '方向 A' }], multiSelect: false }] }
import { resolveToolArguments } from '@shared/parseToolArguments'
import { parseAskUserQuestionToolInput } from '../../../pages/home/Messages/Tools/MessageAgentTools/types'

it('does not let empty args mask usable partial questions', () => {
  const resolved = resolveToolArguments({}, JSON.stringify(questionInput))
  expect(parseAskUserQuestionToolInput(resolved)?.questions).toEqual(questionInput.questions)
})

it.each(['error', 'cancelled'])('retains request-only questions after %s and request removal', (status) => {
  const entities: Record<string, any> = {}
  const permissions = { requests: { request: { requestId: 'request', toolName: 'AskUserQuestion', toolCallId: 'ask', status: 'pending', input: questionInput } }, resolvedInputs: {} } as any
  const manager = { hasInitialPlaceholder: false,
    handleBlockTransition: vi.fn((block) => { entities[block.id] = block }),
    smartBlockUpdate: vi.fn((id, changes) => { entities[id] = { ...entities[id], ...changes } }) }
  const callbacks = createToolCallbacks({ blockManager: manager as any, assistantMsgId: 'assistant', userMessageId: 'user',
    dispatch: () => { permissions.requests = {} }, getState: () => ({ messageBlocks: { entities }, toolPermissions: permissions }) })
  callbacks.onToolCallComplete({ id: 'ask', tool: { name: 'AskUserQuestion' }, arguments: {}, status } as any)
  const saved = entities['block-ask'].metadata.rawMcpToolResponse
  expect(permissions.requests).toEqual({})
  expect(parseAskUserQuestionToolInput(saved.arguments)?.questions).toEqual(questionInput.questions)
  expect(saved.partialArguments).toBeUndefined()
})

it('writes request-only questions into streaming tool messages and keeps them on empty updates', () => {
  const entities: Record<string, any> = {}
  const permissions = { requests: { request: { requestId: 'request', toolName: 'AskUserQuestion', toolCallId: 'ask', status: 'pending', input: questionInput } }, resolvedInputs: {} } as any
  const manager = { hasInitialPlaceholder: false,
    handleBlockTransition: vi.fn((block) => { entities[block.id] = block }),
    smartBlockUpdate: vi.fn((id, changes) => { entities[id] = { ...entities[id], ...changes } }) }
  const callbacks = createToolCallbacks({ blockManager: manager as any, assistantMsgId: 'assistant', userMessageId: 'user', dispatch: vi.fn(),
    getState: () => ({ messageBlocks: { entities }, toolPermissions: permissions }) })
  const response = { id: 'ask', tool: { name: 'AskUserQuestion' }, arguments: {}, status: 'streaming' } as any
  callbacks.onToolArgumentStreaming(response)
  permissions.requests = {}
  callbacks.onToolArgumentStreaming(response)
  expect(entities['block-ask'].metadata.rawMcpToolResponse.arguments).toEqual(questionInput)
})

it('ignores malformed question args in favor of valid partials', () => {
  expect(resolveToolArguments({ questions: [{ question: 'incomplete' }] }, JSON.stringify(questionInput))).toEqual(questionInput)
})
