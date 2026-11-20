// Run: pnpm exec vitest run --config src/components/SwitchSettings/vitest.config.mjs
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { message } from 'antd';
import { SWITCH_ERROR_MESSAGES } from '../../packages/shared/switchSettings';
import { electronStore } from '../../shared/electronStore';
import SwitchSettings from './SwitchSettings';

const switchStyles = readFileSync(`${process.cwd()}/src/components/SwitchSettings/SwitchSettings.css`, 'utf8');

vi.mock('../../shared/electronStore', () => ({ electronStore: { get: vi.fn(), onDidChange: vi.fn() } }));
vi.mock('antd', () => ({
  Alert: ({ message, type }) => <div role="alert" data-type={type}>{message}</div>,
  message: { error: vi.fn(), success: vi.fn() },
  Switch: ({ checked, loading, disabled, size, onChange, ...props }) => <button
    {...props}
    type="button"
    role="switch"
    aria-checked={Boolean(checked)}
    data-loading={Boolean(loading)}
    data-size={size}
    disabled={disabled || loading}
    onClick={event => onChange?.(!checked, event)}
  />,
  Spin: () => <span data-testid="spinner" />,
  Popover: ({ children, content, open, onOpenChange }) => <span
    onMouseEnter={() => onOpenChange(true)} onMouseLeave={() => onOpenChange(false)}
    onFocus={() => onOpenChange(true)} onBlur={() => onOpenChange(false)}
  >{children}{open && <div role="tooltip">{content}</div>}</span>,
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
const STATE_READ_ERROR = '读取工具配置失败，请重新进入此页或切回窗口后重试。';
const CATALOG_READ_ERROR = '加载后端模型失败，请检查网络后重新进入此页。';
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
let root, host, api, listeners, disposers, stored;
const row = tool => host.querySelector(`[data-tool="${tool}"]`);
const button = label => host.querySelector(`button[aria-label="${label}"]`);
const toolSwitch = tool => row(tool).querySelector('[role="switch"]');
const isChecked = tool => toolSwitch(tool).getAttribute('aria-checked') === 'true';
const dialog = () => host.querySelector('[role="dialog"]');
const clickSwitch = async tool => {
  const target = toolSwitch(tool);
  expect(target, `${tool} switch`).toBeTruthy();
  await act(async () => target.click());
};
const expectOnlySwitches = () => {
  expect(document.querySelector('[role="dialog"], [role="alertdialog"]')).toBeNull();
  expect(host.querySelector('[role="alert"][data-type="error"], .switch-settings__error')).toBeNull();
  expect(host.querySelectorAll('.switch-settings__example-trigger')).toHaveLength(2);
  const pageButtons = [...host.querySelectorAll('button:not(.switch-settings__example-trigger)')];
  expect(pageButtons).toHaveLength(2);
  expect(pageButtons.every(control => control.getAttribute('role') === 'switch')).toBe(true);
  expect([...host.querySelectorAll('.switch-settings__status')].map(status => status.textContent).join(' ')).not.toMatch(/待恢复|需要更新/);
};
const expectPendingWrite = (activeTool, type) => {
  expectOnlySwitches();
  expect(host.querySelector('.switch-settings').getAttribute('aria-busy')).toBe('true');
  for (const tool of makeState().tools) {
    const active = tool.id === activeTool;
    expect(toolSwitch(tool.id).disabled).toBe(true);
    expect(toolSwitch(tool.id).getAttribute('aria-busy')).toBe(String(active));
    expect(toolSwitch(tool.id).getAttribute('data-loading')).toBe(String(active));
    if (active) {
      expect(row(tool.id).querySelector('.switch-settings__name .switch-settings__status')).toBeNull();
      expect(row(tool.id).textContent).not.toContain(type === 'apply' ? '正在设置…' : '正在清理…');
    }
  }
};
const focus = () => act(async () => window.dispatchEvent(new Event('focus')));
const authChange = (key, value = key === 'user' ? { id: 'next-user' } : '') => act(async () => {
  stored[key] = value;
  listeners[key](value);
});
const mount = async (element = <SwitchSettings />) => act(async () => root.render(element));

beforeEach(() => {
  message.error.mockReset();
  message.success.mockReset();
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
    apply: vi.fn().mockImplementation(async ({ tool: id, modelId }) => {
      const next = makeState({ tools: makeState().tools.map(tool => ({ ...tool, enabled: tool.id === id, modelId: tool.id === 'codex' && id === 'codex' ? modelId : undefined })) });
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
  if (host.querySelector('.switch-settings')) expectOnlySwitches();
  for (const toast of [message.error, message.success]) {
    for (const [text] of toast.mock.calls) {
      expect(typeof text).toBe('string');
      expect(text).not.toMatch(/private-|sk-|secret|External conflict|never-render|备份|还原/);
      expect(host.textContent).not.toContain(text);
    }
  }
  await act(async () => root.unmount());
  host.remove();
  delete window.api;
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  vi.restoreAllMocks();
});

describe('SwitchSettings', () => {
  it.each([false, true])('does not read on initially inactive mount, focus, online or account changes (StrictMode: %s)', async strict => {
    const view = active => strict
      ? <React.StrictMode><SwitchSettings active={active} embedded /></React.StrictMode>
      : <SwitchSettings active={active} embedded />;
    await mount(view(false));
    expect(api.getState).not.toHaveBeenCalled();
    expect(api.getCatalog).not.toHaveBeenCalled();
    await focus();
    await act(async () => window.dispatchEvent(new Event('online')));
    await authChange('user');
    await authChange('auth.refresh_token');
    await clickSwitch('codex');
    await clickSwitch('workbuddy');
    expect(api.getState).not.toHaveBeenCalled();
    expect(api.getCatalog).not.toHaveBeenCalled();
    expect(api.apply).not.toHaveBeenCalled();
    expect(api.disable).not.toHaveBeenCalled();
    expect(message.error).not.toHaveBeenCalled();
    expect(message.success).not.toHaveBeenCalled();
    await mount(view(true));
    expect(api.getState).toHaveBeenCalledTimes(2);
    expect(api.getCatalog).toHaveBeenCalledTimes(1);
    expect(api.apply).not.toHaveBeenCalled();
    expect(api.disable).not.toHaveBeenCalled();
  });

  it('retains the instance and subscriptions across tab/Modal hiding, blocks actions and refreshes read-only on activation', async () => {
    const configured = makeState({ tools: makeState().tools.map(tool => tool.id === 'codex'
      ? { ...tool, enabled: true, hasManagedConfig: true } : tool) });
    api.getState.mockResolvedValue(configured);
    await mount(<SwitchSettings active embedded />);
    const originalRoot = host.querySelector('.switch-settings');
    const originalControl = toolSwitch('codex');
    for (let cycle = 0; cycle < 2; cycle += 1) {
      await mount(<SwitchSettings active={false} embedded />);
      expect(host.querySelector('.switch-settings')).toBe(originalRoot);
      expect(toolSwitch('codex')).toBe(originalControl);
      expect(isChecked('codex')).toBe(true);
      expect(toolSwitch('codex').disabled).toBe(true);
      expect(toolSwitch('workbuddy').disabled).toBe(true);
      // Even a synthetic click bypassing the disabled DOM cannot reach native writes.
      await act(async () => {
        for (const tool of ['codex', 'workbuddy']) {
          toolSwitch(tool).disabled = false;
          toolSwitch(tool).click();
          toolSwitch(tool).disabled = true;
        }
      });
      await focus();
      await act(async () => {
        window.dispatchEvent(new Event('offline'));
        window.dispatchEvent(new Event('online'));
      });
      expect(api.getState).toHaveBeenCalledTimes(2 + cycle * 2);
      expect(api.getCatalog).toHaveBeenCalledTimes(1 + cycle);
      expect(disposers.every(dispose => dispose.mock.calls.length === 0)).toBe(true);
      await mount(<SwitchSettings active embedded />);
      expect(api.getState).toHaveBeenCalledTimes(4 + cycle * 2);
      expect(api.getCatalog).toHaveBeenCalledTimes(2 + cycle);
      expect(isChecked('codex')).toBe(true);
      expect(toolSwitch('codex').disabled).toBe(false);
    }
    expect(electronStore.onDidChange).toHaveBeenCalledTimes(2);
    expect(api.apply).not.toHaveBeenCalled();
    expect(api.disable).not.toHaveBeenCalled();
  });

  it.each(['success', 'failure'])('ignores in-flight hidden reads and never starts a second read after catalog %s', async outcome => {
    const pendingState = deferred(), pendingCatalog = deferred();
    api.getState.mockReturnValueOnce(pendingState.promise);
    api.getCatalog.mockReturnValueOnce(pendingCatalog.promise);
    await mount(<SwitchSettings active />);
    await mount(<SwitchSettings active={false} />);
    await act(async () => {
      if (outcome === 'success') {
        pendingState.resolve(makeState({ signedIn: false, tools: makeState().tools.map(tool => ({ ...tool, enabled: true })) }));
        pendingCatalog.resolve(makeCatalog({ models: [] }));
      } else {
        pendingState.reject(new Error('private-hidden-state'));
        pendingCatalog.reject(new Error('private-hidden-catalog'));
      }
    });
    expect(api.getState).toHaveBeenCalledTimes(1);
    expect(api.getCatalog).toHaveBeenCalledTimes(1);
    expect(isChecked('codex')).toBe(false);
    expect(message.error).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="spinner"], .switch-settings__loading')).toBeNull();
    await mount(<SwitchSettings active />);
    expect(api.getState).toHaveBeenCalledTimes(3);
    expect(api.getCatalog).toHaveBeenCalledTimes(2);
    expect(toolSwitch('codex').disabled).toBe(false);
    expect(api.apply).not.toHaveBeenCalled();
    expect(api.disable).not.toHaveBeenCalled();
  });

  it('ignores an already-started second read even when it settles after reactivation', async () => {
    const secondRead = deferred();
    api.getState.mockResolvedValueOnce(makeState()).mockReturnValueOnce(secondRead.promise);
    await mount(<SwitchSettings active />);
    expect(api.getState).toHaveBeenCalledTimes(2);
    await mount(<SwitchSettings active={false} />);
    const latest = makeState({ tools: makeState().tools.map(tool => ({ ...tool, enabled: true })) });
    api.getState.mockResolvedValue(latest);
    await mount(<SwitchSettings active />);
    expect(isChecked('codex')).toBe(true);
    await act(async () => secondRead.resolve(makeState({ signedIn: false })));
    expect(isChecked('codex')).toBe(true);
    expect(host.textContent).not.toContain('请先登录');
    expect(api.getState).toHaveBeenCalledTimes(4);
    expect(api.getCatalog).toHaveBeenCalledTimes(2);
    expect(message.error).not.toHaveBeenCalled();
  });

  it('does not consume error deduplication while hidden and deduplicates failures across later activations', async () => {
    const statePending = deferred(), catalogPending = deferred();
    api.getState.mockReturnValueOnce(statePending.promise);
    api.getCatalog.mockReturnValueOnce(catalogPending.promise);
    await mount(<SwitchSettings active />);
    await mount(<SwitchSettings active={false} />);
    await act(async () => {
      statePending.reject(new Error('private-hidden-state'));
      catalogPending.reject(new Error('private-hidden-catalog'));
    });
    api.getState.mockRejectedValue(new Error('private-hidden-state'));
    api.getCatalog.mockRejectedValue(new Error('private-hidden-catalog'));
    await mount(<SwitchSettings active />);
    expect(message.error.mock.calls).toEqual([[STATE_READ_ERROR], [CATALOG_READ_ERROR]]);
    await mount(<SwitchSettings active={false} />);
    await mount(<SwitchSettings active />);
    expect(message.error).toHaveBeenCalledTimes(2);
    expect(api.apply).not.toHaveBeenCalled();
    expect(api.disable).not.toHaveBeenCalled();
  });

  it.each(['apply', 'disable'].flatMap(type => ['success', 'failure'].flatMap(outcome => [false, true].map(settleHidden => [type, outcome, settleHidden]))))(
    'preserves pending %s across activity changes (%s, settles hidden: %s) without duplicate writes or hidden toasts/reads',
    async (type, outcome, settleHidden) => {
      const before = makeState({ tools: makeState().tools.map(tool => tool.id === 'codex'
        ? { ...tool, enabled: type === 'disable', hasManagedConfig: type === 'disable' } : tool) });
      api.getState.mockResolvedValue(before);
      const pending = deferred();
      api[type].mockReturnValueOnce(pending.promise);
      await mount(<SwitchSettings active embedded />);
      await clickSwitch('codex');
      expectPendingWrite('codex', type);
      await mount(<SwitchSettings active={false} embedded />);
      expectPendingWrite('codex', type);
      expect(isChecked('codex')).toBe(type === 'disable');
      await authChange('user', { id: 'current-user', name: 'Changed while hidden' });
      await authChange('auth.refresh_token', 'rotated-while-hidden');
      await focus();
      await act(async () => window.dispatchEvent(new Event('online')));
      if (!settleHidden) {
        await mount(<SwitchSettings active embedded />);
        expectPendingWrite('codex', type);
        await clickSwitch('codex');
        await clickSwitch('workbuddy');
        await focus();
      }
      expect(api.getState).toHaveBeenCalledTimes(2);
      expect(api.getCatalog).toHaveBeenCalledTimes(1);
      const after = makeState({ tools: makeState().tools.map(tool => tool.id === 'codex'
        ? { ...tool, enabled: type === 'apply' } : tool) });
      api.getState.mockResolvedValue(outcome === 'success' ? after : before);
      await act(async () => {
        if (outcome === 'success') pending.resolve(after);
        else pending.reject(new Error('private-pending-write'));
      });
      expect(toolSwitch('codex').getAttribute('aria-busy')).toBe('false');
      expect(isChecked('codex')).toBe(outcome === 'success' ? type === 'apply' : type === 'disable');
      if (settleHidden) {
        expect(api.getState).toHaveBeenCalledTimes(2);
        expect(api.getCatalog).toHaveBeenCalledTimes(1);
        expect(toolSwitch('codex').disabled).toBe(true);
        expect(message.success).not.toHaveBeenCalled();
        expect(message.error).not.toHaveBeenCalled();
        await mount(<SwitchSettings active embedded />);
        expect(message.success).not.toHaveBeenCalled();
        expect(message.error).not.toHaveBeenCalled();
      } else {
        expect(message.success).toHaveBeenCalledTimes(outcome === 'success' ? 1 : 0);
        expect(message.error).toHaveBeenCalledTimes(outcome === 'failure' ? 1 : 0);
      }
      expect(api.getState).toHaveBeenCalledTimes(4);
      expect(api.getCatalog).toHaveBeenCalledTimes(2);
      expect(toolSwitch('codex').disabled).toBe(false);
      expect(api[type]).toHaveBeenCalledTimes(1);
      expect(api[type === 'apply' ? 'disable' : 'apply']).not.toHaveBeenCalled();
      expect(electronStore.onDidChange).toHaveBeenCalledTimes(2);
      expect(disposers.every(dispose => dispose.mock.calls.length === 0)).toBe(true);
    },
  );

  it.each(['apply', 'disable'].flatMap(type => ['user', 'auth.refresh_token'].flatMap(authKey =>
    ['success', 'failure'].flatMap(outcome => [false, true].map(settleHidden => [type, authKey, outcome, settleHidden])))))(
    'ignores pending %s after hidden %s account change (%s, settles hidden: %s) and reconciles without writing',
    async (type, authKey, outcome, settleHidden) => {
      const oldModel = { ...makeCatalog().models[0], model_id: 'gpt-previous-account' };
      api.getState.mockResolvedValue(makeState({ tools: makeState().tools.map(tool => tool.id === 'codex'
        ? { ...tool, enabled: type === 'disable', modelId: oldModel.model_id } : tool) }));
      api.getCatalog.mockResolvedValue(makeCatalog({ defaultModel: oldModel.model_id, models: [oldModel] }));
      await mount(<SwitchSettings active />);
      const pending = deferred();
      api[type].mockReturnValueOnce(pending.promise);
      await clickSwitch('codex');
      await mount(<SwitchSettings active={false} />);
      await authChange(authKey);
      expectPendingWrite('codex', type);
      expect(isChecked('codex')).toBe(false);
      expect(isChecked('workbuddy')).toBe(false);
      const latest = makeState({ signedIn: authKey === 'user' });
      api.getState.mockResolvedValue(latest);
      api.getCatalog.mockResolvedValue(makeCatalog());
      await focus();
      await act(async () => window.dispatchEvent(new Event('online')));
      if (!settleHidden) {
        await mount(<SwitchSettings active />);
        expectPendingWrite('codex', type);
        await clickSwitch('codex');
        await clickSwitch('workbuddy');
      }
      expect(api.getState).toHaveBeenCalledTimes(2);
      expect(api.getCatalog).toHaveBeenCalledTimes(1);
      await act(async () => {
        if (outcome === 'success') pending.resolve(makeState({ tools: makeState().tools.map(tool => ({ ...tool, enabled: true, error: 'private-old-account' })) }));
        else pending.reject(new Error('private-old-account'));
      });
      expect(isChecked('codex')).toBe(false);
      expect(isChecked('workbuddy')).toBe(false);
      expect(toolSwitch('codex').getAttribute('aria-busy')).toBe('false');
      if (settleHidden) {
        expect(api.getState).toHaveBeenCalledTimes(2);
        expect(api.getCatalog).toHaveBeenCalledTimes(1);
        expect(row('codex').textContent).toContain('状态未知');
        await mount(<SwitchSettings active />);
      }
      expect(host.textContent.includes('请先登录')).toBe(authKey !== 'user');
      expect(message.success).not.toHaveBeenCalled();
      expect(message.error).not.toHaveBeenCalled();
      expect(api.getState).toHaveBeenCalledTimes(4);
      expect(api.getCatalog).toHaveBeenCalledTimes(2);
      expect(api[type]).toHaveBeenCalledTimes(1);
      expect(api[type === 'apply' ? 'disable' : 'apply']).not.toHaveBeenCalled();
      if (authKey === 'user') {
        await clickSwitch('codex');
        expect(api.apply).toHaveBeenLastCalledWith({ tool: 'codex', modelId: 'gpt-fixture-recommended' });
        expect(api.apply).toHaveBeenCalledTimes(type === 'apply' ? 2 : 1);
      }
    },
  );

  it('clears hidden account state immediately and never revives an old write when identity switches away and back', async () => {
    await mount(<SwitchSettings active />);
    const pending = deferred();
    api.apply.mockReturnValueOnce(pending.promise);
    await clickSwitch('codex');
    await mount(<SwitchSettings active={false} />);
    await authChange('user');
    await authChange('user', { id: 'current-user' });
    expectPendingWrite('codex', 'apply');
    await act(async () => pending.resolve(makeState({ tools: makeState().tools.map(tool => ({ ...tool, enabled: true })) })));
    expect(isChecked('codex')).toBe(false);
    expect(api.getState).toHaveBeenCalledTimes(2);
    expect(api.getCatalog).toHaveBeenCalledTimes(1);
    expect(message.success).not.toHaveBeenCalled();
    await mount(<SwitchSettings active />);
    expect(isChecked('codex')).toBe(false);
    expect(api.apply).toHaveBeenCalledTimes(1);
    expect(api.disable).not.toHaveBeenCalled();
  });

  it('invalidates hidden old-account reads and cached models before activation', async () => {
    api.getState.mockResolvedValue(makeState({ tools: makeState().tools.map(tool => ({ ...tool, enabled: true, modelId: 'gpt-fixture-first' })) }));
    await mount(<SwitchSettings active />);
    const pendingState = deferred(), pendingCatalog = deferred();
    api.getState.mockReturnValueOnce(pendingState.promise);
    api.getCatalog.mockReturnValueOnce(pendingCatalog.promise);
    await focus();
    await mount(<SwitchSettings active={false} />);
    await authChange('user');
    expect(isChecked('codex')).toBe(false);
    expect(row('codex').textContent).toContain('状态未知');
    expect(api.getState).toHaveBeenCalledTimes(3);
    expect(api.getCatalog).toHaveBeenCalledTimes(2);
    api.getState.mockResolvedValue(makeState());
    await mount(<SwitchSettings active />);
    await act(async () => {
      pendingState.resolve(makeState({ signedIn: false, tools: makeState().tools.map(tool => ({ ...tool, enabled: true })) }));
      pendingCatalog.resolve(makeCatalog({ models: [] }));
    });
    expect(isChecked('codex')).toBe(false);
    expect(host.textContent).not.toContain('请先登录');
    await clickSwitch('codex');
    expect(api.apply).toHaveBeenCalledExactlyOnceWith({ tool: 'codex', modelId: 'gpt-fixture-recommended' });
  });

  it('keeps embedded layout opt-in and matches the MCP presentation', async () => {
    await mount();
    const component = host.querySelector('.switch-settings');
    expect(component.classList.contains('switch-settings--embedded')).toBe(false);
    await mount(<SwitchSettings embedded />);
    expect(host.querySelector('.switch-settings')).toBe(component);
    expect(component.classList.contains('switch-settings--embedded')).toBe(true);
    // Model ordinary switches, independent of antd CSS-in-JS and its mocked rendering.
    for (const control of host.querySelectorAll('[role="switch"]')) {
      expect(control.classList.contains('switch-settings__switch')).toBe(true);
      control.classList.add('ant-switch', 'ant-switch-checked');
    }
    const style = document.createElement('style');
    style.textContent = `
      .chat-panel__local-mcp-panel .ant-switch.ant-switch-checked { background-color: #09a742; }
      ${switchStyles}
      .chat-panel__local-mcp-panel .chat-panel__local-mcp-detection-switch .ant-switch.ant-switch-checked { background-color: #09a742; }
    `;
    document.head.appendChild(style);
    host.classList.add('chat-panel__local-mcp-panel');
    const detection = document.createElement('div');
    detection.className = 'chat-panel__local-mcp-detection-switch';
    const detectionSwitch = document.createElement('button');
    detectionSwitch.className = 'ant-switch ant-switch-checked';
    detection.appendChild(detectionSwitch);
    host.appendChild(detection);
    try {
      expect(getComputedStyle(toolSwitch('codex')).backgroundColor).toBe('rgb(9, 167, 66)');
      expect(getComputedStyle(toolSwitch('workbuddy')).backgroundColor).toBe('rgb(9, 167, 66)');
      expect(toolSwitch('codex').getAttribute('data-size')).toBeNull();
      expect(getComputedStyle(detectionSwitch).backgroundColor).toBe('rgb(9, 167, 66)');
      const header = getComputedStyle(component.querySelector('.switch-settings__header'));
      expect(header.margin).toBe('0px');
      expect(header.padding).toBe('4px 4px 4px 20px');
      expect(header.backgroundColor).toBe('rgb(230, 246, 234)');
      expect(getComputedStyle(component.querySelector('.switch-settings__header p')).lineHeight).toBe('normal');
      const list = getComputedStyle(component.querySelector('.switch-settings__list'));
      expect(list.backgroundColor).toBe('rgba(0, 0, 0, 0)');
      expect(list.borderRadius).toBe('0');
      expect(list.padding).toBe('0px 20px 10px');
      expect(list.gap).toBe('10px');
      expect(getComputedStyle(component.querySelectorAll('.switch-settings__row')[1]).borderTopStyle).toBe('');
      expect(getComputedStyle(component.querySelector('.switch-settings__row')).padding).toBe('16px 0px 0px');
      expect(getComputedStyle(component.querySelector('.switch-settings__controls')).transform).toBe('scale(0.7)');
      expect(switchStyles).not.toMatch(/chat-panel__local-mcp/);
      expect(switchStyles).toMatch(/\.switch-settings \.switch-settings__switch\.ant-switch\.ant-switch-checked:hover:not\(\.ant-switch-disabled\)/);
    } finally {
      style.remove();
      detection.remove();
    }
    expect(api.getState).toHaveBeenCalledTimes(2);
    expect(api.getCatalog).toHaveBeenCalledTimes(1);
  });

  it('shows the matching GIF on example focus without changing configuration and closes when hidden', async () => {
    await mount(<SwitchSettings embedded />);
    expect(host.querySelector('[role="tooltip"]')).toBeNull();
    for (const [id, name] of [['codex', 'Codex'], ['workbuddy', 'WorkBuddy']]) {
      const trigger = button(`查看 ${name} 配置示意`);
      await act(async () => trigger.focus());
      const image = host.querySelector('[role="tooltip"] img');
      expect(image.getAttribute('src')).toContain(`${id}_switch_example.gif`);
      expect(image.getAttribute('alt')).toBe(`${name} 模型配置效果示意`);
      await act(async () => trigger.blur());
      expect(host.querySelector('[role="tooltip"]')).toBeNull();
    }
    await act(async () => button('查看 Codex 配置示意').focus());
    await mount(<SwitchSettings embedded active={false} />);
    expect(host.querySelector('[role="tooltip"]')).toBeNull();
    await mount(<SwitchSettings embedded />);
    expect(host.querySelector('[role="tooltip"]')).toBeNull();
    expect(api.apply).not.toHaveBeenCalled();
    expect(api.disable).not.toHaveBeenCalled();
  });

  it('shows exactly two compact, named small switches without paths, model UI, permanent statuses or configuration fields', async () => {
    await mount();
    expect(host.querySelectorAll('.switch-settings__row')).toHaveLength(2);
    expect(host.querySelectorAll('[role="switch"]')).toHaveLength(2);
    expect(host.querySelector('.switch-settings__header').textContent).toBe('开启后可以在其他Agent中使用流光剪辑的模型。查看操作指南');
    const guide = host.querySelector('.switch-settings__guide');
    expect(guide.textContent).toBe('查看操作指南');
    expect(guide.getAttribute('href')).toBe('https://my.feishu.cn/wiki/RzxzwkyUeibzfCkot4CcpdBinng');
    expect(guide.getAttribute('target')).toBe('_blank');
    expect(guide.getAttribute('rel')).toBe('noreferrer');
    expectOnlySwitches();
    for (const tool of makeState().tools) {
      const control = toolSwitch(tool.id);
      const heading = row(tool.id).querySelector(`#switch-${tool.id}-heading`);
      expect(heading.textContent).toBe(tool.name);
      const tag = row(tool.id).querySelector('.switch-settings__tag');
      expect(tag.textContent).toBe(tool.id === 'codex' ? '免登录' : '多种模型');
      expect(tag.previousElementSibling.contains(button(`查看 ${tool.name} 配置示意`))).toBe(true);
      expect(control.getAttribute('aria-labelledby')).toBe(heading.id);
      expect(control.getAttribute('data-size')).toBe('small');
      expect(control.disabled).toBe(false);
      expect(isChecked(tool.id)).toBe(false);
      expect(row(tool.id).textContent).not.toContain(tool.path);
      expect(row(tool.id).textContent).not.toMatch(/已安装|未启用|已启用/);
      expect(button(`启用 ${tool.name}`)).toBeNull();
      expect(button(`更新 ${tool.name}`)).toBeNull();
      expect(button(`停用并恢复 ${tool.name}`)).toBeNull();
    }
    expect(host.querySelectorAll('input, textarea, select, ul, li')).toHaveLength(0);
    expect(host.textContent).not.toMatch(/Base URL|添加供应商|自定义|sk-|默认模型|后端模型列表|当前模型|配置路径|Backend description|1M|128K|视觉/);
    expect(host.textContent).not.toMatch(/退出登录不会撤销|长效密钥|不会自动改写/);
    for (const model of makeCatalog().models) {
      expect(host.textContent).not.toContain(model.model_id);
      expect(host.textContent).not.toContain(model.name);
    }
    expect(api.apply).not.toHaveBeenCalled();
    expect(api.disable).not.toHaveBeenCalled();
  });

  it('uses the eligible backend recommendation on explicit enable without displaying model options', async () => {
    await mount();
    expect(host.querySelector('select')).toBeNull();
    await clickSwitch('codex');
    expect(dialog()).toBeNull();
    expect(api.apply).toHaveBeenCalledExactlyOnceWith({ tool: 'codex', modelId: 'gpt-fixture-recommended' });
    expect(isChecked('codex')).toBe(true);
    expect(host.querySelector('select')).toBeNull();
    expect(button('更新 Codex')).toBeNull();
  });

  it('prefers an existing supported Codex model over the backend recommendation after an explicit close and reopen', async () => {
    api.getState.mockResolvedValue(makeState({ tools: makeState().tools.map(tool => tool.id === 'codex'
      ? { ...tool, enabled: true, needsUpdate: true, modelId: 'gpt-fixture-first' }
      : tool) }));
    await mount();
    expect(isChecked('codex')).toBe(true);
    expectOnlySwitches();
    expect(api.apply).not.toHaveBeenCalled();
    await clickSwitch('codex');
    expect(api.disable).toHaveBeenCalledExactlyOnceWith({ tool: 'codex' });
    expect(isChecked('codex')).toBe(false);
    expect(api.apply).not.toHaveBeenCalled();
    await clickSwitch('codex');
    expect(dialog()).toBeNull();
    expect(api.apply).toHaveBeenCalledExactlyOnceWith({ tool: 'codex', modelId: 'gpt-fixture-first' });
    expect(isChecked('codex')).toBe(true);
  });

  it('falls back to the first supported model when neither the configured model nor backend default is eligible', async () => {
    api.getState.mockResolvedValue(makeState({ tools: makeState().tools.map(tool => tool.id === 'codex'
      ? { ...tool, modelId: 'removed-configured-model' }
      : tool) }));
    api.getCatalog.mockResolvedValue(makeCatalog({ defaultModel: 'unsupported', models: [makeCatalog().models[0], makeCatalog().models[2]] }));
    await mount();
    await clickSwitch('codex');
    expect(api.apply).toHaveBeenCalledExactlyOnceWith({ tool: 'codex', modelId: 'gpt-fixture-first' });
  });

  it('allows Codex cleanup without GPT models while WorkBuddy can still use the backend catalog', async () => {
    api.getState.mockResolvedValue(makeState({ tools: makeState().tools.map(tool => tool.id === 'codex'
      ? { ...tool, enabled: true, hasManagedConfig: true, needsUpdate: true, modelId: 'gpt-fixture-first' }
      : tool) }));
    api.getCatalog.mockResolvedValue(makeCatalog({ defaultModel: 'unsupported', models: [makeCatalog().models[2]] }));
    await mount();
    expect(row('codex').textContent).toContain('暂无可用 GPT 模型');
    expect(isChecked('codex')).toBe(true);
    expect(toolSwitch('codex').disabled).toBe(false);
    expect(toolSwitch('workbuddy').disabled).toBe(false);
    expectOnlySwitches();
    expect(api.apply).not.toHaveBeenCalled();
    await clickSwitch('codex');
    expect(api.disable).toHaveBeenCalledExactlyOnceWith({ tool: 'codex' });
    expect(isChecked('codex')).toBe(false);
    await focus();
    expect(row('codex').textContent).toContain('暂无可用 GPT 模型');
    expect(toolSwitch('codex').disabled).toBe(true);
    await clickSwitch('codex');
    expect(dialog()).toBeNull();
    expect(api.apply).not.toHaveBeenCalled();
    await clickSwitch('workbuddy');
    expect(api.apply).toHaveBeenCalledExactlyOnceWith({ tool: 'workbuddy' });
  });

  it.each(['true', 1, {}, undefined, null])('excludes non-boolean Codex eligibility %j without rejecting those models for WorkBuddy', async codexSupported => {
    const unsafe = { model_id: 'gpt-fixture-unsafe', name: 'Not eligible', codexSupported };
    api.getCatalog.mockResolvedValue(makeCatalog({ defaultModel: unsafe.model_id, models: [unsafe, makeCatalog().models[0]] }));
    await mount();
    expect(host.querySelector('select')).toBeNull();
    expect(api.apply).not.toHaveBeenCalled();
    await clickSwitch('codex');
    expect(api.apply).toHaveBeenCalledExactlyOnceWith({ tool: 'codex', modelId: 'gpt-fixture-first' });
    api.getCatalog.mockResolvedValue(makeCatalog({ defaultModel: unsafe.model_id, models: [unsafe] }));
    await focus();
    expect(row('codex').textContent).toContain('暂无可用 GPT 模型');
    expect(toolSwitch('workbuddy').disabled).toBe(false);
    await clickSwitch('workbuddy');
    expect(api.apply).toHaveBeenLastCalledWith({ tool: 'workbuddy' });
    expect(api.apply).toHaveBeenCalledTimes(2);
  });

  it('keeps WorkBuddy model selection internal and applies without a modelId or any rendered model metadata', async () => {
    await mount();
    expect(row('workbuddy').querySelector('select, ul, li')).toBeNull();
    expect(row('workbuddy').textContent).not.toMatch(/First supported|Recommended model|WorkBuddy only|Backend description|1M|128K|视觉/);
    await clickSwitch('workbuddy');
    expect(dialog()).toBeNull();
    expect(api.apply).toHaveBeenCalledExactlyOnceWith({ tool: 'workbuddy' });
    expect(isChecked('workbuddy')).toBe(true);
    expect(button('更新 WorkBuddy')).toBeNull();
  });

  it.each([
    ['codex', 'success'], ['codex', 'failure'],
    ['workbuddy', 'success'], ['workbuddy', 'failure'],
  ])('enables %s directly without a dialog, keeps checked unchanged while loading, and handles %s', async (toolId, outcome) => {
    const pending = deferred();
    api.apply.mockReturnValueOnce(pending.promise);
    await mount();
    await clickSwitch(toolId);
    expect(api.apply).toHaveBeenCalledExactlyOnceWith(toolId === 'codex'
      ? { tool: toolId, modelId: 'gpt-fixture-recommended' }
      : { tool: toolId });
    expectPendingWrite(toolId, 'apply');
    expect(isChecked('codex')).toBe(false);
    expect(isChecked('workbuddy')).toBe(false);
    expect(host.textContent).not.toContain('配置已重置');
    const next = makeState({ tools: makeState().tools.map(tool => tool.id === toolId ? { ...tool, enabled: true } : tool) });
    if (outcome === 'success') api.getState.mockResolvedValue(next);
    await act(async () => {
      if (outcome === 'success') pending.resolve(next);
      else pending.reject(new Error('private-apply-key'));
    });
    expectOnlySwitches();
    expect(toolSwitch(toolId).getAttribute('aria-busy')).toBe('false');
    expect(toolSwitch(toolId).getAttribute('data-loading')).toBe('false');
    expect(toolSwitch('codex').disabled).toBe(false);
    expect(toolSwitch('workbuddy').disabled).toBe(false);
    expect(host.textContent).not.toContain('正在设置…');
    expect(host.textContent).not.toContain('private-apply-key');
    expect(isChecked(toolId)).toBe(outcome === 'success');
    if (outcome === 'success') {
      const toolName = makeState().tools.find(tool => tool.id === toolId).name;
      expect(message.success).toHaveBeenCalledExactlyOnceWith(`${toolName} 配置已重置，请完全退出并重启该工具后使用。`);
      expect(message.error).not.toHaveBeenCalled();
    } else {
      expect(message.error).toHaveBeenLastCalledWith('开启失败，请检查网络、登录状态和配置文件权限后重试。');
      expect(host.textContent).not.toContain('配置已重置');
    }
    expect(row(toolId).textContent).not.toContain('已启用');
    expect(api.apply).toHaveBeenCalledTimes(1);
    expect(api.disable).not.toHaveBeenCalled();
    expect(api.getCatalog).toHaveBeenCalledTimes(2);
    expect(api.getState).toHaveBeenCalledTimes(4);
  });

  it.each([
    ['codex', 'success'], ['codex', 'failure'],
    ['workbuddy', 'success'], ['workbuddy', 'failure'],
  ])('cleans up %s directly after logout and offline without a dialog, shows pending loading, and handles %s', async (toolId, outcome) => {
    api.getState.mockResolvedValue(makeState({ signedIn: false, tools: makeState().tools.map(tool => ({ ...tool, enabled: true, needsUpdate: true })) }));
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
    const pending = deferred();
    api.disable.mockReturnValueOnce(pending.promise);
    await mount();
    expect(host.textContent).toContain('请先登录账号再开启；已有配置仍可关闭并清理。');
    expect(host.textContent).toContain('当前离线，无法开启；仍可关闭并清理已有配置。');
    expect(toolSwitch(toolId).disabled).toBe(false);
    await clickSwitch(toolId);
    expect(api.disable).toHaveBeenCalledExactlyOnceWith({ tool: toolId });
    expectPendingWrite(toolId, 'disable');
    expect(isChecked('codex')).toBe(true);
    expect(isChecked('workbuddy')).toBe(true);
    expect(host.textContent).not.toContain('原有配置已还原');
    await act(async () => {
      if (outcome === 'success') pending.resolve(makeState({ signedIn: false }));
      else pending.reject(new Error('private-cleanup-key'));
    });
    expectOnlySwitches();
    expect(toolSwitch(toolId).getAttribute('aria-busy')).toBe('false');
    expect(toolSwitch(toolId).getAttribute('data-loading')).toBe('false');
    expect(toolSwitch('codex').disabled).toBe(outcome === 'success');
    expect(toolSwitch('workbuddy').disabled).toBe(outcome === 'success');
    expect(host.textContent).not.toContain('正在清理…');
    expect(host.textContent).not.toContain('private-cleanup-key');
    expect(isChecked(toolId)).toBe(outcome === 'failure');
    if (outcome === 'success') {
      const toolName = makeState().tools.find(tool => tool.id === toolId).name;
      expect(message.success).toHaveBeenCalledExactlyOnceWith(`${toolName} 的 VectCut 配置已移除，请完全退出并重启该工具。`);
      expect(message.error).not.toHaveBeenCalled();
    } else {
      expect(message.error).toHaveBeenLastCalledWith('关闭并清理失败，请检查配置文件权限后重试。');
      expect(host.textContent).not.toContain('原有配置已还原');
    }
    expect(api.disable).toHaveBeenCalledTimes(1);
    expect(api.apply).not.toHaveBeenCalled();
  });

  it('shows an inactive tool with an app-owned managed-config as on and allows cleanup after logout without exposing raw conflicts', async () => {
    api.getState.mockResolvedValue(makeState({ signedIn: false, tools: makeState().tools.map(tool => tool.id === 'codex'
      ? { ...tool, enabled: false, needsUpdate: true, hasManagedConfig: true, error: 'External conflict' }
      : tool) }));
    await mount();
    expect(isChecked('codex')).toBe(true);
    expect(toolSwitch('codex').disabled).toBe(false);
    expectOnlySwitches();
    expect(message.error).toHaveBeenCalledWith(SWITCH_ERROR_MESSAGES.unavailable);
    expect(row('codex').querySelector('[role="alert"]')).toBeNull();
    expect(row('codex').textContent).not.toContain('External conflict');
    await clickSwitch('codex');
    expect(dialog()).toBeNull();
    expect(api.disable).toHaveBeenCalledExactlyOnceWith({ tool: 'codex' });
    expect(api.apply).not.toHaveBeenCalled();
    expect(isChecked('codex')).toBe(false);
  });

  it.each([
    { enabled: false, hasManagedConfig: false, needsUpdate: false },
    { enabled: false, hasManagedConfig: false, needsUpdate: true },
    { enabled: true, hasManagedConfig: false, needsUpdate: false },
    { enabled: true, hasManagedConfig: false, needsUpdate: true },
    { enabled: true, hasManagedConfig: true, needsUpdate: false },
    { enabled: true, hasManagedConfig: true, needsUpdate: true },
    { enabled: false, hasManagedConfig: true, needsUpdate: false },
    { enabled: false, hasManagedConfig: true, needsUpdate: true },
  ])('uses enabled or managed-config for checked without secondary actions or update/cleanup labels: %j', async status => {
    api.getState.mockResolvedValue(makeState({ tools: makeState().tools.map(tool => ({ ...tool, ...status })) }));
    await mount();
    expectOnlySwitches();
    for (const tool of makeState().tools) {
      expect(isChecked(tool.id)).toBe(Boolean(status.enabled || status.hasManagedConfig));
      expect(toolSwitch(tool.id).disabled).toBe(false);
    }
    expect(api.apply).not.toHaveBeenCalled();
    expect(api.disable).not.toHaveBeenCalled();
  });

  it.each(['offline', 'signed out', 'not installed', 'no GPT', 'empty catalog', 'catalog error', 'pending catalog', 'all blockers'])(
    'allows pending-managed-config cleanup with no extra page buttons when %s', async condition => {
      const blocked = name => condition === name || condition === 'all blockers';
      const pending = deferred();
      let current = makeState({
        signedIn: !blocked('signed out'),
        tools: makeState().tools.map(tool => ({ ...tool, installed: !blocked('not installed'), enabled: false, hasManagedConfig: true, needsUpdate: true })),
      });
      api.getState.mockResolvedValue(current);
      api.disable.mockImplementation(async ({ tool: id }) => {
        current = { ...current, tools: current.tools.map(tool => tool.id === id ? { ...tool, hasManagedConfig: false } : tool) };
        api.getState.mockResolvedValue(current);
        return current;
      });
      if (blocked('offline')) Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
      if (blocked('pending catalog')) api.getCatalog.mockReturnValue(pending.promise);
      else if (blocked('catalog error')) api.getCatalog.mockRejectedValue(new Error('private-catalog-error'));
      else if (blocked('empty catalog')) api.getCatalog.mockResolvedValue(makeCatalog({ models: [] }));
      else if (blocked('no GPT')) api.getCatalog.mockResolvedValue(makeCatalog({ defaultModel: 'unsupported', models: [makeCatalog().models[2]] }));
      await mount();
      expectOnlySwitches();
      for (const tool of makeState().tools) {
        expect(isChecked(tool.id)).toBe(true);
        expect(toolSwitch(tool.id).disabled).toBe(false);
        await clickSwitch(tool.id);
        expectOnlySwitches();
        expect(api.disable).toHaveBeenLastCalledWith({ tool: tool.id });
        expect(isChecked(tool.id)).toBe(false);
      }
      expect(api.disable).toHaveBeenCalledTimes(2);
      expect(api.apply).not.toHaveBeenCalled();
      expect(host.textContent).not.toContain('private-catalog-error');
      if (blocked('pending catalog')) await act(async () => pending.resolve(makeCatalog()));
      expectOnlySwitches();
    },
  );

  it('never auto-writes configuration changes, supports close/reopen, and disables enabling missing installations', async () => {
    api.getState.mockResolvedValue(makeState({ tools: makeState().tools.map(tool => tool.id === 'codex'
      ? { ...tool, enabled: true, modelId: 'gpt-fixture-recommended', needsUpdate: true }
      : { ...tool, installed: false }) }));
    await mount();
    expectOnlySwitches();
    expect(row('codex').textContent).not.toContain('不会自动改写');
    expect(row('workbuddy').textContent).toContain('未检测到安装');
    expect(toolSwitch('workbuddy').disabled).toBe(true);
    expect(api.apply).not.toHaveBeenCalled();
    await clickSwitch('workbuddy');
    expect(dialog()).toBeNull();
    await clickSwitch('codex');
    expect(isChecked('codex')).toBe(false);
    expect(api.apply).not.toHaveBeenCalled();
    await clickSwitch('codex');
    expect(api.apply).toHaveBeenCalledExactlyOnceWith({ tool: 'codex', modelId: 'gpt-fixture-recommended' });
  });

  it('reconciles state after catalog resolution without update labels and retains the configured model for close/reopen', async () => {
    const pending = deferred();
    const active = makeState({ tools: makeState().tools.map(tool => ({ ...tool, enabled: true, hasManagedConfig: true, modelId: tool.id === 'codex' ? 'gpt-fixture-first' : undefined })) });
    const updated = { ...active, tools: active.tools.map(tool => ({ ...tool, needsUpdate: true })) };
    api.getState.mockResolvedValueOnce(active).mockResolvedValue(updated);
    api.getCatalog.mockReturnValueOnce(pending.promise);
    await mount();
    expect(api.getState).toHaveBeenCalledTimes(1);
    expect(isChecked('codex')).toBe(true);
    expect(row('codex').textContent).not.toMatch(/已启用|需要更新/);
    expect(button('更新 Codex')).toBeNull();
    expect(toolSwitch('codex').disabled).toBe(false);
    await act(async () => pending.resolve(makeCatalog()));
    expect(api.getState).toHaveBeenCalledTimes(2);
    expectOnlySwitches();
    expect(api.apply).not.toHaveBeenCalled();
    expect(api.disable).not.toHaveBeenCalled();
    await clickSwitch('codex');
    expect(isChecked('codex')).toBe(false);
    expect(api.apply).not.toHaveBeenCalled();
    await clickSwitch('codex');
    expect(api.apply).toHaveBeenCalledExactlyOnceWith({ tool: 'codex', modelId: 'gpt-fixture-first' });
  });

  it('keeps signed-out offline cleanup usable while the catalog is still pending', async () => {
    const pending = deferred();
    const signedOut = makeState({ signedIn: false, tools: makeState().tools.map(tool => ({ ...tool, enabled: true, hasManagedConfig: true, needsUpdate: true })) });
    api.getState.mockResolvedValue(signedOut);
    api.getCatalog.mockReturnValueOnce(pending.promise).mockRejectedValue(new Error('offline-secret'));
    api.disable.mockImplementation(async () => {
      const next = makeState({ signedIn: false });
      api.getState.mockResolvedValue(next);
      return next;
    });
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
    await mount();
    expect(host.textContent).not.toContain('正在读取工具状态…');
    expect(host.querySelector('.switch-settings__loading')).toBeNull();
    expectOnlySwitches();
    expect(toolSwitch('codex').disabled).toBe(false);
    await clickSwitch('codex');
    expect(dialog()).toBeNull();
    expect(api.disable).toHaveBeenCalledExactlyOnceWith({ tool: 'codex' });
    expect(message.success).toHaveBeenLastCalledWith('Codex 的 VectCut 配置已移除，请完全退出并重启该工具。');
    expect(isChecked('codex')).toBe(false);
    await act(async () => pending.reject(new Error('old-offline-secret')));
    expect(host.textContent).not.toContain('offline-secret');
    expect(api.apply).not.toHaveBeenCalled();
  });

  it('reconciles a model removed during apply without retrying until the user explicitly enables again', async () => {
    api.getCatalog.mockResolvedValue(makeCatalog({ defaultModel: 'gpt-fixture-first' }));
    await mount();
    const nextCatalog = makeCatalog({ models: [makeCatalog().models[1], makeCatalog().models[2]] });
    api.apply.mockImplementationOnce(async () => {
      api.getCatalog.mockResolvedValue(nextCatalog);
      throw new Error('removed-model-secret');
    });
    await clickSwitch('codex');
    expect(api.apply).toHaveBeenCalledExactlyOnceWith({ tool: 'codex', modelId: 'gpt-fixture-first' });
    expect(api.getCatalog).toHaveBeenCalledTimes(2);
    expect(message.error).toHaveBeenLastCalledWith('开启失败，请检查网络、登录状态和配置文件权限后重试。');
    expect(host.textContent).not.toContain('removed-model-secret');
    expect(isChecked('codex')).toBe(false);
    expect(dialog()).toBeNull();
    expect(toolSwitch('codex').disabled).toBe(false);
    expect(api.disable).not.toHaveBeenCalled();
    await clickSwitch('codex');
    expect(dialog()).toBeNull();
    expect(api.apply).toHaveBeenLastCalledWith({ tool: 'codex', modelId: 'gpt-fixture-recommended' });
    expect(api.apply).toHaveBeenCalledTimes(2);
    expect(isChecked('codex')).toBe(true);
  });

  it('reconciles the internal catalog after WorkBuddy apply without rendering a model list or automatically writing Codex', async () => {
    await mount();
    const nextCatalog = makeCatalog({ defaultModel: 'gpt-fixture-first', models: [makeCatalog().models[0]] });
    const active = makeState({ tools: makeState().tools.map(tool => tool.id === 'workbuddy' ? { ...tool, enabled: true } : tool) });
    api.apply.mockImplementationOnce(async () => {
      api.getCatalog.mockResolvedValue(nextCatalog);
      api.getState.mockResolvedValue(active);
      return active;
    });
    await clickSwitch('workbuddy');
    expect(api.getCatalog).toHaveBeenCalledTimes(2);
    expect(row('workbuddy').querySelector('select, ul, li')).toBeNull();
    expect(row('workbuddy').textContent).not.toContain('Recommended model');
    expect(isChecked('workbuddy')).toBe(true);
    expect(api.apply).toHaveBeenCalledExactlyOnceWith({ tool: 'workbuddy' });
    expect(api.disable).not.toHaveBeenCalled();
    await clickSwitch('codex');
    expect(api.apply).toHaveBeenLastCalledWith({ tool: 'codex', modelId: 'gpt-fixture-first' });
    expect(api.apply).toHaveBeenCalledTimes(2);
  });

  it('handles unavailable bridge, state errors, and catalog errors without rendering sensitive errors', async () => {
    delete window.api;
    await mount();
    expect(message.error).toHaveBeenLastCalledWith('switch 服务尚未就绪，请重启应用后重试。');
    expect(row('codex').textContent).toContain('状态未知');
    expect(toolSwitch('codex').disabled).toBe(true);
    window.api = { switchSettings: api };
    api.getState.mockRejectedValue(new Error('sk-never-render-state-secret'));
    await focus();
    expect(message.error).toHaveBeenLastCalledWith('读取工具配置失败，请重新进入此页或切回窗口后重试。');
    expect(host.textContent).not.toContain('sk-never-render');
    expect(toolSwitch('codex').disabled).toBe(true);
    api.getState.mockResolvedValue(makeState({ tools: makeState().tools.map(tool => ({ ...tool, enabled: true, needsUpdate: true, error: 'sk-never-render-tool-secret' })) }));
    api.getCatalog.mockRejectedValueOnce(new Error('sk-never-render-catalog-secret'));
    await focus();
    expect(message.error).toHaveBeenCalledWith('加载后端模型失败，请检查网络后重新进入此页。');
    expect(message.error).toHaveBeenCalledWith(SWITCH_ERROR_MESSAGES.unavailable);
    expect(row('codex').querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).not.toContain('sk-never-render');
    expectOnlySwitches();
    expect(toolSwitch('codex').disabled).toBe(false);
    await focus();
    expect(host.textContent).not.toContain('加载后端模型失败');
  });

  it('handles empty catalogs and rejected apply/cleanup without exposing credentials, fabricating success or switching optimistically', async () => {
    api.getCatalog.mockResolvedValueOnce(makeCatalog({ models: [] }));
    await mount();
    expect(host.textContent).toContain('暂无后端模型，请稍后重新进入此页。');
    expect(toolSwitch('codex').disabled).toBe(true);
    expect(toolSwitch('workbuddy').disabled).toBe(true);
    await focus();
    api.apply.mockRejectedValueOnce(new Error('sk-never-render-apply-secret'));
    await clickSwitch('codex');
    expect(message.error).toHaveBeenLastCalledWith('开启失败，请检查网络、登录状态和配置文件权限后重试。');
    expect(host.textContent).not.toContain('sk-never-render');
    expect(host.textContent).not.toContain('配置已重置');
    expect(isChecked('codex')).toBe(false);
    expect(toolSwitch('codex').disabled).toBe(false);
    await clickSwitch('codex');
    expect(isChecked('codex')).toBe(true);
    api.disable.mockRejectedValueOnce(new Error('sk-never-render-restore-secret'));
    await clickSwitch('codex');
    expect(message.error).toHaveBeenLastCalledWith('关闭并清理失败，请检查配置文件权限后重试。');
    expect(host.textContent).not.toContain('sk-never-render');
    expect(host.textContent).not.toContain('本应用写入的配置已删除，原有配置已还原');
    expect(isChecked('codex')).toBe(true);
    expect(toolSwitch('codex').disabled).toBe(false);
    expect(api.apply).toHaveBeenCalledTimes(2);
    expect(api.disable).toHaveBeenCalledTimes(1);
    expectOnlySwitches();
    await clickSwitch('codex');
    expect(dialog()).toBeNull();
    expect(api.disable).toHaveBeenCalledTimes(2);
    expect(api.disable).toHaveBeenLastCalledWith({ tool: 'codex' });
    expect(isChecked('codex')).toBe(false);
    expect(message.success).toHaveBeenLastCalledWith('Codex 的 VectCut 配置已移除，请完全退出并重启该工具。');
  });

  it('keeps a pending-managed-config switch on after cleanup failure and allows an explicit retry', async () => {
    api.getState.mockResolvedValue(makeState({ tools: makeState().tools.map(tool => tool.id === 'codex'
      ? { ...tool, enabled: false, hasManagedConfig: true }
      : tool) }));
    api.disable.mockRejectedValueOnce(new Error('private-managed-config-conflict'));
    await mount();
    expect(isChecked('codex')).toBe(true);
    await clickSwitch('codex');
    expect(message.error).toHaveBeenLastCalledWith('关闭并清理失败，请检查配置文件权限后重试。');
    expect(host.textContent).not.toContain('private-managed-config-conflict');
    expect(host.textContent).not.toContain('原有配置已还原');
    expect(isChecked('codex')).toBe(true);
    expect(toolSwitch('codex').disabled).toBe(false);
    expectOnlySwitches();
    await clickSwitch('codex');
    expect(api.disable).toHaveBeenCalledTimes(2);
    expect(api.disable).toHaveBeenLastCalledWith({ tool: 'codex' });
    expect(api.apply).not.toHaveBeenCalled();
    expect(isChecked('codex')).toBe(false);
  });

  it('loads and disables switches during a pending apply, prevents duplicate writes, and defers focus refresh until it settles', async () => {
    const statePending = deferred();
    api.getState.mockReturnValueOnce(statePending.promise);
    await mount();
    expect(host.textContent).not.toContain('正在读取工具状态…');
    expect(host.querySelector('.switch-settings__loading')).toBeNull();
    expectOnlySwitches();
    expect(toolSwitch('codex').disabled).toBe(true);
    await act(async () => statePending.resolve(makeState()));
    const applyPending = deferred();
    api.apply.mockReturnValueOnce(applyPending.promise);
    await act(async () => {
      toolSwitch('codex').click();
      toolSwitch('codex').click();
      toolSwitch('workbuddy').click();
    });
    expectPendingWrite('codex', 'apply');
    expect(isChecked('codex')).toBe(false);
    expect(isChecked('workbuddy')).toBe(false);
    await clickSwitch('codex');
    await clickSwitch('workbuddy');
    await focus();
    expect(dialog()).toBeNull();
    expect(api.apply).toHaveBeenCalledTimes(1);
    expect(api.disable).not.toHaveBeenCalled();
    await focus();
    expect(api.getState).toHaveBeenCalledTimes(2);
    const enabled = makeState({ tools: makeState().tools.map(tool => ({ ...tool, enabled: true })) });
    api.getState.mockResolvedValue(enabled);
    await act(async () => applyPending.resolve(enabled));
    expect(api.getState).toHaveBeenCalledTimes(4);
    expectOnlySwitches();
    expect(toolSwitch('codex').getAttribute('aria-busy')).toBe('false');
    expect(toolSwitch('codex').disabled).toBe(false);
    expect(isChecked('codex')).toBe(true);
    expect(api.apply).toHaveBeenCalledTimes(1);
  });

  it('loads and disables switches during a pending cleanup without switching off early or issuing duplicate writes', async () => {
    api.getState.mockResolvedValue(makeState({ tools: makeState().tools.map(tool => ({ ...tool, enabled: true })) }));
    const pending = deferred();
    api.disable.mockReturnValueOnce(pending.promise);
    await mount();
    await act(async () => {
      toolSwitch('codex').click();
      toolSwitch('codex').click();
      toolSwitch('workbuddy').click();
    });
    expectPendingWrite('codex', 'disable');
    expect(isChecked('codex')).toBe(true);
    expect(isChecked('workbuddy')).toBe(true);
    await clickSwitch('codex');
    await clickSwitch('workbuddy');
    expect(dialog()).toBeNull();
    expect(api.disable).toHaveBeenCalledExactlyOnceWith({ tool: 'codex' });
    expect(api.apply).not.toHaveBeenCalled();
    await act(async () => pending.resolve(makeState()));
    expect(isChecked('codex')).toBe(false);
    expect(toolSwitch('codex').getAttribute('aria-busy')).toBe('false');
    expect(toolSwitch('codex').disabled).toBe(false);
    expect(api.disable).toHaveBeenCalledTimes(1);
  });

  it('refreshes on focus and user/token changes with latest-generation responses winning and never auto-writes', async () => {
    const oldState = deferred(), oldCatalog = deferred();
    api.getState.mockReturnValueOnce(oldState.promise);
    api.getCatalog.mockReturnValueOnce(oldCatalog.promise);
    await mount();
    await focus();
    expect(toolSwitch('codex').disabled).toBe(false);
    await act(async () => {
      oldState.resolve(makeState({ signedIn: false }));
      oldCatalog.resolve(makeCatalog({ models: [] }));
    });
    expect(host.textContent).not.toContain('请先登录');
    expect(toolSwitch('codex').disabled).toBe(false);
    expect(electronStore.onDidChange.mock.calls.map(args => args[0])).toEqual(['user', 'auth.refresh_token']);
    await authChange('user');
    await authChange('auth.refresh_token');
    expect(api.getState).toHaveBeenCalledTimes(7);
    expect(api.getCatalog).toHaveBeenCalledTimes(4);
    expect(api.apply).not.toHaveBeenCalled();
    expect(api.disable).not.toHaveBeenCalled();
    await clickSwitch('codex');
    expect(api.apply).toHaveBeenCalledExactlyOnceWith({ tool: 'codex', modelId: 'gpt-fixture-recommended' });
  });

  it('ignores profile/key edits and refresh-token rotation for the same account without interrupting a direct write', async () => {
    await mount();
    await authChange('user', { id: 'current-user', name: 'New nickname', apiKey: 'never-render-this-key' });
    await authChange('auth.refresh_token', 'rotated-token');
    expect(api.getState).toHaveBeenCalledTimes(2);
    expect(api.getCatalog).toHaveBeenCalledTimes(1);
    const pending = deferred();
    api.apply.mockReturnValueOnce(pending.promise);
    await clickSwitch('codex');
    expectPendingWrite('codex', 'apply');
    await authChange('user', { id: 'current-user', avatar: 'another-avatar' });
    await authChange('auth.refresh_token', 'rotated-again');
    expectPendingWrite('codex', 'apply');
    expect(api.getState).toHaveBeenCalledTimes(2);
    expect(api.getCatalog).toHaveBeenCalledTimes(1);
    const enabled = makeState({ tools: makeState().tools.map(tool => tool.id === 'codex' ? { ...tool, enabled: true } : tool) });
    api.getState.mockResolvedValue(enabled);
    await act(async () => pending.resolve(enabled));
    expect(message.success).toHaveBeenLastCalledWith('Codex 配置已重置，请完全退出并重启该工具后使用。');
    expect(host.textContent).not.toContain('never-render-this-key');
    expect(isChecked('codex')).toBe(true);
    expect(toolSwitch('codex').getAttribute('aria-busy')).toBe('false');
    expect(api.getState).toHaveBeenCalledTimes(4);
    expect(api.getCatalog).toHaveBeenCalledTimes(2);
    expect(api.apply).toHaveBeenCalledExactlyOnceWith({ tool: 'codex', modelId: 'gpt-fixture-recommended' });
  });

  it('clears cached model selection and prior state immediately on account changes without writing', async () => {
    api.getState.mockResolvedValue(makeState({ tools: makeState().tools.map(tool => tool.id === 'codex'
      ? { ...tool, enabled: true, modelId: 'gpt-fixture-first' }
      : tool) }));
    api.getCatalog.mockResolvedValue(makeCatalog({ defaultModel: 'gpt-fixture-first' }));
    await mount();
    expect(isChecked('codex')).toBe(true);
    const nextState = deferred(), nextCatalog = deferred();
    api.getState.mockReturnValueOnce(nextState.promise);
    api.getCatalog.mockReturnValueOnce(nextCatalog.promise);
    await authChange('user');
    expect(dialog()).toBeNull();
    expect(row('codex').textContent).toContain('状态未知');
    expect(isChecked('codex')).toBe(false);
    expect(toolSwitch('codex').disabled).toBe(true);
    expect(toolSwitch('workbuddy').disabled).toBe(true);
    api.getState.mockResolvedValue(makeState({ signedIn: false }));
    await act(async () => {
      nextState.resolve(makeState({ signedIn: false }));
      nextCatalog.resolve(makeCatalog({ models: [] }));
    });
    expect(host.textContent).toContain('请先登录');
    expect(api.apply).not.toHaveBeenCalled();
    expect(api.disable).not.toHaveBeenCalled();
    api.getState.mockResolvedValue(makeState());
    api.getCatalog.mockResolvedValue(makeCatalog());
    await authChange('user', { id: 'third-user' });
    expect(api.apply).not.toHaveBeenCalled();
    await clickSwitch('codex');
    expect(api.apply).toHaveBeenCalledExactlyOnceWith({ tool: 'codex', modelId: 'gpt-fixture-recommended' });
  });

  it('closes old-account configuration and reopens with the new account catalog instead of stale selection', async () => {
    const oldModel = { ...makeCatalog().models[0], model_id: 'gpt-old-account' };
    const newModel = { ...makeCatalog().models[1], model_id: 'gpt-new-account' };
    api.getState.mockResolvedValue(makeState({ tools: makeState().tools.map(tool => tool.id === 'codex'
      ? { ...tool, enabled: true, hasManagedConfig: true, needsUpdate: true, modelId: oldModel.model_id }
      : tool) }));
    api.getCatalog.mockResolvedValue(makeCatalog({ defaultModel: oldModel.model_id, models: [oldModel] }));
    await mount();
    expect(isChecked('codex')).toBe(true);
    const newState = makeState({ tools: makeState().tools.map(tool => tool.id === 'codex'
      ? { ...tool, enabled: false, hasManagedConfig: true, needsUpdate: true, modelId: oldModel.model_id }
      : tool) });
    api.getState.mockResolvedValue(newState);
    api.getCatalog.mockResolvedValue(makeCatalog({ defaultModel: newModel.model_id, models: [newModel] }));
    await authChange('user', { id: 'new-account' });
    expect(isChecked('codex')).toBe(true);
    expectOnlySwitches();
    expect(api.apply).not.toHaveBeenCalled();
    expect(api.disable).not.toHaveBeenCalled();
    await clickSwitch('codex');
    expect(api.disable).toHaveBeenCalledExactlyOnceWith({ tool: 'codex' });
    expect(isChecked('codex')).toBe(false);
    expect(api.apply).not.toHaveBeenCalled();
    await clickSwitch('codex');
    expect(dialog()).toBeNull();
    expect(api.apply).toHaveBeenCalledExactlyOnceWith({ tool: 'codex', modelId: newModel.model_id });
    expect(isChecked('codex')).toBe(true);
    expect(host.textContent).not.toMatch(/gpt-old-account|gpt-new-account/);
  });

  it.each([
    ['apply', 'user', 'success'], ['apply', 'user', 'failure'],
    ['apply', 'auth.refresh_token', 'success'], ['apply', 'auth.refresh_token', 'failure'],
    ['disable', 'user', 'success'], ['disable', 'user', 'failure'],
    ['disable', 'auth.refresh_token', 'success'], ['disable', 'auth.refresh_token', 'failure'],
  ])('ignores old-account %s %s-change %s results and reconciles read-only after settling', async (type, authKey, outcome) => {
    api.getState.mockResolvedValue(makeState({ tools: makeState().tools.map(tool => tool.id === 'codex'
      ? { ...tool, enabled: type === 'disable' }
      : tool) }));
    await mount();
    const pending = deferred();
    api[type].mockReturnValueOnce(pending.promise);
    await clickSwitch('codex');
    expectPendingWrite('codex', type);
    expect(isChecked('codex')).toBe(type === 'disable');
    const current = makeState({ signedIn: authKey === 'user' });
    api.getState.mockResolvedValue(current);
    await authChange(authKey);
    // Busy status takes precedence over unknown state while the old write is locked.
    expectPendingWrite('codex', type);
    expect(isChecked('codex')).toBe(false);
    expect(api.getState).toHaveBeenCalledTimes(2);
    expect(api.getCatalog).toHaveBeenCalledTimes(1);
    await clickSwitch('codex');
    await clickSwitch('workbuddy');
    await focus();
    await act(async () => {
      if (outcome === 'success') pending.resolve(makeState({ tools: makeState().tools.map(tool => ({ ...tool, enabled: true })) }));
      else pending.reject(new Error('private-old-account-error'));
    });
    expectOnlySwitches();
    expect(host.textContent.includes('请先登录')).toBe(authKey !== 'user');
    expect(host.textContent).not.toMatch(/配置已重置|配置已移除|开启失败|关闭并清理失败|private-old-account-error|正在设置|正在清理/);
    expect(message.error).not.toHaveBeenCalled();
    expect(message.success).not.toHaveBeenCalled();
    expect(isChecked('codex')).toBe(false);
    expect(isChecked('workbuddy')).toBe(false);
    expect(toolSwitch('codex').getAttribute('aria-busy')).toBe('false');
    expect(api.getState).toHaveBeenCalledTimes(4);
    expect(api.getCatalog).toHaveBeenCalledTimes(2);
    expect(api[type]).toHaveBeenCalledTimes(1);
    expect(api[type === 'apply' ? 'disable' : 'apply']).not.toHaveBeenCalled();
  });

  it('recovers from offline events through read-only refresh and never writes without a switch click', async () => {
    await mount();
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
    await act(async () => window.dispatchEvent(new Event('offline')));
    expect(dialog()).toBeNull();
    expect(isChecked('workbuddy')).toBe(false);
    expect(toolSwitch('workbuddy').disabled).toBe(true);
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
    await act(async () => window.dispatchEvent(new Event('online')));
    expect(host.textContent).not.toContain('当前离线');
    expect(toolSwitch('workbuddy').disabled).toBe(false);
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

  it.each(Object.values(SWITCH_ERROR_MESSAGES).flatMap(text => [
    ['apply', text, false], ['apply', text, true],
    ['disable', text, false], ['disable', text, true],
  ]))('shows only the controlled %s error %s (Electron wrapper: %s)', async (type, text, wrapped) => {
    api.getState.mockResolvedValue(makeState({ tools: makeState().tools.map(tool => ({ ...tool, enabled: type === 'disable' })) }));
    api[type].mockRejectedValueOnce(new Error(wrapped
      ? `Error invoking remote method 'switch-settings:${type}': Error: ${text}` : text));
    await mount();
    await clickSwitch('codex');
    expect(message.error).toHaveBeenCalledExactlyOnceWith(text);
    expect(message.success).not.toHaveBeenCalled();
    expect(isChecked('codex')).toBe(type === 'disable');
    expectOnlySwitches();
  });

  it.each([
    `Error invoking remote method 'switch-settings:apply': Error: sk-bridge-secret`,
    `Error invoking remote method 'switch-settings:apply': Error: ${SWITCH_ERROR_MESSAGES.fileAccess} sk-suffix-secret`,
    `sk-prefix-secret ${SWITCH_ERROR_MESSAGES.fileAccess}`,
    `${SWITCH_ERROR_MESSAGES.fileAccess}\nsk-newline-secret`,
    `Error invoking remote method 'unrelated:apply': Error: ${SWITCH_ERROR_MESSAGES.fileAccess}`,
    'Error: sk-unknown-secret',
    { message: { toString: () => 'sk-coercion-secret' } },
    null,
  ])('falls back rather than exposing arbitrary bridge errors: %j', async raw => {
    api.apply.mockRejectedValueOnce(typeof raw === 'string' ? new Error(raw) : raw);
    await mount();
    await clickSwitch('codex');
    expect(message.error).toHaveBeenCalledExactlyOnceWith('开启失败，请检查网络、登录状态和配置文件权限后重试。');
    expect(message.success).not.toHaveBeenCalled();
  });

  it.each(['state', 'catalog'])('deduplicates %s failures across focus and allows the same error after recovery or account change', async source => {
    const read = source === 'state' ? api.getState : api.getCatalog;
    const recovered = source === 'state' ? makeState() : makeCatalog();
    const text = source === 'state'
      ? '读取工具配置失败，请重新进入此页或切回窗口后重试。'
      : '加载后端模型失败，请检查网络后重新进入此页。';
    read.mockRejectedValue(new Error('sk-read-secret'));
    await mount();
    expect(message.error).toHaveBeenCalledExactlyOnceWith(text);
    expect(toolSwitch('codex').disabled).toBe(true);
    await focus();
    await focus();
    expect(message.error).toHaveBeenCalledTimes(1);
    await authChange('user');
    expect(message.error).toHaveBeenCalledTimes(2);
    read.mockResolvedValue(recovered);
    await focus();
    expect(toolSwitch('codex').disabled).toBe(false);
    read.mockRejectedValue(new Error('sk-read-secret'));
    await focus();
    await focus();
    expect(message.error).toHaveBeenCalledTimes(3);
    expect(message.error).toHaveBeenLastCalledWith(text);
    expect(toolSwitch('codex').disabled).toBe(true);
  });

  it('deduplicates tool state errors until cleared or the account changes, with no permanent error body', async () => {
    const conflict = makeState({ tools: makeState().tools.map(tool => tool.id === 'codex'
      ? { ...tool, hasManagedConfig: true, error: SWITCH_ERROR_MESSAGES.ownershipConflict } : tool) });
    api.getState.mockResolvedValue(conflict);
    await mount();
    expect(message.error).toHaveBeenCalledExactlyOnceWith(SWITCH_ERROR_MESSAGES.ownershipConflict);
    await focus();
    await focus();
    expect(message.error).toHaveBeenCalledTimes(1);
    expect(toolSwitch('codex').disabled).toBe(false);
    await authChange('user');
    expect(message.error).toHaveBeenCalledTimes(2);
    await clickSwitch('codex');
    expect(isChecked('codex')).toBe(false);
    expect(message.success).toHaveBeenCalledExactlyOnceWith('Codex 的 VectCut 配置已移除，请完全退出并重启该工具。');
    api.getState.mockResolvedValue(conflict);
    await focus();
    await focus();
    expect(message.error).toHaveBeenCalledTimes(3);
    expect(message.error).toHaveBeenLastCalledWith(SWITCH_ERROR_MESSAGES.ownershipConflict);
    expect(row('codex').textContent).toBe('Codex免登录');
  });

  it('filters tool state errors and getState rejection through the same exact whitelist', async () => {
    api.getState.mockResolvedValue(makeState({ tools: makeState().tools.map(tool => ({ ...tool, error: `${SWITCH_ERROR_MESSAGES.invalidConfig} sk-tool-secret` })) }));
    await mount();
    expect(message.error.mock.calls).toEqual([[SWITCH_ERROR_MESSAGES.unavailable], [SWITCH_ERROR_MESSAGES.unavailable]]);
    message.error.mockClear();
    api.getState.mockRejectedValue(new Error(`Error invoking remote method 'switch-settings:get-state': Error: ${SWITCH_ERROR_MESSAGES.locked}`));
    await focus();
    expect(message.error).toHaveBeenCalledExactlyOnceWith(SWITCH_ERROR_MESSAGES.locked);
    await focus();
    expect(message.error).toHaveBeenCalledTimes(1);
    api.getState.mockRejectedValue(new Error(`Error invoking remote method 'switch-settings:get-state': Error: ${SWITCH_ERROR_MESSAGES.locked} sk-state-secret`));
    await focus();
    expect(message.error).toHaveBeenLastCalledWith('读取工具配置失败，请重新进入此页或切回窗口后重试。');
  });

  it('allows explicit action failure retries to toast again without fabricating success', async () => {
    api.apply.mockRejectedValue(new Error(SWITCH_ERROR_MESSAGES.credentials));
    await mount();
    await clickSwitch('codex');
    await clickSwitch('codex');
    expect(message.error.mock.calls).toEqual([[SWITCH_ERROR_MESSAGES.credentials], [SWITCH_ERROR_MESSAGES.credentials]]);
    expect(message.success).not.toHaveBeenCalled();
    expect(isChecked('codex')).toBe(false);
  });

  it('ignores stale read failures after account changes and unmount without emitting toasts', async () => {
    const oldState = deferred(), oldCatalog = deferred();
    api.getState.mockReturnValueOnce(oldState.promise);
    api.getCatalog.mockReturnValueOnce(oldCatalog.promise);
    await mount();
    await authChange('user');
    await act(async () => {
      oldState.reject(new Error(SWITCH_ERROR_MESSAGES.credentials));
      oldCatalog.reject(new Error('sk-stale-secret'));
    });
    expect(message.error).not.toHaveBeenCalled();
    const pendingState = deferred(), pendingCatalog = deferred();
    api.getState.mockReturnValueOnce(pendingState.promise);
    api.getCatalog.mockReturnValueOnce(pendingCatalog.promise);
    await focus();
    await act(async () => root.unmount());
    await act(async () => {
      pendingState.reject(new Error(SWITCH_ERROR_MESSAGES.fileAccess));
      pendingCatalog.reject(new Error('sk-unmounted-secret'));
    });
    expect(message.error).not.toHaveBeenCalled();
    root = createRoot(host);
  });

  it('isolates StrictMode first-mount stale responses and retains the current catalog for explicit enable', async () => {
    const firstState = deferred(), firstCatalog = deferred();
    api.getState.mockReturnValueOnce(firstState.promise);
    api.getCatalog.mockReturnValueOnce(firstCatalog.promise);
    await mount(<React.StrictMode><SwitchSettings /></React.StrictMode>);
    expect(toolSwitch('codex').disabled).toBe(false);
    await act(async () => {
      firstState.resolve(makeState({ signedIn: false }));
      firstCatalog.resolve(makeCatalog({ models: [] }));
    });
    expect(host.textContent).not.toContain('请先登录');
    expect(toolSwitch('codex').disabled).toBe(false);
    expect(api.apply).not.toHaveBeenCalled();
    await clickSwitch('codex');
    expect(api.apply).toHaveBeenCalledExactlyOnceWith({ tool: 'codex', modelId: 'gpt-fixture-recommended' });
  });
});
