import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import AudioAddToolDetail from './index';
import PresetAddDetail from '../PresetAddDetail';
import TextTimelinePanel from '../TextAddDetail/TextTimelinePanel';
import PresetTimelinePanel from '../PresetAddDetail/PresetTimelinePanel';

vi.mock('../../api/capcut', () => ({
  queryScript: async () => ({ output: script }),
}));
vi.mock('../DraftSelect/index', () => ({ default: () => <button>Draft</button> }));
vi.mock('../PresetList/PresetList', () => ({ default: () => <div /> }));
vi.mock('../PresetAddDetail/PresetCanvas', () => ({ default: () => <div /> }));
vi.mock('../RecognizationSubtitleToolDetail/AudioPreview', () => ({
  default: ({ onDurationChange }) => {
    React.useEffect(() => { onDurationChange(10); }, []);
    return <div />;
  },
}));
const script = { canvas_config: { width: 1080, height: 1920 }, tracks: [
  { type: 'text', name: 'text_main', segments: [] },
  { type: 'video', name: 'video_main', segments: [] },
  { type: 'audio', name: 'audio_main', segments: [] },
] };

for (const kind of ['text', 'preset', 'audio', 'preset-detail']) {
  it(`${kind}: 连续时间修改正常，重绘不重复通知，轨道选择不使用 AutoComplete`, async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    window.matchMedia = () => ({
      matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
    });
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    window.api = { file: { select: async () => [{ path: '/tmp/music.wav', name: 'music.wav' }] } };
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const notifications = vi.fn();
    let latest;
    const preset = { preset_id: 'preset-1', name: 'Preset', width: 1080, height: 1920, duration_seconds: 10 };
    function Harness() {
      const [value, setValue] = React.useState({ start: 0, end: 3, targetStart: 0, sourceStart: 0, sourceEnd: 10 });
      latest = value;
      const onChange = (next) => { notifications(next); setValue(next); };
      if (kind === 'text') return <TextTimelinePanel script={script} value={value} text="Text" onChange={onChange} />;
      if (kind === 'preset') return <PresetTimelinePanel script={script} settings={value} preset={preset} duration={10} onChange={onChange} />;
      if (kind === 'preset-detail') return <PresetAddDetail selectedDraftIds={['draft']} selectedPreset={preset} onSettingsChange={onChange} />;
      return <AudioAddToolDetail selectedDraftIds={['draft']} onSettingsChange={onChange} />;
    }
    try {
      await act(async () => root.render(<Harness />));
      if (kind === 'audio') {
        await act(async () => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('导入音频')).click());
      }
      if (kind === 'audio' || kind === 'preset-detail') {
        await act(async () => document.querySelector('.chat-panel__text-settings-tabs [aria-label="时间线"]').click());
      }
      const input = document.querySelector(`[aria-label="${kind === 'text' ? '结束时间' : '开始时间'}"]`);
      const before = notifications.mock.calls.length;
      await act(async () => root.render(<Harness />));
      expect(notifications).toHaveBeenCalledTimes(before);
      for (let i = 0; i < 60; i += 1) {
        await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'ArrowUp', keyCode: 38, which: 38, bubbles: true,
        })));
      }
      expect(kind === 'text' ? latest.end : latest.targetStart).toBe(kind === 'text' ? 3.6 : 0.6);
      expect(document.querySelector('.chat-panel__text-track-control .ant-select')).toBeNull();
      const track = document.querySelector('.chat-panel__text-track-control input');
      const count = notifications.mock.calls.length;
      await act(async () => { track.focus(); });
      await act(async () => { track.blur(); });
      expect(notifications).toHaveBeenCalledTimes(count);
      await act(async () => track.click());
      const item = [...document.querySelectorAll('.ant-dropdown-menu-item')].find((el) =>
        el.textContent === `${kind === 'text' ? 'text' : kind === 'audio' ? 'audio' : 'video'}_main`);
      expect(item).toBeDefined();
      await act(async () => item.click());
      expect(latest.trackMode).toBe('existing');
    } finally {
      await act(async () => root.unmount());
      host.remove();
      delete window.api;
    }
  });
}
