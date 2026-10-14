import { analyzeSceneTemplate, compileSceneTemplate, type SceneElement, type SceneTemplate, type TimingRule } from './sceneTemplate'

export interface DraftRange {
  start?: number
  duration?: number
  end?: number
}

export interface AutoAnchor {
  target: 'parent' | string
  anchor: 'start' | 'end'
  offset?: number
}

export interface DraftTiming {
  start?: AutoAnchor
  end?: AutoAnchor
}

export interface DraftSegment {
  id: string
  material_id: string
  name?: string
  target_timerange: DraftRange
  source_timerange?: DraftRange | null
  auto_timing?: DraftTiming
  common_keyframes?: DraftKeyframeGroup[]
  keyframe_refs?: string[]
  [key: string]: unknown
}

export interface DraftKeyframe {
  id: string
  time_offset: number
  values: number[]
  curveType?: string
  [key: string]: unknown
}

export interface DraftKeyframeGroup {
  id: string
  property_type: string
  keyframe_list: DraftKeyframe[]
  material_id?: string
  [key: string]: unknown
}

export interface DraftTrack {
  id: string
  name?: string
  type: string
  segments: DraftSegment[]
  track_relative_index?: number
  [key: string]: unknown
}

export interface DraftScene {
  id: string
  name?: string
  target_timerange: DraftRange
  auto_timing?: DraftTiming
  tracks: DraftTrack[]
  scenes?: DraftScene[]
  [key: string]: unknown
}

export interface DraftMaterial {
  id: string
  type: string
  path?: string
  remote_url?: string
  content?: string
  [key: string]: unknown
}

export interface DraftTemplate {
  canvas_config: { width: number; height: number; [key: string]: unknown }
  duration?: number
  materials: Record<string, DraftMaterial[]>
  scenes: DraftScene[]
  [key: string]: unknown
}

function micros(value: unknown, path: string, signed = false): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || (!signed && value < 0)) {
    throw new Error(`${path} 必须是${signed ? '' : '非负'}整数微秒`)
  }
  return value / 1_000_000
}

// Keep the draft unchanged; only the timing engine's intermediate representation uses seconds.
export function normalizeDraftTemplate(draft: DraftTemplate) {
  if (!draft?.canvas_config || !Array.isArray(draft.scenes) || !draft.materials ||
      typeof draft.materials !== 'object' || Array.isArray(draft.materials)) {
    throw new Error('模版需要 canvas_config、materials 和 scenes；tracks 放在 scenes 内')
  }
  if ('tracks' in draft || 'elements' in draft) throw new Error('模版顶层仅通过 scenes 管理轨道')
  const materials = new Map<string, { material: DraftMaterial; bucket: string }>()
  const ids = new Set<string>()
  function unique(id: unknown) {
    if (typeof id !== 'string' || !id.trim() || ids.has(id)) throw new Error('Scene、轨道和片段必须有唯一的非空 id')
    ids.add(id)
  }
  for (const [bucket, items] of Object.entries(draft.materials)) {
    if (!Array.isArray(items)) throw new Error(`materials.${bucket} 必须是数组`)
    for (const material of items) {
      if (!material || typeof material.id !== 'string' || !material.id || materials.has(material.id)) {
        throw new Error('素材必须有唯一的非空 id')
      }
      materials.set(material.id, { material, bucket })
    }
  }
  const rules: Record<string, TimingRule> = {}
  const warnings: string[] = []
  let hasKeyframes = false
  const keyframeIds = new Set<string>()
  function validateKeyframes(segment: DraftSegment) {
    if (segment.keyframe_refs !== undefined) {
      if (!Array.isArray(segment.keyframe_refs) || segment.keyframe_refs.some((id) => typeof id !== 'string' || !id)) {
        throw new Error(`${segment.id}.keyframe_refs 必须是非空字符串数组`)
      }
      if (segment.keyframe_refs.length) hasKeyframes = true
    }
    if (segment.common_keyframes === undefined) return
    if (!Array.isArray(segment.common_keyframes)) throw new Error(`${segment.id}.common_keyframes 必须是数组`)
    function uniqueKeyframe(id: unknown) {
      if (typeof id !== 'string' || !id || keyframeIds.has(id)) throw new Error('关键帧及属性组必须有唯一的非空 id')
      keyframeIds.add(id)
    }
    for (const group of segment.common_keyframes) {
      if (!group || typeof group.property_type !== 'string' || !group.property_type ||
          !Array.isArray(group.keyframe_list)) throw new Error(`${segment.id} 关键帧属性组格式无效`)
      uniqueKeyframe(group.id)
      let previous = -1
      for (const frame of group.keyframe_list) {
        if (!frame) throw new Error(`${segment.id} 关键帧格式无效`)
        uniqueKeyframe(frame.id)
        micros(frame.time_offset, `${segment.id}.keyframe.time_offset`)
        if (frame.time_offset <= previous) throw new Error(`${segment.id} 同属性关键帧时间必须严格递增`)
        previous = frame.time_offset
        if (!Array.isArray(frame.values) || !frame.values.length ||
            frame.values.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
          throw new Error(`${segment.id} 关键帧 values 必须是非空有限数字数组`)
        }
        hasKeyframes = true
      }
    }
  }
  function timing(item: DraftScene | DraftSegment): Pick<SceneElement, 'target_start_time' | 'target_end_time' | 'duration'> {
    for (const key of ['time', 'target_start_time', 'target_end_time', 'source_start_time']) {
      if (key in item) throw new Error(`${item.id}.${key} 已移除，请使用 timerange 和 auto_timing`)
    }
    const range = item.target_timerange
    if (!range || typeof range !== 'object' || Array.isArray(range)) throw new Error(`${item.id}.target_timerange 必须是对象`)
    const result: Pick<SceneElement, 'target_start_time' | 'target_end_time' | 'duration'> = {}
    if (range.start !== undefined) result.target_start_time = micros(range.start, `${item.id}.target_timerange.start`)
    if (range.duration !== undefined) {
      result.duration = micros(range.duration, `${item.id}.target_timerange.duration`)
      if (!result.duration) throw new Error(`${item.id}.duration 必须大于 0`)
    }
    if (range.end !== undefined) {
      const end = micros(range.end, `${item.id}.target_timerange.end`)
      if (range.duration !== undefined && range.end !== (range.start ?? 0) + range.duration) {
        throw new Error(`${item.id}.target_timerange.end 与 start/duration 不一致`)
      }
      result.target_end_time = end
    }
    const auto = item.auto_timing
    if (auto !== undefined) {
      if (!auto || typeof auto !== 'object' || Array.isArray(auto) || !Object.keys(auto).length) {
        throw new Error(`${item.id}.auto_timing 必须包含 start 或 end`)
      }
      const unknown = Object.keys(auto).find((key) => !['start', 'end'].includes(key))
      if (unknown) throw new Error(`${item.id}.auto_timing.${unknown} 不支持，请使用 start 或 end`)
      // Automatic endpoints supersede the stored target range, never the source range.
      delete result.target_end_time
      if (auto.end && !auto.start) delete result.target_start_time
      for (const side of ['start', 'end'] as const) {
        const anchor = auto[side]
        if (anchor === undefined) continue
        if (!anchor || typeof anchor.target !== 'string' || !anchor.target ||
            !['start', 'end'].includes(anchor.anchor) ||
            Object.keys(anchor).some((key) => !['target', 'anchor', 'offset'].includes(key))) {
          throw new Error(`${item.id}.auto_timing.${side} 锚点格式无效`)
        }
        const offset = anchor.offset === undefined ? 0 : micros(anchor.offset, `${item.id}.auto_timing.${side}.offset`, true)
        if (anchor.target === 'parent') {
          if (side === 'end' && anchor.anchor === 'end' && offset === 0) result.target_end_time = 'end'
          else if (anchor.anchor === 'start' && offset >= 0) {
            if (side === 'start') result.target_start_time = offset
            else result.target_end_time = offset
          } else throw new Error(`${item.id} 当前仅支持 parent.start 非负偏移和 parent.end 零偏移`)
        } else {
          rules[item.id] ??= {}
          rules[item.id][side] = { element_id: anchor.target, anchor: anchor.anchor, offset }
        }
      }
    }
    return result
  }
  function scene(item: DraftScene): SceneElement {
    unique(item?.id)
    if (!Array.isArray(item.tracks) || (item.scenes !== undefined && !Array.isArray(item.scenes))) {
      throw new Error(`${item.id}.tracks/scenes 必须是数组`)
    }
    const elements: SceneElement[] = []
    for (const [index, track] of item.tracks.entries()) {
      unique(track?.id)
      if (!['video', 'audio', 'text', 'sticker', 'filter', 'effect'].includes(track.type)) throw new Error(`暂不支持轨道类型：${track.type}`)
      if (!Array.isArray(track.segments)) throw new Error(`${track.id}.segments 必须是数组`)
      const relative = track.track_relative_index ?? index
      if (!Number.isInteger(relative)) throw new Error(`${track.id}.track_relative_index 必须是整数`)
      for (const segment of track.segments) {
        unique(segment?.id)
        validateKeyframes(segment)
        const found = materials.get(segment.material_id)
        if (!found) throw new Error(`${segment.id} 引用了不存在的 material_id`)
        const { material, bucket } = found
        const type = track.type === 'video' ? (material.type === 'photo' ? 'image' : 'video') : track.type as SceneElement['type']
        const buckets: Record<string, string> = {
          video: 'videos', audio: 'audios', text: 'texts',
          sticker: 'stickers', filter: 'effects', effect: 'video_effects'
        }
        if (bucket !== buckets[track.type] ||
            (['sticker', 'filter', 'effect'].includes(track.type) &&
             material.type !== (track.type === 'effect' ? 'video_effect' : track.type))) {
          throw new Error(`${segment.id} 的素材类型与轨道不一致`)
        }
        const element: SceneElement = {
          id: segment.id, name: segment.name ?? String(material.material_name ?? material.name ?? segment.id),
          type, track_name: track.id, track_relative_index: relative, ...timing(segment)
        }
        if (type === 'text') {
          let content: { text?: unknown }
          try { content = JSON.parse(material.content ?? '') } catch { throw new Error(`${material.id}.content 必须是文字 JSON 字符串`) }
          if (!content || typeof content.text !== 'string') throw new Error(`${material.id}.content 缺少 text`)
          element.text = content.text
          warnings.push(`${segment.id} 暂仅转换文字内容，富文本样式未适配`)
        } else if (['image', 'video', 'audio'].includes(type)) {
          element.source = material.remote_url || material.path
          if (type !== 'image') {
            const range = segment.source_timerange
            if (range) {
              element.source_start_time = micros(range.start ?? 0, `${segment.id}.source_timerange.start`)
              if (range.duration !== undefined) micros(range.duration, `${segment.id}.source_timerange.duration`)
              if (range.end !== undefined) {
                micros(range.end, `${segment.id}.source_timerange.end`)
                if (range.duration !== undefined && range.end !== (range.start ?? 0) + range.duration) {
                  throw new Error(`${segment.id}.source_timerange.end 与 start/duration 不一致`)
                }
              }
            }
            if (segment.speed !== undefined && segment.speed !== 1) throw new Error(`${segment.id} 暂不支持非 1 倍速`)
          }
        }
        if (segment.clip) warnings.push(`${segment.id}.clip 已保留，当前 Workflow 尚未适配画面变换`)
        if (Array.isArray(segment.extra_material_refs) && segment.extra_material_refs.length) {
          warnings.push(`${segment.id}.extra_material_refs 已保留，当前 Workflow 尚未适配附加素材`)
        }
        if (segment.visible === false) throw new Error(`${segment.id} 暂不支持隐藏片段，请移除后编译`)
        elements.push(element)
      }
    }
    elements.push(...(item.scenes ?? []).map(scene))
    return { id: item.id, name: item.name, type: 'composition', ...timing(item), elements }
  }
  const template: SceneTemplate = {
    width: draft.canvas_config.width, height: draft.canvas_config.height,
    ...(draft.duration !== undefined ? { duration: micros(draft.duration, '模版.duration') } : {}),
    elements: draft.scenes.map(scene), timing_rules: rules
  }
  return { template, warnings, hasKeyframes }
}

export function analyzeDraftTemplate(draft: DraftTemplate) {
  return analyzeSceneTemplate(normalizeDraftTemplate(draft).template)
}

export function compileDraftTemplate(draft: DraftTemplate) {
  const normalized = normalizeDraftTemplate(draft)
  if (normalized.hasKeyframes) throw new Error('模版包含关键帧，当前尚未支持关键帧 Workflow 执行，禁止丢弃动画后导出')
  function check(elements: SceneElement[]) {
    for (const element of elements) {
      if (['sticker', 'filter', 'effect'].includes(element.type)) {
        throw new Error(`${element.id} 的${{ sticker: '贴纸', filter: '滤镜', effect: '特效' }[element.type]}轨道暂未支持 Workflow 执行`)
      }
      if (element.elements) check(element.elements)
    }
  }
  check(normalized.template.elements)
  const result = compileSceneTemplate(normalized.template)
  return { ...result, template: structuredClone(draft), warnings: [...normalized.warnings, ...result.warnings] }
}

export function wrapDraftAsTemplate(draft: {
  canvas_config: DraftTemplate['canvas_config']
  materials: DraftTemplate['materials']
  duration: number
  tracks: DraftTrack[]
  [key: string]: unknown
}): DraftTemplate {
  const copy = structuredClone(draft)
  const { tracks, ...rest } = copy
  return { ...rest, canvas_config: copy.canvas_config, materials: copy.materials,
    scenes: [{ id: 'scene-1', name: 'Scene 1', target_timerange: { start: 0, duration: copy.duration }, tracks }] }
}
