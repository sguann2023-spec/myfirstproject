import { act, createElement, StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCustomChatModels } from './useCustomChatModels';
import { useChatModelPreference } from './useChatModelPreference';
import { customModelToOption } from './chatProviders';
import { readFileSync } from 'node:fs';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

describe('useCustomChatModels', () => {
  let root, container, current, api;
  const render = async (strict = false) => {
    function Probe() { current = useCustomChatModels(); return null; }
    await act(async () => root.render(strict ? createElement(StrictMode, null, createElement(Probe)) : createElement(Probe)));
  };
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    api = { list: vi.fn().mockResolvedValue([]), save: vi.fn() };
    window.electronAPI = { customChatModels: api };
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    localStorage.clear();
    delete window.electronAPI;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    vi.restoreAllMocks();
  });

  // Exercise the actual HomePage readiness expression without mounting the entire page.
  const homeSource = readFileSync(`${process.cwd()}/src/page/HomePage/HomePage.jsx`, 'utf8');
  const readiness = homeSource.match(/listLoaded: (.+),/)[1];
  const isReady = new Function('customChatModels', 'chatModelListLoading', `return ${readiness};`);
  function PreferenceProbe({ remoteLoading, remoteOptions = [], initialModel = '' }) {
    const customChatModels = useCustomChatModels();
    const [savedModel, setSavedModel] = useState(initialModel);
    const options = [{ value: 'built-in' }, ...remoteOptions, ...customChatModels.models.map(customModelToOption)];
    const [model] = useChatModelPreference({ fallbackModel: 'built-in', options,
      listLoaded: isReady(customChatModels, remoteLoading), savedModel, onModelChange: setSavedModel });
    current = { ...customChatModels, model };
    return null;
  }

  it('does not discard a saved remote model when custom loading finishes first', async () => {
    api.list.mockResolvedValue([{ id: 'custom-one', modelId: 'local', name: 'Local' }]);
    await act(async () => root.render(createElement(PreferenceProbe, { remoteLoading: true, initialModel: 'remote-model' })));
    expect(current.loading).toBe(false);
    expect(current.model).toBe('remote-model');
    await act(async () => root.render(createElement(PreferenceProbe, {
      remoteLoading: false, remoteOptions: [{ value: 'remote-model' }], initialModel: 'remote-model',
    })));
    expect(current.model).toBe('remote-model');
  });

  it('falls back after remote failure when all custom models are deleted', async () => {
    const models = [{ id: 'custom-one', modelId: 'local', name: 'Local' }];
    api.list.mockResolvedValue(models);
    await act(async () => root.render(createElement(PreferenceProbe, { remoteLoading: false, initialModel: 'custom-one:local' })));
    expect(current.model).toBe('custom-one:local');
    api.save.mockResolvedValue([]);
    await act(async () => { await current.save([]); });
    expect(current.model).toBe('built-in');
  });

  it('blocks saves while loading and uses the authoritative IPC save result', async () => {
    const list = deferred();
    api.list.mockReturnValue(list.promise);
    await render();
    expect(current).toMatchObject({ models: [], loading: true, error: '' });
    await expect(current.save([])).rejects.toThrow('正在读取配置');
    expect(api.save).not.toHaveBeenCalled();
    await act(async () => list.resolve([{ id: 'existing' }]));
    expect(current.models).toEqual([{ id: 'existing' }]);
    const input = [{ id: 'new', name: ' draft ' }];
    const saved = [{ id: 'new', name: 'draft' }];
    api.save.mockResolvedValue(saved);
    let result;
    await act(async () => { result = await current.save(input); });
    expect(api.save).toHaveBeenCalledWith(input);
    expect(result).toBe(saved);
    expect(current.models).toBe(saved);
  });

  it.each(['missing bridge', 'rejected IPC', 'synchronous IPC failure'])('fails closed with safe error text: %s', async (mode) => {
    if (mode === 'missing bridge') delete window.electronAPI;
    if (mode === 'rejected IPC') api.list.mockRejectedValue(new Error('SECRET-KEY'));
    if (mode === 'synchronous IPC failure') api.list.mockImplementation(() => { throw new Error('SECRET-KEY'); });
    await render();
    expect(current.loading).toBe(false);
    expect(current.models).toEqual([]);
    expect(current.error).toContain('无法读取');
    expect(current.error).not.toContain('SECRET-KEY');
    await expect(current.save([])).rejects.toThrow(current.error);
    expect(api.save).not.toHaveBeenCalled();
  });

  it('retains previous models on failed save and allows retry', async () => {
    const existing = [{ id: 'existing' }];
    api.list.mockResolvedValue(existing);
    await render();
    api.save.mockRejectedValueOnce(new Error('save failed')).mockResolvedValueOnce([]);
    await act(async () => { await expect(current.save([])).rejects.toThrow('save failed'); });
    expect(current.models).toBe(existing);
    expect(current.error).toBe('');
    await act(async () => { await current.save([]); });
    expect(current.models).toEqual([]);
  });

  it('ignores the abandoned StrictMode load even when it finishes last', async () => {
    const abandoned = deferred(), active = deferred();
    api.list.mockReturnValueOnce(abandoned.promise).mockReturnValueOnce(active.promise);
    await render(true);
    await act(async () => active.resolve([{ id: 'active' }]));
    await act(async () => abandoned.resolve([{ id: 'stale' }]));
    expect(current.models).toEqual([{ id: 'active' }]);
    expect(current.loading).toBe(false);
  });

  it('reloads on changes, retains models while pending, and ignores stale results', async () => {
    let changed;
    const unsubscribe = vi.fn();
    api.onChanged = vi.fn(callback => { changed = callback; return unsubscribe; });
    api.list.mockResolvedValueOnce([{ id: 'existing' }]);
    await render();
    const stale = deferred(), latest = deferred();
    api.list.mockReturnValueOnce(stale.promise).mockReturnValueOnce(latest.promise);
    await act(async () => { void changed(); });
    expect(current.models).toEqual([{ id: 'existing' }]);
    expect(current.loading).toBe(true);
    await act(async () => { void changed(); });
    await act(async () => latest.resolve([{ id: 'latest' }]));
    await act(async () => stale.reject(new Error('stale failure')));
    expect(current).toMatchObject({ models: [{ id: 'latest' }], error: '', loading: false });
    await act(async () => root.unmount());
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('retains existing models after a reload failure and recovers on the next change', async () => {
    let changed;
    api.onChanged = callback => { changed = callback; return vi.fn(); };
    api.list.mockResolvedValueOnce([{ id: 'existing' }]);
    await render();
    api.list.mockRejectedValueOnce(new Error('SECRET'));
    await act(async () => { await changed(); });
    expect(current.models).toEqual([{ id: 'existing' }]);
    expect(current.error).toContain('无法读取');
    api.list.mockResolvedValueOnce([]);
    await act(async () => { await changed(); });
    expect(current).toMatchObject({ models: [], error: '', loading: false });
  });

  it('does not update state when an IPC load settles after unmount', async () => {
    const pending = deferred();
    api.list.mockReturnValue(pending.promise);
    await render();
    const snapshot = current;
    await act(async () => root.unmount());
    await act(async () => pending.reject(new Error('late error')));
    expect(current).toBe(snapshot);
  });
});
