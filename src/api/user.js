import { http } from '../http';
import { loggerService } from '@logger';
const logger = loggerService.withContext('ApiUser');
const BASE_URL = 'https://open.vectcut.com';

export async function addUser({
  id,
  name = '',
  avatar = '',
  creation_channel = 'client',
  invited_by_code = '',
}) {
  const payload = { user_id: id, name, avatar, creation_channel };
  if (typeof invited_by_code === 'string' && invited_by_code.trim()) {
    payload.invited_by_code = invited_by_code.trim();
  }
  try {
    return await http.postJson(`${BASE_URL}/user_manager/add_user`, payload);
  } catch (err) {
    // 不影响登录流程，记录一下即可
    logger.warn('add_user failed:', err.data || err.message);
    return null;
  }
}

export async function updateLoginTime(userId) {
  const payload = {user_id: userId};
  try {
    return await http.postJson(`${BASE_URL}/user_manager/update_login_time`, payload);
  } catch (err) {
    logger.warn('update_login_time failed:', err.data || err.message);
    return null;
  }
}

export async function getUserPoints(userId) {
  try {
    return await http.getJson(
      `${BASE_URL}/user_manager/get_user_points?user_id=${userId}`
    );
  } catch (err) {
    logger.warn('get_user_points failed:', err.data || err.message);
    return null;
  }
}

export async function getUserApiKey(userId, loginType = 'authing') {
  const payload = { user_id: String(userId || '').trim(), login_type: loginType };
  if (!payload.user_id) {
    return '';
  }

  try {
    const data = await http.postJson(`${BASE_URL}/user_manager/get_token`, payload);
    const apiKey = data?.token || data?.api_key || '';
    return String(apiKey || '').trim();
  } catch (err) {
    logger.warn('get_token failed:', err.data || err.message);
    return '';
  }
}

export async function getUserProfile() {
  try {
    return await http.getJson(`${BASE_URL}/user_manager/profile`);
  } catch (err) {
    logger.warn('get_user_profile failed:', err.data || err.message);
    return null;
  }
}

export async function updateUserProfile({ name, avatar } = {}) {
  const payload = {};
  if (typeof name !== 'undefined') {
    payload.name = name;
  }
  if (typeof avatar !== 'undefined') {
    payload.avatar = avatar;
  }

  try {
    return await http.postJson(`${BASE_URL}/user_manager/profile`, payload);
  } catch (err) {
    logger.warn('update_user_profile failed:', err.data || err.message);
    throw err;
  }
}
