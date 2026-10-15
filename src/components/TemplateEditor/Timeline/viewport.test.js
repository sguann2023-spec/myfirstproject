import { expect, it } from 'vitest';
import { MAX_ZOOM, MIN_ZOOM, viewportGeometry, wheelIntent, zoomAt } from './viewport';
import { rulerScale } from './TimelineRuler';

it('缩放后鼠标下方仍然是同一个时间，反向缩放恢复原视图', () => {
  const state = { width: 800, zoom: 2, scrollLeft: 300 };
  const next = zoomAt(state, 2.3, 250);
  const before = viewportGeometry(800, 15, state.zoom);
  const after = viewportGeometry(800, 15, next.zoom);
  expect((state.scrollLeft + 250) / before.pixelsPerSecond)
    .toBeCloseTo((next.scrollLeft + 250) / after.pixelsPerSecond);
  expect(zoomAt({ ...state, ...next }, 2, 250)).toEqual({ zoom: 2, scrollLeft: 300 });
});

it('缩放有上下限，缩小到适应范围以下仍覆盖完整刻度区域', () => {
  expect(zoomAt({ width: 800, zoom: 1, scrollLeft: 0 }, 0, 0).zoom).toBe(MIN_ZOOM);
  expect(zoomAt({ width: 800, zoom: 1, scrollLeft: 0 }, 100, 0).zoom).toBe(MAX_ZOOM);
  const view = viewportGeometry(800, 15, .5);
  expect(view.canvasWidth).toBe(800);
  expect(view.axisEnd).toBe(34);
  expect(zoomAt({ width: 800, zoom: 4, scrollLeft: 2000 }, .5, 400).scrollLeft).toBe(0);
});

it('捏合与 Ctrl/Cmd 滚轮缩放，双指横移与 Shift 滚轮平移', () => {
  const pinch = wheelIntent({ ctrlKey: true, deltaY: -2 }, 300);
  expect(pinch.kind).toBe('zoom');
  expect(pinch.factor).toBeGreaterThan(1);
  expect(pinch.factor).toBeLessThan(1.15);
  expect(wheelIntent({ metaKey: true, deltaY: 100 }, 300).factor).toBeCloseTo(1 / 1.15);
  expect(wheelIntent({ deltaX: 40, deltaY: 12 }, 300)).toEqual({ kind: 'pan', x: 40, y: 12 });
  expect(wheelIntent({ shiftKey: true, deltaY: 3, deltaMode: 1 }, 300)).toEqual({ kind: 'pan', x: 48, y: 0 });
});

it('细碎捏合事件不会重复放大，按总滚动量缩放且反向操作可恢复', () => {
  const factor = deltaY => wheelIntent({ ctrlKey: true, deltaY }, 300).factor;
  expect(factor(-1) ** 10).toBeCloseTo(factor(-10));
  expect(factor(-10)).toBeGreaterThan(factor(-2));
  expect(factor(-10)).toBeLessThan(1.15);
  expect(factor(-10) * factor(10)).toBeCloseTo(1);
  expect(factor(0)).toBe(1);
  expect(factor(-10000)).toBe(1.15);
  expect(wheelIntent({ ctrlKey: true, deltaY: -3, deltaMode: 1 }, 300).factor)
    .toBeCloseTo(factor(-48));
});

it('高倍率下只生成可见刻度，平移后仍保留主刻度位置', () => {
  const { pixelsPerSecond, axisEnd } = viewportGeometry(800, 15, 64);
  const scale = rulerScale(pixelsPerSecond, axisEnd, 8, 8 + 800 / pixelsPerSecond);
  expect(scale.marks.length).toBeLessThan(40);
  expect(scale.marks.some(mark => mark.major)).toBe(true);
});
