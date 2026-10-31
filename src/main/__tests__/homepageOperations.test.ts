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

const cacheRoot = () => path.join(state.root, 'Data', 'QuickSkills')
beforeEach(async () => {
  vi.resetModules()
  state.fetch.mockReset()
  state.fetch.mockResolvedValue({ ok: false, status: 503 })
  state.root = await fs.mkdtemp(path.join(os.tmpdir(), 'homepage-bundled-'))
  const resource = path.join(state.root, 'resources')
  await fs.mkdir(path.join(resource, 'skills'), { recursive: true })
  await fs.writeFile(path.join(resource, 'skills/manifest.json'), '{"skills":{}}')
  await fs.mkdir(path.join(resource, 'quick'), { recursive: true })
  await fs.cp(path.join(process.cwd(), 'resources/quick/skills'), path.join(resource, 'quick/skills'), { recursive: true })
  await fs.mkdir(cacheRoot(), { recursive: true })
  const stale = JSON.stringify({ skills: { stale: { folderName: 'stale', version: '99.0.0' } } })
  await fs.writeFile(path.join(cacheRoot(), 'manifest.json'), stale)
  await fs.writeFile(path.join(cacheRoot(), 'pending-manifest.json'), stale)
})
afterEach(async () => { await fs.rm(state.root, { recursive: true, force: true }) })

describe('bundled homepage templates', () => {
  it.each([false, true])('uses bundled display and execution sources with packaged=%s, ignoring cached snapshots', async (packaged) => {
    state.packaged = packaged
    state.mockAppPath = process.cwd()
    const { installBuiltinSkills } = await import('../utils/builtinSkills')
    await installBuiltinSkills({ waitForRemoteSync: true })
    const { getActiveQuickSkills, listQuickSkillSources } = await import('../utils/quickSkillStorage')
    const { selectHomepageSkills } = await import('../../shared/quickSkillManifest')
    const { manifest, basePath } = await getActiveQuickSkills()
    expect(basePath).toBe(path.join(state.root, 'resources/quick/skills'))
    const names = ['tuangou-one-image-draft', 'micro-world-product-draft', 'maternal-science-koubo-draft']
    expect(selectHomepageSkills(manifest, '1.7.27').map((entry) => entry.folderName)).toEqual(names)
    const sources = await listQuickSkillSources()
    expect(sources.map((source) => source.folderName)).toEqual(names)
    for (const source of sources) {
      expect(source.directory).toBe(path.join(basePath, source.folderName))
      await fs.access(path.join(source.directory, 'SKILL.md'))
      await fs.access(path.join(source.directory, 'example.json'))
    }
    expect(state.fetch.mock.calls.some(([url]) => String(url).includes('skill_templates'))).toBe(false)
    expect(JSON.parse(await fs.readFile(path.join(cacheRoot(), 'manifest.json'), 'utf8')).skills.stale).toBeDefined()
    await fs.access(path.join(cacheRoot(), 'pending-manifest.json'))

  })
})
