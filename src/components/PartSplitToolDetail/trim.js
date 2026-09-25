import { partRanges } from './model';
import { captionCues } from './subtitles';
import { clipCaption } from './wordTiming';

export const trimBounds = (parts, id, edge, sourceEnd) => {
  const part = parts.find((item) => item.id === id);
  if (!part || part.blank || !['start', 'end'].includes(edge)) return null;
  const ranges = partRanges(part);
  const min = edge === 'start' ? 0 : ranges.at(-1).start + 1;
  const max = edge === 'start' ? ranges[0].end - 1 : Math.max(part.end, Number.isFinite(sourceEnd) ? sourceEnd : part.end);
  return { min, max };
};

// Only the outer range changes. A merged shot's internal cuts stay deleted.
export const resizePart = (parts, segments, id, edge, requested, sourceEnd) => {
  const bounds = trimBounds(parts, id, edge, sourceEnd);
  if (!bounds || !Number.isFinite(requested)) return parts;
  const part = parts.find((item) => item.id === id);
  const value = Math.max(bounds.min, Math.min(bounds.max, Math.round(requested)));
  if (value === part[edge]) return parts;
  const oldRanges = partRanges(part);
  const ranges = oldRanges.map((range) => ({ ...range }));
  ranges[edge === 'start' ? 0 : ranges.length - 1][edge] = value;
  const next = { ...part, start: ranges[0].start, end: ranges.at(-1).end };
  delete next.ranges;
  if (ranges.length > 1) next.ranges = ranges;
  const extension = value < part.start ? { start: value, end: part.start }
    : value > part.end ? { start: part.end, end: value } : null;
  const sourceWords = segments.flatMap((cue) => cue.words || []);
  const captions = captionCues(part, segments).flatMap((cue) => {
    let current = cue;
    if (extension && cue.words?.length) {
      const words = cue.words.map((word) => {
        if (word[edge] !== part[edge]) return word;
        const original = sourceWords.find((source) => source.start < part[edge] && source.end > part[edge]
          && source.start < word.end && source.end > word.start);
        if (!original) return word;
        return { ...word, [edge]: edge === 'start' ? Math.max(value, original.start) : Math.min(value, original.end) };
      });
      current = { ...cue, words,
        start: Math.min(cue.start, ...words.map((word) => word.start)),
        end: Math.max(cue.end, ...words.map((word) => word.end)) };
    }
    return ranges.flatMap((range) => {
      const start = Math.max(current.start, range.start);
      const end = Math.min(current.end, range.end);
      if (end <= start) return [];
      if (start === current.start && end === current.end) return [current];
      const clipped = clipCaption(current, start, end);
      return clipped ? [clipped] : [];
    });
  });
  if (extension) {
    for (const cue of segments) {
      const start = Math.max(cue.start, extension.start);
      const end = Math.min(cue.end, extension.end);
      if (end <= start) continue;
      // Do not duplicate a word straddling the old edge or resurrect edited text.
      // Without word timing, only restore a completely recovered sentence.
      const words = cue.words?.filter((word) => !oldRanges.some((range) => word.start < range.end && word.end > range.start));
      if (cue.words?.length ? !words.length : start !== cue.start || end !== cue.end) continue;
      const restored = clipCaption({ ...cue, ...(words ? { words } : {}) }, start, end);
      if (restored) captions.push(restored);
    }
  }
  next.captions = captions.sort((a, b) => a.start - b.start || a.end - b.end);
  next.text = next.captions.map((cue) => cue.text).join('\n');
  return parts.map((item) => item.id === id ? next : item);
};
