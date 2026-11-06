// Keep only event metadata, never player state. Runtime ownership is mandatory.
export const normalizePinnedAudio = (payload) => {
  const id = typeof payload?.id === 'string' ? payload.id.trim() : '';
  const runtimeSessionId = typeof payload?.runtimeSessionId === 'string' ? payload.runtimeSessionId.trim() : '';
  const audioUrl = typeof payload?.audioUrl === 'string' ? payload.audioUrl.trim() : '';
  if (!id || !runtimeSessionId || !audioUrl || payload.status !== 'completed'
    || typeof payload.createdAt !== 'number' || !Number.isFinite(payload.createdAt)) return null;
  const audio = { id, runtimeSessionId, audioUrl, createdAt: payload.createdAt, status: 'completed' };
  if (typeof payload.durationSeconds === 'number' && Number.isFinite(payload.durationSeconds) && payload.durationSeconds > 0) {
    audio.durationSeconds = payload.durationSeconds;
  }
  if (typeof payload.text === 'string' && payload.text.trim()) audio.text = payload.text.trim();
  if (payload.billing && typeof payload.billing === 'object' && !Array.isArray(payload.billing)) audio.billing = payload.billing;
  return audio;
};

export const normalizePinnedAudios = (audios, runtimeSessionId) => {
  const result = [];
  for (const value of Array.isArray(audios) ? audios : []) {
    const audio = normalizePinnedAudio(value);
    if (!audio || (runtimeSessionId !== undefined && audio.runtimeSessionId !== runtimeSessionId)) continue;
    const index = result.findIndex((item) => item.id === audio.id && item.runtimeSessionId === audio.runtimeSessionId);
    if (index < 0) result.push(audio);
    else if (audio.createdAt >= result[index].createdAt) result[index] = audio;
  }
  return result;
};

export const mergePinnedAudio = (audios, payload) => {
  const audio = normalizePinnedAudio(payload);
  if (!audio) return normalizePinnedAudios(audios);
  const current = normalizePinnedAudios(audios, audio.runtimeSessionId);
  const index = current.findIndex((item) => item.id === audio.id);
  if (index < 0) return [audio, ...current];
  if (audio.createdAt < current[index].createdAt) return current;
  return current.map((item, i) => i === index ? { ...item, ...audio } : item);
};

export const resolvePinnedAudioEvent = (payload, chatIdByRuntimeId) => {
  const audio = normalizePinnedAudio(payload);
  const chatId = audio && chatIdByRuntimeId.get(audio.runtimeSessionId);
  return chatId ? { chatId, audio } : null;
};

export const pinnedAudioToOutput = (audio) => ({
  status: 'completed',
  audio_url: audio.audioUrl,
  ...(audio.durationSeconds != null ? { duration_seconds: audio.durationSeconds } : {}),
  ...(audio.billing != null ? { billing: audio.billing } : {})
});
