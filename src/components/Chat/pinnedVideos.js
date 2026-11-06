// Persist event metadata only; runtime ownership is required even for restored videos.
export const normalizePinnedVideo = (payload) => {
  const string = (value) => typeof value === 'string' ? value.trim() : '';
  const id = string(payload?.id);
  const source = string(payload?.source);
  const taskId = string(payload?.taskId);
  const runtimeSessionId = string(payload?.runtimeSessionId);
  const videoUrl = string(payload?.videoUrl);
  if (payload?.type === 'video' && id && runtimeSessionId && videoUrl && payload.status === 'completed' && Number.isFinite(payload.createdAt)) {
    return { id, type: 'video', source, taskId, runtimeSessionId, videoUrl, createdAt: payload.createdAt, status: 'completed', ...(payload.restoredArtifact ? { restoredArtifact: true } : {}) };
  }
  if (!id || !taskId || !['video-generate', 'digital-human'].includes(source) || id !== `${source}:${taskId}` || !runtimeSessionId || !videoUrl || payload.status !== 'completed'
    || typeof payload.createdAt !== 'number' || !Number.isFinite(payload.createdAt)) return null;
  return { id, source, runtimeSessionId, taskId, videoUrl, createdAt: payload.createdAt, status: 'completed' };
};
const upsert = (result, video) => {
  const index = result.findIndex((item) => item.id === video.id && item.runtimeSessionId === video.runtimeSessionId);
  if (index < 0) return [...result, video];
  // A delivery timestamp is not a new artifact. Keep the first timestamp for identical content.
  if (result[index].videoUrl === video.videoUrl || result[index].createdAt > video.createdAt) return result;
  return result.map((item, i) => i === index ? video : item);
};
export const normalizePinnedVideos = (videos, runtimeSessionId) => {
  let result = [];
  for (const value of Array.isArray(videos) ? videos : []) {
    const video = normalizePinnedVideo(value);
    if (video && (runtimeSessionId === undefined || video.runtimeSessionId === runtimeSessionId)) result = upsert(result, video);
  }
  return result;
};
export const mergePinnedVideo = (videos, payload) => {
  const video = normalizePinnedVideo(payload);
  if (!video) return normalizePinnedVideos(videos);
  const current = normalizePinnedVideos(videos, video.runtimeSessionId);
  return current.some((item) => item.id === video.id) ? upsert(current, video) : [video, ...current];
};
export const resolvePinnedVideoEvent = (payload, chatIdByRuntimeId) => {
  const video = normalizePinnedVideo(payload);
  const chatId = video && chatIdByRuntimeId.get(video.runtimeSessionId);
  return chatId ? { chatId, video } : null;
};
