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
