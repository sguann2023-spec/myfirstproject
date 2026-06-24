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

export async function getMyVoiceLibrary({
  limit = 24,
  offset = 0,
  keyword,
  provider,
} = {}) {
  const params = {
    limit: String(limit),
    offset: String(offset),
  };

  if (keyword) params.keyword = String(keyword);
  if (provider) params.provider = String(provider);

  const qs = new URLSearchParams(params).toString();
  return http.getJson(`${BASE_URL}/llm/tts/my_voice_library?${qs}`);
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

export async function updateMyVoiceProfile(payload = {}) {
  return http.postJson(`${BASE_URL}/llm/tts/my_voice_library/profile`, payload);
}

export async function getTtsSpeechPrice({
  provider,
  voice_id,
  model,
} = {}) {
  const params = {};
  const normalizedVoiceId = Array.isArray(voice_id)
    ? voice_id.map((item) => String(item || '').trim()).filter(Boolean).join(',')
    : String(voice_id || '').trim();

  if (provider) params.provider = String(provider);
  if (normalizedVoiceId) params.voice_id = normalizedVoiceId;
  if (model) params.model = String(model);

  const qs = new URLSearchParams(params).toString();
  return http.getJson(`${BASE_URL}/llm/tts/speech_price${qs ? `?${qs}` : ''}`);
}

export async function getTtsClonePrice({
  provider,
} = {}) {
  const params = {};

  if (provider) params.provider = String(provider);

  const qs = new URLSearchParams(params).toString();
  return http.getJson(`${BASE_URL}/llm/tts/clone_price${qs ? `?${qs}` : ''}`);
}

export async function cloneTtsVoiceWithFish({
  file_url,
  title,
} = {}) {
  return http.postJson(`${BASE_URL}/llm/tts/fish/clone_voice`, {
    file_url,
    title,
  });
}

export async function cloneTtsVoiceWithMinimax({
  file_url,
  title,
} = {}) {
  return http.postJson(`${BASE_URL}/llm/tts/minimax/clone_voice`, {
    file_url,
    title,
  });
}

export async function cloneTtsVoiceWithElevenlabs({
  file_url,
  file_urls,
  title,
  description,
  labels,
  remove_background_noise,
} = {}) {
  return http.postJson(`${BASE_URL}/llm/tts/elevenlabs/clone_voice`, {
    file_url,
    file_urls,
    title,
    description,
    labels,
    remove_background_noise,
  });
}

export async function deleteMyTtsVoice({
  provider,
  voice_id,
  global_voice_id,
} = {}) {
  const normalizedProvider = String(provider || '').trim().toLowerCase();
  const normalizedVoiceId = String(voice_id || global_voice_id || '').trim();
  let routePath = '';

  if (normalizedProvider === 'elevenlabs') routePath = 'elevenlabs/delete_voice';
  if (normalizedProvider === 'fish') routePath = 'fish/delete_voice';
  if (normalizedProvider === 'minimax') routePath = 'minimax/delete_voice';

  if (!routePath) {
    throw new Error('暂不支持删除该音色');
  }

  return http.postJson(`${BASE_URL}/llm/tts/${routePath}`, {
    voice_id: normalizedVoiceId,
    global_voice_id: normalizedVoiceId,
  });
}
