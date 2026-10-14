import type { DraftMaterial, DraftScene, DraftSceneSegment, DraftTemplate, DraftTrack, DraftTrackItem } from './draftTemplate'
import type { ResolvedElement, SceneElement, SceneTemplate } from './sceneTemplate'

export const BACKEND_TRACK_BASES: Record<string, number> = {
  video: 0, audio: 0, effect: 10000, filter: 11000, sticker: 14000, text: 15000
}

export function materialElementType(material: DraftMaterial, bucket: string): SceneElement['type'] {
  const type = ({
    videos: material.type === 'photo' ? 'image' : material.type === 'video' ? 'video' : undefined,
    texts: material.type === 'text' ? 'text' : undefined,
    audios: 'audio',
    stickers: material.type === 'sticker' ? 'sticker' : undefined,
    effects: material.type === 'filter' ? 'filter' : undefined,
    video_effects: material.type === 'video_effect' ? 'effect' : undefined
  } as Record<string, SceneElement['type'] | undefined>)[bucket]
  if (!type) throw new Error(`${material.id} 的素材类型与素材库不一致`)
  return type
}

export const backendTrackType = (type: SceneElement['type']) =>
  type === 'image' || type === 'video' ? 'video' : type

export function isSceneSegment(item: DraftTrackItem): item is DraftSceneSegment {
  return Boolean(item && item.type === 'scene')
}

export function nestedScenes(scene: DraftScene): DraftScene[] {
  return [...scene.tracks.flatMap((track) => track.segments.filter(isSceneSegment)), ...(scene.scenes ?? [])]
}

export function orderedSceneTracks(scene: DraftScene) {
  return scene.tracks.map((track, index) => ({ track, index, order: track.track_relative_index ?? index }))
    .sort((a, b) => b.order - a.order || a.index - b.index)
}

export interface LogicalTrack {
  track: DraftTrack
  sceneId: string
  sceneName: string
  order: number
  rank: number
}

// Inline Scene bands stay inside their owning track's layer, above the next lower track.
export function logicalTrackLayout(draft: DraftTemplate, timeline: ResolvedElement[] = []): LogicalTrack[] {
  const tracks: LogicalTrack[] = []
  const times = new Map(timeline.map((item) => [item.id, item.localStart]))
  function visit(scenes: DraftScene[]) {
    for (const scene of scenes) {
      for (const { track, order } of orderedSceneTracks(scene)) {
        tracks.push({ track, order, sceneId: scene.id, sceneName: scene.name ?? scene.id, rank: 0 })
        visit([...track.segments].filter(isSceneSegment).sort((a, b) =>
          (times.get(a.id) ?? a.target_timerange.start ?? 0) - (times.get(b.id) ?? b.target_timerange.start ?? 0)))
      }
      visit(scene.scenes ?? [])
    }
  }
  visit(draft.scenes)
  tracks.forEach((track, index) => { track.rank = tracks.length - index - 1 })
  return tracks
}

export function validateLogicalTrackTimeline(tracks: LogicalTrack[], timeline: ResolvedElement[]) {
  const byId = new Map(timeline.map((element) => [element.id, element]))
  for (const { track } of tracks) {
    const clips = track.segments.map((segment) => byId.get(segment.id))
      .filter((clip): clip is ResolvedElement => Boolean(clip?.visible))
      .sort((a, b) => a.start - b.start || a.end - b.end)
    for (let index = 1; index < clips.length; index++) {
      if (clips[index].start < clips[index - 1].end) {
        throw new Error(`逻辑轨道 ${track.name ?? track.id}（${track.id}）时间重叠：${clips[index - 1].id} 与 ${clips[index].id}；同轨片段不能同时出现`)
      }
    }
  }
}

export interface WorkflowTrackMapping {
  logicalTrackId: string
  sceneId: string
  type: string
  trackName: string
  logicalIndex: number
  renderIndex: number
  relativeIndex: number
}

export function mapWorkflowTracks(template: SceneTemplate, tracks: LogicalTrack[]) {
  const result = structuredClone(template)
  const groups = new Map<string, SceneElement[]>()
  function collect(elements: SceneElement[]) {
    for (const element of elements) {
      if (element.elements) collect(element.elements)
      else {
        const group = groups.get(element.track_name!) ?? []
        group.push(element)
        groups.set(element.track_name!, group)
      }
    }
  }
  collect(result.elements)
  const names = new Set(tracks.map(({ track }) => track.id))
  names.add('main')
  const mappings: WorkflowTrackMapping[] = []
  for (const logical of tracks) {
    const elements = groups.get(logical.track.id) ?? []
    const types = [...new Set(elements.map((element) => backendTrackType(element.type)))].sort()
    for (const type of types) {
      let name = logical.track.id
      if (types.length > 1 || name === 'main') {
        name = `${logical.track.id}__${type}`
        while (names.has(name)) name += '_'
        names.add(name)
      }
      // Backend adds a type-specific base. Cancel it to preserve cross-type layering.
      const renderIndex = 15001 + logical.rank
      const relativeIndex = renderIndex - BACKEND_TRACK_BASES[type]
      mappings.push({
        logicalTrackId: logical.track.id, sceneId: logical.sceneId, type, trackName: name,
        logicalIndex: logical.order, renderIndex, relativeIndex
      })
      for (const element of elements.filter((item) => backendTrackType(item.type) === type)) {
        element.track_name = name
        element.track_relative_index = relativeIndex
      }
    }
  }
  return { template: result, mappings }
}
