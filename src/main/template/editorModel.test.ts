import { describe, expect, it } from 'vitest'
import {
  addEditorElement, analyzeEditorDocument, compileEditorDocument, editorInitialTemplate, parseEditorDocument
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
    expect(model.rows[1].clips.map(({ start, end }) => [start, end])).toEqual([
      [1.6308, 9.2838], [9.2838, 21.6308]
    ])
    expect(model.timeline).toEqual(compiled.timeline)
  })

  it('新增四类元素到选中内容所在 scene，不修改原 JSON', () => {
    for (const type of ['text', 'image', 'video', 'audio'] as const) {
      const input = document()
      const added = addEditorElement(input, { type, selectedId: 'text-1', source: `/tmp/test.${type}` })
      const template = JSON.parse(added.templateJson)
      const element = template.elements[0].elements.at(-1)
      expect(element).toMatchObject({ id: added.selectedId, type, track: 3 })
      expect(element.time).toBeUndefined()
      expect(element.duration).toBeUndefined()
      const model = analyzeEditorDocument({ ...input, templateJson: added.templateJson })
      expect(model.timeline.at(-1)).toMatchObject({ start: 0, end: 21.6308 })
      expect(input).toEqual(document())
      if (type === 'video' || type === 'audio') {
        expect(() => compileEditorDocument({ ...input, templateJson: added.templateJson })).toThrow('暂不支持元素类型')
      } else expect(compileEditorDocument({ ...input, templateJson: added.templateJson }).workflow.script).toHaveLength(4)
    }
  })

  it('独立配置驱动时间轴，JSON 保留声明 time', () => {
    const input = document(editorInitialTemplate, {
      timing_rules: { 'text-1': { start: { element_id: 'image-1', anchor: 'start' } } }
    })
    const model = analyzeEditorDocument(input)
    expect(model.timeline.find(({ id }) => id === 'text-1')).toMatchObject({ start: 13.9778, end: 21.6308 })
    expect(JSON.parse(input.templateJson).elements[0].elements[0].time).toBe(1.6308)
  })

  it('无素材映射也能编辑时间轴，但不能错误地输出 workflow', () => {
    const template = structuredClone(editorInitialTemplate)
    template.elements[0].elements![2].source = 'unmapped-id'
    expect(analyzeEditorDocument(document(template)).rows).toHaveLength(2)
    expect(() => compileEditorDocument(document(template))).toThrow('sources')
  })

  it('重叠内容分行，同名 scene 的轨道键不冲突', () => {
    const template = structuredClone(editorInitialTemplate)
    template.elements[0].elements![1].time = 1
    template.elements.push({ id: 'second', name: 'Scene-Q58', type: 'composition', duration: 10,
      elements: [{ id: 'other', type: 'text', text: 'Other' }] })
    const { rows } = analyzeEditorDocument(document(template))
    expect(rows[1].lanes).toBe(2)
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
    template.elements[0].elements![0].time = 30
    const model = analyzeEditorDocument(document(template))
    expect(model.tree[0].children).toHaveLength(3)
    expect(model.rows.flatMap(({ clips }) => clips).map(({ id }) => id)).not.toContain('text-1')
  })
})
