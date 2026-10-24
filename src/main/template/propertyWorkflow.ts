import { staticPropertyParams, type PropertyTarget } from '../../shared/templateProperties'

export function visualParams(element: {
  type: string; transform_x?: number; transform_y?: number; scale_x?: number; scale_y?: number
  rotation?: number; alpha?: number; font_alpha?: number
}) {
  const target: PropertyTarget = {
    clip: { transform: { x: element.transform_x, y: element.transform_y },
      scale: { x: element.scale_x, y: element.scale_y }, rotation: element.rotation, alpha: element.alpha },
    global_alpha: element.font_alpha
  }
  return staticPropertyParams(target, element.type)
}
