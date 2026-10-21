import fs from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { execMock } = vi.hoisted(() => ({ execMock: vi.fn() }))
vi.mock('node:child_process', () => ({ execFile: execMock }))
vi.mock('@main/utils', () => ({ getResourcePath: () => '/tmp' }))
import { prepareAudioUnderstanding, prepareSubtitleAudio } from '../prepare-subtitle-audio'

function source(duration: number | undefined, audio = true) {
  execMock.mockImplementation((_command, args, _options, callback) => {
    if (args.includes('-show_entries')) {
      callback(null, { stdout: JSON.stringify({ format: { duration }, streams: [{ codec_type: audio ? 'audio' : 'video' }] }), stderr: '' })
    } else {
      fs.writeFile(args.at(-1), 'audio').then(() => callback(null, { stdout: '', stderr: '' }))
    }
  })
}

describe('分析音频预处理', () => {
  beforeEach(() => vi.clearAllMocks())
  it.each([30, 900, 900.01, 10000])('时长 %s 秒时只提取最多 15 分钟', async (duration) => {
    source(duration)
    const result = await prepareAudioUnderstanding('/tmp/source.mp4')
    try {
      expect(result.durationSeconds).toBe(duration)
      expect(result.analyzedDurationSeconds).toBe(Math.min(duration, 899.9))
      expect(result.truncated).toBe(duration > 899.9)
      const args = execMock.mock.calls[1][1]
      expect(args.slice(args.indexOf('-t'), args.indexOf('-t') + 2)).toEqual(['-t', String(Math.min(duration, 899.9))])
      expect(args).toContain('96k')
      expect(args).not.toContain('-af')
    } finally {
      await result.cleanup()
    }
    await expect(fs.stat(result.audioPath)).rejects.toThrow()
  })

  it('原字幕识别仍拒绝超过两小时，不增加截断参数', async () => {
    source(7201)
    await expect(prepareSubtitleAudio('/tmp/source.mp4')).rejects.toThrow('2 小时')
    source(100)
    const result = await prepareSubtitleAudio('/tmp/source.mp4')
    try {
      expect(execMock.mock.calls[execMock.mock.calls.length - 1][1]).toContain('-q:a')
      expect(execMock.mock.calls[execMock.mock.calls.length - 1][1]).not.toContain('-t')
    } finally {
      await result.cleanup()
    }
  })

  it('拒绝未知时长及无音轨素材', async () => {
    source(undefined)
    await expect(prepareAudioUnderstanding('/tmp/source.mp4')).rejects.toThrow('时长')
    source(10, false)
    await expect(prepareAudioUnderstanding('/tmp/source.mp4')).rejects.toThrow('音轨')
  })

  it('执行失败清理临时目录', async () => {
    source(1300)
    const probe = execMock.getMockImplementation()!
    let output = ''
    execMock.mockImplementation((command, args, options, callback) => {
      if (args.includes('-show_entries')) return probe(command, args, options, callback)
      output = args.at(-1)
      callback(new Error('ffmpeg failed'))
    })
    await expect(prepareAudioUnderstanding('/tmp/source.mp4')).rejects.toThrow('ffmpeg failed')
    await expect(fs.stat(output.substring(0, output.lastIndexOf('/')))).rejects.toThrow()
  })

  it('取消后不运行探测或转换', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(prepareAudioUnderstanding('/tmp/source.mp4', controller.signal)).rejects.toThrow()
    expect(execMock).not.toHaveBeenCalled()
  })
})
