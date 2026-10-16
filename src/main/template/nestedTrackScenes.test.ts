import { describe, expect, it } from 'vitest'
import { analyzeDraftTemplate, compileDraftTemplate, normalizeDraftTemplate, type DraftSceneSegment } from './draftTemplate'
import { addEditorElement, analyzeEditorDocument, compileEditorDocument } from './editorModel'
import { createEditorPreset } from './editorPresets'
import { isSceneSegment } from './draftTracks'
import { mixedTrackFixture, workflowActions } from './workflowTestUtils'

function fixture() {
  const template = mixedTrackFixture()
  const scene = template.scenes[0]
  const child: DraftSceneSegment = {
    id: 'child', name: '子 Scene', type: 'scene', target_timerange: { start: 2_000_000, duration: 4_000_000 },
    tracks: [
      { id: 'child-image-track', type: 'video', track_relative_index: 0, segments: [{
        id: 'child-image', material_id: 'photo', target_timerange: {}
      }] },
      { id: 'child-text-track', type: 'text', track_relative_index: 1, segments: [{
        id: 'child-text', material_id: 'title', target_timerange: { duration: 4_000_000 }
      }] }
    ]
  }
  scene.tracks[0].segments = [scene.tracks[0].segments[0], child, {
    id: 'tail', material_id: 'title', target_timerange: { start: 6_000_000, duration: 2_000_000 }
  }]
  return { template, scene, child }
}

describe('轨道中的嵌套 Scene', () => {
  it('Scene 与媒体同轨连续，作为一个元素显示且内部独立展开，不修改原模版', () => {
    const { template } = fixture()
    const before = structuredClone(template)
    const model = analyzeEditorDocument({ templateJson: JSON.stringify(template) })
    expect(model.rows[0]).toMatchObject({ id: 'mixed', types: ['image', 'composition', 'text'], lanes: 1 })
    expect(model.rows[0].clips.map(({ type, start, end }) => [type, start, end]))
      .toEqual([['image', 0, 2], ['composition', 2, 6], ['text', 6, 8]])
    const childNode = model.tree[0].children[0].children[1]
    expect(childNode).toMatchObject({ id: 'child', type: 'composition' })
    expect(childNode.children.map(({ id }) => id)).toEqual(['child-text-track', 'child-image-track'])
    const compiled = compileDraftTemplate(template)
    expect(workflowActions(compiled.workflow)).toHaveLength(4)
    expect(workflowActions(compiled.workflow).some(({ id }) => id === 'child')).toBe(false)
    expect(compiled.timeline.find(({ id }) => id === 'child-text')).toMatchObject({ start: 2, end: 6, parentId: 'child' })
    expect(compiled.template).toEqual(before)
    expect(template).toEqual(before)
  })

  it('整个 Scene 区间参与同轨冲突检查，空白间隙也不能插入另一个元素', () => {
    const { template, child } = fixture()
    child.tracks[1].segments[0].target_timerange = { start: 2_000_000, duration: 1_000_000 }
    child.tracks[0].segments[0].target_timerange = { start: 2_000_000, duration: 1_000_000 }
    template.scenes[0].tracks[0].segments[0].target_timerange.duration = 3_000_000
    expect(() => analyzeDraftTemplate(template)).toThrow('image 与 child')
  })

  it('子 Scene 的内容驱动长度和同父片段关联共同参与父 Scene 推导', () => {
    const { template, scene, child } = fixture()
    delete template.duration
    delete scene.target_timerange.duration
    scene.auto_duration = true
    child.auto_duration = true
    delete child.target_timerange.duration
    child.auto_timing = { start: { target: 'image', anchor: 'end' } }
    child.tracks[1].segments[0].target_timerange.duration = 6_000_000
    const tail = scene.tracks[0].segments[2]
    tail.auto_timing = { start: { target: 'child', anchor: 'end' } }
    const result = analyzeDraftTemplate(template)
    expect(result.duration).toBe(10)
    expect(result.timeline.find(({ id }) => id === 'child')).toMatchObject({ start: 2, end: 8, duration: 6 })
    expect(result.timeline.find(({ id }) => id === 'tail')).toMatchObject({ start: 8, end: 10 })
  })

  it('子 Scene 内部层级留在父轨道位置，不越过上轨，也不落到下轨后面', () => {
    const { template, scene } = fixture()
    scene.tracks.push({ id: 'upper', type: 'video', track_relative_index: 10, segments: [{
      id: 'upper-image', material_id: 'photo', target_timerange: {}
    }] }, { id: 'lower', type: 'text', track_relative_index: -1, segments: [{
      id: 'lower-text', material_id: 'title', target_timerange: {}
    }] })
    const result = compileDraftTemplate(template)
    const rank = (id: string) => result.workflowTracks.find(({ logicalTrackId }) => logicalTrackId === id)!.renderIndex
    expect(rank('upper')).toBeGreaterThan(rank('child-text-track'))
    expect(rank('child-text-track')).toBeGreaterThan(rank('child-image-track'))
    expect(rank('child-image-track')).toBeGreaterThan(rank('lower'))
    expect(analyzeEditorDocument({ templateJson: JSON.stringify(template) }).rows.map(({ id }) => id))
      .toEqual(['upper', 'mixed', 'child-text-track', 'child-image-track', 'lower'])
  })

  it('嵌套声明原点不因祖先左截断改变，视频源裁切仍随可见区间推进', () => {
    const { template, scene, child } = fixture()
    scene.tracks[0].segments = [child]
    child.target_timerange = { duration: 12_000_000 }
    child.auto_timing = { end: { target: 'parent', anchor: 'end' } }
    child.tracks = [{ id: 'movie-track', type: 'video', segments: [{
      id: 'child-movie', material_id: 'movie', target_timerange: { duration: 6_000_000 },
      source_timerange: { start: 10_000_000 }
    }] }]
    expect(analyzeDraftTemplate(template).timeline.find(({ id }) => id === 'child-movie'))
      .toMatchObject({ start: 0, end: 2, sourceStart: 14, sourceEnd: 16 })
    expect(() => compileDraftTemplate(template)).toThrow('暂不支持元素类型')
  })

  it('拒绝不合法结构、轨道类型、重复 ID 和跨子 Scene 的内部引用', () => {
    let data = fixture()
    data.child.material_id = 'photo'
    expect(() => normalizeDraftTemplate(data.template)).toThrow('不使用 material_id')
    data = fixture()
    data.child.type = 'composition' as any
    expect(() => normalizeDraftTemplate(data.template)).toThrow('必须设置 type')
    data = fixture()
    data.scene.tracks[0].type = 'video'
    expect(() => normalizeDraftTemplate(data.template)).toThrow('分镜类型与轨道不一致')
    data = fixture()
    data.child.id = 'image'
    expect(() => normalizeDraftTemplate(data.template)).toThrow('唯一')
    data = fixture()
    data.child.tracks[1].segments[0].auto_timing = { start: { target: 'image', anchor: 'end' } }
    expect(() => normalizeDraftTemplate(data.template)).toThrow('同一父级')
  })

  it('Scene 关键帧不因展开而静默丢失，保留但阻止导出', () => {
    const { template, child } = fixture()
    child.common_keyframes = [{
      id: 'scene-rotation', property_type: 'KFTypeRotation', keyframe_list: [{
        id: 'scene-rotation-0', time_offset: 0, values: [0]
      }]
    }]
    expect(() => analyzeDraftTemplate(template)).not.toThrow()
    expect(() => compileDraftTemplate(template)).toThrow('关键帧')
  })

  it('轨道内 Scene 可以继续嵌套 Scene，全局时间逐层叠加', () => {
    const { template, child } = fixture()
    child.tracks = [{ id: 'grand-container', type: 'scene', segments: [{
      id: 'grand', type: 'scene', auto_duration: true, target_timerange: { start: 1_000_000 },
      tracks: [{ id: 'grand-text-track', type: 'text', segments: [{
        id: 'grand-text', material_id: 'title', target_timerange: { duration: 2_000_000 }
      }] }]
    }] }]
    const result = compileDraftTemplate(template)
    expect(result.timeline.find(({ id }) => id === 'grand')).toMatchObject({ start: 3, end: 5, parentId: 'child' })
    expect(result.timeline.find(({ id }) => id === 'grand-text')).toMatchObject({ start: 3, end: 5, parentId: 'grand' })
    expect(workflowActions(result.workflow)).toHaveLength(3)
  })

  it('一句一图用三个子 Scene 顺序串联，时长改变后整体联动', () => {
    const template = createEditorPreset('sentence-image')
    const groups = template.scenes[0].tracks[0].segments.filter(isSceneSegment)
    expect(groups).toHaveLength(3)
    expect(groups.every((group) => group.auto_duration && group.tracks.length === 2)).toBe(true)
    groups[0].tracks[0].segments[0].target_timerange.duration = 7_000_000
    const model = analyzeEditorDocument({ templateJson: JSON.stringify(template) })
    expect(model.duration).toBe(17)
    expect(model.rows[0].clips.map(({ start, end }) => [start, end])).toEqual([[0, 7], [7, 12], [12, 17]])
    for (let number = 1; number <= 3; number++) {
      const text = model.timeline.find(({ id }) => id === `text-${number}`)!
      const image = model.timeline.find(({ id }) => id === `image-${number}`)!
      expect([image.start, image.end]).toEqual([text.start, text.end])
    }
  })

  it('添加 Scene 不创建素材；选中子 Scene 或它的元素后新增素材进入该子 Scene', () => {
    const template = createEditorPreset('sentence-image')
    const payload = { templateJson: JSON.stringify(template) }
    const added = addEditorElement(payload, { type: 'scene', selectedId: 'sentence-scenes' })
    const next = JSON.parse(added.templateJson)
    expect(next.scenes[0].tracks[0].segments.at(-1)).toMatchObject({
      type: 'scene', target_timerange: { start: 15_000_000, duration: 5_000_000 }, tracks: []
    })
    expect(next.materials).toEqual(template.materials)
    expect(analyzeEditorDocument(added).duration).toBe(20)
    for (const selectedId of ['text-2', 'sentence-scene-2', 'text_track_2']) {
      const result = addEditorElement(payload, { type: 'text', selectedId })
      const model = analyzeEditorDocument(result)
      expect(model.timeline.find(({ id }) => id === result.selectedId)!.parentId).toBe('sentence-scene-2')
    }
  })

  it('添加批量分镜到轨道，保留批量配置和动态输入', () => {
    const template = createEditorPreset('sentence-image')
    const payload = { templateJson: JSON.stringify(template) }
    const added = addEditorElement(payload, { type: 'batch-scene', selectedId: 'sentence-scenes' })
    const next = JSON.parse(added.templateJson)
    const segment = next.scenes[0].tracks[0].segments.at(-1)
    expect(segment).toMatchObject({
      id: added.selectedId,
      name: '批量分镜',
      type: 'scene',
      target_timerange: { start: 15_000_000, duration: 5_000_000 },
      batch_scene: { source: 'items', mode: 'repeat', items: [{ title: '分镜文案', image: '' }] },
      dynamic: ['batch_scene.items'],
      tracks: []
    })
    const model = analyzeEditorDocument(added)
    expect(model.duration).toBe(20)
    expect(model.timeline.find(({ id }) => id === added.selectedId)).toMatchObject({ type: 'composition', localStart: 15, duration: 5 })
    expect(model.dynamicInputs.find(input => input.key === `${added.selectedId}.batch_scene.items`))
      .toMatchObject({ type: 'array', defaultValue: [{ title: '分镜文案', image: '' }] })
    expect(() => compileEditorDocument(added)).not.toThrow()
  })
})
