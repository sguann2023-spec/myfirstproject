export const normalizePresetAddRequestPayload = (presetAddRequest = {}) => {
  if (!presetAddRequest || typeof presetAddRequest !== 'object') return null;
  const draftId = String(presetAddRequest.draft_id || presetAddRequest.draftId || '').trim();
  const presetId = String(presetAddRequest.preset_id || presetAddRequest.presetId || '').trim();
  if (!draftId || !presetId) return null;
  const replacements = Array.isArray(presetAddRequest.replacements)
    ? presetAddRequest.replacements
      .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
      .flatMap((item) => Object.entries(item).map(([key, value]) => {
        const normalizedKey = String(key || '').trim();
        const normalizedValue = String(value ?? '');
        return normalizedKey && normalizedValue.trim() ? { [normalizedKey]: normalizedValue } : null;
      }).filter(Boolean))
      .filter((item) => Object.keys(item).length > 0)
    : [];
  const numberFields = [
    ['target_start', presetAddRequest.target_start ?? presetAddRequest.targetStart],
    ['start', presetAddRequest.start],
    ['end', presetAddRequest.end],
    ['transform_x', presetAddRequest.transform_x ?? presetAddRequest.transformX],
    ['transform_y', presetAddRequest.transform_y ?? presetAddRequest.transformY],
    ['transform_x_px', presetAddRequest.transform_x_px ?? presetAddRequest.transformXPx],
    ['transform_y_px', presetAddRequest.transform_y_px ?? presetAddRequest.transformYPx],
    ['rotation', presetAddRequest.rotation],
    ['scale_x', presetAddRequest.scale_x ?? presetAddRequest.scaleX],
    ['scale_y', presetAddRequest.scale_y ?? presetAddRequest.scaleY],
    ['width', presetAddRequest.width],
    ['height', presetAddRequest.height],
    ['relative_index', presetAddRequest.relative_index ?? presetAddRequest.relativeIndex],
    ['mask_center_x', presetAddRequest.mask_center_x],
    ['mask_center_y', presetAddRequest.mask_center_y],
    ['mask_size', presetAddRequest.mask_size],
    ['mask_rotation', presetAddRequest.mask_rotation],
    ['mask_feather', presetAddRequest.mask_feather],
    ['mask_rect_width', presetAddRequest.mask_rect_width],
    ['mask_round_corner', presetAddRequest.mask_round_corner],
    ['intro_animation_duration', presetAddRequest.intro_animation_duration ?? presetAddRequest.introAnimationDuration],
    ['outro_animation_duration', presetAddRequest.outro_animation_duration ?? presetAddRequest.outroAnimationDuration],
    ['transition_duration', presetAddRequest.transition_duration ?? presetAddRequest.transitionDuration],
    ['volume', presetAddRequest.volume],
  ];
  const stringFields = [
    ['track_name', presetAddRequest.track_name || presetAddRequest.trackName],
    ['mask_type', presetAddRequest.mask_type],
    ['intro_animation', presetAddRequest.intro_animation || presetAddRequest.introAnimation],
    ['outro_animation', presetAddRequest.outro_animation || presetAddRequest.outroAnimation],
    ['transition', presetAddRequest.transition],
  ];
  const optionalParams = {};
  numberFields.forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') return;
    const normalized = Number(value);
    if (Number.isFinite(normalized)) optionalParams[key] = normalized;
  });
  stringFields.forEach(([key, value]) => {
    const normalized = String(value || '').trim();
    if (normalized) optionalParams[key] = normalized;
  });
  if (typeof presetAddRequest.mask_invert === 'boolean') optionalParams.mask_invert = presetAddRequest.mask_invert;
  return {
    draft_id: draftId,
    preset_id: presetId,
    ...(replacements.length ? { replacements } : {}),
    ...optionalParams,
  };
};
