import { authFetch } from '../auth/authFetch';
import { tokenStore } from '../auth'; // 统一从 index 导入
import logger from '../shared/logger';

let authFailureHandler = null;

/**
 * 在应用初始化处设置刷新失败后的处理，比如打开登录页
 */
export function setAuthFailureHandler(handler) {
  authFailureHandler = handler;
}

async function request(url, options = {}, retryOn401 = true) {
  // 首次请求（会自动附加 access_token）
  let res = await authFetch(url, options);

  // 非 401 或400 或不重试，直接返回
  if ((res.status !== 401 && res.status !== 400) || !retryOn401) return res;

  // 强制刷新一次并重试
  try {
    await tokenStore.refreshAccessToken();
  } catch (err) {
    // 刷新失败：清理并通知外部打开登录页
    logger.debug('Token refresh failed:', err);
    tokenStore.signOut();
    if (authFailureHandler) authFailureHandler(err);
    throw err;
  }

  const retryRes = await authFetch(url, options);
  if (retryRes.status === 401 || retryRes.status === 400) {
    // 刷新后仍 401，则通知登录
    if (authFailureHandler) authFailureHandler(new Error('Unauthorized after refresh'));
  }
  return retryRes;
}

async function requestJson(url, options = {}, retryOn401 = true) {
  const res = await request(url, options, retryOn401);
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();

  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const http = {
  setAuthFailureHandler,
  request,
  json: requestJson,

  get: (url, options = {}) => request(url, { ...options, method: 'GET' }),
  getJson: (url, options = {}) => requestJson(url, { ...options, method: 'GET' }),

  post: (url, body, options = {}) =>
    request(url, {
      ...options,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      body: body != null ? JSON.stringify(body) : undefined,
    }),
  postJson: (url, body, options = {}) =>
    requestJson(url, {
      ...options,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      body: body != null ? JSON.stringify(body) : undefined,
    }),

  put: (url, body, options = {}) =>
    request(url, {
      ...options,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      body: body != null ? JSON.stringify(body) : undefined,
    }),
  delete: (url, options = {}) => request(url, { ...options, method: 'DELETE' }),
};