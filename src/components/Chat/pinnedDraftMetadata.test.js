import { describe, expect, it } from 'vitest';
import { applyPinnedDraftMetadata, normalizePinnedDraftFromEvent } from './pinnedDraftMetadata';

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
