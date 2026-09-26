import { beforeEach, describe, expect, it, vi } from 'vitest'

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
