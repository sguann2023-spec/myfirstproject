import { buildTextEffectParams, DEFAULT_TEXT_EFFECTS, normalizeTextEffectParams, resolveTextEffects } from './textEffects';

// Editor offsets are UTF-16; the Python text API uses Unicode code-point offsets.
export const TYPOGRAPHY_KEYS = ['font', 'fontSize', 'bold', 'italic', 'underline', 'color', 'border', 'shadow'];
const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function typographyRuns(text, runs = [], defaults = {}) {
  const result = [];
  let offset = 0;
  for (const character of String(text)) {
    const found = runs.find((run) => run.start <= offset && run.end > offset);
    const font = found?.font ?? defaults.font ?? '';
    const fontSize = found?.fontSize ?? defaults.fontSize ?? 24;
    const styles = Object.fromEntries(['bold', 'italic', 'underline'].map((key) => [
      key, Boolean(found?.[key] ?? defaults[key] ?? defaults.styles?.[key]),
    ]));
    const color = (found?.color ?? defaults.color ?? '#FFFFFF').toUpperCase();
    const { border, shadow } = resolveTextEffects({
      border: { ...defaults.border, ...found?.border },
      shadow: { ...defaults.shadow, ...found?.shadow },
    });
    const resolved = { font, fontSize, ...styles, color, border, shadow };
    const previous = result.at(-1);
    if (previous && TYPOGRAPHY_KEYS.every((key) => sameValue(previous[key], resolved[key]))) {
      previous.end += character.length;
    } else {
      result.push({ start: offset, end: offset + character.length, ...resolved });
    }
    offset += character.length;
  }
  return result;
}

export function applyTypography(text, runs, defaults, selection, patch) {
  const start = selection?.start ?? 0;
  const end = selection?.end ?? text.length;
  const split = [];
  for (const run of typographyRuns(text, runs, defaults)) {
    const boundaries = [...new Set([run.start, run.end,
      Math.max(run.start, Math.min(run.end, start)),
      Math.max(run.start, Math.min(run.end, end))])].sort((a, b) => a - b);
    for (let index = 0; index < boundaries.length - 1; index++) {
      const a = boundaries[index];
      const b = boundaries[index + 1];
      const selectedPatch = a >= start && b <= end ? patch : {};
      split.push({
        ...run, ...selectedPatch,
        ...Object.fromEntries(['border', 'shadow'].filter((key) => selectedPatch[key]).map((key) => [
          key, { ...run[key], ...selectedPatch[key] },
        ])),
        start: a, end: b,
      });
    }
  }
  return typographyRuns(text, split, defaults);
}

export function selectedTypography(text, runs, defaults, selection) {
  const range = selection && selection.end > selection.start ? selection : { start: 0, end: text.length };
  const selected = typographyRuns(text, runs, defaults)
    .filter((run) => run.start < range.end && run.end > range.start);
  const uniformValue = (values, fallback) => !values.length ? fallback
    : values.every((value) => sameValue(value, values[0])) ? values[0] : null;
  return Object.fromEntries(TYPOGRAPHY_KEYS.map((key) => [
    key, ['border', 'shadow'].includes(key)
      ? Object.fromEntries(Object.keys(DEFAULT_TEXT_EFFECTS[key]).map((field) => [
        field, uniformValue(selected.map((run) => run[key][field]), defaults[key]?.[field] ?? DEFAULT_TEXT_EFFECTS[key][field]),
      ]))
      : uniformValue(selected.map((run) => run[key]), defaults[key]),
  ]));
}

export function buildTextStyleRanges(text, settings = {}) {
  if (!settings.typographyRuns?.length) return [];
  const effects = buildTextEffectParams(settings);
  const vertical = ['top', 'vertical-center', 'bottom'].includes(settings.align);
  const align = { left: 0, right: 2, top: 3, bottom: 4 }[settings.align] ?? 1;
  return typographyRuns(text, settings.typographyRuns, settings).map((run) => ({
    start: Array.from(text.slice(0, run.start)).length,
    end: Array.from(text.slice(0, run.end)).length,
    font: run.font,
    style: {
      size: run.fontSize,
      bold: run.bold,
      italic: run.italic,
      underline: run.underline,
      color: run.color,
      alpha: effects.font_alpha,
      letter_spacing: settings.letterSpacing || 0,
      line_spacing: settings.lineSpacing || 0,
      vertical,
      align,
    },
    border: { width: run.border.enabled ? run.border.width : 0, color: run.border.color, alpha: effects.border_alpha },
    shadow: {
      enabled: run.shadow.enabled, alpha: run.shadow.opacity / 100 * effects.font_alpha,
      angle: run.shadow.angle, color: run.shadow.color, distance: run.shadow.distance,
      smoothing: run.shadow.smoothing / 100,
    },
  }));
}

export function validateTextStyleRanges(text, ranges) {
  if (ranges == null) return [];
  if (!Array.isArray(ranges)) throw new Error('text_styles must be an array');
  const length = Array.from(text).length;
  let lastEnd = 0;
  return ranges.map((range) => {
    if (!Number.isInteger(range?.start) || !Number.isInteger(range?.end)
      || range.start < lastEnd || range.end <= range.start || range.end > length
      || typeof range.font !== 'string' || !range.font.trim()
      || typeof range.style?.size !== 'number' || !Number.isFinite(range.style.size)
      || range.style.size < 5 || range.style.size > 300) {
      throw new Error('Invalid text style range');
    }
    lastEnd = range.end;
    const border = range.border;
    if (border != null && (
      typeof border.width !== 'number' || !Number.isFinite(border.width) || border.width < 0 || border.width > 100
      || typeof border.color !== 'string' || !/^#[\da-f]{6}$/i.test(border.color)
      || typeof border.alpha !== 'number' || !Number.isFinite(border.alpha) || border.alpha < 0 || border.alpha > 1
    )) throw new Error('Invalid text border');
    const shadow = range.shadow;
    if (shadow != null) {
      const fields = ['enabled', 'alpha', 'angle', 'color', 'distance', 'smoothing'];
      if (typeof shadow !== 'object' || fields.some((key) => shadow[key] == null)) throw new Error('Invalid text shadow');
      normalizeTextEffectParams(Object.fromEntries(fields.map((key) => [`shadow_${key}`, shadow[key]])));
    }
    return {
      start: range.start, end: range.end, font: range.font,
      style: { ...range.style },
      ...(border ? { border: { ...border } } : {}),
      ...(shadow ? { shadow: { ...shadow } } : {}),
    };
  });
}
