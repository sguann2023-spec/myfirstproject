const MODE_ALIASES: Record<string, string> = {
  'lip-sync': 'lip_sync',
  lip_sync: 'lip_sync',
  lips: 'lip_sync',
  'jimeng-avatar': 'omni',
  omni: 'omni',
  'seedance-avatar': 'seedance',
  seedance: 'seedance'
}

export function normalizeDirectDigitalHumanRequest(
  input: Record<string, unknown> = {},
  fallbackCopywriting = ''
) {
  const mode = MODE_ALIASES[String(input.mode || '').trim()] || ''
  const copywriting = String(input.copywriting || input.text || fallbackCopywriting || '').trim()
  const voiceId = String(input.voice_id || input.voiceId || '').trim()
  const voiceProvider = String(input.voice_provider || input.voiceProvider || input.provider || '').trim()
  const imageUrl = String(input.image_url || input.imageUrl || '').trim()
  const videoUrl = String(input.video_url || input.videoUrl || '').trim()
  const prompt = String(input.prompt || '').trim()
  const outputResolution = Number(input.output_resolution ?? input.outputResolution)

  if (!mode) throw new Error('mode is required for digital human request')
  if (!copywriting) throw new Error('copywriting is required for digital human request')
  if (!voiceId) throw new Error('voice_id is required for digital human request')
  if (mode === 'lip_sync' && !videoUrl) throw new Error('video_url is required for lip sync digital human request')
  if ((mode === 'omni' || mode === 'seedance') && !imageUrl) {
    throw new Error('image_url is required for image driven digital human request')
  }

  return {
    mode,
    copywriting,
    voice_id: voiceId,
    ...(voiceProvider ? { voice_provider: voiceProvider } : {}),
    ...(imageUrl ? { image_url: imageUrl } : {}),
    ...(videoUrl ? { video_url: videoUrl } : {}),
    ...(prompt ? { prompt } : {}),
    ...(mode === 'omni' && (outputResolution === 720 || outputResolution === 1080)
      ? { output_resolution: outputResolution }
      : {})
  }
}

export function isDirectDigitalHumanResponseComplete(mode: string, response: Record<string, unknown> = {}) {
  if (mode !== 'lip_sync') return true
  return String(response.task_status ?? '').trim() === '1'
}
