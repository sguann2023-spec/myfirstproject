import { expect, it } from 'vitest'
import { copyEditorElement } from './editorClipboard'
import { applyEditorAction } from './editorActions'
import { analyzeEditorDocument } from './editorModel'
import { createEditorPreset } from './editorPresets'

const document = () => ({ templateJson: JSON.stringify(createEditorPreset('sentence-image')) })
const paste = (payload: { templateJson: string }, clipboard: string, id: string | null, scopeId?: string | null) =>
  applyEditorAction(payload, { type: 'paste', clipboard, id, scopeId })
const time = (payload: { templateJson: string }, id: string) =>
  analyzeEditorDocument(payload).timeline.find(item => item.id === id)!

it('复制文字在同级创建新轨道和独立素材，原文档不变且动态输入保留', () => {
  const original = document()
  const explicit = JSON.parse(original.templateJson)
  explicit.scenes[0].tracks[0].segments[1].tracks[0].segments[0].dynamic = ['target_timerange.duration']
  original.templateJson = JSON.stringify(explicit)
  const clipboard = copyEditorElement(original, 'text-2')
  const result = paste(original, clipboard, 'text-2')
  const draft = JSON.parse(result.templateJson)
  const child = draft.scenes[0].tracks[0].segments[1]
  expect(child.tracks).toHaveLength(3)
  const copy = child.tracks.at(-1).segments[0]
  expect(copy.id).not.toBe('text-2')
  expect(copy.material_id).not.toBe('text-material-2')
  expect(time(result, copy.id)).toMatchObject({ localStart: 0, duration: 5 })
  expect(draft.materials.texts.find((item: any) => item.id === copy.material_id).content)
    .toBe(draft.materials.texts.find((item: any) => item.id === 'text-material-2').content)
  expect(analyzeEditorDocument(result).dynamicInputs.some(input => input.key === `${copy.id}.target_timerange.duration`)).toBe(true)
  expect(JSON.parse(original.templateJson).scenes[0].tracks[0].segments[1].tracks).toHaveLength(2)
})

it('复制整个分镜递归换 ID，内部时间关联指向副本，外部关联脱离原分镜', () => {
  const original = document()
  const result = paste(original, copyEditorElement(original, 'sentence-scene-2'), 'sentence-scene-2')
  const draft = JSON.parse(result.templateJson)
  const copy = draft.scenes[0].tracks.at(-1).segments[0]
  const text = copy.tracks[0].segments[0]
  const image = copy.tracks[1].segments[0]
  expect(copy.id).not.toBe('sentence-scene-2')
  expect(image.auto_timing.start.target).toBe(text.id)
  expect(image.auto_timing.end.target).toBe(text.id)
  expect(copy.auto_timing.start).toEqual({ target: 'parent', anchor: 'start', offset: 5_000_000 })
  expect(time(result, result.selectedId)).toMatchObject({ localStart: 5, duration: 5 })
  expect(time(result, image.id)).toMatchObject({ parentId: copy.id, duration: 5 })
})

it('根分镜副本追加到根末尾，所有内部引用重建且根固定时长相应增长', () => {
  const draft = createEditorPreset('sentence-image')
  draft.duration = 15_000_000
  const original = { templateJson: JSON.stringify(draft) }
  const result = paste(original, copyEditorElement(original, 'scene-1'), 'scene-1')
  const next = JSON.parse(result.templateJson)
  expect(next.scenes).toHaveLength(2)
  expect(next.duration).toBe(30_000_000)
  expect(time(result, result.selectedId)).toMatchObject({ localStart: 15, duration: 15, end: 30 })
  const children = next.scenes[1].tracks[0].segments
  expect(children[1].auto_timing.start.target).toBe(children[0].id)
  expect(children[2].auto_timing.start.target).toBe(children[1].id)
})

it('无选中元素时粘贴到当前分镜内部，选中轨道时复制整条轨道', () => {
  const original = document()
  const result = paste(original, copyEditorElement(original, 'text_track_1'), null, 'sentence-scene-2')
  const draft = JSON.parse(result.templateJson)
  const child = draft.scenes[0].tracks[0].segments[1]
  expect(child.tracks).toHaveLength(3)
  expect(child.tracks.at(-1).id).toBe(result.selectedId)
  expect(child.tracks.at(-1).segments).toHaveLength(1)
  expect(child.tracks.at(-1).track_relative_index).toBe(2)
})

it('源元素删除后仍可粘贴，连续粘贴每次分配不同 ID', () => {
  const original = document()
  const clipboard = copyEditorElement(original, 'text-2')
  const deleted = applyEditorAction(original, { type: 'delete', id: 'sentence-scene-2' })
  const first = paste(deleted, clipboard, null, 'sentence-scene-1')
  const second = paste(first, clipboard, first.selectedId)
  expect(second.selectedId).not.toBe(first.selectedId)
  expect(time(second, first.selectedId).duration).toBe(5)
  expect(time(second, second.selectedId).duration).toBe(5)
})

it('图片外部时间关联转换为父级固定偏移，保留原始 SVG 路径', () => {
  const draft = createEditorPreset('sentence-image')
  draft.materials.videos[0].remote_url = '/tmp/original.svg'
  const original = { templateJson: JSON.stringify(draft) }
  const result = paste(original, copyEditorElement(original, 'image-1'), 'image-1')
  const next = JSON.parse(result.templateJson)
  const copy = next.scenes[0].tracks[0].segments[0].tracks.at(-1).segments[0]
  expect(copy.auto_timing).toEqual({
    start: { target: 'parent', anchor: 'start', offset: 0 },
    end: { target: 'parent', anchor: 'start', offset: 5_000_000 }
  })
  expect(next.materials.videos.find((material: any) => material.id === copy.material_id).remote_url).toBe('/tmp/original.svg')
  expect(time(result, result.selectedId).duration).toBe(5)
})

it('跨文档粘贴自带素材与完整批量分镜，保持包装器仅含一个子分镜', () => {
  const draft = createEditorPreset('sentence-image')
  const child = draft.scenes[0].tracks[0].segments[0]
  draft.scenes[0].tracks[0].segments = [child]
  child.batch_scene = { source: 'items', mode: 'repeat', items: [{ title: 'test' }] }
  const only = { id: 'inner', type: 'scene', auto_duration: true, target_timerange: { start: 0 }, tracks: child.tracks }
  child.tracks = []
  child.scenes = [only]
  const source = { templateJson: JSON.stringify(draft) }
  const target = { templateJson: JSON.stringify(createEditorPreset('empty')) }
  const result = paste(target, copyEditorElement(source, child.id), null, 'scene-1')
  const next = JSON.parse(result.templateJson)
  const copy = next.scenes[0].tracks[0].segments[0]
  expect(copy.tracks).toHaveLength(0)
  expect(copy.scenes).toHaveLength(1)
  expect(copy.batch_scene.items).toEqual([{ title: 'test' }])
  expect(next.materials.texts).toHaveLength(1)
  expect(next.materials.videos).toHaveLength(1)
  expect(time(result, result.selectedId).duration).toBe(5)
})

it('非法剪贴板和不存在的目标事务失败，不改写原文档', () => {
  const original = document()
  const before = original.templateJson
  expect(() => paste(original, 'hello', null)).toThrow('请先复制')
  expect(() => paste(original, '{}', null)).toThrow('剪贴板')
  expect(() => copyEditorElement(original, 'missing')).toThrow('请选择')
  expect(() => paste(original, copyEditorElement(original, 'text-1'), 'missing')).toThrow('目标不存在')
  expect(original.templateJson).toBe(before)
})

it('媒体模式、源区间与关键帧完整保留，引用同步改为副本 ID', () => {
  const draft = createEditorPreset('empty')
  draft.materials.audios = [{ id: 'sound', type: 'audio', path: '/tmp/original.flac', duration: 10_000_000 }]
  draft.scenes[0].tracks = [{ id: 'audio-track', type: 'audio', segments: [{
    id: 'voice', material_id: 'sound', duration_mode: 'media', target_timerange: { start: 0, duration: 5_000_000 },
    source_timerange: { start: 2_000_000 },
    common_keyframes: [{ id: 'group', property_type: 'volume', material_id: 'sound',
      keyframe_list: [{ id: 'frame', time_offset: 0, values: [1] }] }],
    keyframe_refs: ['group']
  }] }]
  const original = { templateJson: JSON.stringify(draft) }
  const result = paste(original, copyEditorElement(original, 'voice'), 'voice')
  const next = JSON.parse(result.templateJson)
  const copy = next.scenes[0].tracks.at(-1).segments[0]
  expect(copy.duration_mode).toBe('media')
  expect(copy.source_timerange).toEqual({ start: 2_000_000 })
  expect(time(result, result.selectedId).duration).toBe(8)
  expect(copy.common_keyframes[0].id).not.toBe('group')
  expect(copy.common_keyframes[0].keyframe_list[0].id).not.toBe('frame')
  expect(copy.keyframe_refs).toEqual([copy.common_keyframes[0].id])
  expect(copy.common_keyframes[0].material_id).toBe(copy.material_id)
  expect(next.materials.audios.find((material: any) => material.id === copy.material_id).path).toBe('/tmp/original.flac')
})
