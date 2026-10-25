import { randomUUID } from 'node:crypto'
import { configurationProperty, templateConfigurationFor, validateConfigurationValue } from '../../shared/templateConfiguration'
import { readConfigurationProperty, textContent, writeTextConfiguration } from '../../shared/templateConfigurationNative'
import type { DraftMaterial, DraftSegment, DraftTemplate } from './draftTemplate'
import { templateAnimations, templateTransitions } from '../../shared/templatePropertyResources'
import { readAudioEffect, templateAudioEffects } from '../../shared/templateAudioEffects'

export function validateWorkflowConfiguration(type: string, configuration: unknown) {
  if (configuration === undefined) return
  if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)) throw new Error('configuration 必须是配置对象')
  for (const [key, value] of Object.entries(configuration)) {
    if (key === 'sound_effects' && type === 'audio') {
      if (!Array.isArray(value) || value.length !== 1) throw new Error('暂仅支持单个场景音效')
      const pair = value[0]
      const resource = Array.isArray(pair) && templateAudioEffects.find(item => item.value === pair[0])
      if (!resource || pair.length !== 2 || !Array.isArray(pair[1]) || pair[1].length !== resource.params.length ||
        pair[1].some((param: unknown) => typeof param !== 'number' || !Number.isFinite(param) || param < 0 || param > 100)) throw new Error('音效配置无效')
      continue
    }
    const property = configurationProperty(type, key)
    if (!property || key === 'text' || key.startsWith('effect_')) throw new Error(`不支持配置字段：${key}`)
    if (key === 'volume') {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < -60 || value > 20) throw new Error('音量 dB 超出范围')
    } else validateConfigurationValue(property, value)
  }
}

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
  } else if (key.startsWith('effect_')) {
    const current = readAudioEffect(configurationReferences(draft, segment))
    const resource = key === 'effect_type' ? templateAudioEffects.find(item => item.value === validated) : current?.resource
    if (key !== 'effect_type' && !resource) throw new Error('请先选择音效')
    const params = resource?.params.map(meta => meta.defaultValue) ?? []
    if (key !== 'effect_type') {
      const index = Number(key.slice(-1))
      if (index >= params.length) throw new Error('当前音效不存在此参数')
      current!.params.forEach((value, index) => { params[index] = value / 100 })
      params[index] = Number(validated) / 100
    }
    const effect: DraftMaterial | undefined = resource ? {
      id: randomUUID(), type: 'audio_effect', name: resource.value, resource_id: resource.resourceId,
      category_id: 'sound_effect', category_name: '场景音', is_ugc: false, production_path: '', speaker_id: '',
      sub_type: 1, time_range: { start: 0, duration: 0 },
      audio_adjust_params: resource.params.map((meta, index) => ({ name: meta.name, default_value: meta.defaultValue,
        min_value: 0, max_value: 1, parameterIndex: index, portIndex: 0, value: params[index] }))
    } : undefined
    if (effect) (draft.materials.audio_effects ??= []).push(effect)
    segment.extra_material_refs = [...(Array.isArray(segment.extra_material_refs) ? segment.extra_material_refs : [])
      .filter(id => id !== current?.effect.id), ...(effect ? [effect.id] : [])]
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
  const params: Record<string, unknown> = {}
  const references = configurationReferences(draft, segment)
  if (type === 'text') textContent(material)
  for (const property of templateConfigurationFor(type)) {
    if (property.key.startsWith('effect_')) continue
    const value = readConfigurationProperty(segment, material, type, property.key, references)
    if (property.key === 'volume' && Number(value) > 0 && Number(value) <= 0.001) throw new Error('该音量低于后端非静音阈值，请设为 0 或大于 0.001')
    params[property.key] = property.key === 'volume' ? value === 0 ? -60 : 20 * Math.log10(value as number) : value
  }
  if (type === 'audio') {
    const effect = readAudioEffect(references)
    if (effect) params.sound_effects = [[effect.resource.value, effect.params]]
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
  if (references.some(reference => ['audio_fade', 'audio_effect', 'sticker_animation', 'transition'].includes(reference.type) && reference.dynamic?.length)) throw new Error('效果引用暂不支持动态绑定')
  validateWorkflowConfiguration(type, params)
  return params
}
