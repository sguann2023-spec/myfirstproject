import type { DraftKeyframeGroup } from './draftTemplate'
import { keyframeProperty, keyframePropertiesFor, validateKeyframeValue } from '../../shared/templateKeyframes'
import type { WorkflowStep } from './workflowTypes'

export type AnimationLayer = { groups: DraftKeyframeGroup[]; origin: string }
const add = (a: string, b: string) => `((${a}) + (${b}))`
const clamp = (value: string, low: string, high: string) =>
  `((${low}) if (${value}) < (${low}) else ((${high}) if (${value}) > (${high}) else (${value})))`

export function executableKeyframes(
  item: { id: string; common_keyframes?: DraftKeyframeGroup[]; keyframe_refs?: string[] }, type: string
) {
  const groups = item.common_keyframes ?? []
  const localIds = new Set(groups.map(group => group.id))
  if (item.keyframe_refs?.some(id => !localIds.has(id))) throw new Error(`${item.id} 包含未解析的外部关键帧引用`)
  const properties = new Set<string>()
  for (const group of groups) {
    if (!group.keyframe_list.length) continue
    const property = keyframeProperty(group.property_type)
    if (!property || !keyframePropertiesFor(type).some(item => item.key === property.key)) {
      throw new Error(`${item.id} 的关键帧属性 ${group.property_type} 不支持 ${type} 后台执行`)
    }
    if (properties.has(property.key)) throw new Error(`${item.id} 关键帧属性重复`)
    properties.add(property.key)
    for (const frame of group.keyframe_list) {
      if (frame.values.length !== 1) throw new Error(`${item.id} 当前关键帧仅支持单一数值`)
      if (frame.curveType && frame.curveType !== 'Line') throw new Error(`${item.id} 当前后台仅支持线性关键帧`)
      validateKeyframeValue(property.key, frame.values[0])
    }
  }
  if (properties.has('uniform_scale') && (properties.has('scale_x') || properties.has('scale_y'))) {
    throw new Error(`${item.id} 整体缩放关键帧不能与 X/Y 缩放同时使用`)
  }
  return groups.filter(group => group.keyframe_list.length)
}

// Evaluate each ancestor at the child's visible boundaries, not just at its own key points.
// Position/rotation add; scale/opacity multiply. Nested animations are never overwritten.
export function keyframeSteps(
  id: string, type: string, track: string, layers: AnimationLayer[], start: string, end: string
): WorkflowStep[] {
  const byProperty = new Map<string, Array<{ group: DraftKeyframeGroup; origin: string }>>()
  for (const layer of layers) for (const group of layer.groups) {
    const key = keyframeProperty(group.property_type)!.key
    const keys = key === 'uniform_scale' ? ['scale_x', 'scale_y'] : [key]
    for (const property of keys) {
      if (!keyframePropertiesFor(type).some(item => item.key === property)) continue
      const list = byProperty.get(property) ?? []
      list.push({ group, origin: layer.origin })
      byProperty.set(property, list)
    }
  }
  const steps: WorkflowStep[] = []
  for (const [property, sources] of byProperty) {
    const sample = (group: DraftKeyframeGroup, origin: string, time: string) => {
      const frames = group.keyframe_list
      const local = `((${time}) - (${origin}))`
      let value = String(frames[frames.length - 1].values[0])
      for (let index = frames.length - 2; index >= 0; index--) {
        const left = frames[index], right = frames[index + 1]
        const a = left.time_offset / 1_000_000, b = right.time_offset / 1_000_000
        const interpolated = `${left.values[0]} + ((${local}) - ${a}) * ${right.values[0] - left.values[0]} / ${b - a}`
        value = `((${interpolated}) if (${local}) < ${b} else (${value}))`
      }
      return `(${frames[0].values[0]} if (${local}) <= ${frames[0].time_offset / 1_000_000} else (${value}))`
    }
    const valueAt = (time: string) => sources.map(({ group, origin }) => sample(group, origin, time))
      .reduce((a, b) => `((${a}) ${['scale_x', 'scale_y', 'alpha', 'volume'].includes(property) ? '*' : '+'} (${b}))`)
    const points = [...new Set(sources.flatMap(({ group, origin }) =>
      group.keyframe_list.map(frame => add(origin, String(frame.time_offset / 1_000_000)))))]
    const candidates = [start, ...points, end]
    candidates.forEach((time, index) => {
      const bounded = clamp(time, start, end)
      const action: WorkflowStep = {
        type: 'action', id: `${id}__kf_${property}_${index}`, index: 0, action_type: 'add_video_keyframe',
        params: { track_name: track, property_type: property, time: bounded, value: valueAt(bounded) }
      }
      if (index > 0 && index < candidates.length - 1) {
        steps.push({ type: 'if', id: `${action.id}_visible`, index: steps.length,
          condition: `(${time}) > (${start}) and (${time}) < (${end})`, then: [action] })
      } else steps.push({ ...action, index: steps.length })
    })
  }
  return steps
}
