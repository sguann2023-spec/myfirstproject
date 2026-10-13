import { describe, expect, it } from 'vitest'
import { compileImageTemplate, exampleImageTemplate } from './imageTemplate'

describe('单图片模版转换', () => {
  it('转换提供的 Creatomate 示例并清理路径首尾空白', () => {
    const source = structuredClone(exampleImageTemplate)
    source.elements[0].source += ' \n'
    const result = compileImageTemplate(source)
    expect(result.workflow.script[0].params).toMatchObject({
      image_url: exampleImageTemplate.elements[0].source,
      track_name: 'Image-TSS',
      start: 0, end: 9.5, width: 720, height: 1280
    })
    expect(source.elements[0].source).toContain('\n')
  })

  it('将起止时间映射为模版 time/duration 和 workflow start/end', () => {
    const result = compileImageTemplate(exampleImageTemplate, { source: '/tmp/image.png', start: 2, end: 5 })
    expect(result.template.elements[0]).toMatchObject({ time: 2, duration: 3, source: '/tmp/image.png' })
    expect(result.workflow.script[0].params).toMatchObject({ start: 2, end: 5 })
  })

  it('拒绝无效起止时间和空素材', () => {
    for (const input of [
      { start: -1 }, { start: 3, end: 3 }, { end: 10 }, { end: NaN },
      { source: ' ' }, { start: null as unknown as number }
    ]) {
      expect(() => compileImageTemplate(exampleImageTemplate, input)).toThrow()
    }
  })

  it('拒绝静默丢失图片属性', () => {
    const source = structuredClone(exampleImageTemplate)
    Object.assign(source.elements[0], { animations: [] })
    expect(() => compileImageTemplate(source)).toThrow('animations')
  })
})
