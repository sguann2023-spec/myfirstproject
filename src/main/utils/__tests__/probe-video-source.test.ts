import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { execMock } = vi.hoisted(() => ({ execMock: vi.fn() }))

vi.mock('node:child_process', () => ({ execFile: execMock }))
vi.mock('@main/utils', () => ({ getResourcePath: () => '/tmp' }))

import { probeVideoSource } from '../prepare-subtitle-audio'

function setProbeResult(data: unknown) {
  execMock.mockImplementation((_command, _args, _options, callback) =>
    callback(null, { stdout: JSON.stringify(data), stderr: '' })
  )
}

describe('probeVideoSource', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it.each([
    { code: 'EBADARCH' }, { errno: 'EBADARCH' }, { code: -86 }, { errno: -86 },
    new Error('spawn Unknown system error -86')
  ])('reports architecture incompatibility instead of a duration error: %s', async (error) => {
    execMock.mockImplementation((_command, _args, _options, callback) => callback(error))
    await expect(probeVideoSource('/tmp/video.mp4', 600)).rejects.toThrow('ffprobe 组件架构不兼容')
    expect(execMock).toHaveBeenCalledTimes(1)
  })

  it.each(['darwin', 'win32'] as const)('prefers installed, then controlled resources, then legacy fallbacks on %s', async (platform) => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!
    const originalArch = Object.getOwnPropertyDescriptor(process, 'arch')!
    Object.defineProperty(process, 'platform', { configurable: true, value: platform })
    Object.defineProperty(process, 'arch', { configurable: true, value: 'arm64' })
    const original = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
    Object.defineProperty(process, 'resourcesPath', { configurable: true, value: '/app/resources' })
    try {
      const name = platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
      const packaged = platform === 'darwin'
        ? path.join('/app/resources', '..', 'Frameworks', 'ffprobe', platform, 'arm64', name)
        : path.join('/app/resources', 'ffprobe', platform, 'arm64', name)
      const development = path.join('/tmp', 'ffmpeg', platform, 'arm64', name)
      const bundled = createRequire(import.meta.url)('ffprobe-static').path
      const unpacked = bundled.replace(/app\.asar([\\/])/g, 'app.asar.unpacked$1')
      const exists = vi.spyOn(fs, 'existsSync')
      setProbeResult({ streams: [{ codec_type: 'video' }], format: { duration: 30 } })
      const candidates = [...new Set([packaged, development, bundled, unpacked])]
      for (let index = 0; index <= candidates.length; index++) {
        exists.mockImplementation((candidate) => candidates.slice(index).includes(String(candidate)))
        await probeVideoSource('/tmp/video.mp4', 600)
        expect(execMock.mock.lastCall?.[0]).toBe(candidates[index] || 'ffprobe')
      }
    } finally {
      Object.defineProperty(process, 'platform', originalPlatform)
      Object.defineProperty(process, 'arch', originalArch)
      if (original) Object.defineProperty(process, 'resourcesPath', original)
      else delete (process as Partial<NodeJS.Process>).resourcesPath
    }
  })

  it('accepts a video at exactly ten minutes', async () => {
    setProbeResult({ streams: [{ codec_type: 'video' }], format: { duration: '600' } })
    await expect(probeVideoSource('https://example.com/video.mp4', 600)).resolves.toBe(600)
    expect(execMock.mock.calls[0][1]).toContain('https://example.com/video.mp4')
  })

  it('rejects video longer than ten minutes', async () => {
    setProbeResult({ streams: [{ codec_type: 'video' }], format: { duration: '600.001' } })
    await expect(probeVideoSource('/tmp/video.mp4', 600)).rejects.toThrow('10 分钟')
  })

  it('rejects audio-only files and streams with unknown duration', async () => {
    setProbeResult({ streams: [{ codec_type: 'audio' }], format: { duration: '30' } })
    await expect(probeVideoSource('/tmp/audio.mp4', 600)).rejects.toThrow('仅支持视频')
    setProbeResult({ streams: [{ codec_type: 'video' }] })
    await expect(probeVideoSource('https://example.com/image.jpg', 600)).rejects.toThrow('无法读取视频时长')
  })

  it('rejects sources that cannot be probed', async () => {
    execMock.mockImplementation((_command, _args, _options, callback) => callback(new Error('network unavailable')))
    await expect(probeVideoSource('https://example.com/missing.mp4', 600)).rejects.toThrow('无法读取视频信息')
  })
})
