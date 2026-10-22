import { describe, expect, it } from 'vitest'
import { applyDynamicInputs, getDynamicInputs } from './dynamicInputs'
import { createEditorPreset } from './editorPresets'
import { analyzeDraftTemplate, compileDraftTemplate, normalizeDraftTemplate } from './draftTemplate'
import { analyzeEditorDocument, compileEditorDocument } from './editorModel'
import { flatSentenceImageFixture, workflowActions } from './workflowTestUtils'
import { inputName } from './inputNames'

const fixture = flatSentenceImageFixture
const textSegment = (template: ReturnType<typeof fixture>) => template.scenes[0].tracks[0].segments[0]

describe('剪映字段 dynamic 输入', () => {
  it('从素材和片段发现输入，不使用展示名或 Creatomate 字段', () => {
    const template = fixture()
    const inputs = getDynamicInputs(template)
    expect(inputs).toHaveLength(12)
    expect(inputs.find(({ key }) => key === 'text-material-1.content')).toMatchObject({
      targetId: 'text-material-1', property: 'content', type: 'string',
      defaultValue: template.materials.texts[0].content
    })
    expect(inputs.find(({ key }) => key === 'text-1.target_timerange.start'))
      .toMatchObject({ type: 'number', defaultValue: 0 })
    expect(getDynamicInputs(createEditorPreset('empty'))).toEqual([])
  })

  it('替换文字、图片和微秒区间后，关联图片与 Workflow 同步，不改原文', () => {
    const template = fixture()
    const before = structuredClone(template)
    const modifications = {
      'text-material-1.content': JSON.stringify({ text: '价格是 ${price}，1+1="2"' }),
      'image-material-1.remote_url': '/tmp/replacement.png',
      'text-1.target_timerange.start': 1_000_000,
      'text-1.target_timerange.duration': 2_000_000
    }
    const payload = { templateJson: JSON.stringify(template), modifications }
    const result = compileEditorDocument(payload)
    expect(result.workflow.inputs).toMatchObject({
      [inputName('第_1_句话', new Set())]: { text: '价格是 ${price}，1+1="2"' },
      [inputName('第_1_张图片', new Set())]: { image_url: '/tmp/replacement.png' },
      input_text_1_target_timerange_start: 1_000_000,
      input_text_1_target_timerange_duration: 2_000_000
    })
    expect(workflowActions(result.workflow).find(({ id }) => id === 'text-1')!.params.text)
      .toBe(`\${${inputName('第_1_句话', new Set())}.text}`)
    for (const id of ['text-1', 'image-1']) {
      expect(result.timeline.find((item) => item.id === id)).toMatchObject({ start: 1, end: 3 })
    }
    expect(analyzeEditorDocument(payload).timeline).toEqual(result.timeline)
    expect(compileDraftTemplate(template, modifications).workflow).toEqual(result.workflow)
    expect(analyzeDraftTemplate(template, modifications).timeline).toEqual(result.timeline)
    expect(result.dynamicInputs.find(({ key }) => key === 'text-1.target_timerange.start')!.defaultValue).toBe(0)
    expect(template).toEqual(before)
    expect(payload.templateJson).toBe(JSON.stringify(before))
  })

  it('不传输入使用默认值；根路径可暴露画布与时长', () => {
    const template = fixture()
    expect(applyDynamicInputs(template)).toEqual(template)
    template.dynamic = ['canvas_config.width', 'duration']
    const result = compileDraftTemplate(template, { 'canvas_config.width': 1080, duration: 10_000_000 })
    expect(result.workflow.width).toBe(1080)
    expect(result.duration).toBe(10)
    expect(result.timeline.find(({ id }) => id === 'image-3')!.visible).toBe(false)
  })

  it('数组是整体替换，可更改片段数量，但必须提供完整剪映结构', () => {
    const template = fixture()
    const track = template.scenes[0].tracks[0]
    track.dynamic = ['segments']
    const segments = [structuredClone(track.segments[0]), {
      ...structuredClone(track.segments[0]), id: 'text-extra',
      target_timerange: { start: 12_000_000, duration: 1_000_000 }
    }]
    const result = compileDraftTemplate(template, { [`${track.id}.segments`]: segments })
    expect(workflowActions(result.workflow)).toHaveLength(7)
    expect(result.timeline.find(({ id }) => id === 'text-extra')).toMatchObject({ start: 12, end: 13 })
    expect(() => compileDraftTemplate(template, { [`${track.id}.segments`]: ['第一句话'] })).toThrow()
    expect(track.segments).toHaveLength(1)
  })

  it('关键帧声明原生数组与微秒字段，编译时应用动态替换并导出动画', () => {
    const template = fixture()
    const segment = template.scenes[0].tracks[1].segments[0]
    segment.common_keyframes = [{
      id: 'scale-group', property_type: 'KFTypeScaleY', keyframe_list: [{
        id: 'keyframe-1', time_offset: 0, values: [1], dynamic: ['time_offset', 'values']
      }]
    }]
    const modifications = { 'keyframe-1.time_offset': 1_000_000, 'keyframe-1.values': [1.5] }
    const result = applyDynamicInputs(template, modifications)
    expect(result.scenes[0].tracks[1].segments[0].common_keyframes![0].keyframe_list[0])
      .toMatchObject({ time_offset: 1_000_000, values: [1.5] })
    expect(analyzeDraftTemplate(template, modifications).timeline).toHaveLength(7)
    expect(JSON.stringify(compileDraftTemplate(template, modifications).workflow)).toContain('add_video_keyframe')
    expect(() => analyzeDraftTemplate(template, { 'keyframe-1.values': [] })).toThrow('values')
  })

  it('拒绝错误声明、旧字段、字符串内部路径和重复键', () => {
    for (const dynamic of [true, ['text'], ['content.text'], ['content', 'content'], ['__proto__'], ['id'], [4]]) {
      const template = fixture()
      ;(template.materials.texts[0] as Record<string, unknown>).dynamic = dynamic
      expect(() => normalizeDraftTemplate(template)).toThrow('dynamic')
    }
    const template = fixture()
    template.materials.texts[1].id = template.materials.texts[0].id
    expect(() => getDynamicInputs(template)).toThrow('不唯一')
    const nested = fixture()
    nested.canvas_config.dynamic = ['width']
    expect(() => getDynamicInputs(nested)).toThrow('id')
  })

  it('拒绝未声明输入、非法类型、重叠替换和非法时间，保持输入不变', () => {
    const template = fixture()
    const before = structuredClone(template)
    for (const modifications of [null, [], { 'unknown.text': 'x' },
      { 'text-material-1.content': {} }, { 'text-1.target_timerange.start': '1000000' },
      { 'text-material-1.content': undefined }]) {
      expect(() => applyDynamicInputs(template, modifications as Record<string, unknown>)).toThrow()
    }
    expect(() => compileDraftTemplate(template, { 'text-1.target_timerange.duration': 0 })).toThrow('大于 0')
    expect(() => compileDraftTemplate(template, { 'text-material-1.content': 'not JSON' })).toThrow('JSON')
    expect(template).toEqual(before)
    textSegment(template).dynamic!.push('target_timerange')
    expect(() => applyDynamicInputs(template, {
      'text-1.target_timerange': { start: 0, duration: 5_000_000 },
      'text-1.target_timerange.start': 1_000_000
    })).toThrow('重叠')
  })
})
