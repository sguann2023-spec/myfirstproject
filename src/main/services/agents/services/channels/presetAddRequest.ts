export function normalizeDirectPresetAddRequest(input: Record<string, unknown> = {}) {
  const draftIdRaw = typeof input.draftId === 'string' ? input.draftId : input.draft_id
  const presetIdRaw = typeof input.presetId === 'string' ? input.presetId : input.preset_id
  const draftId = typeof draftIdRaw === 'string' ? draftIdRaw.trim() : ''
  const presetId = typeof presetIdRaw === 'string' ? presetIdRaw.trim() : ''
  if (!presetId) throw new Error('preset_id is required for preset add request')

  const replacements = Array.isArray(input.replacements)
    ? input.replacements
      .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
      .flatMap((item) => Object.entries(item as Record<string, unknown>).map(([key, value]) => {
        const normalizedKey = String(key || '').trim()
        const normalizedValue = String(value ?? '')
        return normalizedKey && normalizedValue.trim() ? { [normalizedKey]: normalizedValue } : null
      }).filter(Boolean))
      .filter((item) => Object.keys(item).length > 0)
    : []

  const numberFields: Array<[string, unknown]> = [
    ['target_start', input.target_start ?? input.targetStart],
    ['start', input.start],
    ['end', input.end],
    ['transform_x', input.transform_x ?? input.transformX],
    ['transform_y', input.transform_y ?? input.transformY],
    ['transform_x_px', input.transform_x_px ?? input.transformXPx],
    ['transform_y_px', input.transform_y_px ?? input.transformYPx],
    ['rotation', input.rotation],
    ['scale_x', input.scale_x ?? input.scaleX],
    ['scale_y', input.scale_y ?? input.scaleY],
    ['width', input.width],
    ['height', input.height],
    ['relative_index', input.relative_index ?? input.relativeIndex],
    ['mask_center_x', input.mask_center_x],
    ['mask_center_y', input.mask_center_y],
    ['mask_size', input.mask_size],
    ['mask_rotation', input.mask_rotation],
    ['mask_feather', input.mask_feather],
    ['mask_rect_width', input.mask_rect_width],
    ['mask_round_corner', input.mask_round_corner],
    ['intro_animation_duration', input.intro_animation_duration ?? input.introAnimationDuration],
    ['outro_animation_duration', input.outro_animation_duration ?? input.outroAnimationDuration],
    ['transition_duration', input.transition_duration ?? input.transitionDuration],
    ['volume', input.volume]
  ]
  const optionalParams: Record<string, unknown> = {}
  numberFields.forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') return
    const normalized = Number(value)
    if (Number.isFinite(normalized)) optionalParams[key] = normalized
  })
  const trackName = String(input.track_name || input.trackName || '').trim()
  if (trackName) optionalParams.track_name = trackName
  for (const key of ['mask_type', 'intro_animation', 'outro_animation', 'transition']) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) optionalParams[key] = value.trim()
  }
  if (typeof input.mask_invert === 'boolean') optionalParams.mask_invert = input.mask_invert

  return {
    preset_id: presetId,
    ...(draftId ? { draft_id: draftId } : {}),
    ...(replacements.length ? { replacements } : {}),
    ...optionalParams
  }
}
