import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  values: new Map(),
  listeners: new Map(),
  set: vi.fn(),
  delete: vi.fn(),
  getUserApiKey: vi.fn(),
}));

vi.mock('../shared/electronStore', () => ({
  electronStore: {
    get: (key) => mocks.values.get(key),
    set: (key, value) => {
      mocks.set(key, value);
      const previous = mocks.values.get(key);
      mocks.values.set(key, value);
      if (previous !== value) mocks.listeners.get(key)?.forEach((listener) => listener(value));
    },
    delete: (key) => {
      mocks.delete(key);
      mocks.values.delete(key);
      mocks.listeners.get(key)?.forEach((listener) => listener(undefined));
    },
    onDidChange: (key, callback) => {
      if (!mocks.listeners.has(key)) mocks.listeners.set(key, new Set());
      mocks.listeners.get(key).add(callback);
      return () => mocks.listeners.get(key)?.delete(callback);
    },
  },
}));
vi.mock('../api/user', () => ({ getUserApiKey: mocks.getUserApiKey }));

function jwt(sub = 'user-a', extra = {}) {
  return `${Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub, iat: 0, ...extra })).toString('base64url')}.c2lnbmF0dXJl`;
}
function change(key, value) {
  mocks.values.set(key, value);
  mocks.listeners.get(key)?.forEach((listener) => listener(value));
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

let auth;
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.values.clear();
  mocks.listeners.clear();
  mocks.values.set('user', { id: 'user-a' });
  mocks.values.set('auth.refresh_token', 'refresh-a');
  mocks.getUserApiKey.mockReset().mockResolvedValue(jwt());
  auth = await import('./vectcutApiKey');
});

describe('renderer long-lived account API keys', () => {
  it('rejects expired/OAuth/unowned cache entries and fetches the authoritative key', async () => {
    mocks.values.set('auth.vectcut_api_key', jwt('user-a', { exp: 9999999999 }));
    mocks.values.set('user', { id: 'user-a', agentApiKey: 'oauth', vectcutApiKey: jwt('user-b') });
    expect(auth.getCachedVectcutApiKey()).toBe('');
    expect(await auth.ensureVectcutApiKeyForCurrentSession({ invited_by_code: ' INVITE ' })).toBe(jwt());
    expect(mocks.getUserApiKey).toHaveBeenCalledExactlyOnceWith('user-a', 'authing', { invited_by_code: 'INVITE' });
    expect(mocks.values.get('auth.vectcut_api_key')).toBe(jwt());
    expect(mocks.values.get('user').agentApiKey).toBe(jwt());
  });

  it.each(['agentApiKey', 'vectcutApiKey', 'apiKey'])('accepts valid user-bound legacy %s without fetching', async (alias) => {
    mocks.values.set('auth.vectcut_api_key', 'oauth');
    mocks.values.set('user', { id: 'user-a', [alias]: jwt() });
    expect(auth.getCachedVectcutApiKey()).toBe(jwt());
    expect(await auth.ensureVectcutApiKeyForCurrentSession()).toBe(jwt());
    expect(mocks.getUserApiKey).not.toHaveBeenCalled();
  });

  it.each(['missing user', 'missing refresh token'])('never returns or persists cache for %s', async (scenario) => {
    mocks.values.set('auth.vectcut_api_key', jwt());
    mocks.values.set('user', scenario === 'missing user' ? undefined : { id: 'user-a', agentApiKey: jwt() });
    if (scenario === 'missing refresh token') change('auth.refresh_token', undefined);
    expect(auth.getCachedVectcutApiKey()).toBe('');
    expect(auth.persistVectcutApiKey(jwt())).toBe('');
    expect(await auth.ensureVectcutApiKeyForCurrentSession()).toBe('');
    expect(mocks.values.get('auth.vectcut_api_key')).toBeUndefined();
    expect(mocks.getUserApiKey).not.toHaveBeenCalled();
  });

  it.each(['oauth', jwt('user-b'), jwt('user-a', { exp: null }), null])('will not persist an invalid credential (%s)', (key) => {
    expect(auth.persistVectcutApiKey(key)).toBe('');
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it('does not rewrite identical cache or user values and trigger store feedback loops', () => {
    mocks.values.set('auth.vectcut_api_key', jwt());
    mocks.values.set('user', { id: 'user-a', agentApiKey: jwt() });
    expect(auth.persistVectcutApiKey(jwt())).toBe(jwt());
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it('force refresh keeps an existing valid cache if the endpoint returns an invalid credential', async () => {
    mocks.values.set('auth.vectcut_api_key', jwt());
    mocks.getUserApiKey.mockResolvedValue('oauth');
    expect(await auth.ensureVectcutApiKeyForCurrentSession({ force: true })).toBe('');
    expect(mocks.values.get('auth.vectcut_api_key')).toBe(jwt());
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it('rejects a returned key for another user without persisting', async () => {
    mocks.getUserApiKey.mockResolvedValue(jwt('user-b'));
    expect(await auth.ensureVectcutApiKeyForCurrentSession()).toBe('');
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it('deduplicates inflight work across normal refresh-token rotation', async () => {
    const waiting = deferred();
    mocks.getUserApiKey.mockReturnValue(waiting.promise);
    const signature = auth.getVectcutSessionSignature();
    expect(signature).not.toContain('refresh-a');
    const first = auth.ensureVectcutApiKeyForCurrentSession();
    change('auth.refresh_token', 'refresh-a-rotated');
    change('user', { id: 'user-a', name: 'updated' });
    expect(auth.getVectcutSessionSignature()).toBe(signature);
    const second = auth.ensureVectcutApiKeyForCurrentSession();
    waiting.resolve(jwt());
    expect(await first).toBe(jwt());
    expect(await second).toBe(jwt());
    expect(mocks.getUserApiKey).toHaveBeenCalledTimes(1);
  });

  it.each(['switch', 'sign-out', 'switch-and-back', 'sign-out-and-back'])('discards stale async work on %s', async (scenario) => {
    const waiting = deferred();
    mocks.getUserApiKey.mockReturnValue(waiting.promise);
    const signature = auth.getVectcutSessionSignature();
    const pending = auth.ensureVectcutApiKeyForCurrentSession();
    if (scenario.startsWith('switch')) {
      change('user', { id: 'user-b' });
      if (scenario.endsWith('back')) change('user', { id: 'user-a' });
    } else {
      change('auth.refresh_token', undefined);
      if (scenario.endsWith('back')) change('auth.refresh_token', 'new-login-refresh');
    }
    waiting.resolve(jwt());
    expect(await pending).toBe('');
    expect(auth.persistVectcutApiKey(jwt(), signature)).toBe('');
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it('does not let an old response overwrite the new account cache', async () => {
    const waiting = deferred();
    mocks.getUserApiKey.mockReturnValueOnce(waiting.promise).mockResolvedValueOnce(jwt('user-b'));
    const oldRequest = auth.ensureVectcutApiKeyForCurrentSession();
    change('user', { id: 'user-b' });
    change('auth.refresh_token', 'refresh-b');
    expect(await auth.ensureVectcutApiKeyForCurrentSession()).toBe(jwt('user-b'));
    waiting.resolve(jwt());
    expect(await oldRequest).toBe('');
    expect(mocks.values.get('auth.vectcut_api_key')).toBe(jwt('user-b'));
    expect(mocks.values.get('user')).toEqual({ id: 'user-b', agentApiKey: jwt('user-b') });
  });
});
