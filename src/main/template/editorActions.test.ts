import { describe, expect, it } from 'vitest'
import { applyEditorAction, type EditorAction } from './editorActions'
import { addEditorElement, analyzeEditorDocument } from './editorModel'
import { createEditorPreset } from './editorPresets'
import type { DraftTemplate } from './draftTemplate'

const payload = (draft: DraftTemplate) => ({ templateJson: JSON.stringify(draft) })
const apply = (draft: DraftTemplate, action: EditorAction) => applyEditorAction(payload(draft), action)
const timing = (result: { templateJson: string }, id: string) => analyzeEditorDocument(result).timeline.find(item => item.id === id)!

describe('可撤销的编辑器操作', () => {
  it('重命名不改变原始文档，保留动态字段', () => {
    const draft = createEditorPreset('sentence-image')
    const result = apply(draft, { type: 'rename', id: 'text-1', name: '新标题' })
    expect(JSON.parse(result.templateJson).scenes[0].tracks[0].segments[0].tracks[0].segments[0].name).toBe('新标题')
    expect(JSON.stringify(draft)).not.toContain('新标题')
    expect(analyzeEditorDocument(result).dynamicInputs).toEqual(analyzeEditorDocument(payload(draft)).dynamicInputs)
  })
  it('调整一句的右端，图片、子 Scene、后续 Scene 与总时长联动', () => {
    const result = apply(createEditorPreset('sentence-image'), { type: 'retime', id: 'text-1', start: 0, duration: 7, edge: 'end' })
    expect(timing(result, 'image-1').end).toBe(7)
    expect(timing(result, 'sentence-scene-2').start).toBe(7)
    expect(analyzeEditorDocument(result).duration).toBe(17)
  })
  it('移动有关联的子 Scene 使用偏移，保留后续串联', () => {
    const result = apply(createEditorPreset('sentence-image'), { type: 'retime', id: 'sentence-scene-2', start: 6, duration: 5 })
    const child = JSON.parse(result.templateJson).scenes[0].tracks[0].segments[1]
    expect(child.auto_timing.start).toEqual({ target: 'sentence-scene-1', anchor: 'end', offset: 1_000_000 })
    expect(child.auto_duration).toBe(true)
    expect(timing(result, 'sentence-scene-3').start).toBe(11)
  })
  it('双端关联片段移动时同时调整两个锚点', () => {
    const result = apply(createEditorPreset('sentence-image'), { type: 'retime', id: 'image-1', start: 1, duration: 5 })
    const child = JSON.parse(result.templateJson).scenes[0].tracks[0].segments[0]
    expect(child.tracks[1].segments[0].auto_timing.start.offset).toBe(1_000_000)
    expect(child.tracks[1].segments[0].auto_timing.end.offset).toBe(1_000_000)
    expect(timing(result, 'image-1').localStart).toBe(1)
  })
  it('同轨重叠拒绝提交，不修改原文档', () => {
    const draft = createEditorPreset('sentence-image')
    const before = JSON.stringify(draft)
    expect(() => apply(draft, { type: 'retime', id: 'sentence-scene-2', start: 4, duration: 5 })).toThrow(/重叠|冲突/)
    expect(JSON.stringify(draft)).toBe(before)
  })
  it('同 Scene 跨轨移动，继续校验冲突及最终层级', () => {
    const draft = createEditorPreset('mixed-track')
    draft.scenes[0].tracks.push({ id: 'new', name: '新轨道', type: 'text', segments: [] })
    const result = apply(draft, { type: 'retime', id: 'mixed-photo-1', start: 0, duration: 4, trackId: 'new' })
    expect(JSON.parse(result.templateJson).scenes[0].tracks[2].type).toBe('mixed')
    expect(timing(result, 'mixed-text-1').start).toBe(4)
  })
  it('跨 Scene 移动拒绝，防止引用失效', () => {
    expect(() => apply(createEditorPreset('sentence-image'), { type: 'retime', id: 'text-1', start: 0, duration: 5, trackId: 'text_track_2' }))
      .toThrow('跨轨移动仅限当前 Scene')
  })
  it('轨道排序只改变当前 Scene 的相对层级', () => {
    const result = apply(createEditorPreset('sentence-image'), { type: 'reorder-track', id: 'image_track_1', beforeId: 'text_track_1' })
    const first = JSON.parse(result.templateJson).scenes[0].tracks[0].segments[0]
    expect(first.tracks.find(track => track.id === 'image_track_1').track_relative_index).toBe(1)
    expect(first.tracks.find(track => track.id === 'text_track_1').track_relative_index).toBe(0)
  })
  it('被其他片段引用的元素不可直接删除', () => {
    expect(() => apply(createEditorPreset('sentence-image'), { type: 'delete', id: 'text-1' })).toThrow(/引用|关联/)
  })
  it('无依赖元素可删除，素材库仍保留', () => {
    const result = apply(createEditorPreset('sentence-image'), { type: 'delete', id: 'image-1' })
    expect(analyzeEditorDocument(result).timeline.some(item => item.id === 'image-1')).toBe(false)
    expect(JSON.parse(result.templateJson).materials.videos).toHaveLength(3)
  })
  it('Scene 手动缩放改为固定时长，仍可切回自动', () => {
    const result = apply(createEditorPreset('sentence-image'), { type: 'retime', id: 'sentence-scene-1', start: 0, duration: 6, edge: 'end' })
    expect(timing(result, 'sentence-scene-2').start).toBe(6)
    const restored = applyEditorAction(result, { type: 'duration', id: 'sentence-scene-1', duration: 'auto' })
    expect(timing(restored, 'sentence-scene-2').start).toBe(5)
  })
  it('root 时长可固定和恢复自动', () => {
    const result = apply(createEditorPreset('sentence-image'), { type: 'duration', id: null, duration: 12 })
    expect(analyzeEditorDocument(result).duration).toBe(12)
    expect(analyzeEditorDocument(applyEditorAction(result, { type: 'duration', id: null, duration: 'auto' })).duration).toBe(15)
  })
  it('左端裁切媒体同步推进源起点，右端不动', () => {
    const draft = createEditorPreset('empty')
    draft.materials.videos = [{ id: 'video', type: 'video', path: '/tmp/video.mp4' }]
    draft.scenes[0].tracks = [{ id: 'v', segments: [{ id: 'clip', material_id: 'video',
      target_timerange: { start: 0, duration: 5_000_000 }, source_timerange: { start: 2_000_000, duration: 5_000_000 } }] }]
    const result = apply(draft, { type: 'retime', id: 'clip', start: 1, duration: 4, edge: 'start' })
    expect(timing(result, 'clip').sourceStart).toBe(3)
    expect(timing(result, 'clip').end).toBe(5)
  })
  it('end 锚定片段调整左端时正确更新时长', () => {
    const draft = createEditorPreset('sentence-image')
    const child = draft.scenes[0].tracks[0].segments[0] as any
    const image = child.tracks[1].segments[0]
    delete image.auto_timing.start
    image.target_timerange.duration = 5_000_000
    const result = apply(draft, { type: 'retime', id: 'image-1', start: 1, duration: 4, edge: 'start' })
    expect(timing(result, 'image-1').localStart).toBe(1)
    expect(timing(result, 'image-1').end).toBe(5)
  })
  it('未声明源区间的媒体裁切也推进源起点', () => {
    const draft = createEditorPreset('empty')
    draft.materials.videos = [{ id: 'video', type: 'video', path: '/tmp/video.mp4' }]
    draft.scenes[0].tracks = [{ id: 'v', segments: [{ id: 'clip', material_id: 'video',
      target_timerange: { start: 0, duration: 5_000_000 } }] }]
    const result = apply(draft, { type: 'retime', id: 'clip', start: 1, duration: 4, edge: 'start' })
    expect(timing(result, 'clip').sourceStart).toBe(1)
    expect(timing(result, 'clip').sourceEnd).toBe(5)
  })
  it('顶层添加 Scene 不误加到第一个 Scene 内部', () => {
    const result = addEditorElement(payload(createEditorPreset('empty')), { type: 'scene', atRoot: true })
    const draft = JSON.parse(result.templateJson)
    expect(draft.scenes).toHaveLength(2)
    expect(draft.scenes[0].tracks).toHaveLength(0)
    expect(draft.scenes[1].target_timerange.start).toBe(15_000_000)
    expect(analyzeEditorDocument(result).duration).toBe(20)
  })
})
