/**
 * Security utility functions for the main process.
 */

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'obsidian:'])
const ALLOWED_VECTCUT_DEEPLINK_ROUTES = new Set(['download'])

function tryParseUrl(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

/**
 * Check whether a URL is safe to open via shell.openExternal().
 *
 * Only http(s) and mailto links are allowed. This prevents attackers from
 * abusing custom protocol handlers (e.g. file://, ms-msdt:, calculator:)
 * to execute local files or launch arbitrary applications.
 *
 * @see https://benjamin-altpeter.de/shell-openexternal-dangers/
 */
export function isSafeExternalUrl(url: string): boolean {
  const parsed = tryParseUrl(url)
  return parsed ? ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol) : false
}

/**
 * Check whether a VectCut deeplink is safe to open via shell.openExternal().
 *
 * This is intentionally stricter than general web links: only the app-owned
 * `vectcut://download?...` route is allowed, which prevents arbitrary custom
 * protocol launches from being smuggled through a generic "open deeplink" tool.
 */
export function isSafeVectcutDeepLink(url: string): boolean {
  const parsed = tryParseUrl(url)
  if (!parsed) {
    return false
  }

  return parsed.protocol === 'vectcut:' && ALLOWED_VECTCUT_DEEPLINK_ROUTES.has(parsed.hostname.toLowerCase())
}
