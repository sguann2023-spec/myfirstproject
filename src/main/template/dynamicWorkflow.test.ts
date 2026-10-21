import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compileDraftTemplate, normalizeDraftTemplate, type DraftTemplate } from './draftTemplate'
import { applyDynamicInputs } from './dynamicInputs'
import { createEditorPreset } from './editorPresets'
import { compileSceneTemplate } from './sceneTemplate'
import { prepareExecutionWorkflow } from './testExport'
import { executionInputName } from './inputNames'
import type { TemplateWorkflow } from './workflowTypes'
import { flatSentenceImageFixture, workflowActions } from './workflowTestUtils'
import { isSceneSegment, mapWorkflowTracks } from './draftTracks'

const fixture = flatSentenceImageFixture
const backend = process.env.TEMPLATE_WORKFLOW_BACKEND
const python = process.env.TEMPLATE_WORKFLOW_PYTHON ?? 'python3'
function timingPreset(id: string) {
  const draft = createEditorPreset(id)
  function visit(scenes: DraftTemplate['scenes']) {
    for (const scene of scenes) {
      for (const track of scene.tracks) {
        for (const item of track.segments) {
          if (isSceneSegment(item)) visit([item])
          else item.dynamic = ['start', 'duration'].filter(field => typeof item.target_timerange[field] === 'number')
            .map(field => `target_timerange.${field}`)
        }
      }
      visit(scene.scenes ?? [])
    }
  }
  visit(draft.scenes)
  return draft
}
function execute(workflow: TemplateWorkflow) {
  const directory = mkdtempSync(join(tmpdir(), 'template-workflow-contract-'))
  try {
    const input = join(directory, 'workflow.json')
    writeFileSync(input, JSON.stringify(workflow))
    const result = spawnSync(python, [
      fileURLToPath(new URL('./backendWorkflowContract.py', import.meta.url)), backend!, input
    ], { encoding: 'utf8', timeout: 10_000, maxBuffer: 8 * 1024 * 1024 })
    if (result.status !== 0) throw new Error(`${result.error?.message ?? ''}\n${result.stderr}`)
    return JSON.parse(result.stdout) as Array<{ action_type: string; params: Record<string, any> }>
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

describe('动态 Workflow 生成', () => {
  it('dynamic 成为执行输入，时间与关联通过运行时表达式计算', () => {
    const result = compileDraftTemplate(fixture())
    expect(result.workflowInputBindings).toHaveLength(12)
    expect(result.workflow.script.some((step) => step.type === 'set_var')).toBe(true)
    expect(workflowActions(result.workflow)).toHaveLength(6)
    expect(result.workflowInputBindings.every((binding) => binding.runtime)).toBe(true)
    function checkKeys(value: unknown) {
      if (Array.isArray(value)) return value.forEach(checkKeys)
      if (!value || typeof value !== 'object') return
      for (const [key, item] of Object.entries(value)) {
        expect(key).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/)
        checkKeys(item)
      }
    }
    checkKeys(result.workflow.inputs)
    expect(JSON.stringify(result.workflow.script)).not.toMatch(/\$\{[^}]*[^\x00-\x7F][^}]*\}/)
    expect((result.workflow as TemplateWorkflow).input_labels).toContainEqual({
      path: [executionInputName('第_1_句话')], label: '第 1 句话'
    })
    const before = structuredClone(result.workflow)
    const prepared = prepareExecutionWorkflow(result.workflow)
    expect(workflowActions(prepared).find((step) => step.id === 'text-1')!.params.text)
      .toBe(`\${${executionInputName('第_1_句话')}.text}`)
    expect(result.workflow).toEqual(before)
  })

  it('画布与结构数组标明仅编译时应用，不伪装成运行时输入', () => {
    const template = fixture()
    template.dynamic = ['canvas_config.width']
    template.scenes[0].tracks[0].dynamic = ['segments']
    const result = compileDraftTemplate(template)
    for (const key of ['canvas_config.width', 'text_track_1.segments']) {
      expect(result.workflowInputBindings.find((binding) => binding.key === key)!.runtime).toBe(false)
      expect(result.warnings.some((warning) => warning.includes(key) && warning.includes('重新编译'))).toBe(true)
    }
  })

  it('变量名规范化后冲突时仍保持唯一，不污染动作 ID', () => {
    const template = fixture()
    template.materials.texts[0].id = 'a-b'
    template.materials.texts[1].id = 'a_b'
    template.scenes[0].tracks[0].segments[0].material_id = 'a-b'
    template.scenes[0].tracks[2].segments[0].material_id = 'a_b'
    template.scenes[0].tracks[0].segments[0].name = '文案-a'
    template.scenes[0].tracks[2].segments[0].name = '文案_a'
    const result = compileDraftTemplate(template)
    expect(new Set(result.workflowInputBindings.map(({ variable }) => variable)).size).toBe(12)
    expect(result.workflowInputBindings.filter(({ key }) => key.startsWith('a')).map(({ variable }) => variable))
      .toEqual([executionInputName('文案_a'), `${executionInputName('文案_a')}_2`])
  })
})

describe.skipIf(!backend)('真实 Python Workflow 执行协议（媒体 IO 模拟）', () => {
  function compare(template: DraftTemplate, modifications: Record<string, unknown> = {}) {
    const compiled = compileDraftTemplate(template)
    const workflow = structuredClone(compiled.workflow)
    for (const [key, value] of Object.entries(modifications)) {
      const binding = compiled.workflowInputBindings.find((item) => item.key === key)!
      expect(binding.runtime).toBe(true)
      const encoded = binding.encoding === 'text' ? JSON.parse(value as string).text
        : binding.encoding === 'json' ? JSON.parse(value as string) : value
      if (binding.inputPath?.length === 1) (workflow.inputs[binding.variable] as Record<string, unknown>)[binding.inputPath[0]] = encoded
      else workflow.inputs[binding.variable] = encoded
    }
    const resolved = applyDynamicInputs(template, modifications)
    const normalized = normalizeDraftTemplate(resolved)
    const expected = compileSceneTemplate(mapWorkflowTracks(normalized.template, normalized.logicalTracks).template).workflow.script
    const actual = execute(prepareExecutionWorkflow(workflow))
    expect(actual).toHaveLength(expected.length)
    actual.forEach((step, index) => {
      expect(step.action_type).toBe(expected[index].action_type)
      for (const [key, value] of Object.entries(expected[index].params)) {
        if (typeof value === 'number') expect(step.params[key]).toBeCloseTo(value, 9)
        else expect(step.params[key]).toBe(value)
      }
    })
    return actual
  }

  it('原样执行默认值，并在不重新编译时修改文字、图片和时间', () => {
    compare(fixture())
    compare(fixture(), {
      'text-material-1.content': JSON.stringify({ text: '1+2 ${price} "引号" \n换行' }),
      'image-material-1.remote_url': '/tmp/runtime.png',
      'text-1.target_timerange.start': 1_630_800,
      'text-1.target_timerange.duration': 7_653_000
    })
  })

  it('嵌套一句一图的动态时长改变后，后续子 Scene 与图片一起联动', () => {
    const template = timingPreset('sentence-image')
    compare(template)
    for (const duration of [7_000_000, 2_000_000]) {
      const actual = compare(template, {
        'text-1.target_timerange.duration': duration,
        'text-material-2.content': JSON.stringify({ text: '子 Scene 中的动态文字' })
      })
      const second = actual.find(({ params }) => params.track_name === 'text_track_2')!
      expect(second.params).toMatchObject({ start: duration / 1_000_000, end: duration / 1_000_000 + 5 })
      const third = actual.find(({ params }) => params.track_name === 'image_track_3')!
      expect(third.params.end).toBe(duration / 1_000_000 + 10)
    }
  })

  it('子 Scene 的开始输入在运行时移动整个组合，内部时间保持相对坐标', () => {
    const template = timingPreset('sentence-image')
    const child = template.scenes[0].tracks[0].segments.filter(isSceneSegment)[0]
    child.dynamic = ['target_timerange.start']
    const actions = compare(template, { 'sentence-scene-1.target_timerange.start': 3_000_000 })
    expect(actions.find(({ params }) => params.track_name === 'text_track_1')!.params).toMatchObject({ start: 3, end: 8 })
    expect(actions.find(({ params }) => params.track_name === 'image_track_3')!.params).toMatchObject({ start: 13, end: 18 })
  })

  it('轨道内 Scene 与其他片段的运行时重叠，在媒体动作前被拒绝', () => {
    const template = timingPreset('sentence-image')
    template.scenes[0].tracks[0].segments.push({
      id: 'tail', material_id: 'text-material-1', target_timerange: { start: 15_000_000, duration: 2_000_000 },
      dynamic: ['target_timerange.start']
    })
    compare(template)
    const compiled = compileDraftTemplate(template)
    ;(compiled.workflow.inputs as Record<string, unknown>).input_tail_target_timerange_start = 14_000_000
    expect(() => execute(compiled.workflow)).toThrow('时间重叠')
  })

  it('混排演示直接执行五个动作，动态内容和时间可替换', () => {
    compare(timingPreset('mixed-track'))
    compare(timingPreset('mixed-track'), {
      'mixed-photo-1.target_timerange.duration': 2_000_000,
      'mixed-text-material-1.content': JSON.stringify({ text: '混排演示的新文案' }),
      'mixed-photo-material-1.remote_url': '/tmp/mixed-runtime.png'
    })
  })

  it('动态片段时长改变后，自动 Scene、根时长和铺满片段一起增长或缩短', () => {
    for (const [duration, end] of [[8_000_000, 20], [2_000_000, 14]]) {
      const actions = compare(timingPreset('mixed-track'), {
        'mixed-text-2.target_timerange.duration': duration
      })
      expect(actions.find(({ params }) => params.track_name === 'mixed-underlay-track')!.params.end).toBe(end)
    }
  })

  it('嵌套自动 Scene 逐层适应，后续 Scene 在运行时跟随前一个结束', () => {
    const template = timingPreset('mixed-track')
    const child = template.scenes[0]
    child.target_timerange.start = 3_000_000
    template.scenes = [{
      id: 'outer', auto_duration: true, target_timerange: { start: 2_000_000 }, tracks: [], scenes: [child]
    }, {
      id: 'next', auto_duration: true, target_timerange: {},
      auto_timing: { start: { target: 'outer', anchor: 'end' } },
      tracks: [{ id: 'next-track', type: 'text', segments: [{
        id: 'next-text', material_id: 'mixed-text-material-1', target_timerange: { duration: 3_000_000 }
      }] }]
    }]
    const actions = compare(template, { 'mixed-text-2.target_timerange.duration': 8_000_000 })
    expect(actions.find(({ params }) => params.track_name === 'next-track')!.params)
      .toMatchObject({ start: 25, end: 28 })
  })

  it('自动 Scene 仍受显式根时长裁切，零内容时长在动作执行前被拒绝', () => {
    const template = timingPreset('mixed-track')
    template.duration = 17_000_000
    const actions = compare(template, { 'mixed-text-2.target_timerange.duration': 8_000_000 })
    expect(actions.find(({ params }) => params.track_name === 'mixed-underlay-track')!.params.end).toBe(17)
    delete template.duration
    template.scenes[0].tracks[1].segments.splice(1)
    const workflow = compileDraftTemplate(template).workflow
    ;(workflow.inputs as Record<string, unknown>).input_mixed_photo_1_target_timerange_duration = 0
    expect(() => execute(workflow)).toThrow('推导时长必须大于 0')
  })

  it('自动 Scene 的 parent.end 片尾跟随推导结果，不反向决定总时长', () => {
    const template = timingPreset('mixed-track')
    template.scenes[0].tracks.push({ id: 'footer-track', type: 'text', segments: [{
      id: 'footer', material_id: 'mixed-text-material-1',
      target_timerange: { duration: 1_000_000 },
      auto_timing: { end: { target: 'parent', anchor: 'end' } }
    }] })
    const actions = compare(template, { 'mixed-text-2.target_timerange.duration': 8_000_000 })
    expect(actions.find(({ params }) => params.track_name === 'footer-track')!.params).toMatchObject({ start: 19, end: 20 })
  })

  it('直接执行编译结果也保护静态文字，不把字面变量名当表达式', () => {
    const template = fixture()
    delete template.materials.texts[0].dynamic
    const text = '${input_text_material_2_text} 1+2'
    template.materials.texts[0].content = JSON.stringify({ text })
    const actual = execute(compileDraftTemplate(template).workflow)
    expect(actual.find((step) => step.params.track_name === 'text_track_1')!.params.text).toBe(text)
  })

  it('运行时移动原本隐藏的片段，超出 Scene 的部分正确截断', () => {
    const template = fixture()
    template.scenes[0].tracks[0].segments[0].target_timerange.start = 20_000_000
    compare(template, { 'text-1.target_timerange.start': 1_000_000 })
    for (const start of [0, 14_500_000, 15_000_000, 20_000_000]) {
      compare(fixture(), { 'text-1.target_timerange.start': start })
    }
  })

  it('parent、负 offset、结束锚定、嵌套 Scene 和根时长运行时保持一致', () => {
    const template = fixture()
    template.dynamic = ['duration']
    const scene = template.scenes[0]
    scene.target_timerange = { start: 3_000_000, duration: 12_000_000 }
    scene.dynamic = ['target_timerange.start', 'target_timerange.duration']
    const first = scene.tracks[0].segments[0]
    first.auto_timing = { end: { target: 'parent', anchor: 'end' } }
    const image = scene.tracks[1].segments[0]
    image.auto_timing!.start!.offset = -1_000_000
    image.dynamic = ['auto_timing.start.offset']
    template.scenes = [{
      id: 'outer', target_timerange: { start: 2_000_000, duration: 15_000_000 },
      tracks: [], scenes: [scene]
    }]
    compare(template, {
      duration: 13_000_000,
      'scene-1.target_timerange.start': 1_000_000,
      'scene-1.target_timerange.duration': 11_000_000,
      'image-1.auto_timing.start.offset': -2_000_000
    })
  })

  it('省略根时长时，从动态顶层 Scene 区间推导', () => {
    const template = fixture()
    delete template.duration
    template.scenes[0].dynamic = ['target_timerange.duration']
    compare(template, { 'scene-1.target_timerange.duration': 20_000_000 })
  })

  it('数字 end、parent.start 偏移和省略 duration 在运行时保持一致', () => {
    const template = fixture()
    const first = template.scenes[0].tracks[0].segments[0]
    first.target_timerange = { start: 0, end: 5_000_000 }
    first.dynamic = ['target_timerange.start', 'target_timerange.end']
    compare(template, { 'text-1.target_timerange.start': 1_000_000, 'text-1.target_timerange.end': 4_000_000 })
    first.target_timerange = {}
    first.auto_timing = { start: { target: 'parent', anchor: 'start', offset: 1_000_000 } }
    first.dynamic = ['auto_timing.start.offset']
    compare(template, { 'text-1.auto_timing.start.offset': 4_000_000 })
  })

  it('拆分混排轨道后仍在动作执行前拒绝运行时跨类型重叠', () => {
    const template = fixture()
    template.scenes[0].tracks = [{
      id: 'mixed', type: 'mixed', segments: [
        { id: 'text-1', material_id: 'text-material-1',
          target_timerange: { start: 0, duration: 5_000_000 },
          dynamic: ['target_timerange.start', 'target_timerange.duration'] },
        { id: 'image-1', material_id: 'image-material-1',
          target_timerange: { start: 5_000_000, duration: 5_000_000 },
          dynamic: ['target_timerange.start'] }
      ]
    }]
    compare(template)
    const compiled = compileDraftTemplate(template)
    const workflow = structuredClone(compiled.workflow)
    ;(workflow.inputs as Record<string, unknown>).input_image_1_target_timerange_start = 4_000_000
    expect(() => execute(workflow)).toThrow('时间重叠')
    compare(template, { 'image-1.target_timerange.start': 6_000_000 })
    // Touching ends are valid and moving both clips may reverse their order.
    compare(template, {
      'text-1.target_timerange.start': 10_000_000, 'image-1.target_timerange.start': 0
    })
  })
})
