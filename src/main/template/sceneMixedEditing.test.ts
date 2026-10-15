import { expect, it } from 'vitest'
import { addEditorElement, analyzeEditorDocument, compileEditorDocument } from './editorModel'
import { applyEditorAction } from './editorActions'
import { createEditorPreset } from './editorPresets'
import { normalizeDraftTemplate } from './draftTemplate'
import { workflowActions } from './workflowTestUtils'
import { indexEditorTree, sceneTimeline } from '../../components/TemplateEditor/editorView'

const initial = () => ({ templateJson: JSON.stringify(createEditorPreset('sentence-image')) })
const appendText = () => addEditorElement(initial(),
  { type: 'text', selectedId: 'sentence-scene-3', scopeId: 'scene-1' })

it('父 Scene 内选中子 Scene 添加文字，进入同轨而非子 Scene 内部', () => {
  const input = initial()
  const before = input.templateJson
  const added = addEditorElement(input,
    { type: 'text', selectedId: 'sentence-scene-3', scopeId: 'scene-1' })
  expect(input.templateJson).toBe(before)
  const draft = JSON.parse(added.templateJson)
  expect(draft.tracks).toBeUndefined()
  expect(draft.scenes).toHaveLength(1)
  expect(draft.scenes[0].tracks).toHaveLength(1)
  expect(draft.scenes[0].tracks[0].segments).toHaveLength(4)
  expect(draft.scenes[0].tracks[0].segments[2].tracks).toHaveLength(2)
  const model = analyzeEditorDocument(added)
  expect(model.timeline.find(item => item.id === added.selectedId))
    .toMatchObject({ parentId: 'scene-1', localStart: 15, duration: 5 })
  const index = indexEditorTree(model.tree)
  const view = sceneTimeline(model, index, 'scene-1')
  expect(view.rows).toHaveLength(1)
  expect(view.rows[0].clips.map(clip => clip.type)).toEqual(['composition', 'composition', 'composition', 'text'])
  expect(sceneTimeline(model, index, null).rows[0].clips.map(clip => clip.id)).toEqual(['scene-1'])
});

it('父 Scene 同轨可依次追加文字、Scene 和图片', () => {
  const text = appendText()
  const scene = addEditorElement(text, { type: 'scene', selectedId: text.selectedId, scopeId: 'scene-1' })
  const image = addEditorElement(scene,
    { type: 'image', selectedId: scene.selectedId, scopeId: 'scene-1', source: '/tmp/photo.png' })
  const model = analyzeEditorDocument(image)
  expect(model.duration).toBe(30)
  expect(model.timeline.find(item => item.id === image.selectedId))
    .toMatchObject({ parentId: 'scene-1', localStart: 25, duration: 5 })
  const view = sceneTimeline(model, indexEditorTree(model.tree), 'scene-1')
  expect(view.rows[0].clips.slice(-3).map(clip => clip.type)).toEqual(['text', 'composition', 'image'])
  expect(view.rows).toHaveLength(1)
});

it('图片、视频和音频都可与父轨道的子 Scene 混排', () => {
  for (const type of ['image', 'video', 'audio'] as const) {
    const added = addEditorElement(initial(),
      { type, selectedId: 'sentence-scene-3', scopeId: 'scene-1', source: '/tmp/media' })
    expect(analyzeEditorDocument(added).timeline.find(item => item.id === added.selectedId))
      .toMatchObject({ parentId: 'scene-1', type, localStart: 15, duration: 5 })
  }
});

it('进入子 Scene 后才向它的内部添加，不影响父混排轨道', () => {
  const added = addEditorElement(initial(), { type: 'text', scopeId: 'sentence-scene-3' })
  const model = analyzeEditorDocument(added)
  expect(model.timeline.find(item => item.id === added.selectedId))
    .toMatchObject({ parentId: 'sentence-scene-3', localStart: 0, duration: 5 })
  expect(sceneTimeline(model, indexEditorTree(model.tree), 'scene-1').rows[0].clips).toHaveLength(3)
});

it('混排后时间关联、动态输入和编译保持一致', () => {
  const added = appendText()
  const changed = applyEditorAction(added,
    { type: 'retime', id: 'text-1', start: 0, duration: 7, edge: 'end' })
  const model = analyzeEditorDocument(changed)
  expect(model.duration).toBe(22)
  expect(model.timeline.find(item => item.id === added.selectedId)).toMatchObject({ start: 17, end: 22 })
  const compiled = compileEditorDocument(changed)
  expect(workflowActions(compiled.workflow).filter(item => item.action_type === 'add_text')).toHaveLength(4)
  expect(workflowActions(compiled.workflow).filter(item => item.action_type === 'add_image')).toHaveLength(3)
  expect(compiled.dynamicInputs.map(input => input.key))
    .toEqual(compileEditorDocument(initial()).dynamicInputs.map(input => input.key))
  expect(compiled.dynamicInputs.find(input => input.key === 'text-1.target_timerange.duration')?.defaultValue)
    .toBe(7_000_000)
});

it('根层仍拒绝 tracks，且旧的选中 Scene 添加方式不误入根层', () => {
  const draft = createEditorPreset('empty')
  expect(() => normalizeDraftTemplate({ ...draft, tracks: [] })).toThrow('模版顶层仅通过 scenes')
  const added = addEditorElement(initial(),
    { type: 'text', selectedId: 'sentence-scene-2', scopeId: null })
  expect(analyzeEditorDocument(added).timeline.find(item => item.id === added.selectedId)?.parentId)
    .toBe('sentence-scene-2')
  expect(JSON.parse(added.templateJson).tracks).toBeUndefined()
});
