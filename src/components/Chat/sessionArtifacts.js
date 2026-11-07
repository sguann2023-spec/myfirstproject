export const artifactPinnedField = { draft: 'pinnedDrafts', video: 'pinnedVideos', image: 'pinnedImages', audio: 'pinnedAudios', document: 'pinnedDocuments' };

// Both live MCP registrations and index restoration use the same ownership and
// deduplication rules. Never route an event to the active chat as a fallback.
export function mergeSessionArtifact(session, item, restored = false) {
  const field = artifactPinnedField[item?.type];
  if (!field || !item.runtimeSessionId || session.runtimeSessionId !== item.runtimeSessionId) return session;
  const previous = session[field] || [];
  const location = item.filePath || item.url;
  const index = previous.findIndex((old) => old.id === item.id || (item.draftId && old.draftId === item.draftId) ||
    ([item.url, item.filePath].filter(Boolean).some(value => [old.url, old.filePath, old.videoUrl, old.imageUrl, old.audioUrl].includes(value))));
  const next = {
    ...(index >= 0 ? previous[index] : {}), ...item, ...(restored ? { restoredArtifact: true } : {}), status: 'completed',
    videoUrl: location, imageUrl: location, audioUrl: location
  };
  if (index >= 0 && JSON.stringify(previous[index]) === JSON.stringify(next)) return session;
  return { ...session, [field]: index < 0 ? [...previous, next] : previous.map((old, i) => i === index ? next : old) };
}
