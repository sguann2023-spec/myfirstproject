import { compileSceneTemplate, type SceneElement, type SceneTemplate } from './sceneTemplate'
import type { DraftScene, DraftSegment, DraftTemplate } from './draftTemplate'
import { getDynamicInputs } from './dynamicInputs'
import type { TemplateWorkflow, WorkflowInputBinding, WorkflowStep } from './workflowTypes'
import { createSceneTimingEngine } from './sceneTiming'
import { isSceneSegment, nestedScenes } from './draftTracks'
import { inputName } from './inputNames'
import { MAX_MEDIA_LOOP_ACTIONS } from './mediaLoop'
import { STICKER_TRANSFORMS } from './stickerWorkflow'
import { resourceType } from './resourceWorkflow'
import { executableKeyframes, keyframeSteps, type AnimationLayer } from './keyframeWorkflow'

const literal = (value: string | number | boolean) => typeof value === 'boolean'
  ? value ? 'True' : 'False' : typeof value === 'number' ? String(value) : JSON.stringify(value)
const min = (a: string, b: string) => `((${a}) if (${a}) < (${b}) else (${b}))`
const max = (a: string, b: string) => `((${a}) if (${a}) > (${b}) else (${b}))`
const inputFields = { text: 'text', image: 'image_url', video: 'video_url', audio: 'music_url', sticker: 'sticker_id', filter: 'filter_type', effect: 'effect_type' } as const
const has = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key)

type BatchContext = {
  fields: Map<string, { text?: string; url?: string; sticker?: string; resource?: string }>
}
type BatchItemModel = {
  defaults: Record<string, unknown>
  fields: BatchContext['fields']
  slots: Map<string, { field: string; alias: string; legacyKey: string; label: string }>
  nested: Map<string, { key: string; alias: string; label: string; model: BatchItemModel }>
}
const reference = (binding: WorkflowInputBinding) =>
  `\${${[binding.variable, ...(binding.inputPath ?? [])].join('.')}}`

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
  const sourceFields = new Map<string, string>()
  const labels = new Map<string, string>()
  function collectSourceFields(elements: SceneElement[]) {
    for (const element of elements) {
      labels.set(element.id, element.name ?? element.id)
      const materialId = materialIds.get(element.id)
      if (materialId && !labels.has(materialId)) labels.set(materialId, element.name ?? element.id)
      if (element.type === 'image' || element.type === 'video' || element.type === 'audio') {
        sourceFields.set(materialIds.get(element.id)!, inputFields[element.type])
      }
      if (element.type === 'sticker') sourceFields.set(materialIds.get(element.id)!, 'sticker_id')
      if (element.type === 'filter' || element.type === 'effect') sourceFields.set(materialIds.get(element.id)!, inputFields[element.type])
      collectSourceFields(element.elements ?? [])
    }
  }
  collectSourceFields(template.elements)
  const usedNames = new Set<string>()
  const groups = new Map<string, string>()
  const inputLabels = new Map<string, { path: string[]; label: string }>()
  function addLabel(path: string[], label: string) {
    inputLabels.set(JSON.stringify(path), { path, label })
  }
  function group(id: string, kind: string) {
    const owner = `${kind}:${id}`
    if (!groups.has(owner)) {
      const label = labels.get(id) ?? id
      const name = inputName(label, usedNames, new Set(natives.keys()))
      groups.set(owner, name)
      addLabel([name], label)
    }
    return groups.get(owner)!
  }
  // Backend resolves dots as nested access, so exported variable names must be identifiers.
  for (const input of getDynamicInputs(draft)) {
    const text = input.property === 'content' && input.type === 'string' && textMaterialIds.has(input.targetId!)
    const publicField = text ? 'text' : ['remote_url', 'path', 'sticker_id', 'resource_id', 'filter_type', 'effect_type', 'name'].includes(input.property)
      ? sourceFields.get(input.targetId!) : undefined
    const batch = input.property === 'batch_scene.items' && input.targetId
    let variable: string
    let inputPath: string[] | undefined
    if (publicField) {
      variable = group(input.targetId!, 'material')
      const value = inputs[variable] as Record<string, unknown> | undefined
      let field = publicField
      let count = 2
      while (value && has(value, field)) field = `${publicField}_${count++}`
      inputPath = [field]
    } else if (batch) {
      variable = group(input.targetId!, 'batch')
    } else {
      variable = `input_${input.key.replace(/[^a-zA-Z0-9_]/g, '_')}`
      while (usedNames.has(variable) || natives.has(variable)) variable += '_'
      usedNames.add(variable)
    }
    const encoding = text ? 'text' : 'identity'
    const value = text
      ? JSON.parse(input.defaultValue as string).text : structuredClone(input.defaultValue)
    if (inputPath) inputs[variable] = { ...(inputs[variable] as Record<string, unknown> ?? {}), [inputPath[0]]: value }
    else inputs[variable] = value
    const binding: WorkflowInputBinding = { key: input.key, variable, ...(inputPath ? { inputPath } : {}), encoding, runtime: false }
    bindings.push(binding)
    byKey.set(input.key, binding)
  }
  function field(key: string, fallback: string | number | boolean): string {
    const binding = byKey.get(key)
    if (!binding) return literal(fallback)
    binding.runtime = true
    return reference(binding)
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
  function assign(variable: string, value: string) {
    const name = variable.slice(2, -1)
    script.push({ type: 'set_var', id: `${prefix}assign_${timeVariableIndex++}`, index: script.length, name, value })
  }
  const animationCounter = set('0')
  function createTimingEngine(
    sources: Map<string, string>, singleItem?: string
  ): ReturnType<typeof createSceneTimingEngine<string>> {
    return createSceneTimingEngine<string>(template.timing_rules ?? {}, (element) => {
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
      max, store: set, validate: () => {}, validateContent: () => {},
      measureDuration: (element, measure) => {
        const source = sources.get(element.id)
        if (!source || element.id === singleItem) return measure()
        const model = batchModels.get(element.id)!
        const duration = set('0')
        const before = script.length
        const variable = set('${item}').slice(2, -1)
        const nestedSources = itemSources(sources, model, variable)
        const itemEngine = createTimingEngine(nestedSources, element.id)
        const itemDuration = itemEngine.elementDuration(element)
        if (itemDuration === undefined) throw new Error(`${element.id} 批量分镜缺少单项时长`)
        assign(duration, `(${duration}) + (${itemDuration})`)
        const loop = script.splice(before)
        script.push({
          type: 'for', id: `${prefix}measure_${timeVariableIndex++}`, index: script.length,
          in: source, loop
        })
        return duration
      }
    })
  }
  const hasAutoDuration = (elements: SceneElement[]): boolean =>
    elements.some((element) => element.auto_duration || hasAutoDuration(element.elements ?? []))
  // Compile all fixed slots, including currently hidden ones, for runtime visibility guards.
  const seed = structuredClone(template)
  function stripSeedLoops(elements: SceneElement[]) {
    for (const element of elements) {
      delete element.loop
      stripSeedLoops(element.elements ?? [])
    }
  }
  stripSeedLoops(seed.elements)
  const actions = new Map(compileSceneTemplate(seed, {}, true).workflow.script.map((action) => [action.id, action]))
  function batchItemModel(root: SceneElement, variable: string): BatchItemModel {
    const counts: Record<string, number> = {}
    const defaults: Record<string, unknown> = {}
    const fields: BatchContext['fields'] = new Map()
    const slots: BatchItemModel['slots'] = new Map()
    const nested: BatchItemModel['nested'] = new Map()
    const names = new Set<string>()
    const nextKey = (kind: typeof inputFields[keyof typeof inputFields] | 'scenes') => {
      counts[kind] = (counts[kind] ?? 0) + 1
      return counts[kind] === 1 ? kind : `${kind}_${counts[kind]}`
    }
    function collect(element: SceneElement) {
      if (element.type === 'composition') {
        const native = natives.get(element.id)
        if (native && 'batch_scene' in native && native.batch_scene && byKey.has(`${element.id}.batch_scene.items`)) {
          if (element.elements?.length !== 1 || element.elements[0].type !== 'composition') {
            throw new Error(`${element.id} 批量分镜必须有且只有一个子分镜`)
          }
          const alias = nextKey('scenes')
          const key = inputName(element.name ?? element.id, names)
          const model = batchItemModel(element.elements[0], 'item')
          defaults[key] = hydrateBatchValues((native.batch_scene as { items?: unknown }).items, model)
          nested.set(element.id, { key, alias, model, label: element.name ?? element.id })
          return
        }
        element.elements?.forEach(collect)
        return
      }
      if (element.type === 'text') {
        const key = inputName(element.name ?? element.id, names)
        slots.set(key, { field: 'text', alias: nextKey('text'), legacyKey: 'text', label: element.name ?? element.id })
        defaults[key] = { text: element.text ?? '' }
        fields.set(element.id, { text: `\${${variable}.${key}.text}` })
        return
      }
      if (element.type === 'sticker') {
        const key = inputName(element.name ?? element.id, names)
        const alias = nextKey('sticker_id')
        slots.set(key, { field: 'sticker_id', alias, legacyKey: alias.replace(/^sticker_id/, 'sticker'), label: element.name ?? element.id })
        defaults[key] = { sticker_id: element.sticker_id ?? '' }
        fields.set(element.id, { sticker: `\${${variable}.${key}.sticker_id}` })
        return
      }
      if (element.type === 'filter' || element.type === 'effect') {
        const kind = element.type
        const field = inputFields[kind]
        const key = inputName(element.name ?? element.id, names)
        const alias = nextKey(field)
        slots.set(key, { field, alias, legacyKey: kind, label: element.name ?? element.id })
        defaults[key] = { [field]: element[field] ?? '' }
        fields.set(element.id, { resource: `\${${variable}.${key}.${field}}` })
        return
      }
      if (['image', 'video', 'audio'].includes(element.type)) {
        const field = inputFields[element.type as 'image' | 'video' | 'audio']
        const alias = nextKey(field)
        const key = inputName(element.name ?? element.id, names)
        slots.set(key, { field, alias, label: element.name ?? element.id, legacyKey: alias.replace(/^music_url/, 'audio').replace(/^video_url/, 'video').replace(/^image_url/, 'image') })
        defaults[key] = { [field]: element.source ?? '' }
        fields.set(element.id, { url: `\${${variable}.${key}.${field}}` })
      }
    }
    collect(root)
    return { defaults, fields, slots, nested }
  }
  function hydrateBatchValues(current: unknown, model: BatchItemModel): Record<string, unknown>[] {
    const { defaults, slots, nested } = model
    const fieldCounts = new Map<string, number>()
    for (const { field } of slots.values()) fieldCounts.set(field, (fieldCounts.get(field) ?? 0) + 1)
    const values = Array.isArray(current) ? current : []
    if (Array.isArray(current) && !current.length) return []
    return values.length ? values.map((item) => {
      const normalized = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : {}
      // Export only slots backed by actual elements, never legacy placeholders such as image.
      const result = structuredClone(defaults)
      for (const [key, { field, alias, legacyKey, label }] of slots) {
        let sourceKey = [key, label, alias, legacyKey, ...(alias === 'text' ? ['title'] : [])].find(name => has(normalized, name))
        if (!sourceKey && fieldCounts.get(field) === 1) {
          const candidates = Object.entries(normalized).filter(([, value]) =>
            value && typeof value === 'object' && !Array.isArray(value) && has(value, field))
          if (candidates.length === 1) sourceKey = candidates[0][0]
        }
        if (!sourceKey) continue
        const source = normalized[sourceKey]
        const value = source && typeof source === 'object' && !Array.isArray(source)
          ? (source as Record<string, unknown>)[field] ?? (source as Record<string, unknown>)[field === 'text' ? 'text' : field === 'sticker_id' ? 'resource_id' : 'url']
          : source
        if (value === undefined) continue
        if (typeof value !== 'string') {
          throw new Error(`批量分镜输入 ${label} 必须是字符串`)
        }
        if (sourceKey === legacyKey && field !== 'text' && !value.trim()) continue
        result[key] = { [field]: value }
      }
      for (const { key, alias, label, model: child } of nested.values()) {
        let source = has(normalized, key) ? normalized[key] : has(normalized, label) ? normalized[label] : normalized[alias]
        if (source === undefined && nested.size === 1) {
          const arrays = Object.values(normalized).filter(Array.isArray)
          if (arrays.length === 1) source = arrays[0]
        }
        if (source !== undefined && !Array.isArray(source)) {
          throw new Error(`批量分镜输入 ${label} 必须是数组`)
        }
        if (source !== undefined) result[key] = hydrateBatchValues(source, child)
      }
      return result
    }) : [structuredClone(defaults)]
  }
  function addModelLabels(model: BatchItemModel, path: string[]) {
    for (const [key, slot] of model.slots) addLabel([...path, key], slot.label)
    for (const { key, label, model: child } of model.nested.values()) {
      addLabel([...path, key], label)
      addModelLabels(child, [...path, key, '*'])
    }
  }
  const nestedInputs = new Set<string>()
  const batchModels = new Map<string, BatchItemModel>()
  const rootSources = new Map<string, string>()
  function itemSources(sources: Map<string, string>, model: BatchItemModel, variable: string) {
    const result = new Map(sources)
    for (const [id, { key }] of model.nested) result.set(id, `\${${variable}.${key}}`)
    return result
  }
  function prepareBatches(elements: SceneElement[], inherited?: { model: BatchItemModel; rootVariable: string; path: string[] }) {
    for (const element of elements) {
      const binding = byKey.get(`${element.id}.batch_scene.items`)
      let context = inherited
      if (binding) {
        if (element.elements?.length !== 1 || element.elements[0].type !== 'composition') {
          throw new Error(`${element.id} 批量分镜必须有且只有一个子分镜`)
        }
        const model = batchItemModel(element.elements[0], 'item')
        batchModels.set(element.id, model)
        binding.runtime = true
        const nested = inherited?.model.nested.get(element.id)
        if (nested && inherited) {
          nestedInputs.add(binding.variable)
          binding.variable = inherited.rootVariable
          binding.inputPath = [...inherited.path, '*', nested.key]
        } else {
          inputs[binding.variable] = hydrateBatchValues(inputs[binding.variable], model)
          rootSources.set(element.id, `\${${binding.variable}}`)
          addModelLabels(model, [binding.variable, '*'])
        }
        context = { model, rootVariable: binding.variable, path: binding.inputPath ?? [] }
      }
      prepareBatches(element.elements ?? [], context)
    }
  }
  prepareBatches(template.elements)
  const timingEngine = createTimingEngine(rootSources)
  let total = set(draft.duration === undefined ? '0' : `(${field('duration', draft.duration)}) / 1000000`)
  if (draft.duration === undefined && (hasAutoDuration(template.elements) || rootSources.size)) {
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
  function walk(
    elements: SceneElement[], parentStart: string, parentDuration: string,
    clipStart: string, clipEnd: string, batch?: BatchContext, sources = rootSources,
    inheritedAnimations: AnimationLayer[] = []
  ) {
    const scope = createTimingEngine(sources).scope(elements, parentDuration)
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
      const groups = executableKeyframes(natives.get(element.id)!, element.type)
      const animations = groups.length ? [...inheritedAnimations, { groups, origin: nominalStart }] : inheritedAnimations
      if (element.type === 'composition') {
        const native = natives.get(element.id)
        const batchBinding = native && 'batch_scene' in native ? byKey.get(`${element.id}.batch_scene.items`) : undefined
        if (batchBinding) {
          batchBinding.runtime = true
          if ((element.elements ?? []).length !== 1 || element.elements?.[0]?.type !== 'composition') {
            throw new Error(`${element.id} 批量分镜必须有且只有一个子分镜`)
          }
          const model = batchModels.get(element.id)!
          const cursor = set(nominalStart)
          const before = script.length
          // Timing measurement and nested rendering both overwrite item/index.
          const variable = set('${item}').slice(2, -1)
          const nestedSources = itemSources(sources, model, variable)
          const itemDuration = createTimingEngine(nestedSources, element.id).elementDuration(element)!
          const fields = new Map([...model.fields].map(([id, fields]) => [id,
            Object.fromEntries(Object.entries(fields).map(([key, value]) =>
              [key, value.replace('${item.', `\${${variable}.`)]))]))
          const context: BatchContext = {
            fields
          }
          const itemStart = set(cursor)
          const itemEnd = set(`(${itemStart}) + (${itemDuration})`)
          const itemClipStart = set(min(end, max(start, itemStart)))
          const itemClipEnd = set(min(end, max(start, itemEnd)))
          // A batch wrapper's animation starts anew for each repeated scene instance.
          const itemAnimations = groups.length
            ? [...inheritedAnimations, { groups, origin: itemStart }] : inheritedAnimations
          walk(element.elements!, itemStart, itemDuration, itemClipStart, itemClipEnd, context, nestedSources, itemAnimations)
          assign(cursor, itemEnd)
          const loop = script.splice(before)
          loop.forEach((step, index) => { step.index = index })
          const index = script.length
          script.push({
            type: 'for', id: `${element.id}_batch_loop`, index,
            in: sources.get(element.id)!, loop
          })
        } else {
          walk(element.elements!, nominalStart, local.duration, start, end, batch, sources, animations)
        }
        continue
      }
      const action = structuredClone(actions.get(element.id)!)
      const params: Record<string, unknown> = { ...action.params, start, end }
      const animated = animations.length > 0 && ['image', 'video', 'text'].includes(element.type)
      const emit = (actionParams: Record<string, unknown>, visibleStart: string, visibleEnd: string): WorkflowStep[] => {
        if (!animated) return [{ ...action, index: 0, params: actionParams }]
        const before = script.length
        assign(animationCounter, `(${animationCounter}) + 1`)
        const track = set(`${literal(`template_animation_${element.id}_%s`)} % (${animationCounter})`)
        const emitted: WorkflowStep[] = script.splice(before)
        emitted.push({ ...action, index: emitted.length, params: { ...actionParams, track_name: track } })
        emitted.push(...keyframeSteps(action.id, element.type, track, animations, visibleStart, visibleEnd))
        emitted.forEach((step, index) => { step.index = index })
        return emitted
      }
      const materialId = materialIds.get(element.id)!
      const material = materials.get(materialId)!
      const dynamicSource = ['image', 'video', 'audio'].includes(element.type) &&
        (byKey.has(`${materialId}.remote_url`) || byKey.has(`${materialId}.path`))
      const batchFields = batch?.fields.get(element.id)
      if (element.type === 'filter' || element.type === 'effect') {
        const kind = element.type
        const name = `${kind}_type`
        if (batchFields?.resource) params[name] = batchFields.resource
        else if (byKey.has(`${materialId}.${name}`) || byKey.has(`${materialId}.name`)) {
          const primary = field(`${materialId}.${name}`, typeof material[name] === 'string' ? material[name] as string : '')
          const fallback = field(`${materialId}.name`, resourceType(material, kind))
          params[name] = `(${primary}) if (${primary}) else (${fallback})`
        }
        if (kind === 'filter') {
          if (byKey.has(`${materialId}.intensity`)) params.intensity = field(`${materialId}.intensity`, element.intensity ?? 100)
          else if (material.intensity === undefined && byKey.has(`${materialId}.value`)) {
            params.intensity = `(${field(`${materialId}.value`, typeof material.value === 'number' ? material.value : 1)}) * 100`
          }
        } else {
          if (byKey.has(`${materialId}.effect_category`)) params.effect_category = field(`${materialId}.effect_category`, element.effect_category ?? 'scene')
          const binding = byKey.get(`${materialId}.params`)
          if (binding) { binding.runtime = true; params.params = reference(binding) }
          if (byKey.has(`${materialId}.adjust_params`)) throw new Error(`${element.id} 动态 adjust_params 请转换为后台百分比 params 数组`)
        }
      } else if (element.type === 'sticker') {
        params.start = start
        params.end = end
        if (batchFields?.sticker) params.sticker_id = batchFields.sticker
        else if (byKey.has(`${materialId}.sticker_id`) || byKey.has(`${materialId}.resource_id`)) {
          const value = (key: string) => typeof material[key] === 'string' || typeof material[key] === 'number'
            ? material[key] as string | number : ''
          const primary = field(`${materialId}.sticker_id`, value('sticker_id'))
          const fallback = field(`${materialId}.resource_id`, value('resource_id'))
          params.sticker_id = `(${primary}) if (${primary}) != "" and (${primary}) != None else (${fallback})`
        }
        for (const [key, path, fallback] of STICKER_TRANSFORMS) {
          if (byKey.has(`${element.id}.clip.${path}`)) params[key] = field(`${element.id}.clip.${path}`, element[key] ?? fallback)
        }
      } else if (element.type === 'text') {
        const binding = byKey.get(`${materialId}.content`)
        if (batchFields?.text) {
          params.text = batchFields.text
        } else if (binding) {
          binding.runtime = true
          params.text = reference(binding)
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
        if (element.loop) {
          const native = natives.get(element.id)!
          const sourceRange = (native as DraftSegment).source_timerange
          const sourceLength = sourceRange?.duration !== undefined
            ? field(`${element.id}.source_timerange.duration`, sourceRange.duration)
            : sourceRange?.end !== undefined
              ? `(${field(`${element.id}.source_timerange.end`, sourceRange.end)}) - ((${sourceOffset}) * 1000000)`
              : typeof material.duration === 'number'
                ? `(${field(`${materialId}.duration`, material.duration)}) - ((${sourceOffset}) * 1000000)`
                : literal(element.source_duration! * 1_000_000)
          const roundMicros = (value: string) => `(((${value}) * 1000000 + 0.5) // 1)`
          const cycle = set(sourceLength)
          const visible = set(roundMicros(`(${end}) - (${start})`))
          const elapsed = set(roundMicros(`(${start}) - (${nominalStart})`))
          const phase = set(`(${elapsed}) % (${cycle}) if (${cycle}) > 0 else 0`)
          const count = set(`((${visible}) + (${phase}) + (${cycle}) - 1) // (${cycle}) if (${cycle}) > 0 else 0`)
          const before = script.length
          const offset = set(`(${phase}) if \${index} == 0 else 0`)
          const consumed = set(`0 if \${index} == 0 else (${cycle}) - (${phase}) + (\${index} - 1) * (${cycle})`)
          const part = set(min(`(${visible}) - (${consumed})`, `(${cycle}) - (${offset})`))
          const partStart = set(`(${start}) + (${consumed}) / 1000000`)
          const partEnd = set(`(${partStart}) + (${part}) / 1000000`)
          script.push(...emit({ ...params,
              target_start: partStart,
              start: `(${sourceOffset}) + (${offset}) / 1000000`,
              end: `(${sourceOffset}) + ((${offset}) + (${part})) / 1000000`,
              duration: `(${part}) / 1000000`
            }, partStart, partEnd))
          const loop = script.splice(before)
          loop.forEach((step, index) => { step.index = index })
          script.push({
            type: 'if', id: `${prefix}media_visible_${timeVariableIndex++}`, index: script.length,
            condition: `(${end}) > (${start})`,
            then: [{
              type: 'for', id: `${prefix}media_loop_${timeVariableIndex++}`, index: 0,
              loopCount: `(${count}) if (${cycle}) > 0 and (${count}) <= ${MAX_MEDIA_LOOP_ACTIONS} else "媒体循环源时长无效或次数超过10000"`,
              loop
            }]
          })
          continue
        }
      }
      const index = script.length
      action.index = 0
      script.push({
        type: 'if', id: `${prefix}visible_${index}`, index,
        condition: `(${end}) > (${start})`,
        then: emit(params, start, end)
      })
    }
  }
  walk(template.elements, '0', total, '0', total)
  for (const variable of nestedInputs) delete inputs[variable]
  const activeVariables = new Set(bindings.filter(binding => binding.runtime).map(binding => binding.variable))
  for (const variable of Object.keys(inputs)) if (!activeVariables.has(variable)) delete inputs[variable]
  for (const binding of bindings) if (!binding.runtime && binding.inputPath?.length === 1 && has(inputs, binding.variable)) {
    delete (inputs[binding.variable] as Record<string, unknown>)[binding.inputPath[0]]
  }
  // Measurement loops must run before the calculations/actions that consume their totals.
  const execution = script
  execution.forEach((step, index) => { step.index = index })
  const workflow: TemplateWorkflow = {
    width: draft.canvas_config.width, height: draft.canvas_config.height, inputs,
    input_labels: [...inputLabels.values()].filter(item => has(inputs, item.path[0])),
    script: execution
  }
  return {
    workflow, workflowInputBindings: bindings,
    warnings: bindings.filter((binding) => !binding.runtime).map((binding) =>
      `${binding.key} 已列入 Workflow inputs，但仅编译时应用；修改该输入需重新编译（结构数组、画布或未适配字段）`)
  }
}
