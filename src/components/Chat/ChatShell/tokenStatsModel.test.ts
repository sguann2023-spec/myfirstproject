import { describe, expect, it } from 'vitest'
import type { TokenBreakdown, TokenContextTelemetry, TokenRequestTelemetry, TokenTelemetry } from '@shared/tokenTelemetry'
import { aggregateSessionTokenUsage, type TokenUsageBlock } from '@renderer/pages/home/Messages/tokenUsage'
import { buildReportedTokenSummary, buildTokenStatsModel, mergeStatsMessages, type StatsMessage } from './tokenStatsModel'

const breakdown = (categories: TokenBreakdown['categories'] = { user: 10 }, overrides: Partial<TokenBreakdown> = {}): TokenBreakdown => ({
  categories, total: Object.values(categories).reduce((sum, value) => sum + (value || 0), 0), status: 'estimated', method: 'test', ...overrides
})
const reported = (inputTokens = 100, outputTokens = 20) => ({ inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, cacheReadTokens: 30, cacheWriteTokens: 5, reasoningTokens: 7 })
const request = (overrides: Partial<TokenRequestTelemetry> = {}): TokenRequestTelemetry => ({
  id: 'r1', revision: 2, runtimeSessionId: 's1', invocationId: 'i1', sequence: 1, modelId: 'model', providerId: 'provider', operation: 'chat',
  status: 'completed', startedAt: 10, attempts: 1, input: breakdown(), output: breakdown({ reply: 4 }), reported: reported(), ...overrides
})
const context = (overrides: Partial<TokenContextTelemetry> = {}): TokenContextTelemetry => ({
  id: 'context', revision: 1, runtimeSessionId: 's1', modelId: 'model', providerId: 'provider', observedAt: 10,
  basis: 'request', validity: 'valid', input: breakdown(), contextWindowTokens: 1000, ...overrides
})
const telemetry = (requests: TokenRequestTelemetry[] = [], ctx?: TokenContextTelemetry): TokenTelemetry => ({ version: 1, requests, ...(ctx ? { context: ctx } : {}) })
const usage = (prompt_tokens = 900, completion_tokens = 100) => ({ prompt_tokens, completion_tokens, total_tokens: prompt_tokens + completion_tokens })
const assistant = (overrides: StatsMessage = {}): StatsMessage => ({ id: 'message', role: 'assistant', blocks: [], ...overrides })
const entry = (requests = [request()], overrides: StatsMessage = {}) => assistant({ tokenTelemetry: telemetry(requests), ...overrides })

describe('message and request identity', () => {
  it('unions aliases with a late bridge, trims IDs and leaves anonymous messages distinct', () => {
    const result = mergeStatsMessages([
      entry([request({ revision: 5 })], { id: ' history ' }),
      entry([request({ id: 'r2' })], { id: 'live' }),
      assistant({ id: undefined }), assistant({ id: undefined })
    ], [entry([request({ revision: 1 })], { id: 'history', storeAssistantMessageId: ' live ' })])
    expect(result).toHaveLength(3)
    expect(result[0].tokenTelemetry?.requests.map(r => [r.id, r.revision])).toEqual([['r1', 5], ['r2', 2]])
  })

  it('keeps newer history over stale live and persisted revisions; never appends unrelated live', () => {
    const history = entry([request({ revision: 9, input: breakdown({ user: 30 }) })], { id: 'snapshot', storeAssistantMessageId: 'live' })
    const live = { live: entry([request({ revision: 1, input: breakdown({ user: 999 }) })]), unrelated: entry([request({ id: 'unrelated' })]) }
    const persisted = telemetry([request({ revision: 2 }), request({ id: 'r2', revision: 1, input: breakdown({ system: 5 }) })])
    const stats = buildTokenStatsModel([history, assistant({ id: 'live' })], live, 's1', persisted)
    expect(stats.requestCount).toBe(2)
    expect(stats.estimateTotal).toBe(43)
    expect(stats.telemetry.requests[0].revision).toBe(9)
    expect(stats.missingHistory).toBe(false)
    expect(buildReportedTokenSummary([history], live, {}, 's1', persisted).totalTokens).toBe(240)
  })

  it('uses runtime plus request ID, not identical token values, payload, sequence or invocation', () => {
    const requests = [request(), request({ id: 'r2' }), request({ runtimeSessionId: 's2' })]
    expect(buildTokenStatsModel([entry(requests)]).requestCount).toBe(3)
    expect(buildReportedTokenSummary([entry(requests)]).totalTokens).toBe(360)
    expect(buildReportedTokenSummary([entry(requests)], {}, {}, 's1').totalTokens).toBe(240)
  })

  it('merges every matching live alias and deduplicates shared requests across different messages', () => {
    const messages = [entry([request({ revision: 1 })], { id: 'snapshot', storeAssistantMessageId: 'live' }), entry()]
    const result = buildTokenStatsModel(messages, {
      snapshot: entry([request({ revision: 3, input: breakdown({ user: 11 }) })], { id: 'other-alias' }),
      live: entry([request({ revision: 4, input: breakdown({ user: 12 }) })])
    })
    expect(result.requestCount).toBe(1)
    expect(result.estimateTotal).toBe(16)
    expect(buildReportedTokenSummary(messages).totalTokens).toBe(120)
  })

  it('filters foreign message owners, telemetry, context and foreign live overlays', () => {
    const messages = [entry(), assistant({ id: 'foreign', runtimeSessionId: 's2', usage: usage() }), assistant({ id: 'topic', topicId: 'agent-session:s2', usage: usage() }), entry([request({ runtimeSessionId: 's2' })], { id: 'foreign-ledger' })]
    const live = { message: entry([request({ runtimeSessionId: 's2', reported: reported(9999) })]) }
    const persisted = telemetry([request({ runtimeSessionId: 's2' })], context({ runtimeSessionId: 's2' }))
    expect(buildTokenStatsModel(messages, live, 's1', persisted)).toMatchObject({ requestCount: 1, context: undefined, missingHistory: false })
    expect(buildReportedTokenSummary(messages, live, {}, 's1', persisted)).toMatchObject({ totalTokens: 120, messageCount: 1 })
  })
})

describe('classification and context', () => {
  it('adds disjoint input/output categories once, not totals, cache, reasoning or attempts', () => {
    const stats = buildTokenStatsModel([entry([request({ attempts: 4, input: breakdown({ user: 10, reasoning: 3, toolCalls: 2 }), output: breakdown({ reasoning: 4, toolCalls: 5, reply: 6 }) })])])
    expect(stats.estimateTotal).toBe(30)
    expect(stats.segments.reduce((sum, segment) => sum + segment.value, 0)).toBe(30)
    expect(stats.segments.find(segment => segment.key === 'reasoning')?.value).toBe(7)
    expect(stats.partial).toBe(false)
  })

  it('does not treat a prepared, unattempted payload as consumption', () => {
    const messages = [entry([request({ status: 'prepared', attempts: 0, output: undefined, reported: undefined })], { usage: usage() })]
    expect(buildTokenStatsModel(messages)).toMatchObject({ requestCount: 0, estimateTotal: 0, hasEstimatedUsage: false, partial: false })
    expect(buildReportedTokenSummary(messages)).toEqual(aggregateSessionTokenUsage([]))
  })

  it.each(['failed', 'aborted', 'prepared'] as const)('retains known %s subtotals and flags them partial', status => {
    const messages = [entry([request({ status, output: undefined })])]
    expect(buildTokenStatsModel(messages)).toMatchObject({ estimateTotal: 10, partial: true, requestCount: 1 })
    expect(buildReportedTokenSummary(messages)).toMatchObject({ totalTokens: 120, incomplete: true })
  })

  it('keeps unknown estimates and reports distinguishable from genuine zero', () => {
    const messages = [entry([request({ input: breakdown({}, { status: 'unknown' }), output: undefined, reported: undefined })])]
    expect(buildTokenStatsModel(messages)).toMatchObject({ estimateTotal: 0, hasEstimatedUsage: false, segments: [], partial: true })
    expect(buildReportedTokenSummary(messages)).toMatchObject({ totalTokens: 0, hasReportedUsage: false, incomplete: true, unknownMessageCount: 1 })
    expect(buildReportedTokenSummary([entry([request({ reported: reported(0, 0) })])])).toMatchObject({ totalTokens: 0, hasReportedUsage: true, incomplete: false })
  })

  it('marks missing historical classification, but recognizes persisted invocation association', () => {
    expect(buildTokenStatsModel([assistant({ usage: usage() })]).missingHistory).toBe(true)
    expect(buildTokenStatsModel([assistant({ traceId: 'i1' })], {}, 's1', telemetry([request()])).missingHistory).toBe(false)
  })

  it('keeps newest invalidation instead of resurrecting older history/live context', () => {
    const valid = context({ id: 'context:previous-invocation', revision: 10 })
    const invalid = context({ id: 'context:next-invocation', revision: 1, observedAt: 11, basis: 'invalidated', validity: 'stale' })
    const messages = [entry([], { tokenTelemetry: telemetry([], valid), storeAssistantMessageId: 'live' })]
    const result = buildTokenStatsModel(messages, { live: entry([], { tokenTelemetry: telemetry([], valid) }) }, 's1', telemetry([], invalid))
    expect(result.context).toEqual(invalid)
    expect(result.requestCount).toBe(0)
  })

  it('uses revision within a context even when a stale observation has a later timestamp', () => {
    const latest = context({ revision: 8, observedAt: 10, basis: 'post-compaction', input: breakdown({ assistant: 2 }) })
    const stale = context({ revision: 7, observedAt: 50 })
    expect(buildTokenStatsModel([entry([], { tokenTelemetry: telemetry([], latest) })], {}, 's1', telemetry([], stale)).context).toEqual(latest)
    expect(buildTokenStatsModel([entry([], { tokenTelemetry: telemetry([], stale) })], {}, 's1', telemetry([], latest)).context).toEqual(latest)
  })

  it('honors cached invalidation timestamp+1 across context IDs without comparing invocation revisions', () => {
    const cached = context({ id: 'context:cached', revision: 1, observedAt: 11, basis: 'invalidated', validity: 'unknown' })
    const stale = context({ id: 'context:invocation', revision: 900, observedAt: 10 })
    for (const [first, second] of [[cached, stale], [stale, cached]]) {
      expect(buildTokenStatsModel([entry([], { tokenTelemetry: telemetry([], first) })], {}, 's1', telemetry([], second)).context).toEqual(cached)
    }
    const next = context({ id: 'context:next-invocation', revision: 1, observedAt: 12 })
    expect(buildTokenStatsModel([entry([], { tokenTelemetry: telemetry([], cached) })], {}, 's1', telemetry([], next)).context).toEqual(next)
  })

  it('prefers invalidation at identical clock/revision, then permits genuinely newer post-compaction', () => {
    const invalid = context({ basis: 'invalidated', validity: 'unknown' })
    expect(buildTokenStatsModel([entry([], { tokenTelemetry: telemetry([], invalid) })], {}, 's1', telemetry([], context())).context).toEqual(invalid)
    const post = context({ observedAt: 12, basis: 'post-compaction', input: breakdown({ assistant: 2 }) })
    expect(buildTokenStatsModel([entry([], { tokenTelemetry: telemetry([], post) })], {}, 's1', telemetry([], invalid)).context).toEqual(post)
  })
})

describe('provider-reported summary', () => {
  it('preserves the full historical fallback shape including usageSteps and metrics', () => {
    const messages = [assistant({ id: 'one', usage: usage(), usageSteps: [usage(5, 6), usage(7, 8)] }), assistant({ id: 'two', metrics: { completion_tokens: 4 } }), assistant({ id: 'three' })]
    expect(buildReportedTokenSummary(messages)).toEqual(aggregateSessionTokenUsage(messages))
    expect(buildReportedTokenSummary([])).toEqual(aggregateSessionTokenUsage([]))
  })

  it('uses ledger rather than usage, steps and metrics, including compaction exactly once', () => {
    const messages = [entry([request(), request({ id: 'compact', operation: 'compaction', reported: reported(10, 2) })], { usage: usage(), usageSteps: [usage(9999)], metrics: { completion_tokens: 9999 } })]
    const result = buildReportedTokenSummary(messages, {}, {}, 's1', telemetry([request()]))
    expect(result).toEqual({ promptTokens: 110, completionTokens: 22, totalTokens: 132, cacheReadTokens: 60, cacheWriteTokens: 10, hasReportedUsage: true, incomplete: false, messageCount: 1, reportedMessageCount: 1, unknownMessageCount: 0 })
  })

  it('does not fall back when an invocation ledger has no report, including persisted-only association', () => {
    const requests = [request({ reported: undefined }), request({ id: 'compact', operation: 'compaction', reported: undefined })]
    const messages = [assistant({ traceId: 'i1', usage: usage(), metrics: { completion_tokens: 4000 } })]
    expect(buildReportedTokenSummary(messages, {}, {}, 's1', telemetry(requests))).toMatchObject({ totalTokens: 0, hasReportedUsage: false, incomplete: true, messageCount: 1, unknownMessageCount: 1 })
  })

  it('associates legacy trace IDs with unambiguous persisted invocations without an explicit runtime', () => {
    const messages = [assistant({ traceId: 'i1', usage: usage() })]
    expect(buildReportedTokenSummary(messages, {}, {}, '', telemetry([request()]))).toMatchObject({ totalTokens: 120, messageCount: 1 })
    expect(buildTokenStatsModel(messages, {}, '', telemetry([request()])).missingHistory).toBe(false)
  })

  it('keeps partial/null reports unknown and does not add cache or reasoning to main totals', () => {
    const partial = { ...reported(), inputTokens: null, outputTokens: null, totalTokens: null }
    expect(buildReportedTokenSummary([entry([request({ reported: partial })])])).toMatchObject({
      totalTokens: 0, cacheReadTokens: 30, cacheWriteTokens: 5, hasReportedUsage: false, incomplete: true, unknownMessageCount: 1
    })
  })

  it('keeps known reported lower bounds when another request in the same invocation is unknown', () => {
    const messages = [entry([request(), request({ id: 'compact', operation: 'compaction', reported: undefined })], { usage: usage() })]
    expect(buildReportedTokenSummary(messages)).toMatchObject({ totalTokens: 120, hasReportedUsage: true, incomplete: true, messageCount: 1 })
  })

  it('merges old fallback, ledger and additional persisted invocations without double count', () => {
    const messages = [entry(), assistant({ id: 'legacy', usage: usage(3, 4) })]
    const persisted = telemetry([request({ revision: 1 }), request({ id: 'extra', invocationId: 'i2', reported: reported(1, 2) })])
    expect(buildReportedTokenSummary(messages, {}, {}, 's1', persisted)).toMatchObject({ totalTokens: 130, messageCount: 3, reportedMessageCount: 3, incomplete: false })
  })

  it('preserves explicit provider totals and derives missing totals only from both known components', () => {
    expect(buildReportedTokenSummary([entry([request({ reported: { ...reported(2, 3), totalTokens: 9 } })])]).totalTokens).toBe(9)
    expect(buildReportedTokenSummary([entry([request({ reported: { ...reported(2, 3), totalTokens: null } })])])).toMatchObject({ totalTokens: 5, incomplete: false })
    expect(buildReportedTokenSummary([entry([request({ reported: { ...reported(), inputTokens: null, totalTokens: null } })])])).toMatchObject({ totalTokens: 0, completionTokens: 20, incomplete: true, hasReportedUsage: true })
  })

  it('retains original tool-internal accounting without recalculating the main request', () => {
    const block: TokenUsageBlock = { id: 'tool', type: 'tool', toolName: 'mcp__vectcut__copylab__derive_copy_prompt', metadata: { rawMcpToolResponse: { responseRaw: { content: [{ type: 'text', text: JSON.stringify({ usage: usage(7, 8), billing: { complete: true, total_consumed_points: 1 } }) }] } } } }
    const messages = [entry([request()], { usage: usage(), blocks: ['tool'] })]
    expect(buildReportedTokenSummary(messages, {}, { tool: block })).toMatchObject({ promptTokens: 107, completionTokens: 28, totalTokens: 135, incomplete: false })
    expect(buildReportedTokenSummary(messages)).toMatchObject({ totalTokens: 120, incomplete: true })
  })

  it('deduplicates alias fallback history and only overlays referenced live data', () => {
    const messages = [assistant({ id: 'snapshot', usage: usage(1, 2) }), assistant({ id: 'live', usage: usage(2, 3) }), assistant({ id: 'snapshot', storeAssistantMessageId: 'live' })]
    expect(buildReportedTokenSummary(messages, { live: assistant({ id: 'live', usage: usage(3, 4) }), unrelated: assistant({ usage: usage() }) })).toMatchObject({ totalTokens: 7, messageCount: 1 })
  })
})
