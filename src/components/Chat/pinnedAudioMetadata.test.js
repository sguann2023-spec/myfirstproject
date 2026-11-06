import { describe, it, expect } from 'vitest';
import { normalizePinnedAudio, normalizePinnedAudios, mergePinnedAudio, resolvePinnedAudioEvent, pinnedAudioToOutput } from './pinnedAudioMetadata';
const audio = { id: 'audio-1', runtimeSessionId: 'runtime-1', audioUrl: 'https://example.com/1.mp3', createdAt: 10, status: 'completed' };
describe('pinned audio metadata', () => {
  it('requires completed audio metadata without a draft id', () => {
    expect(normalizePinnedAudio(audio)).toEqual(audio);
    for (const change of [{ id: '' }, { runtimeSessionId: '' }, { audioUrl: '' }, { status: 'failed' }, { createdAt: NaN }]) {
      expect(normalizePinnedAudio({ ...audio, ...change })).toBeNull();
    }
    expect(normalizePinnedAudio({ ...audio, currentTime: 10, durationSeconds: -1 })).toEqual(audio);
  });
  it('restores only owned metadata and deduplicates', () => {
    expect(normalizePinnedAudios([audio, audio, { ...audio, runtimeSessionId: 'other' }], 'runtime-1')).toEqual([audio]);
    expect(normalizePinnedAudios(null)).toEqual([]);
  });
  it('merges idempotently, updates same id, and ignores stale events', () => {
    expect(mergePinnedAudio([audio], audio)).toEqual([audio]);
    const updated = { ...audio, audioUrl: 'new.mp3', createdAt: 11, billing: { total_consumed_points: 3 } };
    expect(mergePinnedAudio([audio], updated)).toEqual([updated]);
    expect(mergePinnedAudio([updated], audio)).toEqual([updated]);
  });
  it('preserves speech text through event routing, merge, and persisted restore', () => {
    const withText = { ...audio, text: '完整配音文案\n第二行' };
    expect(normalizePinnedAudio({ ...withText, currentTime: 5 })).toEqual(withText);
    const routed = resolvePinnedAudioEvent(withText, new Map([['runtime-1', 'chat-1']]));
    const persisted = JSON.parse(JSON.stringify(mergePinnedAudio([], routed.audio)));
    expect(normalizePinnedAudios(persisted, 'runtime-1')).toEqual([withText]);
    for (const text of [undefined, null, 123, '', '  ']) {
      expect(normalizePinnedAudio({ ...audio, text })).toEqual(audio);
    }
  });
  it('routes by runtime only with no active-session fallback', () => {
    const map = new Map([['runtime-1', 'chat-1']]);
    expect(resolvePinnedAudioEvent(audio, map)).toEqual({ chatId: 'chat-1', audio });
    expect(resolvePinnedAudioEvent({ ...audio, runtimeSessionId: 'other' }, map)).toBeNull();
  });
  it('adapts real optional billing and duration without fabricating points', () => {
    expect(pinnedAudioToOutput(audio)).toEqual({ status: 'completed', audio_url: audio.audioUrl });
    const billing = { total_consumed_points: 2 };
    expect(pinnedAudioToOutput({ ...audio, durationSeconds: 5, billing })).toEqual({ status: 'completed', audio_url: audio.audioUrl, duration_seconds: 5, billing });
  });
});
