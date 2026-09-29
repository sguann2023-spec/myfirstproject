const normalizeNumber = (value, fallback = null) => {
  if (value === null || value === undefined || value === '') return fallback;
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : fallback;
};

export const normalizeAudioAddRequestPayload = (audioAddRequest = {}) => {
  if (!audioAddRequest || typeof audioAddRequest !== 'object') return null;
  const draftId = String(audioAddRequest.draft_id || audioAddRequest.draftId || '').trim();
  const audioUrl = String(audioAddRequest.audio_url || audioAddRequest.audioUrl || '').trim();
  const musicId = String(audioAddRequest.music_id || audioAddRequest.musicId || '').trim();
  if (!draftId || (!audioUrl && !musicId)) return null;

  const numberFields = [
    ['target_start', audioAddRequest.target_start ?? audioAddRequest.targetStart],
    ['start', audioAddRequest.start],
    ['end', audioAddRequest.end],
    ['duration', audioAddRequest.duration],
    ['volume', audioAddRequest.volume],
    ['speed', audioAddRequest.speed],
    ['fade_in_duration', audioAddRequest.fade_in_duration ?? audioAddRequest.fadeInDuration],
    ['fade_out_duratioin', audioAddRequest.fade_out_duratioin ?? audioAddRequest.fade_out_duration ?? audioAddRequest.fadeOutDuration],
  ];
  const optionalParams = {};
  numberFields.forEach(([key, value]) => {
    const normalized = normalizeNumber(value, null);
    if (normalized !== null) optionalParams[key] = normalized;
  });

  const trackName = String(audioAddRequest.track_name || audioAddRequest.trackName || '').trim();
  const effectType = String(audioAddRequest.effect_type || audioAddRequest.effectType || '').trim();
  const effectParamsRaw = Array.isArray(audioAddRequest.effect_params)
    ? audioAddRequest.effect_params
    : (Array.isArray(audioAddRequest.effectParams) ? audioAddRequest.effectParams : null);
  if (effectParamsRaw) {
    const effectParams = effectParamsRaw.map((item) => Number(item)).filter(Number.isFinite);
    if (effectParams.length) optionalParams.effect_params = effectParams;
  }

  return {
    draft_id: draftId,
    ...(audioUrl ? { audio_url: audioUrl } : {}),
    ...(musicId ? { music_id: musicId } : {}),
    ...(trackName ? { track_name: trackName } : {}),
    ...(effectType ? { effect_type: effectType } : {}),
    ...optionalParams,
  };
};
