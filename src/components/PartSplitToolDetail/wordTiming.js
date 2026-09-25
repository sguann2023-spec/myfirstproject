const spokenCharacters = (text) => [...String(text).matchAll(/[\p{L}\p{N}]/gu)];

export const collectWords = (data) => {
  const words = [];
  const walk = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 15) return;
    if (Array.isArray(node.words)) {
      for (const word of node.words) {
        const start = word?.start_time ?? word?.start_ms ?? word?.start;
        const end = word?.end_time ?? word?.end_ms ?? word?.end;
        const text = typeof word?.word === 'string' && word.word.trim() ? word.word : word?.text;
        if (typeof text === 'string' && text.trim() && Number.isFinite(start) && Number.isFinite(end)
          && start >= 0 && end > start) words.push({ text, start, end });
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (key !== 'words' && value && typeof value === 'object') walk(value, depth + 1);
    }
  };
  walk(data);
  return [...new Map(words.map((word) => [`${word.start}:${word.end}:${word.text}`, word])).values()]
    .sort((a, b) => a.start - b.start || a.end - b.end);
};

// Match text monotonically, ignoring punctuation. Never invent word boundaries
// by dividing a sentence's duration; unmatched text remains non-destructive.
export const alignWords = (cue, words = []) => {
  const chars = spokenCharacters(cue.text);
  const normalized = chars.map((match) => match[0]).join('');
  let cursor = 0;
  const result = [];
  for (const word of words) {
    if (word.end <= cue.start || word.start >= cue.end) continue;
    const text = spokenCharacters(word.text).map((match) => match[0]).join('');
    if (!text) continue;
    const at = normalized.indexOf(text, cursor);
    if (at < 0) continue;
    // Offsets in the normalized string may differ from UTF-16 source offsets.
    let normalizedOffset = 0;
    const first = chars.find((match) => {
      const hit = normalizedOffset === at;
      normalizedOffset += match[0].length;
      return hit;
    });
    const lastIndex = chars.findIndex((match) => match === first) + spokenCharacters(text).length - 1;
    if (!first || !chars[lastIndex]) continue;
    const following = chars[lastIndex + 1];
    result.push({
      start: Math.max(cue.start, word.start), end: Math.min(cue.end, word.end),
      from: first.index, to: following?.index ?? cue.text.length,
      text: cue.text.slice(first.index, following?.index ?? cue.text.length),
    });
    cursor = at + text.length;
  }
  return result;
};

export const clipCaption = (cue, start, end) => {
  if (cue.words?.length) {
    const words = cue.words.filter((word) => word.start < end && word.end > start);
    if (!words.length) return null;
    let text = '';
    const nextWords = words.map((word) => {
      const from = text.length;
      text += cue.text.slice(word.from, word.to);
      return { ...word, start: Math.max(start, word.start), end: Math.min(end, word.end), from, to: text.length };
    });
    return { start, end, text, words: nextWords };
  }
  return { start, end, text: cue.text };
};
