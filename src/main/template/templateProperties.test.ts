import { describe, expect, it } from 'vitest'
import { readStaticProperty, readTemplateProperty, templatePropertiesFor, writeStaticProperty } from '../../shared/templateProperties'
import { applyEditorAction } from './editorActions'
import { editorInitialTemplate } from './editorModel'
import { compileDraftTemplate, type DraftTemplate } from './draftTemplate'

const fixture = () => structuredClone(editorInitialTemplate)
const item = (draft: DraftTemplate, id: string) => draft.scenes[0].tracks.flatMap(track => track.segments).find(segment => segment.id === id)!
const edit = (draft: DraftTemplate, property: string, value: number, mode: 'static' | 'keyframe' = 'static', time?: number, id = 'text-1') =>
  JSON.parse(applyEditorAction({ templateJson: JSON.stringify(draft) },
    { type: 'property', id, property, value, mode, ...(time !== undefined ? { time } : {}) }).templateJson) as DraftTemplate

describe('共享属性及 property 编辑', () => {
  it('明确归一化单位和类型能力，未知及像素属性不开放', () => {
    expect(templatePropertiesFor('text').find(item => item.key === 'position_x')).toMatchObject({ unit: 'normalized', static: true, keyframe: true })
    expect(templatePropertiesFor('text').find(item => item.key === 'alpha')?.native).toBe('KFTypeGlobalAlpha')
    expect(templatePropertiesFor('composition').every(item => !item.static)).toBe(true)
    expect(templatePropertiesFor('audio')).toEqual([])
    expect(() => writeStaticProperty({}, 'image', 'position_x_px', 1)).toThrow()
  })

  it('静态写入不改原对象，保留其他字段，整体缩放同时写两轴', () => {
    const source = { clip: { transform: { x: 0, y: 0.2 }, alpha: 0.8 } }
    const result = writeStaticProperty(source, 'image', 'position_x', 0.5)
    expect(source.clip.transform.x).toBe(0)
    expect(result.clip).toEqual({ transform: { x: 0.5, y: 0.2 }, alpha: 0.8 })
    expect(readStaticProperty(writeStaticProperty(result, 'image', 'uniform_scale', 2), 'image', 'scale_y')).toBe(2)
    expect(() => writeStaticProperty(source, 'image', 'alpha', 2)).toThrow()
    expect(() => writeStaticProperty(source, 'image', 'position_x', NaN)).toThrow()
  })

  it('文字静态 alpha 导出 font_alpha，不使用 clip.alpha', () => {
    const source = fixture()
    const result = edit(source, 'alpha', 0.4)
    expect(item(source, 'text-1').global_alpha).toBeUndefined()
    expect(item(result, 'text-1').global_alpha).toBe(0.4)
    const params = compileDraftTemplate(result).workflow.script.find(step => step.id === 'text-1')!.params
    expect(params.font_alpha).toBe(0.4)
    expect(params).not.toHaveProperty('alpha')
  })

  it('位置按原比例导出，不受画布宽度影响', () => {
    const result = edit(fixture(), 'position_x', 0.25, 'static', undefined, 'image-1')
    expect(compileDraftTemplate(result).workflow.script.find(step => step.id === 'image-1')!.params.transform_x).toBe(0.25)
  })

  it('关键帧微秒写入、同点覆盖、线性插值、边界保持及静态回退', () => {
    let draft = edit(fixture(), 'alpha', 0.7)
    expect(readTemplateProperty(item(draft, 'text-1'), 'text', 'alpha', 0).value).toBe(0.7)
    draft = edit(draft, 'alpha', 0.2, 'keyframe', 1)
    draft = edit(draft, 'alpha', 0.8, 'keyframe', 3)
    draft = edit(draft, 'alpha', 1, 'keyframe', 3)
    const target = item(draft, 'text-1')
    expect(target.common_keyframes![0].property_type).toBe('KFTypeGlobalAlpha')
    expect(target.common_keyframes![0].keyframe_list.map(frame => frame.time_offset)).toEqual([1_000_000, 3_000_000])
    expect(readTemplateProperty(target, 'text', 'alpha', 2)).toMatchObject({ staticValue: 0.7, animated: true, atKeyframe: false })
    expect(readTemplateProperty(target, 'text', 'alpha', 2).value).toBeCloseTo(0.6)
    expect(readTemplateProperty(target, 'text', 'alpha', 0).value).toBe(0.2)
    expect(readTemplateProperty(target, 'text', 'alpha', 4).value).toBe(1)
    expect(readTemplateProperty(target, 'text', 'alpha', 3).atKeyframe).toBe(true)
    const removed = JSON.parse(applyEditorAction({ templateJson: JSON.stringify(draft) },
      { type: 'property', id: 'text-1', property: 'alpha', mode: 'keyframe', removeGroup: true }).templateJson)
    expect(readTemplateProperty(item(removed, 'text-1'), 'text', 'alpha', 2).value).toBe(0.7)
  })

  it('拒绝不支持的静态属性、越界时间和缺失值', () => {
    expect(() => edit(fixture(), 'volume', 1)).toThrow()
    expect(() => edit(fixture(), 'alpha', 1, 'keyframe', 1000)).toThrow()
    expect(() => edit(fixture(), 'alpha', undefined!)).toThrow()
    expect(() => edit(fixture(), 'alpha', 1, 'keyframe')).toThrow()
  })

  it('动态文字 alpha 使用 font_alpha 绑定', () => {
    const draft = edit(fixture(), 'alpha', 0.5)
    item(draft, 'text-1').dynamic = ['global_alpha']
    const result = compileDraftTemplate(draft)
    expect(JSON.stringify(result.workflow)).toContain('font_alpha')
    expect(result.workflowInputBindings.some(binding => binding.runtime)).toBe(true)
  })

  it('旧文字 alpha 组写入时规范化，分轴能采样整体缩放', () => {
    let draft = edit(fixture(), 'alpha', 0.5, 'keyframe', 0)
    item(draft, 'text-1').common_keyframes![0].property_type = 'KFTypeAlpha'
    draft = edit(draft, 'alpha', 0.8, 'keyframe', 1)
    expect(item(draft, 'text-1').common_keyframes![0].property_type).toBe('KFTypeGlobalAlpha')
    draft = edit(draft, 'uniform_scale', 2, 'keyframe', 0)
    expect(readTemplateProperty(item(draft, 'text-1'), 'text', 'scale_y', 0).value).toBe(2)
    expect(() => edit(draft, 'scale_x', 1, 'keyframe', 0)).toThrow()
    const group = item(draft, 'text-1').common_keyframes![0]
    group.keyframe_list[0].curveType = 'Bezier'
    expect(() => readTemplateProperty(item(draft, 'text-1'), 'text', 'alpha', 0)).toThrow()
  })
})
