import { describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ warn: vi.fn(), error: vi.fn() }) } }))
vi.mock('@renderer/types', () => ({ WEB_SEARCH_SOURCE: { WEBSEARCH: 'websearch' } }))
vi.mock('@renderer/store/toolPermissions', () => ({
  selectUniqueActivePermissionByToolName: vi.fn(),
  toolPermissionsActions: { removeByToolCallId: vi.fn() }
}))
vi.mock('@renderer/utils/messageUtils/create', () => ({
  createErrorBlock: (messageId: string, error: unknown, props: unknown) => ({ messageId, error, ...props as object }),
  createToolBlock: vi.fn(), createCitationBlock: vi.fn()
}))

import { createToolCallbacks } from '@renderer/services/messageStreaming/callbacks/toolCallbacks'
import { MessageBlockType } from '@renderer/types/newMessage'
import { classifyError } from '@renderer/utils/errorClassifier'

const detail = 'Insufficient remaining points (剩余点数不足)，剩余点数: 63.96，所需点数: 1060.0'

describe('tool billing recovery', () => {
  it.each([
    ['error', true, `Error: Digital human task failed: ${detail}`, true],
    ['done', false, JSON.stringify({ status: 'failed', message: detail }), true],
    ['done', false, JSON.stringify({ status: 'interrupted', message: detail }), true],
    ['done', true, detail, true],
    ['done', false, JSON.stringify({ status: 'running', message: detail }), false],
    ['error', true, 'network unavailable', false],
    ['error', true, 'insufficient_quota', false]
  ])('handles %s / %s / %s', (status, isError, text, expected) => {
    const blockManager = {
      hasInitialPlaceholder: true, initialPlaceholderBlockId: 'tool-block',
      smartBlockUpdate: vi.fn(), handleBlockTransition: vi.fn()
    }
    const callbacks = createToolCallbacks({
      blockManager: blockManager as any, assistantMsgId: 'assistant', userMessageId: 'user',
      dispatch: vi.fn(), getState: () => ({ messageBlocks: { entities: {} } })
    })
    const tool = { id: 'call', tool: { name: 'get_digital_human_job' }, arguments: {}, status: 'pending' }
    callbacks.onToolCallPending(tool as any)
    callbacks.onToolCallComplete({ ...tool, status, response: { isError, content: [{ type: 'text', text }] } } as any)
    expect(blockManager.handleBlockTransition).toHaveBeenCalledTimes(expected ? 1 : 0)
    if (expected) {
      const [block, type] = blockManager.handleBlockTransition.mock.calls[0]
      expect(type).toBe(MessageBlockType.ERROR)
      expect(block.error.message).toContain(detail)
      expect(classifyError(block.error).category).toBe('quota')
    }
  })
})
