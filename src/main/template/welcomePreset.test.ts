import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { prepareExecutionWorkflow } from './testExport'
import { createEditorPreset } from './editorPresets'
import { analyzeEditorDocument, compileEditorDocument } from './editorModel'
import { copyEditorElement } from './editorClipboard'
import { applyEditorAction } from './editorActions'
import { analyzeDraftTemplate, compileDraftTemplate, normalizeDraftTemplate, type DraftTemplate, type DraftSegment } from './draftTemplate'
import { isSceneSegment } from './draftTracks'
import { applyDynamicInputs } from './dynamicInputs'
import { workflowActions } from './workflowTestUtils'
import { resolveWelcomeAssetPaths } from './welcomeAssetPaths'
import { upgradeLegacyWelcomePreset } from './welcomePresetMigration'
import { WELCOME_ASSETS } from '../../shared/templateWelcomeAssets'

const welcome = () => createEditorPreset('personalized-welcome')
const payload = () => ({ templateJson: JSON.stringify(welcome()) })

export function legacyWelcomeFixture(): DraftTemplate {
  const draft = welcome()
  draft.materials.shapes = []
  for (const track of draft.scenes[0].tracks) {
    const scene = track.segments.find(isSceneSegment)!
    if (scene.id !== 'welcome-intro') {
      scene.preview_transition = { type: 'circular-wipe', duration: 1_000_000 }
      delete scene.common_keyframes
    }
    const background = scene.tracks[0]
    background.type = 'shape'
    const materialId = (background.segments[0] as DraftSegment).material_id
    draft.materials.videos = draft.materials.videos.filter(material => material.id !== materialId)
    draft.materials.shapes.push({ id: materialId, type: 'shape', geometry: 'rectangle', width: 720, height: 1280, fill: '#FFFFFF' })
    const decoration = scene.id === 'welcome-intro' ? 'welcome-intro-bar-1' : scene.id === 'welcome-brand' ? 'welcome-logo-left' : null
    if (decoration) {
      scene.tracks.push({ id: `${decoration}-track`, type: 'shape', segments: [{ id: decoration,
        material_id: `${decoration}-material`, target_timerange: { start: 0, duration: scene.target_timerange.duration } }] })
      draft.materials.shapes.push({ id: `${decoration}-material`, type: 'shape', geometry: 'rectangle', width: 40, height: 100, fill: '#487EF1' })
    }
    if (scene.id === 'welcome-brand') {
      scene.tracks = scene.tracks.filter(item => item.id !== 'welcome-brand-logo-track')
      draft.materials.videos = draft.materials.videos.filter(material => material.id !== 'welcome-brand-logo-material')
    }
  }
  return draft
}

describe('图片文字个性化欢迎预设', () => {
  it('720×1280、9.5 秒，三个重叠分镜与八个普通图片/文字图层', () => {
    const draft = welcome()
    expect(draft.canvas_config).toEqual({ width: 720, height: 1280 })
    const model = analyzeEditorDocument(payload())
    expect(model.duration).toBe(9.5)
    expect(model.timeline.filter(item => item.type === 'composition' && item.parentId === 'welcome-root')
      .map(({ start, end }) => [start, end])).toEqual([[0, 4.5], [3.5, 7.5], [6.5, 9.5]])
    expect(model.rows.filter(row => row.types.includes('composition'))).toHaveLength(3)
    expect(model.timeline.filter(item => item.type === 'image')).toHaveLength(4)
    expect(model.timeline.filter(item => item.type === 'text')).toHaveLength(4)
    expect(draft.materials).not.toHaveProperty('shapes')
    expect(JSON.stringify(draft)).not.toContain('preview_transition')
    expect(JSON.stringify(draft)).not.toContain('welcome-intro-bar')
    expect(JSON.stringify(draft)).not.toContain('welcome-logo-left')
    expect(normalizeDraftTemplate(draft).warnings).toEqual([])
  })

  it('姓名及文案继续使用可编辑动态 content，预设副本独立', () => {
    const draft = welcome()
    const inputs = analyzeDraftTemplate(draft).dynamicInputs
    expect(inputs).toHaveLength(4)
    const name = draft.materials.texts.find(item => item.id === 'welcome-name-material')!
    expect(name).toMatchObject({ dynamic: ['content'], editor_role: 'welcome-name' })
    expect(JSON.parse(name.content!)).toMatchObject({ text: '嗨，小明！', styles: [{ size: 52, bold: true }] })
    const input = inputs.find(item => item.targetId === name.id)!
    const changed = applyDynamicInputs(draft, { [input.key]: JSON.stringify({ text: '嗨，小红！' }) })
    expect(JSON.parse(changed.materials.texts.find(item => item.id === name.id)!.content!).text).toBe('嗨，小红！')
    expect(JSON.parse(name.content!).text).toBe('嗨，小明！')
    expect(draft.materials.texts.map(item => JSON.parse(item.content!).text)).toContain('欢迎使用 VectCut 🎉')
    draft.materials.videos[0].path = '/changed.png'
    expect(welcome().materials.videos[0].path).toBe(WELCOME_ASSETS.yellow)
  })

  it('官方 logo 是普通图片，复制后保留独立素材与缩放/透明度关键帧', () => {
    const original = payload()
    const pasted = applyEditorAction(original, { type: 'paste', id: 'welcome-brand-logo', clipboard: copyEditorElement(original, 'welcome-brand-logo') })
    const draft = JSON.parse(pasted.templateJson) as DraftTemplate
    const brand = draft.scenes[0].tracks[2].segments.find(isSceneSegment)!
    const copy = brand.tracks.flatMap(track => track.segments).find(item => item.id === pasted.selectedId) as DraftSegment
    expect(copy.material_id).not.toBe('welcome-brand-logo-material')
    expect(draft.materials.videos.find(material => material.id === copy.material_id)).toMatchObject({ type: 'photo', path: WELCOME_ASSETS.logo })
    expect(copy.common_keyframes!.map(group => group.property_type)).toEqual(['UNIFORM_SCALE', 'KFTypeAlpha'])
    expect(copy.common_keyframes![0].id).not.toBe('welcome-brand-logo-UNIFORM_SCALE')
    expect(analyzeEditorDocument(pasted).timeline.find(item => item.id === pasted.selectedId)).toMatchObject({ type: 'image', start: 6.5, end: 9.5 })
  })

  it('能编译图片/文字 Workflow 与淡入关键帧，没有形状或仅预览转场动作', () => {
    const compiled = compileEditorDocument(payload())
    const actions = workflowActions(compiled.workflow)
    expect(actions.filter(action => action.action_type === 'add_image')).toHaveLength(4)
    expect(actions.filter(action => action.action_type === 'add_text')).toHaveLength(4)
    expect(actions.some(action => action.action_type === 'add_video_keyframe')).toBe(true)
    expect(actions.every(action => ['add_image', 'add_text', 'add_video_keyframe'].includes(action.action_type!))).toBe(true)
    expect(JSON.stringify(compiled.workflow)).not.toContain('preview_transition')
    expect(compiled.duration).toBe(9.5)
  })

  const backend = process.env.TEMPLATE_WORKFLOW_BACKEND ?? '/Users/sunguannan/pyJianYingDraft/execute_workflow.py'
  it.skipIf(!existsSync(backend))('真实 Python 求值器接受欢迎示例的图片、文字及淡入关键帧参数（不执行媒体 IO）', () => {
    const python = process.env.TEMPLATE_WORKFLOW_PYTHON ??
      (existsSync('/tmp/capcut-workflow-contract-env/bin/python') ? '/tmp/capcut-workflow-contract-env/bin/python' : 'python3')
    const workflow = prepareExecutionWorkflow(compileDraftTemplate(welcome()).workflow)
    const output = execFileSync(python, ['-I', fileURLToPath(new URL('./backendWorkflowContract.py', import.meta.url)), backend], {
      input: JSON.stringify(workflow), encoding: 'utf8', timeout: 10_000
    }).trim().split('\n')
    const actions = JSON.parse(output[output.length - 1]) as Array<{ action_type: string; params: Record<string, unknown> }>
    expect(actions.filter(action => action.action_type === 'add_image')).toHaveLength(4)
    expect(actions.filter(action => action.action_type === 'add_text')).toHaveLength(4)
    const logo = actions.find(action => action.action_type === 'add_image' && action.params.image_url === WELCOME_ASSETS.logo)!
    expect(logo.params).toMatchObject({ start: 6.5, end: 9.5 })
    expect(actions.filter(action => action.action_type === 'add_video_keyframe' && action.params.track_name === logo.params.track_name).length).toBeGreaterThan(0)
  })

  it('只解析已知内置素材位置，保留外部与用户图片地址', () => {
    const draft = welcome()
    draft.materials.videos.push({ id: 'user', type: 'photo', path: '/Users/example/custom.png' })
    const resolved = resolveWelcomeAssetPaths(draft, '/Applications/VectCut.app/Contents/Resources/resources')
    expect(resolved.materials.videos.find(item => item.id === 'welcome-brand-logo-material')!.path)
      .toBe('file:///Applications/VectCut.app/Contents/Resources/resources/template-presets/personalized-welcome/logo/vectcut.png')
    expect(resolved.materials.videos.find(item => item.id === 'user')!.path).toBe('/Users/example/custom.png')
    expect(draft.materials.videos[0].path).toBe(WELCOME_ASSETS.yellow)
  })

  it('定向迁移旧欢迎示例，保留文案及用户图片，移除已知装饰并可重复运行', () => {
    const old = legacyWelcomeFixture()
    const name = old.materials.texts.find(item => item.id === 'welcome-name-material')!
    name.content = JSON.stringify({ text: '嗨，小雨！' })
    old.materials.videos.push({ id: 'custom-material', type: 'photo', path: '/custom.png' })
    const intro = old.scenes[0].tracks[0].segments.find(isSceneSegment)!
    intro.tracks.push({ id: 'custom-track', type: 'video', segments: [{ id: 'custom', material_id: 'custom-material', target_timerange: { duration: 1_000_000 } }] })
    const upgraded = upgradeLegacyWelcomePreset(old)
    expect(upgraded.changed).toBe(true)
    expect(old.materials.shapes).not.toHaveLength(0)
    expect(upgraded.template.materials).not.toHaveProperty('shapes')
    expect(upgraded.template.materials.videos.find(item => item.id === 'custom-material')!.path).toBe('/custom.png')
    expect(upgraded.template.materials.texts.find(item => item.id === name.id)!.content).toBe(name.content)
    expect(JSON.stringify(upgraded.template)).not.toContain('preview_transition')
    expect(upgraded.template.materials.videos.some(item => item.path === WELCOME_ASSETS.logo)).toBe(true)
    expect(() => compileDraftTemplate(upgraded.template)).not.toThrow()
    expect(upgradeLegacyWelcomePreset(upgraded.template).changed).toBe(false)
  })

  it('不迁移其他模板及用户自定义的未知几何图层', () => {
    const other = createEditorPreset('empty')
    expect(upgradeLegacyWelcomePreset(other)).toEqual({ template: other, changed: false })
    const old = legacyWelcomeFixture()
    old.materials.shapes.push({ id: 'unknown-shape', type: 'shape', geometry: 'ellipse', width: 40, height: 40, fill: '#FFFFFF' })
    const intro = old.scenes[0].tracks[0].segments.find(isSceneSegment)!
    intro.tracks.push({ id: 'unknown', type: 'shape', segments: [{ id: 'user-shape', material_id: 'unknown-shape', target_timerange: { duration: 1_000_000 } }] })
    const result = upgradeLegacyWelcomePreset(old)
    expect(result.template.materials.shapes.find(item => item.id === 'unknown-shape')).toBeDefined()
    expect(JSON.stringify(result.template)).toContain('user-shape')
  })

  it('独立预览转场仍明确拒绝导出，而非静默丢弃', () => {
    const transition = createEditorPreset('empty')
    transition.scenes[0].preview_transition = { type: 'circular-wipe', duration: 1_000_000 }
    expect(analyzeDraftTemplate(transition).duration).toBe(15)
    expect(() => compileDraftTemplate(transition)).toThrow(/preview_transition.*仅支持本地预览/)
  })
})
