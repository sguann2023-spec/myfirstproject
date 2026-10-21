export const STICKER_TRANSFORMS = [
  ['transform_x', 'transform.x', 0], ['transform_y', 'transform.y', 0],
  ['transform_x_px', 'transform.x_px', 0], ['transform_y_px', 'transform.y_px', 0],
  ['scale_x', 'scale.x', 1], ['scale_y', 'scale.y', 1],
  ['rotation', 'rotation', 0], ['alpha', 'alpha', 1],
  ['flip_horizontal', 'flip.horizontal', false], ['flip_vertical', 'flip.vertical', false]
] as const

export interface StickerTransforms {
  transform_x?: number
  transform_y?: number
  transform_x_px?: number
  transform_y_px?: number
  scale_x?: number
  scale_y?: number
  rotation?: number
  alpha?: number
  flip_horizontal?: boolean
  flip_vertical?: boolean
}

export function stickerIdentifier(material: Record<string, unknown>): string {
  for (const value of [material.sticker_id, material.resource_id]) {
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

export function stickerTransformParams(value: StickerTransforms, id: string): StickerTransforms {
  const params: Record<string, number | boolean> = {}
  for (const [key, , fallback] of STICKER_TRANSFORMS) {
    const current = value[key]
    if (current === undefined) continue
    if (typeof fallback === 'boolean' ? typeof current !== 'boolean' :
      typeof current !== 'number' || !Number.isFinite(current)) {
      throw new Error(`${id}.${key} 必须是${typeof fallback === 'boolean' ? '布尔值' : '有限数值'}`)
    }
    params[key] = current
  }
  return params
}

export function stickerClipTransforms(clip: unknown, id: string): StickerTransforms {
  if (clip === undefined || clip === null) return {}
  if (typeof clip !== 'object' || Array.isArray(clip)) throw new Error(`${id}.clip 必须是对象`)
  const params: Record<string, number | boolean> = {}
  for (const [key, path] of STICKER_TRANSFORMS) {
    let value: unknown = clip
    for (const part of path.split('.')) {
      value = value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined
    }
    if (value !== undefined) params[key] = value as number | boolean
  }
  return stickerTransformParams(params, `${id}.clip`)
}
