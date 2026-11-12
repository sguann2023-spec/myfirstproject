import React, { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Group, Image as CanvasImage, Layer, Rect, Shape, Stage } from 'react-konva';
import { Code2, Maximize, Minus, Plus } from 'lucide-react';
import {
  PreviewTextNode, drawVerticalPreviewText, measurePreviewText, measureVerticalPreviewText,
} from '../../TextAddDetail/previewLayout';
import { getShadowPreview } from '../../../shared/textEffects';
import { buildBackgroundRects } from '../../../shared/textBackgroundLayout';
import {
  PREVIEW_FONT_SIZE_CALIBRATION, collectPreviewFrame, fitMediaSize, textCanvasMetrics,
} from './previewModel';
import './TemplatePreview.css';

const FONT_FAMILY = 'Arial, "PingFang SC", "Microsoft YaHei", sans-serif';
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 8;
const SELECTION_BLUE = '#2f7ff7';

// 跨组件共享的媒体缓存：避免时间轴 scrub 时反复重建 Image/Video 元素。
const mediaCache = new Map();
const loadMedia = (url, kind) => {
  let entry = mediaCache.get(url);
  if (entry) return entry;
  const element = kind === 'video' ? document.createElement('video')
    : kind === 'audio' ? document.createElement('audio') : new window.Image();
  if (kind === 'video') {
    element.muted = true;
    element.playsInline = true;
    element.preload = 'auto';
  }
  if (kind === 'audio') element.preload = 'auto';
  entry = { element, status: 'loading', listeners: new Set() };
  const settle = (status) => {
    entry.status = status;
    entry.listeners.forEach(listener => listener());
  };
  if (kind === 'video') element.onloadeddata = () => settle('ready');
  else element.onload = () => settle('ready');
  element.onerror = () => settle('error');
  element.src = url;
  mediaCache.set(url, entry);
  if (mediaCache.size > 80) {
    const oldest = mediaCache.keys().next().value;
    const dropped = mediaCache.get(oldest);
    if (dropped?.element?.pause) dropped.element.pause();
    mediaCache.delete(oldest);
  }
  return entry;
};

const useMedia = (url, kind) => {
  const [, refresh] = useReducer(value => value + 1, 0);
  const entry = url ? loadMedia(url, kind) : null;
  useEffect(() => {
    if (!entry) return undefined;
    entry.listeners.add(refresh);
    return () => { entry.listeners.delete(refresh); };
  }, [entry]);
  return entry;
};

const fontStyleOf = (style) => [style.bold ? 'bold' : '', style.italic ? 'italic' : '']
  .filter(Boolean).join(' ') || 'normal';

const Placeholder = ({ width, height, label, failed }) => (
  <Group listening={false}>
    <Rect width={width} height={height} fill="rgba(120,126,140,0.12)"
      stroke={failed ? 'rgba(224,90,80,0.75)' : 'rgba(140,146,158,0.55)'} strokeWidth={1} dash={[5, 4]} />
    <Shape sceneFunc={(context, shape) => {
      const fontSize = Math.max(9, Math.min(15, Math.min(width, height) * 0.12));
      context.setAttr('font', `${fontSize}px ${FONT_FAMILY}`);
      context.setAttr('fillStyle', failed ? 'rgba(200,70,60,0.95)' : 'rgba(110,116,128,0.9)');
      context.setAttr('textAlign', 'center');
      context.setAttr('textBaseline', 'middle');
      const text = failed ? '素材加载失败' : (label || '加载中…');
      context.fillText(text, width / 2, height / 2, Math.max(20, width - 12));
      context.fillStrokeShape(shape);
    }} width={width} height={height} />
  </Group>
);

// Creatomate 式选中框：实线蓝边 + 四角白色手柄。
const SelectionOutline = ({ width, height }) => (
  <Group listening={false}>
    <Rect width={width} height={height} stroke={SELECTION_BLUE} strokeWidth={1.5} />
    {[[0, 0], [width, 0], [0, height], [width, height]].map(([x, y], index) => (
      <Rect key={index} x={x - 3.5} y={y - 3.5} width={7} height={7} fill="#ffffff" stroke={SELECTION_BLUE} strokeWidth={1.2} />
    ))}
  </Group>
);

// 画布拖拽回写：显示坐标 → 归一化 clip.transform（1 单位 = 半画布），再扣除父分镜继承。
// 手势期间完全 imperative（只改 Konva 节点坐标），不触发任何 React 状态更新，
// 避免中途重渲染打断拖拽；松手后才提交一次 property 动作。
const useDragMove = ({ item, canvas, scale, disabled, onSelect, onMove, onDragStateChange }) => {
  const displayWidth = canvas.width * scale;
  const displayHeight = canvas.height * scale;
  const gesture = useRef(null);
  useEffect(() => () => {
    if (gesture.current) {
      window.removeEventListener('pointermove', gesture.current.move);
      window.removeEventListener('pointerup', gesture.current.up);
      gesture.current = null;
    }
  }, []);
  const onPointerDown = (event) => {
    if (disabled || !onMove || (event.evt.button !== undefined && event.evt.button !== 0)) return;
    const group = event.currentTarget;
    const stage = group.getStage();
    const pointer = stage?.getPointerPosition();
    if (!stage || !pointer) return;
    // 抓住元素时不再触发舞台平移手势。
    event.evt.stopPropagation();
    onSelect(item.id);
    onDragStateChange?.(true);
    const state = { group, x: group.x(), y: group.y(), px: pointer.x, py: pointer.y, moved: false };
    const move = () => {
      const next = stage.getPointerPosition();
      if (!next) return;
      const dx = next.x - state.px;
      const dy = next.y - state.py;
      if (!state.moved && Math.hypot(dx, dy) < 3) return;
      state.moved = true;
      state.group.x(state.x + dx);
      state.group.y(state.y + dy);
      state.group.getLayer()?.batchDraw();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      gesture.current = null;
      onDragStateChange?.(false);
      if (!state.moved) return;
      const composedX = (state.group.x() - displayWidth / 2) / (displayWidth / 2);
      const composedY = (displayHeight / 2 - state.group.y()) / (displayHeight / 2);
      const parent = item.parentTransform ?? { x: 0, y: 0, scaleX: 1, scaleY: 1 };
      const round = (value) => Math.round(Math.min(10, Math.max(-10, value)) * 10000) / 10000;
      onMove(item.id, round((composedX - parent.x) / (parent.scaleX || 1)), round((composedY - parent.y) / (parent.scaleY || 1)));
    };
    gesture.current = { move, up };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return { onPointerDown };
};

const MediaItem = ({ item, canvas, scale, selected, onSelect, disabled, onMove, onDragStateChange }) => {
  const entry = useMedia(item.url, item.kind === 'video' ? 'video' : 'image');
  const natural = entry?.status === 'ready'
    ? (item.kind === 'video'
      ? { width: entry.element.videoWidth, height: entry.element.videoHeight }
      : { width: entry.element.naturalWidth, height: entry.element.naturalHeight })
    : null;
  const fitted = fitMediaSize(canvas, natural);
  const width = fitted.width * scale;
  const height = fitted.height * scale;
  const { transform } = item;
  const drag = useDragMove({ item, canvas, scale, disabled, onSelect, onMove, onDragStateChange });
  return (
    <Group
      x={canvas.width * scale / 2 + transform.x * canvas.width * scale / 2}
      y={canvas.height * scale / 2 - transform.y * canvas.height * scale / 2}
      offsetX={width / 2} offsetY={height / 2}
      rotation={transform.rotation}
      scaleX={transform.scaleX * (transform.flipX ? -1 : 1)}
      scaleY={transform.scaleY * (transform.flipY ? -1 : 1)}
      opacity={Math.min(1, Math.max(0, transform.alpha))}
      onClick={() => onSelect(item.id)} onTap={() => onSelect(item.id)}
      {...drag}
    >
      {entry?.status === 'ready'
        ? <CanvasImage image={entry.element} width={width} height={height} />
        : <Placeholder width={width} height={height} label={item.name} failed={entry?.status === 'error'} />}
      {selected && <SelectionOutline width={width} height={height} />}
    </Group>
  );
};

const TextItem = ({ item, canvas, scale, selected, onSelect, disabled, onMove, onDragStateChange }) => {
  const style = item.textStyle;
  const metrics = textCanvasMetrics(style);
  const fontSize = metrics.fontSize * scale;
  const letterSpacing = metrics.letterSpacing * scale;
  const lineHeight = metrics.lineHeight * scale;
  const padding = metrics.padding * scale;
  const displayWidth = canvas.width * scale;
  const displayHeight = canvas.height * scale;
  const verticalAlign = style.vertical
    ? (style.align === 3 ? 'top' : style.align === 4 ? 'bottom' : 'middle')
    : 'middle';
  const align = style.vertical ? 'center' : (style.align === 0 ? 'left' : style.align === 2 ? 'right' : 'center');
  const layout = useMemo(() => {
    const options = {
      text: style.text || ' ', fontSize, fontStyle: fontStyleOf(style), letterSpacing,
      lineHeight: lineHeight / Math.max(fontSize, 0.5),
      availableWidth: displayWidth - padding * 2, availableHeight: displayHeight - padding * 2,
      fixedWidth: null, fixedHeight: null, verticalAlign,
    };
    return style.vertical ? measureVerticalPreviewText(options) : measurePreviewText(options);
  }, [style.text, style.vertical, fontSize, letterSpacing, lineHeight, padding, displayWidth, displayHeight, verticalAlign, style.bold, style.italic]);
  // 行矩形用于背景条（与主进程 textStyle.ts 的背景布局共用同一算法）。
  const backgroundRects = useMemo(() => {
    if (!style.background.alpha || style.vertical) return [];
    const node = new PreviewTextNode({
      text: style.text || ' ', fontFamily: FONT_FAMILY, fontSize, fontStyle: fontStyleOf(style),
      letterSpacing, lineHeight: lineHeight / Math.max(fontSize, 0.5), padding, wrap: 'char',
      width: layout.width,
    });
    const rows = node.textArr ?? [];
    node.destroy();
    const contentHeight = rows.length * lineHeight;
    const topInset = Math.max(0, layout.height - contentHeight) / 2;
    const rects = rows.map((row, index) => {
      const rowWidth = row.width;
      const x = align === 'left' ? padding : align === 'right' ? layout.width - padding - rowWidth : (layout.width - rowWidth) / 2;
      return { x, y: padding + topInset + index * lineHeight, width: rowWidth, height: lineHeight };
    });
    return buildBackgroundRects(rects, {
      style: style.background.style, color: style.background.color, opacity: style.background.alpha * 100,
      roundRadius: style.background.roundRadius * 100, height: style.background.height * 100,
      width: style.background.width * 100, horizontalOffset: style.background.horizontalOffset * 100,
      verticalOffset: style.background.verticalOffset * 100,
    }, fontSize, false);
  }, [style.background, style.text, fontSize, letterSpacing, lineHeight, padding, layout, align, style.vertical, style.bold, style.italic]);
  const verticalBackgroundRects = useMemo(() => {
    if (!style.background.alpha || !style.vertical) return [];
    const rects = (layout.glyphs ?? []).map(glyph => ({
      x: glyph.x - fontSize / 2, y: glyph.y - glyph.advance / 2, width: fontSize, height: glyph.advance,
    }));
    return buildBackgroundRects(rects, {
      style: style.background.style, color: style.background.color, opacity: style.background.alpha * 100,
      roundRadius: style.background.roundRadius * 100, height: style.background.height * 100,
      width: style.background.width * 100, horizontalOffset: style.background.horizontalOffset * 100,
      verticalOffset: style.background.verticalOffset * 100,
    }, fontSize, true);
  }, [style.background, style.vertical, layout, fontSize]);
  const shadow = getShadowPreview({
    enabled: style.shadow.enabled, color: style.shadow.color, opacity: style.shadow.alpha * 100,
    angle: style.shadow.angle, distance: style.shadow.distance, smoothing: style.shadow.smoothing * 100,
  }, style.size, scale * PREVIEW_FONT_SIZE_CALIBRATION);
  const strokeWidth = style.border.width / 100 * 0.2 * fontSize;
  const { transform } = item;
  const centerX = displayWidth / 2 + transform.x * displayWidth / 2;
  const centerY = displayHeight / 2 - transform.y * displayHeight / 2;
  const opacity = Math.min(1, Math.max(0, transform.alpha * style.alpha));
  const drag = useDragMove({ item, canvas, scale, disabled, onSelect, onMove, onDragStateChange });
  return (
    <Group x={centerX} y={centerY} offsetX={layout.width / 2} offsetY={layout.height / 2}
      rotation={transform.rotation}
      scaleX={transform.scaleX * (transform.flipX ? -1 : 1)}
      scaleY={transform.scaleY * (transform.flipY ? -1 : 1)}
      opacity={opacity}
      onClick={() => onSelect(item.id)} onTap={() => onSelect(item.id)}
      {...drag}>
      {[...backgroundRects, ...verticalBackgroundRects].map((rect, index) => (
        <Rect key={index} x={rect.x} y={rect.y} width={rect.width} height={rect.height}
          cornerRadius={rect.radius} fill={style.background.color} opacity={style.background.alpha} listening={false} />
      ))}
      {style.vertical ? (
        <Shape width={layout.width} height={layout.height}
          fontStyle={fontStyleOf(style)} fontSize={fontSize} fill={style.color}
          stroke={style.border.color} strokeWidth={strokeWidth} textDecoration={style.underline ? 'underline' : ''}
          sceneFunc={(context, shape) => drawVerticalPreviewText(context, shape, layout)}
          hitFunc={(context, shape) => {
            context.beginPath();
            context.rect(0, 0, shape.width(), shape.height());
            context.closePath();
            context.fillStrokeShape(shape);
          }} />
      ) : (
        <PreviewTextNode
          text={style.text || ' '} width={layout.width} height={layout.height} padding={padding} wrap="char"
          fontFamily={FONT_FAMILY} fontSize={fontSize} fontStyle={fontStyleOf(style)}
          textDecoration={style.underline ? 'underline' : ''} align={align} verticalAlign={verticalAlign}
          letterSpacing={letterSpacing} lineHeight={lineHeight / Math.max(fontSize, 0.5)}
          fill={style.color} stroke={style.border.color} strokeWidth={strokeWidth} fillAfterStrokeEnabled
          shadowEnabled={shadow.enabled} shadowColor={shadow.color} shadowOpacity={shadow.opacity}
          shadowBlur={shadow.blur} shadowOffsetX={shadow.x} shadowOffsetY={shadow.y} />
      )}
      {selected && <SelectionOutline width={layout.width} height={layout.height} />}
    </Group>
  );
};

const PreviewItem = (props) => {
  if (props.item.kind === 'text') return <TextItem {...props} />;
  return <MediaItem {...props} />;
};

const TemplatePreview = ({
  model, index, nativeIndex, scopeId = null, scopeLabel = '', duration = 0,
  cursor = 0, onCursorChange, selectedId = '', onSelect, onMove, disabled = false,
  playing = false, onPlayingChange, loop = true, onTogglePlay,
  codeOpen = true, onToggleCode,
}) => {
  const shellRef = useRef(null);
  const layerRef = useRef(null);
  const cursorRef = useRef(cursor);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef(null);
  cursorRef.current = cursor;

  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell) return undefined;
    const measure = () => {
      const rect = shell.getBoundingClientRect();
      setBox({ width: rect.width, height: rect.height });
    };
    if (typeof ResizeObserver === 'undefined') {
      // jsdom 等无 ResizeObserver 的环境回退到窗口 resize。
      measure();
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(entries => {
      const rect = entries[0].contentRect;
      setBox(previous => (previous.width === rect.width && previous.height === rect.height ? previous : { width: rect.width, height: rect.height }));
    });
    observer.observe(shell);
    return () => observer.disconnect();
  }, []);

  const frame = useMemo(() => collectPreviewFrame({ model, index, nativeIndex, scopeId, time: cursor }),
    [model, index, nativeIndex, scopeId, cursor]);
  const fitScale = Math.min((box.width - 48) / frame.canvas.width, (box.height - 64) / frame.canvas.height);
  const scale = Math.max(0.02, fitScale * zoom);
  const displayWidth = frame.canvas.width * scale;
  const displayHeight = frame.canvas.height * scale;
  const zoomPercent = Math.round(scale * 100);

  // 播放时钟：与页面时间轴光标双向同步。
  useEffect(() => {
    if (!playing || disabled || !duration) return undefined;
    let raf = 0;
    let last = performance.now();
    const tick = (now) => {
      const delta = Math.min(0.25, (now - last) / 1000);
      last = now;
      let next = cursorRef.current + delta;
      if (next >= duration) {
        if (loop) next %= duration;
        else { next = duration; onPlayingChange(false); }
      }
      onCursorChange(next);
      layerRef.current?.batchDraw();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, loop, duration, disabled, onCursorChange, onPlayingChange]);

  useEffect(() => { if (disabled) onPlayingChange(false); }, [disabled, onPlayingChange]);
  useEffect(() => { setPan({ x: 0, y: 0 }); }, [scopeId, frame.canvas.width, frame.canvas.height]);

  // 视频/音频元素与光标同步：播放时跟随，暂停时精确 seek。
  useEffect(() => {
    const activeVideos = new Set();
    const activeAudio = new Set();
    for (const item of frame.items) {
      if (item.kind !== 'video' || !item.url) continue;
      const entry = loadMedia(item.url, 'video');
      activeVideos.add(entry);
      if (entry.status !== 'ready') continue;
      const target = item.sourceStart + (cursor - item.start);
      const element = entry.element;
      if (playing) {
        if (Math.abs(element.currentTime - target) > 0.35) element.currentTime = Math.max(0, target);
        if (element.paused) element.play().catch(() => {});
      } else {
        if (!element.paused) element.pause();
        if (Math.abs(element.currentTime - target) > 0.04) element.currentTime = Math.max(0, target);
      }
    }
    for (const track of frame.audio) {
      const entry = loadMedia(track.url, 'audio');
      activeAudio.add(entry);
      const element = entry.element;
      element.volume = Math.min(1, Math.max(0, track.volume));
      if (entry.status !== 'ready') continue;
      const target = track.sourceStart + (cursor - track.start);
      if (playing) {
        if (Math.abs(element.currentTime - target) > 0.35) element.currentTime = Math.max(0, target);
        if (element.paused) element.play().catch(() => {});
      } else if (!element.paused) element.pause();
      else if (Math.abs(element.currentTime - target) > 0.04) element.currentTime = Math.max(0, target);
    }
    mediaCache.forEach(entry => {
      if (entry.element.tagName === 'VIDEO' && !activeVideos.has(entry) && !entry.element.paused) entry.element.pause();
      if (entry.element.tagName === 'AUDIO' && !activeAudio.has(entry) && !entry.element.paused) entry.element.pause();
    });
  }, [frame, cursor, playing]);

  useEffect(() => () => {
    mediaCache.forEach(entry => { if (entry.element.pause) entry.element.pause(); });
  }, []);

  const changeZoom = (next) => {
    setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next)));
  };
  const onWheel = (event) => {
    event.preventDefault();
    changeZoom(zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12));
  };
  const onPointerDown = (event) => {
    if (zoom <= 1.001 || event.button !== 0) return;
    // 浮动工具条/信息浮标上的点击不能被平移手势的 pointer capture 吞掉。
    if (event.target.closest?.('.template-preview-tools, .template-preview-meta')) return;
    dragRef.current = { x: event.clientX, y: event.clientY, pan };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event) => {
    if (!dragRef.current) return;
    setPan({
      x: dragRef.current.pan.x + event.clientX - dragRef.current.x,
      y: dragRef.current.pan.y + event.clientY - dragRef.current.y,
    });
  };
  const onPointerUp = () => { dragRef.current = null; };

  const notices = frame.notices;
  const empty = frame.items.length === 0;
  return (
    <section className="template-preview" aria-label="模版预览">
      <div className="template-preview-heading">
        <strong>预览</strong>
        <span className="template-muted">{scopeLabel || '全部分镜'} · {frame.canvas.width}×{frame.canvas.height}</span>
        <span className="template-preview-heading-actions">
          <button type="button" className={`template-preview-button${codeOpen ? ' is-active' : ''}`}
            aria-label={codeOpen ? '隐藏代码' : '显示代码'} aria-pressed={codeOpen}
            title={codeOpen ? '隐藏代码' : '显示代码'} onClick={onToggleCode}><Code2 size={14} /></button>
          <span className={`template-preview-status${playing ? ' is-playing' : ''}`}>{playing ? '播放中' : '已暂停'}</span>
        </span>
      </div>
      <div
        className={`template-preview-stage${zoom > 1.001 ? ' is-pannable' : ''}`}
        ref={shellRef}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onKeyDown={(event) => {
          if (event.key === ' ' || event.key === 'k') { event.preventDefault(); onTogglePlay?.(); }
          if (event.key === 'ArrowLeft') { event.preventDefault(); onCursorChange(Math.max(0, cursor - (event.shiftKey ? 1 : 0.1))); }
          if (event.key === 'ArrowRight') { event.preventDefault(); onCursorChange(Math.min(duration, cursor + (event.shiftKey ? 1 : 0.1))); }
        }}
        tabIndex={0}
        role="group"
        aria-label="预览画布，空格播放暂停，方向键逐帧"
      >
        {box.width > 40 && box.height > 40 && (
          <Stage width={box.width} height={box.height}>
            <Layer ref={layerRef}>
              <Group x={box.width / 2 + pan.x} y={box.height / 2 + pan.y} offsetX={displayWidth / 2} offsetY={displayHeight / 2}>
                <Rect width={displayWidth} height={displayHeight} fill="#000000" listening={false} />
                <Group clipX={0} clipY={0} clipWidth={displayWidth} clipHeight={displayHeight}>
                  {frame.items.map(item => (
                    <PreviewItem key={item.id} item={item} canvas={frame.canvas} scale={scale}
                      selected={item.id === selectedId} onSelect={onSelect} onMove={onMove} disabled={disabled}
                      onDragStateChange={(dragging) => { if (dragging) onPlayingChange(false); }} />
                  ))}
                </Group>
                <Rect width={displayWidth} height={displayHeight} stroke="rgba(0,0,0,0.22)" strokeWidth={1} listening={false} />
              </Group>
            </Layer>
          </Stage>
        )}
        <div className="template-preview-tools" role="toolbar" aria-label="预览缩放工具">
          <button type="button" className="template-preview-button" aria-label="缩小" title="缩小" disabled={disabled}
            onClick={() => changeZoom(zoom / 1.25)}><Minus size={14} /></button>
          <span className="template-preview-zoom" aria-label="缩放比例">{zoomPercent}%</span>
          <button type="button" className="template-preview-button" aria-label="放大" title="放大" disabled={disabled}
            onClick={() => changeZoom(zoom * 1.25)}><Plus size={14} /></button>
          <button type="button" className="template-preview-button" aria-label="适应窗口" title="适应窗口" disabled={disabled}
            onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}><Maximize size={14} /></button>
        </div>
        <div className="template-preview-meta" aria-label="画布信息">
          {frame.canvas.width} × {frame.canvas.height} px · {zoomPercent}%
        </div>
        {empty && <div className="template-preview-empty">当前时间没有可见元素</div>}
      </div>
      {notices.length > 0 && (
        <div className="template-preview-notices" role="status">{notices.join('；')}</div>
      )}
    </section>
  );
};

export default TemplatePreview;
