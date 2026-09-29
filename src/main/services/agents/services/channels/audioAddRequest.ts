export function normalizeDirectAudioAddRequest(input: Record<string, unknown> = {}) {
  const draftIdRaw = typeof input.draftId === 'string' ? input.draftId : input.draft_id
  const audioUrlRaw = typeof input.audioUrl === 'string' ? input.audioUrl : input.audio_url
  const musicIdRaw = typeof input.musicId === 'string' ? input.musicId : input.music_id
  const draftId = typeof draftIdRaw === 'string' ? draftIdRaw.trim() : ''
  const audioUrl = typeof audioUrlRaw === 'string' ? audioUrlRaw.trim() : ''
  const musicId = typeof musicIdRaw === 'string' ? musicIdRaw.trim() : ''
  if (!audioUrl && !musicId) throw new Error('audio_url or music_id is required for audio add request')

  const optionalParams: Record<string, unknown> = {}
  const numberFields: Array<[string, unknown]> = [
    ['target_start', input.target_start ?? input.targetStart],
    ['start', input.start],
    ['end', input.end],
    ['duration', input.duration],
    ['volume', input.volume],
    ['speed', input.speed],
    ['fade_in_duration', input.fade_in_duration ?? input.fadeInDuration],
    ['fade_out_duratioin', input.fade_out_duratioin ?? input.fade_out_duration ?? input.fadeOutDuration]
  ]
  numberFields.forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') return
    const normalized = Number(value)
    if (Number.isFinite(normalized)) optionalParams[key] = normalized
  })

  const trackName = String(input.track_name || input.trackName || '').trim()
  const effectType = String(input.effect_type || input.effectType || '').trim()
  const effectParamsRaw = Array.isArray(input.effect_params)
    ? input.effect_params
    : (Array.isArray(input.effectParams) ? input.effectParams : null)
  if (effectParamsRaw) {
    const effectParams = effectParamsRaw.map((item) => Number(item)).filter(Number.isFinite)
    if (effectParams.length) optionalParams.effect_params = effectParams
  }

  return {
    ...(audioUrl ? { audio_url: audioUrl } : {}),
    ...(musicId ? { music_id: musicId } : {}),
    ...(draftId ? { draft_id: draftId } : {}),
    ...(trackName ? { track_name: trackName } : {}),
    ...(effectType ? { effect_type: effectType } : {}),
    ...optionalParams
  }
}
