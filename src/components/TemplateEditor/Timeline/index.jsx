import React, { useEffect, useRef, useState } from 'react';
import { ChevronRight, CornerDownLeft, GripVertical, Layers, Link2, LockKeyhole, Minus, Plus, SkipBack, Trash2, UnlockKeyhole } from 'lucide-react';
import { snapTime } from '../editorView';
import { elementIcons } from '../elementIcons';
import TimelineRuler, { rulerScale } from './TimelineRuler';
import TimelinePlayhead from './TimelinePlayhead';
import TimelineScrollbar from './TimelineScrollbar';
import useTimelineViewport from './useTimelineViewport';
import useClipDrag from './useClipDrag';
import { MAX_ZOOM, MIN_ZOOM, ZOOM_STEP } from './viewport';
import './Timeline.css';

const timeLabel = value => Number(value.toFixed(3)).toString();
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export default function EditorTimeline({ view, selectedId, sceneId, nativeIndex, onSelect, onEnter, onAction, onAddScene,
  disabled, lockedTracks, onLock }) {
  const [cursor, setCursor] = useState(0);
  const snap = true;
  const [height, setHeight] = useState(260);
  const [preview, setPreview] = useState(null);
  const [durationOpen, setDurationOpen] = useState(false);
  const [durationValue, setDurationValue] = useState('');
  const [dropTrack, setDropTrack] = useState(null);
  const [menu, setMenu] = useState(null);
  const scrollRef = useRef(null);
  const gesture = useRef(null);
  const trackDrag = useRef(null);
  const suppressClick = useRef(false);
  const { zoom, width, scrollLeft, canvasWidth, axisEnd, pixelsPerSecond: pps, setZoom, onScroll, onHorizontalScroll } =
    useTimelineViewport(scrollRef, view.duration, sceneId, gesture);
  const clipDrag = useClipDrag({ gesture, scrollRef, view, sceneId, pixelsPerSecond: pps,
    cursor, snap, nativeIndex, lockedTracks, disabled, onSelect, setPreview });
  useEffect(() => {
    const cancel = event => {
      if (event.key !== 'Escape') return;
      if (gesture.current || menu || durationOpen) {
        event.preventDefault(); event.stopPropagation();
        gesture.current = null; setPreview(null); setMenu(null); setDurationOpen(false);
      }
    };
    const closeMenu = () => setMenu(null);
    window.addEventListener('keydown', cancel, true);
    window.addEventListener('pointerdown', closeMenu);
    return () => { window.removeEventListener('keydown', cancel, true); window.removeEventListener('pointerdown', closeMenu); };
  }, [menu, durationOpen]);
  useEffect(() => {
    setCursor(0); setPreview(null); gesture.current = null; setDurationOpen(false);
  }, [sceneId]);
  useEffect(() => { setCursor(value => Math.min(value, view.duration)); }, [view.duration]);
  const { marks } = rulerScale(pps, axisEnd, scrollLeft / pps, (scrollLeft + width) / pps);
  const points = [0, view.duration, cursor, ...view.rows.flatMap(row => row.clips.flatMap(clip => [clip.start, clip.end]))];
  const setTime = value => setCursor(clamp(Number.isFinite(value) ? value : 0, 0, axisEnd));
  const beginCursor = event => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const ruler = scrollRef.current.querySelector('.template-ruler');
    ruler.focus({ preventScroll: true });
    const left = ruler.getBoundingClientRect().left;
    setTime(snapTime((event.clientX - left) / pps, points, pps, event, snap));
    gesture.current = { kind: 'cursor', left, scroll: scrollRef.current.scrollLeft };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const finish = (event, cancel = false) => {
    const drag = gesture.current;
    gesture.current = null;
    setPreview(null);
    if (!drag) return;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (cancel || !drag.moved) return;
    suppressClick.current = true;
    if (drag.kind === 'clip') {
      const action = clipDrag.clipAction(drag);
      if (action) onAction(action);
    }
    if (drag.kind === 'duration') onAction({ type: 'duration', id: sceneId, duration: drag.value });
  };
  const move = event => {
    const drag = gesture.current;
    if (!drag) return;
    if (drag.kind === 'height') { setHeight(clamp(drag.height + drag.y - event.clientY, 170, window.innerHeight - 150)); return; }
    if (drag.kind === 'cursor') {
      setTime(snapTime((event.clientX - drag.left + scrollRef.current.scrollLeft - drag.scroll) / pps, points, pps, event, snap));
      drag.moved = true; return;
    }
    if (drag.kind === 'clip') { clipDrag.moveClip(event); return; }
    if (Math.abs(event.clientX - drag.x) > 2 || Math.abs(event.clientY - drag.y) > 5) drag.moved = true;
    if (!drag.moved) return;
    const scroller = scrollRef.current;
    const bounds = scroller.getBoundingClientRect();
    if (event.clientX > bounds.right - 30) scroller.scrollLeft += 12;
    if (event.clientX < bounds.left + 180) scroller.scrollLeft -= 12;
    const delta = (event.clientX - drag.x + scroller.scrollLeft - drag.scroll) / pps;
    if (drag.kind === 'duration') {
      drag.value = Math.max(.01, snapTime(view.duration + delta, points.filter(value => value !== view.duration), pps, event, snap));
      setPreview({ kind: 'duration', value: drag.value });
      return;
    }
  };
  const beginClip = (event, clip, row, edge) => {
    suppressClick.current = false;
    clipDrag.beginClip(event, clip, row, edge);
  };
  const currentNative = nativeIndex.get(sceneId);
  const autoDuration = sceneId ? currentNative?.auto_duration : !nativeIndex.get('__root__')?.duration;
  return <section className="template-edit-timeline" aria-label="时间轴" style={{ height }}>
    <div className="template-timeline-resize" role="separator" aria-label="调整时间轴高度" aria-orientation="horizontal"
      tabIndex={0} aria-valuenow={height} aria-valuemin={170} aria-valuemax={Math.max(170, window.innerHeight - 150)}
      onKeyDown={event => {
        if (['ArrowUp', 'ArrowDown'].includes(event.key)) {
          event.preventDefault(); setHeight(value => clamp(value + (event.key === 'ArrowUp' ? 20 : -20), 170, window.innerHeight - 150));
        }
      }}
      onPointerDown={event => { gesture.current = { kind: 'height', y: event.clientY, height }; event.currentTarget.setPointerCapture?.(event.pointerId); }}
      onPointerMove={move} onPointerUp={finish} onPointerCancel={event => finish(event, true)} />
    <div className="template-timeline-heading">
      <nav className="template-scene-path" aria-label="Scene 路径">
        <button aria-label="打开模版时间轴" aria-current={sceneId === null ? 'page' : undefined} onClick={() => onEnter(null)}><Layers size={14} />模版</button>
        {view.path.map(node => <React.Fragment key={node.id}><ChevronRight size={12} />
          <button aria-current={sceneId === node.id ? 'page' : undefined} title={node.name} onClick={() => onEnter(node.id)}>{node.name}</button>
        </React.Fragment>)}
      </nav>
      <span className="template-timeline-duration">总时长 {timeLabel(view.duration)} 秒</span>
      <button className="template-timeline-button" aria-label="缩小时间轴" disabled={zoom <= MIN_ZOOM} onClick={() => setZoom(zoom / ZOOM_STEP)}><Minus size={15} /></button>
      <button className="template-timeline-button" aria-label="放大时间轴" disabled={zoom >= MAX_ZOOM} onClick={() => setZoom(zoom * ZOOM_STEP)}><Plus size={15} /></button>
    </div>
    <div className="template-timeline-scroll" ref={scrollRef} onScroll={onScroll}>
      <div className="template-timeline-inner" style={{ width: canvasWidth + 164 }}>
        <div className="template-ruler-row">
          <div className="template-time-controls">
            <button aria-label="游标回到开始" onClick={() => setTime(0)}><SkipBack size={15} /></button>
            <input aria-label="当前时间（秒）" type="number" step="0.1" min={0} max={axisEnd}
              value={Number(cursor.toFixed(3))} onChange={event => setTime(event.currentTarget.valueAsNumber)} />
            <span>s</span>
          </div>
          <div className="template-ruler" role="slider" aria-label="时间轴游标" tabIndex={0}
            aria-valuemin={0} aria-valuemax={axisEnd} aria-valuenow={cursor}
            onKeyDown={event => {
              if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                setTime(event.key === 'Home' ? 0 : event.key === 'End' ? view.duration :
                  cursor + (event.key === 'ArrowRight' ? .1 : -.1));
              }
            }}
            onPointerDown={beginCursor}
            onPointerMove={move} onPointerUp={finish} onPointerCancel={event => finish(event, true)}>
            <TimelineRuler marks={marks} pixelsPerSecond={pps} />
            <button className="template-duration-handle" style={{ left: (preview?.kind === 'duration' ? preview.value : view.duration) * pps }}
              aria-label="调整场景时长" title={autoDuration ? '自动时长；拖动改为固定时长' : '拖动调整场景时长'} disabled={disabled}
              onClick={event => {
                event.stopPropagation();
                if (suppressClick.current) { suppressClick.current = false; return; }
                setDurationValue(timeLabel(view.duration)); setDurationOpen(value => !value);
              }}
              onPointerDown={event => {
                if (event.button !== 0) return;
                event.preventDefault(); event.stopPropagation(); suppressClick.current = false;
                gesture.current = { kind: 'duration', x: event.clientX, y: event.clientY, scroll: scrollRef.current.scrollLeft };
                event.currentTarget.setPointerCapture?.(event.pointerId);
              }}
              onPointerMove={move} onPointerUp={finish} onPointerCancel={event => finish(event, true)}>
              {autoDuration && <span className="template-duration-label">Auto</span>}
            </button>
          </div>
        </div>
        <div className="template-outside-scene" style={{ left: 164 + view.duration * pps }} />
        {view.rows.map(row => {
          const locked = lockedTracks.has(row.id);
          return <div className={`template-track-row ${locked ? 'is-locked' : ''} ${dropTrack === row.id ? 'is-drop-target' : ''} ${preview?.floating && preview.trackId === row.id && !preview.invalid ? 'is-clip-drop-target' : ''}`}
            data-track-id={row.id} key={row.id}
            onDragOver={event => {
              if (trackDrag.current && trackDrag.current !== row.id && !row.id.startsWith('__') && !locked) { event.preventDefault(); setDropTrack(row.id); }
            }}
            onDragLeave={() => setDropTrack(null)}
            onDrop={event => {
              event.preventDefault(); setDropTrack(null);
              if (trackDrag.current && trackDrag.current !== row.id && !locked) onAction({ type: 'reorder-track', id: trackDrag.current, beforeId: row.id });
              trackDrag.current = null;
            }}>
            <div className={`template-track-label ${selectedId === row.id ? 'is-selected' : ''}`}>
              <button className="template-track-grip" aria-label={`拖动排序 ${row.name}`} disabled={disabled || locked || row.id.startsWith('__')}
                draggable={!disabled && !locked && !row.id.startsWith('__')}
                onDragStart={event => { trackDrag.current = row.id; event.dataTransfer.setData('text/plain', row.id); }}
                onDragEnd={() => { trackDrag.current = null; setDropTrack(null); }}><GripVertical size={13} /></button>
              <button className="template-track-select" aria-label={`选择轨道 ${row.name}`} title={row.name}
                onClick={() => onSelect(row.id.startsWith('__') ? '' : row.id)}><b>{row.track + 1}</b><span>{row.name}</span></button>
              <button className="template-track-lock" aria-label={`${locked ? '解锁' : '锁定'}轨道 ${row.name}`} title="仅锁定编辑，不影响导出"
                aria-pressed={locked} onClick={() => onLock(row.id)}>{locked ? <LockKeyhole size={12} /> : <UnlockKeyhole size={12} />}</button>
            </div>
            <div className="template-track-lane">
              {row.clips.map(clip => {
                const Icon = elementIcons[clip.type] || Layers;
                const active = preview?.kind === 'clip' && preview.id === clip.id;
                const shifted = preview?.trackId === row.id ? preview.shifts?.find(shift => shift.id === clip.id) : null;
                const start = active ? preview.start : shifted?.start ?? clip.start;
                const end = active ? preview.start + preview.duration : shifted ? shifted.start + shifted.duration : clip.end;
                const native = nativeIndex.get(clip.id);
                return <button key={clip.id} data-clip-id={clip.id}
                  className={`template-clip ${clip.type === 'composition' ? 'template-clip--scene' : ''} ${selectedId === clip.id ? 'is-selected' : ''} ${active ? 'is-dragging' : ''} ${active && preview.floating ? 'is-floating' : ''}`}
                  style={{ left: start * pps, width: Math.max(3, (end - start) * pps),
                    transform: active && preview.floating ? `translateY(${preview.offsetY}px)` : undefined }}
                  title={`${clip.name} · ${timeLabel(start)}–${timeLabel(end)} 秒${clip.type === 'composition' ? ' · 双击进入' : ''}`}
                  aria-label={`${clip.name}，${timeLabel(start)} 到 ${timeLabel(end)} 秒`}
                  onContextMenu={event => {
                    event.preventDefault(); onSelect(clip.id);
                    setMenu({ clip, locked, x: Math.min(event.clientX, window.innerWidth - 190), y: Math.min(event.clientY, window.innerHeight - 90) });
                  }}
                  onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } onSelect(clip.id); }}
                  onDoubleClick={() => { if (clip.type === 'composition') onEnter(clip.id); }}
                  onKeyDown={event => {
                    if (event.key === 'Enter' && clip.type === 'composition') { event.preventDefault(); onEnter(clip.id); }
                    if (['ArrowLeft', 'ArrowRight'].includes(event.key) && !locked && !disabled) {
                      event.preventDefault();
                      onAction({ type: 'retime', id: clip.id, start: Math.max(0, clip.start + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 1 : .1)),
                        duration: clip.end - clip.start });
                    }
                  }}
                  onPointerDown={event => beginClip(event, clip, row)}
                  onPointerMove={move} onPointerUp={finish} onPointerCancel={event => finish(event, true)}>
                  <span className="template-clip-edge template-clip-edge--start" aria-label={`调整 ${clip.name} 开始`}
                    onPointerDown={event => beginClip(event, clip, row, 'start')} />
                  {native?.auto_timing?.start ? <Link2 size={12} /> : <Icon size={13} />}
                  <span className="template-clip-title">{clip.name}{clip.text && <small>{clip.text}</small>}</span>
                  {native?.auto_timing?.end && <Link2 size={12} />}
                  {clip.type === 'composition' && <CornerDownLeft size={12} />}
                  <span className="template-clip-edge template-clip-edge--end" aria-label={`调整 ${clip.name} 结束`}
                    onPointerDown={event => beginClip(event, clip, row, 'end')} />
                </button>;
              })}
            </div>
          </div>;
        })}
        {preview?.floating && preview.lineTop !== undefined &&
          <div className="template-clip-drop-line" style={{ top: preview.lineTop }} />}
        <button className="template-add-scene" aria-label="添加 Scene" disabled={disabled} onClick={onAddScene}
          style={{ left: 164 + view.duration * pps }}><Plus size={14} />添加 Scene</button>
        <TimelinePlayhead left={164 + cursor * pps} hidden={cursor * pps < scrollLeft} onPointerDown={beginCursor} onPointerMove={move}
          onPointerUp={finish} onPointerCancel={event => finish(event, true)} />
      </div>
    </div>
    <TimelineScrollbar width={width} canvasWidth={canvasWidth} scrollLeft={scrollLeft} onScroll={onHorizontalScroll} />
    {durationOpen && <form className="template-duration-popover" onSubmit={event => {
      event.preventDefault(); onAction({ type: 'duration', id: sceneId, duration: Number(durationValue) }); setDurationOpen(false);
    }}>
      <label>场景时长（秒）<input autoFocus type="number" min=".01" step=".01" value={durationValue} onChange={event => setDurationValue(event.target.value)} /></label>
      <button type="submit">确定</button><button type="button" onClick={() => { onAction({ type: 'duration', id: sceneId, duration: 'auto' }); setDurationOpen(false); }}>自动</button>
      <button type="button" onClick={() => setDurationOpen(false)}>取消</button>
    </form>}
    {menu && <div className="template-context-menu" role="menu" style={{ left: menu.x, top: menu.y }}
      onPointerDown={event => event.stopPropagation()}>
      {menu.clip.type === 'composition' && <button role="menuitem" onClick={() => { onEnter(menu.clip.id); setMenu(null); }}><Layers size={14} />进入 Scene</button>}
      <button role="menuitem" disabled={disabled || menu.locked} onClick={() => { onAction({ type: 'delete', id: menu.clip.id }); setMenu(null); }}><Trash2 size={14} />删除 <small>Del</small></button>
    </div>}
  </section>;
}
