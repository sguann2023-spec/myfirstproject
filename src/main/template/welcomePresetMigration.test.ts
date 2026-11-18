import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWelcomePreset, welcomeAnimation } from './welcomePreset'
import { upgradeLegacyWelcomePreset } from './welcomePresetMigration'
import { resolveWelcomeAssetPaths } from './welcomeAssetPaths'
import { normalizeDraftTemplate, type DraftTemplate, type DraftScene, type DraftSegment } from './draftTemplate'
import { isSceneSegment } from './draftTracks'
import { WELCOME_ASSETS } from '../../shared/templateWelcomeAssets'

const storage = vi.hoisted(() => ({ root: '', resources: '/current-install/resources' }))
vi.mock('../utils', () => ({
  getResourcePath: () => storage.resources,
  getDataPath: (subPath = '') => {
    const directory = path.join(storage.root, 'Data', subPath)
    fs.mkdirSync(directory, { recursive: true })
    return directory
  }
}))

const child = (draft: DraftTemplate, id: string) => draft.scenes[0].tracks.flatMap(track => track.segments)
  .find(item => item.id === id) as DraftScene
const title = (draft: DraftTemplate) => child(draft, 'welcome-brand').tracks.flatMap(track => track.segments)
  .find(item => item.id === 'welcome-brand-name') as DraftSegment

function legacyWelcome(): DraftTemplate {
  const draft = createWelcomePreset()
  draft.materials.shapes = []
  for (const parentTrack of draft.scenes[0].tracks) {
    const scene = parentTrack.segments.find(isSceneSegment)!
    if (scene.id !== 'welcome-intro') {
      scene.preview_transition = { type: 'circular-wipe', duration: 1_000_000 }
      delete scene.common_keyframes
    }
    const background = scene.tracks[0]
    background.type = 'shape'
    const materialId = (background.segments[0] as DraftSegment).material_id
    draft.materials.videos = draft.materials.videos.filter(material => material.id !== materialId)
    draft.materials.shapes.push({ id: materialId, type: 'shape', geometry: 'rectangle', width: 720, height: 1280, fill: '#FFD43B' })
    if (scene.id === 'welcome-brand') {
      scene.tracks = scene.tracks.filter(track => track.id !== 'welcome-brand-logo-track')
      draft.materials.videos = draft.materials.videos.filter(material => material.id !== 'welcome-brand-logo-material')
      scene.tracks.push({ id: 'welcome-logo-left-track', type: 'shape', segments: [{ id: 'welcome-logo-left',
        material_id: 'welcome-logo-left-material', target_timerange: { duration: 3_000_000 } }] })
      draft.materials.shapes.push({ id: 'welcome-logo-left-material', type: 'shape', geometry: 'rectangle', width: 40, height: 100, fill: '#487EF1' })
    }
  }
  return draft
}

beforeEach(() => { storage.root = fs.mkdtempSync(path.join(os.tmpdir(), 'welcome-migration-')) })
afterEach(() => { fs.rmSync(storage.root, { recursive: true, force: true }) })

describe('欢迎示例迁移安全性', () => {
  it('完整保留用户编辑的品牌文字变换和关键帧，保留原有空轨道', () => {
    const draft = legacyWelcome()
    title(draft).clip = { transform: { x: 0.5, y: 0.75 }, scale: { x: 2, y: 2 }, rotation: 45, alpha: 0.3 }
    title(draft).common_keyframes = [welcomeAnimation('edited-title', 'KFTypePositionY', [[0, 0.75], [1_000_000, 0.8]])]
    const empty = { id: 'user-empty-track', type: 'mixed', segments: [] }
    child(draft, 'welcome-intro').tracks.push(empty)
    const before = structuredClone(draft)
    const upgraded = upgradeLegacyWelcomePreset(draft)
    expect(title(upgraded.template)).toEqual(title(before))
    expect(child(upgraded.template, 'welcome-intro').tracks).toContainEqual(empty)
    expect(draft).toEqual(before)
    expect(() => normalizeDraftTemplate(upgraded.template)).not.toThrow()
    expect(upgradeLegacyWelcomePreset(upgraded.template)).toEqual({ template: upgraded.template, changed: false })
  })

  it('先使用稳定 ID，发生素材、轨道、关键帧冲突时生成独立 ID', () => {
    const draft = legacyWelcome()
    draft.materials.videos.push(
      { id: 'welcome-intro-background-image-material', type: 'photo', path: '/user-background.png' },
      { id: 'welcome-brand-logo-material', type: 'photo', path: '/user-logo.png' })
    child(draft, 'welcome-intro').tracks.push({ id: 'welcome-brand-logo-track', type: 'video', segments: [{
      id: 'user-image', material_id: 'welcome-brand-logo-material', target_timerange: { duration: 1_000_000 },
      common_keyframes: [
        welcomeAnimation('welcome-brand-logo', 'UNIFORM_SCALE', [[0, 1], [500_000, 2]]),
        welcomeAnimation('welcome-brand-logo', 'KFTypeAlpha', [[0, 1], [500_000, 0.5]]),
        welcomeAnimation('welcome-journey', 'KFTypeAlpha', [[0, 1], [500_000, 0.5]])
      ]
    }] })
    const upgraded = upgradeLegacyWelcomePreset(draft).template
    const background = child(upgraded, 'welcome-intro').tracks[0].segments[0] as DraftSegment
    expect(background.material_id).not.toBe('welcome-intro-background-image-material')
    const logoTrack = child(upgraded, 'welcome-brand').tracks.find(track => track.segments.some(item => item.id === 'welcome-brand-logo'))!
    expect(logoTrack.id).not.toBe('welcome-brand-logo-track')
    expect((logoTrack.segments[0] as DraftSegment).material_id).not.toBe('welcome-brand-logo-material')
    expect(upgraded.materials.videos.find(material => material.id === 'welcome-brand-logo-material')!.path).toBe('/user-logo.png')
    expect(() => normalizeDraftTemplate(upgraded)).not.toThrow()
    const normal = upgradeLegacyWelcomePreset(legacyWelcome()).template
    expect((child(normal, 'welcome-intro').tracks[0].segments[0] as DraftSegment).material_id)
      .toBe('welcome-intro-background-image-material')
  })

  it('其他分镜已有同名 logo 片段时，新片段不会复用该 ID', () => {
    const draft = legacyWelcome()
    draft.materials.videos.push({ id: 'user-photo', type: 'photo', path: '/user.png' })
    child(draft, 'welcome-intro').tracks.push({ id: 'user-track', type: 'video', segments: [{
      id: 'welcome-brand-logo', material_id: 'user-photo', target_timerange: { duration: 1_000_000 }
    }] })
    const upgraded = upgradeLegacyWelcomePreset(draft).template
    const logoTrack = child(upgraded, 'welcome-brand').tracks.find(track => track.id === 'welcome-brand-logo-track')!
    expect(logoTrack.segments[0].id).not.toBe('welcome-brand-logo')
    expect(() => normalizeDraftTemplate(upgraded)).not.toThrow()
  })

  it('先过滤被移除装饰，再将剩下的背景轨道改为图片轨道', () => {
    const draft = legacyWelcome()
    const track = child(draft, 'welcome-intro').tracks[0]
    track.segments[0].target_timerange.duration = 3_500_000
    track.segments.push({ id: 'welcome-intro-bar-1', material_id: 'welcome-intro-bar-1-material',
      target_timerange: { start: 3_500_000, duration: 1_000_000 } })
    draft.materials.shapes.push({ id: 'welcome-intro-bar-1-material', type: 'shape', geometry: 'rectangle', width: 40, height: 100, fill: '#FFFFFF' })
    const upgraded = upgradeLegacyWelcomePreset(draft).template
    expect(child(upgraded, 'welcome-intro').tracks[0]).toMatchObject({ type: 'video', segments: [{ id: 'welcome-intro-background' }] })
    expect(() => normalizeDraftTemplate(upgraded)).not.toThrow()
  })

  it.each(['start', 'end'] as const)('拒绝删除被 %s 自动对齐引用的装饰，原文件和备份均不写入', async side => {
    const draft = legacyWelcome()
    title(draft).auto_timing = { [side]: { target: 'welcome-logo-left', anchor: side } }
    const before = structuredClone(draft)
    expect(() => upgradeLegacyWelcomePreset(draft)).toThrow(/请先解除.*welcome-logo-left.*再更新/)
    expect(draft).toEqual(before)
    const { createStoredTemplateDocument, loadStoredTemplateDocument } = await import('./templateStorage')
    const stored = createStoredTemplateDocument('empty')
    const originalJson = JSON.stringify(draft)
    fs.writeFileSync(stored.templateStorage.templatePath, originalJson)
    expect(() => loadStoredTemplateDocument(stored.templateStorage.templatePath)).toThrow(/请先解除/)
    expect(fs.readFileSync(stored.templateStorage.templatePath, 'utf8')).toBe(originalJson)
    expect(fs.existsSync(path.join(stored.templateStorage.directory, 'template.before-image-logo.json'))).toBe(false)
  })

  it('迁移输出校验失败时不覆写原 JSON，也不生成误导性备份', async () => {
    const draft = legacyWelcome()
    draft.materials.shapes.push({ id: 'user-shape-material', type: 'shape', geometry: 'ellipse', width: 40, height: 40, fill: '#FFFFFF' })
    child(draft, 'welcome-intro').tracks.push({ id: 'user-shape-track', type: 'shape', segments: [{
      id: 'user-shape', material_id: 'user-shape-material', target_timerange: { duration: 1_000_000 }
    }] })
    const { createStoredTemplateDocument, loadStoredTemplateDocument } = await import('./templateStorage')
    const stored = createStoredTemplateDocument('empty')
    const originalJson = JSON.stringify(draft)
    fs.writeFileSync(stored.templateStorage.templatePath, originalJson)
    expect(() => loadStoredTemplateDocument(stored.templateStorage.templatePath)).toThrow('轨道类型')
    expect(fs.readFileSync(stored.templateStorage.templatePath, 'utf8')).toBe(originalJson)
    expect(fs.existsSync(path.join(stored.templateStorage.directory, 'template.before-image-logo.json'))).toBe(false)
  })
})

describe('内置素材来源绑定', () => {
  it('记录精确内置来源，安装位置改变后可重新绑定且重复解析幂等', () => {
    const old = resolveWelcomeAssetPaths(createWelcomePreset(), '/old install/resources')
    expect(old.materials.videos[0]).toMatchObject({ editor_builtin_asset: {
      source: WELCOME_ASSETS.yellow, resolved_path: old.materials.videos[0].path
    } })
    const moved = resolveWelcomeAssetPaths(old, '/Applications/VectCut.app/Contents/Resources/resources')
    expect(moved.materials.videos[0].path)
      .toBe('file:///Applications/VectCut.app/Contents/Resources/resources/template-presets/personalized-welcome/background-yellow.png')
    expect(resolveWelcomeAssetPaths(moved, '/Applications/VectCut.app/Contents/Resources/resources')).toEqual(moved)
    expect(old.materials.videos[0].path).toContain('/old%20install/')
  })

  it('不劫持仅后缀相同的远程、本地或旧未标记图片，也不覆盖用户换图', () => {
    const draft = resolveWelcomeAssetPaths(createWelcomePreset(), '/old/resources')
    draft.materials.videos[0].path = '/my/custom.png'
    const userPaths = [
      `https://cdn.example.com/user${WELCOME_ASSETS.logo}`,
      `/user-content${WELCOME_ASSETS.logo}`,
      `file:///user-content${WELCOME_ASSETS.logo}`,
      'C:\\User\\resources\\template-presets\\personalized-welcome\\logo\\vectcut.png'
    ]
    userPaths.forEach((source, index) => draft.materials.videos.push({ id: `user-${index}`, type: 'photo', path: source }))
    const resolved = resolveWelcomeAssetPaths(draft, '/new/resources')
    expect(resolved.materials.videos[0].path).toBe('/my/custom.png')
    expect(resolved.materials.videos.slice(-userPaths.length).map(material => material.path)).toEqual(userPaths)
  })

  it('纯用户远程来源加载时不重写存储文件', async () => {
    const { createStoredTemplateDocument, loadStoredTemplateDocument } = await import('./templateStorage')
    const stored = createStoredTemplateDocument('empty')
    const draft = JSON.parse(stored.templateJson) as DraftTemplate
    draft.materials.videos.push({ id: 'user-image', type: 'photo', path: `https://cdn.example.com/user${WELCOME_ASSETS.logo}` })
    const originalJson = JSON.stringify(draft)
    fs.writeFileSync(stored.templateStorage.templatePath, originalJson)
    expect(loadStoredTemplateDocument(stored.templateStorage.templatePath).templateJson).toBe(originalJson)
    expect(fs.readFileSync(stored.templateStorage.templatePath, 'utf8')).toBe(originalJson)
  })
})
