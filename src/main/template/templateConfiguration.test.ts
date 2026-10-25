import { describe, expect, it } from 'vitest'
import { applyEditorAction } from './editorActions'
import { editorInitialTemplate } from './editorModel'
import { compileDraftTemplate, type DraftTemplate, type DraftSegment } from './draftTemplate'
import { applyConfiguration, nativeConfigurationParams, validateWorkflowConfiguration } from './configurationWorkflow'
import { templateAnimations } from '../../shared/templatePropertyResources'
import { readConfigurationProperty } from '../../shared/templateConfigurationNative'
import { compileSceneTemplate, type SceneTemplate } from './sceneTemplate'

const fixture = () => structuredClone(editorInitialTemplate)
const segment = (draft: DraftTemplate, id = 'text-1') => draft.scenes[0].tracks.flatMap(track => track.segments).find(item => item.id === id)! as DraftSegment
const edit = (draft: DraftTemplate, property: string, value: string | number | boolean, id = 'text-1') =>
  JSON.parse(applyEditorAction({ templateJson: JSON.stringify(draft) }, { type: 'property', id, property, value, mode: 'static' }).templateJson) as DraftTemplate
const params = (draft: DraftTemplate, id = 'text-1') => compileDraftTemplate(draft).workflow.script.find(step => step.id === id)!.params

describe('配置白名单和导出映射', () => {
  it('音频变速保持目标时长并扩大源区间，拒绝循环和注入', () => {
    const input: SceneTemplate = { width: 720, height: 1280, elements: [{ id: 'audio', type: 'audio',
      source: '/tmp/audio.mp3', source_start_time: 1, duration: 3, configuration: { speed: 2, fade_out_duration: 0.2 } }] }
    expect(compileSceneTemplate(input).workflow.script[0].params).toMatchObject({ start: 1, end: 7, speed: 2, fade_out_duration: 0.2 })
    input.elements[0].configuration = { track_name: 'injected' }
    expect(() => compileSceneTemplate(input)).toThrow('不支持配置字段')
    input.elements[0].configuration = { speed: 2 }
    input.elements[0].loop = true
    input.elements[0].source_duration = 1
    expect(() => compileSceneTemplate(input)).toThrow('变速与循环')
  })

  it('视频仅开放入出场动画和转场，不接受图片组合动画', () => {
    const name = templateAnimations('video', 'intro_animation')[0].value
    const input: SceneTemplate = { width: 720, height: 1280, elements: [{ id: 'video', type: 'video',
      source: '/tmp/video.mp4', duration: 3, configuration: { intro_animation: name, intro_animation_duration: 0.5, transition: '叠化' } }] }
    expect(compileSceneTemplate(input).workflow.script[0].params).toMatchObject({ intro_animation: name, transition: '叠化' })
    input.elements[0].configuration = { combo_animation: name }
    expect(() => compileSceneTemplate(input)).toThrow()
  })

  it('文字编辑复制素材并输出内容、排版和效果', () => {
    const original = fixture()
    let draft = edit(original, 'text', '新的文字😀')
    expect(segment(draft).material_id).not.toBe(segment(original).material_id)
    for (const [key, value] of Object.entries({ font_size: 30, letter_spacing: 4, line_spacing: 3, border_width: 40,
      font_color: '#FF0000', shadow_enabled: true, shadow_smoothing: 0.2, background_horizontal_offset: 0.7 })) draft = edit(draft, key, value)
    expect(params(draft)).toMatchObject({ text: '新的文字😀', font_size: 30, letter_spacing: 4,
      border_width: 40, font_color: '#FF0000', shadow_enabled: true, background_horizontal_offset: 0.7 })
    expect(params(draft).line_spacing).toBeCloseTo(3)
    expect(params(draft).shadow_smoothing).toBeCloseTo(0.2)
  })

  it('图片动画和转场使用已验证名称，删除不遗留参数', () => {
    const name = templateAnimations('image', 'intro_animation')[0].value
    let draft = edit(fixture(), 'intro_animation', name, 'image-1')
    draft = edit(draft, 'intro_animation_duration', 0.8, 'image-1')
    draft = edit(draft, 'transition', '叠化', 'image-1')
    expect(params(draft, 'image-1')).toMatchObject({ intro_animation: name, intro_animation_duration: 0.8, transition: '叠化' })
    draft = edit(draft, 'intro_animation', '', 'image-1')
    expect(params(draft, 'image-1')).not.toHaveProperty('intro_animation_duration')
    expect(() => edit(draft, 'transition', 'fake-id', 'image-1')).toThrow()
  })

  it('音频比例转换 dB，速度、淡出及音效用真实后端参数', () => {
    const draft = fixture()
    const target = segment(draft, 'image-1')
    const material = draft.materials.videos[0]
    for (const [key, value] of Object.entries({ volume: 0.5, speed: 2, fade_out_duration: 0.3, effect_type: '回音', effect_param_0: 25 })) {
      applyConfiguration(draft, target, 'audio', key, value)
    }
    const result = nativeConfigurationParams(draft, target, material, 'audio')
    expect(result.volume).toBeCloseTo(-6.020599913)
    expect(result).toMatchObject({ speed: 2, fade_out_duration: 0.3, sound_effects: [['回音', [25, 76.2]]] })
    expect(result).not.toHaveProperty('effect_type')
    expect(result).not.toHaveProperty('fade_out_duratioin')
    applyConfiguration(draft, target, 'audio', 'volume', 0)
    expect(nativeConfigurationParams(draft, target, material, 'audio').volume).toBe(-60)
    applyConfiguration(draft, target, 'audio', 'effect_type', '')
    expect(nativeConfigurationParams(draft, target, material, 'audio')).not.toHaveProperty('sound_effects')
  })

  it('拒绝配置注入、未知资源、类型错误和无对应参数', () => {
    for (const config of [{ audio_url: 'injected' }, { track_name: 'injected' }, { speed: '2' }, { sound_effects: [['fake', []]] }]) {
      expect(() => validateWorkflowConfiguration('audio', config)).toThrow()
    }
    const draft = fixture()
    const target = segment(draft)
    expect(() => applyConfiguration(draft, target, 'audio', 'effect_param_0', 10)).toThrow()
    applyConfiguration(draft, target, 'audio', 'effect_type', '水下')
    expect(() => applyConfiguration(draft, target, 'audio', 'effect_param_1', 10)).toThrow()
    expect(() => readConfigurationProperty({}, { content: JSON.stringify({ text: 'abc', styles: [{}, {}] }) }, 'text', 'font_size')).toThrow()
    expect(() => edit(fixture(), '__proto__.polluted', true)).toThrow()
  })
})
