import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import PresetAddDetail, { PRESET_TRANSITION_OPTIONS, buildPresetAddRequestParams, buildPresetAddSettingsPrompt } from './index';
import { isAudioFile, isImageFile, isVideoFile } from './PresetReplacementPanel';
import { queryScript } from '../../api/capcut';

vi.mock('./PresetCanvas', () => ({ default: () => <div aria-label="预设画布" /> }));

vi.mock('../../api/capcut', () => ({
  queryScript: vi.fn(async () => ({ output: { tracks: [] } })),
}));
vi.mock('../DraftSelect/index', () => ({ default: () => <button>Draft</button> }));
vi.mock('../PresetList/PresetList', () => ({
  default: ({ onSelect }) => (
    <button data-testid="preset-option" onClick={() => onSelect({ preset_id: 'preset-1', name: 'Preset 1' })}>
      Preset 1
    </button>
  ),
}));

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = () => ({
    matches: false, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {},
  });
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

let root;
let host;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
  root = null;
});

async function mount(props = {}) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<PresetAddDetail selectedDraftIds={['draft-1']} {...props} />));
}

const click = async (element) => act(async () => element.click());
const query = (selector) => document.querySelector(selector);

describe('preset settings alignment', () => {
  it('只在启用并选择效果时提交接口支持的动画和转场字段', () => {
    const selected = {
      introAnimation: { enabled: true, animation: '渐显', duration: 0.7 },
      outroAnimation: { enabled: true, animation: '渐隐', duration: 0.8 },
      transition: { enabled: true, transition: '叠化', duration: 0.5 },
    };
    const params = buildPresetAddRequestParams(selected);
    expect(params).toMatchObject({
      intro_animation: '渐显', intro_animation_duration: 0.7,
      outro_animation: '渐隐', outro_animation_duration: 0.8,
      transition: '叠化', transition_duration: 0.5,
    });
    expect(params).not.toHaveProperty('intro_duration');
    expect(params).not.toHaveProperty('group_animation');
    expect(buildPresetAddSettingsPrompt(selected)).toContain('"intro_animation_duration":0.7');
    expect(buildPresetAddRequestParams({
      ...selected,
      introAnimation: { ...selected.introAnimation, enabled: false },
      outroAnimation: { ...selected.outroAnimation, animation: '' },
      transition: { ...selected.transition, enabled: false },
    })).not.toHaveProperty('transition');
    expect(buildPresetAddRequestParams({
      ...selected,
      introAnimation: { ...selected.introAnimation, enabled: false },
      outroAnimation: { ...selected.outroAnimation, animation: '' },
      transition: { ...selected.transition, enabled: false },
    })).not.toHaveProperty('intro_animation');
  });

  it('转场选项仅使用效果名，不包含生成数据中的注释', () => {
    expect(PRESET_TRANSITION_OPTIONS.find((option) => option.label === '叠化').value).toBe('叠化');
    expect(PRESET_TRANSITION_OPTIONS.every((option) => !option.value.includes('\n'))).toBe(true);
  });

  it('displays preset replacement elements and includes their values in the add request', async () => {
    const onSettingsChange = vi.fn();
    await mount({
      selectedPreset: {
        preset_id: 'preset-with-materials',
        name: 'Preset',
        duration_seconds: 8,
        materials_json: [
          { id: 'text-1', type: 'text', name: '标题', content: '原始文字' },
          { id: 'audio-1', type: 'audio', name: '背景音乐', content: 'music.mp3' },
          { id: 'image-1', type: 'image', name: '封面', content: 'cover.jpg' },
          { id: 'video-1', type: 'video', name: '主视频', content: 'video.mp4' },
        ],
      },
      onSettingsChange,
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(query('[aria-label="预设可替换元素"]').textContent).toContain('第1个文字');
    expect(query('[aria-label="第1个文字"]').value).toBe('原始文字');
    const textInput = query('[aria-label="第1个文字"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(textInput, '  新文字  ');
      textInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const settings = onSettingsChange.mock.lastCall[0];
    expect(settings.replacements).toEqual([
      { 标题: '  新文字  ' },
      { 背景音乐: 'music.mp3' },
      { 封面: 'cover.jpg' },
      { 主视频: 'video.mp4' },
    ]);
    expect(buildPresetAddRequestParams(settings).replacements).toEqual(settings.replacements);
    expect(buildPresetAddSettingsPrompt(settings)).toContain('替换元素');
    expect(query('[aria-label="音频替换"]')).not.toBeNull();
    expect(query('[aria-label="音频替换"] .chat-panel__preset-replacement-audio')).not.toBeNull();
    expect(query('[aria-label="播放音频"]')).not.toBeNull();
    expect(query('[aria-label="替换音频"]')).not.toBeNull();
    expect(query('[aria-label="音频替换"] audio').hasAttribute('controls')).toBe(false);
    expect(query('[aria-label="音频替换"] input[type="file"]')).toBeNull();
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    try {
      await click(query('[aria-label="播放音频"]'));
      expect(play).toHaveBeenCalledOnce();
    } finally {
      play.mockRestore();
    }
    expect(query('[aria-label="图片替换"]')).not.toBeNull();
    expect(query('[aria-label="图片替换"] .chat-panel__preset-replacement-image img')).not.toBeNull();
    expect(query('[aria-label="图片替换"] .ant-image')).toBeNull();
    expect(query('[aria-label="图片替换"] input[type="file"]')).toBeNull();
    expect(query('[aria-label="图片替换"] button').getAttribute('aria-label')).toBe('替换图片');
    expect(query('[aria-label="视频替换"]')).not.toBeNull();
    expect(query('[aria-label="视频替换"] .chat-panel__preset-replacement-video')).not.toBeNull();
    expect(query('[aria-label="播放视频"]')).not.toBeNull();
    expect(query('[aria-label="替换视频"]')).not.toBeNull();
    expect(query('[aria-label="视频替换"] video').hasAttribute('controls')).toBe(false);
    expect(query('[aria-label="视频替换"] input[type="file"]')).toBeNull();
    const playVideo = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    try {
      await click(query('[aria-label="播放视频"]'));
      expect(playVideo).toHaveBeenCalledOnce();
    } finally {
      playVideo.mockRestore();
    }
  });

  it('仅接受音频文件作为音频替换素材', () => {
    expect(isAudioFile({ name: '声音.mp3', type: 'audio/mpeg' })).toBe(true);
    expect(isAudioFile({ name: '声音.mp3', type: 'audio' })).toBe(true);
    expect(isAudioFile({ name: '录音.flac', type: '' })).toBe(true);
    expect(isAudioFile({ name: '伪装.mp3', type: 'video/mp4' })).toBe(false);
    expect(isAudioFile({ name: '视频.mp4', type: 'video' })).toBe(false);
    expect(isAudioFile({ name: '照片.jpg', type: 'image/jpeg' })).toBe(false);
  });

  it('音频替换只展示音频文件并拒绝选择器返回的视频', async () => {
    const originalApi = window.api;
    const select = vi.fn()
      .mockResolvedValueOnce([{ name: '视频.mp4', type: 'video', path: '/tmp/video.mp4' }])
      .mockResolvedValueOnce([{ name: '新音频.mp3', type: 'audio', path: '/tmp/new.mp3' }]);
    window.api = { file: { select } };
    try {
      const onSettingsChange = vi.fn();
      await mount({
        selectedPreset: {
          preset_id: 'audio-preset',
          materials_json: [{ type: 'audio', name: '背景音乐', content: 'old.mp3' }],
        },
        onSettingsChange,
      });
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
      await click(query('[aria-label="替换音频"]'));
      expect(select).toHaveBeenCalledWith(expect.objectContaining({
        properties: ['openFile'],
        filters: [{ name: '音频文件', extensions: expect.arrayContaining(['mp3', 'wav', 'm4a']) }],
      }));
      expect(select.mock.lastCall[0].filters[0].extensions).not.toContain('mp4');
      expect(onSettingsChange.mock.lastCall[0].replacements).toEqual([{ 背景音乐: 'old.mp3' }]);
      await click(query('[aria-label="替换音频"]'));
      expect(onSettingsChange.mock.lastCall[0].replacements).toEqual([{ 背景音乐: '/tmp/new.mp3' }]);
    } finally {
      window.api = originalApi;
    }
  });

  it('视频替换只展示视频文件并拒绝选择器返回的音频', async () => {
    expect(isVideoFile({ name: '影片.mp4', type: 'video/mp4' })).toBe(true);
    expect(isVideoFile({ name: '影片.mp4', type: 'video' })).toBe(true);
    expect(isVideoFile({ name: '影片.mov', type: '' })).toBe(true);
    expect(isVideoFile({ name: '影片.webm', type: 'other' })).toBe(true);
    expect(isVideoFile({ name: '声音.mp3', type: 'audio' })).toBe(false);

    const originalApi = window.api;
    const select = vi.fn()
      .mockResolvedValueOnce([{ name: '声音.mp3', type: 'audio', path: '/tmp/audio.mp3' }])
      .mockResolvedValueOnce([{ name: '新视频.mp4', type: 'video', path: '/tmp/new.mp4' }]);
    window.api = { file: { select } };
    try {
      const onSettingsChange = vi.fn();
      await mount({
        selectedPreset: {
          preset_id: 'video-preset',
          materials_json: [{ type: 'video', name: '主视频', content: 'old.mp4' }],
        },
        onSettingsChange,
      });
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
      await click(query('[aria-label="替换视频"]'));
      expect(select).toHaveBeenCalledWith(expect.objectContaining({
        properties: ['openFile'],
        filters: [{ name: '视频文件', extensions: expect.arrayContaining(['mp4', 'mov', 'webm']) }],
      }));
      expect(select.mock.lastCall[0].filters[0].extensions).not.toContain('mp3');
      expect(onSettingsChange.mock.lastCall[0].replacements).toEqual([{ 主视频: 'old.mp4' }]);
      await click(query('[aria-label="替换视频"]'));
      expect(onSettingsChange.mock.lastCall[0].replacements).toEqual([{ 主视频: '/tmp/new.mp4' }]);
    } finally {
      window.api = originalApi;
    }
  });

  it('图片替换只展示图片文件并拒绝选择器返回的视频', async () => {
    expect(isImageFile({ name: '封面.png', type: 'image/png' })).toBe(true);
    expect(isImageFile({ name: '封面.jpg', type: 'image' })).toBe(true);
    expect(isImageFile({ name: '封面.webp', type: '' })).toBe(true);
    expect(isImageFile({ name: '封面.avif', type: 'other' })).toBe(true);
    expect(isImageFile({ name: '影片.mp4', type: 'video' })).toBe(false);

    const originalApi = window.api;
    const select = vi.fn()
      .mockResolvedValueOnce([{ name: '影片.mp4', type: 'video', path: '/tmp/movie.mp4' }])
      .mockResolvedValueOnce([{ name: '新封面.jpg', type: 'image', path: '/tmp/cover.jpg' }]);
    window.api = { file: { select } };
    try {
      const onSettingsChange = vi.fn();
      await mount({
        selectedPreset: {
          preset_id: 'image-preset',
          materials_json: [{ type: 'image', name: '封面', content: 'old.jpg' }],
        },
        onSettingsChange,
      });
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
      await click(query('[aria-label="替换图片"]'));
      expect(select).toHaveBeenCalledWith(expect.objectContaining({
        properties: ['openFile'],
        filters: [{ name: '图片文件', extensions: expect.arrayContaining(['jpg', 'png', 'webp']) }],
      }));
      expect(select.mock.lastCall[0].filters[0].extensions).not.toContain('mp4');
      expect(onSettingsChange.mock.lastCall[0].replacements).toEqual([{ 封面: 'old.jpg' }]);
      await click(query('[aria-label="替换图片"]'));
      expect(onSettingsChange.mock.lastCall[0].replacements).toEqual([{ 封面: '/tmp/cover.jpg' }]);
    } finally {
      window.api = originalApi;
    }
  });

  it('将真实预设时长和视频轨道写入发送参数，已有轨道不发送层级', async () => {
    queryScript.mockResolvedValueOnce({ output: { tracks: [
      { type: 'text', name: '文字' }, { type: 'video', name: '主视频', relative_index: 5 },
    ] } });
    const onSettingsChange = vi.fn();
    await mount({ selectedPreset: { preset_id: 'real', width: 1080, height: 1920, duration_seconds: 8 }, onSettingsChange });
    const settings = onSettingsChange.mock.lastCall[0];
    expect(settings).toMatchObject({ trackMode: 'existing', trackName: '主视频', sourceStart: 0, sourceEnd: 8, targetEnd: 8 });
    expect(buildPresetAddRequestParams(settings)).toMatchObject({ start: 0, end: 8, target_start: 0, track_name: '主视频' });
    expect(buildPresetAddRequestParams(settings)).not.toHaveProperty('relative_index');
    expect(document.querySelector('[aria-label="预设画布"]')).not.toBeNull();
  });

  it('uses a collapsible transform heading, no canvas dimensions, and a section divider', async () => {
    await mount();
    expect(query('[aria-label="预设可替换元素"]')).toBeNull();
    const heading = query('.chat-panel__text-settings-section-header');
    expect(heading.textContent).toBe('位置大小');
    expect(heading.getAttribute('aria-expanded')).toBe('true');
    expect(query('.chat-panel__text-settings-form').textContent).not.toContain('画布尺寸');
    expect(query('.chat-panel__preset-add-settings-preview')).not.toBeNull();
    expect(query('.chat-panel__preset-add-settings-main')).not.toBeNull();
    expect(query('[aria-label="拖动调整平面旋转"]')).not.toBeNull();
    await click(heading);
    expect(heading.getAttribute('aria-expanded')).toBe('false');
    expect(query('[aria-label="拖动调整平面旋转"]')).toBeNull();
    await click(heading);
    expect(query('[aria-label="拖动调整平面旋转"]')).not.toBeNull();
  });

  it('opens the real popover from the preset element and closes it after selection', async () => {
    const onSelectedPresetChange = vi.fn();
    await mount({ onSelectedPresetChange });
    const trigger = query('[aria-label="选择预设"]');
    await click(query('.chat-panel__preset-add-preview-stage'));
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const option = query('[data-testid="preset-option"]');
    expect(option).not.toBeNull();
    expect(option.closest('.chat-panel__text-settings-dropdown')).not.toBeNull();
    expect(query('.ant-modal')).toBeNull();
    await click(option);
    expect(onSelectedPresetChange).toHaveBeenCalledWith({ preset_id: 'preset-1', name: 'Preset 1' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(query('.chat-panel__text-settings-section-header')).not.toBeNull();
  });

  it('toggles the picker once per click and closes on outside click', async () => {
    await mount();
    const trigger = query('[aria-label="选择预设"]');
    await click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    await click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await click(trigger);
    await act(async () => {
      const outsidePicker = query('.chat-panel__text-settings-section-header');
      outsidePicker.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      outsidePicker.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      // rc-trigger schedules outside-click dismissal on the next timer tick.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await click(trigger);
    await act(async () => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(query('[aria-label="设置"]').classList.contains('is-open')).toBe(false);
    await click(query('[aria-label="设置"]'));
    expect(query('[aria-label="选择预设"]').getAttribute('aria-expanded')).toBe('false');
  });

  it('closes the picker when disabled or when the draft changes', async () => {
    await mount();
    await click(query('[aria-label="选择预设"]'));
    await act(async () => root.render(<PresetAddDetail selectedDraftIds={['draft-2']} />));
    expect(query('[aria-label="选择预设"]').getAttribute('aria-expanded')).toBe('false');
    await click(query('[aria-label="选择预设"]'));
    await act(async () => root.render(<PresetAddDetail selectedDraftIds={['draft-2']} disabled />));
    const trigger = query('[aria-label="选择预设"]');
    expect(trigger.disabled).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps draft selection as the only entry point before choosing a draft', async () => {
    await mount({ selectedDraftIds: [] });
    expect(query('[aria-label="选择预设"]')).toBeNull();
    expect(query('.chat-panel__text-settings-main')).toBeNull();
  });

  it('supports keyboard rotation and leaves canvas dimensions out of default requests', async () => {
    const onSettingsChange = vi.fn();
    await mount({ onSettingsChange });
    const dial = query('[aria-label="拖动调整平面旋转"]');
    await act(async () => dial.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true })));
    expect(dial.getAttribute('aria-valuenow')).toBe('10');
    const params = buildPresetAddRequestParams(onSettingsChange.mock.lastCall[0]);
    expect(params.rotation).toBe(10);
    expect(params).not.toHaveProperty('width');
    expect(params).not.toHaveProperty('height');
  });
});
