import { describe, expect, it } from 'vitest'
import { contentDispositionFilename, isDeterministicHeaderError, normalizeResponseHeaders } from './responseHeaders'
import { installSessionResponseHeaders } from './sessionResponseHeaders'
import type { Session } from 'electron'

describe('Electron response header boundary', () => {
  const filename = 'QA2_口播字幕贴纸.mp4'
  const disposition = `attachment; filename="${filename}"`
  it('reproduces the exact ByteString failure before normalization', () => {
    expect(disposition.charCodeAt(26)).toBe(21475)
    expect(() => new Headers({ 'content-disposition': disposition })).toThrow(/ByteString/)
  })
  it('preserves the Unicode filename via RFC 8187 and an ASCII fallback', () => {
    const safe = normalizeResponseHeaders({ 'Content-Disposition': [disposition] })
    expect(() => new Headers(safe as any)).not.toThrow()
    expect(safe['Content-Disposition'][0]).toContain('filename="QA2_______.mp4"')
    expect(contentDispositionFilename(safe['Content-Disposition'][0])).toBe(filename)
  })
  it('parses escaped, unquoted, extended and malformed extended filenames', () => {
    expect(contentDispositionFilename('attachment; filename="a\\"b.mp4"; size=2')).toBe('a"b.mp4')
    expect(contentDispositionFilename('attachment; filename=a.mp4; size=2')).toBe('a.mp4')
    expect(contentDispositionFilename("attachment; filename=a.mp4; filename*=UTF-8''%ZZ")).toBe('a.mp4')
  })
  it('preserves legitimate byte values and rejects unknown Unicode and injection', () => {
    const headers = normalizeResponseHeaders({ 'X-Bytes': ['\xff'], 'X-Bad': ['中文'], 'X-Test': ['a\r\nb'], 'Content-Type': ['video/mp4'] })
    expect(headers).toEqual({ 'X-Bytes': ['\xff'], 'Content-Type': ['video/mp4'] })
    expect(() => new Headers(headers as any)).not.toThrow()
  })
  it('does not retry deterministic conversion failures or guard cancellation', () => {
    expect(isDeterministicHeaderError('Cannot convert argument to a ByteString')).toBe(true)
    expect(isDeterministicHeaderError('net::ERR_BLOCKED_BY_CLIENT')).toBe(true)
    expect(isDeterministicHeaderError('net::ERR_CONNECTION_RESET')).toBe(false)
  })
  it('cancels unknown Unicode fields rather than stripping security semantics', () => {
    let listener: any
    const session = { webRequest: { onHeadersReceived(fn: any) { listener = fn } } } as unknown as Session
    installSessionResponseHeaders(session)
    listener({ responseHeaders: { 'X-Unknown': ['中文'] } }, (result: any) => expect(result).toEqual({ cancel: true }))
  })
  it('composes session policies without overwriting its single listener', () => {
    let listener: any
    let registrations = 0
    const session = { webRequest: { onHeadersReceived(fn: any) { registrations++; listener = fn } } } as unknown as Session
    installSessionResponseHeaders(session)
    installSessionResponseHeaders(session, { allowEmbedding: true })
    installSessionResponseHeaders(session, { documentPolicy: true })
    expect(registrations).toBe(1)
    listener({ responseHeaders: { 'CONTENT-SECURITY-POLICY': ['test'], 'Content-Disposition': [disposition] } }, (result: any) => {
      expect(result.responseHeaders['CONTENT-SECURITY-POLICY']).toBeUndefined()
      expect(result.responseHeaders['Document-Policy']).toBeDefined()
      expect(contentDispositionFilename(result.responseHeaders['Content-Disposition'][0])).toBe(filename)
    })
  })
})
