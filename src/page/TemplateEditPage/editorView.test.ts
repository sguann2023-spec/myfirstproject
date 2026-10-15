import { expect, it } from 'vitest'
import { analyzeEditorDocument } from '../../main/template/editorModel'
import { createEditorPreset } from '../../main/template/editorPresets'
import { dragTiming, indexEditorTree, sceneTimeline, snapTime } from '../../components/TemplateEditor/editorView'

it('根层只显示顶层 Scene，子层使用局部时间而非全局时间', () => {
  const model = analyzeEditorDocument({ templateJson: JSON.stringify(createEditorPreset('sentence-image')) })
  const index = indexEditorTree(model.tree)
  expect(sceneTimeline(model, index, null).rows[0].clips.map(clip => clip.id)).toEqual(['scene-1'])
  expect(sceneTimeline(model, index, 'scene-1').rows).toHaveLength(1)
  const second = sceneTimeline(model, index, 'sentence-scene-2')
  expect(second.duration).toBe(5)
  expect(second.rows.map(row => row.clips[0].start)).toEqual([0, 0])
  expect(second.path.map(node => node.id)).toEqual(['scene-1', 'sentence-scene-2'])
})

it('吸附阈值以像素计，Ctrl 禁用而 Alt 使用 0.1 秒精度', () => {
  expect(snapTime(1.95, [0, 2], 100)).toBe(2)
  expect(snapTime(1.8, [0, 2], 100)).toBe(1.8)
  expect(snapTime(1.95, [0, 2], 100, { ctrlKey: true })).toBe(1.95)
  expect(snapTime(1.96, [0, 2], 100, { altKey: true }, false)).toBe(2)
})

it('移动两端均可吸附，调整边缘不允许负开始或零长度', () => {
  const clip = { start: 2, end: 4 }
  expect(dragTiming(clip, .97, undefined, [5], 100, {}, true)).toEqual({ start: 3, duration: 2 })
  expect(dragTiming(clip, -10, undefined, [], 100, {}, false)).toEqual({ start: 0, duration: 2 })
  expect(dragTiming(clip, 10, 'start', [], 100, {}, false).start).toBeCloseTo(3.99)
  expect(dragTiming(clip, -10, 'end', [], 100, {}, false).duration).toBeCloseTo(.01)
})
