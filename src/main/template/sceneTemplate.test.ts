import { describe, expect, it } from 'vitest'
import example from './example-scene.template.json'
import exampleWorkflow from './example-scene.workflow.json'
import updatedWorkflow from './example-scene-8.5205.workflow.json'
import startAlignedWorkflow from './example-scene-10.6949.workflow.json'
import { compileSceneTemplate, type SceneTemplate } from './sceneTemplate'

const sources = {
  '4c3b5b2c-88c9-4be0-8f34-c4f5177fb5c7': '/Users/sunguannan/Downloads/tmp4uu0of5p.png'
}
const template = () => structuredClone(example) as SceneTemplate

describe('Scene 时间编排', () => {
  it('固定到 scene 结尾，保持五秒时长，不改变原 JSON', () => {
    const input = template()
    const before = structuredClone(input)
    const result = compileSceneTemplate(input, { sources })
    expect(result.duration).toBe(7.1775)
    expect(result.timeline[1]).toMatchObject({ localStart: 2.1775, start: 2.1775, end: 7.1775, duration: 5 })
    expect(result.workflow.script[0].params).toMatchObject({ start: 2.1775, end: 7.1775 })
    expect(result.workflow).toEqual(exampleWorkflow)
    expect(input).toEqual(before)
    expect(result.template.elements[0].elements![0].time).toBe('end')
    expect(result.warnings.some((warning) => warning.includes('height=75%'))).toBe(true)
  })

  it('scene 修改时长后重新计算结尾锚定位置', () => {
    const input = template()
    input.elements[0].duration = 10
    expect(compileSceneTemplate(input, { sources }).timeline[1]).toMatchObject({ start: 5, end: 10, duration: 5 })
  })

  it('省略 time 时从 scene 的局部零秒开始，保持固定时长', () => {
    const input = template()
    input.elements[0].duration = 8.5205
    delete input.elements[0].elements![0].time
    expect(compileSceneTemplate(input, { sources }).timeline[1])
      .toMatchObject({ localStart: 0, start: 0, end: 5, duration: 5 })
    input.elements[0].time = 3
    const shifted = compileSceneTemplate(input, { sources })
    expect(shifted.timeline[1]).toMatchObject({ localStart: 0, start: 3, end: 8, duration: 5 })
    expect(shifted.workflow.script[0].params).toMatchObject({ start: 3, end: 8 })
  })

  it('生成 8.5205 秒 scene 的 workflow 示例', () => {
    const input = template()
    input.elements[0].duration = 8.5205
    const result = compileSceneTemplate(input, { sources })
    expect(result.workflow).toEqual(updatedWorkflow)
    expect(result.timeline[1]).toMatchObject({ start: 3.5205, end: 8.5205, duration: 5 })
  })

  it('10.6949 秒 scene 内省略 time 的图片显示 0 到 5.1 秒', () => {
    const input = template()
    input.elements[0].duration = 10.6949
    const image = input.elements[0].elements![0]
    delete image.time
    image.duration = 5.1
    const result = compileSceneTemplate(input, { sources })
    expect(result.duration).toBe(10.6949)
    expect(result.timeline[0]).toMatchObject({ start: 0, end: 10.6949 })
    expect(result.timeline[1]).toMatchObject({ localStart: 0, start: 0, end: 5.1, duration: 5.1 })
    expect(result.workflow).toEqual(startAlignedWorkflow)
    expect(result.template.elements[0].elements![0]).not.toHaveProperty('time')
  })

  it('scene 偏移和多个内容均换算到全局时间，各自独立轨道', () => {
    const input = template()
    input.elements[0].time = 3
    input.elements[0].elements!.push({
      id: 'second', name: 'Image-TSS', type: 'image', track: 2,
      time: 1, duration: 2, source: '/tmp/second.png'
    })
    const result = compileSceneTemplate(input, { sources })
    expect(result.duration).toBe(10.1775)
    expect(result.workflow.script.map((step) => [step.params.start, step.params.end]))
      .toEqual([[5.1775, 10.1775], [4, 6]])
    expect(new Set(result.workflow.script.map((step) => step.params.track_name)).size).toBe(2)
  })

  it('支持嵌套 scene 的结束锚定', () => {
    const input: SceneTemplate = {
      width: 720, height: 1280, duration: 20,
      elements: [{
        id: 'outer', type: 'composition', time: 3, duration: 10,
        elements: [{
          id: 'inner', type: 'composition', time: 'end', duration: 6,
          elements: [{ id: 'image', type: 'image', time: 'end', duration: 2, source: '/tmp/a.png' }]
        }]
      }]
    }
    expect(compileSceneTemplate(input).timeline[2]).toMatchObject({ start: 11, end: 13, duration: 2 })
  })

  it('scene 比固定时长短时截断可见部分，保留声明时长', () => {
    const input = template()
    input.elements[0].duration = 4
    const result = compileSceneTemplate(input, { sources })
    expect(result.timeline[1]).toMatchObject({
      localStart: -1, start: 0, end: 4, duration: 5, visibleDuration: 4, visible: true
    })
    expect(result.workflow.script[0].params).toMatchObject({ start: 0, end: 4 })
  })

  it('数字 time 是开始时间，超长 duration 仅截断可见部分', () => {
    const input = template()
    input.elements[0].duration = 10.6949
    const image = input.elements[0].elements![0]
    image.time = 3.1
    image.duration = 5.1
    expect(compileSceneTemplate(input, { sources }).workflow.script[0].params)
      .toMatchObject({ start: 3.1, end: 8.2 })
    image.duration = 20
    const clipped = compileSceneTemplate(input, { sources })
    expect(clipped.workflow.script[0].params).toMatchObject({ start: 3.1, end: 10.6949 })
    expect(clipped.timeline[1]).toMatchObject({ duration: 20, visibleDuration: 7.5949 })
    expect(clipped.template.elements[0].elements![0].duration).toBe(20)
  })

  it('开始时间在 scene 结尾或之后时不生成操作，也不解析隐藏素材', () => {
    for (const time of [10.6949, 12]) {
      const input = template()
      input.elements[0].duration = 10.6949
      input.elements[0].elements![0].time = time
      const result = compileSceneTemplate(input)
      expect(result.workflow.script).toEqual([])
      expect(result.timeline[1]).toMatchObject({ visible: false, visibleDuration: 0 })
    }
  })

  it('嵌套 scene 截断后仍按声明的起点和时长解析子元素', () => {
    const input: SceneTemplate = {
      width: 720, height: 1280, duration: 10,
      elements: [{
        id: 'scene', type: 'composition', time: 3, duration: 10,
        elements: [
          { id: 'visible', type: 'image', time: 4, duration: 5, source: '/tmp/a.png' },
          { id: 'hidden', type: 'image', time: 'end', duration: 2, source: 'unresolved' }
        ]
      }]
    }
    const result = compileSceneTemplate(input)
    expect(result.workflow.script).toHaveLength(1)
    expect(result.workflow.script[0].params).toMatchObject({ start: 7, end: 10 })
    expect(result.timeline[2]).toMatchObject({ localStart: 8, visible: false })
  })

  it('拒绝无时长 end 锚定、未映射素材和重复 ID', () => {
    const input = template()
    delete input.elements[0].elements![0].duration
    expect(() => compileSceneTemplate(input, { sources })).toThrow('必须设置固定 duration')
    expect(() => compileSceneTemplate(template())).toThrow('通过 sources 映射')
    const duplicate = template()
    duplicate.elements[0].elements!.push(structuredClone(duplicate.elements[0].elements![0]))
    expect(() => compileSceneTemplate(duplicate, { sources })).toThrow('唯一')
  })

  it('图片省略 duration 时从默认或数字 time 开始填充至 scene 结束', () => {
    for (const time of [undefined, 0, 3.1]) {
      for (const sceneStart of [0, 3]) {
        const input = template()
        const scene = input.elements[0]
        scene.time = sceneStart
        scene.duration = 10.6949
        const image = scene.elements![0]
        delete image.duration
        if (time === undefined) delete image.time
        else image.time = time
        const result = compileSceneTemplate(input, { sources })
        expect(result.workflow.script[0].params).toMatchObject({
          start: sceneStart + (time ?? 0),
          end: sceneStart === 0 ? 10.6949 : 13.6949
        })
        expect(result.timeline[1].duration).toBeCloseTo(10.6949 - (time ?? 0), 9)
        expect(result.template.elements[0].elements![0]).not.toHaveProperty('duration')
      }
    }
  })

  it('校验自动延伸、父级范围和不支持的属性', () => {
    const input = template()
    const image = input.elements[0].elements![0]
    image.time = 2
    delete image.duration
    expect(compileSceneTemplate(input, { sources }).timeline[1]).toMatchObject({ start: 2, end: 7.1775 })
    image.time = 8
    expect(compileSceneTemplate(input, { sources }).workflow.script).toEqual([])
    const unsupported = template()
    Object.assign(unsupported.elements[0], { animations: [] })
    expect(() => compileSceneTemplate(unsupported, { sources })).toThrow('animations')
  })
})
