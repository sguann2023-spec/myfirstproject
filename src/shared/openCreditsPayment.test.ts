import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openCreditsPayment } from './openCreditsPayment'

const mocks = vi.hoisted(() => ({ token: vi.fn(), get: vi.fn() }))
vi.mock('../auth/tokenStore', () => ({ tokenStore: { ensureValidAccessToken: mocks.token } }))
vi.mock('./electronStore', () => ({ electronStore: { get: mocks.get } }))

const internal = vi.fn()
const external = vi.fn()
const browser = vi.fn()
beforeEach(() => {
  vi.resetAllMocks()
  mocks.token.mockResolvedValue(' jwt-token ')
  mocks.get.mockReturnValue({ name: ' Test User ', avatar: 'https://example.com/a?b=c', email: 'a+b@example.com' })
  Object.assign(window, { api: { openInternalWebsite: internal }, require: () => ({ shell: { openExternal: external } }), open: browser })
})

describe('openCreditsPayment', () => {
  it('passes the same login information in the fragment and refreshes credits', async () => {
    const refresh = vi.fn()
    await openCreditsPayment(refresh)
    expect(refresh).toHaveBeenCalledOnce()
    const url = new URL(internal.mock.calls[0][0])
    expect(url.origin + url.pathname).toBe('https://www.vectcut.com/redeem/payment')
    expect(url.search).toBe('')
    expect(Object.fromEntries(new URLSearchParams(url.hash.slice(1)))).toEqual({
      jwt: 'jwt-token', name: 'Test User', avatar: 'https://example.com/a?b=c', email: 'a+b@example.com'
    })
    expect(external).not.toHaveBeenCalled()
    expect(browser).not.toHaveBeenCalled()
  })

  it('awaits rejected bridges and falls back with the same authenticated URL', async () => {
    internal.mockRejectedValue(new Error('internal unavailable'))
    external.mockRejectedValue(new Error('shell unavailable'))
    await openCreditsPayment()
    const url = internal.mock.calls[0][0]
    expect(external).toHaveBeenCalledWith(url)
    expect(browser).toHaveBeenCalledWith(url, '_blank', 'noopener,noreferrer')
  })

  it('stops after a successful external fallback', async () => {
    internal.mockRejectedValue(new Error('unavailable'))
    await openCreditsPayment()
    expect(external).toHaveBeenCalledOnce()
    expect(browser).not.toHaveBeenCalled()
  })

  it.each([null, '  '])('opens without a fragment when no valid token exists: %j', async (token) => {
    mocks.token.mockResolvedValue(token)
    await openCreditsPayment()
    expect(internal).toHaveBeenCalledWith('https://www.vectcut.com/redeem/payment')
  })

  it('still opens when token retrieval or the refresh callback fails', async () => {
    mocks.token.mockRejectedValue(new Error('expired'))
    await openCreditsPayment(() => { throw new Error('refresh failed') })
    expect(internal).toHaveBeenCalledWith('https://www.vectcut.com/redeem/payment')
  })

  it('uses the browser when neither electron bridge exists', async () => {
    Object.assign(window, { api: {}, require: () => { throw new Error('no electron') } })
    await openCreditsPayment()
    expect(browser).toHaveBeenCalledOnce()
    expect(browser.mock.calls[0][0]).toContain('#jwt=jwt-token')
  })
})
