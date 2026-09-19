import { lookup } from 'node:dns/promises'
import { connect as tcpConnect } from 'node:net'
import { connect as tlsConnect } from 'node:tls'

export type CheckStatus = 'pass' | 'warning' | 'fail' | 'skipped'
export type CheckItem = {
  id: string
  status: CheckStatus
  reason: string
  value?: string
  durationMs?: number
}
export type NetworkCheckTarget = {
  endpoint: string
  source: 'model' | 'gateway'
  proxyUrl?: string
  bypassed?: boolean
  accessToken?: string
}
export type NetworkCheckReport = {
  checkedAt: string
  endpoint: string
  host: string
  source: 'model' | 'gateway'
  proxy: string
  status: CheckStatus
  checks: CheckItem[]
}

const TIMEOUT_MS = 6000
const CHAT_HEALTH_PATHS = ['/llm/chat/healthy', '/cut_jianying/llm/chat/healthy']

type HttpProbeResult = number | { status: number; healthy: boolean }

export function withNetworkCheckDeadline<T>(promise: Promise<T>, timeoutMs = TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs)
    promise.then(resolve, reject).finally(() => clearTimeout(timer))
  })
}

function connection(host: string, port: number, secure: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = secure
      ? tlsConnect({ host, port, servername: host, rejectUnauthorized: true })
      : tcpConnect({ host, port })
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error('timeout'))
    }, TIMEOUT_MS)
    const finish = (error?: Error) => {
      clearTimeout(timer)
      socket.destroy()
      if (error) reject(error)
      else resolve()
    }
    socket.once(secure ? 'secureConnect' : 'connect', () => finish())
    socket.once('error', finish)
  })
}

// Uses the same global Node dispatcher configured by ProxyManager as the chat runtime.
function probeAccessToken(endpoint: string, accessToken?: string): string | undefined {
  if (new URL(endpoint).origin !== 'https://open.vectcut.com') return undefined
  return typeof accessToken === 'string' && accessToken.length <= 32768 && /^[A-Za-z0-9._~-]+$/.test(accessToken)
    ? accessToken : undefined
}

async function probeHttp(endpoint: string, accessToken?: string): Promise<HttpProbeResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const token = probeAccessToken(endpoint, accessToken)
  const url = new URL(endpoint)
  const isChatHealth = url.origin === 'https://open.vectcut.com' && CHAT_HEALTH_PATHS.includes(url.pathname)
  try {
    const response = await fetch(endpoint, {
      method: isChatHealth ? 'GET' : 'HEAD',
      redirect: 'manual',
      signal: controller.signal,
      headers: { Accept: '*/*', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
    })
    if (isChatHealth && response.status === 200) {
      let payload: { ok?: unknown; service?: unknown } | null = null
      try {
        payload = await response.json()
      } catch (error) {
        if (controller.signal.aborted) throw error
      }
      return { status: response.status, healthy: payload?.ok === true && payload?.service === 'llm_chat' }
    }
    await response.body?.cancel()
    return response.status
  } finally {
    clearTimeout(timer)
  }
}

export const networkCheckProbes = {
  lookup: (host: string) => lookup(host, { all: true }),
  connect: connection,
  http: probeHttp
}

function safeTarget(raw: string): URL {
  const target = new URL(raw)
  if (!['https:', 'http:'].includes(target.protocol)) throw new Error('Unsupported protocol')
  target.username = ''
  target.password = ''
  target.search = ''
  target.hash = ''
  if (target.origin === 'https://open.vectcut.com' && /^\/(?:cut_jianying\/)?llm\/chat(?:\/|$)/.test(target.pathname)) {
    target.pathname = target.pathname.startsWith('/cut_jianying/')
      ? '/cut_jianying/llm/chat/healthy' : '/llm/chat/healthy'
  }
  return target
}

function safeErrorReason(error: unknown, fallback: string): string {
  const value = error as { code?: string; message?: string; cause?: { code?: string } }
  const code = String(value?.code || value?.cause?.code || '')
  if (/CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code)) return 'certificate'
  if (/TIMEOUT|TIMEDOUT/.test(code) || value?.message === 'timeout' || (error as Error)?.name === 'AbortError') {
    return 'timeout'
  }
  return fallback
}

export async function runNetworkCheck(
  input: NetworkCheckTarget,
  probes = networkCheckProbes
): Promise<NetworkCheckReport> {
  const target = safeTarget(input.endpoint)
  const targetHost = target.hostname.replace(/^\[|\]$/g, '')
  const port = Number(target.port || (target.protocol === 'https:' ? 443 : 80))
  let proxy: URL | undefined
  let invalidProxy = false
  if (input.proxyUrl && !input.bypassed) {
    try {
      proxy = new URL(input.proxyUrl)
      if (!['http:', 'https:', 'socks:', 'socks4:', 'socks4a:', 'socks5:', 'socks5h:'].includes(proxy.protocol)) {
        throw new Error('Unsupported proxy')
      }
    } catch {
      invalidProxy = true
      proxy = undefined
    }
  }
  const routeHost = proxy ? proxy.hostname.replace(/^\[|\]$/g, '') : targetHost
  const routePort = proxy
    ? Number(proxy.port || (proxy.protocol === 'https:' ? 443 : proxy.protocol.startsWith('socks') ? 1080 : 80))
    : port
  const proxyItem: CheckItem = {
    id: 'proxy',
    status: invalidProxy ? 'fail' : 'pass',
    reason: invalidProxy ? 'proxy_invalid' : proxy ? 'proxy_active' : input.bypassed ? 'proxy_bypassed' : 'direct',
    value: proxy ? `${proxy.protocol}//${proxy.host}` : undefined
  }
  const measure = async (id: string, probe: () => Promise<Partial<CheckItem>>, fallback: string): Promise<CheckItem> => {
    const start = performance.now()
    try {
      return { id, status: 'pass', reason: `${id}_ok`, ...await withNetworkCheckDeadline(probe()), durationMs: Math.round(performance.now() - start) }
    } catch (error) {
      return { id, status: 'fail', reason: safeErrorReason(error, fallback), durationMs: Math.round(performance.now() - start) }
    }
  }
  const skipped = (id: string): Promise<CheckItem> =>
    Promise.resolve({ id, status: 'skipped', reason: 'proxy_invalid' })
  const dns = invalidProxy ? skipped('dns') : measure('dns', async () => {
    const addresses = await probes.lookup(routeHost)
    if (!addresses.length) throw new Error('No addresses')
    return { reason: proxy ? 'dns_proxy_ok' : 'dns_ok', value: addresses.map((item) => item.address).join(', ') }
  }, 'dns_failed')
  const tcp = invalidProxy ? skipped('tcp') : measure('tcp', async () => {
    await probes.connect(routeHost, routePort, false)
    return { reason: proxy ? 'tcp_proxy_ok' : 'tcp_ok', value: `${routeHost}:${routePort}` }
  }, 'tcp_failed')
  // Direct TLS cannot represent a proxied route; the HTTP probe validates TLS through the proxy.
  const tls: Promise<CheckItem> = proxy || invalidProxy || target.protocol !== 'https:'
    ? Promise.resolve({ id: 'tls', status: 'skipped', reason: proxy ? 'tls_via_proxy' : 'tls_skipped' })
    : measure('tls', async () => {
      await probes.connect(targetHost, port, true)
      return {}
    }, 'tls_failed')
  const http = invalidProxy
    ? Promise.resolve<CheckItem>({ id: 'http', status: 'skipped', reason: 'proxy_invalid' })
    : measure('http', async () => {
      const token = probeAccessToken(target.toString(), input.accessToken)
      const result = await (token ? probes.http(target.toString(), token) : probes.http(target.toString()))
      const status = typeof result === 'number' ? result : result.status
      const value = `HTTP ${status}`
      if (typeof result !== 'number' && !result.healthy) {
        return { status: 'fail', reason: 'health_invalid', value }
      }
      if (token && (status === 401 || status === 403)) {
        return { status: 'warning', reason: 'auth_rejected', value }
      }
      if (status === 407) return { status: 'fail', reason: 'proxy_auth', value }
      if (status >= 500) return { status: 'fail', reason: 'server_error', value }
      if (status >= 300) return { status: 'warning', reason: 'http_reachable', value }
      return { reason: 'http_ok', value }
    }, 'http_failed')
  const checks = [proxyItem, ...await Promise.all([dns, tcp, tls, http])]
  const status = checks.some((item) => item.status === 'fail') ? 'fail'
    : checks.some((item) => item.status === 'warning') ? 'warning' : 'pass'
  return {
    checkedAt: new Date().toISOString(),
    endpoint: target.toString(),
    host: `${target.hostname}:${port}`,
    source: input.source,
    proxy: proxy ? `${proxy.protocol}//${proxy.host}` : '',
    status,
    checks
  }
}
