import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StoryboardEditor from './StoryboardEditor';
import { buildTimeline, clockTime, insertEmptyPart, nextPlayableClip, playbackTime, rulerTicks, timelinePoint } from './timeline';
import { canMergeParts, createParts, mergeParts, partPoint, splitPart, validateParts } from './model';

vi.mock('./Filmstrip', () => ({ default: () => null }));
vi.mock('antd', () => ({ Tooltip: ({ children }) => children }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const parts = [
  { id: 'a', label: 'part1_1', sourceIndex: 0, start: 1000, end: 3000, text: '第一段', blank: false },
  { id: 'b', label: 'part2_1', sourceIndex: 1, start: 5000, end: 9000, text: '第二段', blank: false },
];
let root;
let container;
let callbacks;
let frames;
let frameId;

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(4);
  vi.spyOn(HTMLMediaElement.prototype, 'duration', 'get').mockReturnValue(20);
  frames = new Map();
  frameId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal('cancelAnimationFrame', (id) => frames.delete(id));
});
afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
  root = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const render = async (overrides = {}) => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  callbacks = { onSelect: vi.fn(), onSplit: vi.fn(), onDelete: vi.fn(), onInsert: vi.fn(), onMerge: vi.fn() };
  await act(async () => root.render(<StoryboardEditor parts={parts} selectedId="a"
    source="https://example.com/source.mp4" {...callbacks} {...overrides} />));
};
const click = async (selector) => act(async () => container.querySelector(selector).click());
const wheel = async (options = {}) => {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -20, ...options });
  await act(async () => container.querySelector('.storyboard-lane__scroll').dispatchEvent(event));
  return event;
};
const pressDelete = async (options = {}, target = document.activeElement) => {
  const event = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true, ...options });
  await act(async () => target.dispatchEvent(event));
  return event;
};
const pointer = async (type, clientX, selector = '.storyboard-lane__surface') => {
  const element = container.querySelector(selector);
  element.getBoundingClientRect = () => ({ left: 0, width: 1000 });
  await act(async () => element.dispatchEvent(new MouseEvent(type, { clientX, button: 0, bubbles: true })));
};
const frame = async (time = performance.now() + 16) => {
  const pending = [...frames.values()];
  frames.clear();
  await act(async () => pending.forEach((callback) => callback(time)));
};

describe('比例时间轴', () => {
  it('默认分镜保留句间停顿，但不修改原字幕时间', () => {
    const next = createParts(parts);
    expect(next.map((part) => [part.start, part.end])).toEqual([[1000, 5000], [5000, 9000]]);
    expect(parts[0].end).toBe(3000);
    expect(buildTimeline(next).at(-1).timelineEnd).toBe(8000);
  });
  it('合并相邻镜头保留实际源片段并合并文本，原数据不变', () => {
    const next = mergeParts(parts, ['b', 'a']);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ id: 'a', start: 1000, end: 9000, text: '第一段\n第二段' });
    expect(parts).toHaveLength(2);
    expect(parts[0].end).toBe(3000);
    expect(next[0].ranges).toEqual([{ start: 1000, end: 3000 }, { start: 5000, end: 9000 }]);
    expect(buildTimeline(next)[0].duration).toBe(6000);
    expect(partPoint(next[0], 2500).sourceTime).toBe(5500);
    expect(timelinePoint(buildTimeline(next), 2000).sourceTime).toBe(5000);
    const split = splitPart(next, 'a', 5000, 'right');
    expect(split.map((part) => [part.start, part.end])).toEqual([[1000, 3000], [5000, 9000]]);
    expect(split.every((part) => !part.ranges)).toBe(true);
    expect(validateParts(next)).toBe(next);
    expect(() => validateParts([{ ...next[0], ranges: [{ start: 1000, end: 10000 }] }])).toThrow();
  });
  it('历史删除项不妨碍两侧合并，多次合并与拆分仍保留跳过范围', () => {
    const middle = { ...parts[0], id: 'deleted', start: 3000, end: 5000, deleted: true };
    expect(canMergeParts([parts[0], middle, parts[1]], ['a', 'b'])).toBe(true);
    const merged = mergeParts([parts[0], middle, parts[1]], ['a', 'b']);
    const combined = mergeParts([...merged, { ...parts[1], id: 'c', start: 9000, end: 10000 }], ['a', 'c']);
    expect(combined[0].ranges).toEqual([{ start: 1000, end: 3000 }, { start: 5000, end: 10000 }]);
    const split = splitPart(combined, 'a', 6000, 'right');
    expect(split[0].ranges).toEqual([{ start: 1000, end: 3000 }, { start: 5000, end: 6000 }]);
    expect(split[1]).toMatchObject({ start: 6000, end: 10000 });
    expect(buildTimeline(split).at(-1).timelineEnd).toBe(7000);
    expect(validateParts(split)).toBe(split);
  });
  it('拒绝不相邻、空分镜和乱序分镜的合并', () => {
    expect(canMergeParts([...parts, { ...parts[1], id: 'c' }], ['a', 'c'])).toBe(false);
    expect(canMergeParts([{ ...parts[0], blank: true }, parts[1]], ['a', 'b'])).toBe(false);
    expect(canMergeParts([...parts].reverse(), ['a', 'b'])).toBe(false);
    expect(() => mergeParts(parts, ['a'])).toThrow();
    expect(canMergeParts([{ ...parts[0], deleted: true }, parts[1]], ['a', 'b'])).toBe(false);
  });
  it('已删除分镜不占轨道宽度或播放时长', () => {
    const clips = buildTimeline([{ ...parts[0], deleted: true }, parts[1]]);
    expect(clips).toHaveLength(1);
    expect(clips[0].timelineStart).toBe(0);
    expect(playbackTime(clips)).toBe(4000);
    expect(playbackTime(clips, 1000)).toBe(1000);
    expect(playbackTime(clips, 3000)).toBe(3000);
    expect(nextPlayableClip(clips, 0).id).toBe('b');
  });
  it('序列时间不包含源片段之间的空隙', () => {
    const clips = buildTimeline(parts);
    expect(clips.map((clip) => [clip.timelineStart, clip.timelineEnd])).toEqual([[0, 2000], [2000, 6000]]);
    expect(timelinePoint(clips, 2500)).toMatchObject({ sourceTime: 5500, clip: { id: 'b' } });
    expect(timelinePoint(clips, -100).sourceTime).toBe(1000);
    expect(timelinePoint(clips, 99999).sourceTime).toBe(9000);
    expect(timelinePoint([], 0)).toBeNull();
  });
  it('主次刻度间隔一致并限制在可见范围', () => {
    const ticks = rulerTicks(83000, 40, 10000, 35000);
    expect(ticks.filter((tick) => tick.major).map((tick) => tick.time)).toEqual([10000, 15000, 20000, 25000, 30000, 35000]);
    expect(ticks[1].left - ticks[0].left).toBe(40);
    expect(clockTime(83000)).toBe('01:23');
    expect(clockTime(1234, true)).toBe('00:01.23');
  });
  it.each([0, 1, 2])('可在索引 %s 插入空分镜且不改变已有源时间', (index) => {
    const result = insertEmptyPart(parts, index, 'new');
    expect(result.parts[index]).toMatchObject({ id: 'new', blank: true });
    expect(result.parts.filter((part) => part.id !== 'new')).toEqual(parts);
    expect(result.part.end).toBeGreaterThan(result.part.start);
  });
});

describe('轨道交互', () => {
  it('直接从分镜缩略图水平拖动可以多选，快速松手也保留选择', async () => {
    await render();
    const clip = container.querySelector('.storyboard-clip');
    const surface = container.querySelector('.storyboard-lane__surface');
    const width = parseFloat(clip.style.width) + 3;
    surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000 });
    // All events in one batch reproduce pointerup arriving before a React render.
    await act(async () => {
      clip.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: width / 2, clientY: 65 }));
      surface.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: width * 2, clientY: 65 }));
      surface.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: width * 2, clientY: 65 }));
    });
    expect(container.querySelectorAll('.storyboard-clip.is-selected')).toHaveLength(2);
    expect(container.querySelector('[aria-label="播放进度"]').getAttribute('aria-valuenow')).toBe('0');
    await click('[aria-label="合并分镜"]');
    expect(callbacks.onMerge).toHaveBeenCalledWith(['a', 'b']);
  });
  it('缩放并横向滚动后的缩略图拖选命中正确分镜', async () => {
    await render();
    const surface = container.querySelector('.storyboard-lane__surface');
    const clip = container.querySelector('.storyboard-clip');
    const width = parseFloat(clip.style.width) + 3;
    Object.defineProperty(surface, 'offsetWidth', { value: 1000 });
    surface.getBoundingClientRect = () => ({ left: -100, top: 80, width: 800 });
    const startX = -100 + width / 2 * 0.8;
    const endX = -100 + width * 2 * 0.8;
    await act(async () => {
      clip.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: startX, clientY: 130 }));
      surface.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: endX, clientY: 130 }));
    });
    expect(container.querySelectorAll('.storyboard-clip.is-selected')).toHaveLength(2);
  });
  it('普通单击缩略图仍然选中并定位，而不是开始多选', async () => {
    await render();
    const clip = container.querySelectorAll('.storyboard-clip')[1];
    const surface = container.querySelector('.storyboard-lane__surface');
    surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000 });
    const x = parseFloat(clip.style.left) + 10;
    await act(async () => {
      clip.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: x, clientY: 60 }));
      surface.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: x, clientY: 60 }));
    });
    expect(callbacks.onSelect).toHaveBeenCalledWith('b');
    expect(container.querySelectorAll('.storyboard-clip.is-selected')).toHaveLength(1);
  });
  it('开头已删除分镜不显示，直接预览剩余片段', async () => {
    await render({ parts: [{ ...parts[0], deleted: true }, parts[1]] });
    expect(container.querySelectorAll('.storyboard-clip')).toHaveLength(1);
    expect(container.querySelector('[aria-label="恢复分镜"]')).toBeNull();
    expect(container.querySelector('.storyboard-clip').style.left).toBe('0px');
    await click('[aria-label="播放分镜序列"]');
    expect(container.querySelector('.storyboard-preview__media').currentTime).toBe(5);
    expect(callbacks.onSelect).toHaveBeenCalledWith('b');
  });
  it('连续播放跳过中间和尾部删除片段', async () => {
    const clips = [
      parts[0], { ...parts[1], deleted: true },
      { ...parts[1], id: 'c', start: 12000, end: 13000 },
      { ...parts[1], id: 'd', deleted: true, start: 14000, end: 15000 },
    ];
    await render({ parts: clips });
    const main = container.querySelector('.storyboard-preview__media');
    await click('[aria-label="播放分镜序列"]');
    main.currentTime = 3.01;
    await frame();
    expect(main.currentTime).toBe(12);
    expect(callbacks.onSelect).toHaveBeenCalledWith('c');
    main.currentTime = 13.01;
    await frame();
    expect(main.currentTime).toBe(13);
    expect(container.querySelector('[aria-label="播放分镜序列"]')).not.toBeNull();
    expect(container.querySelector('.storyboard-clock').textContent).toBe('00:03 / 00:03');
  });
  it('全部标记删除后清空轨道和预览，禁止播放与合并', async () => {
    await render({ parts: parts.map((part) => ({ ...part, deleted: true })) });
    expect(container.querySelectorAll('.storyboard-clip')).toHaveLength(0);
    expect(container.querySelector('.storyboard-preview__media').classList.contains('is-concealed')).toBe(true);
    expect(container.querySelector('[aria-label="播放分镜序列"]').disabled).toBe(true);
    expect(container.querySelector('[aria-label="拆分分镜"]').disabled).toBe(true);
    expect(container.querySelector('[aria-label="删除分镜"]').disabled).toBe(true);
    expect(container.querySelector('.storyboard-clock').textContent).toBe('00:00 / 00:00');
  });
  it('合并后的单镜播放和悬停仍跳过删除区间', async () => {
    await render({ parts: mergeParts(parts, ['a', 'b']) });
    const main = container.querySelector('.storyboard-preview__media');
    const surface = container.querySelector('.storyboard-lane__surface');
    surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000 });
    const width = parseFloat(container.querySelector('.storyboard-clip').style.width) + 3;
    await pointer('pointermove', width / 2);
    expect(container.querySelector('.storyboard-preview__hover').currentTime).toBeCloseTo(6);
    await click('[aria-label="播放分镜序列"]');
    main.currentTime = 3.01;
    await frame();
    expect(main.currentTime).toBe(5);
    expect(container.querySelector('[role="slider"]').getAttribute('aria-valuenow')).toBe('2000');
    main.currentTime = 9.01;
    await frame();
    expect(container.querySelector('.storyboard-clock').textContent).toBe('00:06 / 00:06');
    expect(container.querySelector('[aria-label="播放分镜序列"]')).not.toBeNull();
  });
  const dragBox = async (reverse = false, cancel = false) => {
    const surface = container.querySelector('.storyboard-lane__surface');
    surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000 });
    const width = parseFloat(container.querySelector('.storyboard-clip').style.width) + 3;
    const from = reverse ? [width * 2, 45] : [1, 112];
    const to = reverse ? [1, 112] : [width * 2, 45];
    for (const [type, point] of [['pointerdown', from], ['pointermove', to], [cancel ? 'pointercancel' : 'pointerup', to]]) {
      await act(async () => surface.dispatchEvent(new MouseEvent(type, {
        bubbles: true, button: 0, clientX: point[0], clientY: point[1], shiftKey: reverse,
      })));
    }
  };
  it.each([false, true])('拖框多选后合并，不移动播放时间，反向=%s', async (reverse) => {
    await render();
    expect(container.querySelector('[aria-label="合并分镜"]').disabled).toBe(true);
    await dragBox(reverse);
    expect(container.querySelectorAll('.storyboard-clip.is-selected')).toHaveLength(2);
    expect(container.querySelector('[aria-label="播放进度"]').getAttribute('aria-valuenow')).toBe('0');
    expect(container.querySelector('[aria-label="拆分分镜"]').disabled).toBe(true);
    expect(container.querySelector('.storyboard-marquee')).toBeNull();
    await click('[aria-label="合并分镜"]');
    expect(callbacks.onMerge).toHaveBeenCalledWith(['a', 'b']);
  });
  it('取消框选恢复选择，单击退出多选', async () => {
    await render();
    await dragBox(false, true);
    expect(container.querySelectorAll('.storyboard-clip.is-selected')).toHaveLength(1);
    await dragBox();
    await pointer('pointerdown', 20);
    expect(container.querySelectorAll('.storyboard-clip.is-selected')).toHaveLength(1);
  });
  it('框选后删除键删除整个选择集', async () => {
    await render();
    await dragBox();
    await pressDelete();
    expect(callbacks.onDelete).toHaveBeenCalledWith(['a', 'b']);
  });
  it('缩略片段宽度与时长成比例，保留首尾及接缝插入入口', async () => {
    await render();
    const clips = container.querySelectorAll('.storyboard-clip');
    expect((parseFloat(clips[1].style.width) + 3) / (parseFloat(clips[0].style.width) + 3)).toBe(2);
    await click('[aria-label="在第 2 个分镜前插入空分镜"]');
    expect(callbacks.onInsert).toHaveBeenCalledWith(1);
    await click('[aria-label="在末尾新增空分镜"]');
    expect(callbacks.onInsert).toHaveBeenCalledWith(2);
  });
  it('悬停使用独立视频，移开后播放头与主视频保持原位', async () => {
    await render();
    const main = container.querySelector('.storyboard-preview__media');
    const hover = container.querySelector('.storyboard-preview__hover');
    const headBefore = container.querySelector('.storyboard-playhead').style.left;
    await pointer('pointermove', 100);
    expect(main.currentTime).toBe(1);
    expect(hover.currentTime).toBeGreaterThan(1);
    expect(container.querySelector('.storyboard-hoverline')).not.toBeNull();
    expect(container.querySelector('.storyboard-playhead').style.left).toBe(headBefore);
    expect(hover.classList.contains('is-visible')).toBe(true);
    await pointer('pointerout', 100);
    expect(container.querySelector('.storyboard-hoverline')).toBeNull();
    expect(main.currentTime).toBe(1);
  });
  it('拖动播放头提交时间，取消后可以继续悬停预览', async () => {
    await render();
    await pointer('pointerdown', 50);
    await pointer('pointermove', 100);
    await pointer('pointercancel', 100);
    const value = Number(container.querySelector('[role="slider"]').getAttribute('aria-valuenow'));
    expect(value).toBeGreaterThan(0);
    await pointer('pointermove', 150);
    expect(Number(container.querySelector('[role="slider"]').getAttribute('aria-valuenow'))).toBe(value);
  });
  it('缩小至 80% 后鼠标定位仍对应正确时间', async () => {
    await render();
    const surface = container.querySelector('.storyboard-lane__surface');
    Object.defineProperty(surface, 'offsetWidth', { value: 1000, configurable: true });
    surface.getBoundingClientRect = () => ({ left: 0, width: 800 });
    const clipWidth = parseFloat(container.querySelector('.storyboard-clip').style.width) + 3;
    await act(async () => surface.dispatchEvent(new MouseEvent('pointerdown', {
      clientX: clipWidth / 2 * 0.8, button: 0, bubbles: true,
    })));
    expect(container.querySelector('[role="slider"]').getAttribute('aria-valuenow')).toBe('1000');
  });
  it('连续分镜过渡不写 currentTime、不暂停或重复播放，字幕和选择仍同步', async () => {
    const continuous = [parts[0], { ...parts[1], start: 3000 }];
    await render({ parts: continuous, segments: continuous });
    const main = container.querySelector('.storyboard-preview__media');
    await click('[aria-label="播放分镜序列"]');
    const seek = vi.spyOn(main, 'currentTime', 'set');
    const play = HTMLMediaElement.prototype.play;
    const pause = HTMLMediaElement.prototype.pause;
    play.mockClear();
    pause.mockClear();
    main.currentTime = 3.017;
    seek.mockClear();
    await frame();
    expect(main.currentTime).toBe(3.017);
    expect(seek).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
    expect(callbacks.onSelect).toHaveBeenCalledWith('b');
    expect(container.querySelector('.storyboard-preview__subtitle').textContent).toBe('第二段');
    expect(container.querySelector('[role="slider"]').getAttribute('aria-valuenow')).toBe('2017');
    expect(container.querySelector('[aria-label="选择 part2_1"]').getAttribute('aria-pressed')).toBe('true');
    main.currentTime = 3.04;
    seek.mockClear();
    await frame();
    expect(seek).not.toHaveBeenCalled();
    expect(container.querySelector('[role="slider"]').getAttribute('aria-valuenow')).toBe('2040');
  });
  it('精确到达连续边界才更新下一镜，不提前一毫秒', async () => {
    await render({ parts: [parts[0], { ...parts[1], start: 3000 }] });
    const main = container.querySelector('.storyboard-preview__media');
    await click('[aria-label="播放分镜序列"]');
    callbacks.onSelect.mockClear();
    main.currentTime = 2.9995;
    await frame();
    expect(callbacks.onSelect).not.toHaveBeenCalled();
    main.currentTime = 3;
    const seek = vi.spyOn(main, 'currentTime', 'set');
    await frame();
    expect(callbacks.onSelect).toHaveBeenCalledWith('b');
    expect(seek).not.toHaveBeenCalled();
  });
  it('一帧跨过多镜时保留实际播放位置，不逐镜回跳', async () => {
    const short = [
      { ...parts[0], end: 1100 },
      { ...parts[1], start: 1100, end: 1200 },
      { ...parts[1], id: 'c', label: 'part3_1', start: 1200, end: 2000 },
    ];
    await render({ parts: short });
    const main = container.querySelector('.storyboard-preview__media');
    await click('[aria-label="播放分镜序列"]');
    main.currentTime = 1.35;
    const seek = vi.spyOn(main, 'currentTime', 'set');
    await frame();
    expect(seek).not.toHaveBeenCalled();
    expect(callbacks.onSelect).toHaveBeenLastCalledWith('c');
    expect(container.querySelector('[role="slider"]').getAttribute('aria-valuenow')).toBe('350');
  });
  it('跨越连续短镜后遇到真实删除区间仍必须跳转', async () => {
    await render({ parts: [
      { ...parts[0], end: 1100 },
      { ...parts[1], start: 1100, end: 1200 },
      { ...parts[1], id: 'c', start: 1700, end: 2000 },
    ] });
    const main = container.querySelector('.storyboard-preview__media');
    await click('[aria-label="播放分镜序列"]');
    main.currentTime = 1.35;
    const seek = vi.spyOn(main, 'currentTime', 'set');
    await frame();
    expect(seek).toHaveBeenCalledExactlyOnceWith(1.7);
    expect(callbacks.onSelect).toHaveBeenLastCalledWith('c');
    expect(container.querySelector('[role="slider"]').getAttribute('aria-valuenow')).toBe('200');
  });
  it('同一分镜内连续源区间也不跳转', async () => {
    await render({ parts: [{ ...parts[0], end: 2000,
      ranges: [{ start: 1000, end: 1100 }, { start: 1100, end: 2000 }] }] });
    const main = container.querySelector('.storyboard-preview__media');
    await click('[aria-label="播放分镜序列"]');
    main.currentTime = 1.15;
    const seek = vi.spyOn(main, 'currentTime', 'set');
    await frame();
    expect(seek).not.toHaveBeenCalled();
    expect(container.querySelector('[role="slider"]').getAttribute('aria-valuenow')).toBe('150');
  });
  it('源时间虽然相接，但进入空分镜仍暂停媒体', async () => {
    await render({ parts: [parts[0], { ...parts[1], start: 3000, blank: true }] });
    const main = container.querySelector('.storyboard-preview__media');
    await click('[aria-label="播放分镜序列"]');
    HTMLMediaElement.prototype.pause.mockClear();
    main.currentTime = 3.017;
    await frame();
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(callbacks.onSelect).toHaveBeenCalledWith('b');
    expect(container.querySelector('[role="slider"]').getAttribute('aria-valuenow')).toBe('2000');
  });
  it('播放跨片段跳过源间隙并在序列结尾停止', async () => {
    await render();
    const main = container.querySelector('.storyboard-preview__media');
    await click('[aria-label="播放分镜序列"]');
    main.currentTime = 3.01;
    await frame();
    expect(main.currentTime).toBe(5);
    expect(callbacks.onSelect).toHaveBeenCalledWith('b');
    main.currentTime = 9.01;
    await frame();
    expect(main.currentTime).toBe(9);
    expect(container.querySelector('[aria-label="播放分镜序列"]')).not.toBeNull();
    expect(container.querySelector('[role="slider"]').getAttribute('aria-valuenow')).toBe('6000');
  });
  it('空分镜静音计时，随后恢复源素材播放', async () => {
    const blank = { ...parts[0], id: 'empty', blank: true, start: 0, end: 100 };
    await render({ parts: [blank, parts[1]], selectedId: 'empty' });
    await click('[aria-label="播放分镜序列"]');
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    await frame(performance.now() + 150);
    expect(callbacks.onSelect).toHaveBeenCalledWith('b');
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });
  it('快速播放再暂停时，迟到的 play 完成不会继续播放', async () => {
    let finish;
    HTMLMediaElement.prototype.play.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await render();
    await click('[aria-label="播放分镜序列"]');
    await click('[aria-label="暂停预览"]');
    HTMLMediaElement.prototype.pause.mockClear();
    await act(async () => finish());
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  });
  it('分割后保留播放位置，不跳回原片段开头', async () => {
    await render();
    await act(async () => container.querySelector('[role="slider"]').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }),
    ));
    const split = [
      { ...parts[0], end: 2000 },
      { ...parts[0], id: 'a-right', start: 2000 },
      parts[1],
    ];
    await act(async () => root.render(<StoryboardEditor parts={split} selectedId="a"
      source="https://example.com/source.mp4" {...callbacks} />));
    expect(container.querySelector('[role="slider"]').getAttribute('aria-valuenow')).toBe('1000');
    expect(container.querySelector('.storyboard-preview__media').currentTime).toBe(2);
    expect(callbacks.onSelect).toHaveBeenCalledWith('a-right');
  });
  it('卸载时暂停主播放器和悬停播放器', async () => {
    await render();
    await click('[aria-label="播放分镜序列"]');
    HTMLMediaElement.prototype.pause.mockClear();
    await act(async () => root.unmount());
    root = null;
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(2);
  });
  it('禁用时不允许拖动、分割或插入', async () => {
    await render({ disabled: true });
    await pointer('pointerdown', 100);
    await click('[aria-label="拆分分镜"]');
    await click('[aria-label="在末尾新增空分镜"]');
    expect(callbacks.onSplit).not.toHaveBeenCalled();
    expect(callbacks.onInsert).not.toHaveBeenCalled();
    expect(container.querySelector('[role="slider"]').getAttribute('aria-valuenow')).toBe('0');
  });
  it('不显示分镜时长、悬停名称、右上角提示和下载入口', async () => {
    await render();
    await pointer('pointermove', 100);
    expect(container.querySelector('[aria-label="下载分镜 JSON"]')).toBeNull();
    expect(container.querySelector('.storyboard-clip__duration')).toBeNull();
    expect(container.querySelector('.storyboard-clip__name')).toBeNull();
    expect(container.querySelector('.storyboard-clip[title]')).toBeNull();
    expect(container.querySelector('.storyboard-preview__badge')).toBeNull();
    expect(container.querySelector('.storyboard-preview__hover.is-visible')).not.toBeNull();
    expect(container.querySelector('.storyboard-zoom')).toBeNull();
    expect(container.querySelector('[aria-label="静音"]')).toBeNull();
  });
  it('缩放改变片段宽度，不改变播放时间，刻度依然对应片段位置', async () => {
    await render();
    await pointer('pointerdown', 100);
    await pointer('pointerup', 100);
    const initialTime = container.querySelector('[aria-label="播放进度"]').getAttribute('aria-valuenow');
    const width = parseFloat(container.querySelector('.storyboard-clip').style.width) + 3;
    await wheel({ deltaY: -Math.log(1.25) / 0.01, ctrlKey: true });
    expect(parseFloat(container.querySelector('.storyboard-clip').style.width) + 3).toBeCloseTo(width * 1.25);
    expect(container.querySelector('[aria-label="播放进度"]').getAttribute('aria-valuenow')).toBe(initialTime);
    await wheel({ deltaY: Math.log(1.25) / 0.01, ctrlKey: true });
    expect(parseFloat(container.querySelector('.storyboard-clip').style.width) + 3).toBeCloseTo(width);
    await wheel({ deltaY: -Math.log(2) / 0.01 });
    expect(parseFloat(container.querySelector('.storyboard-clip').style.width) + 3).toBeCloseTo(width * 2);
    expect(container.querySelectorAll('.storyboard-clips button')[1].style.left).toBe(`${width * 2}px`);
  });
  it('手势缩放限制在 25% 到 400%', async () => {
    await render();
    const width = parseFloat(container.querySelector('.storyboard-clip').style.width) + 3;
    for (const [deltaY, factor] of [[10000, 0.25], [-10000, 4]]) {
      const event = await wheel({ deltaY });
      expect(event.defaultPrevented).toBe(true);
      expect(parseFloat(container.querySelector('.storyboard-clip').style.width) + 3).toBeCloseTo(width * factor);
    }
  });
  it('双指横滑保留原生滚动，上下滑动才缩放', async () => {
    await render();
    const width = container.querySelector('.storyboard-clip').style.width;
    expect((await wheel({ deltaX: 60, deltaY: 2 })).defaultPrevented).toBe(false);
    expect(container.querySelector('.storyboard-clip').style.width).toBe(width);
    expect((await wheel({ deltaY: -30 })).defaultPrevented).toBe(true);
    expect(container.querySelector('.storyboard-clip').style.width).not.toBe(width);
  });
  it('手势以光标为中心缩放，并考虑弹窗的 80% 缩放', async () => {
    await render();
    const scroller = container.querySelector('.storyboard-lane__scroll');
    Object.defineProperties(scroller, {
      offsetWidth: { value: 600 }, clientWidth: { value: 600 },
    });
    scroller.getBoundingClientRect = () => ({ left: 20, width: 480 });
    scroller.scrollLeft = 100;
    await wheel({ ctrlKey: true, clientX: 180, deltaY: -Math.log(2) / 0.01 });
    expect(scroller.scrollLeft).toBeCloseTo(400);
  });
  it.each(['Delete', 'Backspace'])('鼠标选中后按 %s 删除，并暂停播放', async (key) => {
    await render();
    await pointer('pointerdown', 50);
    await pointer('pointerup', 50);
    expect(document.activeElement).toBe(container.querySelector('.storyboard-editor'));
    const event = await pressDelete({ key });
    expect(event.defaultPrevented).toBe(true);
    expect(callbacks.onDelete).toHaveBeenCalledOnce();
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  });
  it('输入框、组合键、按住删除键和编辑器外不触发分镜删除', async () => {
    await render();
    await pointer('pointerdown', 50);
    for (const option of [{ repeat: true }, { metaKey: true }, { ctrlKey: true }, { isComposing: true }]) {
      expect((await pressDelete(option)).defaultPrevented).toBe(false);
    }
    const input = document.createElement('input');
    container.querySelector('.storyboard-editor').append(input);
    input.focus();
    expect((await pressDelete()).defaultPrevented).toBe(false);
    expect((await pressDelete({}, document.body)).defaultPrevented).toBe(false);
    expect(callbacks.onDelete).not.toHaveBeenCalled();
  });
  it('禁用时手势和键盘均不修改轨道', async () => {
    await render({ disabled: true });
    const editor = container.querySelector('.storyboard-editor');
    editor.focus();
    expect((await wheel()).defaultPrevented).toBe(false);
    expect((await pressDelete()).defaultPrevented).toBe(false);
    expect(callbacks.onDelete).not.toHaveBeenCalled();
  });
  it('原生全屏不可用时铺满应用，Esc 返回且保留播放器', async () => {
    await render();
    const editor = container.querySelector('.storyboard-editor');
    const media = container.querySelector('.storyboard-preview__media');
    editor.requestFullscreen = vi.fn().mockRejectedValue(new Error('Not allowed'));
    await click('[aria-label="全屏编辑"]');
    expect(editor.classList.contains('is-fullscreen')).toBe(true);
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    await act(async () => document.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(editor.classList.contains('is-fullscreen')).toBe(false);
    expect(container.querySelector('.storyboard-preview__media')).toBe(media);
  });
});
