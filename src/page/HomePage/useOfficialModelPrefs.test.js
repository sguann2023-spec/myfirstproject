import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useOfficialModelPrefs } from './useOfficialModelPrefs';

describe('useOfficialModelPrefs', () => {
  let root, container, current, api;
  const render = async () => {
    function Probe() { current = useOfficialModelPrefs(); return null; }
    await act(async () => root.render(createElement(Probe)));
  };
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    api = {
      getPrefs: vi.fn().mockResolvedValue({ disabledModelIds: [] }),
      onChanged: vi.fn(() => vi.fn()),
    };
    window.electronAPI = { officialChatModels: api };
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    delete window.electronAPI;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    vi.restoreAllMocks();
  });

  it('loads the persisted disabled list and reloads on cross-window changes', async () => {
    let changed;
    const unsubscribe = vi.fn();
    api.onChanged = vi.fn(callback => { changed = callback; return unsubscribe; });
    api.getPrefs.mockResolvedValueOnce({ disabledModelIds: ['glm-5.3'] });
    await render();
    expect(current).toEqual(['glm-5.3']);
    api.getPrefs.mockResolvedValueOnce({ disabledModelIds: [] });
    await act(async () => { await changed(); });
    expect(current).toEqual([]);
    await act(async () => root.unmount());
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('keeps all models enabled when prefs are unavailable or rejected', async () => {
    api.getPrefs.mockRejectedValue(new Error('SECRET'));
    await render();
    expect(current).toEqual([]);
    delete window.electronAPI;
    await act(async () => root.unmount());
    root = createRoot(container);
    await render();
    expect(current).toEqual([]);
  });
});