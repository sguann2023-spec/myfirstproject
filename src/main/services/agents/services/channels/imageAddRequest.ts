export function normalizeDirectImageAddRequest(input: Record<string, unknown> = {}) {
  const draftIdRaw = typeof input.draftId === 'string' ? input.draftId : input.draft_id
  const imageUrlRaw = typeof input.imageUrl === 'string' ? input.imageUrl : input.image_url
  const draftId = typeof draftIdRaw === 'string' ? draftIdRaw.trim() : ''
  const imageUrl = typeof imageUrlRaw === 'string' ? imageUrlRaw.trim() : ''
  if (!imageUrl) throw new Error('image_url is required for image add request')

  const optionalParams: Record<string, unknown> = {}
  const numberFields: Array<[string, unknown]> = [
    ['start', input.start],
    ['end', input.end],
    ['width', input.width],
    ['height', input.height],
    ['transform_x_px', input.transform_x_px ?? input.transformXPx],
    ['transform_y_px', input.transform_y_px ?? input.transformYPx],
    ['rotation', input.rotation],
    ['scale_x', input.scale_x ?? input.scaleX],
    ['scale_y', input.scale_y ?? input.scaleY],
    ['relative_index', input.relative_index ?? input.relativeIndex],
    ['alpha', input.alpha],
    ['intro_animation_duration', input.intro_animation_duration ?? input.introAnimationDuration],
    ['outro_animation_duration', input.outro_animation_duration ?? input.outroAnimationDuration],
    ['combo_animation_duration', input.combo_animation_duration ?? input.comboAnimationDuration],
    ['transition_duration', input.transition_duration ?? input.transitionDuration]
  ]
  numberFields.forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') return
    const normalized = Number(value)
    if (Number.isFinite(normalized)) optionalParams[key] = normalized
  })

  const stringFields: Array<[string, unknown]> = [
    ['intro_animation', input.intro_animation || input.introAnimation],
    ['outro_animation', input.outro_animation || input.outroAnimation],
    ['combo_animation', input.combo_animation || input.comboAnimation],
    ['transition', input.transition]
  ]
  stringFields.forEach(([key, value]) => {
    const normalized = String(value || '').trim()
    if (normalized) optionalParams[key] = normalized
  })

  const trackName = String(input.track_name || input.trackName || '').trim()
  return {
    image_url: imageUrl,
    ...(draftId ? { draft_id: draftId } : {}),
    ...(trackName ? { track_name: trackName } : {}),
    ...optionalParams
  }
}
