import { expect, it } from 'vitest'
import { applyEditorAction } from './editorActions'
import { analyzeEditorDocument } from './editorModel'
import { isSceneSegment, nestedScenes } from './draftTracks'
import type { DraftScene, DraftTemplate } from './draftTemplate'

function fixture(): DraftTemplate {
  return {
    canvas_config: { width: 720, height: 1280 },
    materials: { texts: [{ id: 'mt', type: 'text', content: JSON.stringify({ text: 'Hello', styles: [] }) }],
      audios: [{ id: 'ma', type: 'audio', path: '/tmp/audio.mp3' }] },
    scenes: [{ id: 'parent', auto_duration: true, target_timerange: {}, tracks: [
      { id: 'source', type: 'mixed', track_relative_index: 1, segments: [
        { id: 'text', material_id: 'mt', target_timerange: { start: 0, duration: 5_000_000 } }] },
      { id: 'target', type: 'mixed', track_relative_index: 0, segments: [
        { id: 'audio', material_id: 'ma', target_timerange: { start: 3_000_000, duration: 4_000_000 } }] }
    ] }]
  }
}
const payload = (draft = fixture()) => ({ templateJson: JSON.stringify(draft) })

it('同轨插入而非重叠，后续片段跟随，清理原空轨并保留素材内容', () => {
  const input = payload()
  const moved = applyEditorAction(input, { type: 'move-clip', id: 'text', start: 0, duration: 5, trackId: 'target' })
  const draft = JSON.parse(moved.templateJson) as DraftTemplate
  expect(draft.scenes[0].tracks).toHaveLength(1)
  expect(draft.scenes[0].tracks[0].segments.map(item => item.id)).toEqual(['text', 'audio'])
  expect(draft.scenes[0].tracks[0].segments[1].auto_timing.start).toEqual({ target: 'text', anchor: 'end' })
  const model = analyzeEditorDocument(moved)
  expect(model.timeline.find(item => item.id === 'audio')).toMatchObject({ start: 5, duration: 4 })
  expect(model.duration).toBe(9)
  expect(draft.materials).toEqual(fixture().materials)
  expect(JSON.parse(input.templateJson).scenes[0].tracks).toHaveLength(2)
})

it('自动填充文字插入前方空档时收至下一片段，不挤走音频', () => {
  const draft = fixture()
  delete draft.scenes[0].tracks[0].segments[0].target_timerange.duration
  draft.scenes[0].auto_duration = false
  draft.scenes[0].target_timerange.duration = 12_000_000
  const moved = applyEditorAction(payload(draft), { type: 'move-clip', id: 'text', start: 0, duration: 12, trackId: 'target' })
  const model = analyzeEditorDocument(moved)
  expect(model.timeline.find(item => item.id === 'text')).toMatchObject({ start: 0, duration: 3 })
  expect(model.timeline.find(item => item.id === 'audio')).toMatchObject({ start: 3, duration: 4 })
})

it('插入新轨道可指定轨道间隙或底部，空原轨自动移除且层级连续', () => {
  for (const beforeTrackId of ['target', null]) {
    const moved = applyEditorAction(payload(), { type: 'move-clip', id: 'text', start: 0, duration: 5, beforeTrackId })
    const tracks = (JSON.parse(moved.templateJson) as DraftTemplate).scenes[0].tracks
    expect(tracks).toHaveLength(2)
    expect(tracks.some(track => track.id === 'source')).toBe(false)
    const added = tracks.find(track => track.id !== 'target')
    expect(added.segments[0].id).toBe('text')
    expect(added.track_relative_index).toBe(beforeTrackId === null ? 0 : 1)
    expect(tracks.map(track => track.track_relative_index).sort()).toEqual([0, 1])
  }
})

it('拖走关联链首后，原轨后续片段回到起点，不继续跟随已换轨元素', () => {
  const draft = fixture()
  const audio = draft.scenes[0].tracks[1].segments.pop()!
  audio.auto_timing = { start: { target: 'text', anchor: 'end' } }
  draft.scenes[0].tracks[0].segments.push(audio)
  const moved = applyEditorAction(payload(draft), { type: 'move-clip', id: 'text', start: 2, duration: 5, trackId: 'target' })
  const model = analyzeEditorDocument(moved)
  expect(model.timeline.find(item => item.id === 'audio')).toMatchObject({ start: 0, duration: 4 })
  expect(model.timeline.find(item => item.id === 'text')).toMatchObject({ start: 2, duration: 5 })
  expect(JSON.parse(moved.templateJson).scenes[0].tracks).toHaveLength(2)
})

it('子 Scene 本身也能与基础元素互相插入混排', () => {
  const draft = fixture()
  draft.scenes[0].tracks[0].segments = [{
    id: 'child', type: 'scene', target_timerange: { start: 0, duration: 5_000_000 }, tracks: [] }]
  const moved = applyEditorAction(payload(draft), { type: 'move-clip', id: 'child', start: 0, duration: 5, trackId: 'target' })
  expect(analyzeEditorDocument(moved).timeline.find(item => item.id === 'child'))
    .toMatchObject({ parentId: 'parent', type: 'composition', duration: 5 })
  expect((JSON.parse(moved.templateJson) as DraftTemplate).scenes[0].tracks[0].segments.map(item => item.id)).toEqual(['child', 'audio'])
})

it('同轨关联片段不会在原位落下时重叠，拖到后方可交换顺序', () => {
  const draft = fixture()
  const audio = draft.scenes[0].tracks[1].segments.pop()!
  audio.target_timerange.start = 5_000_000
  audio.auto_timing = { start: { target: 'text', anchor: 'end' } }
  draft.scenes[0].tracks[0].segments.push(audio)
  const unchanged = applyEditorAction(payload(draft), { type: 'move-clip', id: 'text', start: 0, duration: 5, trackId: 'source' })
  expect(analyzeEditorDocument(unchanged).timeline.find(item => item.id === 'audio')).toMatchObject({ start: 5, duration: 4 })
  const later = applyEditorAction(payload(draft), { type: 'move-clip', id: 'text', start: 10, duration: 5, trackId: 'source' })
  const model = analyzeEditorDocument(later)
  expect(model.timeline.find(item => item.id === 'audio')).toMatchObject({ start: 5, duration: 4 })
  expect(model.timeline.find(item => item.id === 'text')).toMatchObject({ start: 10, duration: 5 })
})

it('手动拖动贴合上一片段时也固定开始，不自动重建跟随规则', () => {
  const draft = fixture()
  const audio = draft.scenes[0].tracks[1].segments.pop()!
  audio.target_timerange.start = 5_000_000
  audio.auto_timing = { start: { target: 'text', anchor: 'end' } }
  draft.scenes[0].tracks[0].segments.push(audio)
  const moved = applyEditorAction(payload(draft), { type: 'move-clip', id: 'audio', start: 5, duration: 4, trackId: 'source', manual: true })
  const segment = (JSON.parse(moved.templateJson) as DraftTemplate).scenes[0].tracks[0].segments.find(item => item.id === 'audio')!
  expect(segment.auto_timing).toBeUndefined()
  expect(segment.target_timerange.start).toBe(5_000_000)
})

it('拖入子 Scene 按局部时间落位，原空轨清理且跟随者改挂前驱', () => {
  const draft = fixture()
  draft.scenes[0].tracks[1].segments = [{
    id: 'child', type: 'scene', target_timerange: { start: 8_000_000, duration: 6_000_000 },
    tracks: [{ id: 'inner', type: 'mixed', track_relative_index: 0, segments: [] }] }]
  draft.scenes[0].tracks[0].segments.push({
    id: 'follower', material_id: 'ma', target_timerange: { start: 5_000_000, duration: 4_000_000 },
    auto_timing: { start: { target: 'text', anchor: 'end' } } })
  const moved = applyEditorAction(payload(draft), { type: 'move-into-scene', id: 'text', sceneId: 'child', start: 10 })
  const result = JSON.parse(moved.templateJson) as DraftTemplate
  expect(result.scenes[0].tracks).toHaveLength(2)
  const child = result.scenes[0].tracks.find(track => track.segments.some(item => item.id === 'child'))!
    .segments[0] as Extract<DraftTrackItem, { type: 'scene' }>
  expect(child.tracks[0].segments[0]).toMatchObject({ id: 'text', target_timerange: { start: 2_000_000, duration: 5_000_000 } })
  expect(child.tracks[0].segments[0].auto_timing).toBeUndefined()
  const follower = result.scenes[0].tracks[0].segments.find(item => item.id === 'follower')!
  expect(follower.target_timerange.start).toBe(5_000_000)
  expect(follower.auto_timing).toBeUndefined()
  expect(analyzeEditorDocument(moved).timeline.find(item => item.id === 'text')).toMatchObject({ parentId: 'child', localStart: 2 })
})

it('不能把分镜移入自身或其内部嵌套的分镜', () => {
  const draft = fixture()
  draft.scenes[0].tracks[1].segments = [{
    id: 'child', type: 'scene', target_timerange: { start: 0, duration: 6_000_000 }, tracks: [],
    scenes: [{ id: 'grandchild', name: '孙分镜', target_timerange: { start: 0, duration: 3_000_000 }, tracks: [] }] }]
  expect(() => applyEditorAction(payload(draft), { type: 'move-into-scene', id: 'child', sceneId: 'child', start: 1 })).toThrow(/自身/)
  expect(() => applyEditorAction(payload(draft), { type: 'move-into-scene', id: 'child', sceneId: 'grandchild', start: 1 })).toThrow(/内部/)
})

it('根层分镜可拖入另一个分镜成为其内部片段', () => {
  const draft = fixture()
  draft.scenes.push({ id: 'other', name: '顶层分镜', type: 'scene',
    target_timerange: { start: 5_000_000, duration: 3_000_000 }, tracks: [] })
  const moved = applyEditorAction(payload(draft), { type: 'move-into-scene', id: 'other', sceneId: 'parent', start: 4 })
  const result = JSON.parse(moved.templateJson) as DraftTemplate
  expect(result.scenes.map(scene => scene.id)).toEqual(['parent'])
  expect(result.scenes[0].tracks.flatMap(track => track.segments).find(item => item.id === 'other'))
    .toMatchObject({ target_timerange: { start: 5_000_000, duration: 3_000_000 } })
  expect(analyzeEditorDocument(moved).timeline.find(item => item.id === 'other')).toMatchObject({ parentId: 'parent' })
})

it('拖入批量分镜重定向到唯一子分镜，包装器结构保持合法', () => {
  const draft = fixture()
  draft.scenes[0].tracks[1].segments = [{
    id: 'batch', name: '批量分镜', type: 'scene', target_timerange: { start: 8_000_000, duration: 6_000_000 },
    batch_scene: { source: 'items', mode: 'repeat', items: [{ title: '分镜文案', image: '' }] },
    tracks: [], scenes: [{ id: 'batch-child', name: '分镜', target_timerange: { start: 0, duration: 6_000_000 }, tracks: [] }]
  }]
  const moved = applyEditorAction(payload(draft), { type: 'move-into-scene', id: 'text', sceneId: 'batch', start: 10 })
  expect(analyzeEditorDocument(moved).timeline.find(item => item.id === 'text'))
    .toMatchObject({ parentId: 'batch-child', localStart: 2 })
  function findScene(scenes: DraftScene[]): DraftScene | undefined {
    for (const scene of scenes) {
      if (scene.id === 'batch') return scene
      const nested = findScene([...(scene.scenes ?? []),
        ...scene.tracks.flatMap(track => track.segments.filter(isSceneSegment)) as DraftScene[]])
      if (nested) return nested
    }
    return undefined
  }
  const batch = findScene(JSON.parse(moved.templateJson).scenes)
  expect(batch.batch_scene).toBeDefined()
  expect(nestedScenes(batch)).toHaveLength(1)
  expect(nestedScenes(batch)[0].tracks[0].segments[0]).toMatchObject({ id: 'text' })
})

it('错误跨 Scene、修改时长和非法坐标均回滚，根层仍只能放 Scene', () => {
  const input = payload()
  const before = input.templateJson
  for (const action of [
    { trackId: 'missing' }, { beforeTrackId: 'missing' }, { start: -1 }, { duration: 7 }, { start: NaN }
  ]) {
    expect(() => applyEditorAction(input, { type: 'move-clip', id: 'text', start: 0, duration: 5, ...action })).toThrow()
    expect(input.templateJson).toBe(before)
  }
  expect(() => applyEditorAction(input, { type: 'move-clip', id: 'parent', start: 0, duration: 7 })).toThrow(/当前分镜/)
})
