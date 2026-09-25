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
  onSelect, onSplit, onDelete, onInsert, onMerge, onEditCaption, onDeleteSubtitles, onDeleteSubtitleText,
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
  const [playing, setPlaying] = React.useState(false);
  const [fullscreen, setFullscreen] = React.useState(false);
  const [viewport, setViewport] = React.useState(680);
  const [scrollLeft, setScrollLeft] = React.useState(0);
  const [zoom, setZoom] = React.useState(100);
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
  const playheadRef = React.useRef(null);
  const clockRef = React.useRef(null);
  const rulerRef = React.useRef(null);
  const subtitleRef = React.useRef(null);
  const scrollerRef = React.useRef(null);
  const surfaceRef = React.useRef(null);
  const zoomAnchorRef = React.useRef(null);
  const positionRef = React.useRef(0);
  const visualPositionRef = React.useRef(0);
  const previousClipsRef = React.useRef(clips);
  const selectedRef = React.useRef(selectedId);
  const intentRef = React.useRef(false);
  const resumeAfterSeekRef = React.useRef(false);
  const dragRef = React.useRef(false);
  const commitRef = React.useRef(null);
  const playbackProbeRef = React.useRef({ stalled: 0, lastNext: null, lastMediaTime: null });
  // #region debug-point A-E:short-shot-playback-stall
  const debugPlaybackEvent = React.useCallback((hypothesisId, location, msg, data = {}) => {
    fetch('http://127.0.0.1:7777/event', { method: 'POST', body: JSON.stringify({
      sessionId: 'short-shot-playback-stall',
      runId: 'post-fix-2',
      hypothesisId,
      location,
      msg,
      data,
      ts: Date.now(),
    }) }).catch(() => {});
  }, []);
  // #endregion
  // #region debug-point E:分段耗时
  const debugTimings = React.useRef([]);
  React.useEffect(() => {
    const timer = setInterval(() => {
      const samples = debugTimings.current.splice(0);
      if (samples.length) fetch('http://127.0.0.1:7777/event', { method: 'POST', body: JSON.stringify({
        sessionId: 'playhead-jitter', runId: 'timing-after', hypothesisId: 'E-F',
        msg: '[DEBUG] 分段耗时批次', data: { samples }, ts: Date.now(),
      }) }).catch(() => {});
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  // #endregion
  const audioOnly = /\.(aac|flac|m4a|mp3|ogg|wav|wma)(?:[?#]|$)/i.test(mediaSource);
  const Media = audioOnly ? 'audio' : 'video';
  const seekMedia = useMediaSeeker(mediaRef, mediaSource);
  const scale = trimPreview?.scale ?? Math.min(240, Math.max(40, (viewport - 88) / Math.max(1, total / 1000))) * zoom / 100;
  const sourceEnd = mediaDuration || Math.max(0, ...parts.map((part) => part.blank ? 0 : part.end), ...segments.map((cue) => cue.end));
  const previousScaleRef = React.useRef(scale);
  const scaleRef = React.useRef(scale);
  scaleRef.current = scale;
  const totalWidth = total / 1000 * scale;
  const visibleClips = React.useMemo(() => clips.filter((clip) =>
    clip.timelineEnd / 1000 * scale >= scrollLeft - 180
    && clip.timelineStart / 1000 * scale <= scrollLeft + viewport + 180), [clips, scale, scrollLeft, viewport]);
  const currentPoint = timelinePoint(clips, position);
  const displayedPoint = trimPreview
    ? { clip: clips.find((clip) => clip.id === trimPreview.id) || currentPoint?.clip, sourceTime: trimPreview.sourceTime }
    : currentPoint;
  const selectedClip = clips.find((clip) => clip.id === selectedId);
  const selectedIds = React.useMemo(() => selection.filter((id) => clips.some((clip) => clip.id === id)), [selection, clips]);
  const deletableIds = selectedIds;
  const playableDuration = playbackTime(clips);
  const mergeAllowed = canMergeParts(parts, selectedIds);
  const captions = React.useMemo(() => new Map(clips.map((clip) => [clip.id, captionCues(clip, segments)])), [clips, segments]);
  // 合并分镜时把 clip 内的多段 cue 视为整体字幕，避免只显示当前时刻命中的那一段。
  const previewCaption = React.useCallback((clip, sourceTime) => {
    const cues = captions.get(clip?.id) || [];
    if (!cues.length || sourceTime === undefined || sourceTime === null) return '';
    if (cues.length > 1) {
      const start = Math.min(...cues.map((cue) => cue.start));
      const end = Math.max(...cues.map((cue) => cue.end));
      return sourceTime >= start && sourceTime < end ? cues.map((cue) => cue.text).join('') : '';
    }
    return cues.filter((cue) => sourceTime >= cue.start && sourceTime < cue.end).map((cue) => cue.text).join('');
  }, [captions]);
  const subtitle = displayedPoint ? previewCaption(displayedPoint.clip, displayedPoint.sourceTime) : '';
  const ticks = rulerTicks(total, scale, scrollLeft / scale * 1000, (scrollLeft + viewport) / scale * 1000);
  const movePlayhead = React.useCallback((value) => {
    if (playheadRef.current) {
      playheadRef.current.style.transform = `translate3d(${value / 1000 * scaleRef.current}px, 0, 0)`;
    }
  }, []);
  const syncPlaybackUi = React.useCallback((value) => {
    const point = timelinePoint(clips, value);
    if (rulerRef.current) {
      rulerRef.current.setAttribute('aria-valuenow', String(Math.round(value)));
      rulerRef.current.setAttribute('aria-valuetext', clockTime(value, true));
    }
    const clock = clockTime(value);
    if (clockRef.current && clockRef.current.textContent !== clock) clockRef.current.textContent = clock;
    if (subtitleRef.current) {
      const text = point ? previewCaption(point.clip, point.sourceTime) : '';
      if (subtitleRef.current.textContent !== text) subtitleRef.current.textContent = text;
      if (subtitleRef.current.hidden !== !text) subtitleRef.current.hidden = !text;
    }
  }, [clips, previewCaption]);
  const livePlaybackPosition = React.useCallback(() => {
    let point = timelinePoint(clips, positionRef.current);
    const media = mediaRef.current;
    if (!point || point.clip.blank || !media || media.seeking || media.readyState < 2) return positionRef.current;
    const sourceTime = media.currentTime * 1000;
    if (sourceTime < point.range.start) return positionRef.current;
    // 暂停可能先于下一次 RAF 到达；只越过连续源区间，不进入已删除区间。
    while (sourceTime >= point.range.end && point.rangeTimelineEnd < total) {
      const following = timelinePoint(clips, point.rangeTimelineEnd);
      if (following.clip.blank || following.range.start !== point.range.end) break;
      point = following;
    }
    if (sourceTime > point.range.end) return point.rangeTimelineEnd;
    return Math.max(0, Math.min(total, point.rangeTimelineStart + sourceTime - point.range.start));
  }, [clips, total]);

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
  }, [scale]);
  React.useLayoutEffect(() => { movePlayhead(visualPositionRef.current); }, [scale, movePlayhead]);
  // #region debug-point B:react-render-overwrite
  React.useLayoutEffect(() => {
    const node = playheadRef.current;
    if (!playing || !node) return;
    fetch('http://127.0.0.1:7777/event', { method: 'POST', body: JSON.stringify({
      sessionId: 'playhead-jitter', runId: 'post-fix', hypothesisId: 'B',
      location: 'StoryboardEditor.jsx:playhead-render', msg: '[DEBUG] React position render',
      data: { position, visualPosition: visualPositionRef.current, inlineTransform: node.style.transform },
      ts: Date.now(),
    }) }).catch(() => {});
  }, [position, playing]);
  // #endregion

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
    };
    scroller.addEventListener('wheel', wheel, { passive: false });
    return () => scroller.removeEventListener('wheel', wheel);
  }, [disabled, total]);

  const stop = React.useCallback((reason = 'unspecified') => {
    // #region debug-point D:stop-call
    debugPlaybackEvent('D', 'StoryboardEditor.jsx:stop', '[DEBUG] stop called', {
      reason,
      intent: intentRef.current,
      position: positionRef.current,
      mediaTime: mediaRef.current?.currentTime,
      paused: mediaRef.current?.paused,
      ended: mediaRef.current?.ended,
      seeking: mediaRef.current?.seeking,
      readyState: mediaRef.current?.readyState,
    });
    // #endregion
    const nextPosition = intentRef.current ? livePlaybackPosition() : positionRef.current;
    intentRef.current = false;
    resumeAfterSeekRef.current = false;
    mediaRef.current?.pause();
    positionRef.current = nextPosition;
    visualPositionRef.current = nextPosition;
    movePlayhead(nextPosition);
    syncPlaybackUi(nextPosition);
    React.startTransition(() => {
      setPosition(nextPosition);
      setPlaying(false);
    });
  }, [livePlaybackPosition, movePlayhead, syncPlaybackUi]);

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

  const commit = (time, preservePlayback = false, syncMedia = true) => {
    const point = timelinePoint(clips, time);
    if (!point) return;
    if (!preservePlayback) stop();
    positionRef.current = point.position;
    visualPositionRef.current = point.position;
    movePlayhead(point.position);
    syncPlaybackUi(point.position);
    const selectionChanged = selectedRef.current !== point.clip.id;
    selectedRef.current = point.clip.id;
    React.startTransition(() => {
      setSelection([point.clip.id]);
      setPosition(point.position);
      if (selectionChanged) onSelect(point.clip.id);
    });
    if (syncMedia) {
      if (point.clip.blank) mediaRef.current?.pause();
      else seekMedia(point.sourceTime);
    }
  };
  commitRef.current = commit;
  const previewSeek = (time) => {
    const point = timelinePoint(clips, time);
    if (!point) return;
    intentRef.current = false;
    mediaRef.current?.pause();
    positionRef.current = point.position;
    visualPositionRef.current = point.position;
    movePlayhead(point.position);
    syncPlaybackUi(point.position);
    if (!point.clip.blank) seekMedia(point.sourceTime);
  };

  React.useEffect(() => {
    stop('source-effect');
    marqueeRef.current = null;
    setMarquee(null);
    setMediaSource(source);
    setError('');
    setMediaDuration(0);
  }, [source, stop]);

  React.useEffect(() => {
    // #region debug-point D:clips-effect
    debugPlaybackEvent('D', 'StoryboardEditor.jsx:clips-effect', '[DEBUG] clips effect triggered', {
      clipCount: clips.length,
      selectedId,
      currentSelected: selectedRef.current,
      position: positionRef.current,
      intent: intentRef.current,
      firstClipId: clips[0]?.id,
      lastClipId: clips.at(-1)?.id,
    });
    // #endregion
    stop('clips-effect');
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
    else { positionRef.current = 0; setPosition(0); }
  }, [clips, stop]);

  React.useEffect(() => {
    if (selectedId === selectedRef.current) return;
    // 播放时内部会随播放头同步选中分镜，父级 selectedId 可能滞后一拍回流。
    // 此时不能按外部选中重新 commit，否则连续短分镜会被旧选中态打断播放。
    if (intentRef.current) return;
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
    return () => {
      intentRef.current = false;
      media?.pause();
    };
  }, [mediaSource]);
  React.useEffect(() => { if (disabled) stop('disabled-effect'); }, [disabled, stop]);
  // #region debug-point E:media-events
  React.useEffect(() => {
    const media = mediaRef.current;
    if (!media) return undefined;
    const attach = (type, hypothesisId) => {
      const handler = () => debugPlaybackEvent(hypothesisId, `StoryboardEditor.jsx:media:${type}`, '[DEBUG] media event', {
        type,
        currentTime: media.currentTime,
        paused: media.paused,
        ended: media.ended,
        seeking: media.seeking,
        readyState: media.readyState,
        intent: intentRef.current,
        position: positionRef.current,
      });
      media.addEventListener(type, handler);
      return handler;
    };
    const listeners = [
      ['play', 'A'],
      ['pause', 'A'],
      ['seeking', 'E'],
      ['seeked', 'E'],
      ['waiting', 'C'],
      ['ended', 'D'],
    ].map(([type, hypothesisId]) => [type, attach(type, hypothesisId)]);
    return () => listeners.forEach(([type, handler]) => media.removeEventListener(type, handler));
  }, [mediaSource, debugPlaybackEvent]);
  // #endregion

  const playMedia = async () => {
    if (!mediaRef.current || !intentRef.current) return;
    if (mediaRef.current.seeking || mediaRef.current.readyState < 2) {
      resumeAfterSeekRef.current = true;
      debugPlaybackEvent('F', 'StoryboardEditor.jsx:playMedia:defer', '[DEBUG] defer play until seek/ready', {
        currentTime: mediaRef.current.currentTime,
        paused: mediaRef.current.paused,
        ended: mediaRef.current.ended,
        seeking: mediaRef.current.seeking,
        readyState: mediaRef.current.readyState,
        position: positionRef.current,
      });
      return;
    }
    // #region debug-point A-C:play-request
    debugPlaybackEvent('A', 'StoryboardEditor.jsx:playMedia:start', '[DEBUG] playMedia request', {
      currentTime: mediaRef.current.currentTime,
      paused: mediaRef.current.paused,
      ended: mediaRef.current.ended,
      seeking: mediaRef.current.seeking,
      readyState: mediaRef.current.readyState,
      position: positionRef.current,
    });
    // #endregion
    try {
      await mediaRef.current.play();
      // #region debug-point C:play-resolve
      debugPlaybackEvent('C', 'StoryboardEditor.jsx:playMedia:resolved', '[DEBUG] playMedia resolved', {
        currentTime: mediaRef.current.currentTime,
        paused: mediaRef.current.paused,
        ended: mediaRef.current.ended,
        seeking: mediaRef.current.seeking,
        readyState: mediaRef.current.readyState,
        intent: intentRef.current,
        position: positionRef.current,
      });
      // #endregion
      if (!intentRef.current) mediaRef.current?.pause();
    } catch (error) {
      // #region debug-point C:play-reject
      debugPlaybackEvent('C', 'StoryboardEditor.jsx:playMedia:rejected', '[DEBUG] playMedia rejected', {
        name: error?.name,
        message: error?.message,
        currentTime: mediaRef.current?.currentTime,
        paused: mediaRef.current?.paused,
        ended: mediaRef.current?.ended,
        seeking: mediaRef.current?.seeking,
        readyState: mediaRef.current?.readyState,
        intent: intentRef.current,
        position: positionRef.current,
      });
      // #endregion
      if (intentRef.current) {
        stop('playMedia-catch');
        setError('素材无法播放，请检查文件或链接');
      }
    }
  };

  const resumePlaybackMedia = () => {
    const media = mediaRef.current;
    if (!media || !intentRef.current) return;
    const point = timelinePoint(clips, positionRef.current);
    if (!point || point.clip.blank) return;
    if (media.seeking || media.readyState < 2) {
      resumeAfterSeekRef.current = true;
      debugPlaybackEvent('F', 'StoryboardEditor.jsx:resumePlaybackMedia:defer', '[DEBUG] resume deferred', {
        clipId: point.clip.id,
        currentTime: media.currentTime,
        paused: media.paused,
        ended: media.ended,
        seeking: media.seeking,
        readyState: media.readyState,
        position: positionRef.current,
      });
      return;
    }
    resumeAfterSeekRef.current = false;
    debugPlaybackEvent('F', 'StoryboardEditor.jsx:resumePlaybackMedia:play', '[DEBUG] resume media playback', {
      clipId: point.clip.id,
      currentTime: media.currentTime,
      paused: media.paused,
      ended: media.ended,
      seeking: media.seeking,
      readyState: media.readyState,
      position: positionRef.current,
    });
    void playMedia();
  };

  React.useEffect(() => {
    const media = mediaRef.current;
    if (!media) return undefined;
    const resume = () => {
      if (resumeAfterSeekRef.current && intentRef.current) resumePlaybackMedia();
    };
    media.addEventListener('seeked', resume);
    media.addEventListener('canplay', resume);
    return () => {
      media.removeEventListener('seeked', resume);
      media.removeEventListener('canplay', resume);
    };
  }, [mediaSource, clips]);

  const togglePlayback = () => {
    if (intentRef.current) { stop('toggle-playback'); return; }
    if (!playableDuration || disabled) return;
    const next = nextPlayableClip(clips, positionRef.current) || nextPlayableClip(clips, 0);
    if (!next) return;
    if (positionRef.current >= total - 1 || positionRef.current < next.timelineStart
      || !nextPlayableClip(clips, positionRef.current)) commit(next.timelineStart);
    intentRef.current = true;
    React.startTransition(() => setPlaying(true));
    // #region debug-point A:toggle-playback
    debugPlaybackEvent('A', 'StoryboardEditor.jsx:togglePlayback', '[DEBUG] toggle playback start', {
      currentClipId: timelinePoint(clips, positionRef.current)?.clip.id,
      nextClipId: next.id,
      position: positionRef.current,
      playableDuration,
      mediaSource: Boolean(mediaSource),
    });
    // #endregion
    // #region debug-point C:playback-layout
    const playhead = playheadRef.current;
    const surface = surfaceRef.current;
    if (playhead && surface) fetch('http://127.0.0.1:7777/event', { method: 'POST', body: JSON.stringify({
      sessionId: 'playhead-jitter', runId: 'post-fix', hypothesisId: 'C',
      location: 'StoryboardEditor.jsx:togglePlayback', msg: '[DEBUG] Playback layout',
      data: {
        scale, zoom, devicePixelRatio: window.devicePixelRatio,
        surfaceWidth: surface.getBoundingClientRect().width, surfaceOffsetWidth: surface.offsetWidth,
        playheadLeft: playhead.getBoundingClientRect().left, inlineTransform: playhead.style.transform,
      },
      ts: Date.now(),
    }) }).catch(() => {});
    // #endregion
    if (!timelinePoint(clips, positionRef.current)?.clip.blank) void playMedia();
  };

  // Step through retained source ranges, including cuts inside a merged shot.
  React.useEffect(() => {
    if (!playing) return undefined;
    let frame;
    let previous = performance.now();
    let debugFrame = 0;
    const tick = (now) => {
      if (!intentRef.current) return;
      // #region debug-point E:帧开始
      const debugStarted = performance.now();
      // #endregion
      // 在修改字幕和播放头之前读取布局，避免同一帧内强制重排。
      const scroller = scrollerRef.current;
      const viewportLeft = scroller?.scrollLeft || 0;
      const viewportWidth = scroller?.clientWidth || 0;
      const point = timelinePoint(clips, positionRef.current);
      if (!point) { stop('tick-no-point'); return; }
      const media = mediaRef.current;
      if (!point.clip.blank && !mediaSource) {
        stop('tick-missing-media-source');
        setError('此分镜没有可播放的源素材');
        return;
      }
      const elapsed = Math.max(0, now - previous);
      let next = positionRef.current;
      if (point.clip.blank) next += elapsed;
      else if (media && !media.seeking && media.readyState >= 2) {
        next = point.rangeTimelineStart + Math.max(0, media.currentTime * 1000 - point.range.start);
        // 短距离 seek 后再恢复播放，避免 seek/play 同帧竞争导致 play 被中断。
        if (resumeAfterSeekRef.current && media.paused && intentRef.current) resumePlaybackMedia();
      }
      // #region debug-point B:stalled-progress
      if (!point.clip.blank && media && !media.seeking && media.readyState >= 2) {
        const mediaTime = media.currentTime * 1000;
        const probe = playbackProbeRef.current;
        const sameNext = probe.lastNext !== null && Math.abs(next - probe.lastNext) < 0.5;
        const sameMediaTime = probe.lastMediaTime !== null && Math.abs(mediaTime - probe.lastMediaTime) < 0.5;
        probe.stalled = sameNext && sameMediaTime ? probe.stalled + 1 : 0;
        probe.lastNext = next;
        probe.lastMediaTime = mediaTime;
        if (probe.stalled === 2 || probe.stalled === 5 || probe.stalled === 10) {
          debugPlaybackEvent('B', 'StoryboardEditor.jsx:playback-tick:stalled', '[DEBUG] playback stalled sample', {
            stalledFrames: probe.stalled,
            clipId: point.clip.id,
            rangeStart: point.range.start,
            rangeEnd: point.range.end,
            next,
            position: positionRef.current,
            mediaTime,
            paused: media.paused,
            ended: media.ended,
            seeking: media.seeking,
            readyState: media.readyState,
          });
        }
      } else {
        playbackProbeRef.current.stalled = 0;
        playbackProbeRef.current.lastNext = next;
        playbackProbeRef.current.lastMediaTime = media && Number.isFinite(media.currentTime) ? media.currentTime * 1000 : null;
      }
      // #endregion
      previous = now;
      let boundary = point;
      let jumped = false;
      // RAF can arrive after several short shots. Carry the actual playback
      // position across continuous ranges, but stop at the first real cut.
      while (next >= boundary.rangeTimelineEnd) {
        if (boundary.rangeTimelineEnd >= total) {
          // #region debug-point D:stop-at-total
          debugPlaybackEvent('D', 'StoryboardEditor.jsx:playback-tick:stop-total', '[DEBUG] stop at total boundary', {
            clipId: boundary.clip.id,
            rangeTimelineEnd: boundary.rangeTimelineEnd,
            total,
            next,
            mediaTime: media?.currentTime,
            ended: media?.ended,
            seeking: media?.seeking,
          });
          // #endregion
          positionRef.current = total;
          visualPositionRef.current = total;
          movePlayhead(total);
          setPosition(total);
          seekMedia(boundary.clip.end);
          stop('tick-reached-total');
          return;
        }
        const following = timelinePoint(clips, boundary.rangeTimelineEnd);
        if (!boundary.clip.blank && !following.clip.blank
          && boundary.range.end === following.range.start) {
          // #region debug-point D:continuous-boundary
          debugPlaybackEvent('D', 'StoryboardEditor.jsx:playback-tick:continuous', '[DEBUG] continuous boundary carry', {
            fromClipId: boundary.clip.id,
            toClipId: following.clip.id,
            next,
            rangeEnd: boundary.range.end,
            followingRangeStart: following.range.start,
            mediaTime: media?.currentTime,
            ended: media?.ended,
            seeking: media?.seeking,
          });
          // #endregion
          boundary = following;
          continue;
        }
        // #region debug-point D:hard-boundary
        debugPlaybackEvent('D', 'StoryboardEditor.jsx:playback-tick:jump', '[DEBUG] hard boundary jump', {
          fromClipId: boundary.clip.id,
          toClipId: following?.clip.id,
          next,
          boundaryEnd: boundary.rangeTimelineEnd,
          mediaTime: media?.currentTime,
          ended: media?.ended,
          seeking: media?.seeking,
        });
        // #endregion
        commitRef.current(boundary.rangeTimelineEnd, true);
        if (!following.clip.blank) resumePlaybackMedia();
        jumped = true;
        break;
      }
      if (!jumped && boundary !== point) {
        commitRef.current(next, true, false);
      } else if (!jumped) {
        positionRef.current = next;
        const predictedVisual = next;
        const correction = false;
        visualPositionRef.current = next;
        movePlayhead(visualPositionRef.current);
        syncPlaybackUi(next);
        // #region debug-point A:media-sampling
        debugFrame += 1;
        if (debugFrame <= 5 || debugFrame % 10 === 0 || correction) fetch('http://127.0.0.1:7777/event', { method: 'POST', body: JSON.stringify({
          sessionId: 'playhead-jitter', runId: 'post-fix', hypothesisId: 'A',
          location: 'StoryboardEditor.jsx:playback-tick', msg: '[DEBUG] Playback frame sample',
          data: {
            frame: debugFrame, elapsed, mediaTime: media?.currentTime, seeking: media?.seeking,
            logicalPosition: next, predictedVisual, visualPosition: visualPositionRef.current,
            correction, inlineTransform: playheadRef.current?.style.transform,
          },
          ts: Date.now(),
        }) }).catch(() => {});
        // #endregion
        // #region debug-point D:frame-gap
        if (elapsed > 30 && debugFrame % 10 === 0) fetch('http://127.0.0.1:7777/event', { method: 'POST', body: JSON.stringify({
          sessionId: 'playhead-jitter', runId: 'post-fix', hypothesisId: 'D',
          location: 'StoryboardEditor.jsx:playback-tick', msg: '[DEBUG] Long animation frame',
          data: { frame: debugFrame, elapsed, logicalPosition: next, visualPosition: visualPositionRef.current },
          ts: Date.now(),
        }) }).catch(() => {});
        // #endregion
      }
      const x = positionRef.current / 1000 * scale;
      // #region debug-point E:布局开始
      const debugBeforeLayout = performance.now();
      // #endregion
      if (scroller && (x > viewportLeft + viewportWidth - 30 || x < viewportLeft)) {
        const nextScrollLeft = Math.max(0, x - viewportWidth / 3);
        scroller.scrollLeft = nextScrollLeft;
        setScrollLeft(nextScrollLeft);
      }
      // #region debug-point E:帧完成
      if (debugTimings.current.length < 120) debugTimings.current.push({
        kind: 'frame', elapsed, work: debugBeforeLayout - debugStarted,
        layout: performance.now() - debugBeforeLayout, boundary: boundary !== point || jumped,
      });
      // #endregion
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, clips, total, scale, stop, seekMedia, mediaSource, movePlayhead, syncPlaybackUi]);

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
    if (dragRef.current) previewSeek(eventTime(event));
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
  const insert = (index) => { stop(); onInsert(index); };
  const seekSubtitle = (time) => {
    if (disabled) return;
    commit(time);
    const scroller = scrollerRef.current;
    const x = time / 1000 * scale;
    if (scroller && (x < scroller.scrollLeft || x > scroller.scrollLeft + scroller.clientWidth - 30)) {
      const nextScrollLeft = Math.max(0, x - scroller.clientWidth / 3);
      scroller.scrollLeft = nextScrollLeft;
      setScrollLeft(nextScrollLeft);
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
      editorRef.current?.focus({ preventScroll: true });
      onDelete(deletableIds);
    }}>
    <div className="storyboard-workspace">
    <div className="storyboard-preview" aria-label="分镜预览">
      {mediaSource ? <Media key={mediaSource} ref={mediaRef} src={mediaSource} preload="metadata" playsInline
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
          } else setError('原素材无法预览，仍可编辑和保存分镜');
        }}
      /> : null}
      {!displayedPoint ? <div className="storyboard-preview__empty">暂无分镜</div>
        : displayedPoint.clip.blank ? <div className="storyboard-preview__empty"><Plus size={30} /><span>空分镜</span></div>
        : audioOnly ? <div className="storyboard-preview__empty"><Music2 size={40} /><span>音频预览</span></div>
          : !mediaSource ? <div className="storyboard-preview__empty">没有可预览的媒体地址</div> : null}
      <div ref={subtitleRef} className="storyboard-preview__subtitle" hidden={!subtitle}>{subtitle}</div>
      {error ? <div className="storyboard-preview__error" role="status">{error}</div> : null}
    </div>
    <React.Profiler id="subtitles" onRender={(id, phase, actualDuration) => {
      // #region debug-point F:字幕渲染
      if (debugTimings.current.length < 120) debugTimings.current.push({ kind: id, phase, actualDuration });
      // #endregion
    }}>
    <SubtitlePanel clips={clips} segments={segments} selectedIds={selectedIds}
      aiDisabled={aiDisabled} onAiAssist={onAiAssist ? async () => {
        stop();
        setFullscreen(false);
        if (document.fullscreenElement === editorRef.current) {
          try { await document.exitFullscreen?.(); } catch { return; }
        }
        onAiAssist();
      } : undefined}
      units={units} pendingKeys={pendingKeys} onPendingChange={setPendingKeys}
      activeId={playing ? currentPoint?.clip.id : selectedId}
      disabled={disabled} onSeek={seekSubtitle} onEdit={onEditCaption}
      onDeleteText={() => {
        const textUnits = pendingUnits.filter((unit) => unit.kind === 'word');
        if (!textUnits.length || !onDeleteSubtitleText) return;
        stop();
        onDeleteSubtitleText(textUnits);
        setPendingKeys([]);
      }}
      onDelete={() => {
        if (!pendingUnits.length || !onDeleteSubtitles) return;
        stop();
        onDeleteSubtitles(pendingUnits);
        setPendingKeys([]);
      }} />
    </React.Profiler>
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
              onClick={() => { stop(); onMerge(selectedIds); }}>
              <Box size={18} />
            </button>
          </Tooltip>
        </div>
        <div className="storyboard-toolbar__transport">
          <button type="button" aria-label={playing ? '暂停预览' : '播放分镜序列'}
              disabled={disabled || !playableDuration || (!mediaSource && !currentPoint?.clip.blank)}
              onClick={togglePlayback}>
            {playing ? <Pause size={21} fill="currentColor" /> : <Play size={21} fill="currentColor" />}
          </button>
          <span className="storyboard-clock"><span ref={clockRef}>{clockTime(playbackTime(clips, position))}</span><span> / {clockTime(playableDuration)}</span></span>
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
        }}>
          <div ref={surfaceRef} className="storyboard-lane__surface" style={{ width: Math.max(viewport, totalWidth + 88) }}
            onPointerMove={handlePointerMove}
            onPointerDown={(event) => {
              if (disabled || event.button !== 0 || event.target.closest('[data-insert], [data-trim]') || !total) return;
              event.preventDefault();
              editorRef.current?.focus({ preventScroll: true });
              try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* Synthetic pointer events have no capture target. */ }
              const point = surfacePoint(event);
              if (event.shiftKey || event.target.closest('.storyboard-clip') || (!event.target.closest('.storyboard-ruler') && point.y >= 30)) {
                stop();
                marqueeRef.current = {
                  ...point, previous: selection, ids: selection, active: false, time: eventTime(event),
                };
                return;
              }
              dragRef.current = true;
              previewSeek(eventTime(event));
            }}
            onPointerUp={(event) => {
              if (trimRef.current) {
                finishTrim(event);
                if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                return;
              }
              const wasDragging = dragRef.current;
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
              } else if (wasDragging) commit(eventTime(event));
              marqueeRef.current = null;
              setMarquee(null);
              if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => {
              cancelTrim();
              if (dragRef.current) commit(positionRef.current);
              if (marqueeRef.current) setSelection(marqueeRef.current.previous);
              marqueeRef.current = null;
              setMarquee(null);
              dragRef.current = false;
            }}
            onLostPointerCapture={() => {
              cancelTrim();
              if (dragRef.current) commit(positionRef.current);
              if (marqueeRef.current) setSelection(marqueeRef.current.previous);
              marqueeRef.current = null;
              setMarquee(null);
              dragRef.current = false;
            }}>
            <div ref={rulerRef} className="storyboard-ruler" role="slider" aria-label="播放进度" tabIndex={disabled || !total ? -1 : 0}
              aria-valuemin={0} aria-valuemax={total} aria-valuenow={Math.round(position)} aria-disabled={disabled || !total}
              aria-valuetext={clockTime(position, true)}
              onKeyDown={(event) => {
                if (disabled || !total) return;
                const step = event.shiftKey ? 1000 : 100;
                const time = ({ ArrowLeft: positionRef.current - step, ArrowRight: positionRef.current + step, Home: 0, End: total })[event.key];
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
              {visibleClips.map((clip) => <React.Fragment key={clip.id}><button type="button"
                className={`storyboard-clip${selectedIds.includes(clip.id) ? ' is-selected' : ''}${clip.blank ? ' is-blank' : ''}`}
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
            {visibleClips.map((clip) => {
              const index = clips.indexOf(clip);
              return <div key={clip.id} className="storyboard-insert"
              style={{ left: clip.timelineStart / 1000 * scale, transform: index === 0 ? 'none' : undefined }}>
              <Tooltip title={index ? '插入空分镜' : '插入空分镜'}>
                <button type="button" data-insert aria-label={`在第 ${index + 1} 个分镜前插入空分镜`}
                  disabled={disabled} onClick={() => insert(index)}><Plus size={14} /></button>
              </Tooltip>
            </div>;
            })}
            <button type="button" data-insert className="storyboard-append" style={{ left: totalWidth + 5 }}
              aria-label="在末尾新增空分镜" title="新增空分镜" disabled={disabled} onClick={() => insert(clips.length)}>
              <Plus size={26} strokeWidth={1.5} />
            </button>
            {total ? <div ref={playheadRef} className="storyboard-playhead" aria-hidden="true"><span /></div> : null}
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
