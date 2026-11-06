/** Preview only absolute local paths. Never accept remote URLs or read files into memory. */
export function localQuestionMedia(path: string) {
  if (!path || /[\x00-\x1f]/.test(path)) return undefined
  const windows = /^[a-z]:[\\/]/i.test(path)
  if (!windows && (!path.startsWith('/') || path.startsWith('//'))) return undefined
  const normalized = windows ? path.replace(/\\/g, '/') : path
  const url = new URL('file:///')
  // Assigning pathname encodes URL delimiters without interpreting them as query/hash.
  const encoded = normalized.split('/').map((segment, index) =>
    windows && index === 0 ? segment : encodeURIComponent(segment)
  ).join('/')
  url.pathname = (windows ? '/' : '') + encoded
  const ext = normalized.split('.').pop()?.toLowerCase()
  const kind = /^(png|jpe?g|gif|webp|avif|bmp)$/.test(ext ?? '') ? 'image'
    : /^(mp4|webm|mov|m4v|ogv)$/.test(ext ?? '') ? 'video'
      : /^(mp3|wav|ogg|m4a|aac|flac|opus)$/.test(ext ?? '') ? 'audio' : undefined
  return kind ? { kind, url: url.href } : undefined
}
