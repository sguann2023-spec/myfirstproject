import { createSceneTimingEngine } from './sceneTiming'
import { mediaLoopSlices } from './mediaLoop'
import { STICKER_TRANSFORMS, stickerTransformParams, type StickerTransforms } from './stickerWorkflow'
import { validateResource, type ResourceFields } from './resourceWorkflow'
import { visualParams } from './propertyWorkflow'
import { validateWorkflowConfiguration } from './configurationWorkflow'

export interface SceneElement extends StickerTransforms, ResourceFields {
  id: string
  name?: string
  type: 'composition' | 'image' | 'text' | 'video' | 'audio' | 'sticker' | 'filter' | 'effect'
  track?: number
  track_name?: string
  track_relative_index?: number
  target_start_time?: number
  target_end_time?: number | 'end'
  source_start_time?: number
  sticker_id?: string
  source_duration?: number
  loop?: boolean
  duration?: number
  auto_duration?: boolean
  batch_scene?: unknown
  fill_color?: string
  height?: number | string
  source?: string
  elements?: SceneElement[]
  text?: string
  x?: string | number
  y?: string | number
  x_anchor?: string
  y_anchor?: string
  font_family?: string
  font_size?: string | number
  font_alpha?: number
  configuration?: Record<string, unknown>
}

export interface TimingAnchor {
  element_id: string
  anchor: 'start' | 'end'
  offset?: number
}

export interface TimingRule {
  start?: TimingAnchor
  end?: TimingAnchor
}

export interface SceneTemplate {
  width: number
  height: number
  duration?: number
  elements: SceneElement[]
  timing_rules?: Record<string, TimingRule>
  sources?: Record<string, string>
  [key: string]: unknown
}

export interface ResolvedElement {
  id: string
  parentId: string | null
  type: SceneElement['type']
  localStart: number
  start: number
  end: number
  duration: number
  visibleDuration: number
  visible: boolean
  sourceStart?: number
  sourceEnd?: number
}

function seconds(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${path} 必须是非负秒数`)
  }
  return value
}

function positiveDuration(value: unknown, path: string): number {
  const duration = seconds(value, path)
  if (duration === 0) throw new Error(`${path} 必须大于 0`)
  return duration
}

function targetStart(element: SceneElement) {
  return element.target_start_time
}

function track(element: SceneElement): number {
  const value = element.track ?? 1
  if (!Number.isInteger(value) || value < 1) throw new Error(`${element.id}.track 必须是正整数`)
  return value
}

function relativeTrack(element: SceneElement): number {
  const value = element.track_relative_index ?? track(element) - 1
  if (!Number.isInteger(value)) throw new Error(`${element.id}.track_relative_index 必须是整数`)
  return value
}

function ordered(elements: SceneElement[]): SceneElement[] {
  return elements.map((element, index) => ({ element, index, track: relativeTrack(element) }))
    .sort((a, b) => a.track - b.track || a.index - b.index)
    .map(({ element }) => element)
}

/**
 * Resolve scene-local timing first, then flatten image operations for the backend.
 * End-anchored elements keep their duration: localStart = parentDuration - duration.
 */
export interface SceneCompileOptions {
  sources?: Record<string, string>
  timing_rules?: Record<string, TimingRule>
}

export function compileSceneTemplate(
  template: SceneTemplate, options: SceneCompileOptions = {}, includeHidden = false
) {
  return processSceneTemplate(template, options, false, includeHidden)
}

export function analyzeSceneTemplate(template: SceneTemplate, options: SceneCompileOptions = {}) {
  // Local editing still needs descendants whose ancestors are outside the visible export range.
  const { duration, timeline } = processSceneTemplate(template, options, true, true)
  return { duration, timeline }
}

function processSceneTemplate(
  template: SceneTemplate,
  options: SceneCompileOptions,
  timelineOnly: boolean,
  includeHidden = false
) {
  if (!template || !Array.isArray(template.elements)) throw new Error('模版 elements 必须是数组')
  if (![template.width, template.height].every((size) => Number.isInteger(size) && size > 0)) {
    throw new Error('画布尺寸必须是正整数')
  }
  const source = structuredClone(template)
  options = {
    sources: { ...options.sources, ...source.sources },
    timing_rules: { ...options.timing_rules, ...source.timing_rules }
  }
  for (const key of ['sources', 'timing_rules'] as const) {
    const value = source[key]
    if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) {
      throw new Error(`${key} 必须是对象`)
    }
  }
  if (Object.values(options.sources ?? {}).some((value) => typeof value !== 'string')) {
    throw new Error('素材映射的值必须是字符串')
  }
  const ids = new Set<string>()
  const parents = new Map<string, string | null>()
  const warnings: string[] = []
  const rootFields = new Set([
    'width', 'height', 'duration', 'elements', 'fill_color', 'output_format',
    'gif_quality', 'gif_compression', 'snapshot_time', 'emoji_style', 'timing_rules', 'sources'
  ])
  for (const key of Object.keys(source)) {
    if (!rootFields.has(key)) throw new Error(`暂不支持模版属性：${key}`)
  }
  for (const key of Object.keys(source).filter((key) =>
    !['width', 'height', 'duration', 'elements', 'timing_rules', 'sources'].includes(key))) {
    warnings.push(`模版.${key} 已保留，但当前 workflow 不应用该设置`)
  }

  function validate(elements: SceneElement[], parentId: string | null = null) {
    for (const element of elements) {
      if (!element || typeof element.id !== 'string' || !element.id || ids.has(element.id)) {
        throw new Error('每个元素必须有唯一的非空 id')
      }
      ids.add(element.id)
      parents.set(element.id, parentId)
      if (!['composition', 'image', 'text', 'video', 'audio', 'sticker', 'filter', 'effect'].includes(element.type)) {
        throw new Error(`${element.id} 暂不支持元素类型：${element.type}`)
      }
      track(element)
      relativeTrack(element)
      validateWorkflowConfiguration(element.type, element.configuration)
      if (element.track_name !== undefined && (typeof element.track_name !== 'string' || !element.track_name.trim())) {
        throw new Error(`${element.id}.track_name 必须是非空字符串`)
      }
      const allowed = new Set(['id', 'name', 'type', 'track', 'duration',
        'target_start_time', 'target_end_time', 'configuration',
        'track_name', 'track_relative_index',
        ...(['image', 'video', 'text'].includes(element.type)
          ? ['transform_x', 'transform_y', 'scale_x', 'scale_y', 'rotation', element.type === 'text' ? 'font_alpha' : 'alpha'] : []),
        ...(element.type === 'composition' ? ['fill_color', 'elements', 'auto_duration', 'batch_scene'] :
          element.type === 'text' ? ['text', 'fill_color', 'x', 'y', 'x_anchor', 'y_anchor', 'font_family', 'font_size'] :
          element.type === 'sticker' ? ['sticker_id', ...STICKER_TRANSFORMS.map(([key]) => key)] :
          element.type === 'filter' ? ['filter_type', 'intensity'] :
          element.type === 'effect' ? ['effect_type', 'effect_category', 'params'] :
            ['source', 'height', ...(['video', 'audio'].includes(element.type) ? ['source_start_time', 'source_duration', 'loop'] : [])])])
      for (const key of Object.keys(element)) {
        if (key === 'time') throw new Error(`${element.id}.time 已移除，请使用 target_start_time；结束锚定请使用 target_end_time`)
        if (!allowed.has(key)) throw new Error(`${element.id} 暂不支持属性：${key}`)
      }
      if (element.target_start_time !== undefined) seconds(element.target_start_time, `${element.id}.target_start_time`)
      if (element.target_end_time !== undefined && element.target_end_time !== 'end') {
        seconds(element.target_end_time, `${element.id}.target_end_time`)
      }
      if (element.source_start_time !== undefined) seconds(element.source_start_time, `${element.id}.source_start_time`)
      if (element.source_duration !== undefined) positiveDuration(element.source_duration, `${element.id}.source_duration`)
      if (element.loop !== undefined && typeof element.loop !== 'boolean') throw new Error(`${element.id}.loop 必须是布尔值`)
      if (element.loop && !timelineOnly && element.source_duration === undefined) throw new Error(`${element.id} 媒体循环缺少有效源时长`)
      if (element.duration !== undefined) positiveDuration(element.duration, `${element.id}.duration`)
      if (element.type === 'sticker') {
        if (element.sticker_id !== undefined && typeof element.sticker_id !== 'string') throw new Error(`${element.id}.sticker_id 必须是字符串`)
        if (!timelineOnly && !element.sticker_id?.trim()) throw new Error(`${element.id} 贴纸缺少 sticker_id/resource_id，请填写真实资源 ID`)
        stickerTransformParams(element, element.id)
      }
      if (element.type === 'filter' || element.type === 'effect') validateResource(element, element.type, element.id, timelineOnly)
      if (element.type === 'composition') {
        if (element.auto_duration !== undefined && typeof element.auto_duration !== 'boolean') {
          throw new Error(`${element.id}.auto_duration 必须是布尔值`)
        }
        if (!Array.isArray(element.elements)) throw new Error(`${element.id}.elements 必须是数组`)
        validate(element.elements, element.id)
      }
    }
  }
  validate(source.elements)
  for (const [id, rule] of Object.entries(options.timing_rules ?? {})) {
    if (!ids.has(id)) throw new Error(`timing_rules.${id} 引用了不存在的元素`)
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      throw new Error(`timing_rules.${id} 必须是包含 start 或 end 的对象`)
    }
    const unknown = Object.keys(rule).find((key) => !['start', 'end'].includes(key))
    if (unknown) throw new Error(`timing_rules.${id}.${unknown} 不支持，请使用 start 或 end（例如 statr 应写为 start）`)
    if (!rule.start && !rule.end) throw new Error(`timing_rules.${id} 必须包含有效的 start 或 end 关联`)
    for (const anchor of [rule.start, rule.end]) {
      if (anchor === undefined) continue
      if (!anchor || !ids.has(anchor.element_id)) throw new Error(`timing_rules.${id} 引用了不存在的元素`)
      if (parents.get(id) !== parents.get(anchor.element_id)) throw new Error('首版时间关联仅支持同一父级内的元素')
      if (!['start', 'end'].includes(anchor.anchor)) throw new Error(`timing_rules.${id} anchor 必须为 start 或 end`)
      if (anchor.offset !== undefined && (typeof anchor.offset !== 'number' || !Number.isFinite(anchor.offset))) {
        throw new Error(`timing_rules.${id} offset 必须为有限秒数`)
      }
      if (Object.keys(anchor).some((key) => !['element_id', 'anchor', 'offset'].includes(key))) {
        throw new Error(`timing_rules.${id} 包含不支持的字段`)
      }
    }
  }

  const timingEngine = createSceneTimingEngine(options.timing_rules ?? {}, (element) => ({
    start: element.target_start_time,
    end: typeof element.target_end_time === 'number' ? element.target_end_time : undefined,
    endAtParent: element.target_end_time === 'end',
    duration: element.duration,
    offset: (anchor) => anchor.offset ?? 0
  }), {
    value: (value) => value, add: (a, b) => a + b, subtract: (a, b) => a - b,
    max: Math.max, store: (value) => value,
    validate: (element, start, duration) => {
      if (!Number.isFinite(start) || !Number.isFinite(duration) || duration < 0) {
        throw new Error(`${element.id} 关联后的结束时间不能早于开始时间，时间必须为有限数字`)
      }
    },
    validateContent: (element, duration) => {
      if (element.target_end_time !== undefined || options.timing_rules?.[element.id]?.end) {
        throw new Error(`${element.id} 自动内容时长不能同时设置分镜结束锚点`)
      }
      positiveDuration(duration, `${element.id} 推导的分镜.duration`)
    }
  })
  function hasAutoDuration(elements: SceneElement[]): boolean {
    return elements.some((element) => element.auto_duration || hasAutoDuration(element.elements ?? []))
  }

  // A root without duration is inferred only from explicitly timed children.
  // End anchoring cannot determine its own parent duration.
  let total: number
  if (source.duration !== undefined) {
    total = positiveDuration(source.duration, '模版.duration')
  } else if (hasAutoDuration(source.elements)) {
    total = 0
    const root = timingEngine.scope(source.elements)
    for (const element of source.elements) {
      const timing = root.resolve(element)
      if (!timing) throw new Error(`${element.id} 无法推导模版时长，请设置根 duration 或使用独立内容驱动的分镜`)
      total = Math.max(total, timing.localStart + timing.duration)
    }
    positiveDuration(total, '推导的模版.duration')
  } else {
    total = 0
    for (const element of source.elements) {
      if (options.timing_rules?.[element.id]) throw new Error('顶层元素关联时间时请显式设置根 duration')
      if (element.target_end_time === 'end') {
        throw new Error(`${element.id} 无法推导模版时长，请显式设置根 duration`)
      }
      if (typeof element.target_end_time === 'number') {
        total = Math.max(total, element.target_end_time)
        continue
      }
      if (element.duration === undefined) {
        throw new Error(`${element.id} 无法推导模版时长，请设置模版 duration 或顶层元素的数字 target_start_time/duration`)
      }
      total = Math.max(total, seconds(targetStart(element) ?? 0, `${element.id}.target_start_time`) + element.duration)
    }
    positiveDuration(total, '推导的模版.duration')
  }

  const timeline: ResolvedElement[] = []
  const trackIndexes = new Map<string, number>()
  const namedTracks = new Map<string, { type: string; relativeIndex: number }>()
  function backendTrack(element: SceneElement, parentId: string | null) {
    if (element.track_name !== undefined) {
      const name = element.track_name.trim()
      const type = element.type === 'image' || element.type === 'video' ? 'video' : element.type
      const relativeIndex = relativeTrack(element)
      const previous = namedTracks.get(name)
      if (previous && (previous.type !== type || previous.relativeIndex !== relativeIndex)) {
        throw new Error(`轨道 ${name} 的素材类型或 track_relative_index 不一致`)
      }
      namedTracks.set(name, { type, relativeIndex })
      return { track_name: name, relative_index: relativeIndex }
    }
    // Backend tracks are typed; keep scene-local track numbers and media types isolated.
    const key = JSON.stringify([parentId, track(element), element.type])
    if (!trackIndexes.has(key)) trackIndexes.set(key, trackIndexes.size)
    return {
      track_name: `template_${parentId ?? 'root'}_track_${track(element)}_${element.type}`,
      relative_index: element.track_relative_index ?? trackIndexes.get(key)!
    }
  }
  const script: Array<{
    type: 'action'; id: string; index: number; action_type: 'add_image' | 'add_text' | 'add_video' | 'add_audio' | 'add_sticker' | 'add_filter' | 'add_effect'
    params: {
      [key: string]: unknown
      image_url?: string; video_url?: string; audio_url?: string; text?: string; font_color?: string; sticker_id?: string
      target_start?: number; duration?: number
      start: number; end: number; width: number; height: number
      track_name: string; relative_index?: number
    }
  }> = []
  const actionIds = new Set(ids)

  function walk(
    elements: SceneElement[], parentStart: number, parentDuration: number,
    parentId: string | null, clipStart: number, clipEnd: number
  ) {
    const scope = timingEngine.scope(elements, parentDuration)
    const resolve = (element: SceneElement) => scope.resolve(element)!
    // Validate dependencies even when a referenced element is later hidden.
    elements.forEach(resolve)
    for (const element of ordered(elements)) {
      const { localStart, duration } = resolve(element)
      const localEnd = localStart + duration
      const nominalStart = parentStart + localStart
      // Keep the declared origin for nested timing; intersect only visible bounds.
      const start = Number(Math.min(clipEnd, Math.max(clipStart, nominalStart)).toFixed(9))
      const end = Number(Math.max(start, Math.min(clipEnd, parentStart + localEnd)).toFixed(9))
      const visible = end > start
      const speed = Number(element.configuration?.speed ?? 1)
      const configuration = element.configuration ?? {}
      const fades = Number(configuration.fade_in_duration ?? 0) + Number(configuration.fade_out_duration ?? 0)
      if (fades && (element.loop || start !== nominalStart || end !== parentStart + localEnd || fades > duration)) {
        throw new Error(`${element.id} 淡入淡出不支持循环、父级裁切或总时长超过片段`)
      }
      const sourceElapsed = element.loop && element.source_duration
        ? (Math.round((start - nominalStart) * 1_000_000) % Math.round(element.source_duration * 1_000_000)) / 1_000_000
        : (start - nominalStart) * speed
      timeline.push({
        id: element.id, parentId, type: element.type,
        localStart: Number(localStart.toFixed(9)), start, end, duration,
        visibleDuration: Number((end - start).toFixed(9)), visible,
        ...(['video', 'audio'].includes(element.type) && visible ? {
          sourceStart: Number(((element.source_start_time ?? 0) + sourceElapsed).toFixed(9)),
          sourceEnd: Number(((element.source_start_time ?? 0) + sourceElapsed +
            (element.loop && element.source_duration ? Math.min(end - start, element.source_duration - sourceElapsed) : (end - start) * speed)).toFixed(9))
        } : {})
      })
      if (!visible) {
        warnings.push(`${element.id} 位于 scene 可见时间范围外，不生成操作`)
        if (!includeHidden) continue
      }
      if (element.type === 'composition') {
        if (element.fill_color !== undefined) {
          warnings.push(`${element.id}.fill_color 已保留，但当前 workflow 不渲染 scene 背景`)
        }
        walk(element.elements!, nominalStart, duration, element.id, start, end)
      } else if (timelineOnly) {
        continue
      } else if (element.type === 'text') {
        if (typeof element.text !== 'string') throw new Error(`${element.id}.text 必须为字符串`)
        if (element.fill_color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(element.fill_color)) {
          throw new Error(`${element.id}.fill_color 目前仅支持六位十六进制颜色`)
        }
        const index = script.length
        script.push({
          type: 'action', id: element.id, index, action_type: 'add_text',
          params: {
            text: element.text, font_color: element.fill_color ?? '#ffffff',
            start, end, width: source.width, height: source.height,
            ...backendTrack(element, parentId), ...configuration, ...visualParams(element)
          }
        })
        if (element.font_family || element.x_anchor || element.y_anchor) warnings.push(`${element.id} 旧字体家族和锚点未适配，请使用原生属性配置`)
      } else if (element.type === 'filter' || element.type === 'effect') {
        const resource = element.type === 'filter'
          ? { filter_type: element.filter_type!.trim(), intensity: element.intensity ?? 100 }
          : { effect_type: element.effect_type!.trim(), effect_category: element.effect_category ?? 'scene',
            ...(element.params !== undefined ? { params: element.params } : {}) }
        script.push({
          type: 'action', id: element.id, index: script.length,
          action_type: element.type === 'filter' ? 'add_filter' : 'add_effect',
          params: { ...resource, start, end, width: source.width, height: source.height, ...backendTrack(element, parentId) }
        })
      } else if (element.type === 'sticker') {
        script.push({
          type: 'action', id: element.id, index: script.length, action_type: 'add_sticker',
          params: {
            sticker_id: element.sticker_id!.trim(), start, end,
            width: source.width, height: source.height,
            ...backendTrack(element, parentId), ...stickerTransformParams(element, element.id)
          }
        })
      } else {
        const originalSource = element.source
        const resolvedSource = typeof originalSource === 'string'
          ? (options.sources?.[originalSource.trim()] ?? originalSource).trim() : ''
        if (!resolvedSource) throw new Error(`${element.id} 缺少${{ image: '图片', video: '视频', audio: '音频' }[element.type] ?? '素材'} source`)
        // Creatomate asset IDs are not paths and cannot be downloaded by this backend.
        if (!/^(https?:\/\/|file:\/\/|\/|[a-zA-Z]:[\\/]|\\\\)/.test(resolvedSource)) {
          throw new Error(`${element.id}.source 是素材 ID 或相对路径，请通过 sources 映射到实际 URL 或绝对路径`)
        }
        if (element.height !== undefined) {
          warnings.push(`${element.id}.height=${element.height} 已保留，但当前 workflow 使用后端默认图片布局`)
        }
        const index = script.length
        const trackParams = backendTrack(element, parentId)
        const resolved = timeline[timeline.length - 1]
        if (element.loop && ['audio', 'video'].includes(element.type)) {
          const loopTrack = element.type === 'audio'
            ? { track_name: trackParams.track_name } : trackParams
          const slices = mediaLoopSlices(start, end, nominalStart, element.source_start_time ?? 0, element.source_duration!)
          slices.forEach((slice, iteration) => {
            let id = iteration === 0 ? element.id : `${element.id}__loop_${iteration}`
            if (iteration) while (actionIds.has(id)) id += '_'
            actionIds.add(id)
            script.push({
              type: 'action', id, index: script.length,
              action_type: element.type === 'audio' ? 'add_audio' : 'add_video',
              params: {
                [element.type === 'audio' ? 'audio_url' : 'video_url']: resolvedSource,
                ...slice, width: source.width, height: source.height, ...loopTrack, ...configuration, ...visualParams(element)
              }
            })
          })
        } else if (element.type === 'audio') {
          const { relative_index: _relativeIndex, ...audioTrackParams } = trackParams
          script.push({
            type: 'action', id: element.id, index, action_type: 'add_audio',
            params: {
              audio_url: resolvedSource,
              target_start: start,
              start: resolved.sourceStart ?? 0,
              end: resolved.sourceEnd ?? end - start,
              duration: duration,
              width: source.width, height: source.height,
              ...audioTrackParams, ...configuration
            }
          })
        } else if (element.type === 'video') {
          script.push({
            type: 'action', id: element.id, index, action_type: 'add_video',
            params: {
              video_url: resolvedSource,
              target_start: start,
              start: resolved.sourceStart ?? 0,
              end: resolved.sourceEnd ?? end - start,
              duration: Number((end - start).toFixed(9)),
              width: source.width, height: source.height,
              ...trackParams, ...configuration, ...visualParams(element)
            }
          })
        } else {
          script.push({
            type: 'action', id: element.id, index, action_type: 'add_image',
            params: {
              image_url: resolvedSource,
              start, end, width: source.width, height: source.height,
              ...trackParams, ...configuration, ...visualParams(element)
            }
          })
        }
      }
    }
  }
  walk(source.elements, 0, total, null, 0, total)
  if (!script.length) warnings.push('模版没有可见内容，workflow.script 为空')
  return {
    template: source,
    duration: total,
    timeline,
    workflow: { width: source.width, height: source.height, inputs: {}, script },
    warnings
  }
}
