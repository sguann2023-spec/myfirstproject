import { describe, expect, it } from 'vitest'
import { analyzeDraftTemplate, compileDraftTemplate, normalizeDraftTemplate, type DraftSceneSegment } from './draftTemplate'
import { addEditorElement, analyzeEditorDocument, compileEditorDocument } from './editorModel'
import { createEditorPreset } from './editorPresets'
import { isSceneSegment } from './draftTracks'
import { mixedTrackFixture, workflowActions } from './workflowTestUtils'
import { executionInputName } from './inputNames'

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
    expect(compileDraftTemplate(template).workflow.script[0]).toMatchObject({
      action_type: 'add_video',
      params: { video_url: '/tmp/movie.mp4', target_start: 0, start: 14, end: 16, duration: 2 }
    })
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

  it('Scene 关键帧不因展开而丢失，递归生成内部素材动画', () => {
    const { template, child } = fixture()
    child.common_keyframes = [{
      id: 'scene-rotation', property_type: 'KFTypeRotation', keyframe_list: [{
        id: 'scene-rotation-0', time_offset: 0, values: [0]
      }]
    }]
    expect(() => analyzeDraftTemplate(template)).not.toThrow()
    expect(JSON.stringify(compileDraftTemplate(template).workflow)).toContain('add_video_keyframe')
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
      batch_scene: { source: 'items', mode: 'repeat', items: [{}] },
      dynamic: ['batch_scene.items'],
      tracks: [],
      scenes: [{ name: '分镜', target_timerange: { start: 0, duration: 5_000_000 }, tracks: [] }]
    })
    const model = analyzeEditorDocument(added)
    expect(model.duration).toBe(20)
    expect(model.timeline.find(({ id }) => id === added.selectedId)).toMatchObject({ type: 'composition', localStart: 15, duration: 5 })
    const child = segment.scenes[0]
    expect(model.timeline.find(({ id }) => id === child.id)).toMatchObject({ parentId: added.selectedId, localStart: 0, duration: 5 })
    expect(model.dynamicInputs.find(input => input.key === `${added.selectedId}.batch_scene.items`))
      .toMatchObject({ type: 'array', defaultValue: [{}] })
    expect(() => compileEditorDocument(added)).not.toThrow()
  })

  it('选中外层批量分镜添加素材时自动进入唯一子分镜', () => {
    const template = createEditorPreset('sentence-image')
    const batch = addEditorElement({ templateJson: JSON.stringify(template) }, { type: 'batch-scene', selectedId: 'sentence-scenes' })
    const added = addEditorElement(batch, { type: 'text', selectedId: batch.selectedId })
    const draft = JSON.parse(added.templateJson)
    const batchScene = draft.scenes[0].tracks[0].segments.at(-1)
    expect(batchScene.tracks).toEqual([])
    expect(batchScene.scenes).toHaveLength(1)
    expect(batchScene.scenes[0].tracks).toHaveLength(1)
    expect(batchScene.scenes[0].tracks[0].segments[0]).toMatchObject({ id: added.selectedId, name: '文字' })
    const model = analyzeEditorDocument(added)
    const batchNode = model.tree[0].children[0].children[model.tree[0].children[0].children.length - 1]
    expect(batchNode).toMatchObject({ id: batch.selectedId, name: '批量分镜' })
    expect(batchNode.children.flatMap(node => node.children).map(node => node.name)).toEqual(['文字'])
    expect(JSON.stringify(batchNode.children)).not.toContain('"name":"分镜"')
  })

  it('批量分镜内添加分镜同样进入唯一子分镜', () => {
    const template = createEditorPreset('sentence-image')
    const batch = addEditorElement({ templateJson: JSON.stringify(template) }, { type: 'batch-scene', selectedId: 'sentence-scenes' })
    const added = addEditorElement(batch, { type: 'scene', selectedId: batch.selectedId, scopeId: batch.selectedId })
    const draft = JSON.parse(added.templateJson)
    const batchScene = draft.scenes[0].tracks[0].segments.at(-1)
    expect(batchScene.tracks).toEqual([])
    expect(batchScene.scenes).toHaveLength(1)
    expect(batchScene.scenes[0].tracks).toHaveLength(1)
    expect(batchScene.scenes[0].tracks[0].segments[0]).toMatchObject({ id: added.selectedId, name: '分镜', type: 'scene' })
    const model = analyzeEditorDocument(added)
    expect(model.timeline.find(({ id }) => id === added.selectedId))
      .toMatchObject({ parentId: batchScene.scenes[0].id, localStart: 0, duration: 5 })
  })

  it('批量分镜编译为数组输入和循环子分镜 Workflow', () => {
    const draft = {
      canvas_config: { width: 720, height: 1280 },
      materials: {
        texts: [{ id: 'title-material', type: 'text', content: JSON.stringify({ text: '默认标题' }) }],
        videos: [{ id: 'image-material', type: 'photo', remote_url: 'https://example.com/default.png' }],
        audios: [{ id: 'audio-material', type: 'audio', path: '/tmp/default.mp3', duration: 5_000_000 }]
      },
      scenes: [{
        id: 'root', name: '根分镜', auto_duration: true, target_timerange: {}, tracks: [{
          id: 'root-scenes', type: 'scene', segments: [{
            id: 'batch', name: '批量分镜', type: 'scene', auto_duration: true, target_timerange: { start: 0 },
            batch_scene: { source: 'items', mode: 'repeat', items: [{ title: '分镜 A', image: '' }, { title: '分镜 B', image: '' }] },
            dynamic: ['batch_scene.items'],
            tracks: [{ id: 'batch-child-track', type: 'scene', segments: [{
              id: 'batch-child', name: '分镜', type: 'scene', target_timerange: { start: 0, duration: 5_000_000 }, tracks: [
                { id: 'batch-text-track', type: 'text', segments: [{ id: 'batch-title', name: '文字', material_id: 'title-material', target_timerange: { start: 0, duration: 5_000_000 } }] },
                { id: 'batch-image-track', type: 'video', segments: [{ id: 'batch-image', name: '图片', material_id: 'image-material', target_timerange: { start: 0, duration: 5_000_000 } }] },
                { id: 'batch-audio-track', type: 'audio', segments: [{ id: 'batch-audio', name: '音频', material_id: 'audio-material', target_timerange: { start: 0, duration: 5_000_000 }, source_timerange: { start: 0 } }] }
              ]
            }] }]
          }]
        }]
      }]
    }
    const result = compileEditorDocument({ templateJson: JSON.stringify(draft) })
    const inputName = result.workflowInputBindings.find(binding => binding.key === 'batch.batch_scene.items')!.variable
    expect(Object.keys(result.workflow.inputs).filter(key => key.startsWith('template_literal_'))).toEqual([])
    expect(result.workflow.inputs[inputName]).toEqual([
      { [executionInputName('文字')]: { text: '分镜 A' }, [executionInputName('图片')]: { image_url: 'https://example.com/default.png' }, [executionInputName('音频')]: { music_url: '/tmp/default.mp3' } },
      { [executionInputName('文字')]: { text: '分镜 B' }, [executionInputName('图片')]: { image_url: 'https://example.com/default.png' }, [executionInputName('音频')]: { music_url: '/tmp/default.mp3' } }
    ])
    const loop = result.workflow.script.find(step => step.type === 'for' && step.id === 'batch_batch_loop')! as any
    expect(loop.in).toBe(`\${${inputName}}`)
    expect(loop.loopCount).toBeUndefined()
    expect(loop.loopItem).toBeUndefined()
    expect(loop.loop.some((step: any) => step.type === 'set_var' && step.value === '${item}')).toBe(true)
    expect(JSON.stringify(loop.loop)).toContain(`.${executionInputName('文字')}.text}`)
    expect(JSON.stringify(loop.loop)).toContain(`.${executionInputName('图片')}.image_url}`)
    const audio = JSON.stringify(loop.loop).match(/"action_type":"add_audio"[\s\S]*?"params":\{([\s\S]*?)\}\}/)?.[1] ?? ''
    expect(audio).toContain('"target_start":"${__template_time_')
    expect(audio).not.toContain('"target_start":0')
  })

  it('Workflow inputs 只保留当前脚本实际引用的动态输入', () => {
    const draft = createEditorPreset('sentence-image')
    draft.scenes[0].tracks = [draft.scenes[0].tracks[0]]
    draft.scenes[0].tracks[0].segments = []
    draft.scenes[0].auto_duration = false
    draft.scenes[0].target_timerange.duration = 5_000_000
    const added = addEditorElement({ templateJson: JSON.stringify(draft) }, { type: 'batch-scene', selectedId: 'sentence-scenes' })
    const result = compileEditorDocument(added)
    expect(Object.keys(result.workflow.inputs).some(key => key.includes('text_material_1_content'))).toBe(false)
    const batchInput = result.workflowInputBindings.find(binding => binding.key === `${added.selectedId}.batch_scene.items`)!
    expect(Object.keys(result.workflow.inputs)).toEqual([batchInput.variable])
  })

  it('批量分镜和普通分镜混用时保留普通分镜新增素材输入', () => {
    const draft = createEditorPreset('sentence-image')
    draft.scenes[0].tracks[0].segments = []
    draft.scenes[0].auto_duration = false
    draft.scenes[0].target_timerange.duration = 20_000_000
    const batch = addEditorElement({ templateJson: JSON.stringify(draft) }, { type: 'batch-scene', selectedId: 'sentence-scenes' })
    const normalScene = addEditorElement(batch, { type: 'scene', selectedId: 'sentence-scenes' })
    const normalText = addEditorElement(normalScene, { type: 'text', selectedId: normalScene.selectedId })
    const result = compileEditorDocument(normalText)
    const inputKeys = Object.keys(result.workflow.inputs)
    const texts = JSON.parse(normalText.templateJson).materials.texts
    const textMaterialId = texts[texts.length - 1].id
    const batchInput = result.workflowInputBindings.find(binding => binding.key === `${batch.selectedId}.batch_scene.items`)!
    const textInput = result.workflowInputBindings.find(binding => binding.key === `${textMaterialId}.content`)!
    expect(inputKeys).toContain(batchInput.variable)
    expect(inputKeys).toContain(textInput.variable)
    expect(result.workflowInputBindings.find(binding => binding.key === `${textMaterialId}.content`))
      .toMatchObject({ runtime: true, encoding: 'text', inputPath: ['text'] })
    expect(JSON.stringify(result.workflow.script)).toContain(`${textInput.variable}.text`)
    const names: string[] = []
    function collectSetVars(steps: any[]) {
      for (const step of steps) {
        // Accumulators intentionally reassign a name; each generated step ID remains unique.
        if (step.type === 'set_var') names.push(step.id)
        collectSetVars(step.then ?? [])
        collectSetVars(step.else ?? [])
        collectSetVars(step.loop ?? [])
      }
    }
    collectSetVars(result.workflow.script)
    expect(new Set(names).size).toBe(names.length)
  })

  it('批量分镜只能直接包含一个子分镜', () => {
    const template = createEditorPreset('sentence-image')
    const batch = addEditorElement({ templateJson: JSON.stringify(template) }, { type: 'batch-scene', selectedId: 'sentence-scenes' })
    const draft = JSON.parse(batch.templateJson)
    const segment = draft.scenes[0].tracks[0].segments.at(-1)
    segment.scenes.push({ id: 'extra', name: '分镜 2', target_timerange: { start: 5_000_000, duration: 5_000_000 }, tracks: [] })
    expect(() => analyzeEditorDocument({ templateJson: JSON.stringify(draft) })).toThrow('批量分镜必须有且只有一个子分镜')
  })
})
