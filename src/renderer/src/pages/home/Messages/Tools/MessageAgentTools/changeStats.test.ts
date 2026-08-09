import { describe, expect, it } from 'vitest'

import { renderToolChangeStats } from './changeStats'
import { AgentToolsType } from './types'

describe('renderToolChangeStats', () => {
  it('shows only added lines for write tool content', () => {
    const stats = renderToolChangeStats(AgentToolsType.Write, {
      file_path: '/tmp/count_primes.py',
      content: 'line1\nline2\nline3\n'
    })

    expect(stats).toBe('约 + 3 行')
  })
})
