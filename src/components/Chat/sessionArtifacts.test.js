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
it('updates a remote artifact to local playback without duplicating it', () => {
  const remote = { id: 'v', type: 'video', runtimeSessionId: 'r', url: 'https://example.com/a.mp4', createdAt: 1 };
  const session = mergeSessionArtifact({ runtimeSessionId: 'r' }, remote);
  const updated = mergeSessionArtifact(session, { ...remote, filePath: '/workspace/artifact/a.mp4' });
  expect(updated.pinnedVideos).toHaveLength(1);
  expect(updated.pinnedVideos[0].videoUrl).toBe('/workspace/artifact/a.mp4');
  expect(updated.pinnedVideos[0].url).toBe(remote.url);
  expect(normalizePinnedVideos(updated.pinnedVideos, 'r')[0].filePath).toBe('/workspace/artifact/a.mp4');
});
it('restored entries are marked to avoid preview activation', () => {
  const session = mergeSessionArtifact({ runtimeSessionId: 'r' }, { id: 'd', type: 'document', runtimeSessionId: 'r', filePath: '/a.md' }, true);
  expect(session.pinnedDocuments[0].restoredArtifact).toBe(true);
});
