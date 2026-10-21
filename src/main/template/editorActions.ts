import { parseEditorDocument, type EditorPayload } from './editorModel'
import { normalizeDraftTemplate, type DraftScene, type DraftSegment, type DraftTrack, type DraftTrackItem } from './draftTemplate'
import { isSceneSegment, nestedScenes, orderedSceneTracks } from './draftTracks'
import { dropEditorClip, dropEditorClipIntoScene, type ClipDropAction, type ClipSceneDropAction } from './editorClipDrop'
import { setEditorClipTiming, type ClipTimingAction } from './editorClipTiming'
import { mediaDurationMicros } from '../../shared/templateMediaTiming'
import { pasteEditorElement, type PasteEditorAction } from './editorClipboard'
import { dropEditorLayer, type LayerDropAction } from './editorLayerDrop'

export type EditorAction =
  | ClipDropAction
  | ClipSceneDropAction
  | ClipTimingAction
  | { type: 'clip-loop'; id: string; enabled: boolean }
  | PasteEditorAction
  | LayerDropAction
  | { type: 'rename'; id: string; name: string }
  | { type: 'delete'; id: string }
  | { type: 'retime'; id: string; start: number; duration: number; edge?: 'start' | 'end'; trackId?: string }
  | { type: 'reorder-track'; id: string; beforeId: string }
  | { type: 'duration'; id: string | null; duration: number | 'auto' }

// All visual edits are transactional: normalize the copy before returning any JSON.
export function applyEditorAction(payload: EditorPayload, action: EditorAction) {
  const { draft, normalized } = parseEditorDocument(payload)
  if (!draft || !normalized) throw new Error('交互编辑仅支持剪映结构模版')
  type Entry = { item: DraftScene | DraftTrackItem; scene?: DraftScene; track?: DraftTrack; remove: () => void }
  const entries = new Map<string, Entry>()
  const tracks = new Map<string, { track: DraftTrack; scene: DraftScene }>()
  function collect(scenes: DraftScene[], parent?: DraftScene) {
    for (const scene of scenes) {
      entries.set(scene.id, { item: scene, scene: parent, remove: () => scenes.splice(scenes.indexOf(scene), 1) })
      collectTracks(scene)
      collect(scene.scenes ?? [], scene)
    }
  }
  function collectTracks(scene: DraftScene) {
    for (const track of scene.tracks) {
      tracks.set(track.id, { track, scene })
      for (const item of track.segments) {
        entries.set(item.id, { item, scene, track, remove: () => track.segments.splice(track.segments.indexOf(item), 1) })
        if (isSceneSegment(item)) {
          collectTracks(item)
          collect(item.scenes ?? [], item)
        }
      }
    }
  }
  collect(draft.scenes)
  const times = new Map(normalized.analysis.timeline.map(item => [item.id, item]))
  const enableBatchContentDuration = (scene?: DraftScene) => {
    if (!scene) return
    const wrapper = entries.get(scene.id)?.scene
    if (!wrapper?.auto_duration || wrapper.batch_scene === undefined) return
    scene.auto_duration = true
    delete scene.target_timerange.end
    if (scene.auto_timing) delete scene.auto_timing.end
    if (scene.auto_timing && !Object.keys(scene.auto_timing).length) delete scene.auto_timing
  }
  const micros = (value: number, positive = false) => {
    const result = Math.round(value * 1_000_000)
    if (!Number.isFinite(value) || !Number.isSafeInteger(result) || (positive ? result <= 0 : result < 0)) {
      throw new Error(positive ? '时长必须大于 0' : '开始时间必须为非负数')
    }
    return result
  }
  const autoDurationFallbacks: Array<{ scene: DraftScene; duration: number }> = []
  const rememberAutoDurationFallback = (scene?: DraftScene) => {
    if (!scene?.auto_duration || autoDurationFallbacks.some(item => item.scene === scene)) return
    const duration = Math.max(1, Math.round((times.get(scene.id)?.duration ?? 5) * 1_000_000))
    autoDurationFallbacks.push({ scene, duration })
  }
  const repairFollowersBeforeDelete = (item: DraftScene | DraftTrackItem, siblings: Array<DraftScene | DraftTrackItem>) => {
    const time = times.get(item.id)
    if (!time) return
    const predecessor = siblings.filter(sibling => sibling.id !== item.id && times.has(sibling.id))
      .filter(sibling => times.get(sibling.id)!.localStart + times.get(sibling.id)!.duration <= time.localStart)
      .sort((a, b) => times.get(b.id)!.localStart - times.get(a.id)!.localStart)[0]
    const followers = siblings.filter(sibling => sibling.auto_timing?.start?.target === item.id)
    for (const follower of followers) {
      if (predecessor) follower.auto_timing!.start = { target: predecessor.id, anchor: 'end' }
      else {
        delete follower.auto_timing!.start
        follower.target_timerange.start = 0
      }
      if (!follower.auto_timing!.start && !follower.auto_timing!.end) delete follower.auto_timing
    }
  }
  let selectedId = action.id ?? ''
  if (action.type === 'paste') {
    selectedId = pasteEditorElement(draft, normalized.analysis.timeline, action)
  } else if (action.type === 'duration') {
    const duration = action.duration === 'auto' ? undefined : micros(action.duration, true)
    if (action.id === null) {
      if (duration === undefined) delete draft.duration
      else draft.duration = duration
    } else {
      const item = entries.get(action.id)?.item
      if (!item || !('tracks' in item)) throw new Error('请选择分镜')
      const scene = item as DraftScene
      scene.auto_duration = duration === undefined
      if (duration !== undefined) scene.target_timerange.duration = duration
      delete scene.target_timerange.end
      if (scene.auto_timing) delete scene.auto_timing.end
      if (scene.auto_timing && !Object.keys(scene.auto_timing).length) delete scene.auto_timing
      if (duration === undefined && scene.batch_scene !== undefined) {
        enableBatchContentDuration(nestedScenes(scene)[0])
      }
    }
  } else if (action.type === 'move-layer') {
    dropEditorLayer(draft, times, action, rememberAutoDurationFallback)
  } else if (action.type === 'reorder-track') {
    const from = tracks.get(action.id)
    const to = tracks.get(action.beforeId)
    if (!from || !to || from.scene !== to.scene) throw new Error('只能调整同一分镜内的轨道层级')
    const ordered = orderedSceneTracks(from.scene).map(({ track }) => track)
    const a = ordered.indexOf(from.track)
    const b = ordered.indexOf(to.track)
    ordered.splice(a, 1)
    ordered.splice(b, 0, from.track)
    ordered.forEach((track, index) => { track.track_relative_index = ordered.length - index - 1 })
  } else if (action.type === 'rename') {
    const item = entries.get(action.id)?.item ?? tracks.get(action.id)?.track
    if (!item) throw new Error('元素不存在')
    if (typeof action.name !== 'string' || !action.name.trim()) throw new Error('名称不能为空')
    item.name = action.name.trim()
  } else if (action.type === 'delete') {
    const entry = entries.get(action.id)
    const track = tracks.get(action.id)
    rememberAutoDurationFallback(entry?.scene)
    if (entry && 'tracks' in entry.item) rememberAutoDurationFallback(entry.item as DraftScene)
    rememberAutoDurationFallback(track?.scene)
    if (entry) {
      repairFollowersBeforeDelete(entry.item, entry.track?.segments ?? entry.scene?.scenes ?? draft.scenes)
      entry.remove(); selectedId = entry.scene?.id ?? ''
    }
    else if (track) {
      track.scene.tracks.splice(track.scene.tracks.indexOf(track.track), 1)
      selectedId = track.scene.id
    } else throw new Error('元素不存在')
  } else if (action.type === 'clip-loop') {
    const entry = entries.get(action.id)
    const time = times.get(action.id)
    if (!entry || !time || !['video', 'audio'].includes(time.type) || typeof action.enabled !== 'boolean') {
      throw new Error('循环仅支持音频和视频')
    }
    const material = Object.values(draft.materials).flat().find(material => material.id === entry.item.material_id)
    if (action.enabled && mediaDurationMicros(entry.item as DraftSegment, material) === undefined) {
      throw new Error('媒体循环需要有效的源时长')
    }
    entry.item.loop = action.enabled
  } else if (action.type === 'clip-timing') {
    const entry = entries.get(action.id)
    const time = times.get(action.id)
    if (!entry || !time) throw new Error('元素不存在')
    const siblings = entry.track?.segments ?? (entry.scene?.scenes ?? draft.scenes)
    const previous = siblings.filter(item => item.id !== action.id && times.has(item.id))
      .filter(item => times.get(item.id)!.localStart < time.localStart)
      .sort((a, b) => times.get(b.id)!.localStart - times.get(a.id)!.localStart)[0]
    const material = Object.values(draft.materials).flat().find(material => material.id === entry.item.material_id)
    const mediaDuration = ['video', 'audio'].includes(time.type)
      ? mediaDurationMicros(entry.item as DraftSegment, material) : undefined
    setEditorClipTiming(entry.item, action, time, previous?.id, mediaDuration)
    enableBatchContentDuration(entry.scene)
    if ('tracks' in entry.item && entry.item.batch_scene !== undefined && entry.item.auto_duration) {
      enableBatchContentDuration(nestedScenes(entry.item as DraftScene)[0])
    }
  } else if (action.type === 'move-clip') {
    const entry = entries.get(action.id)
    if (!entry?.track || !entry.scene) throw new Error('跨轨移动仅限当前分镜')
    dropEditorClip(entry.scene, entry.track, entry.item as DraftTrackItem, times, action)
  } else if (action.type === 'move-into-scene') {
    const entry = entries.get(action.id)
    const targetEntry = entries.get(action.sceneId)
    if (!entry || !targetEntry || !('tracks' in targetEntry.item)) throw new Error('目标分镜不存在')
    let target = targetEntry.item as DraftScene
    let { start } = action
    if (target.batch_scene !== undefined) {
      // Batch scenes are wrappers whose tracks may only hold the single child scene.
      const children = nestedScenes(target)
      if (children.length !== 1) throw new Error('批量分镜必须有且只有一个子分镜')
      const batchTime = times.get(target.id)
      if (!batchTime || !times.has(children[0].id)) throw new Error('目标分镜不存在')
      target = children[0]
      start -= batchTime.localStart
    }
    if (action.id === target.id) throw new Error('不能移入分镜自身')
    for (let ancestor = entries.get(target.id)?.scene; ancestor; ancestor = entries.get(ancestor.id)?.scene) {
      if (ancestor.id === action.id) throw new Error('不能移入其内部嵌套的分镜')
    }
    rememberAutoDurationFallback(entry.scene)
    rememberAutoDurationFallback(targetEntry.item as DraftScene)
    rememberAutoDurationFallback(target)
    if ('tracks' in entry.item) rememberAutoDurationFallback(entry.item as DraftScene)
    dropEditorClipIntoScene(entry.item as DraftTrackItem,
      { track: entry.track, scene: entry.scene, scenes: entry.scene?.scenes ?? draft.scenes }, target, times,
      { ...action, sceneId: target.id, start })
  } else if (action.type === 'retime') {
    const entry = entries.get(action.id)
    const time = times.get(action.id)
    if (!entry || !time) throw new Error('元素不存在')
    const { item } = entry
    const start = micros(action.start)
    const duration = micros(action.duration, true)
    const oldStart = Math.round(time.localStart * 1_000_000)
    const oldEnd = Math.round((time.localStart + time.duration) * 1_000_000)
    const range = item.target_timerange
    const startDelta = start - oldStart
    const endDelta = start + duration - oldEnd
    if (action.edge === 'end' && startDelta !== 0) throw new Error('调整右端不能改变开始时间')
    if (!action.edge && Math.abs(duration - Math.round(time.duration * 1_000_000)) > 1) {
      throw new Error('移动片段不能改变时长')
    }
    if (action.edge === 'start' && Math.abs(endDelta) > 1) throw new Error('调整左端不能改变结束时间')
    if (action.edge !== 'end') {
      range.start = start
      if (item.auto_timing) delete item.auto_timing.start
    }
    if (action.edge) {
      if (item.auto_timing) delete item.auto_timing.end
      if ('tracks' in item) (item as DraftScene).auto_duration = false
    }
    if (item.auto_timing?.end) item.auto_timing.end.offset = (item.auto_timing.end.offset ?? 0) + endDelta
    else if (range.end !== undefined) range.end = start + duration
    else if (!(item as DraftScene).auto_duration || action.edge) range.duration = duration
    if (range.duration !== undefined || (item.auto_timing?.end && !item.auto_timing.start)) range.duration = duration
    if (range.end !== undefined && range.duration !== undefined) range.end = (range.start ?? 0) + duration
    if (action.edge === 'start' && ['video', 'audio'].includes(time.type)) {
      const source = (item as DraftSegment).source_timerange ??= { start: 0 }
      const sourceStart = (source.start ?? 0) + startDelta
      if (sourceStart < 0) throw new Error('不能向素材起点之前扩展')
      if (source.end !== undefined && sourceStart >= source.end) throw new Error('裁切后没有剩余源区间')
      source.start = sourceStart
      if (source.duration !== undefined) source.duration -= startDelta
    }
    if (action.edge) delete item.duration_mode
    if (item.auto_timing && !Object.keys(item.auto_timing).length) delete item.auto_timing
    enableBatchContentDuration(entry.scene)
    if (action.trackId && action.trackId !== entry.track?.id) {
      const target = tracks.get(action.trackId)
      if (!entry.track || !target || target.scene !== entry.scene) throw new Error('跨轨移动仅限当前分镜')
      entry.remove()
      target.track.segments.push(item as DraftTrackItem)
      target.track.type = 'mixed'
    }
  } else {
    throw new Error('不支持的编辑操作')
  }
  try {
    normalizeDraftTemplate(draft)
  } catch (error) {
    if (!autoDurationFallbacks.length || !(error instanceof Error) || !error.message.includes('无法从内部内容推导时长')) throw error
    for (const { scene, duration } of autoDurationFallbacks) {
      if (!scene.auto_duration) continue
      scene.auto_duration = false
      scene.target_timerange.duration = duration
      delete scene.target_timerange.end
      if (scene.auto_timing) delete scene.auto_timing.end
      if (scene.auto_timing && !Object.keys(scene.auto_timing).length) delete scene.auto_timing
    }
    normalizeDraftTemplate(draft)
  }
  return { templateJson: JSON.stringify(draft, null, 2), selectedId }
}
