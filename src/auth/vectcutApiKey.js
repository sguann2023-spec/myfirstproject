import { getUserApiKey } from '../api/user';
import { electronStore } from '../shared/electronStore';
import { findCachedAccountApiKey, normalizeAccountApiKey, normalizeAccountUserId } from '../packages/shared/accountApiKey';

const inflightSessionRequests = new Map();
const RENDERER_ENV = import.meta.env || {};
const DEFAULT_CHANNEL_INVITE_CODE = String(RENDERER_ENV.RENDERER_VITE_AUTH_INVITE_CODE || '').trim();

export function getCurrentVectcutUserId() {
  // A leftover in-memory ID token must not resurrect a removed/signed-out account.
  return normalizeAccountUserId(electronStore.get('user')?.id);
}

const hasRefreshToken = (value) => typeof value === 'string' && Boolean(value.trim());
let observedUserId = getCurrentVectcutUserId();
let observedHasRefreshToken = hasRefreshToken(electronStore.get('auth.refresh_token'));
let sessionGeneration = 0;

function observeSession(userId, signedIn) {
  if (userId !== observedUserId || signedIn !== observedHasRefreshToken) {
    sessionGeneration += 1;
    observedUserId = userId;
    observedHasRefreshToken = signedIn;
  }
}

// Presence, rather than the refresh-token value, distinguishes sign-out from rotation.
// Observe events as well as reads so A -> signed-out/B -> A cannot reuse old work.
if (typeof electronStore.onDidChange === 'function') {
  electronStore.onDidChange('user', (user) => {
    observeSession(normalizeAccountUserId(user?.id), observedHasRefreshToken);
  });
  electronStore.onDidChange('auth.refresh_token', (refreshToken) => {
    observeSession(observedUserId, hasRefreshToken(refreshToken));
  });
}

export function getVectcutSessionSignature() {
  observeSession(getCurrentVectcutUserId(), hasRefreshToken(electronStore.get('auth.refresh_token')));
  return observedUserId && observedHasRefreshToken ? JSON.stringify([observedUserId, sessionGeneration]) : '';
}

export function getCachedVectcutApiKey() {
  if (!getVectcutSessionSignature()) return '';
  const user = electronStore.get('user') || {};
  return findCachedAccountApiKey([
    electronStore.get('auth.vectcut_api_key'),
    user.agentApiKey,
    user.vectcutApiKey,
    user.apiKey,
  ], getCurrentVectcutUserId());
}

export function persistVectcutApiKey(apiKey, expectedSessionSignature) {
  const currentSession = getVectcutSessionSignature();
  if (expectedSessionSignature !== undefined && (!expectedSessionSignature || expectedSessionSignature !== currentSession)) {
    return '';
  }

  if (!apiKey) {
    electronStore.delete('auth.vectcut_api_key');
    const currentUser = electronStore.get('user');
    if (currentUser && typeof currentUser === 'object' && 'agentApiKey' in currentUser) {
      const nextUser = { ...currentUser };
      delete nextUser.agentApiKey;
      electronStore.set('user', nextUser);
    }
    return '';
  }

  const normalizedApiKey = currentSession ? normalizeAccountApiKey(apiKey, getCurrentVectcutUserId()) : '';
  if (!normalizedApiKey) return '';

  if (electronStore.get('auth.vectcut_api_key') !== normalizedApiKey) {
    electronStore.set('auth.vectcut_api_key', normalizedApiKey);
  }
  // Recheck after a store notification before updating the user alias.
  if (getVectcutSessionSignature() !== currentSession) return '';
  const currentUser = electronStore.get('user');
  if (currentUser && currentUser.agentApiKey !== normalizedApiKey) {
    electronStore.set('user', { ...currentUser, agentApiKey: normalizedApiKey });
  }
  return getVectcutSessionSignature() === currentSession ? normalizedApiKey : '';
}

export async function ensureVectcutApiKeyForCurrentSession(options = {}) {
  const { force = false, invited_by_code = '' } = options;
  const sessionSignature = getVectcutSessionSignature();
  // Never return or promote any legacy cache when there is no signed-in account.
  if (!sessionSignature) {
    persistVectcutApiKey('');
    return '';
  }

  const cachedApiKey = force ? '' : getCachedVectcutApiKey();
  if (cachedApiKey) return persistVectcutApiKey(cachedApiKey, sessionSignature);
  if (inflightSessionRequests.has(sessionSignature)) return inflightSessionRequests.get(sessionSignature);

  const userId = getCurrentVectcutUserId();
  const invitedByCode = String(invited_by_code || DEFAULT_CHANNEL_INVITE_CODE).trim();
  const task = (async () => {
    try {
      const apiKey = await getUserApiKey(userId, 'authing', { invited_by_code: invitedByCode });
      if (getVectcutSessionSignature() !== sessionSignature) return '';
      const validatedKey = normalizeAccountApiKey(apiKey, userId);
      return validatedKey ? persistVectcutApiKey(validatedKey, sessionSignature) : '';
    } finally {
      inflightSessionRequests.delete(sessionSignature);
    }
  })();

  inflightSessionRequests.set(sessionSignature, task);
  return task;
}
