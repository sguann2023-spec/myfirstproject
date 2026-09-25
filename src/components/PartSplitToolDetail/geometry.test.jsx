import { describe, expect, it, vi } from 'vitest';
import { viewportRect } from './geometry';

describe('缩放轨道坐标', () => {
  it.each([true, false])('兼容旧版缩放坐标=%s，并保留滚动偏移', (legacy) => {
    const doc = document.implementation.createHTMLDocument();
    const host = doc.createElement('div');
    const element = doc.createElement('div');
    doc.body.append(host);
    host.append(element);
    Object.defineProperty(doc, 'defaultView', {
      value: { getComputedStyle: (node) => ({ zoom: node === host ? '0.8' : '1' }) },
    });
    const realCreate = doc.createElement.bind(doc);
    vi.spyOn(doc, 'createElement').mockImplementation((tag) => {
      const probe = realCreate(tag);
      probe.getBoundingClientRect = () => ({ width: legacy ? 100 : 200 });
      return probe;
    });
    element.getBoundingClientRect = () => ({
      left: legacy ? -100 : -80, top: legacy ? 200 : 160,
      width: legacy ? 1000 : 800, height: legacy ? 116 : 92.8,
    });
    const rect = viewportRect(element);
    expect(rect).toMatchObject({ left: -80, top: 160, width: 800 });
    expect(rect.height).toBeCloseTo(92.8);
    host.remove();
    vi.restoreAllMocks();
  });
});
