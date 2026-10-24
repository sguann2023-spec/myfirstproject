import { configurationProperty, validateConfigurationValue, type ConfigurationValue } from './templateConfiguration'
import { templateAnimations, templateFonts, templateTransitions } from './templatePropertyResources'

type NativeObject = Record<string, any>

export function textContent(material: NativeObject) {
  const content = JSON.parse(material.content ?? '{"text":""}')
  if (!content || typeof content.text !== 'string') throw new Error('文字 content 无效')
  if (content.styles !== undefined && (!Array.isArray(content.styles) || content.styles.length > 1)) {
    throw new Error('暂不支持局部富文本样式，不能无损转换为全局文字配置')
  }
  return content as NativeObject
}

const get = (object: NativeObject, path: string) => path.split('.').reduce<any>((value, key) => value?.[key], object)
const rgb = (value: string) => [1, 3, 5].map(index => parseInt(value.slice(index, index + 2), 16) / 255)
const hex = (value: unknown) => {
  if (!Array.isArray(value) || value.length !== 3 || value.some(channel => typeof channel !== 'number' || !Number.isFinite(channel) || channel < 0 || channel > 1)) {
    throw new Error('原生颜色必须是 0–1 RGB 三元组')
  }
  return `#${value.map(channel => Math.round(channel * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`
}

export function readConfigurationProperty(segment: NativeObject, material: NativeObject, type: string, key: string,
  references: NativeObject[] = []): ConfigurationValue {
  const property = configurationProperty(type, key)
  if (!property) throw new Error('当前元素不支持此配置')
  let value: unknown
  if (property.scope === 'segment') value = segment[property.nativePath]
  else if (property.scope === 'reference') {
    if (key.startsWith('fade_')) {
      const fades = references.filter(item => item.type === 'audio_fade')
      if (fades.length > 1) throw new Error('音频淡入淡出素材重复')
      value = fades[0]?.[key]
      if (value !== undefined) value = Number(value) / 1_000_000
    } else if (key.startsWith('transition')) {
      const transitions = references.filter(item => item.type === 'transition')
      if (transitions.length > 1) throw new Error('转场素材重复')
      const transition = transitions[0]
      if (transition) value = key === 'transition' ? templateTransitions.find(item => item.resourceId === transition.resource_id)?.value : transition.duration / 1_000_000
      if (transition && value === undefined) throw new Error('未知转场资源')
    } else {
      const animationKey = key.replace(/_animation_duration$|_duration$/, '_animation')
      const kind = { intro_animation: 'in', outro_animation: 'out', combo_animation: 'group', loop_animation: 'loop' }[animationKey]
      const animations = references.filter(item => item.type === 'sticker_animation').flatMap(item => item.animations ?? []).filter(item => item.type === kind)
      if (animations.length > 1) throw new Error('动画素材重复')
      const animation = animations[0]
      if (animation) value = key.endsWith('_duration') ? animation.duration / 1_000_000 : templateAnimations(type, animationKey).find(item => item.resourceId === animation.resource_id)?.value
      if (animation && value === undefined) throw new Error('未知动画资源')
    }
  } else {
    const object = property.nativePath.startsWith('content.') ? { ...material, content: textContent(material) } : material
    value = get(object, property.nativePath)
    if (value !== undefined) {
      if (key === 'font') {
        value = templateFonts.find(font => font.resourceId === (value as NativeObject).id)?.value
        if (value === undefined) throw new Error('字体资源尚未进入已验证字体列表')
      } else if (key === 'font_color' || key === 'border_color') value = hex(value)
      else if (key === 'letter_spacing') value = Number(value) / 0.05
      else if (key === 'line_spacing') value = (Number(value) - 0.02) / 0.05
      else if (key === 'border_width') value = Number(value) * 500
      else if (key === 'vertical') value = value === 1
      else if (key === 'shadow_smoothing') value = Number(value) / 3
      else if (key.endsWith('_offset')) value = (Number(value) + 1) / 2
    }
  }
  return validateConfigurationValue(property, value ?? property.defaultValue)
}

export function writeTextConfiguration(material: NativeObject, key: string, input: unknown): NativeObject {
  const property = configurationProperty('text', key)
  if (!property) throw new Error('当前文字属性不支持')
  let value: any = validateConfigurationValue(property, input)
  const result = structuredClone(material)
  const content = textContent(result)
  result.content = content
  if (key === 'text') {
    content.text = value
    if (content.styles?.[0]) content.styles[0].range = [0, Array.from(value as string).length]
  } else {
    if (key === 'font') value = value ? { id: templateFonts.find(font => font.value === value)!.resourceId, path: `C:/${value}.ttf` } : undefined
    else if (key === 'font_color' || key === 'border_color') value = rgb(value)
    else if (key === 'letter_spacing') value *= 0.05
    else if (key === 'line_spacing') value = 0.02 + value * 0.05
    else if (key === 'border_width') value /= 500
    else if (key === 'vertical') value = Number(value)
    else if (key === 'shadow_smoothing') value *= 3
    else if (key.endsWith('_offset')) value = value * 2 - 1
    const parts = property.nativePath.split('.')
    let current = result
    parts.slice(0, -1).forEach((part, index) => {
      current[part] ??= /^\d+$/.test(parts[index + 1]) ? [] : {}
      if (typeof current[part] !== 'object' || current[part] === null) throw new Error('原生样式结构无效')
      current = current[part]
    })
    current[parts[parts.length - 1]] = value
    if (content.styles?.[0]) content.styles[0].range = [0, Array.from(content.text).length]
  }
  result.content = JSON.stringify(content)
  return result
}
