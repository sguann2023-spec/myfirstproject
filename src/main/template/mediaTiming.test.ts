import { describe, expect, it } from 'vitest'
import { analyzeSceneTemplate, compileSceneTemplate, type SceneTemplate } from './sceneTemplate'

function template(type: 'video' | 'audio' | 'image' = 'video'): SceneTemplate {
  return { width: 720, height: 1280, elements: [
    { id: 'scene', type: 'composition', target_start_time: 3, duration: 10, elements: [
      { id: 'clip', type, target_start_time: 2, duration: 5, source: '/tmp/media',
        ...(type === 'image' ? {} : { source_start_time: 4 }) }
    ] }
  ] }
}

describe('源时间与目标时间分离', () => {
  it('视频音频源裁切与目标时间独立', () => {
    for (const type of ['video', 'audio'] as const) {
      expect(analyzeSceneTemplate(template(type)).timeline[1])
        .toMatchObject({ start: 5, end: 10, duration: 5, sourceStart: 4, sourceEnd: 9 })
    }
  })

  it('目标结束可为 end，保留 duration 反推开始，左截断推进源开始', () => {
    const input = template()
    const clip = input.elements[0].elements![0]
    delete clip.target_start_time
    clip.target_end_time = 'end'
    expect(analyzeSceneTemplate(input).timeline[1]).toMatchObject({ start: 8, end: 13, sourceStart: 4, sourceEnd: 9 })
    clip.duration = 12
    expect(analyzeSceneTemplate(input).timeline[1]).toMatchObject({ start: 3, end: 13, sourceStart: 6, sourceEnd: 16 })
  })

  it('同时指定目标开始结束优先于 duration，右截断减少源结束', () => {
    const input = template()
    input.elements[0].elements![0].target_end_time = 12
    expect(analyzeSceneTemplate(input).timeline[1])
      .toMatchObject({ start: 5, end: 13, duration: 10, sourceStart: 4, sourceEnd: 12 })
  })

  it('省略结束和 duration 则延伸到 scene 结尾', () => {
    const input = template('audio')
    delete input.elements[0].elements![0].duration
    expect(analyzeSceneTemplate(input).timeline[1]).toMatchObject({ start: 5, end: 13, sourceStart: 4, sourceEnd: 12 })
  })

  it('target_start_time 不再接受 end，结束锚定使用独立字段', () => {
    const input = template('image')
    Object.assign(input.elements[0].elements![0], { target_start_time: 'end' })
    expect(() => compileSceneTemplate(input)).toThrow('target_start_time')
    delete input.elements[0].elements![0].target_start_time
    input.elements[0].elements![0].target_end_time = 'end'
    expect(compileSceneTemplate(input).workflow.script[0].params).toMatchObject({ start: 8, end: 13 })
  })

  it('冲突字段、非法源时间和反向目标区间报错', () => {
    const input = template()
    const clip = input.elements[0].elements![0]
    Object.assign(clip, { time: 1 })
    expect(() => analyzeSceneTemplate(input)).toThrow('time 已移除')
    Reflect.deleteProperty(clip, 'time')
    clip.source_start_time = -1
    expect(() => analyzeSceneTemplate(input)).toThrow('source_start_time')
    clip.source_start_time = 0
    clip.target_end_time = 1
    expect(() => analyzeSceneTemplate(input)).toThrow('早于')
  })

  it('所有类型拒绝旧 time，包括只有旧字段和新旧相同的输入', () => {
    for (const type of ['composition', 'image', 'text', 'video', 'audio'] as const) {
      for (const value of [0, 'end', null]) {
        const input: SceneTemplate = { width: 720, height: 1280, duration: 10,
          elements: [{ id: 'old', type, duration: 5, ...(type === 'composition' ? { elements: [] } : {}) }] }
        Object.assign(input.elements[0], { time: value })
        expect(() => analyzeSceneTemplate(input)).toThrow('time 已移除')
        Object.assign(input.elements[0], { target_start_time: value })
        expect(() => analyzeSceneTemplate(input)).toThrow('time 已移除')
      }
    }
  })
})
