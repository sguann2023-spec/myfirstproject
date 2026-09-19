import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NetworkCheck from './NetworkCheck';
import zhCN from '@renderer/i18n/locales/zh-cn.json';
import enUS from '@renderer/i18n/locales/en-us.json';
import zhTW from '@renderer/i18n/locales/zh-tw.json';
import { tokenStore } from '../../../auth/tokenStore';

vi.mock('../../../auth/tokenStore', () => ({
  tokenStore: { ensureValidAccessToken: vi.fn() }
}));

vi.mock('antd', () => ({
  Modal: ({ title, children, onCancel }) => (
    <div role="dialog">{title}<button aria-label="Close" onClick={onCancel}>X</button>{children}</div>
  )
}));

const report = {
  checkedAt: '2026-09-19T07:00:00.000Z',
  endpoint: 'https://open.vectcut.com/llm/chat/healthy',
  host: 'open.vectcut.com:443',
  source: 'gateway',
  proxy: '',
  status: 'warning',
  checks: [{ id: 'http', status: 'warning', reason: 'http_reachable', value: 'HTTP 401', durationMs: 35 }]
};
let container, root, i18n, check;

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  check = vi.fn().mockResolvedValue(report);
  tokenStore.ensureValidAccessToken.mockReset().mockResolvedValue(null);
  window.electronAPI = { networkCheck: check };
  i18n = createInstance();
  await i18n.init({
    lng: 'zh-CN', fallbackLng: 'en-US',
    resources: {
      'zh-CN': { translation: zhCN },
      'en-US': { translation: enUS },
      'zh-TW': { translation: zhTW }
    }
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

async function render(onClose = vi.fn()) {
  await act(async () => root.render(
    <I18nextProvider i18n={i18n}><NetworkCheck modelId="provider:model" onClose={onClose} /></I18nextProvider>
  ));
}

describe('NetworkCheck', () => {
  it('checks immediately on open and displays real endpoint, status and timing', async () => {
    await render();
    expect(check).toHaveBeenCalledExactlyOnceWith({ modelId: 'provider:model', accessToken: undefined });
    const endpointRow = [...container.querySelectorAll('.network-check__row')]
      .find((item) => item.textContent.includes(zhCN.network_check.endpoint));
    expect(endpointRow.querySelector('.network-check__value').textContent).toBe('https://open.vectcut.com');
    expect(container.textContent).not.toContain('/llm/chat/healthy');
    expect(report.endpoint).toBe('https://open.vectcut.com/llm/chat/healthy');
    expect(container.textContent).toContain('HTTP 401  35 ms');
    expect(container.textContent).toContain(zhCN.network_check.summary.warning);
  });

  it('gets a valid login token before invoking the desktop check, without displaying it', async () => {
    tokenStore.ensureValidAccessToken.mockResolvedValueOnce('test.access.token');
    await render();
    expect(check).toHaveBeenCalledExactlyOnceWith({ modelId: 'provider:model', accessToken: 'test.access.token' });
    expect(container.textContent).not.toContain('test.access.token');
  });

  it('does not start a late probe if token refresh completes after timeout', async () => {
    vi.useFakeTimers();
    let finish;
    tokenStore.ensureValidAccessToken.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await render();
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    await act(async () => finish('late.access.token'));
    expect(check).not.toHaveBeenCalled();
    expect(container.textContent).toContain(zhCN.network_check.failed);
  });

  it('does not send a request if token refresh fails', async () => {
    tokenStore.ensureValidAccessToken.mockRejectedValueOnce(new Error('refresh failed'));
    await render();
    expect(check).not.toHaveBeenCalled();
    expect(container.textContent).toContain(zhCN.network_check.failed);
  });

  it('hides resolved IP addresses while retaining DNS timing and status', async () => {
    check.mockResolvedValueOnce({
      ...report,
      checks: [
        { id: 'dns', status: 'pass', reason: 'dns_ok', value: '192.0.2.1, 2001:db8::1', durationMs: 103 },
        ...report.checks
      ]
    });
    await render();
    const dnsRow = [...container.querySelectorAll('.network-check__row')]
      .find((item) => item.textContent.includes(zhCN.network_check.items.dns));
    expect(dnsRow.textContent).toContain('103 ms');
    expect(dnsRow.textContent).toContain(zhCN.network_check.status.pass);
    expect(container.textContent).not.toContain('192.0.2.1');
    expect(container.textContent).not.toContain('2001:db8::1');
    expect(container.textContent).toContain('HTTP 401  35 ms');
  });

  it('supports rerun and prevents duplicate checks while pending', async () => {
    let finish;
    check.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await render();
    const button = container.querySelector('.network-check__rerun');
    expect(button.disabled).toBe(true);
    await act(async () => button.click());
    expect(check).toHaveBeenCalledTimes(1);
    await act(async () => finish(report));
    await act(async () => button.click());
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('shows an honest unsupported state without the desktop bridge', async () => {
    window.electronAPI = undefined;
    await render();
    expect(container.querySelector('[role="alert"]').textContent).toContain(zhCN.network_check.unavailable);
    expect(container.textContent).not.toContain(report.endpoint);
  });

  it('reports failures without leaking raw IPC errors', async () => {
    check.mockRejectedValueOnce(new Error('secret token'));
    await render();
    expect(container.textContent).toContain(zhCN.network_check.failed);
    expect(container.textContent).not.toContain('secret token');
  });

  it('times out a stuck bridge request', async () => {
    vi.useFakeTimers();
    check.mockImplementationOnce(() => new Promise(() => {}));
    await render();
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(container.textContent).toContain(zhCN.network_check.failed);
    expect(container.querySelector('.network-check__rerun').disabled).toBe(false);
  });

  it('closes while detection is running', async () => {
    const close = vi.fn();
    check.mockImplementationOnce(() => new Promise(() => {}));
    await render(close);
    await act(async () => container.querySelector('[aria-label="Close"]').click());
    expect(close).toHaveBeenCalledOnce();
  });

  it.each([['en-US', enUS], ['zh-TW', zhTW]])('localizes result labels in %s', async (language, locale) => {
    await i18n.changeLanguage(language);
    await render();
    expect(container.textContent).toContain(locale.network_check.title);
    expect(container.textContent).toContain(locale.network_check.reasons.http_reachable);
    expect(container.textContent).not.toContain('network_check.');
  });
});
