import { describe, expect, it } from 'vitest';
import { buildDigitalHumanRequestApiCurl, normalizeDigitalHumanRequestPayload } from './digitalHumanRequest';

describe('normalizeDigitalHumanRequestPayload', () => {
  it('normalizes all three shortcut modes', () => {
    expect(normalizeDigitalHumanRequestPayload({
      mode: 'lip-sync',
      copywriting: '口型文案',
      voiceId: 'voice-1',
      videoUrl: '/tmp/person.mp4',
    })).toMatchObject({
      mode: 'lip_sync',
      copywriting: '口型文案',
      voice_id: 'voice-1',
      video_url: '/tmp/person.mp4',
    });

    expect(normalizeDigitalHumanRequestPayload({
      mode: 'jimeng-avatar',
      copywriting: '图片文案',
      voice_id: 'voice-2',
      image_url: 'https://example.com/person.png',
      prompt: '自然口播',
      output_resolution: 1080,
    })).toMatchObject({
      mode: 'omni',
      prompt: '自然口播',
      output_resolution: 1080,
    });

    expect(normalizeDigitalHumanRequestPayload({
      mode: 'seedance-avatar',
      copywriting: '图片文案',
      voice_id: 'voice-3',
      image_url: 'https://example.com/person.jpg',
    })).toMatchObject({
      mode: 'seedance',
      voice_id: 'voice-3',
    });
  });

  it('rejects requests missing the mode-specific source', () => {
    expect(normalizeDigitalHumanRequestPayload({
      mode: 'lip_sync',
      copywriting: '文案',
      voice_id: 'voice-1',
    })).toBeNull();
  });

  it('builds the documented API request for each mode', () => {
    const lipSyncCurl = buildDigitalHumanRequestApiCurl({
      mode: 'lip_sync',
      copywriting: '口型文案',
      voice_id: 'voice-1',
      video_url: 'https://example.com/person.mp4',
    });
    expect(lipSyncCurl).toContain('/cut_jianying/digital_human/create');
    expect(lipSyncCurl).toContain('"audio_url": "<generated_audio_url>"');

    const omniCurl = buildDigitalHumanRequestApiCurl({
      mode: 'omni',
      copywriting: '图片文案',
      voice_id: 'voice-2',
      image_url: 'https://example.com/person.png',
      prompt: '自然口播',
      output_resolution: 720,
    });
    expect(omniCurl).toContain('/cut_jianying/digital_human/omni/submit');
    expect(omniCurl).toContain('"output_resolution": 720');

    const seedanceCurl = buildDigitalHumanRequestApiCurl({
      mode: 'seedance',
      copywriting: '图片文案',
      voice_id: 'voice-3',
      image_url: 'https://example.com/person.jpg',
    });
    expect(seedanceCurl).toContain('/llm/digital_human/seedance/submit');
    expect(seedanceCurl).toContain('"copywriting": "图片文案"');
    expect(seedanceCurl).not.toContain('generated_audio_url');
  });
});
