import { dragTiming } from '../editorView';
import { clipInsertion } from '../../../shared/templateClipInsertion';
import { clipDropTarget } from './clipDrop';

export default function useClipDrag({ gesture, scrollRef, view, sceneId, pixelsPerSecond: pps,
  cursor, snap, nativeIndex, lockedTracks, disabled, onSelect, setPreview }) {
  const beginClip = (event, clip, row, edge) => {
    if (event.button !== 0 || disabled || lockedTracks.has(row.id)) return;
    event.preventDefault(); event.stopPropagation();
    // preventDefault suppresses native focus; restore it so keyboard shortcuts reach the clip.
    event.currentTarget.closest('.template-clip')?.focus({ preventScroll: true });
    onSelect(clip.id);
    gesture.current = { kind: 'clip', clip, edge, x: event.clientX, y: event.clientY,
      scroll: scrollRef.current.scrollLeft, scrollTop: scrollRef.current.scrollTop,
      sourceTrackId: row.id.startsWith('__') ? undefined : row.id, moved: false };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const moveClip = event => {
    const drag = gesture.current;
    if (!drag || drag.kind !== 'clip') return;
    if (Math.abs(event.clientX - drag.x) > 2 || Math.abs(event.clientY - drag.y) > 5) drag.moved = true;
    if (!drag.moved) return;
    const scroller = scrollRef.current;
    const bounds = scroller.getBoundingClientRect();
    if (event.clientX > bounds.right - 30) scroller.scrollLeft += 12;
    if (event.clientX < bounds.left + 180) scroller.scrollLeft -= 12;
    if (!drag.edge && sceneId) {
      if (event.clientY > bounds.bottom - 20) scroller.scrollTop += 12;
      if (event.clientY < bounds.top + 62) scroller.scrollTop -= 12;
    }
    const delta = (event.clientX - drag.x + scroller.scrollLeft - drag.scroll) / pps;
    const points = [0, view.duration, cursor, ...view.rows.flatMap(row => row.clips
      .filter(clip => clip.id !== drag.clip.id).flatMap(clip => [clip.start, clip.end]))];
    drag.value = dragTiming(drag.clip, delta, drag.edge, points, pps, event, snap);
    // Scenes are containers: hovering a composition clip moves the dragged clip into it.
    const scenes = new Map(view.rows.flatMap(row => row.clips)
      .filter(clip => clip.type === 'composition' && clip.id !== drag.clip.id).map(clip => [clip.id, clip]));
    drag.sceneDrop = null;
    if (!drag.edge && scenes.size) {
      for (const element of scroller.querySelectorAll('[data-clip-id]')) {
        if (!scenes.has(element.dataset.clipId)) continue;
        const rect = element.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) continue;
        drag.sceneDrop = { sceneId: element.dataset.clipId };
        break;
      }
    }
    if (drag.sceneDrop) {
      drag.drop = undefined;
      setPreview({ kind: 'clip', id: drag.clip.id, ...drag.value, sceneDropId: drag.sceneDrop.sceneId,
        floating: !drag.edge && Boolean(sceneId),
        offsetY: !drag.edge && sceneId ? event.clientY - drag.y + scroller.scrollTop - drag.scrollTop : 0 });
      return;
    }
    let drop = { trackId: drag.sourceTrackId };
    let shifts = [];
    if (!drag.edge && sceneId && drag.sourceTrackId) {
      const rows = [...scroller.querySelectorAll('[data-track-id]')].map(element => {
        const rect = element.getBoundingClientRect();
        return { id: element.dataset.trackId, top: rect.top, bottom: rect.bottom };
      });
      // Zero-sized rectangles occur in headless unit tests, not the rendered editor.
      if (rows.some(row => row.bottom > row.top)) drop = clipDropTarget(event.clientY, rows, lockedTracks) ?? drop;
      if (drop.trackId && !drop.invalid) {
        const clips = view.rows.find(row => row.id === drop.trackId)?.clips.filter(clip => clip.id !== drag.clip.id) ?? [];
        const native = nativeIndex.get(drag.clip.id);
        const autoFill = ['text', 'image', 'sticker'].includes(drag.clip.type) && native?.target_timerange?.duration === undefined &&
          native?.target_timerange?.end === undefined && !native?.auto_timing?.end;
        const plan = clipInsertion(drag.value.start, drag.value.duration, clips, autoFill);
        shifts = plan.shifts;
        drag.value = { start: plan.start, duration: plan.duration };
      }
    }
    drag.drop = drop;
    const innerTop = scroller.querySelector('.template-timeline-inner').getBoundingClientRect().top;
    setPreview({ kind: 'clip', id: drag.clip.id, ...drag.value, ...drop, shifts,
      floating: !drag.edge && Boolean(sceneId),
      offsetY: !drag.edge && sceneId ? event.clientY - drag.y + scroller.scrollTop - drag.scrollTop : 0,
      lineTop: drop.top === undefined ? undefined : drop.top - innerTop });
  };
  const clipAction = drag => {
    if (drag.drop?.invalid) return null;
    if (!drag.edge && drag.sceneDrop) return { type: 'move-into-scene', id: drag.clip.id,
      sceneId: drag.sceneDrop.sceneId, start: drag.value.start };
    if (!drag.edge && drag.drop?.trackId === drag.sourceTrackId &&
      Math.abs(drag.value.start - drag.clip.start) < .000001) return null;
    if (!drag.edge && sceneId && drag.sourceTrackId) return {
      type: 'move-clip', id: drag.clip.id, start: drag.value.start, duration: drag.clip.end - drag.clip.start,
      manual: true,
      ...(drag.drop?.beforeTrackId !== undefined ? { beforeTrackId: drag.drop.beforeTrackId } :
        { trackId: drag.drop?.trackId ?? drag.sourceTrackId })
    };
    return { type: 'retime', id: drag.clip.id, ...drag.value, edge: drag.edge, trackId: drag.sourceTrackId };
  };
  return { beginClip, moveClip, clipAction };
}
