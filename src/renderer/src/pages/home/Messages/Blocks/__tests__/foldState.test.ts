import { describe, expect, it } from 'vitest'

import type { Message, MessageBlock } from '@renderer/types/newMessage'
import { AssistantMessageStatus, MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'

import { hasAbnormalTermination } from '../foldState'

const buildMessage = (overrides: Partial<Message> = {}): Message => ({
  id: 'msg-1',
  role: 'assistant',
  assistantId: 'assistant-1',
  topicId: 'topic-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  status: AssistantMessageStatus.SUCCESS,
  blocks: [],
  ...overrides
})

const buildBlock = (overrides: Record<string, unknown> = {}): MessageBlock =>
  ({
    id: 'block-1',
    messageId: 'msg-1',
    type: MessageBlockType.MAIN_TEXT,
    status: MessageBlockStatus.SUCCESS,
    createdAt: '2026-01-01T00:00:00.000Z',
    content: 'hello',
    ...overrides
  }) as MessageBlock

describe('hasAbnormalTermination', () => {
  it('normal completed message is not abnormal', () => {
    expect(hasAbnormalTermination(buildMessage(), [buildBlock()])).toBe(false)
  })

  it('processing message is not abnormal (fold is suppressed elsewhere)', () => {
    expect(hasAbnormalTermination(buildMessage({ status: AssistantMessageStatus.PROCESSING }), [])).toBe(false)
  })

  it('error message status (失败/异常中断) is abnormal', () => {
    expect(hasAbnormalTermination(buildMessage({ status: AssistantMessageStatus.ERROR }), [])).toBe(true)
  })

  it('paused message status (用户主动中断的 agent 会话) is abnormal', () => {
    expect(hasAbnormalTermination(buildMessage({ status: AssistantMessageStatus.PAUSED }), [])).toBe(true)
  })

  it('aborted flag on success message (普通聊天被中止) is abnormal', () => {
    expect(hasAbnormalTermination(buildMessage({ aborted: true } as Partial<Message> as Message), [])).toBe(true)
  })

  it('error-type block (回答中途失败) is abnormal', () => {
    expect(hasAbnormalTermination(buildMessage(), [buildBlock({ type: MessageBlockType.ERROR })])).toBe(true)
  })

  it('paused block status (停止时流式中的块) is abnormal', () => {
    expect(hasAbnormalTermination(buildMessage(), [buildBlock({ status: MessageBlockStatus.PAUSED })])).toBe(true)
  })

  it('tool block that failed mid-run must NOT count as abnormal', () => {
    // 工具中途失败但 agent 继续执行并正常收尾，是合法的「已完成」折叠场景
    const toolBlock = buildBlock({ type: MessageBlockType.TOOL, status: MessageBlockStatus.ERROR })
    expect(hasAbnormalTermination(buildMessage(), [toolBlock])).toBe(false)
  })
})
