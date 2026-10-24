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
  if (type === 'text') return '暂不支持：文本内容、字体字号、富文本样式、颜色、字行间距、对齐、固定宽高、描边、背景、阴影、动画资源与转场。';
  if (type === 'audio') return '暂不支持：音频音量、变速、淡入淡出、场景音效和关键帧；时间及循环仍在时间轴编辑。';
  if (['image', 'video'].includes(type)) return `暂不支持：像素位置、固定宽高、动画资源与转场${type === 'video' ? '、静态音量、变速及淡入淡出；视频音量仅支持关键帧，不使用 Preset 身份或替换接口' : ''}。`;
  if (type === 'sticker') return '暂不支持：贴纸关键帧、动画资源与转场。';
  if (type === 'composition') return '分镜仅支持递归关键帧，不支持静态整体变换；批量分镜每项重复执行。';
  return '';
}
