import { compileSceneTemplate, type SceneElement, type SceneTemplate } from './sceneTemplate'
import type { DraftScene, DraftSegment, DraftTemplate } from './draftTemplate'
import { getDynamicInputs } from './dynamicInputs'
import type { TemplateWorkflow, WorkflowInputBinding, WorkflowStep } from './workflowTypes'
import { createSceneTimingEngine } from './sceneTiming'
import { isSceneSegment, nestedScenes } from './draftTracks'

const literal = (value: string | number) => typeof value === 'number' ? String(value) : JSON.stringify(value)
const min = (a: string, b: string) => `((${a}) if (${a}) < (${b}) else (${b}))`
const max = (a: string, b: string) => `((${a}) if (${a}) > (${b}) else (${b}))`

type BatchContext = {
  variable: string
  fields: Map<string, { text?: string; fontColor?: string; url?: string }>
}

function mergeObjectDefaults(defaults: Record<string, unknown>, value: unknown): Record<string, unknown> {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const result: Record<string, unknown> = structuredClone(defaults)
  for (const [key, item] of Object.entries(source)) {
    const base = result[key]
    result[key] = base && typeof base === 'object' && !Array.isArray(base) && item && typeof item === 'object' && !Array.isArray(item)
      ? { ...base as Record<string, unknown>, ...item as Record<string, unknown> }
      : structuredClone(item)
  }
  return result
}

export function compileDynamicWorkflow(
  draft: DraftTemplate, template: SceneTemplate, defaultDuration: number
) {
  const inputs: Record<string, unknown> = {}
  const bindings: WorkflowInputBinding[] = []
  const byKey = new Map<string, WorkflowInputBinding>()
  const natives = new Map<string, DraftScene | DraftSegment>()
  const materialIds = new Map<string, string>()
  const materials = new Map(Object.values(draft.materials).flat().map((material) => [material.id, material]))
  function collect(scenes: DraftScene[]) {
    for (const scene of scenes) {
      natives.set(scene.id, scene)
      for (const track of scene.tracks) {
        for (const segment of track.segments) {
          if (isSceneSegment(segment)) continue
          natives.set(segment.id, segment)
          materialIds.set(segment.id, segment.material_id)
        }
      }
      collect(nestedScenes(scene))
    }
  }
  collect(draft.scenes)
  const textMaterialIds = new Set((draft.materials.texts ?? []).map((material) => material.id))
  // Backend resolves dots as nested access, so exported variable names must be identifiers.
  for (const input of getDynamicInputs(draft)) {
    let variable = `input_${input.key.replace(/[^a-zA-Z0-9_]/g, '_')}`
    while (Object.prototype.hasOwnProperty.call(inputs, variable) || natives.has(variable)) variable += '_'
    const encoding = input.property === 'content' && input.type === 'string' && textMaterialIds.has(input.targetId!)
      ? 'json' : 'identity'
    inputs[variable] = encoding === 'json'
      ? JSON.parse(input.defaultValue as string) : structuredClone(input.defaultValue)
    const binding: WorkflowInputBinding = { key: input.key, variable, encoding, runtime: false }
    bindings.push(binding)
    byKey.set(input.key, binding)
  }
  function field(key: string, fallback: string | number): string {
    const binding = byKey.get(key)
    if (!binding) return literal(fallback)
    binding.runtime = true
    return `\${${binding.variable}}`
  }
  function seconds(id: string, path: string, fallback: number) {
    return `(${field(`${id}.${path}`, fallback * 1_000_000)}) / 1000000`
  }
  let prefix = '__template_time_'
  while ([...natives.keys(), ...Object.keys(inputs)].some((id) => id.startsWith(prefix))) prefix += '_'
  const script: WorkflowStep[] = []
  let timeVariableIndex = 0
  function set(value: string): string {
    const index = script.length
    const name = `${prefix}${timeVariableIndex++}`
    script.push({ type: 'set_var', id: name, index, name, value })
    return `\${${name}}`
  }
  const timingEngine = createSceneTimingEngine<string>(template.timing_rules ?? {}, (element) => {
    const native = natives.get(element.id)!
    const auto = native.auto_timing
    let start = element.target_start_time === undefined ? undefined :
      auto?.start?.target === 'parent'
        ? seconds(element.id, 'auto_timing.start.offset', (auto.start.offset ?? 0) / 1_000_000)
        : seconds(element.id, 'target_timerange.start', element.target_start_time)
    if (auto?.end && !auto.start) start = undefined
    const end = typeof element.target_end_time !== 'number' ? undefined :
      auto?.end?.target === 'parent'
        ? seconds(element.id, 'auto_timing.end.offset', element.target_end_time)
        : seconds(element.id, 'target_timerange.end', element.target_end_time)
    return {
      start, end, endAtParent: element.target_end_time === 'end',
      duration: element.duration === undefined ? undefined : seconds(element.id, 'target_timerange.duration', element.duration),
      offset: (anchor, side) => seconds(element.id, `auto_timing.${side}.offset`, anchor.offset ?? 0)
    }
  }, {
    value: String, add: (a, b) => `(${a}) + (${b})`, subtract: (a, b) => `(${a}) - (${b})`,
    max, store: set, validate: () => {}, validateContent: () => {}
  })
  const hasAutoDuration = (elements: SceneElement[]): boolean =>
    elements.some((element) => element.auto_duration || hasAutoDuration(element.elements ?? []))
  let total = set(draft.duration === undefined ? '0' : `(${field('duration', draft.duration)}) / 1000000`)
  if (draft.duration === undefined && hasAutoDuration(template.elements)) {
    const root = timingEngine.scope(template.elements)
    for (const element of template.elements) {
      const time = root.resolve(element)!
      total = set(max(total, `(${time.localStart}) + (${time.duration})`))
    }
  } else if (draft.duration === undefined) {
    for (const element of template.elements) {
      const end = typeof element.target_end_time === 'number'
        ? seconds(element.id, 'target_timerange.end', element.target_end_time)
        : `(${seconds(element.id, 'target_timerange.start', element.target_start_time ?? 0)}) + (${seconds(element.id, 'target_timerange.duration', element.duration ?? defaultDuration)})`
      total = set(max(total, end))
    }
  }
  // Compile all fixed slots, including currently hidden ones, for runtime visibility guards.
  const actions = new Map(compileSceneTemplate(template, {}, true).workflow.script.map((action) => [action.id, action]))
  function batchItemModel(root: SceneElement, variable: string) {
    const counts: Record<string, number> = {}
    const defaults: Record<string, Record<string, unknown>> = {}
    const fields = new Map<string, { text?: string; fontColor?: string; url?: string }>()
    const nextKey = (kind: 'text' | 'image' | 'video' | 'audio') => {
      counts[kind] = (counts[kind] ?? 0) + 1
      return counts[kind] === 1 ? kind : `${kind}_${counts[kind]}`
    }
    function collect(element: SceneElement) {
      if (element.type === 'composition') {
        element.elements?.forEach(collect)
        return
      }
      if (element.type === 'text') {
        const key = nextKey('text')
        defaults[key] = { text: element.text ?? '', font_color: element.fill_color ?? '#ffffff' }
        fields.set(element.id, { text: `\${${variable}.${key}.text}`, fontColor: `\${${variable}.${key}.font_color}` })
        return
      }
      if (['image', 'video', 'audio'].includes(element.type)) {
        const key = nextKey(element.type as 'image' | 'video' | 'audio')
        defaults[key] = { url: element.source ?? '' }
        fields.set(element.id, { url: `\${${variable}.${key}.url}` })
      }
    }
    collect(root)
    return { defaults, fields }
  }
  function hydrateBatchInput(variable: string, defaults: Record<string, Record<string, unknown>>) {
    const current = inputs[variable]
    const values = Array.isArray(current) ? current : []
    inputs[variable] = values.length ? values.map((item) => {
      const normalized = item && typeof item === 'object' && !Array.isArray(item)
        ? { ...item as Record<string, unknown> } : {}
      if (typeof normalized.title === 'string' && defaults.text && !normalized.text) {
        normalized.text = { ...defaults.text, text: normalized.title }
        delete normalized.title
      }
      if (typeof normalized.image === 'string' && defaults.image) {
        if (normalized.image.trim()) normalized.image = { ...defaults.image, url: normalized.image }
        else delete normalized.image
      }
      for (const key of Object.keys(defaults)) {
        const value = normalized[key]
        if (value && typeof value === 'object' && !Array.isArray(value) && 'url' in value && !(value as Record<string, unknown>).url) {
          const { url: _url, ...rest } = value as Record<string, unknown>
          normalized[key] = rest
        }
      }
      return mergeObjectDefaults(defaults, normalized)
    }) : [structuredClone(defaults)]
  }
  function walk(
    elements: SceneElement[], parentStart: string, parentDuration: string,
    clipStart: string, clipEnd: string, batch?: BatchContext
  ) {
    const scope = timingEngine.scope(elements, parentDuration)
    function resolve(element: SceneElement): { start: string; duration: string } {
      const timing = scope.resolve(element)!
      return { start: timing.localStart, duration: timing.duration }
    }
    elements.forEach(resolve)
    const ordered = [...elements].sort((a, b) =>
      (a.track_relative_index ?? (a.track ?? 1) - 1) - (b.track_relative_index ?? (b.track ?? 1) - 1))
    for (const element of ordered) {
      const local = resolve(element)
      const nominalStart = set(`(${parentStart}) + (${local.start})`)
      const start = set(min(clipEnd, max(clipStart, nominalStart)))
      const end = set(max(start, min(clipEnd, `(${nominalStart}) + (${local.duration})`)))
      if (element.type === 'composition') {
        const native = natives.get(element.id)
        const batchBinding = native && 'batch_scene' in native ? byKey.get(`${element.id}.batch_scene.items`) : undefined
        if (batchBinding) {
          batchBinding.runtime = true
          if ((element.elements ?? []).length !== 1 || element.elements?.[0]?.type !== 'composition') {
            throw new Error(`${element.id} 批量分镜必须有且只有一个子分镜`)
          }
          const variable = 'item'
          const model = batchItemModel(element.elements[0], variable)
          hydrateBatchInput(batchBinding.variable, model.defaults)
          const before = script.length
          const itemStart = set(`(${nominalStart}) + (${variable === 'item' ? '${index}' : '0'}) * (${local.duration})`)
          const itemEnd = set(`(${itemStart}) + (${local.duration})`)
          walk(element.elements!, itemStart, local.duration, itemStart, itemEnd, { variable, fields: model.fields })
          const loop = script.splice(before)
          const index = script.length
          script.push({
            type: 'for', id: `${element.id}_batch_loop`, index,
            in: `\${${batchBinding.variable}}`, loop
          })
        } else {
          walk(element.elements!, nominalStart, local.duration, start, end, batch)
        }
        continue
      }
      const action = structuredClone(actions.get(element.id)!)
      const params: Record<string, unknown> = { ...action.params, start, end }
      const materialId = materialIds.get(element.id)!
      const material = materials.get(materialId)!
      const dynamicSource = ['image', 'video', 'audio'].includes(element.type) &&
        (byKey.has(`${materialId}.remote_url`) || byKey.has(`${materialId}.path`))
      const batchFields = batch?.fields.get(element.id)
      if (element.type === 'text') {
        const binding = byKey.get(`${materialId}.content`)
        if (batchFields?.text) {
          params.text = batchFields.text
          if (batchFields.fontColor) params.font_color = batchFields.fontColor
        } else if (binding) {
          binding.runtime = true
          params.text = `\${${binding.variable}.text}`
        }
      } else if (batchFields?.url) {
        if (element.type === 'image') params.image_url = batchFields.url
        if (element.type === 'video') params.video_url = batchFields.url
        if (element.type === 'audio') params.audio_url = batchFields.url
      } else if (dynamicSource) {
        const remote = field(`${materialId}.remote_url`, material.remote_url ?? '')
        const path = field(`${materialId}.path`, material.path ?? '')
        const source = `(${remote}) if (${remote}) else (${path})`
        if (element.type === 'image') params.image_url = source
        if (element.type === 'video') params.video_url = source
        if (element.type === 'audio') params.audio_url = source
      }
      if (element.type === 'audio' || element.type === 'video') {
        const sourceOffset = seconds(element.id, 'source_timerange.start', element.source_start_time ?? 0)
        params.target_start = start
        params.start = `(${sourceOffset}) + (${start}) - (${nominalStart})`
        params.end = `(${sourceOffset}) + (${end}) - (${nominalStart})`
        if (element.type === 'video') params.duration = `(${end}) - (${start})`
      }
      const index = script.length
      action.index = 0
      script.push({
        type: 'if', id: `${prefix}visible_${index}`, index,
        condition: `(${end}) > (${start})`,
        then: [{ ...action, params }]
      })
    }
  }
  walk(template.elements, '0', total, '0', total)
  for (const binding of bindings) {
    if (!binding.runtime) delete inputs[binding.variable]
  }
  const calculations = script.filter((step) => step.type === 'set_var')
  const execution = [...calculations, ...script.filter((step) => step.type !== 'set_var')]
  execution.forEach((step, index) => { step.index = index })
  const workflow: TemplateWorkflow = {
    width: draft.canvas_config.width, height: draft.canvas_config.height, inputs, script: execution
  }
  return {
    workflow, workflowInputBindings: bindings,
    warnings: bindings.filter((binding) => !binding.runtime).map((binding) =>
      `${binding.key} 已列入 Workflow inputs，但仅编译时应用；修改该输入需重新编译（结构数组、画布或未适配字段）`)
  }
}
