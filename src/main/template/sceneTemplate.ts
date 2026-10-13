export interface SceneElement {
  id: string
  name?: string
  type: 'composition' | 'image' | 'text' | 'video' | 'audio'
  track?: number
  time?: number | 'end'
  duration?: number
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
}

export interface TimingRule {
  start: { element_id: string; anchor: 'start' | 'end'; offset?: number }
}

export interface SceneTemplate {
  width: number
  height: number
  duration?: number
  elements: SceneElement[]
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

function track(element: SceneElement): number {
  const value = element.track ?? 1
  if (!Number.isInteger(value) || value < 1) throw new Error(`${element.id}.track 必须是正整数`)
  return value
}

function ordered(elements: SceneElement[]): SceneElement[] {
  return elements.map((element, index) => ({ element, index, track: track(element) }))
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

export function compileSceneTemplate(template: SceneTemplate, options: SceneCompileOptions = {}) {
  return processSceneTemplate(template, options, false)
}

export function analyzeSceneTemplate(template: SceneTemplate, options: SceneCompileOptions = {}) {
  const { duration, timeline } = processSceneTemplate(template, options, true)
  return { duration, timeline }
}

function processSceneTemplate(
  template: SceneTemplate,
  options: SceneCompileOptions,
  timelineOnly: boolean
) {
  if (!template || !Array.isArray(template.elements)) throw new Error('模版 elements 必须是数组')
  if (![template.width, template.height].every((size) => Number.isInteger(size) && size > 0)) {
    throw new Error('画布尺寸必须是正整数')
  }
  const source = structuredClone(template)
  const ids = new Set<string>()
  const parents = new Map<string, string | null>()
  const warnings: string[] = []
  const rootFields = new Set([
    'width', 'height', 'duration', 'elements', 'fill_color', 'output_format',
    'gif_quality', 'gif_compression', 'snapshot_time', 'emoji_style'
  ])
  for (const key of Object.keys(source)) {
    if (!rootFields.has(key)) throw new Error(`暂不支持模版属性：${key}`)
  }
  for (const key of Object.keys(source).filter((key) =>
    !['width', 'height', 'duration', 'elements'].includes(key))) {
    warnings.push(`模版.${key} 已保留，但当前 workflow 不应用该设置`)
  }

  function validate(elements: SceneElement[], parentId: string | null = null) {
    for (const element of elements) {
      if (!element || typeof element.id !== 'string' || !element.id || ids.has(element.id)) {
        throw new Error('每个元素必须有唯一的非空 id')
      }
      ids.add(element.id)
      parents.set(element.id, parentId)
      if (!['composition', 'image', 'text', ...(timelineOnly ? ['video', 'audio'] : [])].includes(element.type)) {
        throw new Error(`${element.id} 暂不支持元素类型：${element.type}`)
      }
      track(element)
      const allowed = new Set(['id', 'name', 'type', 'track', 'time', 'duration',
        ...(element.type === 'composition' ? ['fill_color', 'elements'] :
          element.type === 'text' ? ['text', 'fill_color', 'x', 'y', 'x_anchor', 'y_anchor', 'font_family', 'font_size'] :
            ['source', 'height'])])
      for (const key of Object.keys(element)) {
        if (!allowed.has(key)) throw new Error(`${element.id} 暂不支持属性：${key}`)
      }
      if (element.time !== undefined && element.time !== 'end') seconds(element.time, `${element.id}.time`)
      if (element.duration !== undefined) positiveDuration(element.duration, `${element.id}.duration`)
      if (element.type === 'composition') {
        if (!Array.isArray(element.elements)) throw new Error(`${element.id}.elements 必须是数组`)
        validate(element.elements, element.id)
      }
    }
  }
  validate(source.elements)
  for (const [id, rule] of Object.entries(options.timing_rules ?? {})) {
    const start = rule?.start
    if (!ids.has(id) || !start || !ids.has(start.element_id)) throw new Error(`timing_rules.${id} 引用了不存在的元素`)
    if (parents.get(id) !== parents.get(start.element_id)) throw new Error('首版时间关联仅支持同一父级内的元素')
    if (!['start', 'end'].includes(start.anchor)) throw new Error(`timing_rules.${id} anchor 必须为 start 或 end`)
    if (start.offset !== undefined && (typeof start.offset !== 'number' || !Number.isFinite(start.offset))) {
      throw new Error(`timing_rules.${id} offset 必须为有限秒数`)
    }
    if (Object.keys(rule).some((key) => key !== 'start') ||
      Object.keys(start).some((key) => !['element_id', 'anchor', 'offset'].includes(key))) {
      throw new Error(`timing_rules.${id} 包含不支持的字段`)
    }
  }

  // A root without duration is inferred only from explicitly timed children.
  // End anchoring cannot determine its own parent duration.
  let total: number
  if (source.duration !== undefined) {
    total = positiveDuration(source.duration, '模版.duration')
  } else {
    total = 0
    for (const element of source.elements) {
      if (options.timing_rules?.[element.id]) throw new Error('顶层元素关联时间时请显式设置根 duration')
      if (element.time === 'end' || element.duration === undefined) {
        throw new Error(`${element.id} 无法推导模版时长，请设置模版 duration 或顶层元素的数字 time/duration`)
      }
      total = Math.max(total, seconds(element.time ?? 0, `${element.id}.time`) + element.duration)
    }
    positiveDuration(total, '推导的模版.duration')
  }

  const timeline: ResolvedElement[] = []
  const script: Array<{
    type: 'action'; id: string; index: number; action_type: 'add_image' | 'add_text'
    params: {
      image_url?: string; text?: string; font_color?: string
      start: number; end: number; width: number; height: number
      track_name: string; relative_index: number
    }
  }> = []

  function walk(
    elements: SceneElement[], parentStart: number, parentDuration: number,
    parentId: string | null, clipStart: number, clipEnd: number
  ) {
    const siblings = new Map(elements.map((element) => [element.id, element]))
    const cache = new Map<string, { localStart: number; duration: number }>()
    const resolving = new Set<string>()
    function resolve(element: SceneElement): { localStart: number; duration: number } {
      const cached = cache.get(element.id)
      if (cached) return cached
      if (resolving.has(element.id)) throw new Error(`时间关联存在循环依赖：${element.id}`)
      resolving.add(element.id)
      const rule = options.timing_rules?.[element.id]?.start
      let localStart: number
      if (rule) {
        const target = resolve(siblings.get(rule.element_id)!)
        localStart = target.localStart + (rule.anchor === 'end' ? target.duration : 0) + (rule.offset ?? 0)
      } else if (element.time === 'end') {
        if (element.duration === undefined) throw new Error(`${element.id} 使用 time=end 时必须设置固定 duration`)
        localStart = parentDuration - element.duration
      } else {
        localStart = seconds(element.time ?? 0, `${element.id}.time`)
      }
      const duration = element.duration ?? Math.max(0, parentDuration - localStart)
      const resolved = { localStart, duration }
      cache.set(element.id, resolved)
      resolving.delete(element.id)
      return resolved
    }
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
      timeline.push({
        id: element.id, parentId, type: element.type,
        localStart: Number(localStart.toFixed(9)), start, end, duration,
        visibleDuration: Number((end - start).toFixed(9)), visible
      })
      if (!visible) {
        warnings.push(`${element.id} 位于 scene 可见时间范围外，不生成操作`)
        continue
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
            track_name: `template_${element.id}`, relative_index: index
          }
        })
        warnings.push(`${element.id} 文字时间与颜色已应用；字体、字号、位置和锚点尚未适配，使用后端默认布局`)
      } else {
        const originalSource = element.source
        const resolvedSource = typeof originalSource === 'string'
          ? (options.sources?.[originalSource.trim()] ?? originalSource).trim() : ''
        if (!resolvedSource) throw new Error(`${element.id} 缺少图片 source`)
        // Creatomate asset IDs are not paths and cannot be downloaded by this backend.
        if (!/^(https?:\/\/|file:\/\/|\/|[a-zA-Z]:[\\/]|\\\\)/.test(resolvedSource)) {
          throw new Error(`${element.id}.source 是素材 ID 或相对路径，请通过 sources 映射到实际图片 URL 或绝对路径`)
        }
        if (element.height !== undefined) {
          warnings.push(`${element.id}.height=${element.height} 已保留，但当前 workflow 使用后端默认图片布局`)
        }
        const index = script.length
        script.push({
          type: 'action', id: element.id, index, action_type: 'add_image',
          params: {
            image_url: resolvedSource,
            start, end, width: source.width, height: source.height,
            // Separate tracks preserve overlapping contents, even when names repeat.
            track_name: `template_${element.id}`,
            relative_index: index
          }
        })
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
