import React from 'react';
import { Pause, Play, X } from 'lucide-react';

export const buildAudioPeaks = (buffer, count = 68) => {
  const peaks = Array(count).fill(0);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < count; index += 1) {
      const start = Math.floor(index * data.length / count);
      const end = Math.floor((index + 1) * data.length / count);
      for (let sample = start; sample < end; sample += 1) {
        peaks[index] = Math.max(peaks[index], Math.abs(data[sample]));
      }
    }
  }
  const max = Math.max(...peaks);
  return peaks.map((peak) => max ? peak / max : 0);
};

export const formatAudioClock = (seconds) => {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60]
    .map((value) => String(value).padStart(2, '0'));
};

const AudioPreview = ({ source, name, onRemove, removeDisabled = false, onDurationChange }) => {
  const mediaRef = React.useRef(null);
  const playIntent = React.useRef(false);
  const scrubbingRef = React.useRef(false);
  const [playing, setPlaying] = React.useState(false);
  const [duration, setDuration] = React.useState(0);
  const [time, setTime] = React.useState(0);
  const [peaks, setPeaks] = React.useState([]);
  const [waveStatus, setWaveStatus] = React.useState('正在生成波形');
  const [error, setError] = React.useState('');
  const progress = duration > 0 ? Math.max(0, Math.min(time / duration, 1)) : 0;
  const clock = formatAudioClock(time);

  React.useEffect(() => {
    if (!playing) return undefined;
    let frame;
    const updateProgress = () => {
      const media = mediaRef.current;
      // timeupdate fires too slowly for a smooth playhead; sample the real clock each frame.
      if (media && !media.seeking && !scrubbingRef.current) setTime(media.currentTime);
      frame = requestAnimationFrame(updateProgress);
    };
    frame = requestAnimationFrame(updateProgress);
    return () => cancelAnimationFrame(frame);
  }, [playing, source]);

  React.useEffect(() => {
    const controller = new AbortController();
    const media = mediaRef.current;
    let active = true;
    setPeaks([]);
    setWaveStatus('正在生成波形');
    setTime(0);
    setDuration(0);
    setPlaying(false);
    scrubbingRef.current = false;
    setError('');
    const loadWaveform = async () => {
      try {
        const Context = window.OfflineAudioContext;
        if (!Context) throw new Error('unsupported');
        const response = await fetch(source, { signal: controller.signal });
        if (!response.ok) throw new Error('fetch failed');
        // Limit waveform-only memory use; playback still supports larger media.
        const limit = 64 * 1024 * 1024;
        if (Number(response.headers.get('content-length')) > limit) throw new Error('large audio');
        const reader = response.body.getReader();
        const chunks = [];
        let size = 0;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > limit) {
            await reader.cancel();
            throw new Error('large audio');
          }
          chunks.push(value);
        }
        if (!active) return;
        const data = await new Blob(chunks).arrayBuffer();
        // Low-rate decoding is sufficient for an overview and bounds PCM memory.
        const buffer = await new Context(1, 1, 8000).decodeAudioData(data);
        if (!active) return;
        setPeaks(buildAudioPeaks(buffer));
        setWaveStatus('');
      } catch {
        if (active) setWaveStatus('波形暂不可用，仍可播放');
      }
    };
    void loadWaveform();
    return () => {
      active = false;
      playIntent.current = false;
      controller.abort();
      media?.pause();
    };
  }, [source]);

  const togglePlayback = async () => {
    const media = mediaRef.current;
    if (!media) return;
    if (playIntent.current || !media.paused) {
      playIntent.current = false;
      media.pause();
      return;
    }
    playIntent.current = true;
    try {
      await media.play();
      if (!playIntent.current) media.pause();
      else setError('');
    } catch {
      playIntent.current = false;
      setError('无法播放此音频，请检查文件格式');
    }
  };

  const updateDuration = (event) => {
    const value = event.currentTarget.duration;
    const next = Number.isFinite(value) && value > 0 ? value : 0;
    setDuration(next);
    onDurationChange?.(next);
  };

  return (
    <div className="chat-panel__subtitle-preview is-audio">
      <div className="subtitle-audio-card" role="group" aria-label={name || '音频播放器'} title={name}>
        <audio
          ref={mediaRef} src={source} preload="metadata" aria-label="音频预览"
          onLoadedMetadata={updateDuration} onDurationChange={updateDuration}
          onTimeUpdate={(event) => {
            if (!scrubbingRef.current && !event.currentTarget.seeking) setTime(event.currentTarget.currentTime);
          }}
          onSeeked={(event) => {
            if (!scrubbingRef.current) setTime(event.currentTarget.currentTime);
          }}
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
          onEnded={() => { playIntent.current = false; setPlaying(false); }}
          onError={() => setError('此音频无法预览，仍可提交识别或更换文件')}
        />
        <button type="button" className="chat-panel__subtitle-preview-remove" aria-label="移除"
          disabled={removeDisabled} onClick={() => {
            playIntent.current = false;
            mediaRef.current?.pause();
            onRemove?.();
          }}><X size={14} aria-hidden="true" /></button>
        <div className="subtitle-audio-waveform" style={{ '--audio-progress': `${progress * 100}%` }}>
          <svg viewBox="0 0 680 200" preserveAspectRatio="none" aria-hidden="true">
            {peaks.map((peak, index) => (
              <line key={index} x1={index * 10 + 5} x2={index * 10 + 5}
                y1={100 - Math.max(2, peak * 58)} y2={100 + Math.max(2, peak * 58)}
                stroke={(index + 0.5) / peaks.length <= progress ? '#f1f1f1' : '#737373'} strokeWidth="2" />
            ))}
          </svg>
          <div className="subtitle-audio-playhead" aria-hidden="true" />
          <input type="range" min={0} max={duration || 0} step={0.01}
            value={Math.min(time, duration)} disabled={!duration} aria-label="播放进度"
            aria-valuetext={`${clock.join(':')} / ${formatAudioClock(duration).join(':')}`}
            onPointerDown={(event) => {
              scrubbingRef.current = true;
              event.currentTarget.setPointerCapture?.(event.pointerId);
            }}
            onPointerUp={() => { scrubbingRef.current = false; }}
            onPointerCancel={() => { scrubbingRef.current = false; }}
            onLostPointerCapture={() => { scrubbingRef.current = false; }}
            onChange={(event) => {
              if (event.nativeEvent.type !== 'input') return;
              const next = Number(event.target.value);
              if (mediaRef.current) mediaRef.current.currentTime = next;
              setTime(next);
            }} />
        </div>
        {waveStatus && !error ? <div className="subtitle-audio-status" role="status">{waveStatus}</div> : null}
        {error ? <div className="subtitle-audio-status is-error" role="status">{error}</div> : null}
        <div className="subtitle-audio-footer">
          <div className="subtitle-audio-clock" aria-label={`已播放 ${clock.join(':')}`}>
            <span>{clock[0]} : {clock[1]}</span><span> : {clock[2]}</span>
          </div>
          <button type="button" className="subtitle-audio-play" aria-label={playing ? '暂停' : '播放'}
            onClick={togglePlayback}>
            {playing ? <Pause fill="currentColor" aria-hidden="true" /> : <Play fill="currentColor" aria-hidden="true" />}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AudioPreview;
