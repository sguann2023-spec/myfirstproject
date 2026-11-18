import { describe, expect, it } from 'vitest'

import { TextStreamAccumulator } from '../session-stream-accumulator'

describe('failed turn usage accounting', () => {
  it('counts identical usage from distinct completed steps and retains it on error', () => {
    const accumulator = new TextStreamAccumulator()
    const usage = { inputTokens: 100, outputTokens: 50, totalTokens: 150 }
    accumulator.add({ type: 'usage', usage } as any)
    accumulator.add({ type: 'finish-step', usage } as any)
    accumulator.add({ type: 'usage', usage } as any)
    accumulator.add({ type: 'finish-step', usage } as any)
    accumulator.add({ type: 'error', error: new Error('400') } as any)
    expect(accumulator.getUsage()).toMatchObject({ prompt_tokens: 200, completion_tokens: 100, total_tokens: 300 })
    expect(accumulator.getUsageSteps()).toHaveLength(2)
  })

  it('does not add the final step a second time when finish repeats its usage', () => {
    const accumulator = new TextStreamAccumulator()
    const usage = { inputTokens: 100, outputTokens: 50, totalTokens: 150 }
    accumulator.add({ type: 'finish-step', usage } as any)
    accumulator.add({ type: 'finish-step', usage } as any)
    accumulator.add({ type: 'finish', totalUsage: usage } as any)
    expect(accumulator.getUsage()).toMatchObject({ total_tokens: 300 })
    expect(accumulator.getUsageSteps()).toHaveLength(2)
  })
})

const telemetry = (revision = 1, runtimeSessionId = 'runtime-a') => ({
  version: 1 as const,
  requests: [{ id: 'request-a', revision, runtimeSessionId, invocationId: 'invocation-a', sequence: 0,
    modelId: 'model', providerId: 'provider', operation: 'reply', status: 'prepared' as const,
    startedAt: 1, attempts: 1, input: { categories: { user: 10 }, total: 10, status: 'estimated' as const, method: 'test' } }]
})

describe('token telemetry accumulation', () => {
  it('upserts revisions, isolates runtime sessions, ignores malformed events and never changes billable usage', () => {
    const accumulator = new TextStreamAccumulator()
    expect(accumulator.getTokenTelemetry()).toBeUndefined()
    for (const data of [telemetry(1), telemetry(2), telemetry(2), telemetry(1), telemetry(1, 'runtime-b'), { version: 1, requests: [{}] }]) {
      accumulator.add({ type: 'raw', rawValue: { type: 'token-telemetry', data } } as any)
    }
    expect(accumulator.getTokenTelemetry()?.requests.map(r => r.revision)).toEqual([2, 1])
    const snapshot = accumulator.getTokenTelemetry()!
    snapshot.requests[0].input.total = 999
    expect(accumulator.getTokenTelemetry()?.requests[0].input.total).toBe(10)
    expect(accumulator.getUsage()).toBeUndefined()
    expect(accumulator.getUsageSteps()).toEqual([])
  })
})
