import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  listeners: new Map<string, Set<(value: unknown) => void>>(),
  storeOptions: vi.fn(),
  set: vi.fn(),
  fetch: vi.fn(),
  accessToken: vi.fn()
}))

vi.mock('electron', () => ({ net: { fetch: mocks.fetch } }))
vi.mock('electron-store', () => ({
  default: class {
    constructor(options: unknown) { mocks.storeOptions(options) }
    get(key: string) { return mocks.values.get(key) }
    set(key: string, value: unknown) {
      mocks.set(key, value)
      const previous = mocks.values.get(key)
      mocks.values.set(key, value)
      if (previous !== value) mocks.listeners.get(key)?.forEach((listener) => listener(value))
    }
    onDidChange(key: string, callback: (value: unknown) => void) {
      if (!mocks.listeners.has(key)) mocks.listeners.set(key, new Set())
      mocks.listeners.get(key)!.add(callback)
      return () => mocks.listeners.get(key)?.delete(callback)
    }
  }
}))
vi.mock('../agents/services/AgentRuntimeAuthService', () => ({
  agentRuntimeAuthService: { ensureValidAccessToken: mocks.accessToken }
}))

import { AccountApiKeyService } from '../AccountApiKeyService'

function jwt(sub = 'user-a', extra: Record<string, unknown> = {}) {
  return `${Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub, iat: 0, ...extra })).toString('base64url')}.c2lnbmF0dXJl`
}
function change(key: string, value: unknown) {
  mocks.values.set(key, value)
  mocks.listeners.get(key)?.forEach((listener) => listener(value))
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
function response(payload: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: vi.fn().mockResolvedValue(payload) }
}

let service: AccountApiKeyService
beforeEach(() => {
  vi.clearAllMocks()
  mocks.values.clear()
  mocks.listeners.clear()
  mocks.values.set('user', { id: 'user-a' })
  mocks.values.set('auth.refresh_token', 'refresh-a')
  mocks.accessToken.mockReset().mockResolvedValue('oauth-runtime')
  mocks.fetch.mockReset()
  service = new AccountApiKeyService()
})

describe('AccountApiKeyService', () => {
  it('uses the named vectcut store and returns a valid user-bound cache without network', async () => {
    mocks.values.set('auth.vectcut_api_key', jwt())
    const result = await service.getForCurrentSession()
    expect(mocks.storeOptions).toHaveBeenCalledWith({ name: 'vectcut', watch: true })
    expect(result).toEqual({ key: jwt(), owner: { userId: 'user-a', generation: 0 } })
    expect(Object.isFrozen(result.owner)).toBe(true)
    expect(result.owner).not.toHaveProperty('refreshToken')
    expect(() => service.assertSession(result.owner)).not.toThrow()
    expect(mocks.accessToken).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('gets long-lived keys only from the fixed authoritative endpoint using runtime OAuth and PC metadata', async () => {
    mocks.values.set('auth.vectcut_api_key', jwt('user-a', { exp: 123 }))
    mocks.values.set('user', { id: 'user-a', apiKey: jwt('user-b') })
    mocks.fetch.mockResolvedValue(response({ token: jwt() }))
    const result = await service.getForCurrentSession()
    expect(result.key).toBe(jwt())
    expect(mocks.accessToken).toHaveBeenCalledExactlyOnceWith()
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith('https://open.vectcut.com/user_manager/get_token', {
      method: 'POST',
      redirect: 'error',
      signal: expect.any(AbortSignal),
      headers: { Authorization: 'Bearer oauth-runtime', 'Content-Type': 'application/json', 'X-Client-Type': expect.stringMatching(/^(windows|mac|linux|pc)$/) },
      body: JSON.stringify({ user_id: 'user-a', login_type: 'authing' })
    })
    expect(mocks.set).toHaveBeenCalledExactlyOnceWith('auth.vectcut_api_key', jwt())
  })

  it.each(['agentApiKey', 'vectcutApiKey', 'apiKey'])('accepts owned long-lived legacy %s only', async (alias) => {
    mocks.values.set('auth.vectcut_api_key', 'oauth-access')
    mocks.values.set('user', { id: 'user-a', [alias]: jwt() })
    expect((await service.getForCurrentSession()).key).toBe(jwt())
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it.each([undefined, '', '   '])('rejects missing refresh-token sessions before cache access (%s)', async (value) => {
    change('auth.refresh_token', value)
    mocks.values.set('auth.vectcut_api_key', jwt())
    expect(() => service.captureSession()).toThrow(/sign in/)
    await expect(service.getForCurrentSession()).rejects.toThrow(/sign in/)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('does not accept settings/env user or credential fallbacks', async () => {
    change('user', undefined)
    mocks.values.set('settings.userId', 'user-a')
    mocks.values.set('auth.vectcut_api_key', jwt())
    await expect(service.getForCurrentSession()).rejects.toThrow(/sign in/)
    expect(mocks.accessToken).not.toHaveBeenCalled()
  })

  it.each([
    { token: 'oauth-runtime' },
    { token: jwt('user-a', { exp: 9999999999 }) },
    { token: jwt('user-b') },
    {},
    null
  ])('rejects invalid endpoint credentials without caching or leaking payloads', async (payload) => {
    mocks.fetch.mockResolvedValue(response(payload))
    await expect(service.getForCurrentSession()).rejects.toThrow('Unable to retrieve a long-lived API key for the current account')
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it('accepts the api_key response alias', async () => {
    mocks.fetch.mockResolvedValue(response({ api_key: jwt() }))
    expect((await service.getForCurrentSession()).key).toBe(jwt())
  })

  it('limits the authoritative endpoint request to 30 seconds', async () => {
    const controller = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
    try {
      mocks.fetch.mockResolvedValue(response({ token: jwt() }))
      await service.getForCurrentSession()
      expect(timeout).toHaveBeenCalledExactlyOnceWith(30_000)
      expect(mocks.fetch.mock.calls[0][1].signal).toBe(controller.signal)
    } finally {
      timeout.mockRestore()
    }
  })

  it('deduplicates requests across refresh-token rotation and preserves owner snapshots', async () => {
    const waiting = deferred<ReturnType<typeof response>>()
    mocks.fetch.mockReturnValue(waiting.promise)
    const owner = service.captureSession()
    const first = service.getForCurrentSession()
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1))
    change('auth.refresh_token', 'refresh-a-rotated')
    change('user', { id: 'user-a', name: 'updated' })
    const second = service.getForCurrentSession()
    expect(() => service.assertSession(owner)).not.toThrow()
    waiting.resolve(response({ token: jwt() }))
    const [left, right] = await Promise.all([first, second])
    expect(left.key).toBe(jwt())
    expect(right).toBe(left)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(() => service.assertSession(left.owner)).not.toThrow()
  })

  it('accepts normal rotation performed by ensureValidAccessToken itself', async () => {
    const owner = service.captureSession()
    mocks.accessToken.mockImplementation(async () => {
      change('auth.refresh_token', 'refresh-a-rotated')
      return 'oauth-runtime'
    })
    mocks.fetch.mockResolvedValue(response({ token: jwt() }))
    expect((await service.getForCurrentSession()).key).toBe(jwt())
    expect(() => service.assertSession(owner)).not.toThrow()
  })

  it.each(['sign-out', 'switch', 'sign-out-and-back', 'switch-and-back'])('invalidates an owner on %s, even before another getter runs', async (scenario) => {
    mocks.values.set('auth.vectcut_api_key', jwt())
    const { owner } = await service.getForCurrentSession()
    if (scenario.startsWith('sign-out')) {
      change('auth.refresh_token', undefined)
      if (scenario.endsWith('back')) change('auth.refresh_token', 'refresh-a-new-login')
    } else {
      change('user', { id: 'user-b' })
      if (scenario.endsWith('back')) change('user', { id: 'user-a' })
    }
    expect(() => service.assertSession(owner)).toThrow(/session changed/)
  })

  it('rejects forged and different-service snapshots', () => {
    const owner = service.captureSession()
    expect(() => service.assertSession({ ...owner })).toThrow(/session changed/)
    expect(() => new AccountApiKeyService().assertSession(owner)).toThrow(/session changed/)
  })

  it('does not call the key endpoint if the account changes while obtaining OAuth', async () => {
    const waiting = deferred<string>()
    mocks.accessToken.mockReturnValue(waiting.promise)
    const pending = service.getForCurrentSession()
    change('user', { id: 'user-b' })
    waiting.resolve('oauth-a')
    await expect(pending).rejects.toThrow(/session changed/)
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it.each(['response', 'json'])('rejects account changes while awaiting endpoint %s without poisoning the new account', async (phase) => {
    const waiting = deferred<any>()
    const staleResponse = response({ token: jwt() })
    if (phase === 'json') {
      staleResponse.json.mockReturnValue(waiting.promise)
      mocks.fetch.mockResolvedValue(staleResponse)
    } else {
      mocks.fetch.mockReturnValue(waiting.promise)
    }
    const pending = service.getForCurrentSession()
    await vi.waitFor(() => expect(phase === 'json' ? staleResponse.json : mocks.fetch).toHaveBeenCalledTimes(1))
    change('user', { id: 'user-b' })
    change('auth.refresh_token', 'refresh-b')
    waiting.resolve(phase === 'json' ? { token: jwt() } : staleResponse)
    await expect(pending).rejects.toThrow(/session changed/)
    expect(mocks.set).not.toHaveBeenCalled()
    mocks.fetch.mockResolvedValue(response({ token: jwt('user-b') }))
    expect((await service.getForCurrentSession()).key).toBe(jwt('user-b'))
  })

  it('sanitizes transport/auth failures and allows retry after failure', async () => {
    mocks.fetch.mockRejectedValueOnce(new Error('sensitive-token-and-backend-body'))
    await expect(service.getForCurrentSession()).rejects.toThrow('Unable to retrieve a long-lived API key for the current account')
    mocks.fetch.mockResolvedValue(response({ token: jwt() }))
    expect((await service.getForCurrentSession()).key).toBe(jwt())
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
  })

  it('rejects non-OK responses without reading their body', async () => {
    const failed = response({ token: jwt() }, false)
    mocks.fetch.mockResolvedValue(failed)
    await expect(service.getForCurrentSession()).rejects.toThrow(/Unable to retrieve/)
    expect(failed.json).not.toHaveBeenCalled()
    expect(mocks.set).not.toHaveBeenCalled()
  })
})
