import { analyzeSceneTemplate, compileSceneTemplate, type SceneElement, type SceneTemplate, type TimingRule } from './sceneTemplate'
import { applyDynamicInputs, getDynamicInputs } from './dynamicInputs'
import { compileDynamicWorkflow } from './dynamicWorkflow'
import { backendTrackType, isSceneSegment, logicalTrackLayout, mapWorkflowTracks, materialElementType, validateLogicalTrackTimeline } from './draftTracks'
import { mediaDurationMicros } from '../../shared/templateMediaTiming'
import { stickerClipTransforms, stickerIdentifier } from './stickerWorkflow'
import { resourceFields } from './resourceWorkflow'
import { executableKeyframes } from './keyframeWorkflow'

export interface DraftDynamicFields {
  dynamic?: string[]
}

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

export interface DraftSegment extends DraftDynamicFields {
  id: string
  material_id: string
  name?: string
  target_timerange: DraftRange
  source_timerange?: DraftRange | null
  duration_mode?: 'media'
  loop?: boolean
  auto_timing?: DraftTiming
  common_keyframes?: DraftKeyframeGroup[]
  keyframe_refs?: string[]
  [key: string]: unknown
}

export interface DraftKeyframe extends DraftDynamicFields {
  id: string
  time_offset: number
  values: number[]
  curveType?: string
  [key: string]: unknown
}

export interface DraftKeyframeGroup extends DraftDynamicFields {
  id: string
  property_type: string
  keyframe_list: DraftKeyframe[]
  material_id?: string
  [key: string]: unknown
}

export interface DraftTrack extends DraftDynamicFields {
  id: string
  name?: string
  type?: string
  segments: DraftTrackItem[]
  track_relative_index?: number
  [key: string]: unknown
}

export interface DraftScene extends DraftDynamicFields {
  id: string
  name?: string
  target_timerange: DraftRange
  auto_timing?: DraftTiming
  auto_duration?: boolean
  tracks: DraftTrack[]
  scenes?: DraftScene[]
  common_keyframes?: DraftKeyframeGroup[]
  keyframe_refs?: string[]
  [key: string]: unknown
}

export interface DraftSceneSegment extends DraftScene {
  type: 'scene'
}

export type DraftTrackItem = DraftSegment | DraftSceneSegment

export interface DraftMaterial extends DraftDynamicFields {
  id: string
  type: string
  duration?: number
  path?: string
  remote_url?: string
  content?: string
  [key: string]: unknown
}

export interface DraftTemplate extends DraftDynamicFields {
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
  getDynamicInputs(draft)
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
  function validateKeyframes(segment: Pick<DraftSegment, 'id' | 'common_keyframes' | 'keyframe_refs'>) {
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
    validateKeyframes(item)
    if (item.visible === false) throw new Error(`${item.id} 暂不支持隐藏分镜`)
    if (item.speed !== undefined && item.speed !== 1) throw new Error(`${item.id} 暂不支持分镜整体变速`)
    if ('source_timerange' in item) throw new Error(`${item.id} 的分镜不使用 source_timerange，请设置内部媒体的源区间`)
    if (item.clip) warnings.push(`${item.id}.clip 已保留，当前 Workflow 尚未适配分镜整体变换`)
    if (item.auto_duration !== undefined && typeof item.auto_duration !== 'boolean') {
      throw new Error(`${item.id}.auto_duration 必须是布尔值`)
    }
    if (item.auto_duration && item.auto_timing?.end !== undefined) {
      throw new Error(`${item.id} 自动内容时长不能同时设置分镜结束锚点`)
    }
    if (!Array.isArray(item.tracks) || (item.scenes !== undefined && !Array.isArray(item.scenes))) {
      throw new Error(`${item.id}.tracks/scenes 必须是数组`)
    }
    if (item.batch_scene !== undefined) {
      if (!item.batch_scene || typeof item.batch_scene !== 'object' || Array.isArray(item.batch_scene)) {
        throw new Error(`${item.id}.batch_scene 必须是对象`)
      }
      const directSegments = item.tracks.flatMap((track) => Array.isArray(track?.segments) ? track.segments : [])
      const sceneChildren = directSegments.filter(isSceneSegment).length + (item.scenes?.length ?? 0)
      if (directSegments.some(segment => !isSceneSegment(segment)) || sceneChildren !== 1) {
        throw new Error(`${item.id} 批量分镜必须有且只有一个子分镜`)
      }
    }
    const elements: SceneElement[] = []
    for (const [index, track] of item.tracks.entries()) {
      unique(track?.id)
      if (track.type !== undefined && !['mixed', 'scene', 'video', 'audio', 'text', 'sticker', 'filter', 'effect'].includes(track.type)) {
        throw new Error(`暂不支持轨道类型：${track.type}`)
      }
      if (!Array.isArray(track.segments)) throw new Error(`${track.id}.segments 必须是数组`)
      const relative = track.track_relative_index ?? index
      if (!Number.isInteger(relative)) throw new Error(`${track.id}.track_relative_index 必须是整数`)
      for (const segment of track.segments) {
        if (isSceneSegment(segment)) {
          if (track.type && !['mixed', 'scene'].includes(track.type)) {
            throw new Error(`${segment.id} 的分镜类型与轨道不一致，请使用 mixed 或 scene 轨道`)
          }
          if ('material_id' in segment) throw new Error(`${segment.id} 的分镜在轨道中直接定义，不使用 material_id`)
          elements.push({ ...scene(segment), track_name: track.id, track_relative_index: relative })
          continue
        }
        if (segment && ('tracks' in segment || 'scenes' in segment)) {
          throw new Error(`${segment.id} 轨道中的子分镜必须设置 type: "scene"`)
        }
        unique(segment?.id)
        validateKeyframes(segment)
        const found = materials.get(segment.material_id)
        if (!found) throw new Error(`${segment.id} 引用了不存在的 material_id`)
        const { material, bucket } = found
        const type = materialElementType(material, bucket)
        if (segment.loop !== undefined && (typeof segment.loop !== 'boolean' || !['video', 'audio'].includes(type))) {
          throw new Error(`${segment.id}.loop 仅支持视频/音频的布尔值`)
        }
        if (segment.duration_mode !== undefined && (segment.duration_mode !== 'media' || !['video', 'audio'].includes(type))) {
          throw new Error(`${segment.id}.duration_mode 仅支持视频/音频的 media 模式`)
        }
        if (track.type && track.type !== 'mixed' && backendTrackType(type) !== track.type) {
          throw new Error(`${segment.id} 的素材类型与轨道不一致`)
        }
        const element: SceneElement = {
          id: segment.id, name: segment.name ?? String(material.material_name ?? material.name ?? segment.id),
          type, track_name: track.id, track_relative_index: relative, ...timing(segment)
        }
        if (segment.duration_mode === 'media') {
          const duration = mediaDurationMicros(segment, material)
          if (duration === undefined) throw new Error(`${segment.id} 媒体模式缺少有效源时长`)
          if (segment.auto_timing?.start && segment.auto_timing.end) throw new Error(`${segment.id} 媒体时长不能同时使用自动结束`)
          if (!segment.auto_timing?.end) delete element.target_end_time
          element.duration = duration / 1_000_000
        }
        if (segment.loop !== undefined) {
          element.loop = segment.loop
          const sourceDuration = mediaDurationMicros(segment, material)
          if (segment.loop && sourceDuration !== undefined) element.source_duration = sourceDuration / 1_000_000
        }
        if (type === 'text') {
          let content: { text?: unknown }
          try { content = JSON.parse(material.content ?? '') } catch { throw new Error(`${material.id}.content 必须是文字 JSON 字符串`) }
          if (!content || typeof content.text !== 'string') throw new Error(`${material.id}.content 缺少 text`)
          element.text = content.text
          warnings.push(`${segment.id} 暂仅转换文字内容，富文本样式未适配`)
        } else if (type === 'sticker') {
          element.sticker_id = stickerIdentifier(material)
          Object.assign(element, stickerClipTransforms(segment.clip, segment.id))
        } else if (type === 'filter' || type === 'effect') {
          Object.assign(element, resourceFields(material, type, segment.id))
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
        if (segment.clip && type !== 'sticker') warnings.push(`${segment.id}.clip 已保留，当前 Workflow 尚未适配画面变换`)
        if (Array.isArray(segment.extra_material_refs) && segment.extra_material_refs.length) {
          warnings.push(`${segment.id}.extra_material_refs 已保留，当前 Workflow 尚未适配附加素材`)
        }
        if (segment.visible === false) throw new Error(`${segment.id} 暂不支持隐藏片段，请移除后编译`)
        elements.push(element)
      }
    }
    elements.push(...(item.scenes ?? []).map(scene))
    const range = timing(item)
    if (item.auto_duration) {
      delete range.duration
      delete range.target_end_time
    }
    return { id: item.id, name: item.name, type: 'composition', ...range, elements,
      ...(item.batch_scene !== undefined ? { batch_scene: structuredClone(item.batch_scene) } : {}),
      ...(item.auto_duration !== undefined ? { auto_duration: item.auto_duration } : {}) }
  }
  const template: SceneTemplate = {
    width: draft.canvas_config.width, height: draft.canvas_config.height,
    ...(draft.duration !== undefined ? { duration: micros(draft.duration, '模版.duration') } : {}),
    elements: draft.scenes.map(scene), timing_rules: rules
  }
  const analysis = analyzeSceneTemplate(template)
  const logicalTracks = logicalTrackLayout(draft, analysis.timeline)
  validateLogicalTrackTimeline(logicalTracks, analysis.timeline)
  return { template, warnings, hasKeyframes, logicalTracks, analysis }
}

export function analyzeDraftTemplate(draft: DraftTemplate, modifications: Record<string, unknown> = {}) {
  const resolved = applyDynamicInputs(draft, modifications)
  return { ...normalizeDraftTemplate(resolved).analysis,
    dynamicInputs: getDynamicInputs(draft) }
}

export function compileDraftTemplate(draft: DraftTemplate, modifications: Record<string, unknown> = {}) {
  const dynamicInputs = getDynamicInputs(draft)
  draft = applyDynamicInputs(draft, modifications)
  const normalized = normalizeDraftTemplate(draft)
  const animationTypes = new Map(normalized.analysis.timeline.map(element => [element.id, element.type]))
  function validateAnimation(scene: DraftScene) {
    executableKeyframes(scene, 'composition')
    for (const track of scene.tracks) for (const segment of track.segments) {
      if (isSceneSegment(segment)) validateAnimation(segment)
      else {
        executableKeyframes(segment, animationTypes.get(segment.id)!)
      }
    }
    scene.scenes?.forEach(validateAnimation)
  }
  draft.scenes.forEach(validateAnimation)
  const backend = mapWorkflowTracks(normalized.template, normalized.logicalTracks)
  const result = compileSceneTemplate(backend.template)
  const dynamic = getDynamicInputs(draft).length || normalized.hasKeyframes
    ? compileDynamicWorkflow(draft, backend.template, result.duration) : undefined
  return { ...result, ...normalized.analysis, template: structuredClone(draft), dynamicInputs,
    workflow: dynamic?.workflow ?? result.workflow,
    workflowInputBindings: dynamic?.workflowInputBindings ?? [],
    workflowTracks: backend.mappings,
    warnings: [...normalized.warnings, ...result.warnings, ...(dynamic?.warnings ?? [])] }
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
    scenes: [{ id: 'scene-1', name: '分镜 1', target_timerange: { start: 0, duration: copy.duration }, tracks }] }
}
