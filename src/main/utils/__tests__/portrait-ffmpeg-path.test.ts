import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
vi.mock('@main/utils', () => ({ getResourcePath: () => '/app/resources/resources' }))
vi.mock('../prepare-subtitle-audio', () => ({ resolveFfprobePath: () => 'unused' }))
vi.mock('../verify-portrait-alpha', () => ({ verifyPortraitMovAlpha: vi.fn() }))
import { resolvePortraitFfmpegPath } from '../prepare-portrait-mov'

describe('portrait bundled FFmpeg path', () => {
  it.each([['darwin', 'arm64', 'ffmpeg'], ['darwin', 'x64', 'ffmpeg'], ['win32', 'x64', 'ffmpeg.exe']])('uses bundled path on %s/%s', (platform, arch, binary) => {
    const platformDesc = Object.getOwnPropertyDescriptor(process, 'platform')!
    const archDesc = Object.getOwnPropertyDescriptor(process, 'arch')!
    const exists = vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    try {
      Object.defineProperty(process, 'platform', { configurable: true, value: platform })
      Object.defineProperty(process, 'arch', { configurable: true, value: arch })
      expect(resolvePortraitFfmpegPath()).toBe(path.join('/app/resources/resources', 'ffmpeg', platform, arch, binary))
      exists.mockReturnValue(false)
      expect(() => resolvePortraitFfmpegPath()).toThrow('不会回退到系统 FFmpeg')
    } finally {
      Object.defineProperty(process, 'platform', platformDesc)
      Object.defineProperty(process, 'arch', archDesc)
      exists.mockRestore()
    }
  })
})
