export const normalizeSpeechRequestPayload = (speechRequest = {}, fallbackText = '') => {
  if (!speechRequest || typeof speechRequest !== 'object') return null;

  const text = String(speechRequest?.text || fallbackText || '').trim();
  if (!text) return null;

  const provider = String(speechRequest?.provider || '').trim();
  const model = String(speechRequest?.model || '').trim();
  const voiceId = String(speechRequest?.voice_id || speechRequest?.voiceId || '').trim();
  const draftId = String(speechRequest?.draft_id || speechRequest?.draftId || '').trim();
  const trackName = String(speechRequest?.track_name || speechRequest?.trackName || '').trim();
  const effectType = String(speechRequest?.effect_type || speechRequest?.effectType || '').trim();
  const licenseKey = String(speechRequest?.license_key || speechRequest?.licenseKey || '').trim();
  const effectParams = Array.isArray(speechRequest?.effect_params)
    ? speechRequest.effect_params
    : (Array.isArray(speechRequest?.effectParams) ? speechRequest.effectParams : null);
  const numberFields = [
    ['speech_speed', speechRequest?.speech_speed ?? speechRequest?.speechSpeed],
    ['start', speechRequest?.start],
    ['end', speechRequest?.end],
    ['volume', speechRequest?.volume],
    ['target_start', speechRequest?.target_start ?? speechRequest?.targetStart],
    ['speed', speechRequest?.speed],
    ['width', speechRequest?.width],
    ['height', speechRequest?.height],
    ['fade_in_duration', speechRequest?.fade_in_duration ?? speechRequest?.fadeInDuration],
    ['fade_out_duration', speechRequest?.fade_out_duration ?? speechRequest?.fadeOutDuration],
  ];
  const optionalParams = {};

  numberFields.forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') return;
    const normalized = Number(value);
    if (Number.isFinite(normalized)) optionalParams[key] = normalized;
  });

  if (effectParams) {
    const normalizedEffectParams = effectParams
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item));
    if (normalizedEffectParams.length) optionalParams.effect_params = normalizedEffectParams;
  }

  return {
    text,
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(voiceId ? { voice_id: voiceId } : {}),
    ...(draftId ? { draft_id: draftId } : {}),
    ...(trackName ? { track_name: trackName } : {}),
    ...(effectType ? { effect_type: effectType } : {}),
    ...(licenseKey ? { license_key: licenseKey } : {}),
    ...(typeof speechRequest?.only_tts === 'boolean'
      ? { only_tts: speechRequest.only_tts }
      : (typeof speechRequest?.onlyTts === 'boolean' ? { only_tts: speechRequest.onlyTts } : {})),
    ...optionalParams,
  };
};
