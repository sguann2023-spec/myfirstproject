import { http } from '../http';

const BASE_URL = 'https://open.vectcut.com/digital_human';

export async function getDigitalHumanAvatarExamples() {
  return http.getJson(`${BASE_URL}/avatar/example`);
}

export async function createDigitalHumanAvatarLibrary({
  title = '',
  cover_url = '',
  demo_url = '',
  voice_id = '',
} = {}) {
  return http.postJson(`${BASE_URL}/avatar/library`, {
    title,
    cover_url,
    demo_url,
    voice_id,
  });
}

export async function deleteDigitalHumanAvatarLibrary(avatarId = '') {
  const normalizedAvatarId = String(avatarId || '').trim();
  if (!normalizedAvatarId) {
    throw new Error('MISSING_AVATAR_ID');
  }

  return http.delete(`${BASE_URL}/avatar/library/${normalizedAvatarId}`);
}
