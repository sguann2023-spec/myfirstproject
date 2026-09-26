// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import AdmZip from 'adm-zip';
import { changePresetTime, loadPresetMetadata, presetMetadata, previewGeometry, resolvePresetTimes, resolvePresetTrack, transformSettings, videoLayerBounds, videoTrackNames } from './presetModel';
import { buildTimelineRows } from '../../renderer/src/pages/home/Inputbar/components/PinnedDraftTrackView/PinnedDraftTrackView';

vi.mock('../../renderer/src/components/PreviewTimeline/ReactTimelineEditor', () => ({ Timeline: () => null }));

const script = { tracks: [
  { id: 'v', type: 'video', name: '视频', relative_index: 3, segments: [{ id: 'v1', target_timerange: { start: 0, duration: 2e6 } }] },
  { id: 'v2', type: 'video', name: '视频2', segments: [{ id: 'v2a', render_index: -2, target_timerange: { start: 0, duration: 1e6 } }] },
  { id: 't', type: 'text', name: '文字', relative_index: 20 },
  { id: 'a', type: 'audio', name: '声音' },
] };

describe('预设尺寸和时间模型', () => {
  it('保留横竖画布比例，从微秒时长或片段范围读取秒数', () => {
    expect(presetMetadata({ canvas_config: { width: 1920, height: 1080 }, duration: 12e6 }))
      .toEqual({ width: 1920, height: 1080, duration: 12 });
    expect(presetMetadata({ canvas_config: { width: 1080, height: 1920 }, tracks: script.tracks }).duration).toBe(2);
    for (const [width, height] of [[1920, 1080], [1080, 1920]]) {
      const geometry = previewGeometry({ width, height }, { width, height });
      expect(geometry.presetWidth / geometry.presetHeight).toBeCloseTo(width / height);
      expect(geometry.presetWidth).toBe(geometry.width);
      expect(geometry.presetHeight).toBe(geometry.height);
    }
  });

  it('已有完整元数据时不下载预设', async () => {
    const data = await loadPresetMetadata({ width: 1080, height: 1920, duration_seconds: 7, url: 'https://example.test/archive.zip' }, new AbortController().signal);
    expect(data).toEqual({ width: 1080, height: 1920, duration: 7 });
  });

  it('列表缺少尺寸时从预设 ZIP 的草稿 JSON 中读取，不解压文件', async () => {
    const zip = new AdmZip();
    zip.addFile('preset_draft/draft_content.json', Buffer.from(JSON.stringify({
      canvas_config: { width: 1080, height: 1920 }, duration: 8e6,
    })));
    const bytes = zip.toBuffer();
    vi.stubGlobal('window', { require: createRequire(import.meta.url) });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    })));
    try {
      expect(await loadPresetMetadata({ url: 'https://example.test/preset.zip' }, new AbortController().signal))
        .toEqual({ width: 1080, height: 1920, duration: 8 });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('切换轨道开始时间保持时长，修改任意结束时间同步源和目标时长', () => {
    let value = resolvePresetTimes({}, 12);
    expect(value).toEqual({ sourceStart: 0, sourceEnd: 12, targetStart: 0, targetEnd: 12 });
    for (const [key, next] of [['targetStart', 5], ['sourceStart', 2], ['sourceEnd', 8], ['targetEnd', 9], ['sourceEnd', 100], ['sourceStart', 100], ['targetEnd', 0]]) {
      value = changePresetTime(value, key, next, 12);
      expect(value.sourceEnd - value.sourceStart).toBeCloseTo(value.targetEnd - value.targetStart);
      expect(value.sourceEnd).toBeLessThanOrEqual(12);
      expect(value.sourceEnd).toBeGreaterThan(value.sourceStart);
    }
  });

  it('画布坐标映射到实际像素，旋转和缩放写回设置', () => {
    const geometry = previewGeometry({ width: 1080, height: 1920 }, { width: 1080, height: 1920 });
    const node = {
      x: () => geometry.width / 2 + 100 * geometry.ratio,
      y: () => geometry.height / 2 - 200 * geometry.ratio,
      rotation: () => 45, scaleX: () => 1.5, scaleY: () => 0.75,
    };
    expect(transformSettings(node, geometry)).toEqual({
      positionX: 100, positionY: 200, rotation: 45, scaleXPercent: 150, scaleYPercent: 75,
    });
  });
});

describe('视频轨道预览', () => {
  it('只选择视频轨道，新增轨道避免所有类型的重名', () => {
    expect(videoTrackNames(script)).toEqual(['视频', '视频2']);
    expect(resolvePresetTrack({ trackName: '声音' }, script)).toMatchObject({ trackMode: 'existing', trackName: '视频', relativeIndex: null });
    expect(resolvePresetTrack({ trackMode: 'new', newTrackName: '文字' }, script)).toMatchObject({ trackName: '文字_2', relativeIndex: 4 });
    expect(resolvePresetTrack({ trackName: 'preset_track', targetStart: 0, targetEnd: 3 }, script))
      .toMatchObject({ trackMode: 'new', trackName: 'preset_track', relativeIndex: 4 });
    expect(resolvePresetTrack({ trackMode: 'existing', trackName: '视频', targetStart: 0, targetEnd: 3 }, script))
      .toMatchObject({ trackMode: 'existing', trackName: '视频' });
    expect(videoLayerBounds(script)).toEqual({ top: 4, bottom: -3 });
  });

  it('在已有视频行叠加计划片段，预览不修改原稿', () => {
    const before = JSON.stringify(script);
    const rows = buildTimelineRows(script, null, { type: 'video', trackMode: 'existing', trackName: '视频', start: 1, end: 3, text: '预设A' });
    const row = rows.find((row) => row.name === '视频');
    expect(row.actions.at(-1)).toMatchObject({ planned: true, start: 1, end: 3, overlap: true, effectId: 'video' });
    expect(JSON.stringify(script)).toBe(before);
  });

  it('新增视频轨道可置于最高或最低视频层，文字预览保留原行为', () => {
    for (const relativeIndex of [4, -3]) {
      const rows = buildTimelineRows(script, null, { type: 'video', trackMode: 'new', trackName: '预设', relativeIndex, start: 0, end: 3 });
      expect(rows.find((row) => row.name === '预设')).toMatchObject({ layer: relativeIndex, type: 'video' });
    }
    const rows = buildTimelineRows(script, null, { trackMode: 'new', trackName: '新文字', relativeIndex: 2, start: 0, end: 3 });
    expect(rows.find((row) => row.name === '新文字')).toMatchObject({ layer: 15002, type: 'text' });
  });
});
