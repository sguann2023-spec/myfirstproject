import { activeParts, partDuration, partPoint } from './model';

export const buildTimeline = (parts) => {
  let cursor = 0;
  return activeParts(parts).map((part) => {
    const duration = partDuration(part);
    const clip = { ...part, timelineStart: cursor, timelineEnd: cursor + duration, duration };
    cursor += duration;
    return clip;
  });
};

export const timelinePoint = (clips, time) => {
  if (!clips.length) return null;
  const total = clips[clips.length - 1].timelineEnd;
  const position = Math.max(0, Math.min(Number(time) || 0, total));
  const index = clips.findIndex((clip) => clip.timelineEnd > position);
  const clip = clips[index < 0 ? clips.length - 1 : index];
  const point = partPoint(clip, position - clip.timelineStart);
  return {
    clip, position, sourceTime: point.sourceTime, range: point.range,
    rangeTimelineStart: clip.timelineStart + point.offsetStart,
    rangeTimelineEnd: clip.timelineStart + point.offsetEnd,
  };
};

export const playbackTime = (clips, position = Infinity) => clips.reduce((time, clip) => (
  time + Math.max(0, Math.min(clip.duration, position - clip.timelineStart))
), 0);

export const nextPlayableClip = (clips, position) => clips.find((clip) => !clip.deleted && clip.timelineEnd > position);

export const clockTime = (milliseconds, precise = false) => {
  const value = Math.max(0, Math.floor(milliseconds || 0));
  const seconds = Math.floor(value / 1000);
  const clock = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  return precise ? `${clock}.${String(Math.floor(value % 1000 / 10)).padStart(2, '0')}` : clock;
};

export const rulerTicks = (duration, pixelsPerSecond, from = 0, to = Infinity) => {
  const majorSeconds = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find((step) => step * pixelsPerSecond >= 90) || 600;
  const minorMs = majorSeconds * 1000 / 5;
  const start = Math.max(0, Math.floor(from / minorMs));
  const end = Math.min(Math.ceil(duration / minorMs), Math.ceil(to / minorMs));
  const ticks = [];
  for (let index = start; index <= end; index += 1) {
    const time = index * minorMs;
    if (time > duration) break;
    ticks.push({ time, major: index % 5 === 0, left: time / 1000 * pixelsPerSecond });
  }
  return ticks;
};

export const insertEmptyPart = (parts, index, id) => {
  const at = Math.max(0, Math.min(index, parts.length));
  const reference = parts[at] || parts[at - 1];
  const start = reference?.start ?? 0;
  const part = {
    id, blank: true, text: '', sourceIndex: reference?.sourceIndex ?? 0,
    start, end: reference && reference.end > start ? reference.end : start + 2000,
  };
  const next = [...parts];
  next.splice(at, 0, part);
  return { parts: next, part };
};
