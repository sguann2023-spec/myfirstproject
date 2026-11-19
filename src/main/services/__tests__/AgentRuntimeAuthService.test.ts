import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  listeners: new Map<string, Set<(value: unknown) => void>>(),
  set: vi.fn(),
  fetch: vi.fn()
}))
vi.mock('electron', () => ({ net: { fetch: mocks.fetch } }))
vi.mock('electron-store', () => ({
  default: class {
    get(key: string) { return mocks.values.get(key) }
    set(key: string, value: unknown) {
      mocks.set(key, value)
      mocks.values.set(key, value)
      mocks.listeners.get(key)?.forEach((callback) => callback(value))
    }
    onDidChange(key: string, callback: (value: unknown) => void) {
      if (!mocks.listeners.has(key)) mocks.listeners.set(key, new Set())
      mocks.listeners.get(key)!.add(callback)
    }
  }
}))

import { AgentRuntimeAuthService } from '../agents/services/AgentRuntimeAuthService'

let service: AgentRuntimeAuthService
beforeEach(() => {
  vi.clearAllMocks()
  mocks.listeners.clear()
  mocks.values.clear()
  mocks.values.set('auth.refresh_token', 'refresh-a')
  mocks.values.set('auth.vectcut_api_key', 'existing-long-lived-key')
  mocks.fetch.mockReset()
  service = new AgentRuntimeAuthService()
})

function tokenResponse(token = 'runtime-oauth', refresh = 'refresh-rotated') {
  return { ok: true, json: async () => ({ access_token: token, refresh_token: refresh, expires_in: 3600 }) }
}

describe('AgentRuntimeAuthService OAuth/API-key separation', () => {
  it('preserves refresh-token rotation, OAuth return/caching and never overwrites account API keys', async () => {
    mocks.fetch.mockResolvedValue(tokenResponse())
    expect(await service.ensureValidAccessToken()).toBe('runtime-oauth')
    expect(await service.ensureValidAccessToken()).toBe('runtime-oauth')
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mocks.set).toHaveBeenCalledExactlyOnceWith('auth.refresh_token', 'refresh-rotated')
    expect(mocks.values.get('auth.vectcut_api_key')).toBe('existing-long-lived-key')
    const [url, request] = mocks.fetch.mock.calls[0]
    expect(url).toBe('https://mlbd8l6vgi13-demo.authing.cn/oidc/token')
    expect(request.method).toBe('POST')
    expect(new URLSearchParams(request.body).get('refresh_token')).toBe('refresh-a')
  })

  it('preserves forced OAuth refresh without persisting access tokens', async () => {
    mocks.fetch.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(tokenResponse('oauth-new', 'refresh-new'))
    expect(await service.ensureValidAccessToken()).toBe('runtime-oauth')
    expect(await service.ensureValidAccessToken(true)).toBe('oauth-new')
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    expect(mocks.set.mock.calls.every(([key]) => key === 'auth.refresh_token')).toBe(true)
    expect(mocks.values.get('auth.vectcut_api_key')).toBe('existing-long-lived-key')
  })

  it('continues rejecting runtime OAuth use after sign-out', async () => {
    mocks.fetch.mockResolvedValue(tokenResponse())
    await service.ensureValidAccessToken()
    mocks.values.delete('auth.refresh_token')
    mocks.listeners.get('auth.refresh_token')?.forEach((callback) => callback(undefined))
    await expect(service.ensureValidAccessToken()).rejects.toThrow(/sign in/)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
})
