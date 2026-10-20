export function normalizeDirectImageGenerateRequest(input: Record<string, unknown> = {}, fallbackPrompt = '') {
  const prompt = firstString(input.prompt, input.text, fallbackPrompt)
  if (!prompt) throw new Error('prompt is required for image generate request')

  const payload: Record<string, unknown> = { prompt }
  addString(payload, 'model', input.model)
  addString(payload, 'size', input.size || input.resolution)
  addString(payload, 'outputFormat', input.outputFormat || input.output_format)
  addString(payload, 'background', input.background)
  addString(payload, 'draftId', input.draftId || input.draft_id)
  addString(payload, 'trackName', input.trackName || input.track_name)
  addBoolean(payload, 'transparent_background', input.transparent_background ?? input.transparentBackground)
  const composeDraft = input.composeDraft ?? input.compose_draft
  payload.composeDraft = typeof composeDraft === 'boolean' ? composeDraft : false

  const referenceImages = normalizeStringArray(
    input.referenceImages,
    input.reference_images,
    input.sourceImages,
    input.source_images,
    input.sourceImage,
    input.source_image,
    input.baseImage,
    input.base_image,
    input.editImage,
    input.edit_image,
    input.referenceImage,
    input.reference_image
  )
  if (referenceImages.length > 0) payload.referenceImages = referenceImages

  addNumber(payload, 'transformX', input.transformX ?? input.transform_x)
  addNumber(payload, 'transformY', input.transformY ?? input.transform_y)
  addNumber(payload, 'scaleX', input.scaleX ?? input.scale_x)
  addNumber(payload, 'scaleY', input.scaleY ?? input.scale_y)
  addNumber(payload, 'rotation', input.rotation)

  return payload
}

function firstString(...values: unknown[]) {
  const value = values.find((item) => typeof item === 'string' && item.trim())
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeStringArray(...values: unknown[]) {
  return values
    .flatMap((value) => {
      if (Array.isArray(value)) return value
      return typeof value === 'string' && value.trim() ? [value] : []
    })
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
}

function addString(payload: Record<string, unknown>, key: string, value: unknown) {
  const normalized = firstString(value)
  if (normalized) payload[key] = normalized
}

function addNumber(payload: Record<string, unknown>, key: string, value: unknown) {
  if (value === null || value === undefined || value === '') return
  const normalized = Number(value)
  if (Number.isFinite(normalized)) payload[key] = normalized
}

function addBoolean(payload: Record<string, unknown>, key: string, value: unknown) {
  if (typeof value === 'boolean') payload[key] = value
}
