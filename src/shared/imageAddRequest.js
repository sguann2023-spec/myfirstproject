const normalizeNumber = (value, fallback = null) => {
  if (value === null || value === undefined || value === '') return fallback;
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : fallback;
};

export const normalizeImageAddRequestPayload = (imageAddRequest = {}) => {
  if (!imageAddRequest || typeof imageAddRequest !== 'object') return null;
  const draftId = String(imageAddRequest.draft_id || imageAddRequest.draftId || '').trim();
  const imageUrl = String(imageAddRequest.image_url || imageAddRequest.imageUrl || '').trim();
  if (!draftId || !imageUrl) return null;

  const optionalParams = {};
  [
    ['start', imageAddRequest.start],
    ['end', imageAddRequest.end],
    ['width', imageAddRequest.width],
    ['height', imageAddRequest.height],
    ['transform_x_px', imageAddRequest.transform_x_px ?? imageAddRequest.transformXPx],
    ['transform_y_px', imageAddRequest.transform_y_px ?? imageAddRequest.transformYPx],
    ['rotation', imageAddRequest.rotation],
    ['scale_x', imageAddRequest.scale_x ?? imageAddRequest.scaleX],
    ['scale_y', imageAddRequest.scale_y ?? imageAddRequest.scaleY],
    ['relative_index', imageAddRequest.relative_index ?? imageAddRequest.relativeIndex],
    ['alpha', imageAddRequest.alpha],
    ['intro_animation_duration', imageAddRequest.intro_animation_duration ?? imageAddRequest.introAnimationDuration],
    ['outro_animation_duration', imageAddRequest.outro_animation_duration ?? imageAddRequest.outroAnimationDuration],
    ['combo_animation_duration', imageAddRequest.combo_animation_duration ?? imageAddRequest.comboAnimationDuration],
    ['transition_duration', imageAddRequest.transition_duration ?? imageAddRequest.transitionDuration],
  ].forEach(([key, value]) => {
    const normalized = normalizeNumber(value, null);
    if (normalized !== null) optionalParams[key] = normalized;
  });

  [
    ['intro_animation', imageAddRequest.intro_animation || imageAddRequest.introAnimation],
    ['outro_animation', imageAddRequest.outro_animation || imageAddRequest.outroAnimation],
    ['combo_animation', imageAddRequest.combo_animation || imageAddRequest.comboAnimation],
    ['transition', imageAddRequest.transition],
  ].forEach(([key, value]) => {
    const normalized = String(value || '').trim();
    if (normalized) optionalParams[key] = normalized;
  });

  const trackName = String(imageAddRequest.track_name || imageAddRequest.trackName || '').trim();
  return {
    draft_id: draftId,
    image_url: imageUrl,
    ...(trackName ? { track_name: trackName } : {}),
    ...optionalParams,
  };
};
