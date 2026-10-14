import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronRight, CornerDownLeft, GripVertical, Layers, Link2, LockKeyhole, Magnet, Maximize2, Minus, Plus, SkipBack, Trash2, UnlockKeyhole } from 'lucide-react';
import { dragTiming, snapTime } from './editorView';
import { elementIcons } from './LayerPanel';

const timeLabel = value => Number(value.toFixed(3)).toString();
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export default function EditorTimeline({ view, selectedId, sceneId, nativeIndex, onSelect, onEnter, onAction, onAddScene,
  disabled, lockedTracks, onLock }) {
  const [cursor, setCursor] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [snap, setSnap] = useState(true);
  const [width, setWidth] = useState(700);
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
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return undefined;
    const update = () => setWidth(Math.max(240, element.clientWidth - 164));
    update();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setCursor(0); setPreview(null); gesture.current = null; setDurationOpen(false);
    if (scrollRef.current) scrollRef.current.scrollLeft = 0;
  }, [sceneId]);
  useEffect(() => { setCursor(value => Math.min(value, view.duration)); }, [view.duration]);
  const axisEnd = Math.max(5, Math.ceil(view.duration * 1.1));
  const canvasWidth = width * zoom;
  const pps = canvasWidth / axisEnd;
  const rawStep = 80 / pps;
  const power = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 5, 10].map(value => value * power).find(value => value >= rawStep) || power * 10;
  const ticks = Array.from({ length: Math.floor(axisEnd / step) + 1 }, (_, i) => i * step);
  const points = [0, view.duration, cursor, ...view.rows.flatMap(row => row.clips.flatMap(clip => [clip.start, clip.end]))];
  const setTime = value => setCursor(clamp(Number.isFinite(value) ? value : 0, 0, axisEnd));
  const finish = (event, cancel = false) => {
    const drag = gesture.current;
    gesture.current = null;
    setPreview(null);
    if (!drag) return;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (cancel || !drag.moved) return;
    suppressClick.current = true;
    if (drag.kind === 'clip') onAction({ type: 'retime', id: drag.clip.id, ...drag.value, edge: drag.edge, trackId: drag.trackId });
    if (drag.kind === 'duration') onAction({ type: 'duration', id: sceneId, duration: drag.value });
  };
  const move = event => {
    const drag = gesture.current;
    if (!drag) return;
    if (drag.kind === 'height') { setHeight(clamp(drag.height + drag.y - event.clientY, 170, window.innerHeight - 150)); return; }
    if (drag.kind === 'cursor') {
      setTime(snapTime((event.clientX - drag.left) / pps, points, pps, event, snap));
      drag.moved = true; return;
    }
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
    const clipPoints = [0, view.duration, cursor, ...view.rows.flatMap(row =>
      row.clips.filter(clip => clip.id !== drag.clip.id).flatMap(clip => [clip.start, clip.end]))];
    drag.value = dragTiming(drag.clip, delta, drag.edge, clipPoints, pps, event, snap);
    if (!drag.edge && sceneId) {
      const row = document.elementFromPoint?.(event.clientX, event.clientY)?.closest('[data-track-id]');
      const id = row?.dataset.trackId;
      drag.trackId = id && !id.startsWith('__') && !lockedTracks.has(id) ? id : drag.sourceTrackId;
    }
    setPreview({ kind: 'clip', id: drag.clip.id, ...drag.value, trackId: drag.trackId });
  };
  const beginClip = (event, clip, row, edge) => {
    if (event.button !== 0 || disabled || lockedTracks.has(row.id)) return;
    event.preventDefault(); event.stopPropagation();
    onSelect(clip.id);
    suppressClick.current = false;
    gesture.current = { kind: 'clip', clip, edge, x: event.clientX, y: event.clientY,
      scroll: scrollRef.current.scrollLeft, trackId: row.id.startsWith('__') ? undefined : row.id,
      sourceTrackId: row.id.startsWith('__') ? undefined : row.id, moved: false };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const resetZoom = () => { setZoom(1); if (scrollRef.current) scrollRef.current.scrollLeft = 0; };
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
      <button className="template-timeline-button" aria-label="时间轴吸附" title="自动吸附；Ctrl 临时关闭，Alt 按 0.1 秒对齐"
        aria-pressed={snap} onClick={() => setSnap(value => !value)}><Magnet size={15} /></button>
      <button className="template-timeline-button" aria-label="缩小时间轴" disabled={zoom <= 1} onClick={() => setZoom(value => Math.max(1, value / 1.4))}><Minus size={15} /></button>
      <button className="template-timeline-button" aria-label="放大时间轴" disabled={zoom >= 16} onClick={() => setZoom(value => Math.min(16, value * 1.4))}><Plus size={15} /></button>
      <button className="template-timeline-button" aria-label="适应全部时长" onClick={resetZoom}><Maximize2 size={14} /></button>
    </div>
    <div className="template-timeline-scroll" ref={scrollRef}>
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
            onPointerDown={event => {
              if (event.button !== 0) return;
              const left = event.currentTarget.getBoundingClientRect().left;
              setTime(snapTime((event.clientX - left) / pps, points, pps, event, snap));
              gesture.current = { kind: 'cursor', left };
              event.currentTarget.setPointerCapture?.(event.pointerId);
            }}
            onPointerMove={move} onPointerUp={finish} onPointerCancel={event => finish(event, true)}>
            {ticks.map(tick => <span key={tick} style={{ left: tick * pps }}>{timeLabel(tick)} s</span>)}
            <div className="template-ruler-playhead" style={{ left: cursor * pps }} />
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
              onPointerMove={move} onPointerUp={finish} onPointerCancel={event => finish(event, true)}>{autoDuration ? 'Auto' : ''}</button>
          </div>
        </div>
        {view.rows.map(row => {
          const locked = lockedTracks.has(row.id);
          return <div className={`template-track-row ${locked ? 'is-locked' : ''} ${dropTrack === row.id ? 'is-drop-target' : ''}`}
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
            <div className="template-track-lane" style={{ backgroundSize: `${step * pps}px 100%` }}>
              <div className="template-outside-scene" style={{ left: view.duration * pps }} />
              {row.clips.map(clip => {
                const Icon = elementIcons[clip.type] || Layers;
                const active = preview?.kind === 'clip' && preview.id === clip.id;
                const start = active ? preview.start : clip.start;
                const end = active ? preview.start + preview.duration : clip.end;
                const native = nativeIndex.get(clip.id);
                return <button key={clip.id} data-clip-id={clip.id}
                  className={`template-clip ${clip.type === 'composition' ? 'template-clip--scene' : ''} ${selectedId === clip.id ? 'is-selected' : ''} ${active ? 'is-dragging' : ''}`}
                  style={{ left: start * pps, width: Math.max(3, (end - start) * pps) }}
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
              {preview?.kind === 'clip' && preview.trackId === row.id && !row.clips.some(clip => clip.id === preview.id) &&
                <div className="template-clip-ghost" style={{ left: preview.start * pps, width: preview.duration * pps }} />}
              <div className="template-playhead" style={{ left: cursor * pps }} />
            </div>
          </div>;
        })}
        <button className="template-add-scene" disabled={disabled} onClick={onAddScene}><Plus size={14} />添加 Scene</button>
      </div>
    </div>
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
