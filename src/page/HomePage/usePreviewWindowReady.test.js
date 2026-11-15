// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { usePreviewWindowReady } from './usePreviewWindowReady';

let root, container, api;
function Preview(props) {
  const { ready, layoutWidth } = usePreviewWindowReady(props);
  return createElement('div', { 'data-ready': String(ready), style: { width: layoutWidth ?? undefined } });
}
const render = async (props) => act(async () => root.render(createElement(Preview, props)));
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  api = { getSize: vi.fn(), setSize: vi.fn() };
  window.api = { window: api };
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete window.api;
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});
it.each([false, true])('opens and closes within the existing viewport (fullscreen=%s)', async (isFullscreen) => {
  for (const previewRequested of [false, true, false, true]) {
    await render({ previewRequested, isFullscreen });
    expect(container.firstChild.dataset.ready).toBe(String(previewRequested));
    expect(container.firstChild.style.width).toBe('');
  }
  expect(api.getSize).not.toHaveBeenCalled();
  expect(api.setSize).not.toHaveBeenCalled();
});
it('does not resize the native window when the preview width changes', async () => {
  await render({ previewRequested: true, extraWidth: 320 });
  await render({ previewRequested: true, extraWidth: 600 });
  expect(container.firstChild.dataset.ready).toBe('true');
  expect(container.firstChild.style.width).toBe('');
  expect(api.setSize).not.toHaveBeenCalled();
});
it('opens immediately without native window APIs', async () => {
  delete window.api;
  await render({ previewRequested: true });
  expect(container.firstChild.dataset.ready).toBe('true');
});
