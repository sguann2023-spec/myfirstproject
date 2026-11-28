import { describe, expect, it } from 'vitest'
import { ContextRecoveryQueue } from '../../contextRecoveryQueue'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

describe('ContextRecoveryQueue', () => {
  it('prioritizes pending foreground work without overlapping or preempting active recovery', async () => {
    const queue = new ContextRecoveryQueue()
    const gate = deferred()
    const calls: string[] = []
    const active = queue.run(async () => { calls.push('active'); await gate.promise; calls.push('active done') }, 'background')
    await Promise.resolve()
    const background = queue.run(async () => { calls.push('background') }, 'background')
    const foreground = queue.run(async () => { calls.push('foreground'); return 42 })
    await Promise.resolve()
    expect(calls).toEqual(['active'])
    gate.resolve()
    expect(await foreground).toBe(42)
    await Promise.all([active, background])
    expect(calls).toEqual(['active', 'active done', 'foreground', 'background'])
  })

  it('promotes the same pending promise and preserves FIFO within each priority', async () => {
    const queue = new ContextRecoveryQueue()
    const gate = deferred()
    const active = queue.run(() => gate.promise)
    const calls: string[] = []
    const background = queue.run(async () => { calls.push('background') }, 'background')
    const selected = queue.run(async () => { calls.push('selected') }, 'background')
    const first = queue.run(async () => { calls.push('first') })
    queue.promote(selected)
    const last = queue.run(async () => { calls.push('last') })
    gate.resolve()
    await Promise.all([active, background, selected, first, last])
    expect(calls).toEqual(['selected', 'first', 'last', 'background'])
  })

  it('holds background work across asynchronous foreground handoff and resumes after release', async () => {
    const queue = new ContextRecoveryQueue()
    const release = queue.holdForeground()
    const calls: string[] = []
    const background = queue.run(async () => { calls.push('background') }, 'background')
    await Promise.resolve(); await Promise.resolve()
    expect(calls).toEqual([])
    const preparation = queue.run(async () => { calls.push('preparation') })
    await preparation
    // Multiple promise layers mirror preparation cleanup and identity checks.
    await Promise.resolve().then(() => Promise.resolve())
    expect(calls).toEqual(['preparation'])
    await queue.run(async () => { calls.push('adoption') })
    expect(calls).toEqual(['preparation', 'adoption'])
    release(); release()
    await background
    expect(calls).toEqual(['preparation', 'adoption', 'background'])
  })

  it('does not poison the queue after sync or async failure and permits later submissions', async () => {
    const queue = new ContextRecoveryQueue()
    const first = queue.run(async () => { throw new Error('async') })
    const second = queue.run<number>(() => { throw new Error('sync') }, 'background')
    await expect(first).rejects.toThrow('async')
    await expect(second).rejects.toThrow('sync')
    expect(await queue.run(async () => 'next')).toBe('next')
  })
})
