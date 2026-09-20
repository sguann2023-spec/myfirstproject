export const DEFAULT_TEXT_PLACEMENT = { trackName: 'text_main', relativeIndex: null, start: 0, end: 3 };
export const MAX_TEXT_TIME = 86400;

const getTracks = (script) => Array.isArray(script?.tracks) ? script.tracks : Object.values(script?.tracks || {});
const getTrackName = (track) => String(track?.name || track?.track_name || '').trim();

export function getNextTextTrackRelativeIndex(script) {
  const finiteIndex = (value) => value == null || value === '' || !Number.isFinite(Number(value))
    ? null : Number(value);
  const indices = getTracks(script).flatMap((track) => {
    const relativeIndex = finiteIndex(track?.relative_index ?? track?.relativeIndex);
    if (relativeIndex !== null) return [relativeIndex];
    // Draft JSON may expose only absolute render indices for text tracks.
    if (String(track?.type || '').trim().toLowerCase() !== 'text') return [];
    const renderIndices = [track?.render_index, ...(track?.segments || []).map((segment) => segment?.render_index)]
      .map(finiteIndex).filter((index) => index !== null);
    return renderIndices.map((index) => index - 15000);
  });
  return indices.length ? Math.max(...indices) + 1 : 0;
}

export function getTextTrackNames(script) {
  return [...new Set(getTracks(script)
    .filter((track) => String(track?.type || '').trim().toLowerCase() === 'text')
    .map(getTrackName).filter(Boolean))];
}

export function resolveTextTrackPlacement(value = {}, script) {
  const placement = { ...value, ...resolveTextPlacement(value) };
  const names = getTextTrackNames(script);
  const existingName = names.includes(placement.trackName) ? placement.trackName : names[0];
  if (value.trackMode !== 'new' && existingName) {
    return { ...placement, trackMode: 'existing', trackName: existingName, newTrackName: value.newTrackName };
  }

  const usedNames = new Set(getTracks(script).map(getTrackName));
  const base = String(value.newTrackName ?? placement.trackName).trim().slice(0, 100) || DEFAULT_TEXT_PLACEMENT.trackName;
  let name = base;
  let sequence = 2;
  while (usedNames.has(name)) {
    const suffix = `_${sequence++}`;
    name = `${base.slice(0, 100 - suffix.length)}${suffix}`;
  }
  const requestedIndex = value.relative_index ?? value.relativeIndex;
  const relativeIndex = requestedIndex == null || requestedIndex === '' || !Number.isFinite(Number(requestedIndex))
    ? getNextTextTrackRelativeIndex(script) : placement.relativeIndex;
  return { ...placement, relativeIndex, trackMode: 'new', trackName: name, newTrackName: value.newTrackName ?? name };
}

export function resolveTextPlacement(value = {}) {
  const number = (input, fallback) => input == null || input === '' || !Number.isFinite(Number(input)) ? fallback : Number(input);
  const start = Math.round(Math.min(MAX_TEXT_TIME - 0.01, Math.max(0, number(value.start, 0))) * 100) / 100;
  const end = Math.round(Math.min(MAX_TEXT_TIME, Math.max(start + 0.01, number(value.end, start + 3))) * 100) / 100;
  return {
    trackName: String(value.track_name ?? value.trackName ?? '').trim() || DEFAULT_TEXT_PLACEMENT.trackName,
    relativeIndex: Math.round(Math.min(10000, Math.max(-10000, number(value.relative_index ?? value.relativeIndex, 0)))),
    start,
    end,
  };
}

export function buildTextPlacementParams(value) {
  const { trackName, relativeIndex, start, end } = resolveTextPlacement(value);
  return {
    track_name: trackName,
    ...(value?.trackMode === 'existing' ? {} : { relative_index: relativeIndex }),
    start,
    end,
  };
}
