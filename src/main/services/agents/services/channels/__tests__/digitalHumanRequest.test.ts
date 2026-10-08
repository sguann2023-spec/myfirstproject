import { describe, expect, it } from 'vitest'
import { isDirectDigitalHumanResponseComplete, normalizeDirectDigitalHumanRequest } from '../digitalHumanRequest'

describe('normalizeDirectDigitalHumanRequest', () => {
  it('keeps only normalized direct request fields', () => {
    expect(normalizeDirectDigitalHumanRequest({
      mode: 'jimeng-avatar',
      copywriting: '  测试文案  ',
      voiceId: ' voice-1 ',
      voiceProvider: ' minimax ',
      imageUrl: ' https://example.com/avatar.png ',
      prompt: ' 自然口播 ',
      outputResolution: 720
    })).toEqual({
      mode: 'omni',
      copywriting: '测试文案',
      voice_id: 'voice-1',
      voice_provider: 'minimax',
      image_url: 'https://example.com/avatar.png',
      prompt: '自然口播',
      output_resolution: 720
    })
  })

  it('requires a video source for lip sync mode', () => {
    expect(() => normalizeDirectDigitalHumanRequest({
      mode: 'lip_sync',
      copywriting: '测试文案',
      voice_id: 'voice-1'
    })).toThrow('video_url is required')
  })

  it('allows lip-sync direct request success only at task_status 1', () => {
    expect(isDirectDigitalHumanResponseComplete('lip_sync', {
      task_status: 5,
      digital_human_url: 'https://example.com/non-terminal-result.mp4'
    })).toBe(false)
    expect(isDirectDigitalHumanResponseComplete('lip_sync', {
      task_status: 1
    })).toBe(true)
  })
})
