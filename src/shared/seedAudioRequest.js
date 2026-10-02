const DEFAULT_SEED_AUDIO_MODEL = 'seed-audio-1.0';

const firstString = (...values) => {
  const value = values.find((item) => typeof item === 'string' && item.trim());
  return typeof value === 'string' ? value.trim() : '';
};

export const normalizeSeedAudioRequestPayload = (seedAudioRequest = {}, fallbackPrompt = '') => {
  if (!seedAudioRequest || typeof seedAudioRequest !== 'object') return null;

  const textPrompt = firstString(
    seedAudioRequest.text_prompt,
    seedAudioRequest.textPrompt,
    seedAudioRequest.prompt,
    seedAudioRequest.prompt_text,
    fallbackPrompt
  );
  if (!textPrompt) return null;

  const model = firstString(seedAudioRequest.model) || DEFAULT_SEED_AUDIO_MODEL;
  const voiceId = firstString(seedAudioRequest.voice_id, seedAudioRequest.voiceId);
  const voiceIdsRaw = Array.isArray(seedAudioRequest.voice_ids)
    ? seedAudioRequest.voice_ids
    : Array.isArray(seedAudioRequest.voiceIds)
      ? seedAudioRequest.voiceIds
      : [];
  const voiceIds = voiceIdsRaw
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
  const speaker = firstString(seedAudioRequest.speaker);
  const audioUrl = firstString(seedAudioRequest.audio_url, seedAudioRequest.audioUrl);
  const imageUrl = firstString(seedAudioRequest.image_url, seedAudioRequest.imageUrl);
  const audioData = firstString(seedAudioRequest.audio_data, seedAudioRequest.audioData);
  const imageData = firstString(seedAudioRequest.image_data, seedAudioRequest.imageData);
  const references = Array.isArray(seedAudioRequest.references)
    ? seedAudioRequest.references.filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    : null;
  const referenceAudiosRaw = Array.isArray(seedAudioRequest.referenceAudios)
    ? seedAudioRequest.referenceAudios
    : Array.isArray(seedAudioRequest.reference_audios)
      ? seedAudioRequest.reference_audios
      : [];
  const referenceAudios = referenceAudiosRaw
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
  const referenceImage = firstString(seedAudioRequest.referenceImage, seedAudioRequest.reference_image);

  return {
    text_prompt: textPrompt,
    model,
    ...(voiceId ? { voice_id: voiceId } : {}),
    ...(voiceIds.length ? { voice_ids: voiceIds } : {}),
    ...(speaker ? { speaker } : {}),
    ...(audioUrl ? { audio_url: audioUrl } : {}),
    ...(imageUrl ? { image_url: imageUrl } : {}),
    ...(audioData ? { audio_data: audioData } : {}),
    ...(imageData ? { image_data: imageData } : {}),
    ...(references && references.length ? { references } : {}),
    ...(referenceAudios.length ? { referenceAudios } : {}),
    ...(referenceImage ? { referenceImage } : {}),
    ...(seedAudioRequest.audio_config && typeof seedAudioRequest.audio_config === 'object' ? { audio_config: seedAudioRequest.audio_config } : {}),
    ...(seedAudioRequest.audioConfig && typeof seedAudioRequest.audioConfig === 'object' ? { audio_config: seedAudioRequest.audioConfig } : {}),
    ...(seedAudioRequest.watermark && typeof seedAudioRequest.watermark === 'object' ? { watermark: seedAudioRequest.watermark } : {}),
  };
};
