import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { networkCheckProbes, runNetworkCheck } from '../NetworkCheckService'

const target = { endpoint: 'https://example.com/api', source: 'model' as const }
const mockProbes = () => ({
  lookup: vi.fn().mockResolvedValue([{ address: '192.0.2.1', family: 4 }]),
  connect: vi.fn().mockResolvedValue(undefined),
  http: vi.fn().mockResolvedValue(200)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('NetworkCheckService', () => {
  it('runs all direct checks and records real results', async () => {
    const probes = mockProbes()
    const report = await runNetworkCheck(target, probes)
    expect(report.status).toBe('pass')
    expect(report.checks.map((item) => item.id)).toEqual(['proxy', 'dns', 'tcp', 'tls', 'http'])
    expect(probes.connect).toHaveBeenCalledWith('example.com', 443, true)
    expect(report.checks.find((item) => item.id === 'http')?.value).toBe('HTTP 200')
  })

  it.each([301, 400, 401, 403, 404, 405, 429])('treats HTTP %s as reachable, not a broken network', async (status) => {
    const probes = mockProbes()
    probes.http.mockResolvedValue(status)
    const report = await runNetworkCheck(target, probes)
    expect(report.status).toBe('warning')
    expect(report.checks.find((item) => item.id === 'http')?.reason).toBe('http_reachable')
  })

  it('passes the login token only to the official HTTPS probe and never returns it', async () => {
    const probes = mockProbes()
    const endpoint = 'https://open.vectcut.com/llm/chat'
    const report = await runNetworkCheck({ ...target, endpoint, accessToken: 'test.access.token' }, probes)
    expect(probes.http).toHaveBeenCalledExactlyOnceWith(`${endpoint}/healthy`, 'test.access.token')
    expect(report.endpoint).toBe(`${endpoint}/healthy`)
    expect(JSON.stringify(report)).not.toContain('test.access.token')
  })

  it.each([
    'http://open.vectcut.com/llm/chat',
    'https://open.vectcut.com.evil.example/llm/chat',
    'https://open.vectcut.com:8443/llm/chat',
    'https://example.com/api'
  ])('does not send the login token to %s', async (endpoint) => {
    const probes = mockProbes()
    await runNetworkCheck({ ...target, endpoint, accessToken: 'test.access.token' }, probes)
    expect(probes.http).toHaveBeenCalledExactlyOnceWith(endpoint)
  })

  it.each([401, 403])('explains HTTP %s when the request carries a token', async (status) => {
    const probes = mockProbes()
    probes.http.mockResolvedValue(status)
    const report = await runNetworkCheck({
      ...target, endpoint: 'https://open.vectcut.com/llm/chat', accessToken: 'test.access.token'
    }, probes)
    expect(report.checks.find((item) => item.id === 'http')?.reason).toBe('auth_rejected')
  })

  it('adds the Bearer header without following redirects or calling a model', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 302 }))
    vi.stubGlobal('fetch', fetch)
    await networkCheckProbes.http('https://open.vectcut.com/llm/chat/healthy', 'test.access.token')
    expect(fetch).toHaveBeenCalledExactlyOnceWith('https://open.vectcut.com/llm/chat/healthy', expect.objectContaining({
      method: 'GET',
      redirect: 'manual',
      headers: { Accept: '*/*', Authorization: 'Bearer test.access.token' }
    }))
  })

  it('enforces the origin restriction inside the actual HTTP probe too', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    await networkCheckProbes.http('https://example.com/api', 'test.access.token')
    expect(fetch.mock.calls[0][1].headers).toEqual({ Accept: '*/*' })
    expect(fetch.mock.calls[0][1].method).toBe('HEAD')
  })

  it.each([
    ['/llm/chat', '/llm/chat/healthy'],
    ['/llm/chat/', '/llm/chat/healthy'],
    ['/llm/chat/v1', '/llm/chat/healthy'],
    ['/llm/chat/v1/chat/completions', '/llm/chat/healthy'],
    ['/llm/chat/healthy', '/llm/chat/healthy'],
    ['/cut_jianying/llm/chat/v1', '/cut_jianying/llm/chat/healthy']
  ])('resolves the configured chat path %s to %s', async (path, expected) => {
    const probes = mockProbes()
    const report = await runNetworkCheck({ ...target, endpoint: `https://open.vectcut.com${path}` }, probes)
    expect(report.endpoint).toBe(`https://open.vectcut.com${expected}`)
    expect(probes.http).toHaveBeenCalledExactlyOnceWith(report.endpoint)
  })

  it('accepts the Flask healthy endpoint response without calling a model', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true, service: 'llm_chat', ts: 1789800000 }))
    vi.stubGlobal('fetch', fetch)
    const report = await runNetworkCheck({
      ...target, endpoint: 'https://open.vectcut.com/llm/chat/v1', accessToken: 'test.access.token'
    }, { ...mockProbes(), http: networkCheckProbes.http })
    expect(report.status).toBe('pass')
    expect(report.checks.find((item) => item.id === 'http')?.value).toBe('HTTP 200')
    expect(fetch).toHaveBeenCalledExactlyOnceWith('https://open.vectcut.com/llm/chat/healthy', expect.objectContaining({
      method: 'GET',
      headers: { Accept: '*/*', Authorization: 'Bearer test.access.token' }
    }))
  })

  it.each([
    '{"ok":false,"service":"llm_chat"}',
    '{"ok":true,"service":"other_service"}',
    '<html>Sign in</html>',
    'null'
  ])('does not report a healthy service for an unexpected HTTP 200 body: %s', async (body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 200 })))
    const report = await runNetworkCheck({
      ...target, endpoint: 'https://open.vectcut.com/llm/chat'
    }, { ...mockProbes(), http: networkCheckProbes.http })
    expect(report.checks.find((item) => item.id === 'http')?.reason).toBe('health_invalid')
    expect(report.status).toBe('fail')
  })

  it.each([[503, 'server_error'], [407, 'proxy_auth']] as const)('explains HTTP %s failures', async (status, reason) => {
    const probes = mockProbes()
    probes.http.mockResolvedValue(status)
    const report = await runNetworkCheck(target, probes)
    expect(report.status).toBe('fail')
    expect(report.checks.find((item) => item.id === 'http')?.reason).toBe(reason)
  })

  it('checks the proxy route without bypassing it for direct TLS', async () => {
    const probes = mockProbes()
    const report = await runNetworkCheck({ ...target, proxyUrl: 'http://user:password@127.0.0.1:7890' }, probes)
    expect(probes.lookup).toHaveBeenCalledWith('127.0.0.1')
    expect(probes.connect).toHaveBeenCalledExactlyOnceWith('127.0.0.1', 7890, false)
    expect(probes.http).toHaveBeenCalledWith(target.endpoint)
    expect(report.checks.find((item) => item.id === 'tls')?.reason).toBe('tls_via_proxy')
    expect(JSON.stringify(report)).not.toContain('password')
    expect(report.proxy).toBe('http://127.0.0.1:7890')
  })

  it('uses a direct route for proxy bypass rules', async () => {
    const probes = mockProbes()
    const report = await runNetworkCheck({ ...target, proxyUrl: 'http://proxy:7890', bypassed: true }, probes)
    expect(report.proxy).toBe('')
    expect(report.checks[0].reason).toBe('proxy_bypassed')
    expect(probes.lookup).toHaveBeenCalledWith('example.com')
  })

  it('does not silently bypass an invalid proxy', async () => {
    const probes = mockProbes()
    const report = await runNetworkCheck({ ...target, proxyUrl: 'invalid proxy' }, probes)
    expect(report.status).toBe('fail')
    expect(probes.http).not.toHaveBeenCalled()
    expect(probes.connect).not.toHaveBeenCalled()
    expect(probes.lookup).not.toHaveBeenCalled()
  })

  it('strips credentials, query parameters and fragments before probing or displaying', async () => {
    const probes = mockProbes()
    const report = await runNetworkCheck({ ...target, endpoint: 'https://user:secret@example.com/api?token=secret#private' }, probes)
    expect(report.endpoint).toBe(target.endpoint)
    expect(probes.http).toHaveBeenCalledWith(target.endpoint)
    expect(JSON.stringify(report)).not.toContain('secret')
  })

  it('maps DNS and certificate failures to safe reason codes', async () => {
    const probes = mockProbes()
    probes.lookup.mockRejectedValue(new Error('secret raw error'))
    probes.http.mockRejectedValue({ cause: { code: 'CERT_HAS_EXPIRED' } })
    const report = await runNetworkCheck(target, probes)
    expect(report.checks.find((item) => item.id === 'dns')?.reason).toBe('dns_failed')
    expect(report.checks.find((item) => item.id === 'http')?.reason).toBe('certificate')
    expect(JSON.stringify(report)).not.toContain('secret raw error')
  })

  it('bounds stalled probes to six seconds', async () => {
    vi.useFakeTimers()
    const probes = mockProbes()
    probes.lookup.mockImplementation(() => new Promise(() => {}))
    const pending = runNetworkCheck(target, probes)
    await vi.advanceTimersByTimeAsync(6000)
    const report = await pending
    expect(report.checks.find((item) => item.id === 'dns')?.reason).toBe('timeout')
  })

  it('rejects non-HTTP targets', async () => {
    await expect(runNetworkCheck({ ...target, endpoint: 'file:///etc/hosts' }, mockProbes())).rejects.toThrow()
  })

  it('performs real DNS, TCP and an unauthenticated HEAD probe against a local service', async () => {
    const requests: Array<{ method?: string; url?: string; auth?: string }> = []
    const server = createServer((request, response) => {
      requests.push({ method: request.method, url: request.url, auth: request.headers.authorization })
      response.writeHead(401)
      response.end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const port = (server.address() as AddressInfo).port
      const report = await runNetworkCheck({
        endpoint: `http://127.0.0.1:${port}/probe?token=secret`, source: 'model', accessToken: 'test.access.token'
      })
      expect(report.status).toBe('warning')
      expect(report.checks.find((item) => item.id === 'tcp')?.status).toBe('pass')
      expect(requests).toEqual([{ method: 'HEAD', url: '/probe', auth: undefined }])
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
