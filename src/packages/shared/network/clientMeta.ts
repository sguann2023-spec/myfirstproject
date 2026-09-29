export const CLIENT_TYPE_HEADER_NAME = 'X-Client-Type'
export const CLIENT_TYPE_QUERY_NAME = 'client_type'

export type ClientType = 'windows' | 'mac' | 'linux' | 'pc'

const pickString = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

export const resolveClientType = (): ClientType => {
  const nav = typeof globalThis !== 'undefined' ? (globalThis as { navigator?: any }).navigator : undefined
  const processPlatform =
    typeof globalThis !== 'undefined'
      ? (globalThis as { process?: { platform?: string } }).process?.platform
      : undefined

  const platform = pickString(nav?.userAgentData?.platform, nav?.platform, nav?.userAgent, processPlatform).toLowerCase()

  if (platform.includes('win')) return 'windows'
  if (platform.includes('mac') || platform.includes('darwin')) return 'mac'
  if (platform.includes('linux') || platform.includes('x11')) return 'linux'
  return 'pc'
}

export const isVectcutApiUrl = (input: unknown) => {
  try {
    const rawUrl = typeof input === 'string' || input instanceof URL ? input.toString() : (input as { url?: string })?.url
    if (!rawUrl) return false
    return new URL(rawUrl).origin === 'https://open.vectcut.com'
  } catch {
    return false
  }
}

export const withClientTypeHeader = (headers?: HeadersInit, clientType: ClientType = resolveClientType()) => {
  const nextHeaders = new Headers(headers || {})
  if (!nextHeaders.has(CLIENT_TYPE_HEADER_NAME)) {
    nextHeaders.set(CLIENT_TYPE_HEADER_NAME, clientType)
  }
  return nextHeaders
}

