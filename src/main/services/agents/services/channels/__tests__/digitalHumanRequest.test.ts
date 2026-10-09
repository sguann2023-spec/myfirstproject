import { describe, expect, it } from 'vitest'
import {
  buildDirectDigitalHumanPackagingArgs,
  buildPackagedDraftExportArgs,
  isDirectDigitalHumanResponseComplete,
  mapDirectRequestStageProgress,
  normalizeDirectDigitalHumanRequest
} from '../digitalHumanRequest'

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

  it('keeps only supported smart packaging templates', () => {
    const request = {
      mode: 'seedance',
      copywriting: '必须原样传给包装接口的文案',
      voice_id: 'voice-1',
      image_url: 'https://example.com/avatar.png'
    }

    expect(normalizeDirectDigitalHumanRequest({
      ...request,
      packagingTemplate: 'knowledge_pip'
    })).toMatchObject({
      copywriting: '必须原样传给包装接口的文案',
      packaging_template: 'knowledge_pip'
    })
    expect(normalizeDirectDigitalHumanRequest({
      ...request,
      packagingTemplate: 'ai_trim_pauses'
    })).not.toHaveProperty('packaging_template')
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

  it('disables silence removal and keeps the original copywriting for smart packaging', () => {
    expect(buildDirectDigitalHumanPackagingArgs({
      template: 'fisheye_ins',
      videoUrl: 'https://example.com/result.mp4',
      copywriting: '必须原样传入的数字人文案'
    })).toEqual({
      template: 'fisheye_ins',
      videoUrl: 'https://example.com/result.mp4',
      textContent: '必须原样传入的数字人文案',
      params: {
        remove_silence: false
      }
    })
  })

  it('maps tool progress into the overall direct request stage', () => {
    expect(mapDirectRequestStageProgress(50, 100, 0.01, 0.7)).toBeCloseTo(0.355)
    expect(mapDirectRequestStageProgress(100, 100, 0.7, 0.99)).toBeCloseTo(0.99)
  })

  it('builds an automatic export request only from a packaged draft result', () => {
    expect(buildPackagedDraftExportArgs({
      output: {
        draft_id: 'dfd_packaged_1'
      }
    }, 'fisheye_ins')).toEqual({
      draftId: 'dfd_packaged_1',
      draftName: 'fisheye_ins 智能包装'
    })
    expect(buildPackagedDraftExportArgs({ output: {} }, 'fisheye_ins')).toBeNull()
  })
})
