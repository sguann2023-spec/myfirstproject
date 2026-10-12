export const MUSIC_REFERENCE_MAX_BYTES = 10 * 1024 * 1024;
export const MUSIC_AUDIO_ACCEPT = '.wav,.mp3,.pcm,.ogg,.opus,.ogg_opus';
export const MUSIC_IMAGE_ACCEPT = '.jpg,.jpeg,.png,.webp';

const audioExtensions = new Set(['wav', 'mp3', 'pcm', 'ogg', 'opus', 'ogg_opus']);
const imageExtensions = new Set(['jpg', 'jpeg', 'png', 'webp']);
const extensionOf = (item) => String(item?.name || item?.originFileObj?.name || '')
  .split('.').pop().toLowerCase();

export const getMusicReferenceKind = (item) => {
  if (item?.kind === 'voice_id' || item?.slotId === 'music_reference_voice_id') return 'voice';
  if (item?.slotId === 'music_reference_audio') return 'audio';
  if (item?.slotId === 'music_reference_image') return 'image';
  const extension = extensionOf(item);
  if (audioExtensions.has(extension)) return 'audio';
  if (imageExtensions.has(extension)) return 'image';
  return '';
};

export const getMusicReferenceCounts = (items = []) => items.reduce((counts, item) => {
  const kind = getMusicReferenceKind(item);
  if (kind) counts[kind] += 1;
  return counts;
}, { audio: 0, image: 0, voice: 0 });

export const getMusicReferenceError = (item, existing = []) => {
  const kind = getMusicReferenceKind(item);
  const counts = getMusicReferenceCounts(existing);
  if (!kind) return '参考音频支持 wav/mp3/pcm/ogg_opus，参考图片支持 jpeg/png/webp';
  if (kind === 'image' && !imageExtensions.has(extensionOf(item))) return '参考图片仅支持 jpeg/png/webp';
  if (kind === 'audio' && !audioExtensions.has(extensionOf(item))) return '参考音频仅支持 wav/mp3/pcm/ogg_opus';
  if (kind !== 'voice' && Number(item?.size ?? item?.originFileObj?.size ?? 0) > MUSIC_REFERENCE_MAX_BYTES) {
    return '单条参考音频或图片大小不能超过 10MB';
  }
  if (kind === 'audio' && Number(item?.durationSeconds || 0) > 30) return '单条参考音频时长不能超过 30 秒';
  if (kind === 'image' && (counts.audio || counts.voice)) return '参考图片不能与参考音频或音色ID同时使用';
  if (kind !== 'image' && counts.image) return '参考音频或音色ID不能与参考图片同时使用';
  if (kind === 'audio' && counts.audio >= 3) return '最多上传 3 条参考音频';
  if (kind === 'image' && counts.image >= 1) return '最多上传 1 张参考图片';
  if (kind === 'voice' && counts.voice >= 1) return '最多选择 1 个音色ID';
  return '';
};

export const getMusicReferencesError = (items = []) => {
  const accepted = [];
  for (const item of items) {
    const error = getMusicReferenceError(item, accepted);
    if (error) return error;
    accepted.push(item);
  }
  return '';
};

export const buildMusicReferences = (items = []) => {
  // Audio numbering follows audio upload order, independent of the voice card position.
  const audio = [];
  const image = [];
  const voice = [];
  items.forEach((item) => {
    const kind = getMusicReferenceKind(item);
    const url = String(item?.url || item?.sourcePath || '').trim();
    if (kind === 'audio' && url) audio.push({ audio_url: url });
    if (kind === 'image' && url) image.push({ image_url: url });
    if (kind === 'voice' && item?.voiceId && voice.length === 0) voice.push({ voice_id: item.voiceId });
  });
  // The relay maps the global voice_id to the upstream speaker ID.
  return [...audio, ...voice, ...image];
};
