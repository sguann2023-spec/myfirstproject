import { describe, expect, it } from 'vitest'
import { beginHistoryActivity, observeIdleHistory, withHistoryActivity } from '../historyActivity'

describe('speculative history admission', () => {
  it('invalidates an idle observer before a writer yields and keeps other topics independent', () => {
    const first = observeIdleHistory('observer-first')!
    const other = observeIdleHistory('observer-other')!
    expect(first.isCurrent()).toBe(true)
    const release = beginHistoryActivity('observer-first')
    expect(first.isCurrent()).toBe(false)
    expect(observeIdleHistory('observer-first')).toBeUndefined()
    expect(other.isCurrent()).toBe(true)
    release()
    release()
    expect(first.isCurrent()).toBe(false)
    const next = observeIdleHistory('observer-first')!
    expect(next.isCurrent()).toBe(true)
    first.release(); other.release(); next.release()
  })

  it('requires all overlapping writers to exit and releases failed work', async () => {
    const one = beginHistoryActivity('overlap')
    const two = beginHistoryActivity('overlap')
    one()
    expect(observeIdleHistory('overlap')).toBeUndefined()
    two()
    await expect(withHistoryActivity('overlap', async () => {
      expect(observeIdleHistory('overlap')).toBeUndefined()
      throw new Error('failed write')
    })).rejects.toThrow('failed write')
    const idle = observeIdleHistory('overlap')!
    expect(idle.isCurrent()).toBe(true)
    idle.release()
    expect(idle.isCurrent()).toBe(false)
  })
})
