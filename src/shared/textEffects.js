export const TEXT_ANIMATION_GROUPS = ['intro', 'outro', 'loop'];
export const clampAnimationDuration = (value, fallback = 0.5) => {
  if (value == null || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(Math.max(0.1, Math.min(3, number)) * 10) / 10 : fallback;
};

export const DEFAULT_TEXT_EFFECTS = {
  blend: { enabled: true, opacity: 100 },
  border: { enabled: false, color: '#000000', width: 40 },
  shadow: { enabled: false, color: '#000000', opacity: 90, smoothing: 15, distance: 5, angle: -45 },
  flower: { enabled: false, id: '' },
  ...Object.fromEntries(TEXT_ANIMATION_GROUPS.map((key) => [key, { enabled: false, animation: '', duration: 0.5 }])),
  background: {
    enabled: false, style: 1, color: '#000000', opacity: 100,
    roundRadius: 0, height: 14, width: 14, verticalOffset: 50, horizontalOffset: 50,
  },
};

export const clampShadowAngle = (value, fallback = -45) => {
  if (value == null || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(Math.min(180, Math.max(-180, number))) : fallback;
};

export function getShadowPreview(shadow, fontSize = 24, scale = 1) {
  const value = resolveTextEffects({ shadow }).shadow;
  const angle = value.angle * Math.PI / 180;
  return {
    enabled: value.enabled,
    x: Math.cos(angle) * value.distance * scale,
    y: -Math.sin(angle) * value.distance * scale,
    blur: value.smoothing / 100 * fontSize * scale,
    color: value.color,
    opacity: value.opacity / 100,
  };
}

export function getTextShadowCss(shadow, fontSize = 24, unit = 1) {
  const preview = getShadowPreview(shadow, fontSize);
  if (!preview.enabled) return 'none';
  const rgb = [1, 3, 5].map((start) => parseInt(preview.color.slice(start, start + 2), 16));
  const length = (value) => typeof unit === 'number' ? `${value * unit}px` : `calc(${unit} * ${value})`;
  return `${length(preview.x)} ${length(preview.y)} ${length(preview.blur)} rgba(${rgb.join(',')},${preview.opacity})`;
}

export const clampEffectPercent = (value, fallback = 0) => {
  if (value == null || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(100, Math.max(0, number)) : fallback;
};

export function resolveTextEffects(settings = {}) {
  return Object.fromEntries(Object.entries(DEFAULT_TEXT_EFFECTS).map(([group, defaults]) => {
    const source = settings[group] || {};
    return [group, Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => {
      const value = source[key];
      if (key === 'enabled') return [key, typeof value === 'boolean' ? value : fallback];
      if (key === 'id') return [key, typeof value === 'string' ? value : fallback];
      if (key === 'animation') return [key, typeof value === 'string' ? value : fallback];
      if (key === 'duration') return [key, clampAnimationDuration(value, fallback)];
      if (key === 'color') return [key, /^#[\da-f]{6}$/i.test(value || '') ? value.toUpperCase() : fallback];
      if (key === 'style') return [key, value === 2 ? 2 : 1];
      if (key === 'angle') return [key, clampShadowAngle(value, fallback)];
      return [key, clampEffectPercent(value, fallback)];
    }))];
  }));
}

export function buildTextEffectParams(settings = {}) {
  const resolved = resolveTextEffects(settings);
  const { blend, border, background, shadow, flower } = resolved;
  const opacity = blend.enabled ? blend.opacity / 100 : 1;
  return {
    font_alpha: opacity,
    border_alpha: opacity,
    border_color: border.color,
    border_width: border.enabled ? border.width : 0,
    background_color: background.color,
    background_style: background.style,
    background_alpha: background.enabled ? background.opacity / 100 * opacity : 0,
    background_round_radius: background.roundRadius / 100,
    background_height: background.height / 100,
    background_width: background.width / 100,
    background_vertical_offset: background.verticalOffset / 100,
    background_horizontal_offset: background.horizontalOffset / 100,
    shadow_enabled: shadow.enabled,
    shadow_alpha: shadow.opacity / 100 * opacity,
    shadow_angle: shadow.angle,
    shadow_color: shadow.color,
    shadow_distance: shadow.distance,
    shadow_smoothing: shadow.smoothing / 100,
    ...(flower.enabled && flower.id.trim() ? { effect_effect_id: flower.id.trim() } : {}),
    ...Object.fromEntries(TEXT_ANIMATION_GROUPS.flatMap((group) => {
      const { enabled, animation, duration } = resolved[group];
      return enabled && animation.trim() ? [[`${group}_animation`, animation.trim()], [`${group}_duration`, duration]] : [];
    })),
  };
}

// Share the allowlist across renderer, IPC and copy/export paths.
export function normalizeTextEffectParams(input = {}) {
  const result = {};
  for (const key of [...Object.keys(buildTextEffectParams()), 'effect_effect_id',
    ...TEXT_ANIMATION_GROUPS.flatMap((group) => [`${group}_animation`, `${group}_duration`])]) {
    const value = input[key];
    if (value == null) continue;
    if (key === 'effect_effect_id' || key.endsWith('_animation')) {
      if (typeof value !== 'string') throw new Error(`Invalid ${key}`);
      if (value.trim()) result[key] = value.trim();
    } else if (key.endsWith('_duration')) {
      const number = Number(value);
      if (value === '' || !Number.isFinite(number) || number < 0.1 || number > 3) throw new Error(`Invalid ${key}`);
      result[key] = number;
    } else if (key === 'shadow_enabled') {
      if (typeof value !== 'boolean') throw new Error(`Invalid ${key}`);
      result[key] = value;
    } else if (key.endsWith('_color')) {
      if (typeof value !== 'string' || !/^#[\da-f]{6}$/i.test(value)) throw new Error(`Invalid ${key}`);
      result[key] = value.toUpperCase();
    } else {
      const number = Number(value);
      const max = key === 'shadow_angle' ? 180 : ['border_width', 'shadow_distance'].includes(key) ? 100 : key === 'background_style' ? 2 : 1;
      const min = key === 'shadow_angle' ? -180 : 0;
      if (value === '' || !Number.isFinite(number) || number < min || number > max
        || (key === 'background_style' && number !== 1 && number !== 2)) {
        throw new Error(`Invalid ${key}`);
      }
      result[key] = number;
    }
  }
  return result;
}
