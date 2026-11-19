// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: { id: 'user-a', name: 'A' },
  signature: 'session-a',
  cache: '',
  listeners: new Map(),
  ensure: vi.fn(),
  persist: vi.fn(),
  set: vi.fn(),
  clipboard: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('../../shared/electronStore', () => ({
  electronStore: {
    get: (key) => key === 'user' ? mocks.user : undefined,
    set: mocks.set,
    onDidChange: (key, callback) => {
      if (!mocks.listeners.has(key)) mocks.listeners.set(key, new Set());
      mocks.listeners.get(key).add(callback);
      return () => mocks.listeners.get(key)?.delete(callback);
    },
  },
}));
vi.mock('../../auth/vectcutApiKey', () => ({
  ensureVectcutApiKeyForCurrentSession: mocks.ensure,
  getCachedVectcutApiKey: () => mocks.cache,
  getCurrentVectcutUserId: () => mocks.user?.id || '',
  getVectcutSessionSignature: () => mocks.signature,
  persistVectcutApiKey: mocks.persist,
}));
vi.mock('../DailyCheckin/useDailyCheckin', () => ({ default: () => ({ reward: null, claiming: false, claim: vi.fn() }) }));
vi.mock('../../api/membership', () => ({ getMembershipSummary: vi.fn().mockResolvedValue({}) }));
vi.mock('../../api/user', () => ({
  getInviteQualification: vi.fn().mockResolvedValue({ eligible: false }),
  getInviteRebateSummary: vi.fn(),
  getInviteStats: vi.fn(),
  getUserProfile: vi.fn().mockResolvedValue(null),
  transferInviteRebateToWallet: vi.fn(),
  updateUserProfile: vi.fn(),
}));
vi.mock('../../api/sts', () => ({ uploadUserAvatar: vi.fn() }));
vi.mock('@renderer/utils/api', () => ({ maskApiKey: (key) => `masked-${key}` }));
vi.mock('@ant-design/icons', () => ({ ExclamationCircleOutlined: () => null, LoadingOutlined: () => null, UserOutlined: () => null }));
vi.mock('lucide-react', () => ({ Pencil: () => null, QrCode: () => null, SquarePen: () => null, User: () => null }));
vi.mock('qrcode.react', () => ({ QRCodeCanvas: () => null }));
vi.mock('antd-img-crop', () => ({ default: ({ children }) => children }));
vi.mock('antd', async () => {
  const React = await import('react');
  const Wrapper = ({ children }) => React.createElement('span', null, children);
  return {
    Avatar: () => null,
    Input: Object.assign(() => null, { TextArea: () => null }),
    Modal: () => null,
    Tooltip: Wrapper,
    Typography: { Text: Wrapper },
    Upload: Wrapper,
    message: { warning: mocks.warning, success: vi.fn(), error: vi.fn() },
  };
});

import AccountSecurity from './AccountSecurity';

let root;
let container;
function emit(key, value) { mocks.listeners.get(key)?.forEach((callback) => callback(value)); }
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
function apiButton() { return container.querySelector('.account-security-value--api-key'); }
async function mount() { await act(async () => root.render(<AccountSecurity />)); }

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listeners.clear();
  mocks.user = { id: 'user-a', name: 'A' };
  mocks.signature = 'session-a';
  mocks.cache = '';
  mocks.ensure.mockReset().mockResolvedValue('');
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: mocks.clipboard } });
  mocks.clipboard.mockResolvedValue(undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

it('does not display an old async key after the active account changes', async () => {
  const oldRequest = deferred();
  mocks.ensure.mockReturnValueOnce(oldRequest.promise);
  await mount();
  expect(apiButton().textContent).toContain('正在同步');
  await act(async () => {
    mocks.user = { id: 'user-b', name: 'B' };
    mocks.signature = 'session-b';
    mocks.cache = 'key-b';
    emit('user', mocks.user);
  });
  expect(apiButton().textContent).toBe('masked-key-b');
  await act(async () => oldRequest.resolve('key-a'));
  expect(apiButton().textContent).toBe('masked-key-b');
});

it('does not display raw polluted auth-store values', async () => {
  mocks.cache = 'key-a';
  await mount();
  await act(async () => emit('auth.vectcut_api_key', 'oauth-access-token'));
  expect(apiButton().textContent).toBe('masked-key-a');
  expect(apiButton().textContent).not.toContain('oauth');
});

it('revalidates the current key and session at copy time instead of copying stale React state', async () => {
  mocks.cache = 'key-a';
  await mount();
  mocks.signature = 'session-b';
  mocks.cache = 'key-b';
  await act(async () => apiButton().click());
  expect(mocks.clipboard).not.toHaveBeenCalled();
  expect(mocks.warning).toHaveBeenCalled();
});

it('copies a valid current key and handles an unavailable fetch without an unhandled rejection', async () => {
  mocks.ensure.mockRejectedValueOnce(new Error('fetch failed'));
  await mount();
  expect(apiButton().textContent).toContain('未获取到 API KEY');
  await act(async () => {
    mocks.cache = 'key-a';
    emit('auth.vectcut_api_key', 'key-a');
  });
  await act(async () => apiButton().click());
  expect(mocks.clipboard).toHaveBeenCalledExactlyOnceWith('key-a');
});
