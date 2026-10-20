import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import ImageTimelinePanel from './ImageTimelinePanel';

it('真实轨道预览在连续改变图片结束时间时保持挂载', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const script = { tracks: [], materials: {} };
  const onChange = vi.fn();
  const settings = { imagePath: '/tmp/image.png', imageName: 'image.png', trackName: 'image_track', start: 0, end: 3 };
  function EditableTimeline() {
    const [value, setValue] = React.useState(settings);
    return <ImageTimelinePanel settings={value} script={script} onChange={setValue} />;
  }
  try {
    for (const end of [3, 3.01, 5, 10, 1, 0.01, 86400, 3]) {
      await act(async () => root.render(
        <React.StrictMode><ImageTimelinePanel settings={{ ...settings, end }} script={script} onChange={onChange} /></React.StrictMode>
      ));
      expect(host.querySelector('[aria-label="结束时间"]')).not.toBeNull();
      expect(host.querySelector('.pinned-draft-track-view')).not.toBeNull();
    }
    await act(async () => root.render(<React.StrictMode><EditableTimeline /></React.StrictMode>));
    const endRow = host.querySelector('[aria-label="结束时间"]').closest('.chat-panel__text-settings-row');
    for (let index = 0; index < 30; index += 1) {
      await act(async () => endRow.querySelector('.ant-input-number-handler-up').dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true })
      ));
      await act(async () => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
    }
    expect(Number(host.querySelector('[aria-label="结束时间"]').value)).toBeCloseTo(3.3);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('已有图片轨道时修改结束时间不使用 combobox，也不会在失焦时重复提交设置', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const script = { tracks: [{ type: 'video', name: 'image_track', segments: [] }], materials: {} };
  const onChange = vi.fn();
  const settings = {
    imagePath: '/tmp/image.jpg', imageName: 'image.jpg', start: 0, end: 4,
    trackMode: 'new', trackName: 'image_track_2', newTrackName: 'image_track_2', relativeIndex: 1
  };
  try {
    for (const end of [4, 4.01, 4.02, 3]) {
      await act(async () => root.render(
        <React.StrictMode><ImageTimelinePanel settings={{ ...settings, end }} script={script} onChange={onChange} /></React.StrictMode>
      ));
    }
    expect(host.querySelector('.ant-select')).toBeNull();
    const input = host.querySelector('[aria-label="选择视频轨道"]');
    await act(async () => input.focus());
    await act(async () => input.blur());
    expect(onChange).not.toHaveBeenCalled();
    expect(host.querySelector('[aria-label="结束时间"]')).not.toBeNull();
    await act(async () => input.click());
    const existing = Array.from(document.querySelectorAll('.ant-dropdown-menu-item'))
      .find((item) => item.textContent === 'image_track');
    expect(existing).not.toBeUndefined();
    await act(async () => existing.click());
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      trackMode: 'existing', trackName: 'image_track', relativeIndex: null
    }));
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
