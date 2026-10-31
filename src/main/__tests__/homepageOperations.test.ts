import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ root: '', fetch: vi.fn(), failPackage: false, mockAppPath: '', packaged: false }))
vi.mock('electron', () => ({ app: { getVersion: () => '1.7.27', getAppPath: () => state.mockAppPath, get isPackaged() { return state.packaged } }, net: { fetch: state.fetch } }))
vi.mock('electron-store', () => ({ default: class { get(key: string) { return key === 'auth.vectcut_api_key' ? 'test-key' : undefined } } }))
vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ info() {}, warn() {}, debug() {} }) } }))
vi.mock('../utils', () => ({
  getDataPath: (subPath = '') => path.join(state.root, 'Data', subPath),
  getResourcePath: () => path.join(state.root, 'resources')
}))
vi.mock('../services/agents/skills/paths', () => ({ getGlobalSkillsRoot: () => path.join(state.root, 'GlobalSkills') }))
vi.mock('../services/agents/skills/SkillService', () => ({ skillService: { enableForAllAgents: vi.fn(), getSkillDirectory: vi.fn() } }))
vi.mock('node-stream-zip', () => ({ default: { async: class {
  async entries() { return { 'hero/SKILL.md': { size: 100 } } }
  async extract(_entry: unknown, directory: string) {
    await fs.mkdir(path.join(directory, 'hero'), { recursive: true })
    await fs.writeFile(path.join(directory, 'hero', 'SKILL.md'), '---\nname: 主图技能\n---\n# Skill')
    await fs.writeFile(path.join(directory, 'hero', 'example.json'), JSON.stringify({ inputs: { prompt: '使用@主图技能 技能' } }))
  }
  async close() {}
} } }))

const entry = { name: '主图技能', folderName: 'hero', title: '主图模版', version: '2.0.0', downloadUrl: 'https://example.com/hero.zip' }
const cacheRoot = () => path.join(state.root, 'Data', 'QuickSkills')
const activePath = () => path.join(cacheRoot(), 'manifest.json')
const pendingPath = () => path.join(cacheRoot(), 'pending-manifest.json')

beforeEach(async () => {
  vi.resetModules()
  state.fetch.mockReset()
  state.root = await fs.mkdtemp(path.join(os.tmpdir(), 'homepage-operations-'))
  state.failPackage = false
  state.mockAppPath = ''
  state.packaged = false
  const resource = path.join(state.root, 'resources', 'skills')
  await fs.mkdir(resource, { recursive: true })
  await fs.writeFile(path.join(resource, 'manifest.json'), '{"skills":{}}')
  await fs.mkdir(cacheRoot(), { recursive: true })
  await fs.writeFile(activePath(), '{"updatedAt":"old","skills":{}}')
  state.fetch.mockImplementation(async (url: string) => {
    if (new URL(url).pathname.endsWith('/skill_templates')) return { ok: true, json: async () => ({ code: 0, data: { updatedAt: 'new', skills: { hero: entry } } }) }
    if (url.endsWith('/hero.zip')) {
      if (state.failPackage) return { ok: false, status: 503 }
      return { ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer }
    }
    return { ok: false, status: 503 }
  })
})
afterEach(async () => { await fs.rm(state.root, { recursive: true, force: true }) })

describe('homepage operations snapshots', () => {
  it('requests the independent authenticated service and stages a versioned package without changing active data', async () => {
    const { installBuiltinSkills } = await import('../utils/builtinSkills')
    await installBuiltinSkills({ waitForRemoteSync: true })
    expect(state.fetch).toHaveBeenCalledWith('https://open.vectcut.com/client_operations/homepage/skill_templates?version=1.7.27', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer test-key' })
    }))
    expect(JSON.parse(await fs.readFile(activePath(), 'utf8')).updatedAt).toBe('old')
    const pending = JSON.parse(await fs.readFile(pendingPath(), 'utf8'))
    expect(pending.skills.hero.storageRelativePath).toBe('hero/2.0.0')
    expect(await fs.readFile(path.join(cacheRoot(), 'skills/hero/2.0.0/.version'), 'utf8')).toBe('2.0.0')
    await installBuiltinSkills({ waitForRemoteSync: true })
    expect(state.fetch.mock.calls.filter(([url]) => url.endsWith('/hero.zip'))).toHaveLength(1)
    expect(JSON.parse(await fs.readFile(activePath(), 'utf8')).updatedAt).toBe('old')
  })
  it('activates a complete staged snapshot only after a process restart', async () => {
    const { installBuiltinSkills } = await import('../utils/builtinSkills')
    await installBuiltinSkills({ waitForRemoteSync: true })
    vi.resetModules()
    const restarted = await import('../utils/builtinSkills')
    await restarted.installBuiltinSkills({ waitForRemoteSync: true })
    expect(JSON.parse(await fs.readFile(activePath(), 'utf8')).updatedAt).toBe('new')
    const { listQuickSkillSources } = await import('../utils/quickSkillStorage')
    expect((await listQuickSkillSources())[0].directory).toBe(path.join(cacheRoot(), 'skills/hero/2.0.0'))
  })
  it('keeps the active snapshot when a package cannot be downloaded', async () => {
    state.failPackage = true
    const { installBuiltinSkills } = await import('../utils/builtinSkills')
    await installBuiltinSkills({ waitForRemoteSync: true })
    expect(JSON.parse(await fs.readFile(activePath(), 'utf8')).updatedAt).toBe('old')
    await expect(fs.access(pendingPath())).rejects.toThrow()
  })
  it('accepts an empty successful configuration without restoring bundled entries', async () => {
    state.fetch.mockResolvedValue({ ok: true, json: async () => ({ code: 0, data: { skills: {} } }) })
    const { installBuiltinSkills } = await import('../utils/builtinSkills')
    await installBuiltinSkills({ waitForRemoteSync: true })
    vi.resetModules()
    await (await import('../utils/builtinSkills')).installBuiltinSkills({ waitForRemoteSync: true })
    const { listQuickSkillSources } = await import('../utils/quickSkillStorage')
    expect(await listQuickSkillSources()).toEqual([])
  })
})


describe('development homepage mock', () => {
  const previousFlag = process.env.HOMEPAGE_OPERATIONS_MOCK
  afterEach(() => {
    if (previousFlag === undefined) delete process.env.HOMEPAGE_OPERATIONS_MOCK
    else process.env.HOMEPAGE_OPERATIONS_MOCK = previousFlag
  })
  it('prepares three real runnable packages on the first dev launch without changing production cache', async () => {
    state.mockAppPath = process.cwd()
    delete process.env.HOMEPAGE_OPERATIONS_MOCK
    const { installBuiltinSkills } = await import('../utils/builtinSkills')
    await installBuiltinSkills({ waitForRemoteSync: true })
    const mockRoot = path.join(state.root, 'Data/QuickSkillsMock')
    const manifest = JSON.parse(await fs.readFile(path.join(mockRoot, 'manifest.json'), 'utf8'))
    expect(Object.keys(manifest.skills)).toHaveLength(3)
    const hero = manifest.skills['tuangou-one-image-draft']
    const heroPath = path.join(mockRoot, 'skills', hero.storageRelativePath)
    expect(await fs.readFile(path.join(heroPath, 'example.json'), 'utf8')).toBe(
      await fs.readFile(path.join(process.cwd(), 'dev-fixtures/homepage-operations/skills/tuangou-one-image-draft/example.json'), 'utf8'))
    await fs.access(path.join(heroPath, 'scripts/plan.mjs'))
    expect(await fs.readFile(path.join(heroPath, '.version'), 'utf8')).toBe(hero.version)
    expect(JSON.parse(await fs.readFile(activePath(), 'utf8')).updatedAt).toBe('old')
    expect(state.fetch.mock.calls.some(([url]) => url.includes('skill_templates') || url.includes('homepage-mock.invalid'))).toBe(false)
    const { listQuickSkillSources } = await import('../utils/quickSkillStorage')
    expect(await listQuickSkillSources()).toHaveLength(3)
    for (const folder of ['trendykoubo', 'travelguide']) {
      const example = JSON.parse(await fs.readFile(path.join(mockRoot, 'skills', manifest.skills[folder].storageRelativePath, 'example.json'), 'utf8'))
      expect(example.inputs.videos.source_video).toHaveLength(1)
      expect(example.inputs.audios.background_audio).toEqual([expect.objectContaining({ filename: 't-rex-roar.mp3', url: expect.stringMatching(/^https:/) })])
      expect(example.parameters.audios.groups[0].item_type).toBe('audio')
    }
  })
  it('restores the real cache when mock is disabled', async () => {
    state.mockAppPath = process.cwd()
    process.env.HOMEPAGE_OPERATIONS_MOCK = '0'
    const { isHomepageOperationsMockEnabled } = await import('../utils/homepageOperationsMock')
    const { getQuickSkillsRoot } = await import('../utils/quickSkillStorage')
    expect(isHomepageOperationsMockEnabled()).toBe(false)
    expect(getQuickSkillsRoot()).toBe(cacheRoot())
  })
  it('cannot enable mock in a packaged production app', async () => {
    state.mockAppPath = process.cwd()
    state.packaged = true
    process.env.HOMEPAGE_OPERATIONS_MOCK = '1'
    const { isHomepageOperationsMockEnabled } = await import('../utils/homepageOperationsMock')
    const { getQuickSkillsRoot } = await import('../utils/quickSkillStorage')
    expect(isHomepageOperationsMockEnabled()).toBe(false)
    expect(getQuickSkillsRoot()).toBe(cacheRoot())
  })
})
