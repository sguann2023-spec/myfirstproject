import { describe, expect, it, vi } from 'vitest'
import { getStoredVectcutApiKey, getVectcutBackgroundAccountId, requestWithVectcutAuth } from '../vectcut-auth'

const store = (data: Record<string, unknown>) => ({ get: (key: string) => data[key] })
const response = (status: number) => ({ status } as Response)

describe('VectCut MCP authentication', () => {
  it('falls back to the stored API key without a refresh token', async () => {
    const refresh = vi.fn().mockRejectedValue(new Error('No refresh token found'))
    const fetch = vi.fn().mockResolvedValue(response(200))
    await requestWithVectcutAuth(store({ 'auth.vectcut_api_key': 'api-key' }), refresh, fetch)
    expect(fetch).toHaveBeenCalledWith('api-key')
  })

  it('preserves OAuth priority and refreshes a rejected token', async () => {
    const refresh = vi.fn().mockResolvedValueOnce('oauth-old').mockResolvedValueOnce('oauth-new')
    const fetch = vi.fn().mockResolvedValueOnce(response(401)).mockResolvedValueOnce(response(200))
    await requestWithVectcutAuth(store({ 'auth.vectcut_api_key': 'api-key' }), refresh, fetch)
    expect(fetch.mock.calls.map(([token]) => token)).toEqual(['oauth-old', 'oauth-new'])
    expect(refresh).toHaveBeenLastCalledWith(true)
  })

  it('uses API key when forced OAuth refresh fails', async () => {
    const refresh = vi.fn().mockResolvedValueOnce('oauth-old').mockRejectedValueOnce(new Error('invalid_grant'))
    const fetch = vi.fn().mockResolvedValueOnce(response(401)).mockResolvedValueOnce(response(200))
    await requestWithVectcutAuth(store({ 'auth.vectcut_api_key': 'api-key' }), refresh, fetch)
    expect(fetch.mock.calls.map(([token]) => token)).toEqual(['oauth-old', 'api-key'])
  })

  it('returns API key rejection without retrying the same unauthorized key', async () => {
    const fetch = vi.fn().mockResolvedValue(response(401))
    const result = await requestWithVectcutAuth(
      store({ 'auth.vectcut_api_key': 'bad-key' }),
      vi.fn().mockRejectedValue(new Error('No refresh token found')), fetch
    )
    expect(result.status).toBe(401)
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('does not suppress missing credentials', async () => {
    const fetch = vi.fn()
    await expect(requestWithVectcutAuth(store({}),
      vi.fn().mockRejectedValue(new Error('No refresh token found')), fetch))
      .rejects.toThrow('No refresh token found')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('resolves login profiles and isolates API-key-only tasks without exposing secrets', () => {
    expect(getVectcutBackgroundAccountId(store({ user: { id: 'logged-in' }, 'settings.userId': 'legacy' })))
      .toBe('logged-in')
    expect(getVectcutBackgroundAccountId(store({ 'settings.userId': 'legacy' }))).toBe('legacy')
    const first = getVectcutBackgroundAccountId(store({ 'auth.vectcut_api_key': 'secret-a' }))
    expect(first).toMatch(/^api-key:[a-f0-9]{64}$/)
    expect(first).not.toContain('secret-a')
    expect(getVectcutBackgroundAccountId(store({ 'auth.vectcut_api_key': 'secret-b' }))).not.toBe(first)
    expect(getStoredVectcutApiKey(store({ user: { agentApiKey: 'profile-key' } }))).toBe('profile-key')
  })
})
