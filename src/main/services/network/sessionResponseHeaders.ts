import type { Session } from 'electron'
import { normalizeResponseHeaders } from './responseHeaders'

// Electron supports only ONE onHeadersReceived listener per session. Keep the
// existing document-policy and embedding behavior in this same owner.
const policies = new WeakMap<Session, { documentPolicy: boolean; allowEmbedding: boolean }>()
export function installSessionResponseHeaders(session: Session, options: { documentPolicy?: boolean; allowEmbedding?: boolean } = {}) {
  const existing = policies.get(session)
  if (existing) {
    existing.documentPolicy ||= Boolean(options.documentPolicy)
    existing.allowEmbedding ||= Boolean(options.allowEmbedding)
    return
  }
  const policy = { documentPolicy: Boolean(options.documentPolicy), allowEmbedding: Boolean(options.allowEmbedding) }
  policies.set(session, policy)
  session.webRequest.onHeadersReceived((details, callback) => {
    const headers = normalizeResponseHeaders(details.responseHeaders)
    // Never silently remove a malformed field (it might be security-sensitive).
    // Cancel through Chromium's normal network error path, not an exception in
    // Electron's asynchronous Headers.set callback.
    if (Object.entries(details.responseHeaders ?? {}).some(([name, values]) => headers[name]?.length !== values.length)) {
      callback({ cancel: true })
      return
    }
    for (const name of Object.keys(headers)) {
      if (policy.allowEmbedding && ['x-frame-options', 'content-security-policy'].includes(name.toLowerCase())) delete headers[name]
      if (policy.documentPolicy && name.toLowerCase() === 'document-policy') delete headers[name]
    }
    if (policy.documentPolicy) headers['Document-Policy'] = ['include-js-call-stacks-in-crash-reports']
    callback({ cancel: false, responseHeaders: headers })
  })
}
