import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resizePart, trimBounds } from './trim';
import { validateParts } from './model';
import StoryboardEditor from './StoryboardEditor';

vi.mock('./Filmstrip', () => ({ default: () => null }));
vi.mock('antd', () => ({ Tooltip: ({ children }) => children }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const segments = [{
  start: 0, end: 4000, text: '甲乙丙丁',
  words: ['甲', '乙', '丙', '丁'].map((text, i) => ({ text, start: i * 1000, end: (i + 1) * 1000, from: i, to: i + 1 })),
}];
const part = {
  id: 'a', label: 'part1_1', start: 1000, end: 2000, text: '改', blank: false, sourceIndex: 0,
  captions: [{ start: 1000, end: 2000, text: '改', words: [{ start: 1000, end: 2000, text: '改', from: 0, to: 1 }] }],
};
const following = { ...part, id: 'b', start: 3000, end: 4000, text: '丁',
  captions: [{ start: 3000, end: 4000, text: '丁' }] };

describe('片段边缘时间与字幕', () => {
  it('向两侧恢复已删画面和原始词时间，不覆盖保留区的文字修改', () => {
    const left = resizePart([part, following], segments, 'a', 'start', -1000, 5000);
    expect(left[0]).toMatchObject({ start: 0, end: 2000, text: '甲\n改' });
    expect(left[0].captions[0].words[0]).toMatchObject({ start: 0, end: 1000, text: '甲', from: 0, to: 1 });
    const right = resizePart(left, segments, 'a', 'end', 3500, 5000);
    expect(right[0]).toMatchObject({ start: 0, end: 3500, text: '甲\n改\n丙丁' });
    expect(right[1]).toBe(following);
    expect(validateParts(right)).toBe(right);
    expect(part.start).toBe(1000);
    expect(part.text).toBe('改');
  });
  it('边界仅限制到素材首尾及至少 1ms，不受相邻片段影响', () => {
    expect(trimBounds([part, following], 'a', 'end', 5000)).toEqual({ min: 1001, max: 5000 });
    expect(trimBounds([part, following], 'b', 'start', 5000)).toEqual({ min: 0, max: 3999 });
    expect(resizePart([part], segments, 'a', 'end', 99999, 5000)[0].end).toBe(5000);
    expect(resizePart([part], segments, 'a', 'start', 99999, 5000)[0].start).toBe(1999);
    expect(resizePart([part], segments, 'a', 'end', 0, 5000)[0].end).toBe(1001);
  });
  it('可以向右越过整个邻片，也可以向左越过前片，邻片数据保持不变', () => {
    const next = { ...following, start: part.end };
    const parts = [part, next];
    const right = resizePart(parts, segments, 'a', 'end', 4500, 5000);
    expect(right[0].end).toBe(4500);
    expect(right[1]).toBe(next);
    expect(validateParts(right)).toBe(right);
    const left = resizePart(parts, segments, 'b', 'start', 500, 5000);
    expect(left[1].start).toBe(500);
    expect(left[0]).toBe(part);
    expect(validateParts(left)).toBe(left);
    expect(resizePart([part, { ...next, blank: true }], segments, 'a', 'end', 2500, 5000)[0].end).toBe(2500);
    expect(trimBounds([{ ...part, blank: true }], 'a', 'end', 5000)).toBeNull();
  });
  it('合并片段只修改外侧 range，不恢复内部已删画面', () => {
    const merged = { ...part, end: 4000, ranges: [{ start: 1000, end: 2000 }, { start: 3000, end: 4000 }] };
    const next = resizePart([merged], segments, 'a', 'start', 0, 5000);
    expect(next[0].ranges).toEqual([{ start: 0, end: 2000 }, { start: 3000, end: 4000 }]);
    expect(next[0].text).not.toContain('丙');
    expect(resizePart(next, segments, 'a', 'end', 0, 5000)[0].ranges.at(-1)).toEqual({ start: 3000, end: 3001 });
    expect(validateParts(next)).toBe(next);
  });
  it('恢复跨越旧边界的单词只延长原词时间，不重复词或丢失修改', () => {
    const clipped = { ...part, start: 1500, end: 1800, captions: [{
      start: 1500, end: 1800, text: '改', words: [{ start: 1500, end: 1800, text: '改', from: 0, to: 1 }],
    }] };
    const left = resizePart([clipped], segments, 'a', 'start', 1000, 5000);
    const next = resizePart(left, segments, 'a', 'end', 2000, 5000);
    expect(next[0].text).toBe('改');
    expect(next[0].captions).toEqual(part.captions);
    expect(validateParts(next)).toBe(next);
  });
  it('向内缩短按真实逐字时间裁剪，清空过的文字不凭空恢复', () => {
    const source = { ...part, start: 0, end: 4000, text: segments[0].text, captions: segments };
    const next = resizePart([source], segments, 'a', 'start', 2200.4, 5000);
    expect(next[0].start).toBe(2200);
    expect(next[0].text).toBe('丙丁');
    expect(next[0].captions[0].words[0]).toMatchObject({ start: 2200, from: 0, to: 1 });
    const empty = { ...part, text: '', captions: [] };
    expect(resizePart([empty], segments, 'a', 'start', 500, 5000)[0].text).toBe('甲');
    expect(validateParts(next)).toBe(next);
  });
  it('没有逐字时间时不伪造局部句子，只恢复完整落入新增范围的原句', () => {
    const untimed = [{ start: 0, end: 1000, text: '前句' }];
    expect(resizePart([part], untimed, 'a', 'start', 500, 5000)[0].text).toBe('改');
    expect(resizePart([part], untimed, 'a', 'start', 0, 5000)[0].text).toBe('前句\n改');
  });
  it('无变化或非法输入不创建新文档', () => {
    const parts = [part];
    expect(resizePart(parts, segments, 'a', 'start', 1000, 5000)).toBe(parts);
    expect(resizePart(parts, segments, 'a', 'start', NaN, 5000)).toBe(parts);
    expect(resizePart(parts, segments, 'missing', 'end', 1000, 5000)).toBe(parts);
    expect(resizePart(parts, segments, 'a', 'invalid', 1000, 5000)).toBe(parts);
  });
});

let root;
let container;
let callbacks;
const q = (selector) => container.querySelector(selector);
const pointer = (node, type, x) => node.dispatchEvent(new MouseEvent(type, { clientX: x, button: 0, bubbles: true }));
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(4);
  vi.spyOn(HTMLMediaElement.prototype, 'duration', 'get').mockReturnValue(5);
});
afterEach(() => {
  if (root) act(() => root.unmount());
  root = null;
  container?.remove();
  vi.restoreAllMocks();
});
const render = async (overrides = {}) => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  callbacks = { onSelect: vi.fn(), onResize: vi.fn(), onInsert: vi.fn(), onDelete: vi.fn() };
  await act(async () => root.render(<StoryboardEditor parts={[part, following]} segments={segments}
    source="file:///video.mp4" selectedId="a" {...callbacks} {...overrides} />));
  const surface = q('.storyboard-lane__surface');
  Object.defineProperty(surface, 'offsetWidth', { value: 1000 });
  surface.getBoundingClientRect = () => ({ left: 100, top: 0, width: 800 });
};

describe('边缘拖动交互', () => {
  it('80% 缩放时实时预览但松手才提交，不触发框选或插入', async () => {
    await render();
    const scale = (parseFloat(q('.storyboard-clip').style.width) + 3);
    const handle = q('[data-trim="end"]');
    const surface = q('.storyboard-lane__surface');
    await act(async () => pointer(handle, 'pointerdown', 200));
    await act(async () => pointer(surface, 'pointermove', 200 + scale * 0.8 / 2));
    expect(q('[data-trim="end"]').getAttribute('aria-valuenow')).toBe('2500');
    expect(q('.storyboard-preview__media').currentTime).toBeCloseTo(2.499);
    expect(q('.storyboard-marquee')).toBeNull();
    expect(callbacks.onResize).not.toHaveBeenCalled();
    await act(async () => pointer(surface, 'pointerup', 200 + scale * 0.8 / 2));
    expect(callbacks.onResize).toHaveBeenCalledExactlyOnceWith('a', 'end', 2500, 4000);
    expect(callbacks.onInsert).not.toHaveBeenCalled();
  });
  it('快速拖动松手也按最终坐标提交左边界，拖动中尺度保持稳定', async () => {
    await render();
    const scale = parseFloat(q('.storyboard-clip').style.width) + 3;
    await act(async () => {
      pointer(q('[data-trim="start"]'), 'pointerdown', 300);
      pointer(q('.storyboard-lane__surface'), 'pointerup', 300 - scale * 0.8 / 2);
    });
    expect(callbacks.onResize).toHaveBeenCalledExactlyOnceWith('a', 'start', 500, 4000);
  });
  it.each(['pointercancel', 'lostpointercapture', 'escape'])('%s 取消本次预览，不修改文件', async (method) => {
    await render();
    await act(async () => pointer(q('[data-trim="end"]'), 'pointerdown', 200));
    await act(async () => pointer(q('.storyboard-lane__surface'), 'pointermove', 280));
    await act(async () => {
      if (method === 'escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      else pointer(q('.storyboard-lane__surface'), method, 280);
    });
    expect(callbacks.onResize).not.toHaveBeenCalled();
    expect(q('[data-trim="end"]').getAttribute('aria-valuenow')).toBe('2000');
    expect(q('.storyboard-trim-time')).toBeNull();
  });
  it('键盘可微调 10ms，Shift 微调 100ms', async () => {
    await render();
    await act(async () => q('[data-trim="start"]').dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowLeft', shiftKey: true, bubbles: true,
    })));
    expect(callbacks.onResize).toHaveBeenCalledWith('a', 'start', 900, 4000);
    await act(async () => q('[data-trim="end"]').dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowRight', bubbles: true,
    })));
    expect(callbacks.onResize).toHaveBeenCalledWith('a', 'end', 2010, 4000);
  });
  it('禁用期间不能拖动，空分镜不显示素材伸缩手柄', async () => {
    await render({ disabled: true });
    expect(q('[data-trim="start"]').disabled).toBe(true);
    await act(async () => {
      pointer(q('[data-trim="end"]'), 'pointerdown', 200);
      pointer(q('.storyboard-lane__surface'), 'pointerup', 500);
    });
    expect(callbacks.onResize).not.toHaveBeenCalled();
    await act(async () => root.render(<StoryboardEditor parts={[{ ...part, blank: true }]}
      selectedId="a" source="" {...callbacks} />));
    expect(q('[data-trim]')).toBeNull();
  });
  it('拖动中外部更新文件会丢弃旧预览，不用旧快照覆盖新内容', async () => {
    await render();
    await act(async () => pointer(q('[data-trim="end"]'), 'pointerdown', 200));
    await act(async () => pointer(q('.storyboard-lane__surface'), 'pointermove', 280));
    const external = [{ ...part, end: 2500 }, following];
    await act(async () => root.render(<StoryboardEditor parts={external} segments={segments}
      source="file:///video.mp4" selectedId="a" {...callbacks} />));
    await act(async () => pointer(q('.storyboard-lane__surface'), 'pointerup', 280));
    expect(callbacks.onResize).not.toHaveBeenCalled();
    expect(q('[data-trim="end"]').getAttribute('aria-valuenow')).toBe('2500');
    expect(q('.storyboard-trim-time')).toBeNull();
  });
  it('缩放手势在拖动期间被忽略，短片段手柄宽度不相互覆盖', async () => {
    await render({ parts: [{ ...part, end: 1010, captions: [], text: '' }, following] });
    const clipWidth = parseFloat(q('.storyboard-clip').style.width);
    const handles = [...container.querySelectorAll('[data-trim]')];
    expect(handles.reduce((sum, handle) => sum + parseFloat(handle.style.width), 0)).toBeLessThanOrEqual(clipWidth);
    await act(async () => pointer(q('[data-trim="end"]'), 'pointerdown', 200));
    await act(async () => q('.storyboard-lane__scroll').dispatchEvent(new WheelEvent('wheel', {
      ctrlKey: true, deltaY: -100, bubbles: true,
    })));
    expect(parseFloat(q('.storyboard-clip').style.width)).toBe(clipWidth);
  });
  it('没有媒体元数据时保守限制，加载实际时长后允许恢复片尾', async () => {
    await render({ parts: [part] });
    await act(async () => q('.storyboard-preview__media').dispatchEvent(new Event('loadedmetadata')));
    await act(async () => {
      pointer(q('[data-trim="end"]'), 'pointerdown', 200);
      pointer(q('.storyboard-lane__surface'), 'pointerup', 5000);
    });
    expect(callbacks.onResize).toHaveBeenCalledWith('a', 'end', 5000, 5000);
  });
});
