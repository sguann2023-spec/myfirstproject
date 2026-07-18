export type WebviewRuntimeEnv = {
  VECTCUT_API_KEY: string
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

export function shouldExposeWebviewRuntimeEnv(rawUrl: string): boolean {
  try {
    const parsed = new URL(String(rawUrl || ''))
    if (parsed.protocol === 'file:') {
      return true
    }

    if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && LOOPBACK_HOSTS.has(parsed.hostname)) {
      return true
    }

    return false
  } catch {
    return false
  }
}

export function normalizeWebviewRuntimeEnv(env: Partial<WebviewRuntimeEnv> | null | undefined): WebviewRuntimeEnv {
  return {
    VECTCUT_API_KEY: String(env?.VECTCUT_API_KEY || '').trim()
  }
}
