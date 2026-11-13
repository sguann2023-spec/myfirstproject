import { beforeEach, describe, expect, it, vi } from 'vitest'

const { execMock } = vi.hoisted(() => ({ execMock: vi.fn() }))
vi.mock('node:child_process', () => ({ execFile: execMock }))
vi.mock('../prepare-subtitle-audio', () => ({
  resolveFfmpegPath: () => 'test-ffmpeg',
  resolveFfprobePath: () => 'test-ffprobe'
}))

import { verifyPortraitMovAlpha } from '../verify-portrait-alpha'

const validProbe = () => ({
  // Test that an audio-first MOV still selects and maps the first VIDEO stream.
  streams: [
    { codec_type: 'audio', codec_name: 'aac', duration: '3.1' },
    { codec_type: 'video', codec_name: 'prores', codec_tag_string: 'ap4h', profile: '4444', pix_fmt: 'yuva444p12le', width: 1080, height: 1920, duration: '3.1' }
  ],
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '3.1' }
})
const actualAlpha = () => {
  const data = Buffer.alloc(96 * 96, 0)
  data.fill(255, data.length / 2)
  data[10] = 120
  return data
}
function setup(probe: unknown = validProbe(), alpha = actualAlpha()) {
  execMock.mockImplementation((command, _args, _options, callback) => callback(null, {
    stdout: command === 'test-ffprobe' ? JSON.stringify(probe) : alpha, stderr: ''
  }))
}

describe('verifyPortraitMovAlpha', () => {
  beforeEach(() => { vi.clearAllMocks(); setup() })

  it('verifies actual alpha samples, not just codec metadata or the extension', async () => {
    const controller = new AbortController()
    const result = await verifyPortraitMovAlpha('https://example.com/portrait.mov', controller.signal)
    expect(result).toMatchObject({
      format: 'MOV', codec: 'prores', codec_tag: 'ap4h', pixel_format: 'yuva444p12le',
      width: 1080, height: 1920, alpha_verified: true, jianying_compatible: true,
      alpha_verification: 'sampled_decoded_frames',
      alpha_samples: [
        { time_seconds: 0.31, min: 0, max: 255 },
        { time_seconds: 1.55, min: 0, max: 255 },
        { time_seconds: 2.79, min: 0, max: 255 }
      ]
    })
    expect(execMock).toHaveBeenCalledTimes(4)
    for (const [, args, options] of execMock.mock.calls.slice(1)) {
      expect(args).toContain('0:v:0')
      expect(args).toContain('alphaextract,scale=96:96,format=gray')
      expect(options).toMatchObject({ encoding: 'buffer', signal: controller.signal, timeout: 60_000 })
      expect(args.join(' ')).not.toContain('format=rgba,alphaextract')
    }
  })

  it.each([
    { codec_name: 'h264', codec_tag_string: 'avc1', pix_fmt: 'yuv420p' },
    { codec_name: 'prores', codec_tag_string: 'apcn', pix_fmt: 'yuv422p10le' },
    { codec_name: 'prores', codec_tag_string: 'ap4h', pix_fmt: 'yuv444p10le' },
    { codec_name: 'vp8', codec_tag_string: '', pix_fmt: 'yuv420p', tags: { alpha_mode: '1' } }
  ])('rejects incompatible video metadata without manufacturing alpha: %j', async invalid => {
    const probe = validProbe()
    Object.assign(probe.streams[1], invalid)
    setup(probe)
    await expect(verifyPortraitMovAlpha('/tmp/renamed.mov')).rejects.toThrow('ProRes 4444 MOV')
    expect(execMock).toHaveBeenCalledTimes(1)
  })

  it('accepts ProRes 4444 XQ when it really contains transparency', async () => {
    const probe = validProbe(); probe.streams[1].codec_tag_string = 'ap4x'
    setup(probe)
    await expect(verifyPortraitMovAlpha('/tmp/xq.mov')).resolves.toMatchObject({ codec_tag: 'ap4x', alpha_verified: true })
  })

  it.each([
    [255, '全部不透明'], [0, '全部透明']
  ])('rejects a fake or empty alpha plane (%s)', async (value, message) => {
    setup(validProbe(), Buffer.alloc(96 * 96, Number(value)))
    await expect(verifyPortraitMovAlpha('/tmp/fake.mov')).rejects.toThrow(String(message))
  })

  it('does not reject a valid clip solely because one sampled frame is opaque', async () => {
    let sample = 0
    execMock.mockImplementation((command, _args, _options, callback) => callback(null, {
      stdout: command === 'test-ffprobe' ? JSON.stringify(validProbe()) : ++sample === 1 ? Buffer.alloc(96 * 96, 255) : actualAlpha(), stderr: ''
    }))
    await expect(verifyPortraitMovAlpha('/tmp/cutout.mov')).resolves.toMatchObject({ alpha_verified: true })
  })

  it('rejects missing video, malformed output, unknown duration and oversize output', async () => {
    setup({ streams: [], format: { duration: 3 } })
    await expect(verifyPortraitMovAlpha('/tmp/a.mov')).rejects.toThrow('没有视频轨道')
    const probe = validProbe(); probe.format.duration = 'NaN'; probe.streams[1].duration = 'NaN'
    setup(probe)
    await expect(verifyPortraitMovAlpha('/tmp/a.mov')).rejects.toThrow('时长')
    probe.format.duration = '601'
    setup(probe)
    await expect(verifyPortraitMovAlpha('/tmp/a.mov')).rejects.toThrow('10 分钟')
    execMock.mockImplementation((_cmd, _args, _options, cb) => cb(null, { stdout: 'not JSON', stderr: '' }))
    await expect(verifyPortraitMovAlpha('/tmp/a.mov')).rejects.toThrow('无法解析')
  })

  it('rejects an undecodable/short alpha frame', async () => {
    setup(validProbe(), Buffer.alloc(100))
    await expect(verifyPortraitMovAlpha('/tmp/a.mov')).rejects.toThrow('无法解码')
  })

  it('propagates decoder failure instead of returning compatible=true', async () => {
    execMock.mockImplementation((cmd, _args, _options, cb) => cmd === 'test-ffprobe'
      ? cb(null, { stdout: JSON.stringify(validProbe()), stderr: '' })
      : cb(new Error('Requested planes not available')))
    await expect(verifyPortraitMovAlpha('/tmp/a.mov')).rejects.toThrow('planes not available')
  })

  it('honors cancellation before spawning processes', async () => {
    const controller = new AbortController(); controller.abort()
    await expect(verifyPortraitMovAlpha('/tmp/a.mov', controller.signal)).rejects.toThrow()
    expect(execMock).not.toHaveBeenCalled()
  })
})
