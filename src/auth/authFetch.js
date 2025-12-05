import { tokenStore } from './tokenStore';

export async function authFetch(input, init = {}) {
  const token = await tokenStore.ensureValidAccessToken();
  const headers = new Headers(init.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}