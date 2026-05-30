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
