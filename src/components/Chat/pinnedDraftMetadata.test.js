import { describe, expect, it } from 'vitest';
import { applyPinnedDraftMetadata, normalizePinnedDraftFromEvent, formatDraftUpdatedAt } from './pinnedDraftMetadata';

describe('pinned draft metadata', () => {
  it('resolves the real name for an existing draft first seen in an add-text event', () => {
    const draft = normalizePinnedDraftFromEvent({
      action: 'modify', draftId: 'dfd_cat_1', status: 'completed'
    });
    expect(draft.title).toBeUndefined();
    const resolved = applyPinnedDraftMetadata(draft, { draft_name: 'tup1', cover: 'cover.png' });
    expect(resolved).toMatchObject({
      draftId: 'dfd_cat_1', title: 'tup1', name: 'tup1', activeTitle: 'tup1', cover: 'cover.png'
    });
  });

  it('does not erase a known name when an element event omits it', () => {
    const draft = { id: 'draft-1', draftId: 'draft-1', title: 'tup1', name: 'tup1' };
    const event = normalizePinnedDraftFromEvent({ action: 'modify', draftId: 'draft-1' });
    expect({ ...draft, ...event }).toMatchObject({ title: 'tup1', name: 'tup1' });
  });

  it('does not overwrite a newer rename with a late metadata response', () => {
    const draft = { draftId: 'draft-1', title: 'renamed' };
    expect(applyPinnedDraftMetadata(draft, { draft_name: 'tup1' })).toBe(draft);
  });

  it('accepts name aliases and replaces the ID placeholder for a new draft', () => {
    expect(normalizePinnedDraftFromEvent({ draft_id: 'draft-1', draft_name: 'tup1' }).title).toBe('tup1');
    const draft = normalizePinnedDraftFromEvent({ action: 'create', draftId: 'draft-1' });
    expect(applyPinnedDraftMetadata(draft, { draft_name: 'tup1' }).title).toBe('tup1');
  });

  it('keeps current data when metadata is missing', () => {
    const draft = { draftId: 'draft-1' };
    expect(applyPinnedDraftMetadata(draft)).toBe(draft);
    expect(normalizePinnedDraftFromEvent({})).toBeNull();
  });
});

describe('draft update timestamps', () => {
  it('merges timestamps independently of protected names and missing names', () => {
    const draft = { draftId: 'draft-1', title: 'new rename', cover: 'current.png' };
    expect(applyPinnedDraftMetadata(draft, { draft_name: 'old name', updated_at: 123, cover: 'old.png' }))
      .toMatchObject({ title: 'new rename', updated_at: 123, cover: 'current.png' });
    expect(applyPinnedDraftMetadata(draft, { updated_at: 456 }).updated_at).toBe(456);
    expect(normalizePinnedDraftFromEvent({ draftId: 'draft-1', updated_at: 123 }).updated_at).toBe(123);
  });

  it('formats local today, other days and years, seconds, milliseconds and ISO strings', () => {
    const now = new Date(2026, 10, 4, 12);
    const today = new Date(2026, 10, 4, 9, 8, 7);
    expect(formatDraftUpdatedAt(today.getTime(), now)).toBe('09:08:07');
    expect(formatDraftUpdatedAt(today.getTime() / 1000, now)).toBe('09:08:07');
    expect(formatDraftUpdatedAt(String(today.getTime() / 1000), now)).toBe('09:08:07');
    expect(formatDraftUpdatedAt(today.toISOString(), now)).toBe('09:08:07');
    expect(formatDraftUpdatedAt(new Date(2026, 10, 3, 23, 59, 1).getTime(), now)).toBe('11/03 23:59:01');
    expect(formatDraftUpdatedAt(new Date(2025, 10, 4, 9, 8, 7).getTime(), now)).toBe('11/04 09:08:07');
    for (const value of [null, undefined, '', 'invalid']) expect(formatDraftUpdatedAt(value, now)).toBe('');
  });
});

import { normalizePinnedDrafts, mergePinnedDraft } from './pinnedDraftMetadata';

describe('session draft metadata', () => {
  it('keeps background updates on their captured owner and merges pending completion', () => {
    const sessions = { A: [], B: [] };
    const owner = 'A';
    sessions[owner] = mergePinnedDraft(sessions[owner], normalizePinnedDraftFromEvent({ draftId: 'pending:1', clientRequestId: 'r', status: 'in_progress' }));
    sessions[owner] = mergePinnedDraft(sessions[owner], normalizePinnedDraftFromEvent({ draftId: 'final', clientRequestId: 'r', status: 'completed' }));
    expect(sessions.B).toEqual([]);
    expect(sessions.A).toHaveLength(1);
    expect(sessions.A[0].draftId).toBe('final');
  });
  it('round trips lightweight metadata without persisting track previews', () => {
    const drafts = normalizePinnedDrafts([{ id: 'a', title: 'Title', cover: 'cover', updated_at: 123, trackPreview: { tracks: [] } }, null]);
    expect(normalizePinnedDrafts(JSON.parse(JSON.stringify(drafts)))).toEqual(drafts);
    expect(drafts[0]).not.toHaveProperty('trackPreview');
    expect(drafts[0].title).toBe('Title');
  });
});

import { resolvePinnedDraftEvent } from './pinnedDraftMetadata';
it('routes A/B events by runtime owner, never by active session, and ignores unknown owners', () => {
  const mapping = new Map([['runtime-A', 'A'], ['runtime-B', 'B']]);
  expect(resolvePinnedDraftEvent({ draftId: 'a', runtimeSessionId: 'runtime-A' }, mapping).chatId).toBe('A');
  expect(resolvePinnedDraftEvent({ draftId: 'b', runtimeSessionId: 'runtime-B' }, mapping).chatId).toBe('B');
  expect(resolvePinnedDraftEvent({ draftId: 'unknown' }, mapping)).toBeNull();
  expect(resolvePinnedDraftEvent({ draftId: 'unknown', runtimeSessionId: 'deleted' }, mapping)).toBeNull();
});
