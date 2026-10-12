import { describe, expect, it } from 'vitest';
import {
  MUSIC_REFERENCE_MAX_BYTES, buildMusicReferences, getMusicReferenceCounts,
  getMusicReferenceError, getMusicReferencesError,
} from './musicGenerateReferences';

const audio = (index, overrides = {}) => ({
  name: `ref${index}.mp3`, slotId: 'music_reference_audio',
  sourcePath: `/tmp/ref${index}.mp3`, durationSeconds: 30,
  size: MUSIC_REFERENCE_MAX_BYTES, ...overrides,
});
const voice = { kind: 'voice_id', voiceId: 'gv_1' };
const image = { name: 'ref.webp', slotId: 'music_reference_image', sourcePath: '/tmp/ref.webp' };

describe('音频生成参考素材规则', () => {
  it('支持三条音频同时带一个音色ID，音色不占音频数量', () => {
    const items = [voice, audio(1), audio(2), audio(3)];
    expect(getMusicReferencesError(items)).toBe('');
    expect(getMusicReferenceCounts(items)).toEqual({ audio: 3, image: 0, voice: 1 });
    expect(getMusicReferenceError(audio(4), items)).toContain('3 条');
    expect(getMusicReferenceError({ ...voice, voiceId: 'gv_2' }, items)).toContain('1 个');
  });
  it('30秒和10MB边界允许，超出则拒绝', () => {
    expect(getMusicReferenceError(audio(1))).toBe('');
    expect(getMusicReferenceError(audio(1, { durationSeconds: 30.01 }))).toContain('30 秒');
    expect(getMusicReferenceError(audio(1, { size: MUSIC_REFERENCE_MAX_BYTES + 1 }))).toContain('10MB');
    expect(getMusicReferenceError({ ...image, size: MUSIC_REFERENCE_MAX_BYTES + 1 })).toContain('10MB');
  });
  it.each(['wav', 'mp3', 'pcm', 'ogg_opus', 'ogg', 'opus'])('允许音频扩展名 %s', (extension) => {
    expect(getMusicReferenceError(audio(1, { name: `ref.${extension}` }))).toBe('');
  });
  it.each(['jpeg', 'jpg', 'png', 'webp'])('允许图片扩展名 %s', (extension) => {
    expect(getMusicReferenceError({ ...image, name: `ref.${extension}` })).toBe('');
  });
  it('拒绝不支持的格式', () => {
    expect(getMusicReferenceError(audio(1, { name: 'ref.m4a' }))).toContain('wav/mp3');
    expect(getMusicReferenceError({ ...image, name: 'ref.gif' })).toContain('jpeg/png');
  });
  it('图片最多一张，且不能与音频或音色混用', () => {
    expect(getMusicReferencesError([image])).toBe('');
    expect(getMusicReferencesError([image, image])).toContain('1 张');
    for (const item of [audio(1), voice]) {
      expect(getMusicReferencesError([image, item])).toContain('同时使用');
      expect(getMusicReferencesError([item, image])).toContain('同时使用');
    }
  });
  it('音频顺序不受音色卡片位置影响，分别构造参考条目', () => {
    expect(buildMusicReferences([voice, audio(2), audio(1)])).toEqual([
      { audio_url: '/tmp/ref2.mp3' }, { audio_url: '/tmp/ref1.mp3' }, { voice_id: 'gv_1' },
    ]);
  });
});
