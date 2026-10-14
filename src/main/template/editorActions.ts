import { parseEditorDocument, type EditorPayload } from './editorModel'
import { normalizeDraftTemplate, type DraftScene, type DraftSegment, type DraftTrack, type DraftTrackItem } from './draftTemplate'
import { isSceneSegment, orderedSceneTracks } from './draftTracks'

export type EditorAction =
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
  const micros = (value: number, positive = false) => {
    const result = Math.round(value * 1_000_000)
    if (!Number.isFinite(value) || !Number.isSafeInteger(result) || (positive ? result <= 0 : result < 0)) {
      throw new Error(positive ? '时长必须大于 0' : '开始时间必须为非负数')
    }
    return result
  }
  let selectedId = action.id ?? ''
  if (action.type === 'duration') {
    const duration = action.duration === 'auto' ? undefined : micros(action.duration, true)
    if (action.id === null) {
      if (duration === undefined) delete draft.duration
      else draft.duration = duration
    } else {
      const item = entries.get(action.id)?.item
      if (!item || !('tracks' in item)) throw new Error('请选择 Scene')
      const scene = item as DraftScene
      scene.auto_duration = duration === undefined
      if (duration !== undefined) scene.target_timerange.duration = duration
      delete scene.target_timerange.end
      if (scene.auto_timing) delete scene.auto_timing.end
      if (scene.auto_timing && !Object.keys(scene.auto_timing).length) delete scene.auto_timing
    }
  } else if (action.type === 'reorder-track') {
    const from = tracks.get(action.id)
    const to = tracks.get(action.beforeId)
    if (!from || !to || from.scene !== to.scene) throw new Error('只能调整同一 Scene 内的轨道层级')
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
    if (entry) { entry.remove(); selectedId = entry.scene?.id ?? '' }
    else if (track) {
      track.scene.tracks.splice(track.scene.tracks.indexOf(track.track), 1)
      selectedId = track.scene.id
    } else throw new Error('元素不存在')
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
      if (item.auto_timing?.start) item.auto_timing.start.offset = (item.auto_timing.start.offset ?? 0) + startDelta
      else range.start = start
    }
    if (item.auto_timing?.end) item.auto_timing.end.offset = (item.auto_timing.end.offset ?? 0) + endDelta
    else if (range.end !== undefined) range.end = start + duration
    else if (!(item as DraftScene).auto_duration || action.edge) range.duration = duration
    if (range.duration !== undefined || (item.auto_timing?.end && !item.auto_timing.start)) range.duration = duration
    if (range.end !== undefined && range.duration !== undefined) range.end = (range.start ?? 0) + duration
    if (action.edge && 'tracks' in item) (item as DraftScene).auto_duration = false
    if (action.edge === 'start' && ['video', 'audio'].includes(time.type)) {
      const source = (item as DraftSegment).source_timerange ??= { start: 0 }
      const sourceStart = (source.start ?? 0) + startDelta
      if (sourceStart < 0) throw new Error('不能向素材起点之前扩展')
      if (source.end !== undefined && sourceStart >= source.end) throw new Error('裁切后没有剩余源区间')
      source.start = sourceStart
      if (source.duration !== undefined) source.duration -= startDelta
    }
    if (action.trackId && action.trackId !== entry.track?.id) {
      const target = tracks.get(action.trackId)
      if (!entry.track || !target || target.scene !== entry.scene) throw new Error('跨轨移动仅限当前 Scene')
      entry.remove()
      target.track.segments.push(item as DraftTrackItem)
      target.track.type = 'mixed'
    }
  } else {
    throw new Error('不支持的编辑操作')
  }
  normalizeDraftTemplate(draft)
  return { templateJson: JSON.stringify(draft, null, 2), selectedId }
}
