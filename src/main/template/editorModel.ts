import { randomUUID } from 'node:crypto'
import {
  analyzeSceneTemplate, compileSceneTemplate,
  type SceneCompileOptions, type SceneElement, type SceneTemplate
} from './sceneTemplate'

export const editorInitialTemplate: SceneTemplate = {
  width: 720, height: 1280,
  elements: [{
    id: 'scene-1', name: 'Scene-Q58', type: 'composition', duration: 21.6308,
    fill_color: '#333333',
    elements: [
      { id: 'text-1', name: 'Text-P79', type: 'text', track: 1, time: 1.6308,
        duration: 7.653, text: 'Your text here', fill_color: '#939393' },
      { id: 'text-2', name: 'Text-8L9', type: 'text', track: 1, time: 9.2838,
        text: 'Your text here', fill_color: '#939393' },
      { id: 'image-1', name: 'Image-TSS', type: 'image', track: 2, time: 'end',
        duration: 7.653, source: '/Users/sunguannan/Downloads/tmp4uu0of5p.png' }
    ]
  }]
}

export interface EditorPayload {
  templateJson: string
  configJson: string
}

export function parseEditorDocument(payload: EditorPayload) {
  const template = JSON.parse(payload.templateJson) as SceneTemplate
  const config = JSON.parse(payload.configJson) as SceneCompileOptions
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
  return { template, config }
}

export interface EditorTreeNode {
  id: string
  name: string
  type: SceneElement['type']
  text?: string
  children: EditorTreeNode[]
}

export function analyzeEditorDocument(payload: EditorPayload) {
  const { template, config } = parseEditorDocument(payload)
  const analysis = analyzeSceneTemplate(template, config)
  const byId = new Map(analysis.timeline.map((item) => [item.id, item]))
  const rows: Array<{
    id: string; name: string; track: number; lanes: number
    clips: Array<{ id: string; name: string; type: SceneElement['type']; start: number; end: number; lane: number }>
  }> = []
  function build(elements: SceneElement[], parent = '模版', parentId = 'root'): EditorTreeNode[] {
    const groups = new Map<number, typeof rows[number]>()
    const sorted = [...elements].sort((a, b) => (a.track ?? 1) - (b.track ?? 1))
    for (const element of sorted) {
      if (element.type === 'composition') continue
      const timing = byId.get(element.id)
      const track = element.track ?? 1
      const group = groups.get(track) ?? { id: `${parentId}:${track}`, name: parent, track, lanes: 1, clips: [] }
      if (timing?.visible) {
        let lane = 0
        while (group.clips.some((clip) => clip.lane === lane && clip.start < timing.end && clip.end > timing.start)) lane++
        group.clips.push({ id: element.id, name: element.name || element.id, type: element.type,
          start: timing.start, end: timing.end, lane })
        group.lanes = Math.max(group.lanes, lane + 1)
      }
      groups.set(track, group)
    }
    rows.push(...[...groups.values()].sort((a, b) => b.track - a.track))
    return sorted.map((element) => ({
      id: element.id, name: element.name || element.id, type: element.type, text: element.text,
      children: element.type === 'composition' ? build(element.elements!, element.name || element.id, element.id) : []
    }))
  }
  const tree = build(template.elements)
  return { ...analysis, tree, rows }
}

export function compileEditorDocument(payload: EditorPayload) {
  const { template, config } = parseEditorDocument(payload)
  return compileSceneTemplate(template, config)
}

export function addEditorElement(
  payload: EditorPayload,
  input: { type: 'text' | 'image' | 'video' | 'audio'; selectedId?: string; source?: string }
) {
  const { template, config } = parseEditorDocument(payload)
  analyzeSceneTemplate(template, config)
  if (!['text', 'image', 'video', 'audio'].includes(input.type)) throw new Error('不支持的素材类型')
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
  const prefix = { text: 'Text', image: 'Image', video: 'Video', audio: 'Audio' }[input.type]
  const element: SceneElement = {
    id: randomUUID(), name: `${prefix}-${(target.elements!.length + 1).toString().padStart(2, '0')}`,
    type: input.type, track: Math.max(0, ...target.elements!.map((item) => item.track ?? 1)) + 1,
    ...(input.type === 'text' ? { text: 'Your text here', fill_color: '#939393' } : { source: input.source!.trim() })
  }
  target.elements!.push(element)
  return { templateJson: JSON.stringify(template, null, 2), selectedId: element.id }
}
