import { describe, expect, it } from 'vitest'
import { createEditorPreset } from './editorPresets'
import { addEditorElement, analyzeEditorDocument, compileEditorDocument } from './editorModel'
import { TEMPLATE_PRESETS } from '../../shared/templatePresets'
import { workflowActions } from './workflowTestUtils'
import { isSceneSegment } from './draftTracks'

const document = (id: string) => ({ templateJson: JSON.stringify(createEditorPreset(id)) })

describe('新模版预设', () => {
  it('空白模版没有素材且可继续添加', () => {
    const input = document('empty')
    const model = analyzeEditorDocument(input)
    expect(model.rows).toEqual([])
    expect(model.tree[0].children).toEqual([])
    expect(compileEditorDocument(input).workflow.script).toEqual([])
    const added = addEditorElement(input, { type: 'text', selectedId: 'scene-1' })
    expect(analyzeEditorDocument(added).rows[0].clips[0]).toMatchObject({ start: 0, end: 15 })
  })

  it('每句话对应一张图片，时间轴与 Workflow 起止相同', () => {
    const input = document('sentence-image')
    const result = compileEditorDocument(input)
    const actions = workflowActions(result.workflow)
    expect(actions).toHaveLength(6)
    const model = analyzeEditorDocument(input)
    expect(model.timeline).toEqual(result.timeline)
    expect(model.rows).toHaveLength(7)
    expect(model.rows[0]).toMatchObject({ id: 'sentence-scenes', types: ['composition'] })
    expect(model.rows[0].clips.map(({ start, end }) => [start, end])).toEqual([[0, 5], [5, 10], [10, 15]])
    expect(model.rows.slice(1).every((row) => row.clips.length === 1)).toBe(true)
    expect(new Set(actions.map(({ params }) => params.track_name)).size).toBe(6)
    expect(new Set(actions.map(({ params }) => params.relative_index)).size).toBe(6)
    for (let number = 1; number <= 3; number++) {
      const image = actions.find(({ id }) => id === `image-${number}`)!
      const text = actions.find(({ id }) => id === `text-${number}`)!
      expect(result.timeline.find(({ id }) => id === image.id)).toMatchObject({ start: (number - 1) * 5, end: number * 5 })
      expect(image.params.track_name).toBe(`image_track_${number}`)
      expect(text.params.track_name).toBe(`text_track_${number}`)
      const imageTrack = result.workflowTracks.find(({ logicalTrackId }) => logicalTrackId === image.params.track_name)!
      const textTrack = result.workflowTracks.find(({ logicalTrackId }) => logicalTrackId === text.params.track_name)!
      expect(textTrack.renderIndex).toBeGreaterThan(imageTrack.renderIndex)
      expect(result.timeline.find(({ id }) => id === text.id)!.parentId).toBe(`sentence-scene-${number}`)
    }
  })

  it('修改文字起止后，对应图片自动同步', () => {
    const template = createEditorPreset('sentence-image')
    const child = template.scenes[0].tracks[0].segments.filter(isSceneSegment)[1]
    child.tracks.find((track) => track.id === 'text_track_2')!.segments[0].target_timerange =
      { start: 1_000_000, duration: 2_000_000 }
    const result = compileEditorDocument({ templateJson: JSON.stringify(template) })
    for (const id of ['text-2', 'image-2']) {
      expect(result.timeline.find((item) => item.id === id)).toMatchObject({ start: 6, end: 8 })
    }
    expect(result.duration).toBe(13)
    expect(result.timeline.find(({ id }) => id === 'sentence-scene-3')).toMatchObject({ start: 8, end: 13 })
  })

  it('混排演示同轨交替、无重叠，上下层级一致且可编译为三条剪映轨道', () => {
    const input = document('mixed-track')
    const model = analyzeEditorDocument(input)
    expect(model.duration).toBe(16)
    expect(model.rows.map(({ id }) => id)).toEqual(['mixed-main-track', 'mixed-underlay-track'])
    expect(model.tree[0].children.map(({ id }) => id)).toEqual(model.rows.map(({ id }) => id))
    expect(model.rows[0].clips.map(({ type, start, end }) => [type, start, end])).toEqual([
      ['image', 0, 4], ['text', 4, 8], ['image', 8, 12], ['text', 12, 16]
    ])
    expect(model.rows.every(({ lanes }) => lanes === 1)).toBe(true)
    expect(model.rows[1].clips[0]).toMatchObject({ type: 'text', start: 0, end: 16 })
    const compiled = compileEditorDocument(input)
    expect(workflowActions(compiled.workflow)).toHaveLength(5)
    expect(compiled.workflowTracks).toHaveLength(3)
    const upper = compiled.workflowTracks.filter(({ logicalTrackId }) => logicalTrackId === 'mixed-main-track')
    const lower = compiled.workflowTracks.find(({ logicalTrackId }) => logicalTrackId === 'mixed-underlay-track')!
    expect(upper).toHaveLength(2)
    expect(upper.every(({ renderIndex }) => renderIndex > lower.renderIndex)).toBe(true)
    expect(compiled.workflowInputBindings.every(({ runtime }) => runtime)).toBe(true)
    expect(compiled.timeline).toEqual(model.timeline)
  })

  it('目录中的选项均可创建，默认空白且每次独立，不接受未知预设', () => {
    for (const preset of TEMPLATE_PRESETS) expect(() => document(preset.id)).not.toThrow()
    expect(createEditorPreset()).toEqual(createEditorPreset('empty'))
    const first = createEditorPreset('sentence-image')
    first.materials.texts[0].content = '{}'
    expect(createEditorPreset('sentence-image').materials.texts[0].content).not.toBe('{}')
    expect(() => createEditorPreset('unknown')).toThrow('不支持的模版')
  })

  it('混排文字 1 自动对齐图片 1 结束，保留自身时长', () => {
    const template = createEditorPreset('mixed-track')
    const segments = template.scenes[0].tracks[1].segments
    expect(segments[1]).toMatchObject({
      target_timerange: { duration: 4_000_000 },
      auto_timing: { start: { target: 'mixed-photo-1', anchor: 'end' } },
      dynamic: ['target_timerange.duration']
    })
    expect(segments[1].target_timerange).not.toHaveProperty('start')
    segments[0].target_timerange = { start: 1_000_000, duration: 2_000_000 }
    const result = compileEditorDocument({ templateJson: JSON.stringify(template) })
    expect(result.timeline.find(({ id }) => id === 'mixed-text-1')).toMatchObject({ start: 3, end: 7, duration: 4 })
  })
})
