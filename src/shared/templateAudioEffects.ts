export const templateAudioEffects = [
  { value: '低保真', resourceId: '7024390914537689614', params: [{ name: '强弱', defaultValue: 1 }] },
  { value: '回音', resourceId: '7018011608408396325', params: [
    { name: 'change_voice_param_quantity', defaultValue: 0.8 },
    { name: 'change_voice_param_strength', defaultValue: 0.762 }
  ] },
  { value: '水下', resourceId: '7106404450444513806', params: [{ name: '深度', defaultValue: 0.5 }] }
] as const

export function readAudioEffect(references: Record<string, any>[]) {
  const effects = references.filter(item => item.type === 'audio_effect')
  if (effects.length > 1) throw new Error('暂仅支持单个场景音效')
  const effect = effects[0]
  if (!effect) return undefined
  const resource = templateAudioEffects.find(item => item.resourceId === effect.resource_id)
  if (!resource || effect.category_id !== 'sound_effect') throw new Error('音效资源尚未验证')
  if (!Array.isArray(effect.audio_adjust_params) || effect.audio_adjust_params.length !== resource.params.length) throw new Error('音效参数数量无效')
  const params = resource.params.map((meta, index) => {
    const param = effect.audio_adjust_params[index]
    if (!param || param.name !== meta.name || param.parameterIndex !== index ||
      typeof param.value !== 'number' || !Number.isFinite(param.value) || param.value < 0 || param.value > 1) throw new Error('音效参数无效')
    return param.value * 100
  })
  return { resource, params, effect }
}
