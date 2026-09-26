export const tracksOf = (script) => Array.isArray(script?.tracks) ? script.tracks : Object.values(script?.tracks || {});
const nameOf = (track) => String(track?.name || track?.track_name || '').trim();
const positive = (value) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
const round = (value) => Math.round(value * 100) / 100;

export function presetMetadata(preset = {}) {
  const draft = preset.draft || preset.draft_content || preset;
  const canvas = draft.canvas_config || preset.canvas_config || preset;
  const width = positive(canvas.width);
  const height = positive(canvas.height);
  const ends = tracksOf(draft).flatMap((track) => (track.segments || []).map((segment) => {
    const range = segment.target_timerange || {};
    return Number(range.start || 0) + Number(range.duration || 0);
  }));
  const duration = positive(preset.duration_seconds) ||
    (positive(draft.duration) || positive(Math.max(0, ...ends))) / 1e6 || null;
  console.log('[presetModel] presetMetadata 解析', {
    preset_duration_seconds: preset.duration_seconds,
    draft_duration: draft.duration,
    ends,
    ends_max: ends.length ? Math.max(0, ...ends) : null,
    canvas_width: canvas.width,
    canvas_height: canvas.height,
    result: { width, height, duration },
  });
  return { width, height, duration };
}

export async function loadPresetMetadata(preset, signal) {
  const metadata = presetMetadata(preset);
  if (metadata.width && metadata.height && metadata.duration) return metadata;
  if (!preset?.url) return metadata;
  const url = new URL(preset.url);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('预设地址无效');
  const response = await fetch(url.href, { signal });
  if (!response.ok) throw new Error('预设尺寸和时长读取失败');
  const data = await response.arrayBuffer();
  if (signal.aborted) throw new Error('预设读取已取消');
  const require = window.require;
  if (!require) throw new Error('请在桌面端读取预设尺寸和时长');
  const Zip = require('adm-zip');
  const { Buffer } = require('buffer');
  // 显式指定二进制输入，避免 ZIP 构造函数将其作为配置对象处理。
  const zip = new Zip({ input: Buffer.from(data) });
  // 只在内存中读取草稿 JSON，不解压素材，也不执行预设内的内容。
  const entry = zip.getEntries().find((item) => /(?:^|\/)preset_draft\/draft_content\.json$/i.test(item.entryName)) ||
    zip.getEntries().find((item) => /(?:^|\/)draft_content\.json$/i.test(item.entryName));
  if (!entry || entry.header.size > 20 * 1024 * 1024) throw new Error('预设中缺少有效草稿信息');
  const parsedJson = JSON.parse(entry.getData().toString('utf8'));
  console.log('[presetModel] loadPresetMetadata 读取到 draft_content.json', {
    entry_name: entry.entryName,
    entry_size: entry.header.size,
    top_level_keys: Object.keys(parsedJson || {}),
    has_canvas_config: Boolean(parsedJson?.canvas_config),
    canvas_config: parsedJson?.canvas_config,
    duration: parsedJson?.duration,
    tracks_count: Array.isArray(parsedJson?.tracks) ? parsedJson.tracks.length : Object.keys(parsedJson?.tracks || {}).length,
  });
  const parsed = presetMetadata(parsedJson);
  const result = Object.fromEntries(Object.keys(metadata).map((key) => [key, parsed[key] || metadata[key]]));
  console.log('[presetModel] loadPresetMetadata 合并结果', { parsed, fallback: metadata, result });
  if (!result.duration) throw new Error('预设草稿缺少有效时长');
  return result;
}

export const videoTrackNames = (script) => [...new Set(tracksOf(script)
  .filter((track) => String(track.type).toLowerCase() === 'video').map(nameOf).filter(Boolean))];

export function videoLayerBounds(script) {
  const indices = tracksOf(script).filter((track) => String(track.type).toLowerCase() === 'video')
    .flatMap((track) => {
      const relative = track.relative_index ?? track.relativeIndex;
      const values = relative != null ? [relative] : [track.render_index, ...(track.segments || []).map((segment) => segment.render_index)];
      return values.filter((value) => value != null && value !== '' && Number.isFinite(Number(value))).map(Number);
    });
  return { top: indices.length ? Math.max(...indices) + 1 : 0, bottom: indices.length ? Math.min(...indices) - 1 : 0 };
}

export function resolvePresetTrack(value, script) {
  const names = videoTrackNames(script);
  const existing = names.includes(value.trackName) ? value.trackName : names[0];
  const occupied = !value.trackMode && tracksOf(script).some((track) =>
    String(track.type).toLowerCase() === 'video' && nameOf(track) === existing &&
    (track.segments || []).some((segment) => {
      const range = segment.target_timerange || {};
      const start = Number(range.start || 0);
      const end = range.duration != null ? start + Number(range.duration) : Number(range.end || 0);
      return start < Math.round(value.targetEnd * 1e6) && end > Math.round((value.targetStart || 0) * 1e6);
    }));
  if (value.trackMode !== 'new' && existing && !occupied) {
    return { ...value, trackMode: 'existing', trackName: existing, relativeIndex: null };
  }
  const used = new Set(tracksOf(script).map(nameOf));
  const base = String(value.newTrackName ?? value.trackName ?? 'preset_track').trim().slice(0, 100) || 'preset_track';
  let name = base;
  let count = 2;
  while (used.has(name)) {
    const suffix = `_${count++}`;
    name = base.slice(0, 100 - suffix.length) + suffix;
  }
  return { ...value, trackMode: 'new', trackName: name, newTrackName: value.newTrackName ?? name,
    relativeIndex: value.relativeIndex ?? videoLayerBounds(script).top };
}

export function resolvePresetTimes(value, duration) {
  const limit = Math.max(0.01, Math.floor((positive(duration) || 86400) * 100) / 100);
  const sourceStart = round(Math.min(limit - 0.01, Math.max(0, Number(value.sourceStart) || 0)));
  const sourceEnd = round(Math.min(limit, Math.max(sourceStart + 0.01, Number(value.sourceEnd) || limit)));
  const targetStart = round(Math.max(0, Math.min(86400 - (sourceEnd - sourceStart), Number(value.targetStart) || 0)));
  return { sourceStart, sourceEnd, targetStart, targetEnd: round(targetStart + sourceEnd - sourceStart) };
}

export function changePresetTime(value, key, next, duration) {
  if (next == null || !Number.isFinite(Number(next))) return value;
  const times = resolvePresetTimes(value, duration);
  if (key === 'targetEnd') {
    return { ...value, ...resolvePresetTimes({ ...times, sourceEnd: times.sourceStart + Math.max(0.01, next - times.targetStart) }, duration) };
  }
  return { ...value, ...resolvePresetTimes({ ...times, [key]: next }, duration) };
}

export function previewGeometry(canvas, metadata) {
  const width = positive(canvas?.width) || 1080;
  const height = positive(canvas?.height) || 1920;
  const ratio = Math.min(168 / width, 280 / height);
  return { width: width * ratio, height: height * ratio, ratio,
    presetWidth: (positive(metadata?.width) || width) * ratio,
    presetHeight: (positive(metadata?.height) || height) * ratio };
}

export function transformSettings(node, geometry) {
  return {
    positionX: Math.round(Math.min(10000, Math.max(-10000, (node.x() - geometry.width / 2) / geometry.ratio))),
    positionY: Math.round(Math.min(10000, Math.max(-10000, (geometry.height / 2 - node.y()) / geometry.ratio))),
    rotation: Math.round(((node.rotation() + 180) % 360 + 360) % 360 - 180),
    scaleXPercent: Math.min(500, Math.max(1, node.scaleX() * 100)),
    scaleYPercent: Math.min(500, Math.max(1, node.scaleY() * 100)),
  };
}
