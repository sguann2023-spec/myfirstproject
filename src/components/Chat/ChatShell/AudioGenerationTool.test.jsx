import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { AudioGenerationToolBody } from '@renderer/pages/home/Messages/Tools/MessageAgentTools/AudioGenerationTool';

let container, root, observers, viewportWidth, naturalWidth, frames;
async function flushFrames() {
  await act(async () => { const pending = frames.splice(0); pending.forEach(callback => callback()); });
}
async function resize(observer = observers[0]) {
  await act(async () => observer.callback([]));
  await flushFrames();
}
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  observers = [];
  frames = [];
  viewportWidth = 160;
  naturalWidth = 480;
  vi.stubGlobal('ResizeObserver', class {
    observe = vi.fn();
    disconnect = vi.fn();
    constructor(callback) { this.callback = callback; observers.push(this); }
  });
  vi.stubGlobal('requestAnimationFrame', vi.fn(callback => { frames.push(callback); return frames.length; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(document, 'createRange').mockImplementation(() => ({
    selectNodeContents: vi.fn(),
    getBoundingClientRect: () => ({ width: naturalWidth })
  }));
  Object.defineProperty(document, 'fonts', { configurable: true, get: () => undefined });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => viewportWidth);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    return { width: this.tagName === 'SPAN' ? naturalWidth : viewportWidth, left: 0 };
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const title = '完整配音文案'.repeat(20);
async function render(props = {}) {
  await act(async () => root.render(<AudioGenerationToolBody compact title={title} output={{ status: 'completed', audio_url: 'https://example.com/test.mp3', duration_seconds: 12, billing: { total_consumed_points: 2 } }} {...props} />));
  return container.querySelector('[title]');
}
function cssFor(element) {
  return [...document.querySelectorAll('style')].map(el => el.textContent).join('\n').split('}').filter(rule => [...element.classList].some(name => rule.includes(`.${name}`))).join('}');
}
it('keeps text inline for native ellipsis and reserves the available flex width', async () => {
  const viewport = await render();
  const spanRules = cssFor(viewport.firstElementChild).split('}')[0];
  expect(spanRules).toContain('display:inline;');
  expect(spanRules).not.toContain('width:max-content');
  expect(cssFor(viewport)).toContain('flex:1 1 0%');
  expect(cssFor(viewport)).toContain('text-overflow:ellipsis');
});
it('coalesces resize notifications and measures text independently of its animated box', async () => {
  const viewport = await render();
  const originalClass = viewport.className;
  await act(async () => {
    observers[0].callback([]);
    observers[0].callback([]);
    window.dispatchEvent(new Event('resize'));
  });
  expect(frames).toHaveLength(1);
  // A transformed span box can change without a change to the actual text.
  HTMLElement.prototype.getBoundingClientRect.mockReturnValue({ width: 999, left: 0 });
  await flushFrames();
  expect(viewport.style.getPropertyValue('--audio-title-offset')).toBe('-320px');
  expect(viewport.className).toBe(originalClass);
});
it('remeasures after font loading and cleans up pending work', async () => {
  const fonts = new EventTarget();
  let ready;
  fonts.ready = new Promise(resolve => { ready = resolve; });
  vi.spyOn(document, 'fonts', 'get').mockReturnValue(fonts);
  const viewport = await render();
  naturalWidth = 600;
  await act(async () => ready());
  await flushFrames();
  expect(viewport.style.getPropertyValue('--audio-title-offset')).toBe('-440px');
  naturalWidth = 640;
  fonts.dispatchEvent(new Event('loadingdone'));
  await flushFrames();
  expect(viewport.style.getPropertyValue('--audio-title-offset')).toBe('-480px');
  window.dispatchEvent(new Event('resize'));
  await act(async () => root.render(null));
  expect(cancelAnimationFrame).toHaveBeenCalled();
  await flushFrames();
  fonts.dispatchEvent(new Event('loadingdone'));
  expect(frames).toHaveLength(0);
});
it('measures the real title span and keeps the actual player and progress working', async () => {
  const viewport = await render();
  expect(viewport.title).toBe(title);
  expect(viewport.style.getPropertyValue('--audio-title-offset')).toBe('-320px');
  expect(viewport.firstElementChild.tagName).toBe('SPAN');
  expect(observers[0].observe.mock.calls.map(([el]) => el)).toEqual([viewport]);
  const rules = cssFor(viewport);
  expect(rules).toContain(':hover');
  expect(rules).toContain(':focus-within');
  expect(rules).toContain('animation:');
  expect(document.querySelector('style').textContent).toContain('prefers-reduced-motion: no-preference');
  expect(document.querySelector('style').textContent).toContain('translateX(var(--audio-title-offset))');
  const audio = container.querySelector('audio');
  expect(audio).not.toBeNull();
  const play = vi.spyOn(audio, 'play').mockResolvedValue(undefined);
  await act(async () => container.querySelector('button').click());
  expect(play).toHaveBeenCalledOnce();
  await act(async () => {
    audio.currentTime = 6;
    audio.dispatchEvent(new Event('timeupdate'));
  });
  expect(container.querySelector('[role="slider"]').getAttribute('aria-valuenow')).toBe('6');
  expect(container.textContent).toContain('00:06');
  expect(container.textContent).toContain('00:12');
});
it('does not animate short or exactly fitting titles', async () => {
  naturalWidth = 80;
  const viewport = await render();
  expect(viewport.style.getPropertyValue('--audio-title-offset')).toBe('-0px');
  expect(cssFor(viewport)).not.toContain('animation:');
  naturalWidth = viewportWidth;
  await resize();
  expect(cssFor(viewport)).not.toContain('animation:');
});
it('waits for a visible viewport and handles natural text width changes', async () => {
  viewportWidth = 0;
  const viewport = await render();
  expect(cssFor(viewport)).not.toContain('animation:');
  viewportWidth = 160;
  await resize();
  expect(viewport.style.getPropertyValue('--audio-title-offset')).toBe('-320px');
  naturalWidth = 120;
  await resize();
  expect(cssFor(viewport)).not.toContain('animation:');
});
it('keeps the tooltip and player available without ResizeObserver', async () => {
  vi.stubGlobal('ResizeObserver', undefined);
  const viewport = await render();
  expect(viewport.title).toBe(title);
  expect(container.querySelector('audio')).not.toBeNull();
  expect(observers).toHaveLength(0);
});
it('never enables measurement or animation for ordinary chat or blank compact titles', async () => {
  const viewport = await render({ compact: false });
  expect(viewport.firstElementChild).toBeNull();
  expect(observers).toHaveLength(0);
  expect(cssFor(viewport)).not.toContain('animation:');
  await render({ title: '   ' });
  expect(observers).toHaveLength(0);
  expect(container.textContent).toContain('人声配音');
});
it('remeasures both width directions and disconnects on title change, disabling and unmount', async () => {
  const viewport = await render();
  viewportWidth = 600;
  await resize();
  expect(cssFor(viewport)).not.toContain('animation:');
  viewportWidth = 100;
  await resize();
  expect(viewport.style.getPropertyValue('--audio-title-offset')).toBe('-380px');
  await render({ title: '替换文案' });
  expect(observers[0].disconnect).toHaveBeenCalledOnce();
  await render({ compact: false });
  expect(observers[1].disconnect).toHaveBeenCalledOnce();
  await render();
  await act(async () => root.render(null));
  expect(observers[2].disconnect).toHaveBeenCalledOnce();
  await act(async () => observers[2].callback([]));
});
