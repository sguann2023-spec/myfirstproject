import React from 'react';
import { Film, Music2 } from 'lucide-react';
import { partPoint } from './model';

const waitForMedia = (video, eventName, signal) => new Promise((resolve, reject) => {
  const finish = (error) => {
    clearTimeout(timer);
    video.removeEventListener(eventName, ready);
    video.removeEventListener('error', failed);
    signal.removeEventListener('abort', aborted);
    if (error) reject(error);
    else resolve();
  };
  const ready = () => finish();
  const failed = () => finish(new Error('Media unavailable'));
  const aborted = () => finish(new Error('Cancelled'));
  const timer = setTimeout(failed, 8000);
  video.addEventListener(eventName, ready, { once: true });
  video.addEventListener('error', failed, { once: true });
  signal.addEventListener('abort', aborted, { once: true });
  if (signal.aborted) aborted();
});

// A single decoder fills only visible tiles. Canvas pixels stay local, including
// cross-origin frames; no canvas export or extra upload is required.
const Filmstrip = ({ source, audioOnly, clips, scale, scrollLeft, viewportWidth }) => {
  const canvasRefs = React.useRef(new Map());
  const [failed, setFailed] = React.useState(false);
  const [settledScroll, setSettledScroll] = React.useState(scrollLeft);
  React.useEffect(() => {
    const timer = setTimeout(() => setSettledScroll(scrollLeft), 100);
    return () => clearTimeout(timer);
  }, [scrollLeft]);
  const tiles = React.useMemo(() => {
    const result = [];
    const from = Math.max(0, settledScroll - 180);
    const to = settledScroll + viewportWidth + 180;
    for (const clip of clips) {
      if (clip.blank || !clip.duration) continue;
      const left = clip.timelineStart / 1000 * scale;
      const width = clip.duration / 1000 * scale;
      if (left + width < from || left > to) continue;
      const first = Math.max(0, Math.floor((from - left) / 90));
      const last = Math.min(Math.ceil(width / 90), Math.ceil((to - left) / 90));
      for (let index = first; index < last && result.length < 100; index += 1) {
        const tileWidth = Math.max(0, Math.min(90, width - index * 90 - 3));
        if (!tileWidth) continue;
        result.push({
          key: `${clip.id}-${index}`, left: left + index * 90, width: tileWidth,
          sourceTime: partPoint(clip, (index * 90 + tileWidth / 2) / width * clip.duration).sourceTime,
          first: index === 0, last: index * 90 + tileWidth >= width - 3,
        });
      }
    }
    return result;
  }, [clips, scale, settledScroll, viewportWidth]);

  React.useEffect(() => {
    setFailed(false);
    if (!source || audioOnly || !tiles.length) return undefined;
    const controller = new AbortController();
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    const renderFrames = async () => {
      const ready = waitForMedia(video, 'loadeddata', controller.signal);
      video.src = source;
      await ready;
      for (const tile of tiles) {
        if (controller.signal.aborted) return;
        const canvas = canvasRefs.current.get(tile.key);
        if (!canvas || !video.videoWidth || !video.videoHeight) continue;
        const time = Math.max(0, Math.min(tile.sourceTime / 1000, video.duration - 0.01));
        if (Math.abs(video.currentTime - time) > 0.001) {
          const seeked = waitForMedia(video, 'seeked', controller.signal);
          video.currentTime = time;
          await seeked;
        }
        if (controller.signal.aborted) return;
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.max(1, Math.round(tile.width * ratio));
        canvas.height = 70 * ratio;
        const context = canvas.getContext('2d');
        if (!context) continue;
        const fit = Math.max(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
        const width = video.videoWidth * fit;
        const height = video.videoHeight * fit;
        context.drawImage(video, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
      }
    };
    renderFrames().catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => {
      controller.abort();
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [source, audioOnly, tiles]);

  return <div className="storyboard-filmstrip" aria-hidden="true">
    {clips.map((clip) => <div key={clip.id} className={`storyboard-filmstrip__base${clip.blank ? ' is-blank' : ''}`}
      style={{ left: clip.timelineStart / 1000 * scale, width: Math.max(0, clip.duration / 1000 * scale - 3) }}>
      {clip.blank ? <span>空分镜</span> : audioOnly ? <Music2 size={20} /> : <Film size={18} />}
      {failed && !clip.blank ? <span>预览帧不可用</span> : null}
    </div>)}
    {!audioOnly && !failed ? tiles.map((tile) => <canvas key={tile.key}
      ref={(canvas) => {
        if (canvas) canvasRefs.current.set(tile.key, canvas);
        else canvasRefs.current.delete(tile.key);
      }}
      style={{
        left: tile.left, width: tile.width, height: 70,
        borderRadius: `${tile.first ? 5 : 0}px ${tile.last ? 5 : 0}px ${tile.last ? 5 : 0}px ${tile.first ? 5 : 0}px`,
      }} />) : null}
  </div>;
};

export default Filmstrip;
