import { expect, it } from 'vitest'
import { compileDraftTemplate, analyzeDraftTemplate, type DraftTemplate } from './draftTemplate'
import { workflowActions } from './workflowTestUtils'
import { inputName } from './inputNames'
import { stickerIdentifier } from './stickerWorkflow'
import { execFileSync } from 'node:child_process'
import { prepareExecutionWorkflow } from './testExport'

export function stickerFixture(): DraftTemplate {
  return {
    canvas_config: { width: 720, height: 1280 },
    materials: { stickers: [{ id: 'material', type: 'sticker', sticker_id: '', resource_id: '123456789' }] },
    scenes: [{ id: 'scene', target_timerange: { duration: 5_000_000 }, tracks: [{
      id: 'track', type: 'sticker', track_relative_index: 3, segments: [{
        id: 'sticker', name: '贴纸', material_id: 'material', target_timerange: { start: 1_000_000, duration: 2_000_000 },
        clip: { transform: { x: .25, y: -.3 }, scale: { x: 1.2, y: .8 }, alpha: .6, rotation: 15,
          flip: { horizontal: true, vertical: false } }
      }]
    }] }]
  }
}

it('贴纸原生资源、目标时间和全部后台变换字段正确映射', () => {
  const draft = stickerFixture()
  const original = structuredClone(draft)
  const result = compileDraftTemplate(draft)
  expect(result.workflow.script[0]).toMatchObject({
    action_type: 'add_sticker', params: {
      sticker_id: '123456789', start: 1, end: 3, width: 720, height: 1280,
      transform_x: .25, transform_y: -.3, scale_x: 1.2, scale_y: .8, alpha: .6, rotation: 15,
      flip_horizontal: true, flip_vertical: false, track_name: expect.any(String), relative_index: expect.any(Number)
    }
  })
  expect(result.workflow.script[0].params).not.toHaveProperty('source')
  expect(result.warnings.some(value => value.includes('sticker.clip'))).toBe(false)
  expect(draft).toEqual(original)
})

it('资源 ID 优先 sticker_id，兼容 resource_id 和数字 ID，不作为媒体路径解析', () => {
  expect(stickerIdentifier({ sticker_id: ' primary ', resource_id: 'fallback' })).toBe('primary')
  expect(stickerIdentifier({ sticker_id: '', resource_id: 123 })).toBe('123')
  const draft = stickerFixture()
  draft.materials.stickers[0].sticker_id = 'primary'
  expect(compileDraftTemplate(draft).workflow.script[0].params?.sticker_id).toBe('primary')
})

it('空资源仍可编辑，导出明确提示填写资源 ID；非法变换不忽略', () => {
  const draft = stickerFixture()
  draft.materials.stickers[0].resource_id = ''
  expect(() => analyzeDraftTemplate(draft)).not.toThrow()
  expect(() => compileDraftTemplate(draft)).toThrow('sticker_id/resource_id')
  draft.materials.stickers[0].resource_id = '123'
  draft.scenes[0].tracks[0].segments[0].clip = { alpha: '0.5' }
  expect(() => compileDraftTemplate(draft)).toThrow('alpha')
})

it('动态资源输入按目录标签分组，时间及变换绑定保持可执行', () => {
  const draft = stickerFixture()
  draft.materials.stickers[0].dynamic = ['resource_id']
  draft.scenes[0].tracks[0].segments[0].dynamic = ['target_timerange.duration', 'clip.alpha', 'clip.flip.horizontal']
  const result = compileDraftTemplate(draft)
  const resource = result.workflowInputBindings.find(item => item.key === 'material.resource_id')!
  expect(resource).toMatchObject({ variable: inputName('贴纸', new Set()), inputPath: ['sticker_id'], runtime: true })
  expect(result.workflow.inputs[resource.variable]).toEqual({ sticker_id: '123456789' })
  expect(result.workflowInputBindings.filter(item => item.runtime)).toHaveLength(4)
  expect(workflowActions(result.workflow)[0].params).toMatchObject({
    alpha: expect.stringContaining('input_sticker_clip_alpha'),
    flip_horizontal: expect.stringContaining('input_sticker_clip_flip_horizontal'),
    sticker_id: expect.stringContaining(`${resource.variable}.sticker_id`)
  })
})

it('批量贴纸可逐条替换资源 ID，保留中文标签并使用 ASCII key', () => {
  const draft = stickerFixture()
  draft.scenes[0].dynamic = ['batch_scene.items']
  draft.scenes[0].batch_scene = { source: 'items', mode: 'repeat', items: [
    { 贴纸: { sticker_id: 'first' } }, { 贴纸: { sticker_id: 'second' } }
  ] }
  draft.scenes[0].scenes = [{ id: 'body', target_timerange: { duration: 5_000_000 }, tracks: draft.scenes[0].tracks }]
  draft.scenes[0].tracks = []
  const result = compileDraftTemplate(draft)
  const binding = result.workflowInputBindings.find(item => item.key === 'scene.batch_scene.items')!
  expect(result.workflow.inputs[binding.variable]).toEqual([
    { [inputName('贴纸', new Set())]: { sticker_id: 'first' } },
    { [inputName('贴纸', new Set())]: { sticker_id: 'second' } }
  ])
  expect(workflowActions(result.workflow)[0].params.sticker_id).toContain('.sticker_id}')
})

it('贴纸与文字混轨时拆为不同后端类型并保留视觉层级', () => {
  const draft = stickerFixture()
  draft.materials.texts = [{ id: 'text', type: 'text', content: '{"text":"文案"}' }]
  draft.scenes[0].tracks[0].type = 'mixed'
  draft.scenes[0].tracks[0].segments.push({
    id: 'text-segment', material_id: 'text', target_timerange: { start: 3_000_000, duration: 2_000_000 }
  })
  const result = compileDraftTemplate(draft)
  expect(new Set(result.workflow.script.map(action => action.params?.track_name)).size).toBe(2)
  expect(result.workflowTracks.map(track => track.type).sort()).toEqual(['sticker', 'text'])
})

it.skipIf(!process.env.TEMPLATE_WORKFLOW_BACKEND)('真实后台求值器按逐条资源和变换执行贴纸，参数匹配 add_sticker_impl', () => {
  const draft = stickerFixture()
  const segment = draft.scenes[0].tracks[0].segments[0]
  segment.dynamic = ['clip.alpha', 'clip.flip.horizontal']
  draft.scenes[0].dynamic = ['batch_scene.items']
  draft.scenes[0].batch_scene = { source: 'items', mode: 'repeat', items: [
    { 贴纸: { sticker_id: 'first' } }, { 贴纸: { sticker_id: 'second' } }
  ] }
  draft.scenes[0].auto_duration = true
  draft.scenes[0].scenes = [{ id: 'body', target_timerange: { duration: 5_000_000 }, tracks: draft.scenes[0].tracks }]
  draft.scenes[0].tracks = []
  const compiled = compileDraftTemplate(draft)
  const alpha = compiled.workflowInputBindings.find(item => item.key === 'sticker.clip.alpha')!
  const flip = compiled.workflowInputBindings.find(item => item.key === 'sticker.clip.flip.horizontal')!
  compiled.workflow.inputs[alpha.variable] = .9
  compiled.workflow.inputs[flip.variable] = false
  const output = execFileSync(process.env.TEMPLATE_WORKFLOW_PYTHON ?? 'python3', [
    'src/main/template/backendWorkflowContract.py', process.env.TEMPLATE_WORKFLOW_BACKEND!
  ], { input: JSON.stringify(prepareExecutionWorkflow(compiled.workflow)), encoding: 'utf8' }).trim().split('\n')
  const actions = JSON.parse(output[output.length - 1])
  expect(actions.map((action: { params: Record<string, unknown> }) => action.params)).toMatchObject([
    { sticker_id: 'first', start: 1, end: 3, alpha: .9, flip_horizontal: false },
    { sticker_id: 'second', start: 6, end: 8, alpha: .9, flip_horizontal: false }
  ])
})
