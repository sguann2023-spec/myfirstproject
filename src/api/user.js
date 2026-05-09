import { http } from '../http';
import { loggerService } from '@logger';
const logger = loggerService.withContext('ApiUser');
const BASE_URL = 'https://open.vectcut.com';

export async function addUser({ id, name = '', avatar = '', creation_channel = 'client' }) {
  const payload = { user_id: id, name, avatar, creation_channel };
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