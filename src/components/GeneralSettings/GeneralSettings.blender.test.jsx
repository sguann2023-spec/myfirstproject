import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GeneralSettings from './GeneralSettings';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  store: { get: vi.fn((_key, fallback) => fallback), set: vi.fn(), onDidChange: vi.fn() }
}));
vi.mock('../../shared/electronStore', () => ({ electronStore: mocks.store }));
vi.mock('antd', () => ({
  Modal: { confirm: vi.fn() }, Switch: () => null,
  message: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() }
}));
const missing = { configuredPath: null, path: null, source: null, status: 'not-found', version: null };
const ready = { ...missing, path: '/Applications/Blender.app/Contents/MacOS/Blender', source: 'auto', status: 'ready', version: '5.3.0' };
const manual = { ...ready, configuredPath: '/custom/Blender.app', path: '/custom/Blender.app/Contents/MacOS/Blender', source: 'manual' };
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
let container;
let root;
let mounted;
const section = () => container.querySelector('.gs-blender-section');
const pathText = () => section().querySelector('.gs-save-path').textContent;
const button = (name) => [...section().querySelectorAll('button')].find(node => node.textContent === name);
const render = async (element = <GeneralSettings />) => { await act(async () => root.render(element)); };
const click = async (name) => { await act(async () => button(name).click()); };
const unmount = async () => { await act(async () => root.unmount()); mounted = false; };
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation(async channel => {
    if (channel === 'system:getBlenderPathInfo') return missing;
    if (channel === 'get-draft-folder' || channel === 'app:info') return {};
    return null;
  });
  window.ipc = { invoke: mocks.invoke, send: vi.fn() };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  mounted = true;
});
afterEach(async () => {
  if (mounted) await unmount();
  container.remove();
  delete window.ipc;
  delete window.require;
  vi.unstubAllGlobals();
});

describe('compact Blender location settings', () => {
  it('uses one standard path row and exactly two ordered buttons', async () => {
    await render();
    expect([...section().querySelectorAll('button')].map(node => node.textContent))
      .toEqual(['设置路径', 'Blender官网下载']);
    expect(section().querySelectorAll('.gs-save-row')).toHaveLength(1);
    expect(section().querySelector('input')).toBeNull();
    expect(section().querySelector('dl')).toBeNull();
    expect(pathText()).toBe('未设置');
    expect(section().querySelector('.gs-save-path').classList.contains('empty')).toBe(true);
    expect(section().querySelector('.gs-save-path').title).toBe('未设置');
    const titles = [...container.querySelectorAll('.gs-section-title')].map(node => node.textContent);
    expect(titles.indexOf('Blender位置')).toBe(titles.indexOf('预设位置') + 1);
    expect(titles.indexOf('下载设置')).toBe(titles.indexOf('Blender位置') + 1);
    expect(mocks.invoke).toHaveBeenCalledWith('system:getBlenderPathInfo', { force: false });
    await render();
    expect(mocks.invoke.mock.calls.filter(([channel]) => channel === 'system:getBlenderPathInfo')).toHaveLength(1);
  });

  it('shows only the effective path with the standard full-path tooltip', async () => {
    mocks.invoke.mockResolvedValueOnce(ready);
    await render();
    expect(pathText()).toBe(ready.path);
    expect(section().querySelector('.gs-save-path').title).toBe(ready.path);
    expect(section().querySelector('[role="status"]')).toBeNull();
    expect(section().textContent).not.toContain('5.3.0');
    expect([...section().querySelectorAll('button')].every(node => node.className === 'gs-save-button')).toBe(true);
    expect(mocks.store.set).not.toHaveBeenCalled();
  });

  it('detects silently without dimming controls and ignores a stale result after setting a path', async () => {
    const loading = deferred();
    mocks.invoke.mockImplementationOnce(() => loading.promise);
    await render();
    expect(pathText()).toBe('未设置');
    expect(section().textContent).not.toContain('正在检测');
    expect([...section().querySelectorAll('button')].every(node => !node.disabled)).toBe(true);
    mocks.invoke.mockResolvedValueOnce('/custom/Blender.app').mockResolvedValueOnce(manual);
    await click('设置路径');
    expect(pathText()).toBe(manual.path);
    await act(async () => loading.resolve(ready));
    expect(pathText()).toBe(manual.path);
  });

  it.each([
    ['MacIntel', undefined],
    ['Win32', [{ name: 'Blender 可执行文件', extensions: ['exe'] }]],
    ['Linux x86_64', undefined]
  ])('selects and immediately validates/saves a path on %s', async (platform, filters) => {
    vi.stubGlobal('process', { platform: '' });
    const original = Object.getOwnPropertyDescriptor(window.navigator, 'platform');
    Object.defineProperty(window.navigator, 'platform', { configurable: true, value: platform });
    try {
      mocks.invoke.mockResolvedValueOnce(ready);
      await render();
      mocks.invoke.mockResolvedValueOnce('  /custom/Blender.app  ').mockResolvedValueOnce(manual);
      await click('设置路径');
      const [, options] = mocks.invoke.mock.calls.find(([channel]) => channel === 'app:select');
      expect(options.properties).toEqual(['openFile']);
      expect(options.defaultPath).toBe(ready.path);
      expect(options.filters).toEqual(filters);
      expect(mocks.invoke).toHaveBeenLastCalledWith('system:setBlenderPath', '/custom/Blender.app');
      expect(pathText()).toBe(manual.path);
    } finally {
      if (original) Object.defineProperty(window.navigator, 'platform', original);
      else delete window.navigator.platform;
    }
  });

  it('picker cancellation leaves the configured path unchanged', async () => {
    mocks.invoke.mockResolvedValueOnce(manual);
    await render();
    mocks.invoke.mockResolvedValueOnce(null);
    await click('设置路径');
    expect(pathText()).toBe(manual.path);
    expect(mocks.invoke.mock.calls.some(([channel]) => channel === 'system:setBlenderPath')).toBe(false);
    expect(mocks.invoke.mock.calls.at(-1)[1].defaultPath).toBe(manual.configuredPath);
  });

  it.each(['invalid', 'error'])('preserves the old path if selected binary validation returns %s', async status => {
    mocks.invoke.mockResolvedValueOnce(manual);
    await render();
    mocks.invoke.mockResolvedValueOnce('/bad/blender').mockResolvedValueOnce({ ...missing, status, error: '验证失败' });
    await click('设置路径');
    expect(pathText()).toBe(manual.path);
    expect(section().querySelector('[role="alert"]').textContent).toContain('原配置未更改：验证失败');
    expect(button('设置路径').disabled).toBe(false);
  });

  it('temporarily disables both controls while validating the selection', async () => {
    await render();
    const saving = deferred();
    mocks.invoke.mockResolvedValueOnce('/custom/Blender.app').mockImplementationOnce(() => saving.promise);
    await click('设置路径');
    expect(section().querySelector('[aria-busy]').getAttribute('aria-busy')).toBe('true');
    expect([...section().querySelectorAll('button')].every(node => node.disabled)).toBe(true);
    await act(async () => saving.resolve(manual));
    expect(pathText()).toBe(manual.path);
    expect(button('设置路径').disabled).toBe(false);
  });

  it('recovers from picker IPC errors without losing the displayed path', async () => {
    mocks.invoke.mockResolvedValueOnce(manual);
    await render();
    mocks.invoke.mockRejectedValueOnce(new Error('IPC offline'));
    await click('设置路径');
    expect(pathText()).toBe(manual.path);
    expect(section().querySelector('[role="alert"]').textContent).toContain('IPC offline');
    expect(button('设置路径').disabled).toBe(false);
    mocks.invoke.mockResolvedValueOnce('/custom/Blender.app').mockResolvedValueOnce(manual);
    await click('设置路径');
    expect(section().querySelector('[role="alert"]')).toBeNull();
  });

  it('opens only the fixed official download URL', async () => {
    mocks.invoke.mockResolvedValueOnce({ ...missing, installUrl: 'https://untrusted.example/download' });
    await render();
    await click('Blender官网下载');
    expect(mocks.invoke).toHaveBeenLastCalledWith('open:website', 'https://www.blender.org/download/');
  });

  it('retains the existing IPC fallback', async () => {
    delete window.ipc;
    window.require = vi.fn(() => ({ ipcRenderer: { invoke: mocks.invoke } }));
    mocks.invoke.mockResolvedValueOnce(ready);
    await render();
    expect(pathText()).toBe(ready.path);
  });

  it('ignores outdated StrictMode detection responses', async () => {
    const first = deferred();
    const second = deferred();
    let loads = 0;
    mocks.invoke.mockImplementation(async channel => channel === 'system:getBlenderPathInfo'
      ? (++loads === 1 ? first.promise : second.promise) : {});
    await render(<React.StrictMode><GeneralSettings /></React.StrictMode>);
    expect(loads).toBe(2);
    await act(async () => second.resolve(manual));
    await act(async () => first.resolve(ready));
    expect(pathText()).toBe(manual.path);
  });

  it('does not save a picked path after unmount', async () => {
    await render();
    const choosing = deferred();
    mocks.invoke.mockImplementationOnce(() => choosing.promise);
    await click('设置路径');
    await unmount();
    await act(async () => choosing.resolve('/late/blender'));
    expect(mocks.invoke.mock.calls.some(([channel]) => channel === 'system:setBlenderPath')).toBe(false);
  });
});
