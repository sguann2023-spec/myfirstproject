import type { Event, WebContents } from 'electron'

const WEBVIEW_PROTOCOLS = new Set(['http:', 'https:', 'file:', 'blob:', 'data:'])
const guardedContents = new WeakSet<WebContents>()

export function isAllowedWebviewUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return WEBVIEW_PROTOCOLS.has(parsed.protocol) ||
      (parsed.protocol === 'about:' && ['blank', 'srcdoc'].includes(parsed.pathname))
  } catch {
    return false
  }
}

/** Install before the first load so page scripts cannot launch native applications. */
export function attachWebviewNavigationGuards(contents: WebContents) {
  if (contents.isDestroyed() || guardedContents.has(contents)) return
  guardedContents.add(contents)

  const preventAppLaunch = (event: Event & { url?: string }, url?: string) => {
    if (!isAllowedWebviewUrl(event.url ?? url ?? '')) {
      event.preventDefault()
    }
  }

  contents.on('will-navigate', preventAppLaunch)
  contents.on('will-frame-navigate', preventAppLaunch)
  contents.on('will-redirect', preventAppLaunch)
  contents.setWindowOpenHandler(({ url }) => ({
    action: isAllowedWebviewUrl(url) ? 'allow' : 'deny'
  }))
  // Allowed web popups must not become an escape hatch for native protocols.
  contents.on('did-create-window', (window) => {
    attachWebviewNavigationGuards(window.webContents)
  })
}
