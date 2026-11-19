type JwtObject = Record<string, unknown>

export function normalizeAccountUserId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function decodeJwtObject(segment: string): JwtObject | null {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(segment) || segment.length % 4 === 1) return null
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/')
    const bytes = Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')), (char) => char.charCodeAt(0))
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as JwtObject) : null
  } catch {
    return null
  }
}

/** Decoding is a shape/ownership guard only; it does not verify a JWT signature. */
export function isLongLivedAccountApiKey(value: unknown, userId: unknown): value is string {
  const ownerId = normalizeAccountUserId(userId)
  if (!ownerId || typeof value !== 'string') return false
  const parts = value.trim().split('.')
  if (parts.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(parts[2]) || parts[2].length % 4 === 1) return false
  const header = decodeJwtObject(parts[0])
  const claims = decodeJwtObject(parts[1])
  return Boolean(
    header?.alg === 'RS256' &&
      claims &&
      typeof claims.sub === 'string' &&
      claims.sub === ownerId &&
      claims.iat === 0 &&
      !Object.prototype.hasOwnProperty.call(claims, 'exp')
  )
}

export function normalizeAccountApiKey(value: unknown, userId: unknown): string {
  return isLongLivedAccountApiKey(value, userId) ? value.trim() : ''
}

/** Legacy aliases are accepted only when the credential itself belongs to this user. */
export function findCachedAccountApiKey(candidates: unknown[], userId: unknown): string {
  for (const candidate of candidates) {
    const key = normalizeAccountApiKey(candidate, userId)
    if (key) return key
  }
  return ''
}
