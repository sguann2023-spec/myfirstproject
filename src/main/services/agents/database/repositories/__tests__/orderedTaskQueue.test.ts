import { describe, expect, it } from 'vitest'
import { OrderedTaskQueue } from '../../orderedTaskQueue'

describe('OrderedTaskQueue', () => {
  it('runs tasks in submission order and preserves typed results', async () => {
    const queue = new OrderedTaskQueue()
    const calls: number[] = []
    const results = await Promise.all([1, 2, 3].map(value => queue.run(async () => {
      calls.push(value)
      await Promise.resolve()
      calls.push(-value)
      return value * 2
    })))
    expect(calls).toEqual([1, -1, 2, -2, 3, -3])
    expect(results).toEqual([2, 4, 6])
  })

  it('propagates synchronous and asynchronous failures without poisoning the tail', async () => {
    const queue = new OrderedTaskQueue()
    const sync = queue.run<number>(() => { throw new Error('sync') })
    const asyncFailure = queue.run(async () => { throw new Error('async') })
    const success = queue.run(async () => 'recovered')
    await expect(sync).rejects.toThrow('sync')
    await expect(asyncFailure).rejects.toThrow('async')
    await expect(success).resolves.toBe('recovered')
  })

  it('lets separate instances progress independently', async () => {
    const first = new OrderedTaskQueue()
    const second = new OrderedTaskQueue()
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const blocked = first.run(() => gate)
    try {
      await expect(second.run(async () => 42)).resolves.toBe(42)
    } finally { release() }
    await blocked
  })
})
