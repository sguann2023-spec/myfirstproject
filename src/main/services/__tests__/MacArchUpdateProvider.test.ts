import { HttpError } from 'builder-util-runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

import MacArchUpdateProvider from '../MacArchUpdateProvider'

function mockProcessArch(arch: string) {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'arch')
  Object.defineProperty(process, 'arch', {
    configurable: true,
    value: arch
  })
  return () => {
    if (descriptor) {
      Object.defineProperty(process, 'arch', descriptor)
    }
  }
}

describe('MacArchUpdateProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses the arm64 manifest on Apple Silicon', async () => {
    const restoreArch = mockProcessArch('arm64')
    const provider = new MacArchUpdateProvider(
      { provider: 'generic', url: 'https://example.com/client/latest' },
      { channel: null, isAddNoCacheQuery: false } as any,
      { platform: 'darwin', executor: {} as any, isUseMultipleRangeRequest: false }
    )
    const httpRequest = vi
      .spyOn(provider as any, 'httpRequest')
      .mockResolvedValue(`version: 1.5.8
files:
  - url: VectCut-latest-arm64.zip
    sha512: test-sha
    size: 1
path: VectCut-latest-arm64.zip
sha512: test-sha
releaseDate: '2026-05-31T12:00:36.000Z'`)

    const result = await provider.getLatestVersion()

    expect(result.files?.[0]?.url).toBe('VectCut-latest-arm64.zip')
    expect(httpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        href: 'https://example.com/client/latest/latest-mac-arm64.yml'
      })
    )
    restoreArch()
  })

  it('falls back to the legacy manifest for x64 when x64 manifest is missing', async () => {
    const restoreArch = mockProcessArch('x64')
    const provider = new MacArchUpdateProvider(
      { provider: 'generic', url: 'https://example.com/client/latest' },
      { channel: null, isAddNoCacheQuery: false } as any,
      { platform: 'darwin', executor: {} as any, isUseMultipleRangeRequest: false }
    )
    const httpRequest = vi.spyOn(provider as any, 'httpRequest')

    httpRequest
      .mockRejectedValueOnce(new HttpError(404, 'missing x64 manifest'))
      .mockResolvedValueOnce(`version: 1.5.8
files:
  - url: VectCut-latest-x64.zip
    sha512: test-sha
    size: 1
path: VectCut-latest-x64.zip
sha512: test-sha
releaseDate: '2026-05-31T12:00:36.000Z'`)

    const result = await provider.getLatestVersion()

    expect(result.files?.[0]?.url).toBe('VectCut-latest-x64.zip')
    expect(httpRequest).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        href: 'https://example.com/client/latest/latest-mac-x64.yml'
      })
    )
    expect(httpRequest).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        href: 'https://example.com/client/latest/latest-mac.yml'
      })
    )
    restoreArch()
  })
})
