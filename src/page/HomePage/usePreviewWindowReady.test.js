// @vitest-environment jsdom
import { act, createElement, StrictMode, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePreviewWindowReady } from './usePreviewWindowReady';

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

describe('usePreviewWindowReady', () => {
  let container;
  let root;
  let frames;
  let api;
  let onError;

  const Preview = (props) => {
    const layoutRef = useRef(null);
    const { ready, layoutWidth } = usePreviewWindowReady({ extraWidth: 400, layoutRef, onError, ...props });
    return createElement('div', { ref: layoutRef, 'data-ready': String(ready), style: { width: layoutWidth ?? undefined } });
  };

  const render = async (previewRequested, isFullscreen = false, extraWidth = 400) => {
    await act(async () => {
      root.render(createElement(StrictMode, null, createElement(Preview, { previewRequested, isFullscreen, extraWidth })));
    });
  };

  const nextFrame = async () => {
    await act(async () => {
      const callbacks = frames.splice(0);
      callbacks.forEach((callback) => callback(0));
    });
  };

  const isReady = () => container.firstChild.dataset.ready === 'true';

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    frames = [];
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 1192 });
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => frames.push(callback));
    api = {
      getSize: vi.fn().mockResolvedValue([1200, 800]),
      setSize: vi.fn().mockResolvedValue(undefined),
    };
    window.api = { window: api };
    onError = vi.fn();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    delete window.api;
    vi.restoreAllMocks();
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });

  it('keeps the preview hidden until native expansion completes and the next frame arrives', async () => {
    const resize = deferred();
    api.setSize.mockReturnValueOnce(resize.promise);
    await render(true);
    expect(api.setSize).toHaveBeenCalledExactlyOnceWith(1600, 800, false);
    expect(isReady()).toBe(false);
    expect(container.firstChild.style.width).toBe('1192px');
    expect(frames).toHaveLength(0);

    await act(async () => resize.resolve());
    expect(isReady()).toBe(false);
    expect(container.firstChild.style.width).toBe('1192px');
    await nextFrame();
    expect(isReady()).toBe(true);
    expect(container.firstChild.style.width).toBe('');
  });

  it('hides before restoring the original width without animation', async () => {
    await render(true);
    await nextFrame();
    const restore = deferred();
    api.setSize.mockReturnValueOnce(restore.promise);

    await render(false);
    expect(isReady()).toBe(false);
    expect(container.firstChild.style.width).toBe('1192px');
    expect(api.setSize).toHaveBeenLastCalledWith(1200, 800, false);
    await act(async () => restore.resolve());
    expect(isReady()).toBe(false);
    expect(container.firstChild.style.width).toBe('1192px');
    await nextFrame();
    expect(container.firstChild.style.width).toBe('');
  });

  it('restores after closing while expansion is still pending and never reveals the stale preview', async () => {
    const resize = deferred();
    api.setSize.mockReturnValueOnce(resize.promise);
    await render(true);
    await render(false);
    expect(api.setSize).toHaveBeenCalledTimes(1);

    await act(async () => resize.resolve());
    expect(api.setSize).toHaveBeenNthCalledWith(2, 1200, 800, false);
    expect(isReady()).toBe(false);
    expect(container.firstChild.style.width).toBe('1192px');
    await nextFrame();
    expect(isReady()).toBe(false);
    expect(container.firstChild.style.width).toBe('');
  });

  it('does not expand twice when reopened during an in-flight expansion', async () => {
    const resize = deferred();
    api.setSize.mockReturnValueOnce(resize.promise);
    await render(true);
    await render(false);
    await render(true);
    await act(async () => resize.resolve());
    await nextFrame();

    expect(api.setSize).toHaveBeenCalledTimes(1);
    expect(isReady()).toBe(true);
  });

  it('does not resize for unrelated renders while the preview remains open', async () => {
    await render(true);
    await nextFrame();
    await render(true);
    expect(api.setSize).toHaveBeenCalledTimes(1);
    expect(isReady()).toBe(true);
  });

  it('shows fullscreen previews without resizing the native window', async () => {
    await render(true, true);
    expect(container.firstChild.style.width).toBe('');
    await nextFrame();
    expect(api.setSize).not.toHaveBeenCalled();
    expect(isReady()).toBe(true);
  });

  it('still shows the preview when native window APIs are unavailable', async () => {
    delete window.api;
    await render(true);
    expect(container.firstChild.style.width).toBe('');
    await nextFrame();
    expect(isReady()).toBe(true);
  });

  it('reports resize failures and allows the preview to remain usable', async () => {
    const error = new Error('resize failed');
    api.setSize.mockRejectedValueOnce(error);
    await render(true);
    await nextFrame();
    expect(onError).toHaveBeenCalledWith(error);
    expect(isReady()).toBe(true);

    await render(false);
    await nextFrame();
    await render(true);
    await nextFrame();
    expect(api.setSize).toHaveBeenCalledTimes(2);
    expect(isReady()).toBe(true);
  });

  it('expands by the actual preview width instead of a fixed default', async () => {
    await render(true, false, 320);
    await nextFrame();
    expect(api.setSize).toHaveBeenCalledExactlyOnceWith(1520, 800, false);
    expect(isReady()).toBe(true);
    expect(container.firstChild.style.width).toBe('');
  });

  it('does not hide or relock the layout when the user drags the preview width', async () => {
    await render(true, false, 320);
    await nextFrame();
    await render(true, false, 450);
    expect(api.setSize).toHaveBeenCalledTimes(1);
    expect(isReady()).toBe(true);
    expect(container.firstChild.style.width).toBe('');
  });
});
