export const artifactPinnedField = { draft: 'pinnedDrafts', video: 'pinnedVideos', image: 'pinnedImages', audio: 'pinnedAudios', document: 'pinnedDocuments' };

// Both live MCP registrations and index restoration use the same ownership and
// deduplication rules. Never route an event to the active chat as a fallback.
export function mergeSessionArtifact(session, item, restored = false) {
  const field = artifactPinnedField[item?.type];
  if (!field || !item.runtimeSessionId || session.runtimeSessionId !== item.runtimeSessionId) return session;
  const previous = session[field] || [];
  const location = item.url || item.filePath;
  if (previous.some((old) => old.id === item.id || (item.draftId && old.draftId === item.draftId) ||
    (location && [old.url, old.filePath, old.videoUrl, old.imageUrl, old.audioUrl].includes(location)))) return session;
  return { ...session, [field]: [...previous, {
    ...item, ...(restored ? { restoredArtifact: true } : {}), status: 'completed',
    videoUrl: location, imageUrl: location, audioUrl: location
  }] };
}
