import { randomUUID } from 'node:crypto'
import { configurationProperty, templateConfigurationFor, validateConfigurationValue } from '../../shared/templateConfiguration'
import { readConfigurationProperty, textContent, writeTextConfiguration } from '../../shared/templateConfigurationNative'
import type { DraftMaterial, DraftSegment, DraftTemplate } from './draftTemplate'
import { templateAnimations, templateTransitions } from '../../shared/templatePropertyResources'

export function configurationReferences(draft: DraftTemplate, segment: DraftSegment) {
  const ids = segment.extra_material_refs
  return Object.values(draft.materials).flat().filter(material => Array.isArray(ids) && ids.includes(material.id))
}

export function applyConfiguration(draft: DraftTemplate, segment: DraftSegment, type: string, key: string, value: unknown) {
  const property = configurationProperty(type, key)
  if (!property) throw new Error('不支持此配置')
  const validated = validateConfigurationValue(property, value)
  if (property.scope === 'material') {
    const bucket = Object.values(draft.materials).find(items => items.some(item => item.id === segment.material_id))!
    const material = bucket.find(item => item.id === segment.material_id)!
    const copy = writeTextConfiguration(material, key, value) as DraftMaterial
    copy.id = randomUUID()
    bucket.push(copy)
    segment.material_id = copy.id
  } else if (property.scope === 'segment') {
    if (key === 'speed' && segment.loop) throw new Error('变速与循环组合暂不支持')
    segment[key] = validated
  } else if (key.startsWith('fade_')) {
    const existing = configurationReferences(draft, segment).filter(item => item.type === 'audio_fade')
    if (existing.length > 1) throw new Error('音频淡入淡出素材重复')
    const fade: DraftMaterial = existing[0] ? structuredClone(existing[0]) : {
      id: '', type: 'audio_fade', fade_in_duration: 0, fade_out_duration: 0, fade_type: 0
    }
    fade.id = randomUUID()
    fade[key] = Math.round((validated as number) * 1_000_000)
    ;(draft.materials.audio_fades ??= []).push(fade)
    segment.extra_material_refs = [...(Array.isArray(segment.extra_material_refs) ? segment.extra_material_refs : [])
      .filter(id => id !== existing[0]?.id), fade.id]
  } else {
    const transition = key.startsWith('transition')
    const bucket = transition ? 'transitions' : 'material_animations'
    const materialType = transition ? 'transition' : 'sticker_animation'
    const refs = configurationReferences(draft, segment).filter(item => item.type === materialType)
    if (refs.length > 1) throw new Error('动画/转场引用重复')
    const reference: DraftMaterial = refs[0] ? structuredClone(refs[0]) : { id: '', type: materialType, animations: [] }
    reference.id = randomUUID()
    const material = Object.values(draft.materials).flat().find(item => item.id === segment.material_id)!
    const nameKey = transition ? 'transition' : key.replace(/_animation_duration$|_duration$/, '_animation')
    const durationKey = transition ? 'transition_duration' : type === 'text' ? nameKey.replace('_animation', '_duration') : `${nameKey}_duration`
    const name = key === nameKey ? validated : readConfigurationProperty(segment, material, type, nameKey, refs)
    const duration = Number(key === durationKey ? validated : readConfigurationProperty(segment, material, type, durationKey, refs))
    if (transition) {
      if (name) {
        const resource = templateTransitions.find(item => item.value === name)!
        Object.assign(reference, { name: resource.label, resource_id: resource.resourceId, effect_id: resource.effectId,
          is_overlap: resource.isOverlap, duration: Math.round(duration * 1_000_000) })
      }
    } else {
      const kind = { intro_animation: 'in', outro_animation: 'out', combo_animation: 'group', loop_animation: 'loop' }[nameKey]
      const animations = (reference.animations as Array<Record<string, unknown>>).filter(item => item.type !== kind)
      if (name) {
        if (type !== 'text' && animations.some(item => item.type === 'group' || kind === 'group')) throw new Error('组合动画不能与出入场动画共存')
        const resource = templateAnimations(type, nameKey).find(item => item.value === name)!
        animations.push({ type: kind, name: resource.label, id: resource.effectId, resource_id: resource.resourceId,
          start: kind === 'out' ? Math.max(0, Number(segment.target_timerange.duration ?? 0) - duration * 1_000_000) : 0,
          duration: Math.round(duration * 1_000_000), platform: 'all', panel: type === 'text' ? '' : 'video', material_type: type === 'text' ? 'sticker' : 'video' })
      }
      reference.animations = animations
    }
    const keep = transition ? Boolean(name) : (reference.animations as unknown[]).length > 0
    if (!name && key === durationKey) throw new Error('请先选择动画或转场，再设置时长')
    if (keep) (draft.materials[bucket] ??= []).push(reference)
    segment.extra_material_refs = [...(Array.isArray(segment.extra_material_refs) ? segment.extra_material_refs : []).filter(id => id !== refs[0]?.id), ...(keep ? [reference.id] : [])]
  }
}

export function nativeConfigurationParams(draft: DraftTemplate, segment: DraftSegment, material: DraftMaterial, type: string) {
  const params: Record<string, string | number | boolean> = {}
  const references = configurationReferences(draft, segment)
  if (type === 'text') textContent(material)
  for (const property of templateConfigurationFor(type)) {
    const value = readConfigurationProperty(segment, material, type, property.key, references)
    params[property.key] = property.key === 'volume' ? value === 0 ? -60 : 20 * Math.log10(value as number) : value
  }
  if (type === 'text') delete params.text
  for (const key of Object.keys(params)) {
    if (params[key] === '') delete params[key]
    if (key.endsWith('_duration') && !key.startsWith('fade_')) {
      const name = key === 'transition_duration' ? 'transition' : key.replace(/_animation_duration$|_duration$/, '_animation')
      if (!params[name]) delete params[key]
    }
  }
  if (params.speed !== undefined && params.speed !== 1 && segment.loop) throw new Error('变速与循环组合暂不支持')
  if (segment.dynamic?.some(path => templateConfigurationFor(type).some(property => property.nativePath === path))) {
    throw new Error('新增配置暂不支持运行时动态绑定，请使用静态属性动作')
  }
  if (type === 'text' && material.dynamic?.some(path => path !== 'content')) throw new Error('文字样式暂不支持运行时动态绑定')
  if (references.some(reference => reference.type === 'audio_fade' && reference.dynamic?.length)) throw new Error('淡入淡出暂不支持动态绑定')
  return params
}
