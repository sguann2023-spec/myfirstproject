import { compileSceneTemplate, type SceneElement, type SceneTemplate } from './sceneTemplate'
import type { DraftScene, DraftSegment, DraftTemplate } from './draftTemplate'
import { getDynamicInputs } from './dynamicInputs'
import type { TemplateWorkflow, WorkflowInputBinding, WorkflowStep } from './workflowTypes'
import { createSceneTimingEngine } from './sceneTiming'
import { isSceneSegment, nestedScenes } from './draftTracks'

const literal = (value: string | number) => typeof value === 'number' ? String(value) : JSON.stringify(value)
const min = (a: string, b: string) => `((${a}) if (${a}) < (${b}) else (${b}))`
const max = (a: string, b: string) => `((${a}) if (${a}) > (${b}) else (${b}))`

export function compileDynamicWorkflow(
  draft: DraftTemplate, template: SceneTemplate, defaultDuration: number
) {
  const inputs: Record<string, unknown> = {}
  const bindings: WorkflowInputBinding[] = []
  const byKey = new Map<string, WorkflowInputBinding>()
  const natives = new Map<string, DraftScene | DraftSegment>()
  const materialIds = new Map<string, string>()
  const materials = new Map(Object.values(draft.materials).flat().map((material) => [material.id, material]))
  const logicalTracks: Array<{ id: string; name: string; segments: string[] }> = []
  const visibleTimes = new Map<string, { start: string; end: string }>()
  function collect(scenes: DraftScene[]) {
    for (const scene of scenes) {
      natives.set(scene.id, scene)
      for (const track of scene.tracks) {
        logicalTracks.push({ id: track.id, name: track.name ?? track.id, segments: track.segments.map(({ id }) => id) })
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
    while (Object.hasOwn(inputs, variable) || natives.has(variable)) variable += '_'
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
  function set(value: string): string {
    const index = script.length
    const name = `${prefix}${index}`
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
  const literals = new Map<string, string>()
  function constant(value: string) {
    let variable = literals.get(value)
    if (!variable) {
      variable = `template_literal_${literals.size}`
      while (Object.hasOwn(inputs, variable) || natives.has(variable)) variable += '_'
      inputs[variable] = value
      literals.set(value, variable)
    }
    return `\${${variable}}`
  }
  function walk(
    elements: SceneElement[], parentStart: string, parentDuration: string,
    clipStart: string, clipEnd: string
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
      visibleTimes.set(element.id, { start, end })
      if (element.type === 'composition') {
        walk(element.elements!, nominalStart, local.duration, start, end)
        continue
      }
      const action = structuredClone(actions.get(element.id)!)
      const params: Record<string, unknown> = { ...action.params, start, end }
      const materialId = materialIds.get(element.id)!
      const material = materials.get(materialId)!
      const dynamicText = element.type === 'text' && byKey.has(`${materialId}.content`)
      const dynamicImage = element.type === 'image' &&
        (byKey.has(`${materialId}.remote_url`) || byKey.has(`${materialId}.path`))
      for (const [key, value] of Object.entries(action.params)) {
        if (typeof value === 'string' && !(key === 'text' && dynamicText) && !(key === 'image_url' && dynamicImage)) {
          params[key] = constant(value)
        }
      }
      if (element.type === 'text') {
        const binding = byKey.get(`${materialId}.content`)
        if (binding) {
          binding.runtime = true
          params.text = `\${${binding.variable}.text}`
        }
      } else if (dynamicImage) {
        const remote = field(`${materialId}.remote_url`, material.remote_url ?? '')
        const path = field(`${materialId}.path`, material.path ?? '')
        params.image_url = `(${remote}) if (${remote}) else (${path})`
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
  const durations: Array<{ id: string; value: string }> = [{ id: '模版', value: total }]
  function collectDurations(elements: SceneElement[]) {
    for (const element of elements) {
      if (element.auto_duration) durations.push({ id: element.id, value: timingEngine.contentDuration(element) })
      collectDurations(element.elements ?? [])
    }
  }
  collectDurations(template.elements)
  const calculations = script.filter((step) => step.type === 'set_var')
  const guards: WorkflowStep[] = durations.map(({ id, value }, index) => ({
    type: 'for', id: `${prefix}duration_guard_${index}`, index: 0, loop: [],
    loopCount: `0 if (${value}) > 0 else ${literal(`${id} 推导时长必须大于 0`)}`
  }))
  for (const track of logicalTracks) {
    const pairs: string[] = []
    for (const [index, id] of track.segments.entries()) {
      const a = visibleTimes.get(id)!
      for (const other of track.segments.slice(index + 1)) {
        const b = visibleTimes.get(other)!
        pairs.push(`not ((${a.end}) > (${a.start}) and (${b.end}) > (${b.start}) and (${a.start}) < (${b.end}) and (${b.start}) < (${a.end}))`)
      }
    }
    if (!pairs.length) continue
    // A zero-iteration loop uses the existing backend's count validation as a fail-fast guard.
    guards.push({
      type: 'for', id: `${prefix}guard_${guards.length}`, index: 0, loop: [],
      loopCount: `0 if (${pairs.join(' and ')}) else ${literal(`逻辑轨道 ${track.name}（${track.id}）存在时间重叠`)}`
    })
  }
  const execution = [...calculations, ...guards, ...script.filter((step) => step.type !== 'set_var')]
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
