import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPresetReferenceRoot, loadPresetReferencePage } from './presetReferences';

const store = vi.hoisted(() => ({ get: vi.fn(), onDidChange: vi.fn() }));
vi.mock('../../../shared/electronStore', () => ({ electronStore: store }));
import { usePresetReferences } from './usePresetReferences';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const directories = (count) => Array.from({ length: count }, (_, index) => ({ name: `预设${index}`, path: `预设${index}`, type: 'directory' }));
let host, root, state, list, changed;
function Probe({ open = true, query = '' }) {
  state = usePresetReferences(open, query);
  return null;
}
async function render(props = {}) {
  await act(async () => root.render(React.createElement(Probe, props)));
  await act(async () => vi.runAllTimersAsync());
}
beforeEach(() => {
  vi.useFakeTimers();
  store.get.mockReturnValue('/presets');
  store.onDidChange.mockImplementation((key, handler) => { changed = handler; return vi.fn(); });
  list = vi.fn().mockResolvedValue([]);
  window.require = () => path;
  window.api = { file: { listDirectory: list } };
  host = document.createElement('div');
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('preset directory references', () => {
  it('requires an absolute configured folder', () => {
    expect(getPresetReferenceRoot('', path)).toBe('');
    expect(getPresetReferenceRoot('relative', path)).toBe('');
    expect(getPresetReferenceRoot('/base', path)).toBe('/base/Combination/Presets');
    expect(getPresetReferenceRoot('C:\\base', path.win32)).toBe('C:\\base\\Combination\\Presets');
  });

  it.each([0, 1, 10, 11, 20, 21])('loads %i directories ten at a time', async (count) => {
    const all = directories(count);
    const api = vi.fn(async (_, options) => all.slice(options.offset, options.offset + options.maxEntries));
    const loaded = [];
    let more = true;
    while (more) {
      const page = await loadPresetReferencePage(api, '/presets', '餐厅', loaded.length);
      expect(page.items.length).toBeLessThanOrEqual(10);
      loaded.push(...page.items);
      more = page.hasMore;
    }
    expect(loaded).toEqual(all);
    expect(api.mock.calls[0][1]).toMatchObject({ recursive: false, includeFiles: false, includeDirectories: true, nameQuery: '餐厅', offset: 0, maxEntries: 11 });
    expect(api.mock.calls.every(([folder]) => folder === '/presets')).toBe(true);
  });

  it('appends pages, guards duplicate requests and resets on search and reopen', async () => {
    list.mockImplementation(async (_, options) => directories(21).slice(options.offset, options.offset + options.maxEntries));
    await render();
    expect(state.items).toHaveLength(10);
    expect(state.hasMore).toBe(true);
    await act(async () => { state.loadMore(); state.loadMore(); });
    expect(state.items).toHaveLength(20);
    expect(list).toHaveBeenCalledTimes(2);
    await act(async () => state.loadMore());
    expect(state.items).toHaveLength(21);
    expect(state.hasMore).toBe(false);
    await render({ query: '新' });
    expect(list.mock.lastCall[1]).toMatchObject({ nameQuery: '新', offset: 0 });
    expect(state.items).toHaveLength(10);
    await render({ open: false });
    await render();
    expect(state.items).toHaveLength(10);
  });

  it('ignores stale results after a configuration change', async () => {
    let finish;
    list.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await render();
    await act(async () => changed('/other'));
    await act(async () => vi.runAllTimersAsync());
    expect(list.mock.lastCall[0]).toBe('/other/Combination/Presets');
    await act(async () => finish(directories(11)));
    expect(state.items).toEqual([]);
  });

  it('retries failed pages without dropping previous items', async () => {
    list.mockResolvedValueOnce(directories(11)).mockRejectedValueOnce(new Error('missing')).mockResolvedValueOnce(directories(1));
    await render();
    await act(async () => state.loadMore());
    expect(state.items).toHaveLength(10);
    expect(state.error).toBeTruthy();
    await act(async () => state.loadMore());
    expect(state.items).toHaveLength(11);
    expect(state.error).toBe('');
    expect(list.mock.lastCall[1].offset).toBe(10);
  });

  it('does not request directories when unconfigured', async () => {
    store.get.mockReturnValue('');
    await render();
    expect(list).not.toHaveBeenCalled();
    expect(state.root).toBe('');
  });
});
