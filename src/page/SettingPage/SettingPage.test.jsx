import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SettingPage from './SettingPage';

vi.mock('../../components/ModelSettings/ModelSettings', () => ({ default: function ModelSettingsDraft() {
  const [draft, setDraft] = React.useState('');
  return <div data-testid="models"><input aria-label="Model draft" value={draft} onChange={event => setDraft(event.target.value)} /></div>;
} }));
vi.mock('../../components/GeneralSettings/GeneralSettings', () => ({ default: () => <div>General</div> }));
vi.mock('../../components/HelpSettings/HelpSettings', () => ({ default: () => <div>Help</div> }));
vi.mock('../../components/AccountSecurity/AccountSecurity', () => ({ default: () => <div>Account</div> }));
vi.mock('../../components/AboutUs/AboutUs', () => ({ default: () => <div>About</div> }));
vi.mock('../../components/PolicyAgreement/PolicyAgreement', () => ({ default: () => <div>Policy</div> }));

let root, container, ipc, navigate;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
  ipc = { on: vi.fn((_channel, listener) => { navigate = listener; }), removeListener: vi.fn() };
  window.require = vi.fn(() => ({ ipcRenderer: ipc }));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); window.history.replaceState({}, '', '/');
  delete window.require; delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});
const header = () => container.querySelector('.setting-content-header').textContent;
it('opens the lazy models tab from the URL and responds to navigation events', async () => {
  window.history.replaceState({}, '', '/?view=settings&tab=models');
  await act(async () => root.render(<SettingPage />));
  expect(header()).toBe('模型设置');
  expect(container.querySelector('[data-testid="models"]')).not.toBeNull();
  expect(ipc.on).toHaveBeenCalledWith('settings:navigate', navigate);
  await act(async () => navigate({}, { tab: 'general' }));
  expect(header()).toBe('通用');
  await act(async () => navigate({}, { tab: '../evil' }));
  expect(header()).toBe('通用');
  await act(async () => navigate({}, { tab: 'models' }));
  expect(header()).toBe('模型设置');
  await act(async () => root.unmount());
  expect(ipc.removeListener).toHaveBeenCalledWith('settings:navigate', navigate);
});
it('rejects unknown URL tabs and defaults to account security', async () => {
  window.history.replaceState({}, '', '/?tab=unknown');
  await act(async () => root.render(<SettingPage />));
  expect(header()).toBe('账号与安全');
});
it('mounts models only after visiting and preserves its draft across sidebar and IPC navigation', async () => {
  await act(async () => root.render(<SettingPage />));
  expect(container.querySelector('[data-testid="models"]')).toBeNull();
  const select = async title => {
    const menu = [...container.querySelectorAll('.setting-menu-item')].find(item => item.textContent === title);
    await act(async () => menu.click());
  };
  await select('模型设置');
  expect(header()).toBe('模型设置');
  const models = container.querySelector('[data-testid="models"]');
  const input = models.querySelector('input');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'unsaved model draft');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await select('通用');
  expect(models.closest('[hidden]')).not.toBeNull();
  expect(container.querySelector('[data-testid="models"]')).toBe(models);
  await act(async () => navigate({}, { tab: 'models' }));
  expect(header()).toBe('模型设置');
  expect(models.closest('[hidden]')).toBeNull();
  expect(models.querySelector('input')).toBe(input);
  expect(input.value).toBe('unsaved model draft');
  // Force a child rerender to ensure the value lives in React state, not only the DOM.
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'continued draft');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => navigate({}, { tab: 'help' }));
  expect(models.closest('[hidden]')).not.toBeNull();
  await select('模型设置');
  expect(container.querySelector('[data-testid="models"]')).toBe(models);
  expect(input.value).toBe('continued draft');
});
