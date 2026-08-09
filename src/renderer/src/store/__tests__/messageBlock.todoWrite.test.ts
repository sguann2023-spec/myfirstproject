import { describe, expect, it } from 'vitest'

import { selectActiveTodoInfo } from '../messageBlock'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'

describe('selectActiveTodoInfo', () => {
  it('falls back to messages linked by agentSessionId when topic uses agent-session prefix', () => {
    const todoBlockId = 'todo-block-1'
    const homeTopicId = 'home-chat-chat-1'
    const sessionTopicId = 'agent-session:session-123'

    const state = {
      messages: {
        entities: {
          'assistant-1': {
            id: 'assistant-1',
            topicId: homeTopicId,
            agentSessionId: 'session-123',
            blocks: [todoBlockId]
          }
        },
        messageIdsByTopic: {
          [homeTopicId]: ['assistant-1']
        }
      },
      messageBlocks: {
        entities: {
          [todoBlockId]: {
            id: todoBlockId,
            messageId: 'assistant-1',
            type: MessageBlockType.TOOL,
            status: MessageBlockStatus.SUCCESS,
            metadata: {
              rawMcpToolResponse: {
                tool: { name: 'TodoWrite' },
                arguments: {
                  todos: [
                    { content: 'Task 1', status: 'completed', activeForm: 'Completing task 1' },
                    { content: 'Task 2', status: 'in_progress', activeForm: 'Completing task 2' }
                  ]
                }
              }
            }
          }
        }
      }
    } as any

    const result = selectActiveTodoInfo(state, sessionTopicId)

    expect(result).toBeDefined()
    expect(result?.totalCount).toBe(2)
    expect(result?.completedCount).toBe(1)
    expect(result?.activeTodo?.content).toBe('Task 2')
    expect(result?.blockIdsByMessage['assistant-1']).toEqual([todoBlockId])
  })
})
