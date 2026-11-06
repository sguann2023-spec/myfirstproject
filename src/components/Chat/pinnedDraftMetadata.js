export const formatDraftUpdatedAt = (value, now = new Date()) => {
  if (value == null || value === '') return '';
  const numeric = typeof value === 'number' || /^\d+(\.\d+)?$/.test(String(value));
  const timestamp = numeric ? Number(value) : value;
  const date = new Date(numeric && Math.abs(timestamp) < 1e12 ? timestamp * 1000 : timestamp);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part) => String(part).padStart(2, '0');
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  const today = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  return today ? time : `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${time}`;
};

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
  if (payload?.updated_at != null) nextDraft.updated_at = payload.updated_at;
  return nextDraft;
};

export const applyPinnedDraftMetadata = (draft, metadata = {}) => {
  const draftId = String(draft?.draftId || draft?.id || '').trim();
  const currentName = String(draft?.title || draft?.name || '').trim();
  const resolvedName = String(metadata?.draft_name || '').trim();
  // A late lookup must not overwrite a name supplied by a newer rename event.
  const changes = {};
  if (metadata?.updated_at != null) changes.updated_at = metadata.updated_at;
  if (!draft.cover && metadata?.cover) changes.cover = metadata.cover;
  if (resolvedName && (!currentName || currentName === draftId)) {
    Object.assign(changes, { title: resolvedName, name: resolvedName, activeTitle: resolvedName });
  }
  return Object.keys(changes).length ? { ...draft, ...changes } : draft;
};

// Persist only lightweight metadata; query results belong to the preview cache.
export const normalizePinnedDrafts = (drafts) => (Array.isArray(drafts) ? drafts : [])
  .filter((draft) => draft && String(draft.draftId || draft.id || '').trim())
  .map(({ trackPreview, ...draft }) => ({
    ...normalizePinnedDraftFromEvent({ ...draft, draftId: draft.draftId || draft.id }),
    ...draft
  }));

export const mergePinnedDraft = (drafts, nextDraft) => {
  const current = normalizePinnedDrafts(drafts);
  const pending = nextDraft.clientRequestId
    ? current.findIndex((item) => item.clientRequestId === nextDraft.clientRequestId) : -1;
  const index = pending >= 0 ? pending : current.findIndex((item) => item.draftId === nextDraft.draftId);
  return index < 0 ? [nextDraft, ...current]
    : current.map((item, i) => i === index ? { ...item, ...nextDraft } : item);
};

export const resolvePinnedDraftEvent = (payload, chatIdByRuntimeId) => {
  const runtimeId = String(payload?.runtimeSessionId || '').trim();
  const chatId = runtimeId ? chatIdByRuntimeId.get(runtimeId) : null;
  const draft = normalizePinnedDraftFromEvent(payload);
  return chatId && draft ? { chatId, draft } : null;
};
