import { describe, expect, it } from 'vitest'
import { isVectcutGatewayUrl } from '../gatewayAuth'

describe('isVectcutGatewayUrl', () => {
  it.each([
    'https://open.vectcut.com',
    'https://open.vectcut.com/v1/anthropic',
    'https://OPEN.VECTCUT.COM/path?query=1'
  ])('trusts HTTPS exact gateway hostname: %s', (url) => {
    expect(isVectcutGatewayUrl(url)).toBe(true)
  })

  it.each([
    '', 'open.vectcut.com', 'not-a-url/open.vectcut.com',
    'http://open.vectcut.com', 'ftp://open.vectcut.com',
    'https://open.vectcut.com.evil.example', 'https://sub.open.vectcut.com',
    'https://open.vectcut.com@evil.example', 'https://evil.example/open.vectcut.com',
    'https://open.vectcut.com.', 'https://[invalid'
  ])('rejects non-gateway or invalid URL: %s', (url) => {
    expect(isVectcutGatewayUrl(url)).toBe(false)
  })
})
