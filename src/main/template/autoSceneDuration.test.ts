import { describe, expect, it } from 'vitest'
import { analyzeDraftTemplate, compileDraftTemplate, type DraftTemplate } from './draftTemplate'
import { createEditorPreset } from './editorPresets'
import { addEditorElement, analyzeEditorDocument } from './editorModel'

const fixture = () => createEditorPreset('mixed-track')
const last = (template: DraftTemplate) => template.scenes[0].tracks[1].segments[3]
const payload = (template: DraftTemplate) => ({ templateJson: JSON.stringify(template) })

describe('Scene 按内部内容自适应时长', () => {
  it('混排预设默认自动推导，增长、缩短及父级填充均跟随，保留原 JSON', () => {
    const template = fixture()
    expect(template.duration).toBeUndefined()
    expect(template.scenes[0].auto_duration).toBe(true)
    expect(template.scenes[0].target_timerange.duration).toBeUndefined()
    for (const [duration, total] of [[8_000_000, 20], [2_000_000, 14]]) {
      last(template).target_timerange.duration = duration
      const before = structuredClone(template)
      const result = compileDraftTemplate(template)
      expect(result.duration).toBe(total)
      expect(result.timeline.find(({ id }) => id === 'scene-1')).toMatchObject({ duration: total, end: total })
      expect(result.timeline.find(({ id }) => id === 'mixed-underlay')).toMatchObject({ start: 0, end: total })
      expect(template).toEqual(before)
      expect(result.template).toEqual(before)
    }
  })

  it('推导最晚目标结束而不是时长之和，不探测源长度', () => {
    const template = fixture()
    const scene = template.scenes[0]
    scene.target_timerange.start = 5_000_000
    scene.tracks[1].segments = [scene.tracks[1].segments[0]]
    scene.tracks[1].segments[0].target_timerange = { start: 3_000_000, duration: 2_000_000 }
    const result = analyzeDraftTemplate(template)
    expect(result.duration).toBe(10)
    expect(result.timeline.find(({ id }) => id === 'scene-1')).toMatchObject({ start: 5, duration: 5, end: 10 })
    scene.tracks[1].segments[0].material_id = 'sound'
    scene.tracks[1].segments[0].source_timerange = { start: 50_000_000, duration: 100_000_000 }
    template.materials.audios = [{ id: 'sound', type: 'extract_music', path: '/tmp/audio.wav' }]
    expect(analyzeDraftTemplate(template).duration).toBe(10)
  })

  it('自动开始关联参与推导，后一个 Scene 可跟随前一个 Scene 的结束', () => {
    const template = fixture()
    const first = template.scenes[0]
    first.tracks[1].segments = first.tracks[1].segments.slice(0, 2)
    first.tracks[1].segments[0].target_timerange.duration = 2_000_000
    template.scenes.push({
      id: 'next', auto_duration: true, target_timerange: {},
      auto_timing: { start: { target: 'scene-1', anchor: 'end' } },
      tracks: [{ id: 'next-track', type: 'text', segments: [{
        id: 'next-text', material_id: 'mixed-text-material-1', target_timerange: { duration: 3_000_000 }
      }] }]
    })
    const model = analyzeEditorDocument(payload(template))
    expect(model.duration).toBe(9)
    expect(model.timeline.find(({ id }) => id === 'scene-1')).toMatchObject({ duration: 6 })
    expect(model.timeline.find(({ id }) => id === 'next')).toMatchObject({ start: 6, duration: 3, end: 9 })
  })

  it('嵌套逐层推导，显式父级和根时长仍会裁切，不反向缩短内容声明', () => {
    const template = fixture()
    const child = template.scenes[0]
    child.target_timerange.start = 3_000_000
    template.scenes = [{
      id: 'outer', auto_duration: true, target_timerange: { start: 2_000_000 },
      tracks: [], scenes: [child]
    }]
    let result = analyzeDraftTemplate(template)
    expect(result.duration).toBe(21)
    expect(result.timeline.find(({ id }) => id === 'outer')).toMatchObject({ duration: 19, end: 21 })
    template.duration = 12_000_000
    result = analyzeDraftTemplate(template)
    expect(result.duration).toBe(12)
    expect(result.timeline.find(({ id }) => id === 'scene-1')).toMatchObject({ start: 5, duration: 16, end: 12 })
    template.scenes[0].auto_duration = false
    template.scenes[0].target_timerange.duration = 8_000_000
    expect(analyzeDraftTemplate(template).timeline.find(({ id }) => id === 'scene-1'))
      .toMatchObject({ start: 5, duration: 16, end: 10 })
  })

  it('父结尾片段与默认铺满片段不反向决定 Scene，独立 parent.start 偏移可参与', () => {
    const template = fixture()
    const scene = template.scenes[0]
    scene.tracks[1].segments = [scene.tracks[1].segments[0]]
    const driver = scene.tracks[1].segments[0]
    driver.target_timerange = { duration: 2_000_000 }
    driver.auto_timing = { start: { target: 'parent', anchor: 'start', offset: 3_000_000 } }
    driver.dynamic = ['target_timerange.duration', 'auto_timing.start.offset']
    scene.tracks.push({ id: 'footer-track', type: 'text', segments: [{
      id: 'footer', material_id: 'mixed-text-material-1',
      target_timerange: { duration: 1_000_000 },
      auto_timing: { end: { target: 'parent', anchor: 'end' } }
    }] })
    const result = analyzeDraftTemplate(template)
    expect(result.duration).toBe(5)
    expect(result.timeline.find(({ id }) => id === 'footer')).toMatchObject({ start: 4, end: 5 })
    expect(result.timeline.find(({ id }) => id === 'mixed-underlay')).toMatchObject({ start: 0, end: 5 })
  })

  it('旧 Scene 默认保持父级填充；自动模式忽略旧固定范围，需独立有限内容', () => {
    const template = fixture()
    template.duration = 30_000_000
    template.scenes[0].auto_duration = false
    expect(analyzeDraftTemplate(template).timeline.find(({ id }) => id === 'scene-1')!.duration).toBe(30)
    template.scenes[0].auto_duration = true
    template.scenes[0].target_timerange.duration = 30_000_000
    expect(analyzeDraftTemplate(template).timeline.find(({ id }) => id === 'scene-1')!.duration).toBe(16)
    template.scenes[0].tracks.splice(1)
    expect(() => analyzeDraftTemplate(template)).toThrow('无法从内部内容推导')
    template.scenes[0].tracks = []
    expect(() => analyzeDraftTemplate(template)).toThrow('无法从内部内容推导')
  })

  it('非法开关、Scene 自身结束锚定和循环关联给出明确错误', () => {
    const template = fixture()
    template.scenes[0].auto_duration = 'yes' as any
    expect(() => analyzeDraftTemplate(template)).toThrow('布尔值')
    template.scenes[0].auto_duration = true
    template.scenes[0].auto_timing = { end: { target: 'parent', anchor: 'end' } }
    expect(() => analyzeDraftTemplate(template)).toThrow('不能同时设置分镜结束锚点')
    delete template.scenes[0].auto_timing
    template.scenes[0].tracks[1].segments[0].auto_timing = { start: { target: 'mixed-text-1', anchor: 'end' } }
    expect(() => analyzeDraftTemplate(template)).toThrow('循环依赖')
  })

  it('向自动 Scene 轨道末尾新增片段会延长 Scene，新增片段有明确默认时长', () => {
    const template = fixture()
    const added = addEditorElement(payload(template), { type: 'text', selectedId: 'mixed-main-track' })
    const model = analyzeEditorDocument(added)
    expect(model.duration).toBe(21)
    expect(model.timeline.find(({ id }) => id === added.selectedId)).toMatchObject({ start: 16, end: 21, duration: 5 })
    expect(JSON.parse(added.templateJson).scenes[0].auto_duration).toBe(true)
  })
})
