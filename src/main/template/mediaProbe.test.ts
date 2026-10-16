import { execFile } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { hydrateMediaDurations } from './mediaProbe'

vi.mock('node:child_process', () => ({
  execFile: vi.fn((_file, _args, _options, callback) => callback(null, { stdout: JSON.stringify({ format: { duration: '3.25' } }) }))
}))

describe('媒体源时长探测', () => {
  it('分析已有模板时自动补齐音视频素材 duration', async () => {
    const template = {
      materials: {
        videos: [
          { id: 'photo', type: 'photo', path: '/tmp/image.png' },
          { id: 'video', type: 'video', path: '/tmp/video.mp4' }
        ],
        audios: [{ id: 'audio', type: 'audio', path: '/tmp/audio.mp3' }]
      },
      scenes: []
    }
    const result = await hydrateMediaDurations({ templateJson: JSON.stringify(template) })
    const hydrated = JSON.parse(result.payload.templateJson)
    expect(result.changed).toBe(true)
    expect(hydrated.materials.videos[0].duration).toBeUndefined()
    expect(hydrated.materials.videos[1].duration).toBe(3_250_000)
    expect(hydrated.materials.audios[0].duration).toBe(3_250_000)
    expect(execFile).toHaveBeenCalledTimes(2)
  })
})
