import { describe, expect, it } from 'vitest'
import {
  addEditorElement, analyzeEditorDocument, compileEditorDocument, legacyEditorTemplate as editorInitialTemplate, parseEditorDocument
} from './editorModel'

const document = (template = editorInitialTemplate, config: unknown = {}) => ({
  templateJson: JSON.stringify(template),
  configJson: JSON.stringify(config)
})

describe('模版编辑器数据', () => {
  it('生成可展开层级与同轨时间轴，时间与真实编译一致', () => {
    const input = document()
    const model = analyzeEditorDocument(input)
    const compiled = compileEditorDocument(input)
    expect(model.tree[0].children).toHaveLength(3)
    expect(model.rows).toHaveLength(2)
    expect(model.rows.find(({ name }) => name === 'text_main')!.clips.map(({ start, end }) => [start, end])).toEqual([
      [1.6308, 9.2838], [9.2838, 21.6308]
    ])
    expect(model.timeline).toEqual(compiled.timeline)
    expect(compiled.workflow.script.map(({ params }) => [params.track_name, params.relative_index])).toEqual([
      ['text_main', 0],
      ['text_main', 0],
      ['image_main', 0]
    ])
  })

  it('不同 scene 的同号轨道隔离，同轨同类型共享轨道', () => {
    const template = structuredClone(editorInitialTemplate)
    template.elements.push({ id: 'scene-2', type: 'composition', duration: 5,
      elements: [{ id: 'other-text', type: 'text', track: 1, text: 'Other' }] })
    const script = compileEditorDocument(document(template)).workflow.script
    expect(script[0].params.track_name).toBe(script[1].params.track_name)
    expect(script[3].params.track_name).not.toBe(script[0].params.track_name)
    expect(script[3].params.relative_index).toBe(0)
  })

  it('新增四类元素到选中内容所在 scene，不修改原 JSON', () => {
    for (const type of ['text', 'image', 'video', 'audio'] as const) {
      const input = document()
      const added = addEditorElement(input, { type, selectedId: 'text-1', source: `/tmp/test.${type}` })
      const template = JSON.parse(added.templateJson)
      const element = template.elements[0].elements.at(-1)
      expect(element).toMatchObject({ id: added.selectedId, type,
        track_relative_index: type === 'text' || type === 'image' ? 1 : 0 })
      expect(element.track_name).toBeTruthy()
      expect(element.track).toBeUndefined()
      expect(element.time).toBeUndefined()
      expect(element.target_start_time).toBe(0)
      if (type === 'video' || type === 'audio') expect(element.source_start_time).toBe(0)
      expect(element.duration).toBeUndefined()
      const model = analyzeEditorDocument({ ...input, templateJson: added.templateJson })
      expect(model.timeline.find(({ id }) => id === element.id)).toMatchObject({ start: 0, end: 21.6308 })
      expect(input).toEqual(document())
      const script = compileEditorDocument({ ...input, templateJson: added.templateJson }).workflow.script
      expect(script).toHaveLength(4)
      const last = script[script.length - 1]
      if (type === 'video') expect(last).toMatchObject({ action_type: 'add_video', params: { video_url: '/tmp/test.video' } })
      if (type === 'audio') expect(last).toMatchObject({ action_type: 'add_audio', params: { audio_url: '/tmp/test.audio' } })
    }
  })

  it('独立配置驱动时间轴，JSON 保留声明 target_start_time', () => {
    const input = document(editorInitialTemplate, {
      timing_rules: { 'text-1': { start: { element_id: 'image-1', anchor: 'start' } } }
    })
    // Keep this legacy external-config test independent of the default embedded rules.
    const template = structuredClone(editorInitialTemplate)
    delete template.timing_rules
    template.elements[0].elements![2].target_end_time = 'end'
    input.templateJson = JSON.stringify(template)
    const adjusted = analyzeEditorDocument(input)
    expect(adjusted.timeline.find(({ id }) => id === 'text-1')).toMatchObject({ start: 13.9778, end: 21.6308 })
    expect(JSON.parse(input.templateJson).elements[0].elements[0].target_start_time).toBe(1.6308)
  })

  it('无素材映射也能编辑时间轴，但不能错误地输出 workflow', () => {
    const template = structuredClone(editorInitialTemplate)
    template.elements[0].elements![2].source = 'unmapped-id'
    expect(analyzeEditorDocument(document(template)).rows).toHaveLength(2)
    expect(() => compileEditorDocument(document(template))).toThrow('sources')
  })

  it('重叠内容分行，同名 scene 的轨道键不冲突', () => {
    const template = structuredClone(editorInitialTemplate)
    template.elements[0].elements![1].target_start_time = 1
    template.elements.push({ id: 'second', name: 'Scene-Q58', type: 'composition', duration: 10,
      elements: [{ id: 'other', type: 'text', text: 'Other' }] })
    const { rows } = analyzeEditorDocument(document(template))
    expect(rows.find(({ name }) => name === 'text_main')!.lanes).toBe(2)
    expect(new Set(rows.map(({ id }) => id)).size).toBe(rows.length)
  })

  it('新增元素进入选中的嵌套 scene', () => {
    const template = structuredClone(editorInitialTemplate)
    template.elements[0].elements!.push({ id: 'nested', type: 'composition', duration: 3, elements: [] })
    const result = addEditorElement(document(template), { type: 'text', selectedId: 'nested' })
    expect(JSON.parse(result.templateJson).elements[0].elements.at(-1).elements[0].id).toBe(result.selectedId)
  })

  it('无效 JSON 或配置给出错误，不覆盖输入', () => {
    const input = { templateJson: '{', configJson: '{}' }
    expect(() => analyzeEditorDocument(input)).toThrow()
    expect(input.templateJson).toBe('{')
    for (const config of [[], null, { timing_rules: [] }, { sources: null }, { sources: { id: 4 } }, { unknown: 1 }]) {
      expect(() => parseEditorDocument(document(editorInitialTemplate, config))).toThrow()
    }
  })

  it('完全截断的元素保留层级但不显示片段', () => {
    const template = structuredClone(editorInitialTemplate)
    template.elements[0].elements![0].target_start_time = 30
    const model = analyzeEditorDocument(document(template))
    expect(model.tree[0].children).toHaveLength(3)
    expect(model.rows.flatMap(({ clips }) => clips).map(({ id }) => id)).not.toContain('text-1')
  })

  it('轨道名和排序独立，同名轨道不能混用类型或排序', () => {
    const template = structuredClone(editorInitialTemplate)
    const elements = template.elements[0].elements!
    elements[0].track_relative_index = 5
    elements[1].track_relative_index = 5
    const script = compileEditorDocument(document(template)).workflow.script
    expect(script.filter(({ action_type }) => action_type === 'add_text')
      .map(({ params }) => [params.track_name, params.relative_index])).toEqual([['text_main', 5], ['text_main', 5]])
    elements[1].track_relative_index = 4
    expect(() => compileEditorDocument(document(template))).toThrow('不一致')
    elements[1].track_relative_index = 5
    elements[2].track_name = 'text_main'
    expect(() => compileEditorDocument(document(template))).toThrow('不一致')
  })

  it('一个 JSON 中图片开始结束与 Text-8L9 一致，覆盖目标开始和 duration', () => {
    const input = { templateJson: JSON.stringify(editorInitialTemplate) }
    const compiled = compileEditorDocument(input)
    const image = compiled.workflow.script.find(({ id }) => id === 'image-1')!
    const text = compiled.workflow.script.find(({ id }) => id === 'text-2')!
    expect([image.params.start, image.params.end]).toEqual([9.2838, 21.6308])
    expect([image.params.start, image.params.end]).toEqual([text.params.start, text.params.end])
    expect(compiled.template.elements[0].elements![2].duration).toBe(7.653)
    const changed = structuredClone(editorInitialTemplate)
    changed.elements[0].elements![1].target_start_time = 4
    changed.elements[0].elements![1].duration = 3
    const result = compileEditorDocument({ templateJson: JSON.stringify(changed) })
    expect(result.workflow.script.find(({ id }) => id === 'image-1')!.params).toMatchObject({ start: 4, end: 7 })
    expect(analyzeEditorDocument(input).timeline).toEqual(compiled.timeline)
  })

  it('结束关联禁止反向区间和循环依赖', () => {
    const template = structuredClone(editorInitialTemplate)
    template.timing_rules!['image-1'].end = { element_id: 'text-1', anchor: 'start' }
    expect(() => compileEditorDocument({ templateJson: JSON.stringify(template) })).toThrow('早于')
    template.timing_rules!['image-1'].end = { element_id: 'image-1', anchor: 'end' }
    expect(() => compileEditorDocument({ templateJson: JSON.stringify(template) })).toThrow('循环')
  })

  it('单 start 关联保留 duration，省略 duration 则填充到 scene 结尾', () => {
    const template = structuredClone(editorInitialTemplate)
    delete template.timing_rules!['image-1'].end
    const compileImage = () => compileEditorDocument({ templateJson: JSON.stringify(template) })
      .workflow.script.find(({ id }) => id === 'image-1')!.params
    expect(compileImage()).toMatchObject({ start: 9.2838, end: 16.9368 })
    delete template.elements[0].elements![2].duration
    delete template.elements[0].elements![2].target_end_time
    expect(compileImage()).toMatchObject({ start: 9.2838, end: 21.6308 })
    template.timing_rules!['image-1'].start!.anchor = 'end'
    expect(compileEditorDocument({ templateJson: JSON.stringify(template) }).workflow.script
      .some(({ id }) => id === 'image-1')).toBe(false)
  })

  it('单 end 关联保留原开始时间，不要求 start 关联', () => {
    const template = structuredClone(editorInitialTemplate)
    delete template.timing_rules!['image-1'].start
    template.elements[0].elements![2].target_start_time = 2
    const result = compileEditorDocument({ templateJson: JSON.stringify(template) })
    expect(result.workflow.script.find(({ id }) => id === 'image-1')!.params)
      .toMatchObject({ start: 2, end: 21.6308 })
    expect(analyzeEditorDocument({ templateJson: JSON.stringify(template) }).timeline).toEqual(result.timeline)
  })

  it('关联字段拼写错误明确指出字段名，不误报需要两个锚点', () => {
    const template = structuredClone(editorInitialTemplate)
    const input = JSON.parse(JSON.stringify(template))
    input.timing_rules['image-1'] = { statr: { element_id: 'text-2', anchor: 'end' } }
    expect(() => compileEditorDocument({ templateJson: JSON.stringify(input) }))
      .toThrow('timing_rules.image-1.statr')
  })
})
