import { describe, expect, it } from 'vitest'

import {
  aggregateSessionTokenUsage,
  getMessageTokenUsage,
  mergeLiveTokenMessage,
  type TokenUsageBlock,
  type TokenUsageMessage
} from './tokenUsage'

const usage = (prompt_tokens = 100, completion_tokens = 20) => ({
  prompt_tokens, completion_tokens, total_tokens: prompt_tokens + completion_tokens
})
const assistant = (overrides: TokenUsageMessage = {}): TokenUsageMessage => ({
  id: 'assistant', role: 'assistant', status: 'success', blocks: [], ...overrides
})
const reverseTool = (accounting: unknown, id = 'reverse'): TokenUsageBlock => ({
  id, type: 'tool', toolName: 'mcp__vectcut__copylab__derive_copy_prompt',
  metadata: { rawMcpToolResponse: { responseRaw: {
    content: [{ type: 'text', text: JSON.stringify(accounting) }]
  } } }
})

describe('aggregateSessionTokenUsage', () => {
  it('counts historical assistant usage once and ignores user/system accounting', () => {
    const result = aggregateSessionTokenUsage([
      { id: 'user', role: 'user', usage: usage(9000, 9000) },
      assistant({ id: 'one', usage: usage() }),
      { id: 'system', role: 'system', usage: usage(9000, 9000) },
      assistant({ id: 'two', usage: usage(200, 40) })
    ])
    expect(result).toEqual({
      promptTokens: 300, completionTokens: 60, totalTokens: 360,
      cacheReadTokens: 0, cacheWriteTokens: 0,
      hasReportedUsage: true, incomplete: false,
      messageCount: 2, reportedMessageCount: 2, unknownMessageCount: 0
    })
  })

  it('overlays referenced live fields without appending unrelated Redux messages', () => {
    const oldModel = { id: 'old' } as NonNullable<TokenUsageMessage['model']>
    const newModel = { id: 'new' } as NonNullable<TokenUsageMessage['model']>
    const history = assistant({
      id: 'persisted', storeAssistantMessageId: ' live ', model: oldModel,
      usage: usage(1, 2), metrics: { completion_tokens: 2 },
      usageSteps: [usage(1, 2)], blocks: [reverseTool({ usage: usage(7000, 8000) })]
    })
    const live = assistant({
      id: 'live', model: newModel, usage: usage(999, 999),
      usageSteps: [usage(200, 30), usage(300, 40)],
      metrics: { completion_tokens: 800 }, blocks: [reverseTool({ usage: usage(7, 8) })]
    })
    const merged = mergeLiveTokenMessage(history, live)
    expect(merged.model).toBe(newModel)
    expect(merged.usage).toBe(live.usage)
    expect(merged.usageSteps).toBe(live.usageSteps)
    expect(merged.metrics).toBe(live.metrics)
    expect(merged.blocks).toBe(live.blocks)
    const result = aggregateSessionTokenUsage([history], {
      live, otherSession: assistant({ usage: usage(9000, 9000) })
    })
    expect(result).toMatchObject({
      promptTokens: 507, completionTokens: 78, totalTokens: 585,
      messageCount: 1, hasReportedUsage: true, incomplete: false
    })
  })

  it('keeps historical usage/steps/metrics/model/blocks when live fields have not arrived', () => {
    const history = assistant({
      usage: usage(), usageSteps: [usage(3, 4)], metrics: { completion_tokens: 50 },
      blocks: [reverseTool({ usage: usage(1, 2) })],
      model: { id: 'history' } as NonNullable<TokenUsageMessage['model']>
    })
    const live = { id: 'assistant', role: 'assistant', usageSteps: [] }
    const merged = mergeLiveTokenMessage(history, live)
    expect(merged.usage).toBe(history.usage)
    expect(merged.usageSteps).toBe(history.usageSteps)
    expect(merged.metrics).toBe(history.metrics)
    expect(merged.blocks).toBe(history.blocks)
    expect(merged.model).toBe(history.model)
    expect(aggregateSessionTokenUsage([history], { assistant: live })).toMatchObject({
      promptTokens: 4, completionTokens: 6, totalTokens: 10, incomplete: false
    })
  })

  it('deduplicates repeated snapshots and session/live aliases, even with a later bridge', () => {
    const messages = [
      assistant({ id: 'persisted', usage: usage(1, 1) }),
      assistant({ id: 'live', usage: usage(2, 2) }),
      assistant({ id: 'persisted', storeAssistantMessageId: 'live', usage: usage(3, 3) }),
      assistant({ id: 'other-alias', storeAssistantMessageId: 'live', usage: usage(4, 4) }),
      assistant({ id: 'second', usage: usage(5, 5) }),
      assistant({ id: 'second', usage: usage(6, 6) })
    ]
    const result = aggregateSessionTokenUsage(messages, { live: assistant({ id: 'live', usage: usage(10, 10) }) })
    expect(result).toMatchObject({ promptTokens: 16, completionTokens: 16, totalTokens: 32, messageCount: 2 })
  })

  it('uses nonempty steps before final usage, deriving a missing total from prompt and completion', () => {
    const result = aggregateSessionTokenUsage([assistant({
      usage: usage(9000, 9000),
      usageSteps: [usage(10, 20), { prompt_tokens: 30, completion_tokens: 40 }]
    })])
    expect(result).toMatchObject({ promptTokens: 40, completionTokens: 60, totalTokens: 100, incomplete: false })
    expect(aggregateSessionTokenUsage([assistant({ usage: usage(1, 2), usageSteps: [] })]).totalTokens).toBe(3)
  })

  it('preserves explicit totals instead of recalculating them', () => {
    expect(aggregateSessionTokenUsage([assistant({
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 9 }
    })]).totalTokens).toBe(9)
  })

  it('preserves cache read/write fields and aliases across steps without adding cached tokens twice', () => {
    const result = aggregateSessionTokenUsage([assistant({ usageSteps: [
      { ...usage(100, 10), cache_read_input_tokens: 40, cache_creation_input_tokens: 20 },
      { ...usage(200, 20), prompt_tokens_details: { cached_tokens: 60, cache_write_tokens: 30 } },
      { ...usage(300, 30), input_tokens_details: { cached_tokens: 80, cache_creation_input_tokens: 50 } },
      { ...usage(10, 1), cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
        prompt_tokens_details: { cached_tokens: 999, cache_write_tokens: 999 } }
    ] })])
    expect(result).toMatchObject({
      promptTokens: 610, completionTokens: 61, totalTokens: 671,
      cacheReadTokens: 180, cacheWriteTokens: 100, incomplete: false
    })
    expect(aggregateSessionTokenUsage([assistant({ usage: {
      ...usage(), input_tokens_details: { cached_tokens: 12, cache_write_tokens: 4 }
    } })])).toMatchObject({ cacheReadTokens: 12, cacheWriteTokens: 4 })
  })

  it('resolves latest Redux tool blocks and reuses reverse-prompt accounting without counting codemode', () => {
    const tool = reverseTool({
      billing: { total_consumed_points: 1.8, complete: true },
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 }
    })
    const result = aggregateSessionTokenUsage([assistant({
      usage: usage(), blocks: ['reverse', { ...tool, id: 'codemode', toolName: 'codemode' },
        { ...tool, id: 'other', toolName: 'bash' }]
    })], {}, { reverse: tool })
    expect(result).toMatchObject({
      promptTokens: 110, completionTokens: 25, totalTokens: 135,
      cacheReadTokens: 3, cacheWriteTokens: 2, incomplete: false
    })
    const staleInline = reverseTool({ usage: usage(9000, 9000) })
    expect(aggregateSessionTokenUsage([assistant({ usage: usage(), blocks: [staleInline] })], {}, {
      reverse: tool
    }).totalTokens).toBe(135)
  })

  it('retains tool-only usage as a known lower bound while outer usage is missing', () => {
    const result = aggregateSessionTokenUsage([assistant({ blocks: [reverseTool({ usage: usage(10, 5) })] })])
    expect(result).toMatchObject({
      promptTokens: 10, completionTokens: 5, totalTokens: 15,
      hasReportedUsage: true, incomplete: true, reportedMessageCount: 1, unknownMessageCount: 0
    })
  })

  it.each([
    { blocks: [reverseTool({ billing: { total_consumed_points: 1.8 } })] },
    { blocks: ['unresolved-block'] },
    { blocks: [reverseTool({ usage: { total_tokens: 8 }, billing: { complete: false } })] }
  ])('marks missing or partial tool usage incomplete: %j', (fields) => {
    const result = aggregateSessionTokenUsage([assistant({ usage: usage(), ...fields })])
    expect(result.hasReportedUsage).toBe(true)
    expect(result.incomplete).toBe(true)
    expect(result.totalTokens).toBeGreaterThanOrEqual(120)
  })

  it('uses metrics completion fallback but marks unknown prompt accounting incomplete', () => {
    expect(aggregateSessionTokenUsage([assistant({ metrics: { completion_tokens: 704 } })])).toMatchObject({
      promptTokens: 0, completionTokens: 704, totalTokens: 704,
      hasReportedUsage: true, incomplete: true, unknownMessageCount: 0
    })
    expect(aggregateSessionTokenUsage([assistant({ metrics: { completion_tokens: 0 } })])).toMatchObject({
      totalTokens: 0, hasReportedUsage: true, incomplete: true
    })
    // As in the message row, final usage is authoritative over metrics.
    expect(aggregateSessionTokenUsage([assistant({ usage: usage(0, 0), metrics: { completion_tokens: 704 } })])).toMatchObject({
      totalTokens: 0, hasReportedUsage: true, incomplete: false
    })
  })

  it('distinguishes missing usage, empty objects, explicit zero, and mixed known/unknown messages', () => {
    for (const fields of [{}, { usage: {} }, { usageSteps: [{}] }]) {
      expect(aggregateSessionTokenUsage([assistant(fields)])).toMatchObject({
        totalTokens: 0, hasReportedUsage: false, incomplete: true,
        messageCount: 1, reportedMessageCount: 0, unknownMessageCount: 1
      })
    }
    expect(aggregateSessionTokenUsage([assistant({ usage: usage(0, 0) })])).toMatchObject({
      totalTokens: 0, hasReportedUsage: true, incomplete: false, unknownMessageCount: 0
    })
    expect(aggregateSessionTokenUsage([
      assistant({ id: 'known', usage: usage() }), assistant({ id: 'unknown' })
    ])).toMatchObject({
      totalTokens: 120, hasReportedUsage: true, incomplete: true,
      messageCount: 2, reportedMessageCount: 1, unknownMessageCount: 1
    })
  })

  it.each([{ error: { message: 'failed' } }, { status: 'error' }, { aborted: true }])(
    'keeps reported tokens after failure/cancellation and flags incomplete: %j', (fields) => {
      expect(aggregateSessionTokenUsage([assistant({ usageSteps: [usage()], ...fields })])).toMatchObject({
        totalTokens: 120, hasReportedUsage: true, incomplete: true
      })
    }
  )

  it('flags partial model usage without treating the missing fields as a complete zero', () => {
    expect(aggregateSessionTokenUsage([assistant({ usage: { total_tokens: 42 } })])).toMatchObject({
      totalTokens: 42, hasReportedUsage: true, incomplete: true
    })
    expect(aggregateSessionTokenUsage([assistant({ usageSteps: [usage(), {}] })])).toMatchObject({
      totalTokens: 120, hasReportedUsage: true, incomplete: true
    })
  })

  it.each([
    { messages: [] }, { messages: null }, { messages: undefined }, { messages: [{ role: 'user' }] }
  ])('returns a distinct empty state: %j', ({ messages }) => {
    expect(aggregateSessionTokenUsage(messages)).toEqual({
      promptTokens: 0, completionTokens: 0, totalTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
      hasReportedUsage: false, incomplete: false, messageCount: 0, reportedMessageCount: 0, unknownMessageCount: 0
    })
  })

  it('does not leak totals between sessions or mutate input snapshots', () => {
    const history = Object.freeze(assistant({
      id: 'a', storeAssistantMessageId: 'live-a', usage: Object.freeze(usage(1, 2)), blocks: Object.freeze([])
    }))
    const liveA = Object.freeze(assistant({ id: 'live-a', usage: Object.freeze(usage(10, 20)) }))
    const live = Object.freeze({ 'live-a': liveA, 'live-b': assistant({ id: 'live-b', usage: usage(30, 40) }) })
    expect(aggregateSessionTokenUsage(Object.freeze([history]), live).totalTokens).toBe(30)
    expect(aggregateSessionTokenUsage([assistant({ id: 'b', storeAssistantMessageId: 'live-b' })], live).totalTokens).toBe(70)
    expect(aggregateSessionTokenUsage([], live).totalTokens).toBe(0)
    expect(aggregateSessionTokenUsage([history], live).totalTokens).toBe(30)
    expect(history.usage).toEqual(usage(1, 2))
  })
})

describe('getMessageTokenUsage', () => {
  it('shares message-row normalization and tool-internal token arithmetic with the session summary', () => {
    const message = assistant({
      usage: usage(999, 999), usageSteps: [usage(4, 5)],
      blocks: [reverseTool({ usage: usage(1, 2) })]
    })
    const result = getMessageTokenUsage(message)
    expect(result.displayUsage).toMatchObject(usage(4, 5))
    expect(result).toMatchObject({ prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 })
    expect(aggregateSessionTokenUsage([message]).totalTokens).toBe(result.total_tokens)
  })
})
