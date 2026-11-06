import { describe, it, expect } from 'vitest';
import { normalizePinnedVideo, normalizePinnedVideos, mergePinnedVideo, resolvePinnedVideoEvent } from './pinnedVideos';
const video = { id: 'video-generate:t', source: 'video-generate', taskId: 't', runtimeSessionId: 'r', videoUrl: 'https://example.com/a.mp4', createdAt: 1, status: 'completed' };
describe('pinned videos', () => {
  it('validates the completed protocol and strips transient metadata', () => {
    expect(normalizePinnedVideo({ ...video, duration: 99 })).toEqual(video);
    for (const change of [{ source: 'other' }, { id: 't' }, { runtimeSessionId: '' }, { videoUrl: '' }, { status: 'running' }, { createdAt: NaN }]) expect(normalizePinnedVideo({ ...video, ...change })).toBeNull();
  });
  it('keeps source namespaces separate and duplicate URL first delivery time', () => {
    const other = { ...video, source: 'digital-human', id: 'digital-human:t' };
    const items = mergePinnedVideo([video], other);
    expect(items).toHaveLength(2);
    expect(mergePinnedVideo(items, { ...video, createdAt: 3 })).toEqual(items);
    expect(mergePinnedVideo([video], { ...video, videoUrl: 'b.mp4', createdAt: 2 })[0].videoUrl).toBe('b.mp4');
  });
  it('round trips persistence and filters foreign runtime sessions', () => {
    expect(normalizePinnedVideos(JSON.parse(JSON.stringify([video, video])), 'r')).toEqual([video]);
    expect(normalizePinnedVideos([video], 'other')).toEqual([]);
    expect(resolvePinnedVideoEvent(video, new Map([['r', 'chat']]))).toEqual({ chatId: 'chat', video });
    expect(resolvePinnedVideoEvent(video, new Map())).toBeNull();
  });
});
