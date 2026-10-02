export function normalizeDirectAiVideoRequest(input: Record<string, unknown> = {}, fallbackPrompt = '') {
  const prompt = String(input.prompt || fallbackPrompt || '').trim()
  const model = String(input.model || '').trim()
  const resolution = String(input.resolution || '').trim()
  const content = Array.isArray(input.content)
    ? input.content.map(normalizeContentItem).filter(Boolean) as Record<string, unknown>[]
    : []

  const hasTextContent = content.some((item) => item.type === 'text' && String(item.text || '').trim())
  if (!hasTextContent && prompt) content.unshift({ type: 'text', text: prompt })
  if (!content.length) throw new Error('content is required for ai video request')

  const payload: Record<string, unknown> = {
    ...(model ? { model } : {}),
    ...(resolution ? { resolution } : {}),
    content
  }

  addNumber(payload, 'gen_duration', input.gen_duration ?? input.genDuration)
  addBoolean(payload, 'generate_audio', input.generate_audio ?? input.generateAudio)
  addBoolean(payload, 'super_resolve', input.super_resolve ?? input.superResolve)
  addBoolean(payload, 'enable_seedance_offline', input.enable_seedance_offline ?? input.enableSeedanceOffline)
  return payload
}

function normalizeContentItem(item: unknown) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null
  const typedItem = item as Record<string, unknown>
  const type = String(typedItem.type || '').trim()
  if (type === 'text') {
    const text = String(typedItem.text || '').trim()
    return text ? { type: 'text', text } : null
  }

  const mediaField = type === 'image_url' ? 'image_url'
    : type === 'video_url' ? 'video_url'
      : type === 'audio_url' ? 'audio_url' : ''
  if (!mediaField) return null

  const rawMedia = typedItem[mediaField]
  const url = typeof rawMedia === 'string'
    ? rawMedia.trim()
    : String((rawMedia as { url?: unknown } | undefined)?.url || '').trim()
  if (!url) return null

  return {
    type,
    [mediaField]: { url },
    ...(String(typedItem.role || '').trim() ? { role: String(typedItem.role).trim() } : {})
  }
}

function addNumber(payload: Record<string, unknown>, key: string, value: unknown) {
  if (value === null || value === undefined || value === '') return
  const normalized = Number(value)
  if (Number.isFinite(normalized)) payload[key] = normalized
}

function addBoolean(payload: Record<string, unknown>, key: string, value: unknown) {
  if (typeof value === 'boolean') payload[key] = value
}
