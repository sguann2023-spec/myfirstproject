import { afterEach, describe, expect, it, vi } from 'vitest'

import { McpMetadataCache } from './McpMetadataCache'

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

afterEach(() => vi.useRealTimers())

describe('MCP response metadata cache', () => {
  it('returns immediately and deduplicates even unresolved configuration lookup', async () => {
    const config = deferred<{ name: string }>()
    const lookup = vi.fn(() => config.promise)
    const load = vi.fn(async () => ['tool'])
    const cache = new McpMetadataCache(lookup, load)
    expect(cache.snapshot('a')).toEqual({ value: undefined, loading: true, error: false })
    cache.snapshot('a')
    await flush()
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(load).not.toHaveBeenCalled()
    config.resolve({ name: 'server' })
    await flush()
    expect(cache.snapshot('a').value).toEqual(['tool'])
  })

  it('retains stale successful tools and backs off after failure', async () => {
    vi.useFakeTimers()
    const load = vi.fn().mockResolvedValueOnce(['tool']).mockRejectedValue(new Error('offline'))
    const cache = new McpMetadataCache(async () => ({ name: 'a' }), load, 100, 500)
    cache.snapshot('a')
    await flush()
    vi.advanceTimersByTime(101)
    expect(cache.snapshot('a').value).toEqual(['tool'])
    await flush()
    expect(cache.snapshot('a')).toEqual({ value: ['tool'], loading: false, error: true })
    expect(load).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(501)
    cache.snapshot('a')
    await flush()
    expect(load).toHaveBeenCalledTimes(3)
  })

  it.each(['name', 'headers', 'baseUrl', 'args', 'env'])('invalidates changed %s configuration before loading replacement', async (field) => {
    let config: Record<string, unknown> = { name: 'original' }
    const pending = deferred<string[]>()
    const load = vi.fn().mockResolvedValueOnce(['old']).mockReturnValue(pending.promise)
    const cache = new McpMetadataCache(async () => config, load)
    cache.snapshot('a')
    await flush()
    config = { ...config, [field]: 'changed' }
    cache.snapshot('a')
    await flush()
    expect(cache.snapshot('a').value).toBeUndefined()
    pending.resolve(['new'])
    await flush()
    expect(cache.snapshot('a').value).toEqual(['new'])
  })

  it('times out hung discovery, clears error on retry, ignores its late result', async () => {
    vi.useFakeTimers()
    const old = deferred<string[]>()
    const load = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(['new'])
    const cache = new McpMetadataCache(async () => ({ name: 'a' }), load)
    cache.snapshot('a')
    await flush()
    await vi.advanceTimersByTimeAsync(15_001)
    expect(cache.snapshot('a')).toEqual({ value: undefined, loading: false, error: true })
    await vi.advanceTimersByTimeAsync(10_001)
    expect(cache.snapshot('a').error).toBe(false)
    await flush()
    old.resolve(['old'])
    await flush()
    expect(cache.snapshot('a').value).toEqual(['new'])
  })

  it('ignores configuration changed during discovery', async () => {
    let config = { name: 'old' }
    const pending = deferred<string[]>()
    const cache = new McpMetadataCache(async () => config, () => pending.promise)
    cache.snapshot('a')
    await flush()
    config = { name: 'new' }
    pending.resolve(['old'])
    await flush()
    expect(cache.snapshot('a').value).toBeUndefined()
  })

  it('ignores late completion after explicit invalidation', async () => {
    const old = deferred<string[]>()
    const load = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(['new'])
    const cache = new McpMetadataCache(async () => ({ name: 'a' }), load)
    cache.snapshot('a')
    await flush()
    cache.invalidate('a')
    cache.snapshot('a')
    await flush()
    old.resolve(['old'])
    await flush()
    expect(cache.snapshot('a').value).toEqual(['new'])
  })
})
