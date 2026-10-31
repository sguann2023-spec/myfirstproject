import { describe, expect, it, vi } from 'vitest'
import { createSubscriptionRequests, createSuccessfulRequestCache } from '../requestReuse'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}

describe('app info request reuse', () => {
  it('shares concurrent requests and reuses the successful snapshot', async () => {
    const response = deferred<string>()
    const request = vi.fn(() => response.promise)
    const cache = createSuccessfulRequestCache(request, Boolean)
    const first = cache.get()
    expect(cache.get()).toBe(first)
    response.resolve('/data')
    expect(await first).toBe('/data')
    expect(await cache.get()).toBe('/data')
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('retries failures and incomplete responses', async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error('not ready'))
      .mockResolvedValueOnce('').mockResolvedValue('/data')
    const cache = createSuccessfulRequestCache<string>(request, Boolean)
    await expect(cache.get()).rejects.toThrow('not ready')
    expect(await cache.get()).toBe('')
    expect(await cache.get()).toBe('/data')
    expect(request).toHaveBeenCalledTimes(3)
  })

  it('does not let an invalidated in-flight response overwrite new paths', async () => {
    const old = deferred<string>()
    const fresh = deferred<string>()
    const request = vi.fn().mockImplementationOnce(() => old.promise)
      .mockImplementationOnce(() => fresh.promise)
    const cache = createSuccessfulRequestCache<string>(request, Boolean)
    const first = cache.get()
    cache.invalidate()
    const second = cache.get()
    old.resolve('/old')
    await first
    expect(cache.get()).toBe(second)
    fresh.resolve('/new')
    await second
    expect(await cache.get()).toBe('/new')
    cache.invalidate()
    request.mockResolvedValue('/third')
    expect(await cache.get()).toBe('/third')
    expect(request).toHaveBeenCalledTimes(3)
  })
})

describe('session subscription request reuse', () => {
  it('subscribes once during prewarm and reuses it when sending', async () => {
    const response = deferred<{ success: boolean }>()
    const request = vi.fn(() => response.promise)
    const subscriptions = createSubscriptionRequests(request)
    const first = subscriptions.subscribe('session')
    expect(subscriptions.subscribe('session')).toBe(first)
    response.resolve({ success: true })
    await first
    expect(await subscriptions.subscribe('session')).toEqual({ success: true })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('keeps different sessions independent', async () => {
    const request = vi.fn().mockResolvedValue({ success: true })
    const subscriptions = createSubscriptionRequests(request)
    await Promise.all([subscriptions.subscribe('a'), subscriptions.subscribe('b')])
    expect(request.mock.calls).toEqual([['subscribe', 'a'], ['subscribe', 'b']])
  })

  it('retries rejected and unsuccessful subscriptions', async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ success: false }).mockResolvedValue({ success: true })
    const subscriptions = createSubscriptionRequests(request)
    await expect(subscriptions.subscribe('session')).rejects.toThrow('offline')
    expect(await subscriptions.subscribe('session')).toEqual({ success: false })
    expect(await subscriptions.subscribe('session')).toEqual({ success: true })
    expect(request).toHaveBeenCalledTimes(3)
  })

  it('orders subscribe, unsubscribe, and resubscribe even before the first reply', async () => {
    const response = deferred<{ success: boolean }>()
    const request = vi.fn().mockImplementationOnce(() => response.promise)
      .mockResolvedValue({ success: true })
    const subscriptions = createSubscriptionRequests(request)
    const first = subscriptions.subscribe('session')
    const release = subscriptions.unsubscribe('session')
    expect(subscriptions.unsubscribe('session')).toBe(release)
    const reacquire = subscriptions.subscribe('session')
    response.resolve({ success: true })
    await Promise.all([first, release, reacquire])
    expect(request.mock.calls).toEqual([
      ['subscribe', 'session'], ['unsubscribe', 'session'], ['subscribe', 'session']
    ])
    await subscriptions.subscribe('session')
    expect(request).toHaveBeenCalledTimes(3)
  })

  it('invalidates subscription state after a failed unsubscribe', async () => {
    const request = vi.fn().mockResolvedValueOnce({ success: true })
      .mockRejectedValueOnce(new Error('lost reply')).mockResolvedValue({ success: true })
    const subscriptions = createSubscriptionRequests(request)
    await subscriptions.subscribe('session')
    const release = subscriptions.unsubscribe('session')
    const reacquire = subscriptions.subscribe('session')
    await expect(release).rejects.toThrow('lost reply')
    await reacquire
    expect(request.mock.calls).toEqual([
      ['subscribe', 'session'], ['unsubscribe', 'session'], ['subscribe', 'session']
    ])
  })
})
