import { randomUUID } from 'node:crypto'
import {
  analyzeSceneTemplate, compileSceneTemplate,
  type SceneCompileOptions, type SceneElement, type SceneTemplate
} from './sceneTemplate'
import { compileDraftTemplate, normalizeDraftTemplate, type DraftTemplate, type DraftScene, type DraftMaterial, type DraftTrackItem } from './draftTemplate'
import { applyDynamicInputs, getDynamicInputs } from './dynamicInputs'
import { isSceneSegment, nestedScenes, orderedSceneTracks } from './draftTracks'

export const legacyEditorTemplate: SceneTemplate = {
  width: 720, height: 1280,
  timing_rules: {
    'image-1': {
      start: { element_id: 'text-2', anchor: 'start' },
      end: { element_id: 'text-2', anchor: 'end' }
    }
  },
  elements: [{
    id: 'scene-1', name: 'Scene-Q58', type: 'composition', duration: 21.6308,
    elements: [
      { id: 'text-1', name: 'Text-P79', type: 'text', track_name: 'text_main', track_relative_index: 0, target_start_time: 1.6308,
        duration: 7.653, text: 'Your text here', fill_color: '#939393' },
      { id: 'text-2', name: 'Text-8L9', type: 'text', track_name: 'text_main', track_relative_index: 0, target_start_time: 9.2838,
        text: 'Your text here', fill_color: '#939393' },
      { id: 'image-1', name: 'Image-TSS', type: 'image', track_name: 'image_main', track_relative_index: 0,
        duration: 7.653, source: '/Users/sunguannan/Downloads/tmp4uu0of5p.png' }
    ]
  }]
}

export const editorInitialTemplate: DraftTemplate = {
  canvas_config: { width: 720, height: 1280 }, duration: 21_630_800,
  materials: {
    videos: [{ id: 'photo-material', type: 'photo', path: '/Users/sunguannan/Downloads/tmp4uu0of5p.png' }],
    texts: [
      { id: 'title-1', type: 'text', content: JSON.stringify({ text: 'Your text here' }) },
      { id: 'title-2', type: 'text', content: JSON.stringify({ text: 'Your text here' }) }
    ],
    audios: []
  },
  scenes: [{
    id: 'scene-1', name: 'Scene-Q58', target_timerange: { start: 0, duration: 21_630_800 },
    tracks: [
      { id: 'text_main', type: 'text', segments: [
        { id: 'text-1', name: 'Text-P79', material_id: 'title-1', target_timerange: { start: 1_630_800, duration: 7_653_000 } },
        { id: 'text-2', name: 'Text-8L9', material_id: 'title-2', target_timerange: { start: 9_283_800 } }
      ] },
      { id: 'image_main', type: 'video', segments: [
        { id: 'image-1', name: 'Image-TSS', material_id: 'photo-material',
          target_timerange: { duration: 7_653_000 },
          auto_timing: {
            start: { target: 'text-2', anchor: 'start' },
            end: { target: 'text-2', anchor: 'end' }
          } }
      ] }
    ]
  }]
}

export interface EditorPayload {
  templateJson: string
  configJson?: string
  modifications?: Record<string, unknown>
}

export type EditorAddType = 'scene' | 'text' | 'image' | 'video' | 'audio' | 'sticker' | 'filter' | 'effect'

export function parseEditorDocument(payload: EditorPayload) {
  const raw = JSON.parse(payload.templateJson)
  const isDraft = raw && typeof raw === 'object' && ('scenes' in raw || 'canvas_config' in raw)
  if (!isDraft && payload.modifications !== undefined) throw new Error('dynamic 输入仅支持剪映结构模版')
  const dynamicInputs = isDraft ? getDynamicInputs(raw) : []
  const draft = isDraft ? (payload.modifications === undefined ? raw as DraftTemplate
    : applyDynamicInputs(raw, payload.modifications)) : undefined
  const normalized = draft ? normalizeDraftTemplate(draft) : undefined
  const template = normalized?.template ?? raw as SceneTemplate
  const config = JSON.parse(payload.configJson ?? '{}') as SceneCompileOptions
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('关联配置必须是 JSON 对象')
  for (const key of Object.keys(config)) {
    if (!['sources', 'timing_rules'].includes(key)) throw new Error(`不支持的关联配置字段：${key}`)
  }
  for (const key of ['sources', 'timing_rules'] as const) {
    const value = config[key]
    if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) {
      throw new Error(`${key} 必须是对象`)
    }
  }
  if (Object.values(config.sources ?? {}).some((value) => typeof value !== 'string')) {
    throw new Error('素材映射的值必须是字符串')
  }
  if (draft && Object.keys(config).length) throw new Error('新模版的自动对齐写在 auto_timing 中，不使用独立关联配置')
  return { template, config, draft, dynamicInputs, normalized }
}

export interface EditorTreeNode {
  id: string
  name: string
  type: SceneElement['type'] | 'track'
  text?: string
  trackIndex?: number
  children: EditorTreeNode[]
}

export function analyzeEditorDocument(payload: EditorPayload) {
  const { template, config, draft, dynamicInputs, normalized: draftModel } = parseEditorDocument(payload)
  const analysis = draftModel?.analysis ?? analyzeSceneTemplate(template, config)
  const logicalTracks = new Map(draftModel?.logicalTracks.map((logical) => [logical.track.id, logical]))
  const byId = new Map(analysis.timeline.map((item) => [item.id, item]))
  const rows: Array<{
    id: string; name: string; track: number; lanes: number; sceneName?: string; rank: number; types: SceneElement['type'][]
    clips: Array<{ id: string; name: string; type: SceneElement['type']; start: number; end: number; lane: number }>
  }> = []
  function build(elements: SceneElement[], parent = '模版', parentId = 'root'): EditorTreeNode[] {
    const groups = new Map<string, typeof rows[number]>()
    const order = (element: SceneElement) => element.track_relative_index ?? (element.track ?? 1) - 1
    const sorted = [...elements].sort((a, b) => order(a) - order(b))
    for (const element of sorted) {
      if (element.type === 'composition' && (!draft || !element.track_name)) continue
      const timing = byId.get(element.id)
      const track = order(element)
      const key = element.track_name ?? `${parentId}:${element.track ?? 1}:${element.type}`
      const logical = logicalTracks.get(key)
      const group = groups.get(key) ?? { id: logical?.track.id ?? `${parentId}:${key}`,
        name: logical?.track.name ?? element.track_name ?? parent, track, lanes: 1,
        rank: logical?.rank ?? track, sceneName: logical?.sceneName, types: [], clips: [] }
      if (!group.types.includes(element.type)) group.types.push(element.type)
      if (timing?.visible) {
        let lane = 0
        while (group.clips.some((clip) => clip.lane === lane && clip.start < timing.end && clip.end > timing.start)) lane++
        group.clips.push({ id: element.id, name: element.name || element.id, type: element.type,
          start: timing.start, end: timing.end, lane })
        group.lanes = Math.max(group.lanes, lane + 1)
      }
      groups.set(key, group)
    }
    rows.push(...[...groups.values()].sort((a, b) => b.track - a.track))
    return sorted.map((element) => ({
      id: element.id, name: element.name || element.id, type: element.type, text: element.text,
      children: element.type === 'composition' ? build(element.elements!, element.name || element.id, element.id) : []
    }))
  }
  let tree = build(template.elements)
  if (draft) {
    const normalized = new Map<string, SceneElement>()
    function collect(elements: SceneElement[]) {
      for (const element of elements) {
        normalized.set(element.id, element)
        if (element.elements) collect(element.elements)
      }
    }
    collect(template.elements)
    function sceneTree(scenes: DraftScene[]): EditorTreeNode[] {
      return scenes.map((scene) => ({
        id: scene.id, name: scene.name ?? scene.id, type: 'composition',
        children: [
          ...orderedSceneTracks(scene).map(({ track, order }): EditorTreeNode => ({
            id: track.id, name: track.name ?? track.id, type: 'track',
            trackIndex: order,
            children: [...track.segments].sort((a, b) =>
              (byId.get(a.id)?.localStart ?? 0) - (byId.get(b.id)?.localStart ?? 0)).map((segment) => {
              if (isSceneSegment(segment)) return sceneTree([segment])[0]
              const element = normalized.get(segment.id)!
              return { id: segment.id, name: element.name ?? segment.id, type: element.type, text: element.text, children: [] }
            })
          })),
          ...sceneTree(scene.scenes ?? [])
        ]
      }))
    }
    tree = sceneTree(draft.scenes)
    for (const logical of draftModel!.logicalTracks) {
      if (!rows.some((row) => row.id === logical.track.id)) rows.push({
        id: logical.track.id, name: logical.track.name ?? logical.track.id, track: logical.order,
        rank: logical.rank, sceneName: logical.sceneName, types: [], lanes: 1, clips: []
      })
    }
    rows.sort((a, b) => b.rank - a.rank)
  }
  return { ...analysis, tree, rows, dynamicInputs }
}

export function compileEditorDocument(payload: EditorPayload) {
  const { template, config, draft, dynamicInputs } = parseEditorDocument(payload)
  if (draft) return { ...compileDraftTemplate(draft), dynamicInputs }
  return { ...compileSceneTemplate(template, config), dynamicInputs, workflowInputBindings: [], workflowTracks: [] }
}

export function addEditorElement(
  payload: EditorPayload,
  input: { type: EditorAddType; selectedId?: string; source?: string; atRoot?: boolean }
) {
  const { template, config, draft, normalized } = parseEditorDocument(payload)
  const analysis = normalized?.analysis ?? analyzeSceneTemplate(template, config)
  if (!['scene', 'text', 'image', 'video', 'audio', 'sticker', 'filter', 'effect'].includes(input.type)) throw new Error('不支持的素材类型')
  if (draft) {
    if (input.type === 'scene' && input.atRoot) {
      const start = Math.round(Math.max(0, ...analysis.timeline.filter(item => item.parentId === null)
        .map(item => item.localStart + item.duration)) * 1_000_000)
      const scene: DraftScene = { id: randomUUID(), name: 'Scene',
        target_timerange: { start, duration: 5_000_000 }, tracks: [] }
      draft.scenes.push(scene)
      if (draft.duration !== undefined) draft.duration = Math.max(draft.duration, start + 5_000_000)
      normalizeDraftTemplate(draft)
      return { templateJson: JSON.stringify(draft, null, 2), selectedId: scene.id }
    }
    let target: DraftScene | undefined
    function findScene(scenes: DraftScene[]) {
      for (const scene of scenes) {
        if (scene.id === input.selectedId || scene.tracks.some((track) =>
          track.id === input.selectedId || track.segments.some((segment) => segment.id === input.selectedId))) target = scene
        findScene(nestedScenes(scene))
      }
    }
    findScene(draft.scenes)
    target ??= draft.scenes[0]
    if (!target) {
      target = { id: randomUUID(), name: 'Scene', target_timerange: { start: 0, duration: draft.duration ?? 10_000_000 }, tracks: [] }
      draft.scenes.push(target)
    }
    const selectedTrack = target.tracks.find((track) => track.id === input.selectedId)
    let start = 0
    if (selectedTrack) {
      const byId = new Map(analysis.timeline.map((element) => [element.id, element]))
      start = Math.round(Math.max(0, ...selectedTrack.segments.map((segment) => {
        const timing = byId.get(segment.id)
        return timing ? timing.localStart + timing.duration : 0
      })) * 1_000_000)
      const sceneDuration = byId.get(target.id)?.duration ?? 0
      if (!target.auto_duration && start >= Math.round(sceneDuration * 1_000_000)) {
        throw new Error('选中轨道没有剩余时间，请先缩短已有片段或延长 Scene')
      }
    }
    const resource = ['sticker', 'filter', 'effect'].includes(input.type)
    const labels: Record<EditorAddType, string> = {
      scene: 'Scene', text: '文字', image: '图片', video: '视频', audio: '音频', sticker: '贴纸', filter: '滤镜', effect: '特效'
    }
    function insert(segment: DraftTrackItem) {
      if (selectedTrack) {
        selectedTrack.type = 'mixed'
        selectedTrack.segments.push(segment)
      } else {
        target!.tracks.push({ id: randomUUID(), name: labels[input.type], type: 'mixed',
          track_relative_index: Math.max(-1, ...target!.tracks.map((track, index) => track.track_relative_index ?? index)) + 1,
          segments: [segment] })
      }
      normalizeDraftTemplate(draft!)
      return { templateJson: JSON.stringify(draft, null, 2), selectedId: segment.id }
    }
    if (input.type === 'scene') {
      return insert({ id: randomUUID(), name: 'Scene', type: 'scene',
        target_timerange: { start, duration: 5_000_000 }, tracks: [] })
    }
    if (!resource && input.type !== 'text' && !input.source?.trim()) throw new Error('请选择素材文件')
    const material: DraftMaterial = { id: randomUUID(),
      type: input.type === 'image' ? 'photo' : input.type === 'effect' ? 'video_effect' : input.type,
      ...(input.type === 'text' ? { content: JSON.stringify({ text: 'Your text here' }) } :
        resource ? { name: labels[input.type], resource_id: '',
          ...(input.type === 'sticker' ? { sticker_id: '' } : { effect_id: '', value: 1 }) } :
          { path: input.source!.trim() }) }
    const bucket = ({ text: 'texts', image: 'videos', video: 'videos', audio: 'audios',
      sticker: 'stickers', filter: 'effects', effect: 'video_effects' })[input.type]
    draft.materials[bucket] ??= []
    draft.materials[bucket].push(material)
    const id = randomUUID()
    const segment = { id, name: labels[input.type], material_id: material.id,
      target_timerange: { start, ...(target.auto_duration ? { duration: 5_000_000 } : {}) },
      ...(['video', 'audio'].includes(input.type) ? { source_timerange: { start: 0 } } : {}) }
    return insert(segment)
  }
  if (input.type === 'scene') throw new Error('轨道内嵌套 Scene 请使用新的剪映结构模版')
  if (['sticker', 'filter', 'effect'].includes(input.type)) throw new Error('贴纸、滤镜和特效请使用新的剪映结构模版')
  let target: SceneElement | undefined
  function find(elements: SceneElement[], parent?: SceneElement) {
    for (const element of elements) {
      if (element.id === input.selectedId) target = element.type === 'composition' ? element : parent
      if (element.elements) find(element.elements, element)
    }
  }
  find(template.elements)
  target ??= template.elements.find((element) => element.type === 'composition')
  if (!target) {
    target = { id: randomUUID(), name: 'Scene', type: 'composition', duration: template.duration ?? 10, elements: [] }
    template.elements.push(target)
  }
  if (input.type !== 'text' && !input.source?.trim()) throw new Error('请选择素材文件')
  const prefix = { text: 'Text', image: 'Image', video: 'Video', audio: 'Audio' }[input.type as 'text' | 'image' | 'video' | 'audio']
  const element: SceneElement = {
    id: randomUUID(), name: `${prefix}-${(target.elements!.length + 1).toString().padStart(2, '0')}`,
    type: input.type, track_name: `${prefix.toLowerCase()}_${randomUUID()}`,
    target_start_time: 0,
    ...(['video', 'audio'].includes(input.type) ? { source_start_time: 0 } : {}),
    track_relative_index: Math.max(-1, ...target.elements!.filter((item) => item.type === input.type)
      .map((item) => item.track_relative_index ?? (item.track ?? 1) - 1)) + 1,
    ...(input.type === 'text' ? { text: 'Your text here', fill_color: '#939393' } : { source: input.source!.trim() })
  }
  target.elements!.push(element)
  return { templateJson: JSON.stringify(template, null, 2), selectedId: element.id }
}
