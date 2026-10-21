export interface ResourceFields {
  filter_type?: string
  intensity?: number
  effect_type?: string
  effect_category?: 'scene' | 'character'
  params?: Array<number | null>
}

export function resourceType(material: Record<string, unknown>, type: 'filter' | 'effect'): string {
  for (const value of [material[`${type}_type`], material.name]) {
    if (typeof value === 'string' && value.trim() && value !== '滤镜' && value !== '特效') return value.trim()
  }
  return ''
}

export function resourceFields(material: Record<string, unknown>, type: 'filter' | 'effect', id: string): ResourceFields {
  if (type === 'filter') {
    if (material.intensity === undefined && material.value !== undefined && typeof material.value !== 'number') {
      throw new Error(`${id}.value 必须是 0-1 数值`)
    }
    return {
      filter_type: resourceType(material, type),
      intensity: material.intensity as number ?? (typeof material.value === 'number' ? material.value * 100 : 100)
    }
  }
  let params = material.params as Array<number | null> | undefined
  if (params === undefined && Array.isArray(material.adjust_params) && material.adjust_params.length) {
    const ordered = [...material.adjust_params].sort((a, b) => a.parameterIndex - b.parameterIndex)
    params = ordered.map((param, index) => {
      if (param.parameterIndex !== index || ![param.value, param.min_value, param.max_value].every(Number.isFinite) ||
        param.max_value <= param.min_value) throw new Error(`${id}.adjust_params 需要连续 parameterIndex 和有效的参数范围`)
      return (param.value - param.min_value) * 100 / (param.max_value - param.min_value)
    }).reverse()
  }
  return {
    effect_type: resourceType(material, type),
    effect_category: (material.effect_category ?? 'scene') as 'scene' | 'character',
    ...(params !== undefined && params !== null ? { params } : {})
  }
}

export function validateResource(value: ResourceFields, type: 'filter' | 'effect', id: string, editable: boolean) {
  const name = value[`${type}_type`]
  if (name !== undefined && typeof name !== 'string') throw new Error(`${id}.${type}_type 必须是字符串`)
  if (!editable && !name?.trim()) throw new Error(`${id} ${type === 'filter' ? '滤镜' : '特效'}缺少 ${type}_type，请填写后台枚举名称（不是资源 ID）`)
  if (type === 'filter' && value.intensity !== undefined &&
    (!Number.isFinite(value.intensity) || value.intensity < 0 || value.intensity > 100)) throw new Error(`${id}.intensity 必须在 0-100 之间`)
  if (type === 'effect') {
    if (value.effect_category !== undefined && !['scene', 'character'].includes(value.effect_category)) throw new Error(`${id}.effect_category 仅支持 scene/character`)
    if (value.params !== undefined && (!Array.isArray(value.params) ||
      value.params.some(item => item !== null && (typeof item !== 'number' || !Number.isFinite(item) || item < 0 || item > 100)))) {
      throw new Error(`${id}.params 必须是 0-100 数值或 null 的数组`)
    }
  }
}
