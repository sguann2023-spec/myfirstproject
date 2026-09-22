import React from 'react';
import { Box, Maximize2, Minimize2, Music2, Pause, Play, Plus, Trash2 } from 'lucide-react';
import { Tooltip } from 'antd';
import Filmstrip from './Filmstrip';
import SubtitlePanel from './SubtitlePanel';
import { captionCues, subtitleUnits } from './subtitles';
import { buildTimeline, clockTime, nextPlayableClip, playbackTime, rulerTicks, timelinePoint } from './timeline';
import { canMergeParts, partOffset } from './model';
import { viewportRect } from './geometry';
import { resizePart, trimBounds } from './trim';

const EMPTY_SEGMENTS = [];

const useMediaSeeker = (ref, source) => {
  const pending = React.useRef(null);
  const flush = React.useCallback(() => {
    const media = ref.current;
    if (!media || !media.readyState || media.seeking || pending.current === null) return;
    const time = Math.max(0, Math.min(pending.current / 1000, Number.isFinite(media.duration) ? media.duration : Infinity));
    pending.current = null;
    if (Math.abs(media.currentTime - time) > 0.001) media.currentTime = time;
  }, [ref]);
  React.useEffect(() => {
    const media = ref.current;
    if (!media) return undefined;
    media.addEventListener('seeked', flush);
    media.addEventListener('loadedmetadata', flush);
    return () => {
      pending.current = null;
      media.removeEventListener('seeked', flush);
      media.removeEventListener('loadedmetadata', flush);
    };
  }, [ref, source, flush]);
  return React.useCallback((time) => { pending.current = time; flush(); }, [flush]);
};

const SplitIcon = () => <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
  <path d="M3 3h2c2 0 2 2 2 4v6c0 2 0 4-2 4H3M17 3h-2c-2 0-2 2-2 4v6c0 2 0 4 2 4h2"
    stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  <path d="M10 2v16" stroke="currentColor" strokeDasharray="1 3" strokeLinecap="round" />
</svg>;

const StoryboardEditor = ({
  parts, selectedId, source, fallbackSource = '', segments = EMPTY_SEGMENTS, disabled = false,
  onSelect, onSplit, onDelete, onInsert, onMerge, onEditCaption, onDeleteSubtitles,
  onAiAssist, aiDisabled = false, onResize,
}) => {
  const [trimState, setTrimPreview] = React.useState(null);
  const trimPreview = trimState?.originalParts === parts && !disabled ? trimState : null;
  const trimRef = React.useRef(null);
  const visibleParts = trimPreview?.originalParts === parts ? trimPreview.parts : parts;
  const clips = React.useMemo(() => buildTimeline(visibleParts), [visibleParts]);
  const total = clips[clips.length - 1]?.timelineEnd || 0;
  const [mediaSource, setMediaSource] = React.useState(source);
  const [error, setError] = React.useState('');
  const [position, setPosition] = React.useState(0);
  const [hoverTime, setHoverTime] = React.useState(null);
  const [playing, setPlaying] = React.useState(false);
  const [fullscreen, setFullscreen] = React.useState(false);
  const [viewport, setViewport] = React.useState(680);
  const [scrollLeft, setScrollLeft] = React.useState(0);
  const [zoom, setZoom] = React.useState(100);
  const [previewError, setPreviewError] = React.useState(false);
  const [mediaDuration, setMediaDuration] = React.useState(0);
  const [selection, setSelection] = React.useState([selectedId]);
  const [pendingKeys, setPendingKeys] = React.useState([]);
  const units = React.useMemo(() => subtitleUnits(clips, segments), [clips, segments]);
  const pendingUnits = units.filter((unit) => pendingKeys.includes(unit.key));
  React.useEffect(() => { setPendingKeys((keys) => keys.length ? [] : keys); }, [clips, segments, disabled]);
  const [marquee, setMarquee] = React.useState(null);
  const marqueeRef = React.useRef(null);
  const editorRef = React.useRef(null);
  const mediaRef = React.useRef(null);
  const hoverMediaRef = React.useRef(null);
  const scrollerRef = React.useRef(null);
  const surfaceRef = React.useRef(null);
  const zoomAnchorRef = React.useRef(null);
  const positionRef = React.useRef(0);
  const previousClipsRef = React.useRef(clips);
  const selectedRef = React.useRef(selectedId);
  const intentRef = React.useRef(false);
  const dragRef = React.useRef(false);
  const commitRef = React.useRef(null);
  const audioOnly = /\.(aac|flac|m4a|mp3|ogg|wav|wma)(?:[?#]|$)/i.test(mediaSource);
  const Media = audioOnly ? 'audio' : 'video';
  const seekMedia = useMediaSeeker(mediaRef, mediaSource);
  const seekHover = useMediaSeeker(hoverMediaRef, mediaSource);
  const scale = trimPreview?.scale ?? Math.min(240, Math.max(40, (viewport - 88) / Math.max(1, total / 1000))) * zoom / 100;
  const sourceEnd = mediaDuration || Math.max(0, ...parts.map((part) => part.blank ? 0 : part.end), ...segments.map((cue) => cue.end));
  const previousScaleRef = React.useRef(scale);
  const totalWidth = total / 1000 * scale;
  const currentPoint = timelinePoint(clips, position);
  const hoverPoint = hoverTime === null || playing ? null : timelinePoint(clips, hoverTime);
  const displayedPoint = trimPreview
    ? { clip: clips.find((clip) => clip.id === trimPreview.id) || currentPoint?.clip, sourceTime: trimPreview.sourceTime }
    : hoverPoint || currentPoint;
  const selectedClip = clips.find((clip) => clip.id === selectedId);
  const selectedIds = selection.filter((id) => clips.some((clip) => clip.id === id));
  const deletableIds = selectedIds;
  const playableDuration = playbackTime(clips);
  const mergeAllowed = canMergeParts(parts, selectedIds);
  const captions = React.useMemo(() => new Map(clips.map((clip) => [clip.id, captionCues(clip, segments)])), [clips, segments]);
  const subtitle = (captions.get(displayedPoint?.clip.id) || [])
    .filter((cue) => displayedPoint.sourceTime >= cue.start && displayedPoint.sourceTime < cue.end)
    .map((cue) => cue.text).join(' ');
  const ticks = rulerTicks(total, scale, scrollLeft / scale * 1000, (scrollLeft + viewport) / scale * 1000);

  React.useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const previousScale = previousScaleRef.current;
    previousScaleRef.current = scale;
    if (!scroller || previousScale === scale) return;
    // Keep the visible playhead anchored while zooming; otherwise anchor the center.
    const head = positionRef.current / 1000 * previousScale - scroller.scrollLeft;
    const anchor = zoomAnchorRef.current ?? (head >= 0 && head <= scroller.clientWidth ? head : scroller.clientWidth / 2);
    zoomAnchorRef.current = null;
    scroller.scrollLeft = Math.max(0, (scroller.scrollLeft + anchor) / previousScale * scale - anchor);
    setScrollLeft(scroller.scrollLeft);
    setHoverTime(null);
  }, [scale]);

  React.useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return undefined;
    const wheel = (event) => {
      // Chromium trackpad pinch arrives as ctrl+wheel. Vertical two-finger
      // scrolling also zooms; horizontal gestures retain native track scrolling.
      if (disabled || trimRef.current || marqueeRef.current || !total || !event.deltaY || event.altKey || event.metaKey
        || (!event.ctrlKey && (event.shiftKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)))) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = viewportRect(scroller);
      const cssScale = rect.width && scroller.offsetWidth ? rect.width / scroller.offsetWidth : 1;
      zoomAnchorRef.current = Math.max(0, Math.min(scroller.clientWidth, (event.clientX - rect.left) / cssScale));
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scroller.clientHeight || 120 : 1;
      const delta = Math.max(-300, Math.min(300, event.deltaY * unit));
      setZoom((value) => Math.max(25, Math.min(400, value * Math.exp(-delta * 0.01))));
      setHoverTime(null);
    };
    scroller.addEventListener('wheel', wheel, { passive: false });
    return () => scroller.removeEventListener('wheel', wheel);
  }, [disabled, total]);

  const stop = React.useCallback(() => {
    intentRef.current = false;
    mediaRef.current?.pause();
    setPlaying(false);
  }, []);

  const cancelTrim = React.useCallback(() => {
    trimRef.current = null;
    setTrimPreview(null);
  }, []);
  React.useEffect(() => { cancelTrim(); }, [parts, disabled, source, cancelTrim]);
  React.useEffect(() => {
    if (!trimPreview) return undefined;
    const cancel = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      cancelTrim();
    };
    document.addEventListener('keydown', cancel, true);
    return () => document.removeEventListener('keydown', cancel, true);
  }, [Boolean(trimPreview), cancelTrim]);

  const beginTrim = (event, clip, edge) => {
    if (disabled || !onResize || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    stop();
    setHoverTime(null);
    setPendingKeys([]);
    const surface = surfaceRef.current;
    const rect = viewportRect(surface);
    const ratio = surface.offsetWidth && rect.width ? rect.width / surface.offsetWidth : 1;
    trimRef.current = {
      id: clip.id, edge, originalParts: parts, clientX: event.clientX, ratio, scale, sourceEnd,
      scrollLeft: scrollerRef.current.scrollLeft, value: clip[edge], pointerId: event.pointerId,
    };
    setTrimPreview({ ...trimRef.current, parts, sourceTime: edge === 'start' ? clip.start : clip.end - 1 });
    editorRef.current?.focus({ preventScroll: true });
    try { surface.setPointerCapture?.(event.pointerId); } catch { /* Pointer capture may be unavailable in embedded webviews. */ }
  };
  const moveTrim = (event) => {
    const gesture = trimRef.current;
    if (!gesture || disabled || gesture.originalParts !== parts || event.pointerId !== gesture.pointerId) return null;
    const scroller = scrollerRef.current;
    const rect = viewportRect(scroller);
    if (rect.width > 0 && event.type === 'pointermove') {
      if (event.clientX < rect.left + 20) scroller.scrollLeft = Math.max(0, scroller.scrollLeft - 16);
      else if (event.clientX > rect.left + rect.width - 20) scroller.scrollLeft += 16;
    }
    const delta = ((event.clientX - gesture.clientX) / gesture.ratio
      + scroller.scrollLeft - gesture.scrollLeft) / gesture.scale * 1000;
    const nextParts = resizePart(parts, segments, gesture.id, gesture.edge, gesture.value + delta, gesture.sourceEnd);
    const next = nextParts.find((part) => part.id === gesture.id);
    const sourceTime = gesture.edge === 'start' ? next.start : next.end - 1;
    setTrimPreview({ ...gesture, parts: nextParts, sourceTime });
    seekMedia(sourceTime);
    return next;
  };
  const finishTrim = (event) => {
    const gesture = trimRef.current;
    const next = moveTrim(event);
    cancelTrim();
    if (next && next[gesture.edge] !== gesture.value) onResize(gesture.id, gesture.edge, next[gesture.edge], gesture.sourceEnd);
  };

  const commit = (time, preservePlayback = false, preservePending = false, syncMedia = true) => {
    if (!preservePending && !preservePlayback) setPendingKeys([]);
    const point = timelinePoint(clips, time);
    if (!point) return;
    if (!preservePlayback) stop();
    setSelection([point.clip.id]);
    positionRef.current = point.position;
    setPosition(point.position);
    setHoverTime(null);
    if (selectedRef.current !== point.clip.id) {
      selectedRef.current = point.clip.id;
      onSelect(point.clip.id);
    }
    if (syncMedia) {
      if (point.clip.blank) mediaRef.current?.pause();
      else seekMedia(point.sourceTime);
    }
  };
  commitRef.current = commit;

  React.useEffect(() => {
    stop();
    marqueeRef.current = null;
    setMarquee(null);
    setMediaSource(source);
    setError('');
    setPreviewError(false);
    setMediaDuration(0);
  }, [source, stop]);

  React.useEffect(() => {
    stop();
    if (trimRef.current) return;
    marqueeRef.current = null;
    setMarquee(null);
    dragRef.current = false;
    const clip = clips.find((item) => item.id === selectedId) || clips[0];
    const previous = timelinePoint(previousClipsRef.current, positionRef.current);
    previousClipsRef.current = clips;
    if (clip) {
      const offset = previous?.clip.id === clip.id
        ? partOffset(clip, previous.sourceTime) : 0;
      commitRef.current(clip.timelineStart + offset);
    }
    else { positionRef.current = 0; setPosition(0); setHoverTime(null); }
  }, [clips, stop]);

  React.useEffect(() => {
    if (selectedId === selectedRef.current) return;
    selectedRef.current = selectedId;
    const clip = clips.find((item) => item.id === selectedId);
    if (clip) commitRef.current(clip.timelineStart);
  }, [selectedId]);

  React.useEffect(() => {
    const update = () => setViewport(scrollerRef.current?.clientWidth || 680);
    update();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(update);
    if (scrollerRef.current) observer.observe(scrollerRef.current);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    const listener = () => setFullscreen(document.fullscreenElement === editorRef.current);
    document.addEventListener('fullscreenchange', listener);
    return () => { document.removeEventListener('fullscreenchange', listener); };
  }, []);

  React.useEffect(() => {
    if (!fullscreen) return undefined;
    const leave = (event) => {
      if (event.key !== 'Escape') return;
      if (event.target.closest?.('.storyboard-subtitles__input')) return;
      if (event.target.closest?.('.storyboard-subtitles')) return;
      event.preventDefault();
      event.stopPropagation();
      setFullscreen(false);
      if (document.fullscreenElement === editorRef.current) document.exitFullscreen?.().catch(() => {});
    };
    document.addEventListener('keydown', leave, true);
    return () => document.removeEventListener('keydown', leave, true);
  }, [fullscreen]);

  React.useEffect(() => {
    const media = mediaRef.current;
    const preview = hoverMediaRef.current;
    return () => {
      intentRef.current = false;
      media?.pause();
      preview?.pause();
    };
  }, [mediaSource]);
  React.useEffect(() => { if (disabled) stop(); }, [disabled, stop]);

  React.useEffect(() => {
    if (hoverPoint && !audioOnly && !hoverPoint.clip.blank) seekHover(hoverPoint.sourceTime);
  }, [hoverPoint?.sourceTime, hoverPoint?.clip.id, audioOnly, mediaSource, seekHover]);

  const playMedia = async () => {
    if (!mediaRef.current || !intentRef.current) return;
    try {
      await mediaRef.current.play();
      if (!intentRef.current) mediaRef.current?.pause();
    } catch {
      if (intentRef.current) {
        stop();
        setError('素材无法播放，请检查文件或链接');
      }
    }
  };

  const togglePlayback = () => {
    if (intentRef.current) { stop(); return; }
    if (!playableDuration || disabled) return;
    const next = nextPlayableClip(clips, positionRef.current) || nextPlayableClip(clips, 0);
    if (!next) return;
    if (positionRef.current >= total - 1 || positionRef.current < next.timelineStart
      || !nextPlayableClip(clips, positionRef.current)) commit(next.timelineStart);
    setHoverTime(null);
    intentRef.current = true;
    setPlaying(true);
    if (!timelinePoint(clips, positionRef.current)?.clip.blank) void playMedia();
  };

  // Step through retained source ranges, including cuts inside a merged shot.
  React.useEffect(() => {
    if (!playing) return undefined;
    let frame;
    let previous = performance.now();
    const tick = (now) => {
      if (!intentRef.current) return;
      const point = timelinePoint(clips, positionRef.current);
      if (!point) { stop(); return; }
      const media = mediaRef.current;
      if (!point.clip.blank && !mediaSource) {
        stop();
        setError('此分镜没有可播放的源素材');
        return;
      }
      let next = positionRef.current;
      if (point.clip.blank) next += now - previous;
      else if (media && !media.seeking && media.readyState >= 2) {
        next = point.rangeTimelineStart + Math.max(0, media.currentTime * 1000 - point.range.start);
      }
      previous = now;
      let boundary = point;
      let jumped = false;
      // RAF can arrive after several short shots. Carry the actual playback
      // position across continuous ranges, but stop at the first real cut.
      while (next >= boundary.rangeTimelineEnd || (!boundary.clip.blank && media?.ended)) {
        if (boundary.rangeTimelineEnd >= total) {
          positionRef.current = total;
          setPosition(total);
          seekMedia(boundary.clip.end);
          stop();
          return;
        }
        const following = timelinePoint(clips, boundary.rangeTimelineEnd);
        if (!boundary.clip.blank && !following.clip.blank
          && boundary.range.end === following.range.start && !media?.ended) {
          boundary = following;
          continue;
        }
        commitRef.current(boundary.rangeTimelineEnd, true);
        if (!following.clip.blank) void playMedia();
        jumped = true;
        break;
      }
      if (!jumped && boundary !== point) {
        commitRef.current(next, true, false, false);
      } else if (!jumped) {
        positionRef.current = next;
        setPosition(next);
      }
      const scroller = scrollerRef.current;
      const x = positionRef.current / 1000 * scale;
      if (scroller && (x > scroller.scrollLeft + scroller.clientWidth - 30 || x < scroller.scrollLeft)) {
        scroller.scrollLeft = Math.max(0, x - scroller.clientWidth / 3);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, clips, total, scale, stop, seekMedia, mediaSource]);

  const eventTime = (event) => {
    const rect = viewportRect(surfaceRef.current);
    const zoom = surfaceRef.current.offsetWidth && rect.width ? rect.width / surfaceRef.current.offsetWidth : 1;
    return Math.max(0, Math.min((event.clientX - rect.left) / zoom / scale * 1000, total));
  };
  const surfacePoint = (event) => {
    const surface = surfaceRef.current;
    const rect = viewportRect(surface);
    const ratio = surface.offsetWidth && rect.width ? rect.width / surface.offsetWidth : 1;
    return {
      x: Math.max(0, Math.min((event.clientX - rect.left) / ratio, Math.max(viewport, totalWidth + 88))),
      y: Math.max(0, Math.min((event.clientY - (rect.top || 0)) / ratio, 116)),
    };
  };
  const updateMarquee = (event) => {
    const origin = marqueeRef.current;
    if (!origin) return;
    const point = surfacePoint(event);
    if (!origin.active && Math.hypot(point.x - origin.x, point.y - origin.y) < 4) return;
    origin.active = true;
    // A horizontal drag across thumbnails is also a selection rectangle.
    const box = {
      left: Math.min(origin.x, point.x), top: Math.min(origin.y, point.y) - 2,
      width: Math.max(1, Math.abs(point.x - origin.x)), height: Math.max(4, Math.abs(point.y - origin.y) + 4),
    };
    const ids = clips.filter((clip) => box.top < 101 && box.top + box.height > 31
      && clip.timelineStart / 1000 * scale < box.left + box.width
      && clip.timelineEnd / 1000 * scale > box.left).map((clip) => clip.id);
    origin.ids = ids;
    setMarquee(box);
    setSelection(ids);
  };
  const handlePointerMove = (event) => {
    if (disabled || !total) return;
    if (trimRef.current) { moveTrim(event); return; }
    if (marqueeRef.current) {
      updateMarquee(event);
      return;
    }
    if (event.target.closest('[data-insert], [data-trim]')) { setHoverTime(null); return; }
    const time = eventTime(event);
    if (dragRef.current) commit(time);
    else setHoverTime(time);
  };
  const toggleFullscreen = async () => {
    if (fullscreen) {
      setFullscreen(false);
      if (document.fullscreenElement === editorRef.current) {
        try { await document.exitFullscreen(); } catch { /* Keep the in-app editor usable. */ }
      }
      return;
    }
    // Embedded webviews may reject or leave native fullscreen requests pending.
    // Expand immediately inside the app; native fullscreen is an enhancement.
    setFullscreen(true);
    try {
      await editorRef.current?.requestFullscreen?.();
    } catch { /* The viewport-sized fallback remains available. */ }
  };
  const insert = (index) => { stop(); setHoverTime(null); onInsert(index); };
  const seekSubtitle = (time, preservePending = false) => {
    if (disabled) return;
    commit(time, false, preservePending);
    const scroller = scrollerRef.current;
    const x = time / 1000 * scale;
    if (scroller && (x < scroller.scrollLeft || x > scroller.scrollLeft + scroller.clientWidth - 30)) {
      scroller.scrollLeft = Math.max(0, x - scroller.clientWidth / 3);
    }
  };

  return <div ref={editorRef} tabIndex={-1} className={`storyboard-editor${fullscreen ? ' is-fullscreen' : ''}`}
    onKeyDown={(event) => {
      if (disabled || trimRef.current || !deletableIds.length || event.defaultPrevented || event.repeat || event.nativeEvent.isComposing
        || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
        || !['Delete', 'Backspace'].includes(event.key)
        || !event.currentTarget.contains(event.target)
        || event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return;
      event.preventDefault();
      event.stopPropagation();
      stop();
      setHoverTime(null);
      editorRef.current?.focus({ preventScroll: true });
      onDelete(deletableIds);
    }}>
    <div className="storyboard-workspace">
    <div className="storyboard-preview" aria-label="分镜预览">
      {mediaSource ? <Media key={mediaSource} ref={mediaRef} src={mediaSource} preload="auto" playsInline
        className={`storyboard-preview__media${!displayedPoint || displayedPoint.clip.blank ? ' is-concealed' : ''}`}
        aria-label={audioOnly ? '音频预览' : '视频预览'}
        onLoadedMetadata={(event) => {
          setError('');
          const duration = event.currentTarget.duration;
          if (Number.isFinite(duration) && duration > 0) setMediaDuration(Math.floor(duration * 1000));
          const point = timelinePoint(clips, positionRef.current);
          if (point && !point.clip.blank) seekMedia(point.sourceTime);
        }}
        onError={() => {
          stop();
          if (fallbackSource && mediaSource !== fallbackSource) {
            setMediaSource(fallbackSource);
            setPreviewError(false);
          } else setError('原素材无法预览，仍可编辑和保存分镜');
        }}
      /> : null}
      {mediaSource && !audioOnly ? <video key={`hover-${mediaSource}`} ref={hoverMediaRef} src={mediaSource}
        preload="auto" muted playsInline aria-hidden="true"
        className={`storyboard-preview__hover${hoverPoint && !hoverPoint.clip.blank && !previewError ? ' is-visible' : ''}`}
        onError={() => setPreviewError(true)} /> : null}
      {!displayedPoint ? <div className="storyboard-preview__empty">暂无分镜</div>
        : displayedPoint.clip.blank ? <div className="storyboard-preview__empty"><Plus size={30} /><span>空分镜</span></div>
        : audioOnly ? <div className="storyboard-preview__empty"><Music2 size={40} /><span>音频预览</span></div>
          : !mediaSource ? <div className="storyboard-preview__empty">没有可预览的媒体地址</div> : null}
      {subtitle ? <div className="storyboard-preview__subtitle">{subtitle}</div> : null}
      {error ? <div className="storyboard-preview__error" role="status">{error}</div> : null}
    </div>
    <SubtitlePanel clips={clips} segments={segments} selectedIds={selectedIds}
      aiDisabled={aiDisabled} onAiAssist={onAiAssist ? async () => {
        stop();
        setHoverTime(null);
        setFullscreen(false);
        if (document.fullscreenElement === editorRef.current) {
          try { await document.exitFullscreen?.(); } catch { return; }
        }
        onAiAssist();
      } : undefined}
      units={units} pendingKeys={pendingKeys} onPendingChange={setPendingKeys}
      activeId={playing ? currentPoint?.clip.id : selectedId} hoverId={hoverPoint?.clip.id}
      disabled={disabled} onSeek={seekSubtitle} onHover={setHoverTime} onEdit={onEditCaption}
      onDelete={() => {
        if (!pendingUnits.length || !onDeleteSubtitles) return;
        stop();
        setHoverTime(null);
        onDeleteSubtitles(pendingUnits);
        setPendingKeys([]);
      }} />
    </div>
    <section className="storyboard-timeline" aria-label="字幕分镜轨道">
      <div className="storyboard-toolbar">
        <div className="storyboard-toolbar__edit">
          <Tooltip title="分割">
            <button type="button" aria-label="拆分分镜" disabled={disabled || selectedIds.length !== 1 || !selectedClip || selectedClip.duration < 2}
              onClick={() => {
                stop();
                const point = timelinePoint(clips, positionRef.current);
                onSplit(point?.clip.id === selectedId ? point.sourceTime : NaN);
              }}><SplitIcon /></button>
          </Tooltip>
          <Tooltip title="删除"><button type="button" aria-label="删除分镜"
            disabled={disabled || !deletableIds.length} onClick={() => { stop(); onDelete(deletableIds); }}><Trash2 size={18} /></button></Tooltip>
          <Tooltip title="合并">
            <button type="button" aria-label="合并分镜" disabled={disabled || !mergeAllowed || !onMerge}
              onClick={() => { stop(); setHoverTime(null); onMerge(selectedIds); }}>
              <Box size={18} />
            </button>
          </Tooltip>
        </div>
        <div className="storyboard-toolbar__transport">
          <button type="button" aria-label={playing ? '暂停预览' : '播放分镜序列'}
            disabled={disabled || !playableDuration || (!mediaSource && !currentPoint?.clip.blank)} onClick={togglePlayback}>
            {playing ? <Pause size={21} fill="currentColor" /> : <Play size={21} fill="currentColor" />}
          </button>
          <span className="storyboard-clock"><span>{clockTime(playbackTime(clips, position))}</span><span> / {clockTime(playableDuration)}</span></span>
        </div>
        <div className="storyboard-toolbar__view">
          <button type="button" aria-label={fullscreen ? '退出全屏编辑' : '全屏编辑'} onClick={toggleFullscreen}>
            {fullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}<span>{fullscreen ? '退出全屏' : '全屏编辑'}</span>
          </button>
        </div>
      </div>
      <div className="storyboard-lane">
        <div ref={scrollerRef} className="storyboard-lane__scroll" onScroll={(event) => {
          setScrollLeft(event.currentTarget.scrollLeft);
          setHoverTime(null);
        }}>
          <div ref={surfaceRef} className="storyboard-lane__surface" style={{ width: Math.max(viewport, totalWidth + 88) }}
            onPointerMove={handlePointerMove} onPointerLeave={() => { if (!dragRef.current && !marqueeRef.current && !trimRef.current) setHoverTime(null); }}
            onPointerDown={(event) => {
              if (disabled || event.button !== 0 || event.target.closest('[data-insert], [data-trim]') || !total) return;
              setPendingKeys([]);
              event.preventDefault();
              editorRef.current?.focus({ preventScroll: true });
              try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* Synthetic pointer events have no capture target. */ }
              const point = surfacePoint(event);
              if (event.shiftKey || event.target.closest('.storyboard-clip') || (!event.target.closest('.storyboard-ruler') && point.y >= 30)) {
                stop();
                setHoverTime(null);
                marqueeRef.current = {
                  ...point, previous: selection, ids: selection, active: false, time: eventTime(event),
                };
                return;
              }
              dragRef.current = true;
              commit(eventTime(event));
            }}
            onPointerUp={(event) => {
              if (trimRef.current) {
                finishTrim(event);
                if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                return;
              }
              dragRef.current = false;
              if (marqueeRef.current) {
                updateMarquee(event);
                const gesture = marqueeRef.current;
                if (!gesture.active) commit(gesture.time);
                else {
                  setSelection(gesture.ids);
                  if (gesture.ids.length) {
                    selectedRef.current = gesture.ids[0];
                    onSelect(gesture.ids[0]);
                  }
                }
              }
              marqueeRef.current = null;
              setMarquee(null);
              if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => {
              cancelTrim();
              if (marqueeRef.current) setSelection(marqueeRef.current.previous);
              marqueeRef.current = null;
              setMarquee(null);
              dragRef.current = false;
              setHoverTime(null);
            }}
            onLostPointerCapture={() => {
              cancelTrim();
              if (marqueeRef.current) setSelection(marqueeRef.current.previous);
              marqueeRef.current = null;
              setMarquee(null);
              dragRef.current = false;
            }}>
            <div className="storyboard-ruler" role="slider" aria-label="播放进度" tabIndex={disabled || !total ? -1 : 0}
              aria-valuemin={0} aria-valuemax={total} aria-valuenow={Math.round(position)} aria-disabled={disabled || !total}
              aria-valuetext={clockTime(position, true)}
              onKeyDown={(event) => {
                if (disabled || !total) return;
                const step = event.shiftKey ? 1000 : 100;
                const time = ({ ArrowLeft: position - step, ArrowRight: position + step, Home: 0, End: total })[event.key];
                if (time === undefined) return;
                event.preventDefault();
                commit(time);
              }}>
              {ticks.map((tick) => <span key={tick.time} className={`storyboard-ruler__tick${tick.major ? ' is-major' : ''}`}
                style={{ left: tick.left }}>{tick.major ? <span>{clockTime(tick.time)}</span> : null}</span>)}
            </div>
            <div className="storyboard-clips">
              <Filmstrip source={mediaSource} audioOnly={audioOnly} clips={clips} scale={scale}
                scrollLeft={scrollLeft} viewportWidth={viewport} />
              {clips.map((clip) => <React.Fragment key={clip.id}><button type="button"
                className={`storyboard-clip${selectedIds.includes(clip.id) ? ' is-selected' : ''}${clip.blank ? ' is-blank' : ''}${hoverPoint?.clip.id === clip.id ? ' is-hovered' : ''}`}
                style={{ left: clip.timelineStart / 1000 * scale, width: Math.max(1, clip.duration / 1000 * scale - 3) }}
                aria-label={`选择 ${clip.label}`} aria-pressed={selectedIds.includes(clip.id)} disabled={disabled}
                onClick={(event) => { if (event.detail === 0) commit(clip.timelineStart); }} />
                {onResize && !clip.blank && selectedIds.length === 1 && selectedIds.includes(clip.id) ? ['start', 'end'].map((edge) => {
                  const width = Math.max(1, clip.duration / 1000 * scale - 3);
                  const handleWidth = Math.min(10, width / 2);
                  const bounds = trimBounds(parts, clip.id, edge, sourceEnd);
                  return <button type="button" key={edge} data-trim={edge}
                    className={`storyboard-clip__handle is-${edge === 'start' ? 'left' : 'right'}`}
                    style={{ left: clip.timelineStart / 1000 * scale + (edge === 'start' ? 0 : width - handleWidth), width: handleWidth }}
                    aria-label={`调整${clip.label}的${edge === 'start' ? '起点' : '终点'}`}
                    title="拖动调整边界；方向键微调 10ms，Shift 微调 100ms"
                    role="slider" aria-valuemin={bounds.min} aria-valuemax={bounds.max} aria-valuenow={clip[edge]}
                    aria-valuetext={clockTime(clip[edge], true)} disabled={disabled}
                    onPointerDown={(event) => beginTrim(event, clip, edge)}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                      if (disabled || trimRef.current || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
                      event.preventDefault();
                      event.stopPropagation();
                      stop();
                      onResize(clip.id, edge, clip[edge] + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 100 : 10), sourceEnd);
                    }}><i /></button>;
                }) : null}
              </React.Fragment>)}
              {pendingUnits.map((unit) => <div key={unit.key} className="storyboard-pending-range"
                data-start={unit.time} data-end={unit.time + unit.end - unit.start}
                style={{ left: unit.time / 1000 * scale, width: (unit.end - unit.start) / 1000 * scale }}
                aria-hidden="true" />)}
            </div>
            {clips.map((clip, index) => <div key={clip.id} className="storyboard-insert"
              style={{ left: clip.timelineStart / 1000 * scale, transform: index === 0 ? 'none' : undefined }}>
              <Tooltip title={index ? '插入空分镜' : '插入空分镜'}>
                <button type="button" data-insert aria-label={`在第 ${index + 1} 个分镜前插入空分镜`}
                  disabled={disabled} onClick={() => insert(index)}><Plus size={14} /></button>
              </Tooltip>
            </div>)}
            <button type="button" data-insert className="storyboard-append" style={{ left: totalWidth + 5 }}
              aria-label="在末尾新增空分镜" title="新增空分镜" disabled={disabled} onClick={() => insert(clips.length)}>
              <Plus size={26} strokeWidth={1.5} />
            </button>
            {total ? <div className="storyboard-playhead" style={{ left: position / 1000 * scale }} aria-hidden="true"><span /></div> : null}
            {hoverPoint ? <div className="storyboard-hoverline" style={{ left: hoverPoint.position / 1000 * scale }} aria-hidden="true">
              <span>{clockTime(hoverPoint.position, true)}</span>
            </div> : null}
            {marquee ? <div className="storyboard-marquee" style={marquee} aria-hidden="true" /> : null}
            {trimPreview ? <div className="storyboard-trim-time" role="status">
              {trimPreview.edge === 'start' ? '起点' : '终点'} {clockTime(trimPreview.parts.find((part) => part.id === trimPreview.id)[trimPreview.edge], true)}
            </div> : null}
          </div>
        </div>
      </div>
    </section>
  </div>;
};

export default StoryboardEditor;
