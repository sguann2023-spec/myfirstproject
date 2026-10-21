import { expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { analyzeDraftTemplate, compileDraftTemplate, type DraftTemplate } from './draftTemplate'
import { prepareExecutionWorkflow } from './testExport'
import { resourceFields } from './resourceWorkflow'
import { workflowActions } from './workflowTestUtils'
import { inputName } from './inputNames'

function fixture(): DraftTemplate {
  return {
    canvas_config: { width: 720, height: 1280 },
    materials: {
      effects: [{ id: 'filter', type: 'filter', name: '冷蓝', resource_id: '123', value: .4 }],
      video_effects: [{ id: 'effect', type: 'video_effect', effect_type: '模糊', effect_category: 'scene', params: [10, null, 70] }]
    },
    scenes: [{ id: 'scene', target_timerange: { duration: 5_000_000 }, tracks: [
      { id: 'filter-track', type: 'filter', track_relative_index: 1, segments: [
        { id: 'filter-clip', name: '滤镜', material_id: 'filter', target_timerange: { start: 1_000_000, duration: 2_000_000 } }
      ] },
      { id: 'effect-track', type: 'effect', track_relative_index: 0, segments: [
        { id: 'effect-clip', name: '特效', material_id: 'effect', target_timerange: {},
          auto_timing: { start: { target: 'filter-clip', anchor: 'start' }, end: { target: 'filter-clip', anchor: 'end' } } }
      ] }
    ] }]
  }
}

it('滤镜名称和原生强度映射 add_filter，特效类别及百分比数组直接传后台', () => {
  const draft = fixture()
  const original = structuredClone(draft)
  const actions = compileDraftTemplate(draft).workflow.script
  expect(actions.find(action => action.action_type === 'add_filter')?.params).toMatchObject({
    filter_type: '冷蓝', intensity: 40, start: 1, end: 3, width: 720, height: 1280
  })
  expect(actions.find(action => action.action_type === 'add_effect')?.params).toMatchObject({
    effect_type: '模糊', effect_category: 'scene', params: [10, null, 70], start: 1, end: 3
  })
  expect(new Set(actions.map(action => action.params.track_name)).size).toBe(2)
  expect(draft).toEqual(original)
})

it('原生 adjust_params 按索引转换百分比并反转一次以匹配后台反转', () => {
  expect(resourceFields({
    effect_type: '测试', adjust_params: [
      { parameterIndex: 1, min_value: -1, max_value: 1, value: .5 },
      { parameterIndex: 0, min_value: 0, max_value: 2, value: .5 }
    ]
  }, 'effect', 'effect')).toMatchObject({ params: [75, 25] })
  expect(() => resourceFields({ adjust_params: [{ parameterIndex: 2, min_value: 0, max_value: 1, value: .5 }] }, 'effect', 'x')).toThrow('parameterIndex')
})

it('数字资源 ID 不冒充枚举名称，空类型可编辑但禁止执行', () => {
  const draft = fixture()
  draft.materials.effects[0].name = '滤镜'
  expect(() => analyzeDraftTemplate(draft)).not.toThrow()
  expect(() => compileDraftTemplate(draft)).toThrow('filter_type')
  draft.materials.effects[0].filter_type = '冷蓝'
  draft.materials.video_effects[0].effect_type = ''
  expect(() => compileDraftTemplate(draft)).toThrow('effect_type')
})

it('强度范围、特效类别和参数列表校验，不悄悄丢弃错误数据', () => {
  const draft = fixture()
  draft.materials.effects[0].value = 1.2
  expect(() => compileDraftTemplate(draft)).toThrow('intensity')
  draft.materials.effects[0].value = 0
  draft.materials.video_effects[0].effect_category = 'bad'
  expect(() => compileDraftTemplate(draft)).toThrow('effect_category')
  draft.materials.video_effects[0].effect_category = 'character'
  draft.materials.video_effects[0].params = [101]
  expect(() => compileDraftTemplate(draft)).toThrow('params')
})

it('动态类型、强度、特效类别及数组都有实际运行时绑定', () => {
  const draft = fixture()
  draft.materials.effects[0].dynamic = ['name', 'value']
  draft.materials.video_effects[0].dynamic = ['effect_type', 'effect_category', 'params']
  const result = compileDraftTemplate(draft)
  expect(result.workflowInputBindings.every(binding => binding.runtime)).toBe(true)
  expect(result.workflow.inputs[inputName('滤镜', new Set())]).toEqual({ filter_type: '冷蓝' })
  expect(result.workflow.inputs[inputName('特效', new Set())]).toEqual({ effect_type: '模糊' })
  const actions = workflowActions(result.workflow)
  expect(actions.find(action => action.action_type === 'add_filter')?.params.intensity).toContain('* 100')
  expect(actions.find(action => action.action_type === 'add_effect')?.params.params).toBe('${input_effect_params}')
})

it('批量输入保留每条滤镜和特效的目录槽位及 ASCII key', () => {
  const draft = fixture()
  const scene = draft.scenes[0]
  scene.batch_scene = { source: 'items', mode: 'repeat', items: [
    { 滤镜: { filter_type: '冷蓝' }, 特效: { effect_type: '模糊' } },
    { 滤镜: { filter_type: '初恋' }, 特效: { effect_type: '闪黑' } }
  ] }
  scene.dynamic = ['batch_scene.items']
  scene.auto_duration = true
  scene.scenes = [{ id: 'body', target_timerange: { duration: 5_000_000 }, tracks: scene.tracks }]
  scene.tracks = []
  const result = compileDraftTemplate(draft)
  const binding = result.workflowInputBindings.find(binding => binding.key === 'scene.batch_scene.items')!
  expect(result.workflow.inputs[binding.variable]).toEqual([
    { [inputName('滤镜', new Set())]: { filter_type: '冷蓝' }, [inputName('特效', new Set())]: { effect_type: '模糊' } },
    { [inputName('滤镜', new Set())]: { filter_type: '初恋' }, [inputName('特效', new Set())]: { effect_type: '闪黑' } }
  ])
})

it.skipIf(!process.env.TEMPLATE_WORKFLOW_BACKEND)('后台真实求值器及函数签名验证滤镜特效，动态数值和数组不丢失', () => {
  const draft = fixture()
  const scene = draft.scenes[0]
  scene.dynamic = ['batch_scene.items']
  scene.batch_scene = { source: 'items', mode: 'repeat', items: [
    { 滤镜: { filter_type: '冷蓝' }, 特效: { effect_type: '模糊' } },
    { 滤镜: { filter_type: '初恋' }, 特效: { effect_type: '闪黑' } }
  ] }
  scene.auto_duration = true
  scene.scenes = [{ id: 'body', target_timerange: { duration: 5_000_000 }, tracks: scene.tracks }]
  scene.tracks = []
  draft.materials.effects[0].dynamic = ['value']
  draft.materials.video_effects[0].dynamic = ['effect_category', 'params']
  const compiled = compileDraftTemplate(draft)
  const inputs = compiled.workflow.inputs as Record<string, unknown>
  inputs.input_filter_value = .6
  inputs.input_effect_effect_category = 'character'
  inputs.input_effect_params = [20, null, 80]
  const output = execFileSync(process.env.TEMPLATE_WORKFLOW_PYTHON ?? 'python3', [
    'src/main/template/backendWorkflowContract.py', process.env.TEMPLATE_WORKFLOW_BACKEND!
  ], { input: JSON.stringify(prepareExecutionWorkflow(compiled.workflow)), encoding: 'utf8' }).trim().split('\n')
  const actions = JSON.parse(output[output.length - 1]) as Array<{ action_type: string; params: Record<string, unknown> }>
  expect(actions.filter(action => action.action_type === 'add_filter').map(action => action.params)).toMatchObject([
    { filter_type: '冷蓝', intensity: 60, start: 1, end: 3 },
    { filter_type: '初恋', intensity: 60, start: 6, end: 8 }
  ])
  expect(actions.filter(action => action.action_type === 'add_effect').map(action => action.params)).toMatchObject([
    { effect_type: '模糊', effect_category: 'character', params: [20, null, 80], start: 1, end: 3 },
    { effect_type: '闪黑', effect_category: 'character', params: [20, null, 80], start: 6, end: 8 }
  ])
})
