import { describe, expect, it } from 'vitest'
import { applyEditorAction } from './editorActions'
import { analyzeEditorDocument } from './editorModel'
import type { DraftTemplate, DraftSceneSegment } from './draftTemplate'
import { orderedSceneTracks } from './draftTracks'
import type { LayerDropAction } from './editorLayerDrop'

function fixture(): DraftTemplate {
  return {
    canvas_config: { width: 720, height: 1280 },
    materials: { texts: [{ id: 'text', type: 'text', content: '{"text":"文案"}' }] },
    scenes: [{
      id: 'root', target_timerange: { duration: 6_000_000 }, tracks: [
        { id: 'front-track', type: 'text', track_relative_index: 2,
          segments: [{ id: 'front', name: '前景', material_id: 'text', target_timerange: { start: 0, duration: 6_000_000 } }] },
        { id: 'sequence', type: 'text', track_relative_index: 1, segments: [
          { id: 'a', material_id: 'text', target_timerange: { start: 0, duration: 2_000_000 } },
          { id: 'b', material_id: 'text', target_timerange: { start: 2_000_000, duration: 2_000_000 } },
          { id: 'c', material_id: 'text', target_timerange: { start: 4_000_000, duration: 2_000_000 } }
        ] },
        { id: 'back-track', type: 'text', track_relative_index: 0,
          segments: [{ id: 'back', material_id: 'text', target_timerange: { start: 0, duration: 6_000_000 } }] }
      ]
    }]
  }
}
function child(): DraftSceneSegment {
  return { id: 'child', type: 'scene', name: '子分镜', target_timerange: { start: 0, duration: 6_000_000 }, tracks: [] }
}
function apply(draft: DraftTemplate, id: string, targetId: string, placement: LayerDropAction['placement']) {
  const payload = { templateJson: JSON.stringify(draft) }
  const result = applyEditorAction(payload, { type: 'move-layer', id, targetId, placement })
  expect(payload.templateJson).toBe(JSON.stringify(draft))
  analyzeEditorDocument(result)
  return { ...result, draft: JSON.parse(result.templateJson) as DraftTemplate }
}
const order = (draft: DraftTemplate) => orderedSceneTracks(draft.scenes[0])
  .flatMap(({ track }) => track.segments.map(item => item.id))

describe('目录拖动', () => {
  it('不同轨道上下插入保留素材时间及原轨道 ID', () => {
    const draft = fixture()
    const result = apply(draft, 'front', 'back', 'after')
    expect(order(result.draft)).toEqual(['a', 'b', 'c', 'back', 'front'])
    expect(result.selectedId).toBe('front')
    expect(result.draft.scenes[0].tracks.find(track => track.id === 'front-track'))
      .toEqual({ ...draft.scenes[0].tracks[0], track_relative_index: 0 })
  })

  it('同轨元素可以拖动，按目标行精确插入并保留全部片段时间', () => {
    const draft = fixture()
    const result = apply(draft, 'a', 'c', 'before')
    expect(order(result.draft)).toEqual(['front', 'b', 'a', 'c', 'back'])
    const items = result.draft.scenes[0].tracks.flatMap(track => track.segments)
    for (const original of draft.scenes[0].tracks[1].segments) {
      expect(items.find(item => item.id === original.id)).toEqual(original)
    }
    expect(new Set(result.draft.scenes[0].tracks.map(track => track.track_relative_index)).size)
      .toBe(result.draft.scenes[0].tracks.length)
  })

  it('移入空分镜使用独立轨道，清理来源空轨道', () => {
    const draft = fixture()
    draft.scenes[0].scenes = [child()]
    const result = apply(draft, 'front', 'child', 'inside')
    expect(result.draft.scenes[0].tracks.some(track => track.id === 'front-track')).toBe(false)
    expect(result.draft.scenes[0].scenes![0].tracks[0].segments).toEqual(draft.scenes[0].tracks[0].segments)
  })

  it('跨层插入兄弟位置和批量分镜内部都落在正确父级', () => {
    const draft = fixture()
    const nested = child()
    nested.tracks = [{ id: 'nested-track', type: 'text', segments: [
      { id: 'nested-text', material_id: 'text', target_timerange: { duration: 6_000_000 } }
    ] }]
    draft.scenes[0].scenes = [nested]
    const result = apply(draft, 'front', 'nested-text', 'before')
    expect(orderedSceneTracks(result.draft.scenes[0].scenes![0])
      .flatMap(({ track }) => track.segments.map(item => item.id))).toEqual(['front', 'nested-text'])
    nested.id = 'batch'
    nested.batch_scene = { source: 'items', mode: 'repeat', items: [{}] }
    nested.tracks = []
    nested.scenes = [{ ...child(), id: 'body' }]
    const batch = apply(draft, 'front', 'batch', 'inside')
    expect(batch.draft.scenes[0].scenes![0].tracks).toEqual([])
    expect(batch.draft.scenes[0].scenes![0].scenes![0].tracks[0].segments[0].id).toBe('front')
  })

  it('跨父级移动冻结失效的兄弟关联，不遗留悬空引用', () => {
    const draft = fixture()
    draft.scenes[0].scenes = [child()]
    const sequence = draft.scenes[0].tracks[1].segments
    sequence[1].auto_timing = { start: { target: 'a', anchor: 'end' } }
    sequence[2].auto_timing = { start: { target: 'b', anchor: 'end' } }
    const result = apply(draft, 'b', 'child', 'inside')
    expect(result.draft.scenes[0].scenes![0].tracks[0].segments[0])
      .toMatchObject({ id: 'b', target_timerange: { start: 2_000_000, duration: 2_000_000 } })
    const follower = result.draft.scenes[0].tracks.flatMap(track => track.segments).find(item => item.id === 'c')!
    expect(follower.auto_timing).toBeUndefined()
    expect(follower.target_timerange.start).toBe(4_000_000)
  })

  it('移动媒体保留源裁切、媒体时长模式和全部原生字段', () => {
    const draft = fixture()
    draft.materials.audios = [{ id: 'audio', type: 'audio', path: '/tmp/source.mp3', duration: 8_000_000 }]
    const track = draft.scenes[0].tracks[0]
    track.type = 'audio'
    track.segments[0] = {
      id: 'front', material_id: 'audio', target_timerange: { start: 0, duration: 6_000_000 },
      source_timerange: { start: 1_000_000, duration: 6_000_000 }, duration_mode: 'media'
    }
    draft.scenes[0].scenes = [child()]
    const result = apply(draft, 'front', 'child', 'inside')
    expect(result.draft.scenes[0].scenes![0].tracks[0].segments[0]).toEqual(track.segments[0])
  })

  it('移走 Auto 分镜最后的独立内容后，保留填充元素并回退固定时长', () => {
    const draft = fixture()
    draft.scenes[0].auto_duration = true
    draft.scenes[0].tracks.splice(1)
    draft.scenes[0].tracks.push({
      id: 'fill-track', type: 'text', track_relative_index: 0, segments: [{
        id: 'fill', material_id: 'text', target_timerange: {},
        auto_timing: { start: { target: 'parent', anchor: 'start' }, end: { target: 'parent', anchor: 'end' } }
      }]
    })
    draft.scenes.push({ id: 'target', target_timerange: { duration: 6_000_000 }, tracks: [] })
    const result = apply(draft, 'front', 'target', 'inside')
    expect(result.draft.scenes[0]).toMatchObject({ auto_duration: false, target_timerange: { duration: 6_000_000 } })
    expect(result.draft.scenes[0].tracks[0].segments[0].id).toBe('fill')
  })

  it('根分镜支持排序，基础元素不能移到根层', () => {
    const draft = fixture()
    draft.scenes.push({ id: 'second', target_timerange: { duration: 6_000_000 }, tracks: [] })
    expect(apply(draft, 'second', 'root', 'before').draft.scenes.map(scene => scene.id)).toEqual(['second', 'root'])
    expect(() => apply(draft, 'front', 'second', 'before')).toThrow('根层只能放置分镜')
  })

  it('根分镜可移入另一个分镜，转换为合法的轨道分镜并保留内容', () => {
    const draft = fixture()
    draft.scenes.push({ id: 'second', target_timerange: { duration: 6_000_000 }, tracks: [{
      id: 'second-track', type: 'text', segments: [
        { id: 'second-text', material_id: 'text', target_timerange: { duration: 6_000_000 } }
      ]
    }] })
    const result = apply(draft, 'second', 'root', 'inside')
    expect(result.draft.scenes).toHaveLength(1)
    const nested = result.draft.scenes[0].tracks.flatMap(track => track.segments).find(item => item.id === 'second')!
    expect(nested).toMatchObject({ type: 'scene', tracks: draft.scenes[1].tracks })
  })

  it('媒体可插在旧式子分镜之间，不改变其他子分镜顺序', () => {
    const draft = fixture()
    draft.scenes[0].scenes = [child(), { ...child(), id: 'second-child' }]
    const result = apply(draft, 'front', 'child', 'after')
    expect(order(result.draft)).toEqual(['a', 'b', 'c', 'back', 'child', 'front', 'second-child'])
    expect(result.draft.scenes[0].scenes).toEqual([])
  })

  it('拒绝移入自身后代及拆走批量唯一子分镜，原文不改变', () => {
    const draft = fixture()
    const batch = child()
    batch.id = 'batch'
    batch.batch_scene = { source: 'items', mode: 'repeat', items: [{}] }
    batch.scenes = [child()]
    draft.scenes[0].scenes = [batch]
    expect(() => apply(draft, 'root', 'child', 'inside')).toThrow('不能移入自身')
    expect(() => apply(draft, 'child', 'front', 'before')).toThrow('唯一子分镜')
    expect(() => apply(draft, 'a', 'a', 'before')).toThrow('有效的拖动目标')
  })
})
