import { describe, expect, it, vi } from 'vitest'
import { createDeferredQuit } from '../deferredQuit'

describe('deferred app quit', () => {
  it('waits for cleanup once, then allows the recursive quit event', async () => {
    let release!: () => void
    const cleanup = vi.fn(() => new Promise<void>(resolve => { release = resolve }))
    const quit = vi.fn()
    const listener = createDeferredQuit(cleanup, quit, vi.fn())
    const event = { preventDefault: vi.fn() }
    listener(event)
    listener(event)
    await Promise.resolve()
    expect(event.preventDefault).toHaveBeenCalledTimes(2)
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(quit).not.toHaveBeenCalled()
    release()
    await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1))
    const final = { preventDefault: vi.fn() }
    listener(final)
    expect(final.preventDefault).not.toHaveBeenCalled()
  })

  it('reports failed cleanup and still permits exit', async () => {
    const error = new Error('checkpoint failed')
    const report = vi.fn()
    const quit = vi.fn()
    createDeferredQuit(async () => { throw error }, quit, report)({ preventDefault: vi.fn() })
    await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1))
    expect(report).toHaveBeenCalledWith(error)
  })
})
