import { describe, expect, it } from 'vitest'

import { findCachedAccountApiKey, isLongLivedAccountApiKey, normalizeAccountApiKey } from '../accountApiKey'

function jwt(claims: unknown, header: unknown = { alg: 'RS256', typ: 'JWT' }) {
  return `${Buffer.from(JSON.stringify(header)).toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.c2lnbmF0dXJl`
}

const validKey = jwt({ sub: 'user-a', iat: 0 })

describe('long-lived account credential shape/ownership guard (not signature verification)', () => {
  it('accepts the backend RS256/sub/iat:0/no-exp shape and normalizes outer whitespace', () => {
    expect(isLongLivedAccountApiKey(validKey, 'user-a')).toBe(true)
    expect(normalizeAccountApiKey(` ${validKey}\n`, 'user-a')).toBe(validKey)
    expect(isLongLivedAccountApiKey(jwt({ sub: '用户', iat: 0 }), '用户')).toBe(true)
  })

  it.each([
    ['OAuth expiry', jwt({ sub: 'user-a', iat: 0, exp: 9999999999 })],
    ['null expiry', jwt({ sub: 'user-a', iat: 0, exp: null })],
    ['missing issue marker', jwt({ sub: 'user-a' })],
    ['OAuth issue time', jwt({ sub: 'user-a', iat: 1 })],
    ['string issue time', jwt({ sub: 'user-a', iat: '0' })],
    ['another account', jwt({ sub: 'user-b', iat: 0 })],
    ['blank subject', jwt({ sub: ' ', iat: 0 })],
    ['non-string subject', jwt({ sub: 123, iat: 0 })],
    ['unsigned', jwt({ sub: 'user-a', iat: 0 }, { alg: 'none' })],
    ['wrong algorithm', jwt({ sub: 'user-a', iat: 0 }, { alg: 'HS256' })],
    ['opaque credential', 'opaque-access-token'],
    ['missing signature', `${validKey.split('.').slice(0, 2).join('.')}.`],
    ['extra segment', `${validKey}.extra`],
    ['bad encoding', 'not-json.invalid.signature'],
    ['array claims', jwt(['user-a'])],
    ['non-string key', { token: validKey }]
  ])('rejects %s', (_label, key) => {
    expect(isLongLivedAccountApiKey(key, 'user-a')).toBe(false)
    expect(normalizeAccountApiKey(key, 'user-a')).toBe('')
  })

  it('requires a signed-in owner and skips polluted legacy aliases', () => {
    expect(isLongLivedAccountApiKey(validKey, '')).toBe(false)
    expect(findCachedAccountApiKey([jwt({ sub: 'user-a', iat: 0, exp: 5 }), 'oauth', jwt({ sub: 'user-b', iat: 0 }), validKey], 'user-a')).toBe(validKey)
  })
})
