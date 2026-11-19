// Run: pnpm exec vitest run --config src/components/SwitchSettings/vitest.config.mjs
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { electronStore } from '../../shared/electronStore';
import SwitchSettings from './SwitchSettings';

vi.mock('../../shared/electronStore', () => ({ electronStore: { get: vi.fn(), onDidChange: vi.fn() } }));
vi.mock('antd', () => ({
  Alert: ({ message }) => <div role="alert">{message}</div>,
  Button: ({ children, icon, loading, disabled, ...props }) => <button disabled={disabled || loading} {...props}>{icon}{children}</button>,
  Spin: () => <span data-testid="spinner" />,
  Modal: ({ open, title, children, onOk, onCancel, okText, cancelText, okButtonProps }) => open ? <div role="dialog" aria-label={title}>
    <h2>{title}</h2>{children}
    <button {...okButtonProps} onClick={onOk}>{okText}</button><button onClick={onCancel}>{cancelText}</button>
  </div> : null,
}));

const makeState = (changes = {}) => ({
  signedIn: true,
  tools: [
    { id: 'codex', name: 'Codex', installed: true, path: '/home/test/.codex/config.toml', enabled: false, needsUpdate: false },
    { id: 'workbuddy', name: 'WorkBuddy', installed: true, path: '/home/test/.workbuddy/config.json', enabled: false, needsUpdate: false },
  ],
  ...changes,
});
const makeCatalog = (changes = {}) => ({
  defaultModel: 'gpt-fixture-recommended',
  models: [
    { model_id: 'gpt-fixture-first', name: 'First supported', codexSupported: true, context_window_tokens: 128000 },
    { model_id: 'gpt-fixture-recommended', name: 'Recommended model', codexSupported: true, read_image: true, context_window_tokens: 1000000, description: 'Backend description' },
    { model_id: 'unsupported', name: 'WorkBuddy only', codexSupported: false, codexReason: '请在 WorkBuddy 使用' },
  ],
  ...changes,
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
let root, host, api, listeners, disposers, stored;
const card = tool => host.querySelector(`[data-tool="${tool}"]`);
const button = label => host.querySelector(`button[aria-label="${label}"]`);
const select = () => host.querySelector('select[aria-label="Codex 默认模型"]');
const dialog = () => host.querySelector('[role="dialog"]');
const click = async label => {
  const target = button(label) || [...host.querySelectorAll('button')].find(item => item.textContent === label);
  expect(target, label).toBeTruthy();
  await act(async () => target.click());
};
const changeModel = async value => {
  await act(async () => {
    select().value = value;
    select().dispatchEvent(new Event('change', { bubbles: true }));
  });
};
const focus = () => act(async () => window.dispatchEvent(new Event('focus')));
const authChange = (key, value = key === 'user' ? { id: 'next-user' } : '') => act(async () => {
  stored[key] = value;
  listeners[key](value);
});
const mount = async (element = <SwitchSettings />) => act(async () => root.render(element));

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  listeners = {};
  disposers = [];
  stored = { user: { id: 'current-user' }, 'auth.refresh_token': 'current-token' };
  electronStore.get.mockReset().mockImplementation(key => stored[key]);
  electronStore.onDidChange.mockReset().mockImplementation((key, listener) => {
    listeners[key] = listener;
    const dispose = vi.fn();
    disposers.push(dispose);
    return dispose;
  });
  api = {
    getState: vi.fn().mockResolvedValue(makeState()),
    getCatalog: vi.fn().mockResolvedValue(makeCatalog()),
    apply: vi.fn().mockImplementation(async () => {
      const next = makeState({ tools: makeState().tools.map(tool => ({ ...tool, enabled: true, modelId: tool.id === 'codex' ? 'gpt-fixture-recommended' : undefined })) });
      api.getState.mockResolvedValue(next);
      return next;
    }),
    disable: vi.fn().mockImplementation(async () => {
      const next = makeState();
      api.getState.mockResolvedValue(next);
      return next;
    }),
  };
  window.api = { switchSettings: api };
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete window.api;
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  vi.restoreAllMocks();
});

describe('SwitchSettings', () => {
  it('is standalone, shows exactly two detected cards and paths, and has no custom configuration or credential fields', async () => {
    await mount();
    expect(host.querySelectorAll('.switch-settings__card')).toHaveLength(2);
    expect(card('codex').textContent).toContain('Codex');
    expect(card('workbuddy').textContent).toContain('WorkBuddy');
    for (const tool of makeState().tools) {
      expect(card(tool.id).textContent).toContain(tool.path);
      expect(card(tool.id).textContent).toContain('已安装');
      expect(card(tool.id).textContent).toContain('未启用');
    }
    expect(host.querySelectorAll('input, textarea')).toHaveLength(0);
    expect(host.querySelectorAll('select')).toHaveLength(1);
    expect(host.textContent).not.toMatch(/Base URL|添加供应商|自定义|sk-/);
    expect(api.apply).not.toHaveBeenCalled();
    expect(api.disable).not.toHaveBeenCalled();
    expect(button('停用并恢复 Codex').disabled).toBe(true);
  });

  it('uses the eligible backend default and renders only GPT-native Codex options', async () => {
    await mount();
    expect(select().value).toBe('gpt-fixture-recommended');
    const options = [...select().options];
    expect(options.map(option => option.value)).toEqual(['gpt-fixture-first', 'gpt-fixture-recommended']);
    expect(options.every(option => !option.disabled)).toBe(true);
    expect(card('codex').textContent).toContain('仅配置 PC 列表中的 GPT 原生 Responses 模型；其他模型请在 WorkBuddy 使用');
    expect(card('codex').textContent).not.toContain('WorkBuddy only');
    await changeModel('unsupported');
    expect(select().value).toBe('gpt-fixture-recommended');
    await changeModel('gpt-fixture-first');
    expect(select().value).toBe('gpt-fixture-first');
    expect(api.apply).not.toHaveBeenCalled();
  });

  it('prefers an existing supported Codex model, falls back from an unsupported default, and disables enable without supported models', async () => {
    api.getState.mockResolvedValue(makeState({ tools: makeState().tools.map(tool => tool.id === 'codex' ? { ...tool, enabled: true, modelId: 'gpt-fixture-first' } : tool) }));
    await mount();
    expect(select().value).toBe('gpt-fixture-first');
    expect(button('更新 Codex').disabled).toBe(false);
    await changeModel('gpt-fixture-recommended');
    expect(button('更新 Codex').disabled).toBe(false);
    api.getCatalog.mockResolvedValue(makeCatalog({ defaultModel: 'unsupported', models: [makeCatalog().models[0], makeCatalog().models[2]] }));
    await click('刷新 switch 状态');
    expect(select().value).toBe('gpt-fixture-first');
    api.getCatalog.mockResolvedValue(makeCatalog({ defaultModel: 'unsupported', models: [makeCatalog().models[2]] }));
    await click('刷新 switch 状态');
    expect(select().value).toBe('');
    expect(select().disabled).toBe(true);
    expect(button('更新 Codex').disabled).toBe(true);
    expect([...select().options].map(option => option.value)).toEqual(['']);
    expect(card('workbuddy').querySelectorAll('li')).toHaveLength(1);
    expect(button('停用并恢复 Codex').disabled).toBe(false);
    expect(button('启用 WorkBuddy').disabled).toBe(false);
  });

  it.each(['true', 1, {}, undefined, null])('excludes non-boolean eligibility %j from Codex options without dropping WorkBuddy entries', async codexSupported => {
    const unsafe = { model_id: 'gpt-fixture-unsafe', name: 'Not eligible', codexSupported };
    api.getCatalog.mockResolvedValue(makeCatalog({ defaultModel: unsafe.model_id, models: [unsafe, makeCatalog().models[0]] }));
    await mount();
    expect([...select().options].map(option => option.value)).toEqual(['gpt-fixture-first']);
    expect(select().value).toBe('gpt-fixture-first');
    expect(card('workbuddy').querySelectorAll('li')).toHaveLength(2);
    expect(api.apply).not.toHaveBeenCalled();
  });

  it('lists every backend model for WorkBuddy, preserves metadata, explains internal selection, and applies without a modelId', async () => {
    await mount();
    const workbuddy = card('workbuddy');
    const rows = [...workbuddy.querySelectorAll('li')];
    expect(rows).toHaveLength(3);
    expect(rows.map(row => row.querySelector('.switch-settings__model-copy > span').textContent)).toEqual(['First supported', 'Recommended model', 'WorkBuddy only']);
    expect(workbuddy.textContent).toContain('WorkBuddy 内部选择');
    expect(workbuddy.textContent).toContain('Backend description');
    expect(workbuddy.textContent).toContain('1M');
    expect(workbuddy.textContent).toContain('128K');
    expect(workbuddy.textContent).toContain('视觉');
    expect(workbuddy.querySelector('select')).toBeNull();
    await click('启用 WorkBuddy');
    expect(api.apply).not.toHaveBeenCalled();
    await click('确认启用');
    expect(api.apply).toHaveBeenCalledExactlyOnceWith({ tool: 'workbuddy' });
  });

  it('requires first-enable consent with plaintext key, encrypted backup and restart warnings and supports cancellation', async () => {
    await mount();
    await click('启用 Codex');
    expect(dialog().textContent).toContain('明文写入');
    expect(dialog().textContent).toContain('加密备份');
    expect(dialog().textContent).toContain('完全退出并重启');
    expect(dialog().textContent).toContain('不会撤销');
    expect(api.apply).not.toHaveBeenCalled();
    await click('取消');
    expect(dialog()).toBeNull();
    expect(api.apply).not.toHaveBeenCalled();
    await click('启用 Codex');
    await click('确认启用');
    expect(api.apply).toHaveBeenCalledExactlyOnceWith({ tool: 'codex', modelId: 'gpt-fixture-recommended' });
    expect(host.textContent).toContain('配置已写入');
    expect(card('codex').textContent).toContain('已启用');
  });

  it('requires confirmation before restoring, allows restoration after logout and offline, and warns that exported keys are not revoked', async () => {
    api.getState.mockResolvedValue(makeState({ signedIn: false, tools: makeState().tools.map(tool => ({ ...tool, enabled: true })) }));
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
    await mount();
    expect(host.textContent).toContain('请先登录');
    expect(host.textContent).toContain('当前离线');
    expect(host.textContent).toContain('退出登录不会撤销已导出');
    expect(button('更新 Codex').disabled).toBe(true);
    expect(button('停用并恢复 Codex').disabled).toBe(false);
    await click('停用并恢复 Codex');
    expect(dialog().textContent).toContain('恢复启用前加密备份');
    expect(dialog().textContent).toContain('不会撤销已导出');
    expect(api.disable).not.toHaveBeenCalled();
    await click('取消');
    expect(api.disable).not.toHaveBeenCalled();
    await click('停用并恢复 Codex');
    await act(async () => [...dialog().querySelectorAll('button')].find(item => item.textContent === '停用并恢复').click());
    expect(api.disable).toHaveBeenCalledExactlyOnceWith({ tool: 'codex' });
    expect(host.textContent).toContain('已停用并恢复原配置');
  });

  it('allows restoring an inactive tool with an app-owned backup, even after logout', async () => {
    api.getState.mockResolvedValue(makeState({ signedIn: false, tools: makeState().tools.map(tool => tool.id === 'codex'
      ? { ...tool, enabled: false, needsUpdate: true, hasBackup: true, error: 'External conflict' }
      : tool) }));
    await mount();
    expect(button('停用并恢复 Codex').disabled).toBe(false);
    expect(button('停用并恢复 WorkBuddy').disabled).toBe(true);
    expect(card('codex').textContent).toContain('待恢复');
    expect(card('codex').textContent).toContain('不会覆盖冲突内容');
    await click('停用并恢复 Codex');
    await act(async () => [...dialog().querySelectorAll('button')].find(item => item.textContent === '停用并恢复').click());
    expect(api.disable).toHaveBeenCalledExactlyOnceWith({ tool: 'codex' });
    expect(api.apply).not.toHaveBeenCalled();
  });

  it('shows configuration changes without auto-writing, enables explicit updates, and reflects missing installations', async () => {
    api.getState.mockResolvedValue(makeState({ tools: makeState().tools.map(tool => tool.id === 'codex'
      ? { ...tool, enabled: true, modelId: 'gpt-fixture-recommended', needsUpdate: true }
      : { ...tool, installed: false }) }));
    await mount();
    expect(card('codex').textContent).toContain('需要更新');
    expect(card('codex').textContent).toContain('不会自动改写');
    expect(card('workbuddy').textContent).toContain('未检测到安装');
    expect(button('启用 WorkBuddy').disabled).toBe(true);
    expect(button('更新 Codex').disabled).toBe(false);
    expect(api.apply).not.toHaveBeenCalled();
    await click('更新 Codex');
    expect(dialog()).toBeNull();
    expect(api.apply).toHaveBeenCalledExactlyOnceWith({ tool: 'codex', modelId: 'gpt-fixture-recommended' });
  });

  it('recalculates needsUpdate after catalog resolution instead of retaining the initial pre-catalog state', async () => {
    const pending = deferred();
    const active = makeState({ tools: makeState().tools.map(tool => ({ ...tool, enabled: true, hasBackup: true, modelId: tool.id === 'codex' ? 'gpt-fixture-first' : undefined })) });
    const updated = { ...active, tools: active.tools.map(tool => ({ ...tool, needsUpdate: true })) };
    api.getState.mockResolvedValueOnce(active).mockResolvedValue(updated);
    api.getCatalog.mockReturnValueOnce(pending.promise);
    await mount();
    expect(api.getState).toHaveBeenCalledTimes(1);
    expect(card('codex').querySelector('.switch-settings__status').textContent).toBe('已启用');
    expect(button('停用并恢复 Codex').disabled).toBe(false);
    await act(async () => pending.resolve(makeCatalog()));
    expect(api.getState).toHaveBeenCalledTimes(2);
    expect(card('codex').querySelector('.switch-settings__status').textContent).toBe('需要更新');
    expect(card('workbuddy').querySelector('.switch-settings__status').textContent).toBe('需要更新');
    expect(select().value).toBe('gpt-fixture-first');
    expect(api.apply).not.toHaveBeenCalled();
    expect(api.disable).not.toHaveBeenCalled();
  });

  it('keeps signed-out offline restoration usable while the catalog is still pending', async () => {
    const pending = deferred();
    const signedOut = makeState({ signedIn: false, tools: makeState().tools.map(tool => ({ ...tool, enabled: true, hasBackup: true })) });
    api.getState.mockResolvedValue(signedOut);
    api.getCatalog.mockReturnValueOnce(pending.promise).mockRejectedValue(new Error('offline-secret'));
    api.disable.mockImplementation(async () => {
      const next = makeState({ signedIn: false });
      api.getState.mockResolvedValue(next);
      return next;
    });
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
    await mount();
    expect(host.textContent).toContain('正在刷新');
    expect(button('更新 Codex').disabled).toBe(true);
    expect(button('停用并恢复 Codex').disabled).toBe(false);
    await click('停用并恢复 Codex');
    expect(dialog()).not.toBeNull();
    await act(async () => [...dialog().querySelectorAll('button')].find(item => item.textContent === '停用并恢复').click());
    expect(api.disable).toHaveBeenCalledExactlyOnceWith({ tool: 'codex' });
    expect(host.textContent).toContain('已停用并恢复原配置');
    await act(async () => pending.reject(new Error('old-offline-secret')));
    expect(host.textContent).not.toContain('offline-secret');
    expect(api.apply).not.toHaveBeenCalled();
  });

  it('reconciles a removed selection after apply-time refetch fails without retrying a native write', async () => {
    await mount();
    await changeModel('gpt-fixture-first');
    const nextCatalog = makeCatalog({ models: [makeCatalog().models[1], makeCatalog().models[2]] });
    api.apply.mockImplementationOnce(async () => {
      api.getCatalog.mockResolvedValue(nextCatalog);
      throw new Error('removed-model-secret');
    });
    await click('启用 Codex');
    await click('确认启用');
    expect(api.apply).toHaveBeenCalledExactlyOnceWith({ tool: 'codex', modelId: 'gpt-fixture-first' });
    expect(api.getCatalog).toHaveBeenCalledTimes(2);
    expect([...select().options].map(option => option.value)).toEqual(['gpt-fixture-recommended']);
    expect(select().value).toBe('gpt-fixture-recommended');
    expect(host.textContent).toContain('启用或更新失败');
    expect(host.textContent).not.toContain('removed-model-secret');
    expect(card('codex').textContent).toContain('未启用');
    expect(api.disable).not.toHaveBeenCalled();
    await click('启用 Codex');
    await click('确认启用');
    expect(api.apply).toHaveBeenLastCalledWith({ tool: 'codex', modelId: 'gpt-fixture-recommended' });
    expect(api.apply).toHaveBeenCalledTimes(2);
  });

  it('reconciles the displayed WorkBuddy list after apply refetches a changed catalog', async () => {
    await mount();
    const nextCatalog = makeCatalog({ defaultModel: 'gpt-fixture-first', models: [makeCatalog().models[0]] });
    const active = makeState({ tools: makeState().tools.map(tool => tool.id === 'workbuddy' ? { ...tool, enabled: true } : tool) });
    api.apply.mockImplementationOnce(async () => {
      api.getCatalog.mockResolvedValue(nextCatalog);
      api.getState.mockResolvedValue(active);
      return active;
    });
    await click('启用 WorkBuddy');
    await click('确认启用');
    expect(card('workbuddy').querySelectorAll('li')).toHaveLength(1);
    expect(card('workbuddy').textContent).not.toContain('Recommended model');
    expect(card('workbuddy').textContent).toContain('已启用');
    expect(api.apply).toHaveBeenCalledExactlyOnceWith({ tool: 'workbuddy' });
    expect(api.disable).not.toHaveBeenCalled();
  });

  it('handles unavailable bridge, state errors, and catalog errors without rendering sensitive errors', async () => {
    delete window.api;
    await mount();
    expect(host.textContent).toContain('服务尚未就绪');
    expect(button('启用 Codex').disabled).toBe(true);
    window.api = { switchSettings: api };
    api.getState.mockRejectedValue(new Error('sk-never-render-state-secret'));
    await click('刷新 switch 状态');
    expect(host.textContent).toContain('读取工具配置失败');
    expect(host.textContent).not.toContain('sk-never-render');
    api.getState.mockResolvedValue(makeState({ tools: makeState().tools.map(tool => ({ ...tool, enabled: true, error: 'sk-never-render-tool-secret' })) }));
    api.getCatalog.mockRejectedValueOnce(new Error('sk-never-render-catalog-secret'));
    await click('刷新 switch 状态');
    expect(host.textContent).toContain('加载后端模型失败');
    expect(host.textContent).toContain('恢复时不会覆盖冲突内容');
    expect(host.textContent).not.toContain('sk-never-render');
    expect(button('更新 Codex').disabled).toBe(true);
    expect(button('停用并恢复 Codex').disabled).toBe(false);
    await click('刷新 switch 状态');
    expect(host.textContent).not.toContain('加载后端模型失败');
  });

  it('handles empty catalogs and rejected apply/restore without exposing credentials or fabricating success', async () => {
    api.getCatalog.mockResolvedValueOnce(makeCatalog({ models: [] }));
    await mount();
    expect(host.textContent).toContain('暂无后端模型');
    expect(button('启用 Codex').disabled).toBe(true);
    expect(button('启用 WorkBuddy').disabled).toBe(true);
    await click('刷新 switch 状态');
    api.apply.mockRejectedValueOnce(new Error('sk-never-render-apply-secret'));
    await click('启用 Codex');
    await click('确认启用');
    expect(host.textContent).toContain('启用或更新失败');
    expect(host.textContent).not.toContain('sk-never-render');
    expect(card('codex').textContent).toContain('未启用');
    expect(button('启用 Codex').disabled).toBe(false);
    await click('启用 Codex');
    await click('确认启用');
    api.disable.mockRejectedValueOnce(new Error('sk-never-render-restore-secret'));
    await click('停用并恢复 Codex');
    await act(async () => [...dialog().querySelectorAll('button')].find(item => item.textContent === '停用并恢复').click());
    expect(host.textContent).toContain('停用并恢复失败');
    expect(host.textContent).not.toContain('sk-never-render');
    expect(card('codex').textContent).toContain('已启用');
  });

  it('blocks controls during loading and a pending write and reconciles focus refresh only after the write', async () => {
    const statePending = deferred();
    api.getState.mockReturnValueOnce(statePending.promise);
    await mount();
    expect(host.textContent).toContain('正在刷新');
    expect(button('刷新 switch 状态').disabled).toBe(true);
    expect(button('启用 Codex').disabled).toBe(true);
    await act(async () => statePending.resolve(makeState()));
    const applyPending = deferred();
    api.apply.mockReturnValueOnce(applyPending.promise);
    await click('启用 Codex');
    await click('确认启用');
    expect(button('刷新 switch 状态').disabled).toBe(true);
    expect(button('启用 WorkBuddy').disabled).toBe(true);
    expect(select().disabled).toBe(true);
    await focus();
    expect(api.getState).toHaveBeenCalledTimes(2);
    const enabled = makeState({ tools: makeState().tools.map(tool => ({ ...tool, enabled: true })) });
    api.getState.mockResolvedValue(enabled);
    await act(async () => applyPending.resolve(enabled));
    expect(api.getState).toHaveBeenCalledTimes(4);
    expect(button('刷新 switch 状态').disabled).toBe(false);
    expect(api.apply).toHaveBeenCalledTimes(1);
  });

  it('refreshes on focus and user/token changes with latest-generation responses winning and never auto-writes', async () => {
    const oldState = deferred(), oldCatalog = deferred();
    api.getState.mockReturnValueOnce(oldState.promise);
    api.getCatalog.mockReturnValueOnce(oldCatalog.promise);
    await mount();
    await focus();
    expect(select().value).toBe('gpt-fixture-recommended');
    await act(async () => {
      oldState.resolve(makeState({ signedIn: false }));
      oldCatalog.resolve(makeCatalog({ models: [] }));
    });
    expect(host.textContent).not.toContain('请先登录');
    expect(select().value).toBe('gpt-fixture-recommended');
    expect(electronStore.onDidChange.mock.calls.map(args => args[0])).toEqual(['user', 'auth.refresh_token']);
    await authChange('user');
    await authChange('auth.refresh_token');
    expect(api.getState).toHaveBeenCalledTimes(7);
    expect(api.getCatalog).toHaveBeenCalledTimes(4);
    expect(api.apply).not.toHaveBeenCalled();
    expect(api.disable).not.toHaveBeenCalled();
  });

  it('ignores profile/key edits and refresh-token rotation for the same account without interrupting consent or writes', async () => {
    await mount();
    await click('启用 Codex');
    await authChange('user', { id: 'current-user', name: 'New nickname', apiKey: 'never-render-this-key' });
    await authChange('auth.refresh_token', 'rotated-token');
    expect(dialog()).not.toBeNull();
    expect(api.getState).toHaveBeenCalledTimes(2);
    const pending = deferred();
    api.apply.mockReturnValueOnce(pending.promise);
    await click('确认启用');
    await authChange('user', { id: 'current-user', avatar: 'another-avatar' });
    await authChange('auth.refresh_token', 'rotated-again');
    await act(async () => pending.resolve(makeState({ tools: makeState().tools.map(tool => ({ ...tool, enabled: true })) })));
    expect(host.textContent).toContain('配置已写入');
    expect(host.textContent).not.toContain('never-render-this-key');
    expect(api.getState).toHaveBeenCalledTimes(4);
    expect(api.getCatalog).toHaveBeenCalledTimes(2);
    expect(api.apply).toHaveBeenCalledTimes(1);
  });

  it('clears pending consent, cached models and prior account state as soon as auth changes', async () => {
    await mount();
    await changeModel('gpt-fixture-first');
    await click('启用 Codex');
    const nextState = deferred(), nextCatalog = deferred();
    api.getState.mockReturnValueOnce(nextState.promise);
    api.getCatalog.mockReturnValueOnce(nextCatalog.promise);
    await authChange('user');
    expect(dialog()).toBeNull();
    expect(card('workbuddy').querySelectorAll('li')).toHaveLength(0);
    expect(card('codex').textContent).toContain('状态未知');
    expect(select().value).toBe('');
    expect(button('启用 Codex').disabled).toBe(true);
    api.getState.mockResolvedValue(makeState({ signedIn: false }));
    await act(async () => {
      nextState.resolve(makeState({ signedIn: false }));
      nextCatalog.resolve(makeCatalog({ models: [] }));
    });
    expect(host.textContent).toContain('请先登录');
    expect(api.apply).not.toHaveBeenCalled();
    expect(api.disable).not.toHaveBeenCalled();
  });

  it('ignores an old-account write result and reads current state after it settles without automatic writes', async () => {
    await mount();
    const pending = deferred();
    api.apply.mockReturnValueOnce(pending.promise);
    await click('启用 Codex');
    await click('确认启用');
    api.getState.mockResolvedValue(makeState({ signedIn: false }));
    await authChange('auth.refresh_token');
    expect(card('codex').textContent).toContain('状态未知');
    await act(async () => pending.resolve(makeState({ tools: makeState().tools.map(tool => ({ ...tool, enabled: true })) })));
    expect(host.textContent).toContain('请先登录');
    expect(host.textContent).not.toContain('配置已写入');
    expect(card('codex').textContent).toContain('未启用');
    expect(api.apply).toHaveBeenCalledTimes(1);
    expect(api.disable).not.toHaveBeenCalled();
  });

  it('recovers from offline events through read-only refresh and dismisses uncommitted consent', async () => {
    await mount();
    await click('启用 WorkBuddy');
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
    await act(async () => window.dispatchEvent(new Event('offline')));
    expect(dialog()).toBeNull();
    expect(button('启用 WorkBuddy').disabled).toBe(true);
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
    await act(async () => window.dispatchEvent(new Event('online')));
    expect(host.textContent).not.toContain('当前离线');
    expect(button('启用 WorkBuddy').disabled).toBe(false);
    expect(api.getState).toHaveBeenCalledTimes(4);
    expect(api.apply).not.toHaveBeenCalled();
  });

  it('ignores responses after unmount and disposes account/focus subscriptions', async () => {
    const pendingState = deferred(), pendingCatalog = deferred();
    api.getState.mockReturnValueOnce(pendingState.promise);
    api.getCatalog.mockReturnValueOnce(pendingCatalog.promise);
    await mount();
    await act(async () => root.unmount());
    expect(disposers.every(dispose => dispose.mock.calls.length === 1)).toBe(true);
    await act(async () => {
      pendingState.resolve(makeState());
      pendingCatalog.resolve(makeCatalog());
      window.dispatchEvent(new Event('focus'));
      listeners.user();
    });
    expect(host.textContent).toBe('');
    expect(api.getState).toHaveBeenCalledTimes(1);
    root = createRoot(host);
  });

  it('isolates StrictMode first-mount stale responses', async () => {
    const firstState = deferred(), firstCatalog = deferred();
    api.getState.mockReturnValueOnce(firstState.promise);
    api.getCatalog.mockReturnValueOnce(firstCatalog.promise);
    await mount(<React.StrictMode><SwitchSettings /></React.StrictMode>);
    expect(select().value).toBe('gpt-fixture-recommended');
    await act(async () => {
      firstState.resolve(makeState({ signedIn: false }));
      firstCatalog.resolve(makeCatalog({ models: [] }));
    });
    expect(host.textContent).not.toContain('请先登录');
    expect(select().value).toBe('gpt-fixture-recommended');
    expect(api.apply).not.toHaveBeenCalled();
  });
});
