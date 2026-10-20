const firstString = (...values) => {
  const value = values.find((item) => typeof item === 'string' && item.trim());
  return typeof value === 'string' ? value.trim() : '';
};

const normalizeStringArray = (...values) => values
  .flatMap((value) => (Array.isArray(value) ? value : (typeof value === 'string' && value.trim() ? [value] : [])))
  .map((item) => (typeof item === 'string' ? item.trim() : ''))
  .filter(Boolean);

const addString = (payload, key, value) => {
  const normalized = firstString(value);
  if (normalized) payload[key] = normalized;
};

const addNumber = (payload, key, value) => {
  if (value === null || value === undefined || value === '') return;
  const normalized = Number(value);
  if (Number.isFinite(normalized)) payload[key] = normalized;
};

const addBoolean = (payload, key, value) => {
  if (typeof value === 'boolean') payload[key] = value;
};

export const normalizeImageGenerateRequestPayload = (imageGenerateRequest = {}, fallbackPrompt = '') => {
  if (!imageGenerateRequest || typeof imageGenerateRequest !== 'object') return null;

  const prompt = firstString(imageGenerateRequest.prompt, imageGenerateRequest.text, fallbackPrompt);
  if (!prompt) return null;

  const payload = { prompt };
  addString(payload, 'model', imageGenerateRequest.model);
  addString(payload, 'size', imageGenerateRequest.size || imageGenerateRequest.resolution);
  addString(payload, 'outputFormat', imageGenerateRequest.outputFormat || imageGenerateRequest.output_format);
  addString(payload, 'background', imageGenerateRequest.background);
  addString(payload, 'draftId', imageGenerateRequest.draftId || imageGenerateRequest.draft_id);
  addString(payload, 'trackName', imageGenerateRequest.trackName || imageGenerateRequest.track_name);
  addBoolean(payload, 'transparent_background', imageGenerateRequest.transparent_background ?? imageGenerateRequest.transparentBackground);
  const composeDraft = imageGenerateRequest.composeDraft ?? imageGenerateRequest.compose_draft;
  payload.composeDraft = typeof composeDraft === 'boolean' ? composeDraft : false;

  const referenceImages = normalizeStringArray(
    imageGenerateRequest.referenceImages,
    imageGenerateRequest.reference_images,
    imageGenerateRequest.sourceImages,
    imageGenerateRequest.source_images,
    imageGenerateRequest.sourceImage,
    imageGenerateRequest.source_image,
    imageGenerateRequest.baseImage,
    imageGenerateRequest.base_image,
    imageGenerateRequest.editImage,
    imageGenerateRequest.edit_image,
    imageGenerateRequest.referenceImage,
    imageGenerateRequest.reference_image
  );
  if (referenceImages.length) payload.referenceImages = referenceImages;

  addNumber(payload, 'transformX', imageGenerateRequest.transformX ?? imageGenerateRequest.transform_x);
  addNumber(payload, 'transformY', imageGenerateRequest.transformY ?? imageGenerateRequest.transform_y);
  addNumber(payload, 'scaleX', imageGenerateRequest.scaleX ?? imageGenerateRequest.scale_x);
  addNumber(payload, 'scaleY', imageGenerateRequest.scaleY ?? imageGenerateRequest.scale_y);
  addNumber(payload, 'rotation', imageGenerateRequest.rotation);

  return payload;
};
