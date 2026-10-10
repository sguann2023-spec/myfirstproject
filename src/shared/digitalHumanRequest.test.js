import { describe, expect, it } from 'vitest';
import { buildDigitalHumanRequestAgentPrompt, buildDigitalHumanRequestApiCurl, buildDigitalHumanRequestTextPrompt, normalizeDigitalHumanRequestPayload } from './digitalHumanRequest';

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

  it('keeps a supported smart packaging template and drops unsupported values', () => {
    const baseRequest = {
      mode: 'seedance',
      copywriting: '必须原样传给包装接口的文案',
      voice_id: 'voice-3',
      image_url: 'https://example.com/person.jpg',
    };

    expect(normalizeDigitalHumanRequestPayload({
      ...baseRequest,
      packaging_template: 'knowledge_pip',
    })).toMatchObject({
      copywriting: '必须原样传给包装接口的文案',
      packaging_template: 'knowledge_pip',
    });
    expect(normalizeDigitalHumanRequestPayload({
      ...baseRequest,
      packaging_template: 'ai_trim_pauses',
    })).not.toHaveProperty('packaging_template');
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

  it.each([
    ['lip_sync', '/cut_jianying/digital_human/task_status', '404756745e0', 'task_status=1'],
    ['omni', '/cut_jianying/digital_human/omni/task_status', '468131524e0', 'video_url'],
    ['seedance', '/llm/digital_human/seedance/task_status', '475739920e0', 'result.video_url'],
  ])('includes %s polling with and without packaging', (mode, endpoint, doc, completion) => {
    const request = {
      mode, copywriting: '文案', voice_id: 'voice-1',
      video_url: 'https://example.com/person.mp4',
      image_url: 'https://example.com/person.png',
    };
    for (const packaging_template of ['', 'fisheye_ins']) {
      const curl = buildDigitalHumanRequestApiCurl({ ...request, packaging_template });
      expect(curl).toContain(`${endpoint}?task_id=<digital_human_task_id>`);
      expect(curl).toContain(doc);
      expect(curl).toContain(completion);
      expect(curl).toContain('不要重复提交生成');
      expect(curl).not.toContain('\\\n\n--header');
      if (packaging_template) {
        expect(curl.indexOf(endpoint)).toBeLessThan(curl.indexOf('/cut_jianying/agent/submit_agent_task'));
        expect(curl).toContain('# 4.');
      } else {
        expect(curl).not.toContain('/cut_jianying/agent/');
      }
    }
  });

  it.each([
    ['lip_sync', 'videoUrl'],
    ['omni', 'imageUrl'],
    ['seedance', 'imageUrl'],
  ])('builds asynchronous Agent instructions for %s with packaging and export', (mode, sourceField) => {
    const prompt = buildDigitalHumanRequestAgentPrompt({
      mode,
      copywriting: '原始口播文案',
      voice_id: 'voice-1',
      video_url: 'https://example.com/person.mp4',
      image_url: 'https://example.com/person.png',
      prompt: '自然口播',
      output_resolution: 720,
      packaging_template: 'intellectual_red',
    }, 'message-123');
    expect(prompt).toContain('start_digital_human_task');
    expect(prompt).toContain('get_digital_human_job');
    expect(prompt).toContain(`"mode": "${mode}"`);
    expect(prompt).toContain('"requestId": "digital-human-message-123"');
    expect(prompt).toContain('"requestId": "digital-human-message-123-packaging"');
    expect(prompt).toContain(`"${sourceField}"`);
    expect(prompt).toContain('"voiceId": "voice-1"');
    expect(prompt).toContain('start_koubo_template_job');
    expect(prompt).toContain('get_koubo_template_job');
    expect(prompt).toContain('查询超时只重试查询');
    expect(prompt).toContain('"template": "intellectual_red"');
    expect(prompt).toContain('"videoUrl": "<generated_digital_human_url>"');
    expect(prompt).toContain('"textContent": "原始口播文案"');
    expect(prompt).toContain('"remove_silence": false');
    expect(prompt).toContain('export_draft');
    if (mode === 'omni') expect(prompt).toContain('"outputResolution": 720');
  });

  it.each(['lip_sync', 'omni', 'seedance'])('includes the complete workflow in default %s text', (mode) => {
    const prompt = buildDigitalHumanRequestTextPrompt({
      mode,
      copywriting: '姐妹们，来试试美甲。',
      voice_id: 'voice-1',
      video_url: 'https://example.com/person.mp4',
      image_url: 'https://example.com/person.png',
      prompt: '自然口播',
      output_resolution: 720,
      packaging_template: 'fisheye_ins',
    });
    expect(prompt).toContain('完成智能包装并导出成片');
    expect(prompt).toContain('说话内容：姐妹们，来试试美甲。');
    expect(prompt).toContain('音色ID：voice-1');
    expect(prompt).toContain('submit_koubo_template_task');
    expect(prompt).toContain('template="fisheye_ins"');
    expect(prompt).toContain('不是原人物视频');
    expect(prompt).toContain('textContent 原样传入');
    expect(prompt).toContain('params={"remove_silence":false}');
    expect(prompt).toContain('export_draft');
    if (mode === 'omni') expect(prompt).toContain('输出分辨率：720p');
  });

  it('keeps default text generation-only when packaging is not selected', () => {
    const prompt = buildDigitalHumanRequestTextPrompt({
      mode: 'lip_sync',
      copywriting: '文案',
      voice_id: 'voice-1',
      video_url: '/tmp/person.mp4',
    });
    expect(prompt).toContain('create_lip_sync_digital_human');
    expect(prompt).toContain('人物视频：/tmp/person.mp4');
    expect(prompt).not.toContain('submit_koubo_template_task');
    expect(prompt).not.toContain('export_draft');
    expect(buildDigitalHumanRequestTextPrompt({})).toBe('');
  });

  it('does not request packaging or export without a selected template', () => {
    const request = {
      mode: 'lip_sync',
      copywriting: '原始口播文案',
      voice_id: 'voice-1',
      video_url: 'https://example.com/person.mp4',
    };
    expect(buildDigitalHumanRequestAgentPrompt(request)).not.toContain('submit_koubo_template_task');
    expect(buildDigitalHumanRequestAgentPrompt(request)).not.toContain('export_draft');
    expect(buildDigitalHumanRequestApiCurl(request)).not.toContain('submit_agent_task');
    expect(buildDigitalHumanRequestAgentPrompt({})).toBe('');
  });

  it('keeps Agent request IDs stable across copies and distinct per message', () => {
    const request = {
      mode: 'lip_sync', copywriting: '原文案', voice_id: 'voice-1',
      video_url: 'https://example.com/person.mp4', voice_provider: 'elevenlabs',
    };
    const first = buildDigitalHumanRequestAgentPrompt(request, 'message-a');
    expect(buildDigitalHumanRequestAgentPrompt(request, 'message-a')).toBe(first);
    expect(buildDigitalHumanRequestAgentPrompt(request, 'message-b')).not.toBe(first);
    expect(first).toContain('"provider": "elevenlabs"');
    expect(first).not.toContain('create_lip_sync_digital_human');
    expect(first).not.toContain('start_koubo_template_job');
  });

  it.each(['lip_sync', 'omni', 'seedance'])('includes packaging submission and polling in %s API display', (mode) => {
    const curl = buildDigitalHumanRequestApiCurl({
      mode,
      copywriting: "It's 原始口播文案",
      voice_id: 'voice-1',
      video_url: 'https://example.com/person.mp4',
      image_url: 'https://example.com/person.png',
      packaging_template: 'intellectual_red',
    });
    expect(curl).toContain('/cut_jianying/agent/submit_agent_task');
    expect(curl).toContain('"agent_id": "koubo_f47ac10b58cc4372a5670e02b2c3d479"');
    expect(curl).toContain('<generated_digital_human_url>');
    expect(curl).toContain('"text_content": "It\'\\\'\'s 原始口播文案"');
    expect(curl).toContain('"remove_silence": false');
    expect(curl).toContain('/cut_jianying/agent/task_status?task_id=<packaging_task_id>');
    expect(curl).toContain('output.draft_id');
  });
});
