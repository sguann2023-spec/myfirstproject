import React from 'react';
import { Maximize, Minimize, Music2, Pause, Play, Volume2, VolumeX, X } from 'lucide-react';

export const formatMediaTime = (seconds) => {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${String(minutes).padStart(2, '0')}:${rest}`;
};

export const fitMediaFrame = (width, height, mediaWidth, mediaHeight) => {
  if (!width || !height || !mediaWidth || !mediaHeight) return null;
  const scale = Math.min(width / mediaWidth, height / mediaHeight);
  return { width: mediaWidth * scale, height: mediaHeight * scale };
};

const MediaPreview = ({ source, name, kind = 'video', onRemove, removeDisabled = false, onDurationChange }) => {
  const containerRef = React.useRef(null);
  const mediaRef = React.useRef(null);
  const hoveredRef = React.useRef(false);
  const shouldPlayRef = React.useRef(false);
  const manuallyPausedRef = React.useRef(false);
  const scrubbingRef = React.useRef(false);
  const pendingSeekRef = React.useRef(null);
  const activeSeekRef = React.useRef(null);
  const [playing, setPlaying] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);
  const [muted, setMuted] = React.useState(true);
  const [duration, setDuration] = React.useState(0);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [fullscreen, setFullscreen] = React.useState(false);
  const [error, setError] = React.useState('');
  const [frameSize, setFrameSize] = React.useState(null);

  const resetToFirstFrame = React.useCallback(() => {
    const media = mediaRef.current;
    if (!media) return;
    shouldPlayRef.current = false;
    pendingSeekRef.current = null;
    activeSeekRef.current = null;
    media.pause();
    const time = kind === 'video' && media.duration > 0 ? Math.min(0.01, media.duration / 2) : 0;
    media.currentTime = time;
    setCurrentTime(time);
    setPlaying(false);
  }, [kind]);

  const updateFrameSize = React.useCallback(() => {
    const container = containerRef.current;
    const media = mediaRef.current;
    if (!container || !media || kind === 'audio') return;
    setFrameSize(fitMediaFrame(container.clientWidth, container.clientHeight, media.videoWidth, media.videoHeight));
  }, [kind]);

  React.useLayoutEffect(() => {
    updateFrameSize();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(updateFrameSize);
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [updateFrameSize]);

  React.useEffect(() => {
    const onFullscreen = () => {
      const active = document.fullscreenElement === containerRef.current;
      setFullscreen(active);
      if (!active && !hoveredRef.current) resetToFirstFrame();
    };
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreen);
      shouldPlayRef.current = false;
    };
  }, [resetToFirstFrame]);

  const pause = () => {
    shouldPlayRef.current = false;
    mediaRef.current?.pause();
  };

  const play = async () => {
    const media = mediaRef.current;
    if (!media) return;
    shouldPlayRef.current = true;
    if (!media.paused) return;
    try {
      await media.play();
      // Follow the latest intent, including a pause while play() was pending.
      if (!shouldPlayRef.current) media.pause();
    } catch {
      // Autoplay can be blocked; the explicit play control remains available.
    }
  };

  const seekTo = (time) => {
    const media = mediaRef.current;
    if (!media) return;
    setCurrentTime(time);
    // Finish the current decode before applying the latest drag position.
    if (activeSeekRef.current !== null || media.seeking) {
      // Returning to the in-flight target cancels any newer queued target.
      pendingSeekRef.current = activeSeekRef.current === time ? null : time;
    }
    else {
      pendingSeekRef.current = null;
      if (Math.abs(media.currentTime - time) > 0.001) {
        activeSeekRef.current = time;
        media.currentTime = time;
      }
    }
  };

  const finishScrubbing = () => {
    if (!scrubbingRef.current) return;
    scrubbingRef.current = false;
    if (!hoveredRef.current && document.fullscreenElement !== containerRef.current) {
      setHovered(false);
      if (kind === 'video') resetToFirstFrame();
      else pause();
    }
  };

  const togglePlayback = () => {
    if (shouldPlayRef.current || !mediaRef.current?.paused) {
      manuallyPausedRef.current = true;
      pause();
    } else {
      manuallyPausedRef.current = false;
      void play();
    }
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement === containerRef.current) {
        await document.exitFullscreen();
      } else {
        await containerRef.current?.requestFullscreen();
      }
    } catch {
      setError('当前环境不支持全屏预览');
    }
  };

  const Media = kind === 'audio' ? 'audio' : 'video';
  const idle = kind === 'video' && !hovered && !fullscreen && !playing;
  return (
    <div
      ref={containerRef}
      className={`chat-panel__subtitle-preview${kind === 'audio' ? ' is-audio' : ''}${hovered ? ' is-hovered' : ''}${idle ? ' is-idle' : ''}`}
    >
      {/* Overlays share the decoded picture bounds, not the letterboxed preview area. */}
      <div
        className="chat-panel__subtitle-preview-frame"
        style={frameSize || undefined}
      onMouseEnter={() => {
        hoveredRef.current = true;
        setHovered(true);
        if (!manuallyPausedRef.current) void play();
      }}
      onMouseLeave={() => {
        hoveredRef.current = false;
        if (scrubbingRef.current) return;
        setHovered(false);
        if (document.fullscreenElement !== containerRef.current) {
          if (kind === 'video') resetToFirstFrame();
          else pause();
        }
      }}
    >
      {!fullscreen ? <button
        type="button"
        className="chat-panel__subtitle-preview-remove"
        aria-label="移除"
        title="移除媒体"
        disabled={removeDisabled}
        onClick={() => {
          pause();
          onRemove?.();
        }}
      ><X size={14} aria-hidden="true" /></button> : null}
      <Media
        ref={mediaRef}
        src={source}
        className="chat-panel__subtitle-preview-media"
        aria-label={kind === 'audio' ? '音频预览' : '视频预览'}
        preload="auto"
        playsInline
        muted={muted}
        onLoadedMetadata={(event) => {
          const media = event.currentTarget;
          updateFrameSize();
          setDuration(Number.isFinite(media.duration) ? media.duration : 0);
          onDurationChange?.(Number.isFinite(media.duration) && media.duration > 0 ? media.duration : 0);
          // Decode a frame immediately without starting playback.
          if (kind === 'video' && media.currentTime === 0 && media.duration > 0) {
            media.currentTime = Math.min(0.01, media.duration / 2);
          }
        }}
        onResize={updateFrameSize}
        onLoadedData={() => {
          setError('');
          if (hoveredRef.current && !manuallyPausedRef.current) void play();
        }}
        onDurationChange={(event) => {
          const value = event.currentTarget.duration;
          setDuration(Number.isFinite(value) ? value : 0);
          onDurationChange?.(Number.isFinite(value) && value > 0 ? value : 0);
        }}
        onTimeUpdate={(event) => {
          if (!event.currentTarget.seeking && activeSeekRef.current === null && pendingSeekRef.current === null) {
            setCurrentTime(event.currentTarget.currentTime);
          }
        }}
        onSeeked={(event) => {
          const media = event.currentTarget;
          const target = pendingSeekRef.current;
          const completedTarget = activeSeekRef.current;
          pendingSeekRef.current = null;
          activeSeekRef.current = null;
          if (target !== null && target !== completedTarget && Math.abs(media.currentTime - target) > 0.001) {
            activeSeekRef.current = target;
            media.currentTime = target;
          } else {
            setCurrentTime(media.currentTime);
          }
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          shouldPlayRef.current = false;
          setPlaying(false);
        }}
        onError={() => setError('此媒体无法预览，可能是编码不受支持；仍可提交识别或更换文件')}
      />
      {kind === 'audio' ? (
        <div className="chat-panel__subtitle-preview-audio">
          <Music2 size={38} aria-hidden="true" />
          <span title={name}>{name || '音频预览'}</span>
        </div>
      ) : null}
      {idle ? (
        <button
          type="button"
          className="chat-panel__subtitle-preview-center-play"
          aria-label="播放预览"
          onClick={() => {
            manuallyPausedRef.current = false;
            void play();
          }}
        ><Play size={18} fill="currentColor" aria-hidden="true" /></button>
      ) : null}
      {error ? <div className="chat-panel__subtitle-preview-error" role="status">{error}</div> : null}
      <div className="chat-panel__subtitle-preview-controls">
        <div className="chat-panel__subtitle-preview-toolbar">
          <button
            className="chat-panel__subtitle-preview-playback"
            type="button"
            aria-label={playing ? '暂停' : '播放'}
            onClick={togglePlayback}
          >
            {playing ? <Pause size={16} /> : <Play size={16} />}
          <span className="chat-panel__subtitle-preview-time">{formatMediaTime(currentTime)} / {formatMediaTime(duration)}</span>
          </button>
          <div className="chat-panel__subtitle-preview-tools">
          <button type="button" aria-label={muted ? '取消静音' : '静音'} onClick={() => setMuted((previous) => !previous)}>
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <button type="button" aria-label={fullscreen ? '退出全屏' : '全屏'} onClick={toggleFullscreen}>
            {fullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
          </button>
          </div>
        </div>
        <input
          className="chat-panel__subtitle-preview-seek"
          type="range"
          aria-label="播放进度"
          min={0}
          max={duration || 0}
          step={0.01}
          value={Math.min(currentTime, duration)}
          disabled={!duration}
          style={{ '--subtitle-progress': `${duration ? Math.min(currentTime / duration, 1) * 100 : 0}%` }}
          onPointerDown={(event) => {
            scrubbingRef.current = true;
            event.currentTarget.setPointerCapture?.(event.pointerId);
          }}
          onPointerUp={finishScrubbing}
          onPointerCancel={finishScrubbing}
          onLostPointerCapture={finishScrubbing}
          onChange={(event) => {
            // React also maps the release-time change event here. Playback may
            // have updated the controlled value since input; do not seek twice.
            if (event.nativeEvent.type !== 'input') return;
            seekTo(Number(event.target.value));
          }}
        />
      </div>
      </div>
    </div>
  );
};

export default MediaPreview;
