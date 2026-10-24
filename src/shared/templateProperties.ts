import { KEYFRAME_PROPERTIES, keyframePropertiesFor, keyframeProperty, validateKeyframeValue } from './templateKeyframes'

export type TemplatePropertyKey = typeof KEYFRAME_PROPERTIES[number]['key']
export type PropertyAction = {
  type: 'property'
  id: string
  property: string
  mode: 'static' | 'keyframe'
  value?: number
  time?: number
  remove?: boolean
  removeGroup?: boolean
}

export interface PropertyTarget {
  clip?: unknown
  global_alpha?: unknown
  common_keyframes?: Array<{
    id: string
    property_type: string
    keyframe_list: Array<{ id: string; time_offset: number; values: number[]; curveType?: string }>
  }>
}

const paths: Partial<Record<TemplatePropertyKey, string>> = {
  position_x: 'clip.transform.x', position_y: 'clip.transform.y',
  scale_x: 'clip.scale.x', scale_y: 'clip.scale.y', rotation: 'clip.rotation', alpha: 'clip.alpha'
}

export function templatePropertiesFor(type: string) {
  return KEYFRAME_PROPERTIES.map(property => ({
    ...property,
    native: property.key === 'alpha' && type === 'text' ? 'KFTypeGlobalAlpha' : property.native,
    unit: property.key.startsWith('position_') ? 'normalized' : property.key === 'rotation' ? 'degrees' : 'ratio',
    staticPath: property.key === 'alpha' && type === 'text' ? 'global_alpha' : paths[property.key],
    static: ['image', 'video', 'text', 'sticker'].includes(type) &&
      (paths[property.key] !== undefined || property.key === 'uniform_scale'),
    keyframe: keyframePropertiesFor(type).some(item => item.key === property.key)
  })).filter(property => property.static || property.keyframe)
}

export function templateProperty(type: string, key: string) {
  const canonical = keyframeProperty(key)?.key
  const property = templatePropertiesFor(type).find(item => item.key === canonical)
  if (!property) throw new Error('当前元素不支持此属性')
  return property
}

function getPath(target: PropertyTarget, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) =>
    value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined, target)
}

export function readStaticProperty(target: PropertyTarget, type: string, key: string): number {
  const property = templateProperty(type, key)
  if (!property.static) throw new Error('当前属性不支持静态读写')
  if (property.key === 'uniform_scale') {
    const x = readStaticProperty(target, type, 'scale_x')
    const y = readStaticProperty(target, type, 'scale_y')
    if (x !== y) throw new Error('X/Y 缩放不一致，请分别编辑')
    return x
  }
  const value = getPath(target, property.staticPath!) ?? property.defaultValue
  validateKeyframeValue(property.key, value as number)
  return value as number
}

export function writeStaticProperty<T extends PropertyTarget>(target: T, type: string, key: string, value: number): T {
  const property = templateProperty(type, key)
  if (!property.static) throw new Error('当前属性不支持静态读写')
  validateKeyframeValue(property.key, value)
  const result = structuredClone(target)
  const targets = property.key === 'uniform_scale' ? ['clip.scale.x', 'clip.scale.y'] : [property.staticPath!]
  for (const path of targets) {
    const parts = path.split('.')
    let current = result as Record<string, unknown>
    for (const part of parts.slice(0, -1)) {
      if (current[part] === undefined || current[part] === null) current[part] = {}
      if (typeof current[part] !== 'object' || Array.isArray(current[part])) throw new Error(`${part} 必须是对象`)
      current = current[part] as Record<string, unknown>
    }
    current[parts[parts.length - 1]] = value
  }
  return result
}

export function readTemplateProperty(target: PropertyTarget, type: string, key: string, time: number) {
  const property = templateProperty(type, key)
  const offset = Math.round(time * 1_000_000)
  if (!Number.isFinite(time) || time < 0 || !Number.isSafeInteger(offset)) throw new Error('时间必须是非负秒数')
  const groups = (target.common_keyframes ?? []).filter(group => {
    const canonical = keyframeProperty(group.property_type)?.key
    return canonical === property.key ||
      (['scale_x', 'scale_y'].includes(property.key) && canonical === 'uniform_scale')
  }).filter(group => group.keyframe_list.length)
  if (groups.length > 1) throw new Error('属性关键帧组重复或缩放关键帧冲突')
  const frames = groups[0]?.keyframe_list ?? []
  if (frames.length && !property.keyframe) throw new Error('当前元素不支持此关键帧属性')
  let previous = -1
  for (const frame of frames) {
    if (!Number.isSafeInteger(frame.time_offset) || frame.time_offset < 0 || frame.time_offset <= previous ||
      frame.values.length !== 1 || (frame.curveType !== undefined && frame.curveType !== 'Line')) {
      throw new Error('仅支持严格递增的单值线性关键帧')
    }
    validateKeyframeValue(property.key, frame.values[0])
    previous = frame.time_offset
  }
  const staticValue = property.static ? readStaticProperty(target, type, key) : property.defaultValue
  let value = staticValue
  if (frames.length) {
    const right = frames.findIndex(frame => frame.time_offset >= offset)
    if (right === 0) value = frames[0].values[0]
    else if (right === -1) value = frames[frames.length - 1].values[0]
    else {
      const a = frames[right - 1], b = frames[right]
      value = a.values[0] + (b.values[0] - a.values[0]) * (offset - a.time_offset) / (b.time_offset - a.time_offset)
    }
  }
  return { property: property.key, value, staticValue, animated: frames.length > 0,
    atKeyframe: frames.some(frame => frame.time_offset === offset), unit: property.unit }
}

export function staticPropertyParams(target: PropertyTarget, type: string): Record<string, number> {
  const params: Record<string, number> = {}
  for (const property of templatePropertiesFor(type)) {
    if (!property.staticPath || !property.static || getPath(target, property.staticPath) === undefined) continue
    const key = property.key === 'position_x' ? 'transform_x' : property.key === 'position_y' ? 'transform_y' :
      property.key === 'alpha' && type === 'text' ? 'font_alpha' : property.key
    params[key] = readStaticProperty(target, type, property.key)
  }
  return params
}
