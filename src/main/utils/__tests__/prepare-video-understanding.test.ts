import fs from 'node:fs/promises'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { execMock } = vi.hoisted(() => ({ execMock: vi.fn() }))
vi.mock('node:child_process', () => ({ execFile: execMock }))
vi.mock('@main/utils', () => ({ getResourcePath: () => '/tmp' }))
import { prepareVideoUnderstanding } from '../prepare-subtitle-audio'

function mockVideo(duration = 120, codec = 'video') {
  execMock.mockImplementation((_command, args, _options, callback) => {
    if (args.includes('-show_entries')) {
      callback(null, { stdout: JSON.stringify({ format: { duration }, streams: [{ codec_type: codec }] }), stderr: '' })
    } else {
      fs.writeFile(args[args.length - 1], 'compressed').then(() => callback(null, { stdout: '', stderr: '' }))
    }
  })
}

describe('Omni 视频压缩', () => {
  beforeEach(() => vi.resetAllMocks())
  it.each([30, 120])('允许 %s 秒视频，缩放为 720p 保留音轨，不抽帧', async (duration) => {
    mockVideo(duration)
    const result = await prepareVideoUnderstanding('/tmp/source.mp4')
    try {
      const args = execMock.mock.calls[1][1]
      expect(result.durationSeconds).toBe(duration)
      expect(args).toContain('0:a:0?')
      expect(args).toContain('libx264')
      expect(args).toContain('aac')
      expect(args[args.indexOf('-vf') + 1]).toContain('min(720,ih)')
      expect(args[args.indexOf('-vf') + 1]).toContain('min(720,iw)')
      expect(args).not.toContain('-r')
      expect(args).not.toContain('-an')
      expect(execMock).toHaveBeenCalledTimes(3)
    } finally {
      await result.cleanup()
    }
    await expect(fs.stat(result.videoPath)).rejects.toThrow()
  })

  it('大于 120 秒时禁止转换', async () => {
    mockVideo(120.001)
    await expect(prepareVideoUnderstanding('/tmp/source.mp4')).rejects.toThrow('2 分钟')
    expect(execMock).toHaveBeenCalledTimes(1)
  })

  it('拒绝非视频', async () => {
    mockVideo(30, 'audio')
    await expect(prepareVideoUnderstanding('/tmp/source.mp3')).rejects.toThrow('仅支持视频')
  })

  it('转换失败清理临时目录', async () => {
    mockVideo()
    const original = execMock.getMockImplementation()!
    let output = ''
    execMock.mockImplementation((command, args, options, callback) => {
      if (args.includes('-show_entries')) return original(command, args, options, callback)
      output = args[args.length - 1]
      callback(new Error('conversion failed'))
    })
    await expect(prepareVideoUnderstanding('/tmp/source.mp4')).rejects.toThrow('conversion failed')
    await expect(fs.stat(path.dirname(output))).rejects.toThrow()
  })

  it('超过 20MB 时清理文件并拒绝上传', async () => {
    mockVideo()
    const original = execMock.getMockImplementation()!
    let output = ''
    execMock.mockImplementation((command, args, options, callback) => {
      if (args.includes('-show_entries')) return original(command, args, options, callback)
      output = args[args.length - 1]
      fs.writeFile(output, Buffer.alloc(20 * 1024 * 1024 + 1)).then(() => callback(null, { stdout: '', stderr: '' }))
    })
    await expect(prepareVideoUnderstanding('/tmp/source.mp4')).rejects.toThrow('20MB')
    await expect(fs.stat(path.dirname(output))).rejects.toThrow()
  })
})
