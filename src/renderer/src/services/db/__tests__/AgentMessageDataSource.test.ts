import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { IpcChannel } from '@shared/IpcChannel'
import type { Message, MessageBlock } from '../../../types/newMessage'
import { AssistantMessageStatus, UserMessageStatus } from '../../../types/newMessage'
import { AgentMessageDataSource } from '../AgentMessageDataSource'

const { invoke, state } = vi.hoisted(() => ({
  invoke: vi.fn(),
  state: { messages: { entities: {} as Record<string, Message> } }
}))
vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) } }))
vi.mock('@renderer/store', () => ({ default: { getState: () => state } }))

let sequence = 0
let source: AgentMessageDataSource
let message: Message
let block: MessageBlock
const topicId = 'agent-session:session-1'

beforeEach(() => {
  invoke.mockReset().mockResolvedValue([])
  vi.stubGlobal('window', { electron: { ipcRenderer: { invoke } } })
  source = new AgentMessageDataSource()
  const id = `assistant-${++sequence}`
  message = { id, topicId, role: 'assistant', status: AssistantMessageStatus.PROCESSING, agentSessionId: 'runtime-1' } as Message
  block = { id: `block-${sequence}`, messageId: id, type: 'main_text', content: '' } as MessageBlock
  state.messages.entities = { [id]: message }
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('AgentMessageDataSource turn persistence', () => {
  it.each([AssistantMessageStatus.SUCCESS, AssistantMessageStatus.PAUSED, AssistantMessageStatus.ERROR])('keeps streaming changes in memory and saves the %s turn once', async (status) => {
    await source.appendMessage(topicId, message, [block])
    for (let index = 1; index <= 1000; index++) {
      await source.updateMessageAndBlocks(topicId, { id: message.id, status: AssistantMessageStatus.PROCESSING }, [
        { ...block, content: 'x'.repeat(index) } as MessageBlock
      ])
    }
    await source.updateMessage(topicId, message.id, { metrics: { completion_tokens: 1000 } } as Partial<Message>)
    await source.updateMessageAndBlocks(topicId, { id: message.id }, [])
    await source.updateBlocks([{ ...block, content: 'final reply' } as MessageBlock])
    expect(invoke).not.toHaveBeenCalled()

    await source.updateMessageAndBlocks(topicId, { id: message.id, status } as Partial<Message> & Pick<Message, 'id'>, [])
    expect(invoke).toHaveBeenCalledExactlyOnceWith(IpcChannel.AgentMessage_PersistExchange, expect.objectContaining({
      sessionId: 'session-1', agentSessionId: 'runtime-1',
      assistant: { payload: {
        message: expect.objectContaining({ id: message.id, status, metrics: { completion_tokens: 1000 } }),
        blocks: [expect.objectContaining({ content: 'final reply' })]
      } }
    }))
  })

  it('still saves the submitted user message immediately', async () => {
    await source.appendMessage(topicId, { ...message, role: 'user', status: UserMessageStatus.SUCCESS }, [block])
    expect(invoke).toHaveBeenCalledExactlyOnceWith(IpcChannel.AgentMessage_PersistExchange, expect.objectContaining({
      user: { payload: { message: expect.objectContaining({ role: 'user' }), blocks: [block] } }
    }))
  })

  it('finalizes a cached turn through metadata-only updates without reading history', async () => {
    await source.appendMessage(topicId, message, [block])
    await source.updateBlocks([{ ...block, content: 'complete reply' } as MessageBlock])
    await source.updateMessage(topicId, message.id, { status: AssistantMessageStatus.SUCCESS })
    expect(invoke).toHaveBeenCalledExactlyOnceWith(IpcChannel.AgentMessage_PersistExchange, expect.objectContaining({
      assistant: { payload: {
        message: expect.objectContaining({ status: 'success' }),
        blocks: [expect.objectContaining({ content: 'complete reply' })]
      } }
    }))
  })

  it('retains the final reply when a tool waits longer than five minutes', async () => {
    vi.useFakeTimers()
    await source.appendMessage(topicId, message, [{ ...block, content: 'reply before long tool' } as MessageBlock])
    vi.advanceTimersByTime(6 * 60 * 1000)
    await source.updateMessageAndBlocks(topicId, { id: message.id, status: AssistantMessageStatus.SUCCESS }, [])
    expect(invoke).toHaveBeenCalledExactlyOnceWith(IpcChannel.AgentMessage_PersistExchange, expect.objectContaining({
      assistant: { payload: {
        message: expect.objectContaining({ status: 'success' }),
        blocks: [expect.objectContaining({ content: 'reply before long tool' })]
      } }
    }))
  })
})
