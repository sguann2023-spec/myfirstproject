import { describe, expect, it } from 'vitest'
import { compileSceneTemplate, type SceneTemplate, type TimingRule } from './sceneTemplate'

function template(): SceneTemplate {
  return {
    width: 720, height: 1280,
    elements: [{
      id: 'scene', type: 'composition', duration: 21.6308,
      elements: [
        { id: 'text', type: 'text', track: 1, target_start_time: 1.6308, duration: 7.653,
          text: 'Your text here', x: '14.8431%', y: '12.4046%',
          x_anchor: '0%', y_anchor: '0%', font_family: 'Noto Sans',
          font_size: '7 vmin', fill_color: '#939393' },
        { id: 'image', type: 'image', track: 2, target_start_time: 0, duration: 7.653,
          height: '75%', source: '/tmp/image.png' }
      ]
    }]
  }
}

describe('独立时间关联与文字', () => {
  it('文字和图片的时间独立，保留未适配的外观并返回警告', () => {
    const result = compileSceneTemplate(template())
    expect(result.workflow.script[0]).toMatchObject({
      action_type: 'add_text', params: { start: 1.6308, end: 9.2838, text: 'Your text here', font_color: '#939393' }
    })
    expect(result.workflow.script[1].params).toMatchObject({ start: 0, end: 7.653 })
    expect(result.warnings).toContain('text.font_size=7 vmin 旧版字号未适配，请使用 configuration.font_size 原生属性配置')
    expect(result.workflow.script[0].params).not.toHaveProperty('font_size')
  })

  it('原生字号配置正常导出，不产生旧版字号警告', () => {
    const input = template()
    const text = input.elements[0].elements![0]
    delete text.font_size
    text.configuration = { font_size: 30 }
    const result = compileSceneTemplate(input)
    expect(result.workflow.script[0].params.font_size).toBe(30)
    expect(result.warnings.some(warning => warning.includes('字号'))).toBe(false)
  })

  it('前向引用不依赖 track 顺序，独立配置优先于 target_start_time', () => {
    const input = template()
    const rules: Record<string, TimingRule> = {
      text: { start: { element_id: 'image', anchor: 'end', offset: 0 } }
    }
    expect(compileSceneTemplate(input, { timing_rules: rules }).workflow.script[0].params)
      .toMatchObject({ start: 7.653, end: 15.306 })
    expect(input.elements[0].elements![0].target_start_time).toBe(1.6308)
    rules.text.start.anchor = 'start'
    rules.text.start.offset = 0.5
    expect(compileSceneTemplate(input, { timing_rules: rules }).workflow.script[0].params)
      .toMatchObject({ start: 0.5, end: 8.153 })
  })

  it('文字省略时长时延伸到结尾，也支持 end 和省略 target_start_time', () => {
    const input = template()
    const text = input.elements[0].elements![0]
    delete text.target_start_time
    text.target_end_time = 'end'
    expect(compileSceneTemplate(input).workflow.script[0].params).toMatchObject({ start: 13.9778, end: 21.6308 })
    delete text.target_end_time
    delete text.duration
    expect(compileSceneTemplate(input).workflow.script[0].params).toMatchObject({ start: 0, end: 21.6308 })
    expect(compileSceneTemplate(input, {
      timing_rules: { text: { start: { element_id: 'image', anchor: 'end' } } }
    }).workflow.script[0].params).toMatchObject({ start: 7.653, end: 21.6308 })
  })

  it('按声明结尾关联再截断，支持负 offset', () => {
    const input = template()
    input.elements[0].duration = 10
    input.elements[0].elements![1].duration = 20
    const result = compileSceneTemplate(input, {
      timing_rules: { text: { start: { element_id: 'image', anchor: 'end' } } }
    })
    expect(result.workflow.script.map((step) => step.id)).toEqual(['image'])
    const early = compileSceneTemplate(template(), {
      timing_rules: { text: { start: { element_id: 'image', anchor: 'start', offset: -2 } } }
    })
    expect(early.workflow.script[0].params).toMatchObject({ start: 0, end: 5.653 })
  })

  it('拒绝不存在的引用、循环依赖和无效 offset', () => {
    for (const rules of [
      { text: { start: { element_id: 'missing', anchor: 'start' } } },
      { text: { start: { element_id: 'image', anchor: 'start' } },
        image: { start: { element_id: 'text', anchor: 'end' } } },
      { text: { start: { element_id: 'image', anchor: 'start', offset: NaN } } }
    ]) {
      expect(() => compileSceneTemplate(template(), { timing_rules: rules as Record<string, TimingRule> })).toThrow()
    }
  })
})
