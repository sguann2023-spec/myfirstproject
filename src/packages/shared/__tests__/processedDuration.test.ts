import { describe, expect, it } from 'vitest'

import { formatElapsedSince, formatProcessedDuration } from '../processedDuration'

describe('formatProcessedDuration', () => {
  it('shows seconds only under one minute', () => {
    expect(formatProcessedDuration('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:45.000Z')).toBe('45秒')
  })

  it('shows minutes and seconds under one hour', () => {
    expect(formatProcessedDuration('2026-01-01T00:00:00.000Z', '2026-01-01T00:05:08.000Z')).toBe('5分8秒')
  })

  it('shows the full duration beyond one hour', () => {
    expect(formatProcessedDuration('2026-01-01T00:00:00.000Z', '2026-01-01T01:02:03.000Z')).toBe('1小时2分3秒')
  })

  it('returns empty when either timestamp is missing', () => {
    expect(formatProcessedDuration(undefined, '2026-01-01T00:00:05.000Z')).toBe('')
    expect(formatProcessedDuration('2026-01-01T00:00:00.000Z', '')).toBe('')
  })
})

describe('formatElapsedSince', () => {
  it('counts from the start time to the given clock', () => {
    expect(formatElapsedSince('2026-01-01T00:00:00.000Z', Date.parse('2026-01-01T00:01:05.000Z'))).toBe('1分5秒')
  })

  it('returns empty without a usable start time', () => {
    expect(formatElapsedSince('')).toBe('')
  })
})
