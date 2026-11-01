import { describe, expect, it } from 'vitest'

import { createChannelEventStream } from './channelStream'

describe('channel stream terminal accounting', () => {
  it.each([new Error('400 status code (no body)'), new DOMException('Stopped', 'AbortError')])(
    'delivers queued usage and completed tool results before the terminal error: %s', async error => {
      const channel = createChannelEventStream()
      const usage = { type: 'finish-step', usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 } } as any
      const tool = { type: 'tool-result', toolCallId: 'read-1', output: { billing: { consume: 20 } } } as any
      channel.pushChunk(usage)
      channel.pushChunk(tool)
      channel.error(error)
      channel.complete()
      channel.error(new Error('late error'))
      channel.pushChunk(usage)
      const reader = channel.stream.getReader()
      expect((await reader.read()).value).toBe(usage)
      expect((await reader.read()).value).toBe(tool)
      expect((await reader.read()).value).toEqual({ type: 'error', error })
      expect((await reader.read()).done).toBe(true)
    }
  )

  it('preserves two distinct steps with identical token counts', async () => {
    const channel = createChannelEventStream()
    const step = { type: 'finish-step', usage: { inputTokens: 100, outputTokens: 50 } } as any
    channel.pushChunk(step)
    channel.pushChunk({ ...step })
    channel.complete()
    channel.complete()
    const reader = channel.stream.getReader()
    expect((await reader.read()).value).toEqual(step)
    expect((await reader.read()).value).toEqual(step)
    expect((await reader.read()).done).toBe(true)
  })
})
