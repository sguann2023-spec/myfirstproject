export const normalizePinnedDraftFromEvent = (payload = {}) => {
  const draftId = String(payload?.draftId || payload?.draft_id || '').trim();
  if (!draftId) return null;

  const action = payload?.action === 'modify' ? 'modify' : 'create';
  const draftName = String(payload?.name || payload?.title || payload?.draftName || payload?.draft_name || '').trim();
  const nextDraft = {
    id: draftId,
    draftId,
    clientRequestId: String(payload?.clientRequestId || '').trim(),
    createdAt: typeof payload?.createdAt === 'number' ? payload.createdAt : Date.now(),
    status: payload?.status === 'in_progress' ? 'in_progress' : 'completed'
  };

  if (draftName || action === 'create') {
    nextDraft.title = draftName || draftId;
    nextDraft.name = draftName || draftId;
    nextDraft.activeTitle = draftName || draftId;
  }
  const cover = String(payload?.cover || '').trim();
  if (cover) nextDraft.cover = cover;
  return nextDraft;
};

export const applyPinnedDraftMetadata = (draft, metadata = {}) => {
  const draftId = String(draft?.draftId || draft?.id || '').trim();
  const currentName = String(draft?.title || draft?.name || '').trim();
  const resolvedName = String(metadata?.draft_name || '').trim();
  // A late lookup must not overwrite a name supplied by a newer rename event.
  if (!resolvedName || (currentName && currentName !== draftId)) return draft;
  return {
    ...draft,
    title: resolvedName,
    name: resolvedName,
    activeTitle: resolvedName,
    cover: draft.cover || metadata.cover
  };
};
