export interface ScenePreviewTransition {
  type: 'circular-wipe'
  /** Scene-local entrance duration in integer microseconds. */
  duration: number
}

export function validateScenePreviewTransition(value: ScenePreviewTransition, id: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.type !== 'circular-wipe' ||
      Object.keys(value).some(key => !['type', 'duration'].includes(key)) ||
      !Number.isSafeInteger(value.duration) || value.duration <= 0) {
    throw new Error(`${id}.preview_transition 必须为 { type: 'circular-wipe', duration: 正整数微秒 }`)
  }
}
