import { describe, it, expect } from 'vitest';
import { normalizePinnedImage, normalizePinnedImages, mergePinnedImage, resolvePinnedImageEvent } from './pinnedImages';
const image = { id: 't', taskId: 't', runtimeSessionId: 'r', imageUrl: 'image.png', createdAt: 1, status: 'completed' };
describe('pinned images metadata', () => {
  it('normalizes metadata only and rejects incomplete or invalid events', () => {
    expect(normalizePinnedImage({ ...image, imageUrl: ' image.png ', previewVisible: true })).toEqual(image);
    for (const patch of [{ id: '' }, { taskId: '' }, { taskId: 'other' }, { runtimeSessionId: '' }, { imageUrl: '' }, { createdAt: NaN }, { createdAt: '1' }, { status: 'running' }]) {
      expect(normalizePinnedImage({ ...image, ...patch })).toBeNull();
    }
    expect(normalizePinnedImages(null)).toEqual([]);
  });
  it('routes only known runtimes and filters restored images to their owner', () => {
    const map = new Map([['r', 'chat']]);
    expect(resolvePinnedImageEvent(image, map)).toEqual({ chatId: 'chat', image });
    expect(resolvePinnedImageEvent({ ...image, runtimeSessionId: 'unknown' }, map)).toBeNull();
    expect(normalizePinnedImages([image, { ...image, runtimeSessionId: 'other' }], 'r')).toEqual([image]);
    expect(normalizePinnedImages([image, { ...image, runtimeSessionId: 'other' }])).toHaveLength(2);
  });
  it('deduplicates delivery timestamps and updates URLs without allowing stale replacement', () => {
    const duplicate = { ...image, createdAt: 10 };
    expect(mergePinnedImage([image], duplicate)).toEqual([image]);
    expect(normalizePinnedImages([image, duplicate])).toEqual([image]);
    const updated = { ...image, imageUrl: 'new.png', createdAt: 2 };
    expect(mergePinnedImage([image], updated)).toEqual([updated]);
    expect(mergePinnedImage([updated], image)).toEqual([updated]);
    expect(mergePinnedImage([image], { ...image, id: 'next', taskId: 'next' })).toHaveLength(2);
    expect(mergePinnedImage([image], {})).toEqual([image]);
  });
  it('round-trips persisted event metadata without transient UI state', () => {
    const stored = JSON.parse(JSON.stringify(normalizePinnedImages([{ ...image, visible: true }], 'r')));
    expect(normalizePinnedImages(stored, 'r')).toEqual([image]);
  });
});
