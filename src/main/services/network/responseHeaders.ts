// Chromium can expose decoded Unicode header values, but Electron's fetch bridge
// calls Headers.set (WebIDL ByteString) outside the fetch promise's rejection path.
const nonByteString = /[^\x00-\xff]/
const invalidField = /[\r\n\0]/

export function isDeterministicHeaderError(message: string): boolean {
  return /ByteString|ERR_BLOCKED_BY_CLIENT/.test(message)
}

export function contentDispositionFilename(value: string): string | undefined {
  const extended = /(?:^|;)\s*filename\*\s*=\s*UTF-8'[^']*'([^;]*)/i.exec(value)
  if (extended) {
    try { return decodeURIComponent(extended[1].trim()) } catch { /* use fallback */ }
  }
  const plain = /(?:^|;)\s*filename\s*=\s*(?:"((?:\\.|[^"\\])*)"|([^;]*))/i.exec(value)
  return plain ? (plain[1]?.replace(/\\(.)/g, '$1') ?? plain[2].trim()) : undefined
}

export function normalizeResponseHeaders(headers: Record<string, string[]> = {}): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  for (const [name, values] of Object.entries(headers)) {
    if (!/^[!#$%&'*+.^_`|~\w-]+$/.test(name)) continue
    const safe: string[] = []
    for (const value of values) {
      if (invalidField.test(value)) continue
      if (!nonByteString.test(value)) { safe.push(value); continue }
      if (name.toLowerCase() === 'content-disposition') {
        const filename = contentDispositionFilename(value)
        if (filename) {
          const fallback = filename.replace(/[^\x20-\x7e]|["\\]/g, '_')
          try {
            const encoded = encodeURIComponent(filename).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
            const disposition = /^\s*inline\b/i.test(value) ? 'inline' : 'attachment'
            safe.push(`${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`)
          } catch { /* reject malformed Unicode */ }
        }
      }
      // Unknown Unicode fields cannot safely be interpreted or truncated. Drop
      // the field value rather than altering security/authentication semantics.
    }
    if (safe.length) result[name] = safe
  }
  return result
}
