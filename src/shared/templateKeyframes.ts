export const KEYFRAME_PROPERTIES = [
  { key: 'position_x', native: 'KFTypePositionX', label: 'X Position', defaultValue: 0 },
  { key: 'position_y', native: 'KFTypePositionY', label: 'Y Position', defaultValue: 0 },
  { key: 'scale_x', native: 'KFTypeScaleX', label: 'X Scale', defaultValue: 1 },
  { key: 'scale_y', native: 'KFTypeScaleY', label: 'Y Scale', defaultValue: 1 },
  { key: 'rotation', native: 'KFTypeRotation', label: 'Z Rotation', defaultValue: 0 },
  { key: 'alpha', native: 'KFTypeAlpha', label: 'Opacity', defaultValue: 1 },
  { key: 'uniform_scale', native: 'UNIFORM_SCALE', label: 'Scale', defaultValue: 1 },
  { key: 'saturation', native: 'KFTypeSaturation', label: 'Saturation', defaultValue: 0 },
  { key: 'contrast', native: 'KFTypeContrast', label: 'Contrast', defaultValue: 0 },
  { key: 'brightness', native: 'KFTypeBrightness', label: 'Brightness', defaultValue: 0 },
  { key: 'volume', native: 'KFTypeVolume', label: 'Volume', defaultValue: 1 }
] as const

export function keyframeProperty(property: string) {
  return KEYFRAME_PROPERTIES.find(item => item.key === property || item.native === property ||
    (item.key === 'alpha' && property === 'KFTypeGlobalAlpha'))
}

export function keyframePropertiesFor(type: string) {
  if (!['composition', 'image', 'video', 'text'].includes(type)) return []
  return KEYFRAME_PROPERTIES.filter(item =>
    !['saturation', 'contrast', 'brightness', 'volume'].includes(item.key) ||
    (['image', 'video'].includes(type) && item.key !== 'volume') ||
    (type === 'video' && item.key === 'volume'))
}

export function validateKeyframeValue(property: string, value: number) {
  const item = keyframeProperty(property)
  if (!item || !Number.isFinite(value)) throw new Error('关键帧属性或数值无效')
  if (['position_x', 'position_y'].includes(item.key) && Math.abs(value) > 10) {
    throw new Error('位置关键帧范围为 -10 到 10')
  }
  if (item.key === 'alpha' && (value < 0 || value > 1)) throw new Error('不透明度范围为 0 到 1')
  if (['scale_x', 'scale_y', 'uniform_scale', 'volume'].includes(item.key) && value < 0) {
    throw new Error('缩放和音量不能为负数')
  }
  if (['saturation', 'contrast', 'brightness'].includes(item.key) && Math.abs(value) > 1) {
    throw new Error('调节关键帧范围为 -1 到 1')
  }
}
