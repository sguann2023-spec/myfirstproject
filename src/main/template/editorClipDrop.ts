import { randomUUID } from 'node:crypto'
import { clipInsertion } from '../../shared/templateClipInsertion'
import type { DraftScene, DraftTrack, DraftTrackItem } from './draftTemplate'
import { orderedSceneTracks } from './draftTracks'

export interface ClipDropAction {
  type: 'move-clip'
  id: string
  start: number
  duration: number
  trackId?: string
  beforeTrackId?: string | null
  manual?: boolean
}
export interface ClipSceneDropAction {
  type: 'move-into-scene'
  id: string
  sceneId: string
  start: number
}
type Time = { id: string; type: string; localStart: number; duration: number }

// `start` is expressed in the current view's coordinates; it is converted to a
// target-scene-local start here because each timeline entry is scoped to its own parent.
export function dropEditorClipIntoScene(item: DraftTrackItem,
  source: { track?: DraftTrack; scene?: DraftScene; scenes?: DraftScene[] }, target: DraftScene,
  times: Map<string, Time>, action: ClipSceneDropAction) {
  const micros = (value: number) => Math.round(value * 1_000_000)
  const time = times.get(item.id)!
  if (!Number.isFinite(action.start) || action.start < 0 || !Number.isSafeInteger(micros(action.start))) {
    throw new Error('开始时间必须为非负数')
  }
  const anchor = times.get(action.sceneId)
  if (!anchor) throw new Error('目标分镜不存在')
  const local = Math.max(0, action.start - anchor.localStart)
  const siblings = source.track?.segments ?? source.scenes ?? []
  const predecessor = siblings.filter(sibling => sibling.id !== item.id && times.has(sibling.id))
    .filter(sibling => times.get(sibling.id)!.localStart + times.get(sibling.id)!.duration <= time.localStart)
    .sort((a, b) => times.get(b.id)!.localStart - times.get(a.id)!.localStart)[0]
  const followers = siblings.filter(sibling => sibling.auto_timing?.start?.target === item.id)
  for (const follower of followers) {
    if (predecessor) follower.auto_timing!.start = { target: predecessor.id, anchor: 'end' }
    else {
      delete follower.auto_timing!.start
      follower.target_timerange.start = micros(times.get(follower.id)!.localStart)
    }
    if (!follower.auto_timing!.start && !follower.auto_timing!.end) delete follower.auto_timing
  }
  const ordered = orderedSceneTracks(target).map(entry => entry.track)
  const trackType = time.type === 'composition' ? 'scene' : time.type
  const targetTrack = ordered.find(track => track.type === 'mixed') ?? ordered.find(track => track.type === trackType) ??
    { id: randomUUID(), name: item.name ?? '轨道', type: 'mixed',
      track_relative_index: Math.max(-1, ...target.tracks.map((track, index) => track.track_relative_index ?? index)) + 1,
      segments: [] }
  if (!target.tracks.includes(targetTrack)) target.tracks.push(targetTrack)
  const intervals = targetTrack.segments.map(segment => {
    const value = times.get(segment.id)!
    return { id: segment.id, start: value.localStart, end: value.localStart + value.duration }
  })
  const autoFill = ['text', 'image', 'sticker'].includes(time.type) && item.target_timerange.duration === undefined &&
    item.target_timerange.end === undefined && !item.auto_timing?.end
  const plan = clipInsertion(local, time.duration, intervals, autoFill)
  if (source.track) source.track.segments.splice(source.track.segments.indexOf(item), 1)
  else {
    const list = source.scenes ?? []
    const index = list.indexOf(item as unknown as DraftScene)
    if (index >= 0) list.splice(index, 1)
  }
  const place = (segment: DraftTrackItem, start: number, duration: number) => {
    const range = segment.target_timerange
    range.start = micros(start)
    range.duration = micros(duration)
    delete range.end
    delete segment.auto_timing
  }
  place(item, plan.start, plan.duration)
  targetTrack.type = 'mixed'
  targetTrack.segments.push(item)
  for (const shift of plan.shifts) {
    const sibling = targetTrack.segments.find(segment => segment.id === shift.id)!
    place(sibling, shift.start, shift.duration)
  }
  targetTrack.segments.sort((a, b) => (a.target_timerange.start ?? 0) - (b.target_timerange.start ?? 0))
  if (source.track && !source.track.segments.length && source.scene) {
    source.scene.tracks.splice(source.scene.tracks.indexOf(source.track), 1)
  }
  const reindex = (scene: DraftScene) => {
    orderedSceneTracks(scene).filter(({ track }) => scene.tracks.includes(track)).forEach(({ track }, index, tracks) => {
      track.track_relative_index = tracks.length - index - 1
    })
  }
  reindex(target)
  if (source.scene && source.scene !== target) reindex(source.scene)
}

export function dropEditorClip(scene: DraftScene, source: DraftTrack, item: DraftTrackItem,
  times: Map<string, Time>, action: ClipDropAction) {
  const micros = (value: number) => Math.round(value * 1_000_000)
  const time = times.get(item.id)!
  if (!Number.isFinite(action.start) || action.start < 0 || !Number.isSafeInteger(micros(action.start))) {
    throw new Error('开始时间必须为非负数')
  }
  if (!Number.isFinite(action.duration) || action.duration <= 0 ||
    Math.abs(micros(action.duration) - micros(time.duration)) > 1) throw new Error('移动片段不能改变时长')
  const ordered = orderedSceneTracks(scene).map(entry => entry.track)
  let target: DraftTrack | undefined
  if (action.beforeTrackId !== undefined) {
    const index = action.beforeTrackId === null ? ordered.length : ordered.findIndex(track => track.id === action.beforeTrackId)
    if (index < 0) throw new Error('跨轨移动仅限当前分镜')
    target = { id: randomUUID(), name: item.name ?? '轨道', type: 'mixed', segments: [] }
    ordered.splice(index, 0, target)
    scene.tracks.push(target)
  } else target = scene.tracks.find(track => track.id === (action.trackId ?? source.id))
  if (!target) throw new Error('跨轨移动仅限当前分镜')
  const remaining = target.segments.filter(segment => segment.id !== item.id)
  const intervals = remaining.map(segment => {
    const value = times.get(segment.id)!
    return { id: segment.id, start: value.localStart, end: value.localStart + value.duration }
  })
  const autoFill = ['text', 'image', 'sticker'].includes(time.type) && item.target_timerange.duration === undefined &&
    item.target_timerange.end === undefined && !item.auto_timing?.end
  const plan = clipInsertion(action.start, action.duration, intervals, autoFill)
  // Detach followers on the source track before the moved clip gets a new predecessor.
  const predecessor = source.segments.filter(segment => segment.id !== item.id)
    .filter(segment => times.get(segment.id)!.localStart + times.get(segment.id)!.duration <= time.localStart)
    .sort((a, b) => times.get(b.id)!.localStart - times.get(a.id)!.localStart)[0]
  const followers = source.segments.filter(sibling => sibling.auto_timing?.start?.target === item.id)
  for (const sibling of followers) {
    if (source === target) {
      delete sibling.auto_timing!.start
      sibling.target_timerange.start = micros(times.get(sibling.id)!.localStart)
    } else if (predecessor) sibling.auto_timing!.start = { target: predecessor.id, anchor: 'end' }
    else { delete sibling.auto_timing!.start; sibling.target_timerange.start = 0 }
    if (!sibling.auto_timing!.start && !sibling.auto_timing!.end) delete sibling.auto_timing
  }
  source.segments.splice(source.segments.indexOf(item), 1)
  target.segments.push(item)
  target.type = 'mixed'
  const place = (segment: DraftTrackItem, start: number, duration: number) => {
    const previous = intervals.filter(clip => clip.id !== segment.id && clip.end <= start + 0.000001)
      .sort((a, b) => b.end - a.end)[0]
    const range = segment.target_timerange
    range.start = micros(start)
    range.duration = micros(duration)
    delete range.end
    delete segment.auto_timing
    if (!action.manual && previous && Math.abs(previous.end - start) < 0.000001) {
      segment.auto_timing = { ...segment.auto_timing, start: { target: previous.id, anchor: 'end' } }
    }
  }
  place(item, plan.start, plan.duration)
  intervals.push({ id: item.id, start: plan.start, end: plan.start + plan.duration })
  for (const shift of plan.shifts) {
    const sibling = target.segments.find(segment => segment.id === shift.id)!
    place(sibling, shift.start, shift.duration)
    const interval = intervals.find(clip => clip.id === shift.id)!
    interval.start = shift.start; interval.end = shift.start + shift.duration
  }
  if (source === target) for (const sibling of followers) {
    const interval = intervals.find(clip => clip.id === sibling.id)!
    if (Math.abs(interval.start - (plan.start + plan.duration)) < 0.000001) {
      sibling.auto_timing = { ...sibling.auto_timing, start: { target: item.id, anchor: 'end' } }
    }
  }
  target.segments.sort((a, b) => (a.target_timerange.start ?? 0) - (b.target_timerange.start ?? 0))
  if (source !== target && !source.segments.length) scene.tracks.splice(scene.tracks.indexOf(source), 1)
  ordered.filter(track => scene.tracks.includes(track)).forEach((track, index, tracks) => {
    track.track_relative_index = tracks.length - index - 1
  })
}
