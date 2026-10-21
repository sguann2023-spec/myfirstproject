import { expect, it } from 'vitest'
import { applyEditorAction } from './editorActions'
import { addEditorElement, analyzeEditorDocument, compileEditorDocument } from './editorModel'
import { createEditorPreset } from './editorPresets'
import type { ClipTimingAction } from './editorClipTiming'

const document = () => {
  const draft = createEditorPreset('empty')
  draft.scenes[0].target_timerange.duration = 15_000_000
  draft.materials.videos = [{ id: 'photo', type: 'photo', path: '/tmp/photo.png' }]
  draft.scenes[0].tracks = [{ id: 'track', type: 'mixed', segments: [
    { id: 'first', material_id: 'photo', target_timerange: { start: 0, duration: 3_000_000 } },
    { id: 'second', material_id: 'photo', target_timerange: { start: 5_000_000, duration: 4_000_000 } }
  ] }]
  return { templateJson: JSON.stringify(draft) }
}
const edit = (payload: { templateJson: string }, field: 'start' | 'duration', mode: ClipTimingAction['mode'], value?: number) =>
  applyEditorAction(payload, { type: 'clip-timing', id: 'second', field, mode, value })
const item = (payload: { templateJson: string }) => JSON.parse(payload.templateJson).scenes[0].tracks[0].segments[1]
const time = (payload: { templateJson: string }) => analyzeEditorDocument(payload).timeline.find(item => item.id === 'second')!

it('开始自动关联前段，固定模式解除关联并保留精确微秒', () => {
  const auto = edit(document(), 'start', 'auto')
  expect(item(auto).auto_timing.start).toEqual({ target: 'first', anchor: 'end' })
  expect(time(auto).localStart).toBe(3)
  const fixed = edit(auto, 'start', 'fixed', 3.3628)
  expect(item(fixed).auto_timing).toBeUndefined()
  expect(item(fixed).target_timerange.start).toBe(3_362_800)
  expect(time(fixed).duration).toBe(4)
})

it('结束对齐保留时长，修改固定时长后向左延伸', () => {
  const end = edit(document(), 'start', 'end')
  expect(time(end).localStart).toBe(11)
  expect(time(end).duration).toBe(4)
  expect(time(edit(end, 'duration', 'fixed', 6)).localStart).toBe(9)
  expect(() => edit(end, 'duration', 'auto')).toThrow('结束对齐需要固定时长')
  const fixed = edit(end, 'start', 'fixed', 5)
  expect(item(fixed).auto_timing).toBeUndefined()
  expect(time(fixed).localStart).toBe(5)
})

it('基础元素自动时长延续至父结束，开始仍能固定或自动', () => {
  const auto = edit(document(), 'duration', 'auto')
  expect(time(auto).localStart).toBe(5)
  expect(time(auto).duration).toBe(10)
  const moved = edit(auto, 'start', 'fixed', 6)
  expect(time(moved).localStart).toBe(6)
  expect(time(moved).duration).toBe(9)
  const linked = edit(moved, 'start', 'auto')
  expect(time(linked).localStart).toBe(3)
  expect(time(linked).duration).toBe(12)
  const fixed = edit(linked, 'duration', 'fixed', 4)
  expect(item(fixed).auto_timing.end).toBeUndefined()
  expect(time(fixed).duration).toBe(4)
})

it('旧自动规则解析为 0 时长时，仍可通过固定时长修复', () => {
  const draft = createEditorPreset('empty')
  draft.scenes[0].auto_duration = true
  delete draft.scenes[0].target_timerange.duration
  draft.materials.videos = [{ id: 'photo', type: 'photo', path: '/tmp/photo.png' }]
  draft.scenes[0].tracks = [{ id: 'track', type: 'mixed', segments: [
    { id: 'first', material_id: 'photo', target_timerange: { start: 0, duration: 5_000_000 } },
    { id: 'second', material_id: 'photo', target_timerange: {}, auto_timing: {
      start: { target: 'first', anchor: 'end' }, end: { target: 'parent', anchor: 'end' }
    } }
  ] }]
  const payload = { templateJson: JSON.stringify(draft) }
  expect(time(payload).duration).toBe(0)
  const fixed = applyEditorAction(payload, { type: 'clip-timing', id: 'second', field: 'duration', mode: 'fixed', value: 3.36 })
  expect(JSON.parse(fixed.templateJson).scenes[0].tracks[0].segments[1].target_timerange.duration).toBe(3_360_000)
  expect(time(fixed).duration).toBe(3.36)
})

it('Scene 时长固定与自动切换，内部与后续关联继续生效', () => {
  const original = { templateJson: JSON.stringify(createEditorPreset('sentence-image')) }
  const fixed = applyEditorAction(original, { type: 'clip-timing', id: 'sentence-scene-1', field: 'duration', mode: 'fixed', value: 7 })
  expect(analyzeEditorDocument(fixed).duration).toBe(17)
  const auto = applyEditorAction(fixed, { type: 'clip-timing', id: 'sentence-scene-1', field: 'duration', mode: 'auto' })
  expect(analyzeEditorDocument(auto).duration).toBe(15)
})

it('非法值和重叠事务失败，不改变原文档', () => {
  const original = document()
  const before = original.templateJson
  expect(() => edit(original, 'duration', 'fixed', 0)).toThrow()
  expect(() => edit(original, 'start', 'fixed', NaN)).toThrow()
  expect(() => edit(original, 'start', 'fixed', 1)).toThrow(/重叠|冲突/)
  expect(original.templateJson).toBe(before)
})

it('切换自动规则保留已声明的时间输入，不让 dynamic 引用失效', () => {
  const original = document()
  const draft = JSON.parse(original.templateJson)
  draft.scenes[0].tracks[0].segments[1].dynamic = ['target_timerange.start', 'target_timerange.duration']
  const payload = { templateJson: JSON.stringify(draft) }
  const auto = edit(edit(payload, 'duration', 'auto'), 'start', 'auto')
  expect(analyzeEditorDocument(auto).dynamicInputs.map(input => input.key))
    .toEqual(['second.target_timerange.start', 'second.target_timerange.duration'])
  expect(time(auto).localStart).toBe(3)
  expect(time(auto).duration).toBe(12)
  const fixed = edit(auto, 'start', 'fixed', 6)
  expect(time(fixed).localStart).toBe(6)
  expect(time(fixed).duration).toBe(9)
  const end = edit(fixed, 'start', 'end')
  expect(time(end).duration).toBe(9)
  expect(time(end).localStart).toBe(6)
})

const mediaDocument = () => {
  const draft = createEditorPreset('empty')
  draft.scenes[0].target_timerange.duration = 15_000_000
  draft.materials.videos = [{ id: 'movie', type: 'video', duration: 10_000_000, path: '/tmp/video.mp4' }]
  draft.scenes[0].tracks = [{ id: 'track', segments: [{
    id: 'second', material_id: 'movie', target_timerange: { start: 1_000_000, duration: 4_000_000 },
    source_timerange: { start: 2_000_000 }
  }] }]
  return { templateJson: JSON.stringify(draft) }
}

it('媒体时长使用源素材的剩余区间，元数据变化后重新解析', () => {
  const media = edit(mediaDocument(), 'duration', 'media')
  const draft = JSON.parse(media.templateJson)
  expect(draft.scenes[0].tracks[0].segments[0].duration_mode).toBe('media')
  expect(time(media).duration).toBe(8)
  draft.materials.videos[0].duration = 12_000_000
  expect(time({ templateJson: JSON.stringify(draft) }).duration).toBe(10)
  const fixed = edit(media, 'duration', 'fixed', 3)
  expect(time(fixed).duration).toBe(3)
  expect(JSON.parse(fixed.templateJson).scenes[0].tracks[0].segments[0].duration_mode).toBeUndefined()
})

const batchMediaDocument = () => {
  const draft = createEditorPreset('empty')
  delete draft.duration
  draft.scenes = [{
    id: 'batch', auto_duration: true, target_timerange: { start: 0 },
    batch_scene: { source: 'items', mode: 'repeat', items: [{}] },
    tracks: [], scenes: [{
      id: 'child', target_timerange: { start: 0, duration: 5_000_000 },
      tracks: [
        { id: 'audio-track', type: 'audio', segments: [{
          id: 'second', material_id: 'sound', target_timerange: { start: 0, duration: 5_000_000 },
          source_timerange: { start: 2_000_000 }
        }] },
        { id: 'text-track', type: 'text', segments: [{
          id: 'title', material_id: 'title-material', target_timerange: {}
        }] }
      ]
    }]
  }]
  draft.materials.audios = [{ id: 'sound', type: 'audio', path: '/tmp/audio.wav', duration: 12_000_000 }]
  draft.materials.texts = [{ id: 'title-material', type: 'text', content: JSON.stringify({ text: 'title' }) }]
  return { templateJson: JSON.stringify(draft) }
}

it('批量分镜 Auto 跟随隐藏子分镜的媒体时长，文字和源时长变化继续联动', () => {
  const original = batchMediaDocument()
  expect(analyzeEditorDocument(original).duration).toBe(5)
  const media = edit(original, 'duration', 'media')
  const draft = JSON.parse(media.templateJson)
  expect(draft.scenes[0].scenes[0].auto_duration).toBe(true)
  for (const duration of [12_000_000, 20_000_000, 8_000_000]) {
    draft.materials.audios[0].duration = duration
    const result = analyzeEditorDocument({ templateJson: JSON.stringify(draft) })
    const expected = duration / 1_000_000 - 2
    expect(result.duration).toBe(expected)
    for (const id of ['batch', 'child', 'second', 'title']) {
      expect(result.timeline.find(item => item.id === id)).toMatchObject({ duration: expected, end: expected })
    }
  }
  expect(analyzeEditorDocument(original).duration).toBe(5)
})

it('批量分镜时长的两种 Auto 入口均启用隐藏内容推导，固定分镜仍保持裁切', () => {
  const draft = JSON.parse(batchMediaDocument().templateJson)
  draft.scenes[0].auto_duration = false
  draft.scenes[0].target_timerange.duration = 5_000_000
  const fixed = edit({ templateJson: JSON.stringify(draft) }, 'duration', 'media')
  expect(analyzeEditorDocument(fixed).duration).toBe(5)
  for (const action of [
    { type: 'duration', id: 'batch', duration: 'auto' },
    { type: 'clip-timing', id: 'batch', field: 'duration', mode: 'auto' }
  ] as const) {
    const auto = applyEditorAction(fixed, action)
    expect(analyzeEditorDocument(auto).duration).toBe(10)
    expect(JSON.parse(auto.templateJson).scenes[0].scenes[0].auto_duration).toBe(true)
  }
})

it('在 Auto 批量分镜中继续添加内容会启用隐藏子分镜联动', () => {
  const added = addEditorElement(batchMediaDocument(), { type: 'audio', scopeId: 'batch',
    selectedId: 'audio-track', source: '/tmp/next.wav', sourceDuration: 20_000_000 })
  const result = analyzeEditorDocument(added)
  expect(result.timeline.find(item => item.id === added.selectedId)).toMatchObject({ localStart: 5, duration: 5 })
  expect(result.duration).toBe(10)
  expect(JSON.parse(added.templateJson).scenes[0].scenes[0].auto_duration).toBe(true)
})

it('媒体时长尊重显式源区间，边缘裁切切换回固定时长', () => {
  const draft = JSON.parse(mediaDocument().templateJson)
  draft.scenes[0].tracks[0].segments[0].source_timerange.duration = 6_000_000
  const media = edit({ templateJson: JSON.stringify(draft) }, 'duration', 'media')
  expect(time(media).duration).toBe(6)
  const resized = applyEditorAction(media, { type: 'retime', id: 'second', start: 1, duration: 5, edge: 'end' })
  expect(time(resized).duration).toBe(5)
})

it('手写合法循环字段可导出，不丢弃配置', () => {
  const draft = JSON.parse(mediaDocument().templateJson)
  draft.scenes[0].tracks[0].segments[0].loop = true
  const document = { templateJson: JSON.stringify(draft) }
  expect(() => compileEditorDocument(document)).not.toThrow()
  delete draft.scenes[0].tracks[0].segments[0].loop
  expect(() => compileEditorDocument({ templateJson: JSON.stringify(draft) })).not.toThrow()
})

it('循环开关不改起止或源裁切，自动时长铺满父级且最后一轮裁切', () => {
  const original = edit(mediaDocument(), 'duration', 'auto')
  const enabled = applyEditorAction(original, { type: 'clip-loop', id: 'second', enabled: true })
  const before = JSON.parse(original.templateJson).scenes[0].tracks[0].segments[0]
  const after = JSON.parse(enabled.templateJson).scenes[0].tracks[0].segments[0]
  expect(after).toEqual({ ...before, loop: true })
  expect(time(enabled)).toMatchObject({ localStart: 1, duration: 14 })
  const actions = compileEditorDocument(enabled).workflow.script
  expect(actions.map(action => action.params)).toMatchObject([
    { target_start: 1, start: 2, end: 10, duration: 8 },
    { target_start: 9, start: 2, end: 8, duration: 6 }
  ])
  const disabled = applyEditorAction(enabled, { type: 'clip-loop', id: 'second', enabled: false })
  expect(JSON.parse(disabled.templateJson).scenes[0].tracks[0].segments[0]).toEqual({ ...before, loop: false })
})

it('循环不改变媒体时长模式，缺少源时长或非媒体元素拒绝开启', () => {
  const media = edit(mediaDocument(), 'duration', 'media')
  const enabled = applyEditorAction(media, { type: 'clip-loop', id: 'second', enabled: true })
  expect(time(enabled).duration).toBe(8)
  expect(JSON.parse(enabled.templateJson).scenes[0].tracks[0].segments[0].duration_mode).toBe('media')
  const missing = JSON.parse(mediaDocument().templateJson)
  delete missing.materials.videos[0].duration
  expect(() => applyEditorAction({ templateJson: JSON.stringify(missing) }, { type: 'clip-loop', id: 'second', enabled: true })).toThrow('源时长')
  missing.scenes[0].tracks[0].segments[0].loop = true
  const recovered = applyEditorAction({ templateJson: JSON.stringify(missing) }, { type: 'clip-loop', id: 'second', enabled: false })
  expect(() => compileEditorDocument(recovered)).not.toThrow()
  expect(() => applyEditorAction(document(), { type: 'clip-loop', id: 'second', enabled: true })).toThrow('循环仅支持')
})

it('缺少媒体元数据不能误用目标时长作为源时长', () => {
  const draft = JSON.parse(mediaDocument().templateJson)
  delete draft.materials.videos[0].duration
  expect(() => edit({ templateJson: JSON.stringify(draft) }, 'duration', 'media')).toThrow(/源时长/)
  expect(() => edit(document(), 'duration', 'media')).toThrow(/源时长/)
})

it('负的解析开始时间仍可被固定开始修复为非负值', () => {
  const draft = createEditorPreset('empty')
  draft.scenes[0].target_timerange.duration = 5_000_000
  draft.materials.videos = [{ id: 'movie', type: 'video', duration: 20_000_000, path: '/tmp/video.mp4' }]
  draft.scenes[0].tracks = [{ id: 'track', segments: [{
    id: 'second', material_id: 'movie', target_timerange: { duration: 20_000_000 },
    auto_timing: { end: { target: 'parent', anchor: 'end' } }, duration_mode: 'media'
  }] }]
  const payload = { templateJson: JSON.stringify(draft) }
  expect(time(payload).localStart).toBe(-15)
  const fixed = applyEditorAction(payload, { type: 'clip-timing', id: 'second', field: 'start', mode: 'fixed', value: 0 })
  expect(time(fixed).localStart).toBe(0)
  expect(JSON.parse(fixed.templateJson).scenes[0].tracks[0].segments[0].target_timerange.start).toBe(0)
})
