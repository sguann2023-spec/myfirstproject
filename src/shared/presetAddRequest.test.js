import { describe, expect, it } from 'vitest';
import { normalizePresetAddRequestPayload } from './presetAddRequest';
import { normalizeDirectPresetAddRequest } from '../main/services/agents/services/channels/presetAddRequest';

describe('预设添加请求提交链路', () => {
  it('把页面选择的动画和转场保留到主进程工具入参', () => {
    const composerRequest = {
      draftId: 'dfd_cat_1790262858_ffe2180c',
      presetId: '86fb3620-29f7-4370-bc6c-860e57a686a3',
      replacements: [{ text1: '关系 | 情绪 | 成长 | 认知 | 人生' }],
      target_start: 0,
      start: 0,
      end: 1,
      transform_x_px: 0,
      transform_y_px: 0,
      rotation: 0,
      scale_x: 1,
      scale_y: 1,
      relative_index: 8,
      track_name: 'preset_track_7',
      intro_animation: '旋转',
      intro_animation_duration: 0.5,
      outro_animation: '漩涡旋转',
      outro_animation_duration: 0.5,
      transition: '中心旋转',
      transition_duration: 0.5,
    };
    const expectedEffects = {
      intro_animation: '旋转',
      intro_animation_duration: 0.5,
      outro_animation: '漩涡旋转',
      outro_animation_duration: 0.5,
      transition: '中心旋转',
      transition_duration: 0.5,
    };
    const ipcPayload = normalizePresetAddRequestPayload(composerRequest);
    expect(ipcPayload).toMatchObject(expectedEffects);
    expect(normalizeDirectPresetAddRequest(ipcPayload)).toMatchObject({
      preset_id: composerRequest.presetId,
      draft_id: composerRequest.draftId,
      ...expectedEffects,
    });
  });

  it('未选择效果时不补出时长，并保留显式的 false 和 0', () => {
    expect(normalizePresetAddRequestPayload({ presetId: 'preset-1', draftId: 'draft-1' })).toEqual({
      draft_id: 'draft-1',
      preset_id: 'preset-1',
    });
    expect(normalizePresetAddRequestPayload({
      presetId: 'preset-1',
      draftId: 'draft-1',
      mask_invert: false,
      volume: 0,
    })).toMatchObject({ mask_invert: false, volume: 0 });
    expect(normalizePresetAddRequestPayload({ presetId: 'preset-1' })).toBeNull();
  });
});
