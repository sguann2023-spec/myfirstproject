import { DEFAULT_TEXT_EFFECTS } from '../../shared/textEffects';

const preset = (id, name, color, options = {}) => ({
  id,
  name,
  typography: {
    color,
    bold: options.bold ?? true,
    italic: options.italic ?? false,
    underline: false,
    border: { ...DEFAULT_TEXT_EFFECTS.border, ...options.border },
    shadow: { ...DEFAULT_TEXT_EFFECTS.shadow, ...options.shadow },
  },
});

export const TEXT_STYLE_PRESETS = [
  preset('classic-white', '经典白字', '#FFFFFF', { border: { enabled: true, width: 25 } }),
  preset('highlight-yellow', '醒目黄字', '#FFE34D', { border: { enabled: true, width: 35 } }),
  preset('coral-red', '珊瑚红', '#FF6B6B'),
  preset('mint-green', '薄荷绿', '#8DE5B5', { bold: false }),
  preset('sky-blue', '晴空蓝', '#70C7FF'),
  preset('lavender', '薰衣草', '#C4AAFF', { bold: false }),
  preset('peach-pink', '蜜桃粉', '#FFB8CE', { bold: false }),
  preset('warm-cream', '暖奶油', '#FFF0CC', { shadow: { enabled: true, distance: 3, opacity: 60 } }),
  preset('vital-orange', '活力橙', '#FF9C3D', { border: { enabled: true, color: '#713312', width: 30 } }),
  preset('ocean-cyan', '海洋青', '#48DDD7', { shadow: { enabled: true, color: '#12606C', distance: 4 } }),
  preset('comic-yellow', '漫画黄', '#FFF15A', { italic: true, border: { enabled: true, width: 60 } }),
  preset('comic-pink', '漫画粉', '#FF79BA', { border: { enabled: true, color: '#641C55', width: 55 } }),
  preset('ice-blue', '冰蓝描边', '#E7F8FF', { border: { enabled: true, color: '#288CCC', width: 50 } }),
  preset('ruby-white', '红边白字', '#FFFFFF', { border: { enabled: true, color: '#D94048', width: 50 } }),
  preset('golden-title', '金色标题', '#FFD470', { border: { enabled: true, color: '#805222', width: 25 }, shadow: { enabled: true, distance: 6 } }),
  preset('retro-orange', '复古橙影', '#FFC182', { shadow: { enabled: true, color: '#B64D38', distance: 6, smoothing: 0, opacity: 100 } }),
  preset('lemon-shadow', '柠檬投影', '#EFFF7C', { shadow: { enabled: true, color: '#628B35', distance: 5, smoothing: 0 } }),
  preset('electric-purple', '电光紫', '#E6CEFF', { shadow: { enabled: true, color: '#A146FF', distance: 0, smoothing: 70, opacity: 100 } }),
  preset('neon-cyan', '霓虹青', '#CAFFFF', { shadow: { enabled: true, color: '#00D9E8', distance: 0, smoothing: 70, opacity: 100 } }),
];

// Save a uniform selection only; null means the selection contains multiple values.
export function snapshotPresetTypography(value) {
  const validColor = (color) => typeof color === 'string' && /^#[\da-f]{6}$/i.test(color);
  const inRange = (number, min, max) => typeof number === 'number' && Number.isFinite(number) && number >= min && number <= max;
  if (!value || typeof value.font !== 'string' || !value.font.trim()
    || !inRange(value.fontSize, 5, 300) || !validColor(value.color)
    || ['bold', 'italic', 'underline'].some((key) => typeof value[key] !== 'boolean')) {
    throw new Error('请先选择样式一致的文字，再保存预设');
  }
  for (const key of ['border', 'shadow']) {
    const effect = value[key];
    if (!effect || typeof effect.enabled !== 'boolean' || !validColor(effect.color)
      || Object.keys(DEFAULT_TEXT_EFFECTS[key]).some((field) => {
        if (field === 'enabled' || field === 'color') return false;
        return !inRange(effect[field], field === 'angle' ? -180 : 0, field === 'angle' ? 180 : 100);
      })) throw new Error('请先选择样式一致的文字，再保存预设');
  }
  return {
    font: value.font, fontSize: value.fontSize, color: value.color.toUpperCase(),
    bold: value.bold, italic: value.italic, underline: value.underline,
    ...Object.fromEntries(['border', 'shadow'].map((key) => [key,
      Object.fromEntries(Object.keys(DEFAULT_TEXT_EFFECTS[key]).map((field) => [
        field, field === 'color' ? value[key][field].toUpperCase() : value[key][field],
      ])),
    ])),
  };
}

export function matchesTextPreset(typography, presetValue) {
  return Object.entries(presetValue.typography).every(([key, value]) => {
    const current = typography?.[key];
    return value && typeof value === 'object'
      ? Object.entries(value).every(([field, fieldValue]) => current?.[field] === fieldValue)
      : current === value;
  });
}
