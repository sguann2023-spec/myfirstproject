import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { KonvaRenderer } from 'react-konva';
import { afterEach, expect, it, vi } from 'vitest';
import ImageAddDetailTool from './index';

vi.mock('../../renderer/src/services/LoggerService', () => ({
  loggerService: { withContext: () => ({ error: vi.fn() }) },
}));
vi.mock('../../api/capcut', () => ({
  queryScript: vi.fn(async () => ({
    output: { canvas_config: { width: 1080, height: 1920 }, tracks: [], materials: {} },
  })),
}));
vi.mock('../DraftSelect/index', () => ({ default: () => <button>Draft</button> }));

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('keeps the real canvas and timeline mounted while the parent receives repeated time changes', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', false);
  const update = async (callback) => {
    flushSync(callback);
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  window.matchMedia = () => ({
    matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
  });
  // Stub only pixel drawing; keep Konva's real React renderer and update scheduling.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () {
    return new Proxy({ canvas: this }, {
      get(target, key) {
        if (key in target) return target[key];
        if (key === 'measureText') return () => ({ width: 10 });
        if (key === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
        return () => {};
      },
    });
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,');
  vi.stubGlobal('Image', class {
    constructor() {
      const image = document.createElement('img');
      Object.defineProperties(image, {
        naturalWidth: { value: 2160 },
        naturalHeight: { value: 3840 },
        src: { set() { queueMicrotask(() => image.onload?.()); } },
      });
      return image;
    }
  });
  const previousApi = window.api;
  window.api = { file: { select: async () => [{ path: '/tmp/image.png', name: 'image.png' }] } };
  const host = document.createElement('div');
  document.body.append(host);
  const onUncaughtError = vi.fn();
  const root = createRoot(host, { onUncaughtError });
  let latest;
  function Parent() {
    const [settings, setSettings] = React.useState({});
    latest = settings;
    return <ImageAddDetailTool selectedDraftIds={['draft-1']} onSettingsChange={setSettings} />;
  }
  try {
    await update(() => root.render(<Parent />));
    await update(() => document.querySelector('[aria-label="导入图片"]').click());
    await update(() => document.querySelector('[role="tab"][aria-label="时间线"]').click());
    const input = document.querySelector('[aria-label="结束时间"]');
    await update(() => input.focus());
    const canvasUpdates = vi.spyOn(KonvaRenderer, 'updateContainer');
    for (let i = 0; i < 100; i += 1) {
      await update(() => input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ArrowUp', keyCode: 38, which: 38, bubbles: true,
      })));
    }
    expect(latest.end).toBe(4);
    expect(canvasUpdates).not.toHaveBeenCalled();
    expect(onUncaughtError).not.toHaveBeenCalled();
    expect(document.querySelector('canvas')).not.toBeNull();
    expect(document.querySelector('[aria-label="结束时间"]')).toBe(input);
  } finally {
    await update(() => root.unmount());
    host.remove();
    window.api = previousApi;
  }
});
