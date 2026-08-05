import { describe, expect, it } from 'vitest'

import { convertPiUsage } from '../harness/pi-query-stream'

describe('convertPiUsage', () => {
  it('counts cache tokens as part of input tokens while preserving upstream total', () => {
    const usage = convertPiUsage({
      input: 1441,
      output: 180,
      cacheRead: 2048,
      cacheWrite: 0,
      totalTokens: 3669,
      reasoning: 60
    })

    expect(usage).toMatchObject({
      inputTokens: 3489,
      outputTokens: 180,
      totalTokens: 3669,
      inputTokenDetails: {
        noCacheTokens: 1441,
        cacheReadTokens: 2048,
        cacheWriteTokens: 0
      },
      outputTokenDetails: {
        textTokens: 120,
        reasoningTokens: 60
      }
    })
  })
})
