import { expect, it } from 'vitest';
import { mergeSessionArtifact } from './sessionArtifacts';
import { normalizePinnedVideos } from './pinnedVideos';
import { normalizePinnedImages } from './pinnedImages';
it('routes all five registered types to owned UI state and keeps manual media across normalization', () => {
  let session = { runtimeSessionId: 'r' };
  for (const type of ['draft', 'video', 'image', 'audio', 'document']) {
    const item = { id: type, type, runtimeSessionId: 'r', createdAt: 1, ...(type === 'draft' ? { draftId: 'd' } : type === 'document' ? { filePath: '/a.html' } : { url: `https://example.com/${type}` }) };
    session = mergeSessionArtifact(session, item);
    expect(mergeSessionArtifact(session, item)).toBe(session);
    expect(mergeSessionArtifact(session, { ...item, runtimeSessionId: 'other' })).toBe(session);
  }
  expect(session.pinnedDrafts).toHaveLength(1);
  expect(session.pinnedDocuments[0].filePath).toBe('/a.html');
  expect(session.pinnedAudios[0].audioUrl).toBe('https://example.com/audio');
  expect(normalizePinnedVideos(session.pinnedVideos, 'r')).toHaveLength(1);
  expect(normalizePinnedImages(session.pinnedImages, 'r')).toHaveLength(1);
});
it('restored entries are marked to avoid preview activation', () => {
  const session = mergeSessionArtifact({ runtimeSessionId: 'r' }, { id: 'd', type: 'document', runtimeSessionId: 'r', filePath: '/a.md' }, true);
  expect(session.pinnedDocuments[0].restoredArtifact).toBe(true);
});
