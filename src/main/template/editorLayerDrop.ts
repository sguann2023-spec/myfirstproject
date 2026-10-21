import { randomUUID } from 'node:crypto'
import type { DraftScene, DraftSceneSegment, DraftTemplate, DraftTrack, DraftTrackItem } from './draftTemplate'
import { nestedScenes, orderedSceneTracks } from './draftTracks'

export interface LayerDropAction {
  type: 'move-layer'
  id: string
  targetId: string
  placement: 'before' | 'after' | 'inside'
}
type Item = DraftScene | DraftTrackItem
type Entry = { item: Item; scene?: DraftScene; track?: DraftTrack; list: Item[] }
type Time = { localStart: number; duration: number }

// Directory moves change visual hierarchy, not source trims or timeline positions.
export function dropEditorLayer(
  draft: DraftTemplate, times: Map<string, Time>, action: LayerDropAction,
  rememberFallback: (scene?: DraftScene) => void
) {
  const entries = new Map<string, Entry>()
  function collect(list: Item[], scene?: DraftScene, track?: DraftTrack) {
    for (const item of list) {
      entries.set(item.id, { item, scene, track, list })
      if ('tracks' in item) {
        const child = item as DraftScene
        for (const childTrack of child.tracks) collect(childTrack.segments, child, childTrack)
        collect(child.scenes ?? [], child)
      }
    }
  }
  collect(draft.scenes)
  const from = entries.get(action.id)
  const to = entries.get(action.targetId)
  if (!from || !to || from === to) throw new Error('请选择有效的拖动目标')
  if (!['before', 'after', 'inside'].includes(action.placement)) throw new Error('无效的目录插入位置')
  let targetScene = to.scene
  if (action.placement === 'inside') {
    if (!('tracks' in to.item)) throw new Error('只能拖入分镜')
    targetScene = to.item as DraftScene
    if (targetScene.batch_scene !== undefined) {
      const children = nestedScenes(targetScene)
      if (children.length !== 1) throw new Error('批量分镜必须有且只有一个子分镜')
      targetScene = children[0]
    }
  }
  for (let ancestor = targetScene; ancestor; ancestor = entries.get(ancestor.id)?.scene) {
    if (ancestor.id === from.item.id) throw new Error('不能移入自身或内部嵌套的分镜')
  }
  if (from.scene?.batch_scene !== undefined) throw new Error('不能移走批量分镜的唯一子分镜')
  if (!targetScene && !('tracks' in from.item)) throw new Error('根层只能放置分镜')
  if (targetScene?.batch_scene !== undefined) throw new Error('批量分镜内只能保留唯一子分镜')
  rememberFallback(from.scene)
  rememberFallback(targetScene)

  if (from.scene !== targetScene) {
    const freezeAnchor = (item: Item, side: 'start' | 'end') => {
      const time = times.get(item.id)
      if (!time) throw new Error('元素时间不存在')
      delete item.auto_timing![side]
      if (side === 'start') item.target_timerange.start = Math.round(time.localStart * 1_000_000)
      else {
        item.target_timerange.end = Math.round((time.localStart + time.duration) * 1_000_000)
        delete item.target_timerange.duration
      }
      if (!Object.keys(item.auto_timing!).length) delete item.auto_timing
    }
    // Sibling references cannot cross the new scene boundary; pin their resolved times.
    for (const entry of entries.values()) {
      if (entry.scene !== from.scene || entry.item === from.item) continue
      for (const side of ['start', 'end'] as const) {
        if (entry.item.auto_timing?.[side]?.target === from.item.id) freezeAnchor(entry.item, side)
      }
    }
    for (const side of ['start', 'end'] as const) {
      const anchor = from.item.auto_timing?.[side]
      if (anchor && anchor.target !== 'parent') freezeAnchor(from.item, side)
    }
  }

  const sourceTrack = from.track
  const sourceWholeTrack = sourceTrack && sourceTrack.segments.length === 1
  from.list.splice(from.list.indexOf(from.item), 1)
  if (sourceTrack && !sourceTrack.segments.length) {
    from.scene!.tracks.splice(from.scene!.tracks.indexOf(sourceTrack), 1)
  }
  if (!targetScene) {
    const position = draft.scenes.indexOf(to.item as DraftScene)
    draft.scenes.splice(position + (action.placement === 'after' ? 1 : 0), 0, from.item as DraftScene)
  } else if (action.placement !== 'inside' && !to.track && 'tracks' in from.item) {
    const list = targetScene.scenes ??= []
    const position = list.indexOf(to.item as DraftScene)
    list.splice(position + (action.placement === 'after' ? 1 : 0), 0, from.item as DraftScene)
  } else {
    const ordered = orderedSceneTracks(targetScene).map(({ track }) => track)
    if (action.placement !== 'inside' && !to.track) {
      // Legacy loose scenes need track containers to interleave with media rows.
      for (const scene of targetScene.scenes ?? []) {
        const track: DraftTrack = { id: randomUUID(), name: scene.name ?? '分镜', type: 'mixed', segments: [] }
        ;(scene as DraftSceneSegment).type = 'scene'
        track.segments.push(scene as DraftSceneSegment)
        ordered.push(track)
        if (scene === to.item) to.track = track
      }
      targetScene.scenes = []
    }
    if ('tracks' in from.item) (from.item as DraftSceneSegment).type = 'scene'
    const newTrack: DraftTrack = sourceWholeTrack ? sourceTrack : {
      id: randomUUID(), name: from.item.name ?? '轨道', type: 'mixed', segments: []
    }
    newTrack.segments = [from.item as DraftTrackItem]
    if (action.placement === 'inside') ordered.push(newTrack)
    else {
      const targetTrack = to.track!
      const clips = [...targetTrack.segments].sort((a, b) =>
        (times.get(a.id)?.localStart ?? 0) - (times.get(b.id)?.localStart ?? 0))
      const boundary = clips.indexOf(to.item as DraftTrackItem) + (action.placement === 'after' ? 1 : 0)
      const position = ordered.indexOf(targetTrack)
      if (boundary === 0) ordered.splice(position, 0, newTrack)
      else if (boundary === clips.length) ordered.splice(position + 1, 0, newTrack)
      else {
        targetTrack.segments = clips.slice(0, boundary)
        const tail: DraftTrack = { ...targetTrack, id: randomUUID(), segments: clips.slice(boundary) }
        ordered.splice(position + 1, 0, newTrack, tail)
      }
    }
    targetScene.tracks = ordered
    ordered.forEach((track, index) => { track.track_relative_index = ordered.length - index - 1 })
  }
  for (const scene of new Set([from.scene, targetScene])) {
    if (!scene) continue
    orderedSceneTracks(scene).forEach(({ track }, index, tracks) => {
      track.track_relative_index = tracks.length - index - 1
    })
  }
}
