import { describe, expect, it } from 'vitest'
import { analyzeDraftTemplate, compileDraftTemplate, normalizeDraftTemplate } from './draftTemplate'
import { addEditorElement, analyzeEditorDocument } from './editorModel'
import { BACKEND_TRACK_BASES, mapWorkflowTracks } from './draftTracks'
import { mixedTrackFixture, workflowActions } from './workflowTestUtils'

const payload = (template = mixedTrackFixture()) => ({ templateJson: JSON.stringify(template) })
function visualFixture() {
  const template = mixedTrackFixture()
  template.scenes[0].tracks[0].segments.splice(2)
  return template
}

describe('混排逻辑轨道', () => {
  it('一条逻辑轨道按素材引用识别四种类型，时间轴不拆行', () => {
    const template = mixedTrackFixture()
    const before = structuredClone(template)
    const model = analyzeEditorDocument(payload(template))
    expect(model.rows).toHaveLength(1)
    expect(model.rows[0]).toMatchObject({
      id: 'mixed', name: '混排轨道', lanes: 1, track: 0, types: ['image', 'text', 'audio', 'video']
    })
    expect(model.rows[0].clips.map(({ start, end }) => [start, end])).toEqual([[0, 2], [2, 4], [4, 6], [6, 8]])
    expect(model.tree[0].children[0].children.map(({ type }) => type)).toEqual(['image', 'text', 'audio', 'video'])
    expect(model.timeline.find(({ id }) => id === 'audio')).toMatchObject({ sourceStart: 1, sourceEnd: 3 })
    expect(model.timeline.find(({ id }) => id === 'video')).toMatchObject({ sourceStart: 3, sourceEnd: 5 })
    expect(template).toEqual(before)
    delete template.scenes[0].tracks[0].type
    expect(analyzeDraftTemplate(template).timeline).toEqual(model.timeline)
    // Editing support does not silently bypass existing media export boundaries.
    expect(() => compileDraftTemplate(template)).toThrow('暂不支持元素类型')
  })

  it('同轨不允许同类型或跨类型重叠，首尾相接允许，分轨可同时显示', () => {
    const template = visualFixture()
    const track = template.scenes[0].tracks[0]
    track.segments[1].target_timerange.start = 1_999_999
    expect(() => normalizeDraftTemplate(template)).toThrow('时间重叠')
    track.segments[1].material_id = 'photo'
    expect(() => compileDraftTemplate(template)).toThrow('时间重叠')
    const second = track.segments.pop()!
    template.scenes[0].tracks.push({ id: 'other', segments: [second] })
    expect(() => compileDraftTemplate(template)).not.toThrow()
  })

  it('先解析 auto_timing 再检查冲突，不对隐藏区间或不同 Scene 混判', () => {
    const template = visualFixture()
    const track = template.scenes[0].tracks[0]
    track.segments[1].auto_timing = { start: { target: 'image', anchor: 'start' } }
    expect(() => analyzeDraftTemplate(template)).toThrow('image 与 text')
    track.segments[1].auto_timing.start!.anchor = 'end'
    expect(() => analyzeDraftTemplate(template)).not.toThrow()
    delete track.segments[1].auto_timing
    template.duration = 1_000_000
    track.segments[1].target_timerange.start = 2_000_000
    expect(() => analyzeDraftTemplate(template)).not.toThrow()
  })

  it('混排拆成类型轨道，同一逻辑轨道的子轨具有相同绝对层级', () => {
    const template = visualFixture()
    const result = compileDraftTemplate(template)
    const actions = workflowActions(result.workflow)
    const text = actions.find(({ id }) => id === 'text')!
    const image = actions.find(({ id }) => id === 'image')!
    expect(text.params).toMatchObject({ track_name: 'mixed__text', relative_index: 1 })
    expect(image.params).toMatchObject({ track_name: 'mixed__video', relative_index: 15001 })
    expect(Number(text.params.relative_index) + BACKEND_TRACK_BASES.text)
      .toBe(Number(image.params.relative_index) + BACKEND_TRACK_BASES.video)
    expect(new Set(result.workflowTracks.map(({ renderIndex }) => renderIndex))).toEqual(new Set([15001]))
    expect(result.template).toEqual(template)
  })

  it('高层级图片保持在低层级文字上方，树、时间轴和后端层级一致', () => {
    const template = visualFixture()
    const scene = template.scenes[0]
    const [image, text] = scene.tracks[0].segments
    scene.tracks = [
      { id: 'upper-image', name: '上层图片', type: 'video', track_relative_index: 20, segments: [image] },
      { id: 'lower-text', name: '下层文字', type: 'text', track_relative_index: -3, segments: [text] }
    ]
    const model = analyzeEditorDocument(payload(template))
    expect(model.rows.map(({ id }) => id)).toEqual(['upper-image', 'lower-text'])
    expect(model.tree[0].children.map(({ id }) => id)).toEqual(['upper-image', 'lower-text'])
    const mapping = compileDraftTemplate(template).workflowTracks
    const upper = mapping.find(({ logicalTrackId }) => logicalTrackId === 'upper-image')!
    const lower = mapping.find(({ logicalTrackId }) => logicalTrackId === 'lower-text')!
    expect(upper.renderIndex).toBeGreaterThan(lower.renderIndex)
    expect(upper.relativeIndex).toBeGreaterThan(lower.relativeIndex + 15000)
  })

  it('拆轨名不会与其他逻辑轨道冲突，图片与视频共用 video 子轨', () => {
    const template = mixedTrackFixture()
    template.scenes[0].tracks.push({ id: 'mixed__video', type: 'text', segments: [] })
    const normalized = normalizeDraftTemplate(template)
    const mapped = mapWorkflowTracks(normalized.template, normalized.logicalTracks)
    expect(mapped.mappings.find(({ type }) => type === 'video')!.trackName).toBe('mixed__video_')
    expect(mapped.mappings).toHaveLength(3)
    const children = mapped.template.elements[0].elements!
    expect(children.find(({ id }) => id === 'image')!.track_name).toBe(children.find(({ id }) => id === 'video')!.track_name)
  })

  it('嵌套 Scene 使用独立层级带，重名轨道不合并，空轨也保留', () => {
    const template = visualFixture()
    template.scenes[0].scenes = [{
      id: 'child', target_timerange: { duration: 4_000_000 },
      tracks: [{ id: 'child-track', name: '混排轨道', segments: [{
        id: 'child-text', material_id: 'title', target_timerange: { duration: 1_000_000 }
      }] }, { id: 'empty-track', name: '空轨道', segments: [] }]
    }]
    const model = analyzeEditorDocument(payload(template))
    expect(model.rows.map(({ id }) => id)).toEqual(['mixed', 'empty-track', 'child-track'])
    const mapping = compileDraftTemplate(template).workflowTracks
    expect(mapping.find(({ logicalTrackId }) => logicalTrackId === 'mixed')!.renderIndex)
      .toBeGreaterThan(mapping.find(({ logicalTrackId }) => logicalTrackId === 'child-track')!.renderIndex)
  })

  it('选择轨道时在末尾追加不同素材，空间不足给出错误，新增轨道位于最上层', () => {
    const template = visualFixture()
    const input = payload(template)
    const added = addEditorElement(input, { selectedId: 'mixed', type: 'audio', source: '/tmp/audio.wav' })
    const model = analyzeEditorDocument(added)
    expect(model.rows).toHaveLength(1)
    expect(model.rows[0].clips.at(-1)).toMatchObject({ id: added.selectedId, type: 'audio', start: 4, end: 8 })
    expect(() => addEditorElement(added, { selectedId: 'mixed', type: 'text' })).toThrow('没有剩余时间')
    expect(input).toEqual(payload(template))
    template.scenes[0].tracks[0].track_relative_index = 99
    const fresh = addEditorElement(payload(template), { selectedId: 'scene', type: 'text' })
    expect(analyzeEditorDocument(fresh).rows[0].track).toBe(100)
  })
})
