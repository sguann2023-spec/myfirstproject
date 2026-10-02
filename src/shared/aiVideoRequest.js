const normalizeNumber = (value, fallback = null) => {
  if (value === null || value === undefined || value === '') return fallback;
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : fallback;
};

const normalizeContentItem = (item = {}) => {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const type = String(item.type || '').trim();
  if (type === 'text') {
    const text = String(item.text || '').trim();
    return text ? { type: 'text', text } : null;
  }

  const mediaField = type === 'image_url' ? 'image_url'
    : type === 'video_url' ? 'video_url'
      : type === 'audio_url' ? 'audio_url' : '';
  if (!mediaField) return null;

  const rawMedia = item[mediaField];
  const url = typeof rawMedia === 'string'
    ? rawMedia.trim()
    : String(rawMedia?.url || '').trim();
  if (!url) return null;

  return {
    type,
    [mediaField]: { url },
    ...(String(item.role || '').trim() ? { role: String(item.role).trim() } : {}),
  };
};

export const normalizeAiVideoRequestPayload = (aiVideoRequest = {}, fallbackPrompt = '') => {
  if (!aiVideoRequest || typeof aiVideoRequest !== 'object') return null;
  const prompt = String(aiVideoRequest.prompt || fallbackPrompt || '').trim();
  const model = String(aiVideoRequest.model || '').trim();
  const resolution = String(aiVideoRequest.resolution || '').trim();
  const content = Array.isArray(aiVideoRequest.content)
    ? aiVideoRequest.content.map(normalizeContentItem).filter(Boolean)
    : [];

  const hasTextContent = content.some((item) => item.type === 'text' && String(item.text || '').trim());
  if (!hasTextContent && prompt) content.unshift({ type: 'text', text: prompt });
  if (!content.length) return null;

  const payload = {
    ...(model ? { model } : {}),
    ...(resolution ? { resolution } : {}),
    content,
  };

  const genDuration = normalizeNumber(aiVideoRequest.gen_duration ?? aiVideoRequest.genDuration, null);
  if (genDuration !== null) payload.gen_duration = genDuration;
  if (typeof aiVideoRequest.generate_audio === 'boolean') payload.generate_audio = aiVideoRequest.generate_audio;
  else if (typeof aiVideoRequest.generateAudio === 'boolean') payload.generate_audio = aiVideoRequest.generateAudio;
  if (typeof aiVideoRequest.super_resolve === 'boolean') payload.super_resolve = aiVideoRequest.super_resolve;
  else if (typeof aiVideoRequest.superResolve === 'boolean') payload.super_resolve = aiVideoRequest.superResolve;
  if (typeof aiVideoRequest.enable_seedance_offline === 'boolean') payload.enable_seedance_offline = aiVideoRequest.enable_seedance_offline;
  else if (typeof aiVideoRequest.enableSeedanceOffline === 'boolean') payload.enable_seedance_offline = aiVideoRequest.enableSeedanceOffline;

  return payload;
};
