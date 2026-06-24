import { getUserApiKey } from '../api/user';
import { electronStore } from '../shared/electronStore';
import { tokenStore } from './tokenStore';
import { loggerService } from '@logger';

const logger = loggerService.withContext('VectcutApiKey');
const inflightSessionRequests = new Map();

function parseJwt(token) {
  try {
    const base64Url = String(token || '').split('.')[1];
    if (!base64Url) return null;
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const normalized = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    return JSON.parse(Buffer.from(normalized, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

export function getCurrentVectcutUserId() {
  const storedUserId = String(electronStore.get('user')?.id || '').trim();
  if (storedUserId) {
    return storedUserId;
  }
  const claims = parseJwt(tokenStore.idToken);
  return String(claims?.sub || '').trim();
}

export function getCachedVectcutApiKey() {
  const user = electronStore.get('user') || {};
  const candidates = [
    electronStore.get('auth.vectcut_api_key'),
    user.agentApiKey,
    user.vectcutApiKey,
    user.apiKey,
  ];
  const hit = candidates.find((item) => typeof item === 'string' && item.trim());
  return hit ? hit.trim() : '';
}

export function getVectcutSessionSignature() {
  const refreshToken = String(electronStore.get('auth.refresh_token') || '').trim();
  const userId = getCurrentVectcutUserId();
  if (!refreshToken || !userId) {
    return '';
  }
  return `${userId}:${refreshToken}`;
}

export function persistVectcutApiKey(apiKey) {
  const normalizedApiKey = String(apiKey || '').trim();
  if (!normalizedApiKey) {
    electronStore.delete('auth.vectcut_api_key');
    const currentUser = electronStore.get('user');
    if (currentUser && typeof currentUser === 'object' && 'agentApiKey' in currentUser) {
      const nextUser = { ...currentUser };
      delete nextUser.agentApiKey;
      electronStore.set('user', nextUser);
    }
    return '';
  }

  electronStore.set('auth.vectcut_api_key', normalizedApiKey);
  const currentUser = electronStore.get('user');
  if (currentUser && typeof currentUser === 'object') {
    electronStore.set('user', {
      ...currentUser,
      agentApiKey: normalizedApiKey,
    });
  }
  return normalizedApiKey;
}

export async function ensureVectcutApiKeyForCurrentSession(options = {}) {
  const { force = false } = options;
  const sessionSignature = getVectcutSessionSignature();
  const cachedApiKey = force ? '' : getCachedVectcutApiKey();

  if (cachedApiKey) {
    persistVectcutApiKey(cachedApiKey);
    return cachedApiKey;
  }

  if (!sessionSignature) {
    persistVectcutApiKey('');
    return '';
  }

  if (inflightSessionRequests.has(sessionSignature)) {
    return inflightSessionRequests.get(sessionSignature);
  }

  const userId = getCurrentVectcutUserId();
  const task = (async () => {
    try {
      const apiKey = await getUserApiKey(userId);
      return persistVectcutApiKey(apiKey);
    } catch (error) {
      logger.warn('Failed to fetch vectcut api key.', error);
      throw error;
    } finally {
      inflightSessionRequests.delete(sessionSignature);
    }
  })();

  inflightSessionRequests.set(sessionSignature, task);
  return task;
}
