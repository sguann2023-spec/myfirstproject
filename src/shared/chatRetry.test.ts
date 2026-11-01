import { describe, expect, it, vi } from 'vitest'

import { sendChatRetry } from './chatRetry'

describe('chat retry follow-up', () => {
  it('sends a continuation for the selected response without replacing history or replaying request options', async () => {
    const messages = Object.freeze([
      Object.freeze({ id: 'user-1', role: 'user', content: '制作对赌协议视频', imageAttachments: [{ data: 'image' }], aiVideoRequest: { model: 'test' } }),
      Object.freeze({ id: 'assistant-1', role: 'assistant', content: '已完成部分内容', blocks: [{ type: 'tool', status: 'completed' }], error: { message: '400' } }),
      Object.freeze({ id: 'user-2', role: 'user', content: '另一项任务' }),
      Object.freeze({ id: 'assistant-2', role: 'assistant', content: '' })
    ])
    const snapshot = structuredClone(messages)
    const send = vi.fn().mockResolvedValue(undefined)
    await sendChatRetry(messages, 'assistant-1', send)
    expect(send).toHaveBeenCalledExactlyOnceWith('继续，我之前的任务是：\n制作对赌协议视频')
    expect(messages).toEqual(snapshot)
  })

  it('keeps repeated retries from nesting task reminders', async () => {
    const send = vi.fn()
    await sendChatRetry([
      { id: 'user', role: 'user', content: '继续，我之前的任务是：\n制作视频' },
      { id: 'assistant', role: 'assistant' }
    ], 'assistant', send)
    expect(send).toHaveBeenCalledExactlyOnceWith('继续，我之前的任务是：\n制作视频')
  })

  it.each([
    [],
    [{ id: 'assistant', role: 'assistant' }],
    [{ id: 'user', role: 'user', content: '  ' }, { id: 'assistant', role: 'assistant' }],
    [{ id: 'user', role: 'user', content: 'task' }, { id: 'other', role: 'assistant' }]
  ])('does not send when the selected response or task is missing: %j', async messages => {
    const send = vi.fn()
    await sendChatRetry(messages, 'assistant', send)
    expect(send).not.toHaveBeenCalled()
  })
})
