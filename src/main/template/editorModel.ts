import { randomUUID } from 'node:crypto'
import {
  analyzeSceneTemplate, compileSceneTemplate,
  type SceneCompileOptions, type SceneElement, type SceneTemplate
} from './sceneTemplate'
import { compileDraftTemplate, normalizeDraftTemplate, type DraftTemplate, type DraftScene, type DraftMaterial } from './draftTemplate'

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
}

export type EditorAddType = 'text' | 'image' | 'video' | 'audio' | 'sticker' | 'filter' | 'effect'

export function parseEditorDocument(payload: EditorPayload) {
  const raw = JSON.parse(payload.templateJson)
  const draft = raw && ('scenes' in raw || 'canvas_config' in raw) ? raw as DraftTemplate : undefined
  const template = draft ? normalizeDraftTemplate(draft).template : raw as SceneTemplate
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
  return { template, config, draft }
}

export interface EditorTreeNode {
  id: string
  name: string
  type: SceneElement['type'] | 'track'
  text?: string
  children: EditorTreeNode[]
}

export function analyzeEditorDocument(payload: EditorPayload) {
  const { template, config, draft } = parseEditorDocument(payload)
  const analysis = analyzeSceneTemplate(template, config)
  const byId = new Map(analysis.timeline.map((item) => [item.id, item]))
  const rows: Array<{
    id: string; name: string; track: number; lanes: number
    clips: Array<{ id: string; name: string; type: SceneElement['type']; start: number; end: number; lane: number }>
  }> = []
  function build(elements: SceneElement[], parent = '模版', parentId = 'root'): EditorTreeNode[] {
    const groups = new Map<string, typeof rows[number]>()
    const order = (element: SceneElement) => element.track_relative_index ?? (element.track ?? 1) - 1
    const sorted = [...elements].sort((a, b) => order(a) - order(b))
    for (const element of sorted) {
      if (element.type === 'composition') continue
      const timing = byId.get(element.id)
      const track = order(element)
      const key = element.track_name ?? `${parentId}:${element.track ?? 1}:${element.type}`
      const group = groups.get(key) ?? { id: `${parentId}:${key}`, name: element.track_name ?? parent, track, lanes: 1, clips: [] }
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
          ...scene.tracks.map((track): EditorTreeNode => ({
            id: track.id, name: track.name ?? track.id, type: 'track',
            children: track.segments.map((segment) => {
              const element = normalized.get(segment.id)!
              return { id: segment.id, name: element.name ?? segment.id, type: element.type, text: element.text, children: [] }
            })
          })),
          ...sceneTree(scene.scenes ?? [])
        ]
      }))
    }
    tree = sceneTree(draft.scenes)
  }
  return { ...analysis, tree, rows }
}

export function compileEditorDocument(payload: EditorPayload) {
  const { template, config, draft } = parseEditorDocument(payload)
  return draft ? compileDraftTemplate(draft) : compileSceneTemplate(template, config)
}

export function addEditorElement(
  payload: EditorPayload,
  input: { type: EditorAddType; selectedId?: string; source?: string }
) {
  const { template, config, draft } = parseEditorDocument(payload)
  analyzeSceneTemplate(template, config)
  if (!['text', 'image', 'video', 'audio', 'sticker', 'filter', 'effect'].includes(input.type)) throw new Error('不支持的素材类型')
  if (draft) {
    let target: DraftScene | undefined
    function findScene(scenes: DraftScene[]) {
      for (const scene of scenes) {
        if (scene.id === input.selectedId || scene.tracks.some((track) =>
          track.id === input.selectedId || track.segments.some((segment) => segment.id === input.selectedId))) target = scene
        findScene(scene.scenes ?? [])
      }
    }
    findScene(draft.scenes)
    target ??= draft.scenes[0]
    if (!target) {
      target = { id: randomUUID(), name: 'Scene', target_timerange: { start: 0, duration: draft.duration ?? 10_000_000 }, tracks: [] }
      draft.scenes.push(target)
    }
    const resource = ['sticker', 'filter', 'effect'].includes(input.type)
    const labels: Record<EditorAddType, string> = {
      text: '文字', image: '图片', video: '视频', audio: '音频', sticker: '贴纸', filter: '滤镜', effect: '特效'
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
    target.tracks.push({ id: randomUUID(), name: labels[input.type], type: bucket === 'videos' ? 'video' : input.type,
      segments: [{ id, name: labels[input.type], material_id: material.id, target_timerange: { start: 0 },
        ...(['video', 'audio'].includes(input.type) ? { source_timerange: { start: 0 } } : {}) }] })
    normalizeDraftTemplate(draft)
    return { templateJson: JSON.stringify(draft, null, 2), selectedId: id }
  }
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
