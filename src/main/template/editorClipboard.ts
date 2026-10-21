import { randomUUID } from 'node:crypto'
import { parseEditorDocument, type EditorPayload } from './editorModel'
import { isSceneSegment, nestedScenes } from './draftTracks'
import type { DraftMaterial, DraftScene, DraftTemplate, DraftTrack, DraftTrackItem } from './draftTemplate'

const FORMAT = 'vectcut-template-elements'
type Entry = { item: DraftScene | DraftTrackItem | DraftTrack; kind: 'scene' | 'segment' | 'track'; scene?: DraftScene }
type Time = { id: string; localStart: number; duration: number }
export interface PasteEditorAction {
  type: 'paste'
  id: string | null
  scopeId?: string | null
  clipboard?: string
}

function entries(draft: DraftTemplate) {
  const result = new Map<string, Entry>()
  function visit(scene: DraftScene, parent?: DraftScene) {
    result.set(scene.id, { item: scene, kind: 'scene', scene: parent })
    for (const track of scene.tracks) {
      result.set(track.id, { item: track, kind: 'track', scene })
      for (const segment of track.segments) {
        if (isSceneSegment(segment)) visit(segment, scene)
        else result.set(segment.id, { item: segment, kind: 'segment', scene })
      }
    }
    for (const child of scene.scenes ?? []) visit(child, scene)
  }
  draft.scenes.forEach(scene => visit(scene))
  return result
}

function walk(value: unknown, visit: (object: Record<string, any>) => void) {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) { value.forEach(child => walk(child, visit)); return }
  const object = value as Record<string, any>
  visit(object)
  Object.values(object).forEach(child => walk(child, visit))
}

export function copyEditorElement(payload: EditorPayload, id: string) {
  const { draft } = parseEditorDocument(payload)
  if (!draft || !entries(draft).has(id)) throw new Error('请选择要复制的元素或分镜')
  // The snapshot survives source edits/deletion and can be pasted into another editor window.
  return JSON.stringify({ format: FORMAT, version: 1, id, templateJson: JSON.stringify(draft) })
}

export function pasteEditorElement(draft: DraftTemplate, times: Time[], action: PasteEditorAction) {
  let snapshot: { format?: string; version?: number; id?: string; templateJson?: string }
  try { snapshot = JSON.parse(action.clipboard ?? '') } catch { throw new Error('请先复制模版元素') }
  if (!snapshot || snapshot.format !== FORMAT || snapshot.version !== 1 ||
      typeof snapshot.id !== 'string' || typeof snapshot.templateJson !== 'string') {
    throw new Error('剪贴板中没有可粘贴的模版元素')
  }
  const source = parseEditorDocument({ templateJson: snapshot.templateJson })
  if (!source.draft || !source.normalized) throw new Error('剪贴板模版格式不支持')
  const entry = entries(source.draft).get(snapshot.id)
  if (!entry) throw new Error('剪贴板元素不存在')
  const item = structuredClone(entry.item)
  const names = new Map<string, string>()
  walk(source.normalized.template.elements, object => {
    if (typeof object.id === 'string' && typeof object.name === 'string') names.set(object.id, object.name)
  })
  walk(item, object => {
    if (object.target_timerange && !object.name) object.name = names.get(object.id) ?? object.id
  })
  const ids = new Map<string, string>()
  walk(item, object => { if (typeof object.id === 'string') ids.set(object.id, randomUUID()) })
  const contentIds = new Set(ids.keys())
  const sourceTimes = new Map(source.normalized.analysis.timeline.map(time => [time.id, time]))
  const materialIds = new Set<string>()
  const collectMaterials = (value: unknown) => walk(value, object => {
    if (typeof object.material_id === 'string') materialIds.add(object.material_id)
    for (const key of ['extra_material_refs', 'keyframe_refs']) {
      if (Array.isArray(object[key])) object[key].forEach((id: string) => materialIds.add(id))
    }
  })
  collectMaterials(item)
  const materials: Array<{ bucket: string; material: DraftMaterial }> = []
  const copiedMaterials = new Set<string>()
  // Include referenced auxiliary materials, without copying unrelated library entries.
  for (const id of materialIds) {
    const found = Object.entries(source.draft.materials).flatMap(([bucket, values]) =>
      values.filter(material => material.id === id).map(material => ({ bucket, material })))
    for (const value of found) {
      if (copiedMaterials.has(id)) continue
      copiedMaterials.add(id)
      const material = structuredClone(value.material)
      materials.push({ bucket: value.bucket, material })
      walk(material, object => { if (typeof object.id === 'string') ids.set(object.id, randomUUID()) })
      collectMaterials(material)
    }
  }
  walk(item, object => {
    const time = sourceTimes.get(object.id)
    if (!time || !object.auto_timing) return
    const range = object.target_timerange
    for (const side of ['start', 'end']) {
      const anchor = object.auto_timing[side]
      if (!anchor || anchor.target === 'parent' || contentIds.has(anchor.target)) continue
      // External timing links become resolved defaults; internal links are remapped below.
      anchor.target = 'parent'
      anchor.anchor = 'start'
      anchor.offset = Math.round((time.localStart + (side === 'end' ? time.duration : 0)) * 1_000_000)
      if (side === 'start') range.start = Math.round(time.localStart * 1_000_000)
      else {
        range.duration = Math.round(time.duration * 1_000_000)
        if (range.end !== undefined) range.end = (range.start ?? 0) + range.duration
      }
    }
  })
  const remap = (value: unknown) => walk(value, object => {
    for (const [key, child] of Object.entries(object)) {
      if (typeof child === 'string' && (key === 'id' || key === 'target' || key.endsWith('_id'))) {
        object[key] = ids.get(child) ?? child
      } else if (['extra_material_refs', 'keyframe_refs'].includes(key) && Array.isArray(child)) {
        object[key] = child.map(id => ids.get(id) ?? id)
      }
    }
  })
  remap(item)
  for (const { bucket, material } of materials) {
    remap(material)
    draft.materials[bucket] ??= []
    draft.materials[bucket].push(material)
  }

  const destination = entries(draft)
  const selected = action.id ? destination.get(action.id) : undefined
  if (action.id && !selected) throw new Error('粘贴目标不存在')
  let scene = selected?.scene
  if (selected?.kind === 'scene' && entry.kind !== 'scene') scene = selected.item as DraftScene
  if (!selected && action.scopeId) {
    const scope = destination.get(action.scopeId)
    if (!scope || scope.kind !== 'scene') throw new Error('粘贴分镜不存在')
    scene = scope.item as DraftScene
  }
  if (!scene && (selected?.kind !== 'scene') && entry.kind !== 'scene') scene = draft.scenes[0]
  if (!scene && entry.kind !== 'scene') throw new Error('请先创建分镜')
  if (scene?.batch_scene !== undefined) {
    const wrapper = scene
    scene = nestedScenes(wrapper)[0]
    if (!scene) throw new Error('批量分镜缺少子分镜')
    if (wrapper.auto_duration) {
      scene.auto_duration = true
      delete scene.target_timerange.end
      if (scene.auto_timing) delete scene.auto_timing.end
    }
  }
  if (!scene) {
    const pasted = item as DraftScene
    const start = Math.round(Math.max(0, ...draft.scenes.map(value => {
      const time = times.find(time => time.id === value.id)
      return time ? time.localStart + time.duration : 0
    })) * 1_000_000)
    const duration = Math.round((sourceTimes.get(snapshot.id)?.duration ?? 5) * 1_000_000)
    pasted.target_timerange.start = start
    if (!pasted.auto_duration) pasted.target_timerange.duration = duration
    if (pasted.dynamic?.includes('target_timerange.end')) pasted.target_timerange.end = start + duration
    else delete pasted.target_timerange.end
    if (pasted.auto_timing?.start) pasted.auto_timing.start = { target: 'parent', anchor: 'start', offset: start }
    if (pasted.auto_timing?.end) pasted.auto_timing.end = { target: 'parent', anchor: 'start', offset: start + duration }
    draft.scenes.push(pasted)
    if (draft.duration !== undefined) draft.duration = Math.max(draft.duration, start + duration)
  } else {
    const relative = Math.max(-1, ...scene.tracks.map((track, index) => track.track_relative_index ?? index)) + 1
    if (entry.kind === 'track') {
      const track = item as DraftTrack
      track.track_relative_index = relative
      scene.tracks.push(track)
    } else {
      const segment = item as DraftTrackItem
      if (entry.kind === 'scene') (segment as DraftScene & { type: string }).type = 'scene'
      scene.tracks.push({ id: randomUUID(), name: item.name ?? '轨道', type: 'mixed',
        track_relative_index: relative, segments: [segment] })
    }
  }
  return item.id
}
