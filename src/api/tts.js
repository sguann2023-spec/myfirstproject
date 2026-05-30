import { http } from '../http';

const BASE_URL = 'https://open.vectcut.com';

export async function getVoiceLibrary({
  sort_type = 'recommend',
  only_active = true,
  limit = 24,
  offset = 24,
} = {}) {
  const qs = new URLSearchParams({
    sort_type: String(sort_type),
    only_active: String(only_active),
    limit: String(limit),
    offset: String(offset),
  }).toString();

  return http.getJson(`${BASE_URL}/llm/tts/voice_library?${qs}`);
}

export async function getVoiceFavoritesLibrary({
  limit = 24,
  offset = 0,
} = {}) {
  const qs = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  }).toString();

  return http.getJson(`${BASE_URL}/llm/tts/voice_favorites/library?${qs}`);
}

export async function getVoiceFavoriteIds(globalVoiceIds = []) {
  const normalizedIds = Array.isArray(globalVoiceIds)
    ? globalVoiceIds.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const qs = new URLSearchParams({
    global_voice_ids: normalizedIds.join(','),
  }).toString();

  return http.getJson(`${BASE_URL}/llm/tts/voice_favorites/ids?${qs}`);
}

export async function addVoiceFavorite(globalVoiceId) {
  return http.postJson(`${BASE_URL}/llm/tts/voice_favorites`, {
    global_voice_id: String(globalVoiceId || '').trim(),
  });
}

export async function removeVoiceFavorite(globalVoiceId) {
  return http.postJson(`${BASE_URL}/llm/tts/voice_favorites/remove`, {
    global_voice_id: String(globalVoiceId || '').trim(),
  });
}
