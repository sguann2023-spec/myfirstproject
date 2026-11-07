// Persist event metadata only; runtime ownership is required even for restored images.
export const normalizePinnedImage = (payload) => {
  const string = (value) => typeof value === 'string' ? value.trim() : '';
  const id = string(payload?.id);
  const taskId = string(payload?.taskId);
  const runtimeSessionId = string(payload?.runtimeSessionId);
  const imageUrl = string(payload?.filePath) || string(payload?.imageUrl);
  const local = { ...(string(payload?.filePath) ? { filePath: string(payload.filePath) } : {}), ...(payload?.url ? { url: payload.url } : {}) };
  if (payload?.type === 'image' && id && runtimeSessionId && imageUrl && payload.status === 'completed' && Number.isFinite(payload.createdAt)) {
    return { ...local, id, type: 'image', taskId, runtimeSessionId, imageUrl, createdAt: payload.createdAt, status: 'completed', ...(payload.restoredArtifact ? { restoredArtifact: true } : {}) };
  }
  if (!id || !taskId || id !== taskId || !runtimeSessionId || !imageUrl || payload.status !== 'completed'
    || typeof payload.createdAt !== 'number' || !Number.isFinite(payload.createdAt)) return null;
  return { ...local, id, runtimeSessionId, taskId, imageUrl, createdAt: payload.createdAt, status: 'completed' };
};
const upsert = (result, image) => {
  const index = result.findIndex((item) => item.id === image.id && item.runtimeSessionId === image.runtimeSessionId);
  if (index < 0) return [...result, image];
  // A delivery timestamp is not a new artifact. Keep the first timestamp for identical content.
  if (result[index].imageUrl === image.imageUrl || result[index].createdAt > image.createdAt) return result;
  return result.map((item, i) => i === index ? image : item);
};
export const normalizePinnedImages = (images, runtimeSessionId) => {
  let result = [];
  for (const value of Array.isArray(images) ? images : []) {
    const image = normalizePinnedImage(value);
    if (image && (runtimeSessionId === undefined || image.runtimeSessionId === runtimeSessionId)) result = upsert(result, image);
  }
  return result;
};
export const mergePinnedImage = (images, payload) => {
  const image = normalizePinnedImage(payload);
  if (!image) return normalizePinnedImages(images);
  const current = normalizePinnedImages(images, image.runtimeSessionId);
  return current.some((item) => item.id === image.id) ? upsert(current, image) : [image, ...current];
};
export const resolvePinnedImageEvent = (payload, chatIdByRuntimeId) => {
  const image = normalizePinnedImage(payload);
  const chatId = image && chatIdByRuntimeId.get(image.runtimeSessionId);
  return chatId ? { chatId, image } : null;
};
