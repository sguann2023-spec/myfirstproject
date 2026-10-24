import { unsupportedTemplateConfiguration } from '../../../shared/templateProperties';

export function propertyControl(property) {
  if (['scale_x', 'scale_y', 'uniform_scale'].includes(property.key)) return { min: 1, max: 500, step: 1, unit: '%', factor: 100, slider: true };
  if (property.key === 'alpha') return { min: 0, max: 100, step: 1, unit: '%', factor: 100, slider: true };
  if (property.key === 'rotation') return { min: -360, max: 360, step: 1, unit: '°', factor: 1, slider: true };
  if (property.key.startsWith('position_')) return { min: -10, max: 10, step: 0.01, unit: '归一化（非像素）', factor: 1 };
  if (property.key === 'volume') return { min: -60, max: 20, step: 0.1, unit: 'dB', slider: true };
  return { min: -100, max: 100, step: 1, unit: '%', factor: 100, slider: true };
}

export function displayPropertyValue(property, value) {
  if (value === undefined) return '';
  return Number((property.key === 'volume' ? value <= 0 ? -60 : 20 * Math.log10(value) : value * propertyControl(property).factor).toFixed(6));
}

export function nativePropertyValue(property, value) {
  const control = propertyControl(property);
  if (!Number.isFinite(value) || value < control.min || value > control.max) throw new Error(`请输入 ${control.min} 到 ${control.max} ${control.unit} 之间的数值`);
  return property.key === 'volume' ? value <= -60 ? 0 : 10 ** (value / 20) : value / control.factor;
}

export function unsupportedProperties(type) {
  if (unsupportedTemplateConfiguration[type]) return `暂不支持：${unsupportedTemplateConfiguration[type].join('、')}。${type === 'video' ? '不使用 Preset 身份或替换接口。' : ''}${type !== 'audio' ? '位置为归一化值，未提供安全像素换算接口。' : ''}`;
  if (type === 'image') return '暂不支持：固定宽高；位置为归一化值，未提供安全像素换算接口。';
  if (type === 'sticker') return '暂不支持：贴纸关键帧、动画资源与转场。';
  if (type === 'composition') return '分镜仅支持递归关键帧，不支持静态整体变换；批量分镜每项重复执行。';
  return '';
}
