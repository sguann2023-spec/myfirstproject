import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { expect, it } from 'vitest'
import { applyEditorAction } from './editorActions'
import { compileDraftTemplate, type DraftTemplate } from './draftTemplate'
import { prepareExecutionWorkflow } from './testExport'
import { workflowActions } from './workflowTestUtils'

const backend = process.env.TEMPLATE_WORKFLOW_BACKEND ?? '/Users/sunguannan/pyJianYingDraft/execute_workflow.py'
const python = process.env.TEMPLATE_WORKFLOW_PYTHON ??
  (existsSync('/tmp/capcut-workflow-contract-env/bin/python') ? '/tmp/capcut-workflow-contract-env/bin/python' : 'python3')
const backendTest = it.skipIf(!existsSync(backend))

function fixture(): DraftTemplate {
  return {
    canvas_config: { width: 720, height: 1280 },
    materials: { videos: [{ id: 'image', type: 'photo', path: '/tmp/image.png' },
      { id: 'video', type: 'video', path: '/tmp/video.mp4', duration: 2_000_000 }],
      texts: [{ id: 'text', type: 'text', content: '{"text":"Hello"}' }] },
    scenes: [{ id: 'scene', target_timerange: { duration: 5_000_000 }, tracks: [
      { id: 'image-track', type: 'video', segments: [
        { id: 'photo', material_id: 'image', target_timerange: { start: 1_000_000, duration: 3_000_000 } }
      ] },
      { id: 'text-track', type: 'text', segments: [
        { id: 'caption', material_id: 'text', target_timerange: { duration: 5_000_000 } }
      ] }
    ] }]
  }
}
function edit(draft: DraftTemplate, id: string, property: string, time: number, value: number) {
  return JSON.parse(applyEditorAction({ templateJson: JSON.stringify(draft) },
    { type: 'keyframe', id, property, time, value }).templateJson) as DraftTemplate
}
function run(draft: DraftTemplate) {
  const workflow = prepareExecutionWorkflow(compileDraftTemplate(draft).workflow)
  const output = execFileSync(python, [
    'src/main/template/backendWorkflowContract.py',
    backend
  ], { input: JSON.stringify(workflow), encoding: 'utf8', timeout: 10_000 }).trim().split('\n')
  return JSON.parse(output[output.length - 1]) as Array<{ action_type: string; params: Record<string, any> }>
}

it('关键帧编辑采用原生组、微秒时间及排序，同点更新，输入不变', () => {
  const original = fixture()
  let draft = edit(original, 'photo', 'scale_x', 2, 1.5)
  draft = edit(draft, 'photo', 'scale_x', 0, 1)
  draft = edit(draft, 'photo', 'scale_x', 2, 2)
  expect(original.scenes[0].tracks[0].segments[0].common_keyframes).toBeUndefined()
  const group = draft.scenes[0].tracks[0].segments[0].common_keyframes![0]
  expect(group.property_type).toBe('KFTypeScaleX')
  expect(group.keyframe_list.map(frame => [frame.time_offset, frame.values])).toEqual([[0, [1]], [2_000_000, [2]]])
  const removed = JSON.parse(applyEditorAction({ templateJson: JSON.stringify(draft) },
    { type: 'keyframe', id: 'photo', property: 'scale_x', time: 2, remove: true }).templateJson)
  expect(removed.scenes[0].tracks[0].segments[0].common_keyframes[0].keyframe_list).toHaveLength(1)
})

it('缩短片段后仍能删除超出新时长的旧关键点', () => {
  const draft = edit(fixture(), 'photo', 'scale_x', 2, 1.5)
  draft.scenes[0].tracks[0].segments[0].target_timerange.duration = 1_000_000
  const removed = JSON.parse(applyEditorAction({ templateJson: JSON.stringify(draft) },
    { type: 'keyframe', id: 'photo', property: 'scale_x', time: 2, remove: true }).templateJson)
  expect(removed.scenes[0].tracks[0].segments[0].common_keyframes[0].keyframe_list).toHaveLength(0)
})

it('关键帧编译不额外校验未被片段引用的素材类型', () => {
  const draft = edit(fixture(), 'photo', 'alpha', 0, .5)
  draft.materials.videos.push({ id: 'unused', type: 'unknown', path: '/tmp/unused' })
  expect(workflowActions(compileDraftTemplate(draft).workflow)
    .some(action => action.action_type === 'add_video_keyframe')).toBe(true)
})

it('错误时间、数值、互斥缩放和不支持类型拒绝，不静默导出', () => {
  let draft = fixture()
  expect(() => edit(draft, 'photo', 'alpha', 4, 1)).toThrow('超出')
  expect(() => edit(draft, 'photo', 'alpha', 0, 2)).toThrow('不透明度')
  draft = edit(draft, 'photo', 'uniform_scale', 0, 1)
  expect(() => edit(draft, 'photo', 'scale_x', 0, 1)).toThrow('整体缩放')
  draft.scenes[0].tracks[0].segments[0].common_keyframes![0].keyframe_list[0].curveType = 'Ease'
  expect(() => compileDraftTemplate(draft)).toThrow('线性')
})

it('动态和静态模板均生成关键帧动作；未解析的外部引用拒绝', () => {
  const draft = edit(fixture(), 'photo', 'alpha', 0, .5)
  expect(workflowActions(compileDraftTemplate(draft).workflow).some(action => action.action_type === 'add_video_keyframe')).toBe(true)
  draft.scenes[0].keyframe_refs = ['external']
  expect(() => compileDraftTemplate(draft)).toThrow('外部关键帧')
})

backendTest('真实后端求值器：分镜关键帧递归应用全部视觉素材，在子素材边界插值', () => {
  let draft = edit(fixture(), 'scene', 'scale_x', 0, 1)
  draft = edit(draft, 'scene', 'scale_x', 5, 2)
  const actions = run(draft)
  const photo = actions.find(action => action.action_type === 'add_image')!
  const caption = actions.find(action => action.action_type === 'add_text')!
  expect(photo.params.track_name).not.toBe(caption.params.track_name)
  const frames = (track: string) => actions.filter(action => action.action_type === 'add_video_keyframe' && action.params.track_name === track)
    .map(action => [action.params.time, Number(action.params.value)])
  expect(frames(photo.params.track_name)).toEqual([[1, 1.2], [4, 1.8]])
  expect(frames(caption.params.track_name)).toEqual([[0, 1], [5, 2]])
})

backendTest('真实后端求值器：父子属性合并，相邻动画素材和循环片段不共享轨道', () => {
  let draft = edit(fixture(), 'scene', 'alpha', 0, .5)
  draft = edit(draft, 'photo', 'alpha', 0, .8)
  draft.scenes[0].tracks[0].segments.push({
    id: 'tail', material_id: 'image', target_timerange: { start: 4_000_000, duration: 1_000_000 }
  })
  draft.scenes[0].tracks.push({ id: 'video-track', type: 'video', segments: [
    { id: 'movie', material_id: 'video', loop: true, target_timerange: { duration: 5_000_000 } }
  ] })
  const actions = run(draft)
  const visuals = actions.filter(action => ['add_image', 'add_video', 'add_text'].includes(action.action_type))
  expect(new Set(visuals.map(action => action.params.track_name)).size).toBe(6)
  const photo = visuals.find(action => action.action_type === 'add_image' && action.params.start === 1)!
  expect(actions.filter(action => action.action_type === 'add_video_keyframe' && action.params.track_name === photo.params.track_name)
    .every(action => Number(action.params.value) === .4)).toBe(true)
  for (const visual of visuals) {
    const start = visual.params.target_start ?? visual.params.start
    const end = visual.action_type === 'add_video' ? start + visual.params.duration : visual.params.end
    const frames = actions.filter(action => action.action_type === 'add_video_keyframe' && action.params.track_name === visual.params.track_name)
    expect(frames[0].params.time).toBe(start)
    expect(frames[frames.length - 1].params.time).toBe(end)
  }
})

backendTest('真实后端求值器：批量分镜每项从自身起点重复动画，修改条目数仍全部生效', () => {
  let draft = fixture()
  const scene = draft.scenes[0]
  scene.auto_duration = true
  scene.dynamic = ['batch_scene.items']
  scene.batch_scene = { source: 'items', mode: 'repeat', items: [{}, {}, {}] }
  scene.scenes = [{ id: 'body', target_timerange: { duration: 5_000_000 }, tracks: scene.tracks }]
  scene.tracks = []
  draft = edit(draft, 'scene', 'position_x', 0, 0)
  draft = edit(draft, 'scene', 'position_x', 5, 1)
  const actions = run(draft)
  const captions = actions.filter(action => action.action_type === 'add_text')
  expect(captions.map(action => [action.params.start, action.params.end])).toEqual([[0, 5], [5, 10], [10, 15]])
  for (const caption of captions) {
    expect(actions.filter(action => action.action_type === 'add_video_keyframe' && action.params.track_name === caption.params.track_name)
      .map(action => [action.params.time, Number(action.params.value)]))
      .toEqual([[caption.params.start, 0], [caption.params.end, 1]])
  }
})

backendTest('真实后端求值器：嵌套批量父级动画不串实例，内层重复动画和左裁切正确合并', () => {
  let draft = fixture()
  const inner = draft.scenes[0]
  inner.auto_duration = true
  inner.dynamic = ['batch_scene.items']
  inner.batch_scene = { source: 'items', mode: 'repeat', items: [{}, {}] }
  inner.scenes = [{ id: 'body', target_timerange: { duration: 5_000_000 }, tracks: inner.tracks }]
  inner.tracks = []
  draft.scenes = [{ id: 'outer', auto_duration: true, dynamic: ['batch_scene.items'],
    target_timerange: {}, batch_scene: { source: 'items', mode: 'repeat', items: [{}, {}] },
    tracks: [], scenes: [{ id: 'outer-body', auto_duration: true, target_timerange: {}, tracks: [], scenes: [inner] }] }]
  draft = edit(draft, 'outer', 'rotation', 0, 0)
  draft = edit(draft, 'outer', 'rotation', 5, 50)
  draft = edit(draft, 'scene', 'rotation', 0, 10)
  draft = edit(draft, 'scene', 'rotation', 5, 20)
  draft.duration = 17_000_000
  const actions = run(draft)
  const captions = actions.filter(action => action.action_type === 'add_text')
  expect(captions.map(action => [action.params.start, action.params.end])).toEqual([[0, 5], [5, 10], [10, 15], [15, 17]])
  expect(captions.map(caption => actions.filter(action =>
    action.action_type === 'add_video_keyframe' && action.params.track_name === caption.params.track_name)
    .map(action => Number(action.params.value))))
    .toEqual([[10, 70], [60, 70], [10, 70], [60, 64]])
})
