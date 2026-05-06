import fs from 'node:fs/promises'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installBuiltinSkills } from '../utils/builtinSkills'

vi.mock('node:fs/promises', () => ({
  default: {
    access: vi.fn(),
    readdir: vi.fn(),
    mkdir: vi.fn(),
    cp: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn()
  }
}))

vi.mock('electron', () => ({
  app: {
    getAppPath: vi.fn(() => '/app'),
    getPath: vi.fn(() => '/userData'),
    getVersion: vi.fn(() => '2.0.0')
  }
}))

vi.mock('../utils', () => ({
  getDataPath: vi.fn((subPath?: string) => (subPath ? path.join('/userData/Data', subPath) : '/userData/Data')),
  toAsarUnpackedPath: vi.fn((filePath: string) => filePath)
}))

const { mockEnableForAllAgents } = vi.hoisted(() => ({
  mockEnableForAllAgents: vi.fn()
}))

vi.mock('../services/agents/skills/SkillService', () => ({
  skillService: {
    enableForAllAgents: mockEnableForAllAgents
  }
}))

const resourceSkillsPath = '/app/resources/skills'
const globalSkillsPath = '/userData/Data/Skills'

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('installBuiltinSkills', () => {
  it('should return early when resources/skills does not exist', async () => {
    vi.mocked(fs.access).mockRejectedValueOnce(new Error('ENOENT'))

    await installBuiltinSkills()

    expect(fs.access).toHaveBeenCalledWith(resourceSkillsPath)
    expect(fs.readdir).not.toHaveBeenCalled()
  })

  it('should copy skills that do not exist at destination', async () => {
    vi.mocked(fs.access).mockResolvedValueOnce(undefined) // resourceSkillsPath exists
    vi.mocked(fs.readdir).mockResolvedValueOnce([{ name: 'my-skill', isDirectory: () => true }] as any)
    // Destination .version read fails → skill not installed yet
    vi.mocked(fs.readFile).mockRejectedValueOnce(new Error('ENOENT'))
    vi.mocked(fs.mkdir).mockResolvedValue(undefined as any)
    vi.mocked(fs.cp).mockResolvedValue(undefined)
    vi.mocked(fs.writeFile).mockResolvedValue(undefined)
    await installBuiltinSkills()

    expect(fs.mkdir).toHaveBeenCalledWith(path.join(globalSkillsPath, 'my-skill'), { recursive: true })
    expect(fs.cp).toHaveBeenCalledWith(
      path.join(resourceSkillsPath, 'my-skill'),
      path.join(globalSkillsPath, 'my-skill'),
      { recursive: true }
    )
    expect(fs.writeFile).toHaveBeenCalledWith(path.join(globalSkillsPath, 'my-skill', '.version'), '2.0.0', 'utf-8')
    expect(mockEnableForAllAgents).toHaveBeenCalledWith('my-skill', 'my-skill')
  })

  it('should fan out to agents even when skill is already up to date', async () => {
    vi.mocked(fs.access).mockResolvedValueOnce(undefined)
    vi.mocked(fs.readdir).mockResolvedValueOnce([{ name: 'my-skill', isDirectory: () => true }] as any)
    vi.mocked(fs.readFile).mockResolvedValueOnce('2.0.0' as any) // up to date

    await installBuiltinSkills()

    expect(fs.cp).not.toHaveBeenCalled()
    expect(mockEnableForAllAgents).toHaveBeenCalledWith('my-skill', 'my-skill')
  })

  it('should update skills when app version is newer', async () => {
    vi.mocked(fs.access).mockResolvedValueOnce(undefined)
    vi.mocked(fs.readdir).mockResolvedValueOnce([{ name: 'my-skill', isDirectory: () => true }] as any)
    vi.mocked(fs.readFile).mockResolvedValueOnce('1.0.0' as any)
    vi.mocked(fs.mkdir).mockResolvedValue(undefined as any)
    vi.mocked(fs.cp).mockResolvedValue(undefined)
    vi.mocked(fs.writeFile).mockResolvedValue(undefined)

    await installBuiltinSkills()

    expect(fs.cp).toHaveBeenCalledWith(
      path.join(resourceSkillsPath, 'my-skill'),
      path.join(globalSkillsPath, 'my-skill'),
      { recursive: true }
    )
    expect(fs.writeFile).toHaveBeenCalledWith(path.join(globalSkillsPath, 'my-skill', '.version'), '2.0.0', 'utf-8')
    expect(mockEnableForAllAgents).toHaveBeenCalledWith('my-skill', 'my-skill')
  })

  it('should skip entries with path traversal in name', async () => {
    vi.mocked(fs.access).mockResolvedValueOnce(undefined)
    vi.mocked(fs.readdir).mockResolvedValueOnce([
      { name: '..', isDirectory: () => true },
      { name: '../etc', isDirectory: () => true }
    ] as any)

    await installBuiltinSkills()

    expect(fs.mkdir).not.toHaveBeenCalled()
    expect(fs.cp).not.toHaveBeenCalled()
  })

  it('should skip non-directory entries', async () => {
    vi.mocked(fs.access).mockResolvedValueOnce(undefined)
    vi.mocked(fs.readdir).mockResolvedValueOnce([{ name: 'README.md', isDirectory: () => false }] as any)

    await installBuiltinSkills()

    expect(fs.mkdir).not.toHaveBeenCalled()
    expect(fs.cp).not.toHaveBeenCalled()
    expect(mockEnableForAllAgents).not.toHaveBeenCalled()
  })
})
