import { templateAnimations, templateFonts, templateTransitions } from './templatePropertyResources'
import { templateAudioEffects } from './templateAudioEffects'

export type ConfigurationValue = string | number | boolean
export interface ConfigurationProperty {
  key: string
  label: string
  valueType: 'string' | 'number' | 'boolean' | 'color' | 'enum'
  defaultValue: ConfigurationValue
  unit: string
  min?: number
  max?: number
  choices?: readonly ConfigurationValue[]
  scope: 'material' | 'segment' | 'reference'
  nativePath: string
  static: true
  keyframe: false
}

const property = (key: string, label: string, valueType: ConfigurationProperty['valueType'],
  defaultValue: ConfigurationValue, nativePath: string, options: Partial<ConfigurationProperty> = {}): ConfigurationProperty => ({
  key, label, valueType, defaultValue, nativePath, unit: 'native', scope: 'material', static: true, keyframe: false, ...options
})

const text = [
  property('text', '文字内容', 'string', '', 'content.text'),
  property('font', '字体', 'enum', '', 'content.styles.0.font', { choices: ['', ...templateFonts.map(item => item.value)] }),
  property('font_size', '字号', 'number', 8, 'content.styles.0.size', { min: 5, max: 300 }),
  property('font_color', '文字颜色', 'color', '#FFFFFF', 'content.styles.0.fill.content.solid.color'),
  ...['bold', 'italic', 'underline'].map((key, index) => property(key, ['加粗', '斜体', '下划线'][index], 'boolean', false, `content.styles.0.${key}`)),
  property('letter_spacing', '字间距', 'number', 0, 'letter_spacing', { min: -100, max: 100 }),
  property('line_spacing', '行间距', 'number', 0, 'line_spacing', { min: -100, max: 100 }),
  property('align', '对齐', 'enum', 1, 'alignment', { choices: [0, 1, 2] }),
  property('vertical', '竖排', 'boolean', false, 'typesetting'),
  property('border_width', '描边宽度', 'number', 0, 'content.styles.0.strokes.0.width', { min: 0, max: 100 }),
  property('border_color', '描边颜色', 'color', '#000000', 'content.styles.0.strokes.0.content.solid.color'),
  property('border_alpha', '描边透明度', 'number', 1, 'content.styles.0.strokes.0.content.solid.alpha', { min: 0, max: 1 }),
  property('background_style', '背景样式', 'enum', 1, 'background_style', { choices: [1, 2] }),
  property('background_color', '背景颜色', 'color', '#000000', 'background_color'),
  ...['alpha', 'round_radius', 'height', 'width', 'horizontal_offset', 'vertical_offset'].map((key, index) =>
    property(`background_${key}`, ['背景透明度', '背景圆角', '背景高度', '背景宽度', '背景水平偏移', '背景垂直偏移'][index],
      'number', [0, 0, 0.14, 0.14, 0.5, 0.5][index], `background_${key}`, { min: 0, max: 1 })),
  property('shadow_enabled', '启用阴影', 'boolean', false, 'has_shadow'),
  property('shadow_color', '阴影颜色', 'color', '#000000', 'shadow_color'),
  property('shadow_alpha', '阴影透明度', 'number', 0.9, 'shadow_alpha', { min: 0, max: 1 }),
  property('shadow_angle', '阴影角度', 'number', -45, 'shadow_angle', { min: -180, max: 180, unit: 'degrees' }),
  property('shadow_distance', '阴影距离', 'number', 5, 'shadow_distance', { min: 0, max: 100 }),
  property('shadow_smoothing', '阴影平滑度', 'number', 0.15, 'shadow_smoothing', { min: 0, max: 1 })
]

const audio = [
  property('volume', '音量', 'number', 1, 'volume', { scope: 'segment', unit: 'ratio', min: 0, max: 10 }),
  property('speed', '速度', 'number', 1, 'speed', { scope: 'segment', unit: 'ratio', min: 0.1, max: 10 }),
  ...['in', 'out'].map((side, index) => property(`fade_${side}_duration`, ['淡入', '淡出'][index], 'number', 0,
    `audio_fades.fade_${side}_duration`, { scope: 'reference', unit: 'seconds', min: 0, max: 3600 })),
  property('effect_type', '场景音效', 'enum', '', 'audio_effects', {
    scope: 'reference', choices: ['', ...templateAudioEffects.map(item => item.value)]
  }),
  ...[0, 1].map(index => property(`effect_param_${index}`, `音效参数 ${index + 1}`, 'number', 0,
    `audio_effects.audio_adjust_params.${index}.value`, { scope: 'reference', unit: 'percent', min: 0, max: 100 }))
]

export function templateConfigurationFor(type: string): ConfigurationProperty[] {
  const base = type === 'text' ? text : type === 'audio' ? audio : type === 'video' ? audio.slice(0, 1) : []
  if (!['image', 'video', 'text'].includes(type)) return base
  const keys = ['intro_animation', 'outro_animation', ...(type === 'image' ? ['combo_animation'] : type === 'text' ? ['loop_animation'] : [])]
  const animations = keys.flatMap((key, index) => [
    property(key, ['入场动画', '出场动画', '组合/循环动画'][index], 'enum', '', `material_animations.${key}`, {
      scope: 'reference', choices: ['', ...templateAnimations(type, key).map(item => item.value)]
    }),
    property(type === 'text' ? key.replace('_animation', '_duration') : `${key}_duration`, '动画时长', 'number', 0.5,
      `material_animations.${key}.duration`, { scope: 'reference', unit: 'seconds', min: 0.1, max: 3600 })
  ])
  return [...base, ...animations, ...(['image', 'video'].includes(type) ? [
    property('transition', '转场', 'enum', '', 'transitions', { scope: 'reference', choices: ['', ...templateTransitions.map(item => item.value)] }),
    property('transition_duration', '转场时长', 'number', 0.5, 'transitions.duration', { scope: 'reference', unit: 'seconds', min: 0.1, max: 3 })
  ] : [])]
}

export function configurationProperty(type: string, key: string) {
  return templateConfigurationFor(type).find(property => property.key === key)
}

export function validateConfigurationValue(property: ConfigurationProperty, value: unknown): ConfigurationValue {
  const { key, valueType, min, max, choices } = property
  if (valueType === 'number' && (typeof value !== 'number' || !Number.isFinite(value) ||
      (min !== undefined && value < min) || (max !== undefined && value > max))) throw new Error(`${key} 数值超出范围`)
  if (valueType === 'boolean' && typeof value !== 'boolean') throw new Error(`${key} 必须是布尔值`)
  if (valueType === 'string' && typeof value !== 'string') throw new Error(`${key} 必须是字符串`)
  if (valueType === 'color' && (typeof value !== 'string' || !/^#[\da-f]{6}$/i.test(value))) throw new Error(`${key} 必须是六位十六进制颜色`)
  if (valueType === 'enum' && !choices?.includes(value as ConfigurationValue)) throw new Error(`${key} 选项无效`)
  return value as ConfigurationValue
}

export const unsupportedTemplateConfiguration = {
  text: ['局部富文本编辑', '花字加密资源 ID', '气泡资源', '固定宽高'],
  audio: ['变速循环', '动态变速', '未验证音效及多音效叠加', '音频关键帧'],
  video: ['组合动画', '变速', '音频淡入淡出']
} as const
