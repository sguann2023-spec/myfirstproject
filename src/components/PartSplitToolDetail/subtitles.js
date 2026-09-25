import { partRanges, partOffset } from './model';
import { alignWords, clipCaption } from './wordTiming';

export const captionCues = (part, segments = []) => {
  if (part.blank) return [];
  const enrich = (cue) => {
    if (cue.words) return cue;
    const words = alignWords(cue, segments.flatMap((segment) => (segment.words || []).map((word) => ({
      ...word, text: segment.text.slice(word.from, word.to),
    }))));
    return words.length ? { ...cue, words } : cue;
  };
  if (part.captions && part.captions.map((cue) => cue.text).join('\n') === part.text) return part.captions.map(enrich);
  const matches = segments.filter((segment) => partRanges(part)
    .some((range) => segment.start < range.end && segment.end > range.start));
  // Older documents have only part.text. Keep their edited/split text authoritative.
  const lines = part.text.split('\n');
  const texts = matches.length === 1 ? [part.text]
    : lines.length === matches.length ? lines : null;
  if (!texts) return partRanges(part).map((range) => enrich({ ...range, text: part.text }));
  return matches.flatMap((segment, index) => partRanges(part).flatMap((range) => {
    const start = Math.max(range.start, segment.start);
    const end = Math.min(range.end, segment.end);
    return end > start ? [enrich({ start, end, text: texts[index] })] : [];
  }));
};

export const timedTokens = (cue) => {
  if (!cue.words?.length) return subtitleTokens(cue.text);
  const tokens = [];
  let cursor = 0;
  for (const word of cue.words) {
    if (word.from > cursor) tokens.push(...subtitleTokens(cue.text.slice(cursor, word.from))
      .map((token) => ({ ...token, start: cursor + token.start, end: cursor + token.end })));
    tokens.push({
      text: cue.text.slice(word.from, word.to), start: word.from, end: word.to,
      sourceStart: word.start, sourceEnd: word.end,
    });
    cursor = word.to;
  }
  if (cursor < cue.text.length) tokens.push(...subtitleTokens(cue.text.slice(cursor))
    .map((token) => ({ ...token, start: cursor + token.start, end: cursor + token.end })));
  return tokens;
};

// Display tokens only: without word timestamps, every token seeks its caption cue.
export const subtitleTokens = (text) => {
  const tokens = [];
  const pattern = /[a-zA-Z0-9]+(?:[.'-][a-zA-Z0-9]+)*|\p{Script=Han}|[^\s]/gu;
  for (const match of text.matchAll(pattern)) {
    const previous = tokens.at(-1);
    if (/^\p{P}+$/u.test(match[0]) && previous && previous.end === match.index) {
      previous.text += match[0];
      previous.end += match[0].length;
    } else tokens.push({ text: match[0], start: match.index, end: match.index + match[0].length });
  }
  return tokens;
};

export const subtitleRows = (clips, segments) => clips.map((clip) => {
  const cues = captionCues(clip, segments);
  const items = [];
  for (const range of partRanges(clip)) {
    let cursor = range.start;
    const pause = (start, end) => {
      if (!clip.blank && end - start >= 100) items.push({
        kind: 'pause', start, end, time: clip.timelineStart + partOffset(clip, start),
      });
    };
    cues.forEach((cue, cueIndex) => {
      const start = Math.max(range.start, cue.start);
      const end = Math.min(range.end, cue.end);
      if (end <= start) return;
      pause(cursor, start);
      const tokens = timedTokens(cue);
      if (tokens.length && tokens.every((token) => Number.isFinite(token.sourceStart))) {
        let wordCursor = start;
        for (const token of tokens) {
          if (token.sourceEnd <= start || token.sourceStart >= end) continue;
          pause(wordCursor, token.sourceStart);
          items.push({ kind: 'caption', cue, cueIndex, tokens: [token],
            time: clip.timelineStart + partOffset(clip, token.sourceStart) });
          wordCursor = Math.max(wordCursor, token.sourceEnd);
        }
        pause(wordCursor, end);
      } else items.push({ kind: 'caption', cue, cueIndex, tokens,
        time: clip.timelineStart + partOffset(clip, start) });
      cursor = Math.max(cursor, end);
    });
    pause(cursor, range.end);
  }
  return { clip, cues, items };
});

export const editCaption = (part, segments, edit) => {
  const captions = captionCues(part, segments);
  const cue = captions[edit.cueIndex];
  if (!cue || cue.text !== edit.originalText) return part;
  const text = cue.text.slice(0, edit.start) + edit.value + cue.text.slice(edit.end);
  if (text === cue.text) return part;
  const delta = edit.value.length - (edit.end - edit.start);
  const words = cue.words?.flatMap((word) => {
    if (word.to <= edit.start) return [word];
    if (word.from >= edit.end) return [{ ...word, from: word.from + delta, to: word.to + delta }];
    // An edited timestamped token keeps its original time, even when text grows.
    return edit.value ? [{ ...word, from: edit.start, to: edit.start + edit.value.length, text: edit.value }] : [];
  });
  const next = captions.map((item, index) => index === edit.cueIndex
    ? { ...item, text, ...(words ? { words } : {}) } : item);
  return { ...part, captions: next, text: next.map((item) => item.text).join('\n') };
};

const mergeTextCuts = (cuts) => cuts
  .filter((cut) => Number.isFinite(cut.start) && Number.isFinite(cut.end) && cut.end > cut.start)
  .sort((a, b) => a.start - b.start || a.end - b.end)
  .reduce((merged, cut) => {
    const previous = merged.at(-1);
    if (previous && cut.start <= previous.end) previous.end = Math.max(previous.end, cut.end);
    else merged.push({ start: cut.start, end: cut.end });
    return merged;
  }, []);

const removeTextRanges = (cue, cuts) => {
  cuts = mergeTextCuts(cuts).map((cut) => ({
    start: Math.max(0, Math.min(cue.text.length, cut.start)),
    end: Math.max(0, Math.min(cue.text.length, cut.end)),
  })).filter((cut) => cut.end > cut.start);
  if (!cuts.length) return cue;
  let cursor = 0;
  let text = '';
  for (const cut of cuts) {
    text += cue.text.slice(cursor, cut.start);
    cursor = cut.end;
  }
  text += cue.text.slice(cursor);
  const shiftAt = (index) => cuts.reduce((shift, cut) => shift + (cut.end <= index ? cut.end - cut.start : 0), 0);
  const words = cue.words?.flatMap((word) => {
    if (cuts.some((cut) => word.from < cut.end && word.to > cut.start)) return [];
    const shift = shiftAt(word.from);
    return [{ ...word, from: word.from - shift, to: word.to - shift }];
  });
  return { ...cue, text, ...(words ? { words } : {}) };
};

export const deleteSubtitleTextUnits = (parts, segments, units) => parts.map((part) => {
  const textUnits = units.filter((unit) => unit.kind === 'word' && unit.id === part.id);
  if (!textUnits.length) return part;
  const cutsByCue = new Map();
  for (const unit of textUnits) {
    if (!Number.isInteger(unit.cueIndex)) continue;
    const cuts = cutsByCue.get(unit.cueIndex) || [];
    cuts.push({ start: unit.textStart, end: unit.textEnd });
    cutsByCue.set(unit.cueIndex, cuts);
  }
  if (!cutsByCue.size) return part;
  const captions = captionCues(part, segments)
    .map((cue, index) => removeTextRanges(cue, cutsByCue.get(index) || []))
    .filter((cue) => cue.text.trim());
  return { ...part, captions, text: captions.map((cue) => cue.text).join('\n') };
});

export const subtitleUnits = (clips, segments) => subtitleRows(clips, segments).flatMap(({ clip, items }) =>
  items.flatMap((item, index) => item.kind === 'pause' ? [{
    id: clip.id, key: `${clip.id}-pause-${index}`, kind: 'pause',
    start: item.start, end: item.end, time: item.time,
  }] : item.tokens.filter((token) => Number.isFinite(token.sourceStart)).map((token) => ({
    id: clip.id, key: `${clip.id}-${item.cueIndex}-${token.start}`, kind: 'word', cueIndex: item.cueIndex,
    textStart: token.start, textEnd: token.end,
    start: token.sourceStart, end: token.sourceEnd,
    time: clip.timelineStart + partOffset(clip, token.sourceStart),
  }))));

export const subtractRanges = (ranges, cuts) => cuts.reduce((remaining, cut) => remaining.flatMap((range) => {
  if (cut.start >= range.end || cut.end <= range.start) return [range];
  return [
    ...(cut.start > range.start ? [{ start: range.start, end: cut.start }] : []),
    ...(cut.end < range.end ? [{ start: cut.end, end: range.end }] : []),
  ];
}), ranges);

export const deleteSubtitleUnits = (parts, segments, units) => {
  const ids = new Set(parts.map((part) => part.id));
  const nextId = (part, range) => {
    const base = `${part.id}-cut-${range.start}`;
    let id = base;
    let suffix = 1;
    while (ids.has(id)) id = `${base}-${suffix++}`;
    ids.add(id);
    return id;
  };
  return parts.flatMap((part) => {
    const cuts = units.filter((unit) => unit.id === part.id);
    if (!cuts.length) return [part];
    const ranges = subtractRanges(partRanges(part), cuts);
    if (!ranges.length) return [];
    const cues = captionCues(part, segments);
    // Each surviving source interval is independently selectable on the timeline.
    return ranges.map((range, index) => {
      const captions = cues.flatMap((cue) => {
        const start = Math.max(cue.start, range.start);
        const end = Math.min(cue.end, range.end);
        if (end <= start) return [];
        const clipped = clipCaption(cue, start, end);
        return clipped ? [clipped] : [];
      });
      const next = { ...part, ...range, id: index ? nextId(part, range) : part.id,
        captions, text: captions.map((cue) => cue.text).join('\n') };
      delete next.ranges;
      delete next.label;
      return next;
    });
  });
};
