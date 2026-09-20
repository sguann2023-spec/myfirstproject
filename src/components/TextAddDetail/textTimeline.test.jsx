import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import PinnedDraftTrackView, { buildTimelineRows } from '../../renderer/src/pages/home/Inputbar/components/PinnedDraftTrackView/PinnedDraftTrackView';
import { buildTextPlacementParams, DEFAULT_TEXT_PLACEMENT, getNextTextTrackRelativeIndex, getTextTrackNames, resolveTextPlacement, resolveTextTrackPlacement } from '../../shared/textPlacement';

vi.mock('../../renderer/src/components/PreviewTimeline/ReactTimelineEditor', () => ({
  Timeline: ({ editorData, getActionRender, disableDrag, hideCursor, scaleWidth }) => (
    <div data-readonly={String(disableDrag && hideCursor)} data-scale-width={scaleWidth}>
      {editorData.map((row) => <div key={row.id}>
        {row.actions.map((action) => <React.Fragment key={action.id}>{getActionRender(action, row)}</React.Fragment>)}
      </div>)}
    </div>
  ),
}));

const script = {
  duration: 12e6,
  tracks: [
    { id: 'v', name: '主视频', type: 'video', segments: [{ id: 'v1', material_id: 'vmat', render_index: 0, target_timerange: { start: 0, duration: 12e6 } }] },
    { id: 't', name: 'text_main', type: 'text', segments: [{ id: 't1', material_id: 'tmat', render_index: 15000, target_timerange: { start: 1e6, duration: 2e6 } }] },
    { id: 'a', name: '配音', type: 'audio', segments: [{ id: 'a1', render_index: 0, target_timerange: { start: 0, end: 10e6 } }] },
  ],
  materials: { texts: [{ id: 'tmat', content: '{"text":"原文字"}' }], videos: [{ id: 'vmat', name: '素材.mp4' }] },
};

describe('read-only text timeline', () => {
  it('defaults new tracks to the maximum relative index plus one across track types', () => {
    const source = { tracks: {
      text: { id: 'text', name: '文字', type: 'text', relative_index: 8, segments: [
        { id: 'clip', target_timerange: { start: 0, duration: 1e6 } },
      ] },
      video: { name: '视频', type: 'video', relative_index: 12 },
      audio: { name: '音频', type: 'audio', relativeIndex: '3' },
    } };
    const before = JSON.stringify(source);
    const placement = resolveTextTrackPlacement({ ...DEFAULT_TEXT_PLACEMENT, trackMode: 'new' }, source);
    expect(placement.relativeIndex).toBe(13);
    expect(buildTextPlacementParams(placement).relative_index).toBe(13);
    expect(buildTimelineRows(source, null, placement).slice(0, 2).map((row) => row.layer)).toEqual([15013, 15008]);
    expect(resolveTextTrackPlacement(placement, source).relativeIndex).toBe(13);
    expect(resolveTextTrackPlacement({ ...placement, relativeIndex: 5 }, source).relativeIndex).toBe(5);
    expect(JSON.stringify(source)).toBe(before);
  });
  it('derives missing text indices from render layers and ignores malformed indices', () => {
    expect(getNextTextTrackRelativeIndex({ tracks: [
      { type: 'video', render_index: 90000 },
      { type: 'text', render_index: 15004, segments: [] },
      { type: 'text', segments: [{ render_index: 15007 }, { render_index: 15009 }] },
      { type: 'text', relative_index: 'invalid', segments: [] },
    ] })).toBe(10);
    expect(getNextTextTrackRelativeIndex({ tracks: [
      { type: 'text', relative_index: 2, render_index: 15090 },
    ] })).toBe(3);
    expect(getNextTextTrackRelativeIndex({ tracks: [{ relative_index: -3 }, { relative_index: -1 }] })).toBe(0);
    expect(getNextTextTrackRelativeIndex({})).toBe(0);
    expect(resolveTextTrackPlacement(DEFAULT_TEXT_PLACEMENT, {
      tracks: [{ type: 'video', name: '视频', relative_index: 7 }],
    })).toMatchObject({ trackMode: 'new', relativeIndex: 8 });
  });
  it('converts microseconds and overlays one planned clip without mutating the source', () => {
    const before = JSON.stringify(script);
    const rows = buildTimelineRows(script, null, { start: 2, end: 4, text: '新文字' });
    expect(rows.map((row) => row.name)).toEqual(['text_main', '主视频', '配音']);
    expect(rows[0].actions[0]).toMatchObject({ meterial_name: '原文字', start: 1, end: 3 });
    expect(rows[0].actions[1]).toMatchObject({ planned: true, meterial_name: '新文字', start: 2, end: 4, overlap: true });
    expect(rows[2].actions[0]).toMatchObject({ start: 0, end: 10 });
    expect(rows.flatMap((row) => row.actions).every((action) => !action.movable && !action.flexible)).toBe(true);
    expect(JSON.stringify(script)).toBe(before);
  });
  it('places a new named track at the requested layer and keeps original clips at their layers', () => {
    const rows = buildTimelineRows(script, null, { trackName: '标题', relativeIndex: 2, start: 20, end: 25 });
    expect(rows[0]).toMatchObject({ name: '标题', layer: 15002 });
    expect(rows[0].actions[0]).toMatchObject({ meterial_name: '文字', end: 25, planned: true, overlap: false });
    expect(rows[1].actions).toHaveLength(1);
    const mismatched = buildTimelineRows(script, null, { relativeIndex: -1 });
    expect(mismatched.map((row) => row.layer)).toEqual([15000, 14999, 0, 0]);
    expect(mismatched[1].actions[0].overlap).toBe(false);
    const originalRows = buildTimelineRows(script, null);
    expect(mismatched.filter((row) => row.id !== '__planned-track')).toEqual(originalRows);
  });
  it('supports empty/object tracks and does not flag touching intervals as overlapping', () => {
    expect(buildTimelineRows({}, null, {})).toHaveLength(1);
    expect(buildTimelineRows({ tracks: { a: script.tracks[1] }, materials: script.materials }, null, { start: 3, end: 4 })[0].actions[1].overlap).toBe(false);
    expect(buildTimelineRows({ tracks: [{ id: 'empty', name: 'text_main', type: 'text', render_index: 15000, segments: [] }] }, null, {})).toHaveLength(1);
  });
  it('keeps the existing preview free of planned clips and retains media renderers', () => {
    const html = renderToStaticMarkup(<PinnedDraftTrackView preview={script} />);
    expect(html).not.toContain('data-planned');
    expect(html).toContain('data-readonly="true"');
    expect(html).toContain('data-scale-width="160"');
    expect(html).toContain('pinned-draft-track-view__segment--video');
    expect(html).toContain('pinned-draft-track-view__waveform');
    expect(renderToStaticMarkup(<PinnedDraftTrackView preview={{}} />)).toContain('暂无可预览轨道');
    expect(buildTimelineRows(script, 't1')[0].actions[0].selected).toBe(true);
  });
  it('renders the optional ghost and warnings with the shared component', () => {
    const html = renderToStaticMarkup(<PinnedDraftTrackView preview={script} plannedText={{ start: 2, end: 4 }} zoom={2} />);
    expect(html.match(/data-planned="true"/g)).toHaveLength(1);
    expect(html).toContain('data-scale-width="320"');
    expect(html).toContain('计划添加：文字，2 至 4 秒');
    expect(html).toContain('该轨道已有文字与计划时间重叠');
    expect(html.indexOf('pinned-draft-track-view__warning')).toBeLessThan(html.indexOf('pinned-draft-track-view__surface'));
    const mismatch = renderToStaticMarkup(<PinnedDraftTrackView preview={script} plannedText={{ relativeIndex: 2 }} />);
    expect(mismatch).not.toContain('pinned-draft-track-view__warning');
  });
  it('optionally hides all non-text tracks without changing the general draft preview', () => {
    const before = JSON.stringify(script);
    const textOnly = renderToStaticMarkup(<PinnedDraftTrackView preview={script} plannedText={{}} textTracksOnly />);
    expect(textOnly).toContain('原文字');
    expect(textOnly).toContain('data-planned="true"');
    expect(textOnly).not.toContain('pinned-draft-track-view__segment--video');
    expect(textOnly).not.toContain('pinned-draft-track-view__waveform');
    const general = renderToStaticMarkup(<PinnedDraftTrackView preview={script} />);
    expect(general).toContain('pinned-draft-track-view__segment--video');
    expect(general).toContain('pinned-draft-track-view__waveform');
    expect(JSON.stringify(script)).toBe(before);
  });
  it('checks only the destination row even when multiple tracks have the same name', () => {
    const duplicate = {
      ...script,
      tracks: [...script.tracks, {
        id: 't2', name: 'text_main', type: 'text', segments: [{
          id: 't2-clip', render_index: 15001, target_timerange: { start: 5e6, duration: 1e6 },
        }],
      }],
    };
    const getGhost = (settings) => buildTimelineRows(duplicate, null, settings)
      .flatMap((row) => row.actions).find((action) => action.planned);
    expect(getGhost({ relativeIndex: 1, start: 1, end: 2 }).overlap).toBe(false);
    expect(getGhost({ relativeIndex: 1, start: 5, end: 6 }).overlap).toBe(true);
    expect(getGhost({ trackName: '新轨道', start: 1, end: 2 }).overlap).toBe(false);
  });
  it('does not report floating-point boundary contact as an overlap', () => {
    const fractional = { tracks: [{
      id: 't', name: 'text_main', type: 'text', segments: [{
        id: 'fraction', render_index: 15000, target_timerange: { start: 100000, duration: 200000 },
      }],
    }] };
    const getGhost = (start, end) => buildTimelineRows(fractional, null, { start, end })[0].actions[1];
    expect(getGhost(0.3, 0.5).overlap).toBe(false);
    expect(getGhost(0, 0.1).overlap).toBe(false);
    expect(getGhost(0.29, 0.5).overlap).toBe(true);
  });
  it('normalizes time and layer boundaries and submits matching field names', () => {
    expect(buildTextPlacementParams({ trackName: ' 标题 ', relativeIndex: -3, start: 1.25, end: 4.5 }))
      .toEqual({ track_name: '标题', relative_index: -3, start: 1.25, end: 4.5 });
    expect(resolveTextPlacement({ trackName: '', start: -3, end: 0 })).toMatchObject({ trackName: 'text_main', start: 0, end: 0.01 });
    expect(resolveTextPlacement({ start: Infinity, relativeIndex: 1.6 })).toMatchObject({ start: 0, relativeIndex: 2 });
    expect(resolveTextPlacement({ start: 90000, end: -1 })).toMatchObject({ start: 86399.99, end: 86400 });
  });
  it('selects an existing text track without submitting or previewing a layer change', () => {
    const source = { tracks: [{
      id: 't', name: '旧轨道', type: 'text', segments: [{
        id: 'clip', render_index: 0, target_timerange: { start: 0, duration: 3e6 },
      }],
    }] };
    const placement = resolveTextTrackPlacement({ relativeIndex: 5 }, source);
    expect(placement).toMatchObject({ trackMode: 'existing', trackName: '旧轨道' });
    expect(buildTextPlacementParams(placement)).toEqual({ track_name: '旧轨道', start: 0, end: 3 });
    const rows = buildTimelineRows(source, null, placement);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ layer: 0 });
    expect(rows[0].actions[1]).toMatchObject({ planned: true, overlap: true });
  });
  it('creates unique names across track types and submits layers only for new tracks', () => {
    const source = { tracks: [
      ...script.tracks,
      { name: 'text_main_2', type: 'video' },
      { name: '', type: 'text' },
    ] };
    expect(getTextTrackNames(source)).toEqual(['text_main']);
    const placement = resolveTextTrackPlacement({ trackMode: 'new', newTrackName: 'text_main', relativeIndex: 3 }, source);
    expect(placement.trackName).toBe('text_main_3');
    expect(buildTextPlacementParams(placement)).toEqual({ track_name: 'text_main_3', relative_index: 3, start: 0, end: 3 });
    const rows = buildTimelineRows(source, null, placement);
    expect(rows[0]).toMatchObject({ name: 'text_main_3', layer: 15003 });
    expect(rows[0].actions[0]).toMatchObject({ planned: true, overlap: false });
  });
  it('falls back when switching drafts and supports empty or object-shaped tracks', () => {
    expect(resolveTextTrackPlacement({}, {})).toMatchObject({ trackMode: 'new', trackName: 'text_main' });
    expect(resolveTextTrackPlacement({ trackMode: 'existing', trackName: '已删除' }, script))
      .toMatchObject({ trackMode: 'existing', trackName: 'text_main' });
    const objectScript = { tracks: { t: script.tracks[1] } };
    expect(getTextTrackNames(objectScript)).toEqual(['text_main']);
    expect(resolveTextTrackPlacement({ trackMode: 'new', newTrackName: '' }, objectScript))
      .toMatchObject({ trackMode: 'new', trackName: 'text_main_2', newTrackName: '' });
    const longName = 'a'.repeat(100);
    expect(resolveTextTrackPlacement({ trackMode: 'new', newTrackName: longName }, { tracks: [{ name: longName }] }).trackName)
      .toBe(`${'a'.repeat(98)}_2`);
  });
});
