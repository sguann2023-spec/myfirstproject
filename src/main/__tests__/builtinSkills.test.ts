import fs from 'node:fs/promises'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockEnableForAllAgents,
  mockInstallFromZip,
  mockNetFetch,
  mockUninstallByFolderName
} = vi.hoisted(() => ({
  mockEnableForAllAgents: vi.fn(),
  mockInstallFromZip: vi.fn(),
  mockNetFetch: vi.fn(),
  mockUninstallByFolderName: vi.fn()
}))

vi.mock('node:fs/promises', () => ({
  default: {
    access: vi.fn(),
    readdir: vi.fn(),
    mkdir: vi.fn(),
    cp: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    rm: vi.fn()
  }
}))

vi.mock('electron', () => ({
  app: {
    getAppPath: vi.fn(() => '/app'),
    getPath: vi.fn(() => '/userData'),
    getVersion: vi.fn(() => '2.0.0')
  },
  net: {
    fetch: mockNetFetch
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }))
  }
}))

vi.mock('../utils', () => ({
  getDataPath: vi.fn((subPath?: string) => (subPath ? path.join('/userData/Data', subPath) : '/userData/Data')),
  getResourcePath: vi.fn(() => '/app/resources'),
  toAsarUnpackedPath: vi.fn((filePath: string) => filePath)
}))

vi.mock('../services/agents/skills/SkillService', () => ({
  skillService: {
    enableForAllAgents: mockEnableForAllAgents,
    installFromZip: mockInstallFromZip,
    uninstallByFolderName: mockUninstallByFolderName
  }
}))

const resourceSkillsPath = '/app/resources/skills'
const globalSkillsPath = '/userData/Data/Skills'
const localManifestPath = path.join(resourceSkillsPath, 'manifest.json')
const syncStatePath = path.join(globalSkillsPath, '.builtin-sync-state.json')
const localManifest = {
  updatedAt: '2026-05-13T00:00:00Z',
  skills: {
    'my-skill': {
      version: '1.0.0',
      downloadUrl: 'https://player.install-ai-guider.top/skills/my-skill.zip',
      minAppVersion: '0.0.0'
    }
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockNetFetch.mockResolvedValue({
    ok: false,
    status: 503
  } as any)
  mockInstallFromZip.mockResolvedValue({
    id: 'my-skill',
    name: 'my-skill',
    description: null,
    folderName: 'my-skill',
    source: 'builtin',
    sourceUrl: null,
    namespace: null,
    author: null,
    tags: [],
    contentHash: '',
    isEnabled: false,
    createdAt: 0,
    updatedAt: 0
  })
  mockUninstallByFolderName.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('installBuiltinSkills', () => {
  it('should return early when resources/skills does not exist', async () => {
    vi.mocked(fs.access).mockRejectedValueOnce(new Error('ENOENT'))

    const { installBuiltinSkills } = await import('../utils/builtinSkills')
    await installBuiltinSkills({ waitForRemoteSync: true })


    expect(fs.access).toHaveBeenCalledWith(resourceSkillsPath)
    expect(fs.readdir).not.toHaveBeenCalled()
  })

  it('should copy skills that do not exist at destination', async () => {
    vi.mocked(fs.access).mockResolvedValueOnce(undefined) // resourceSkillsPath exists
    vi.mocked(fs.readdir).mockResolvedValueOnce([{ name: 'my-skill', isDirectory: () => true }] as any)
    vi.mocked(fs.mkdir).mockResolvedValue(undefined as any)
    vi.mocked(fs.cp).mockResolvedValue(undefined)
    vi.mocked(fs.writeFile).mockResolvedValue(undefined)

    vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
      const targetPath = String(filePath)
      if (targetPath === localManifestPath) {
        return JSON.stringify(localManifest) as any
      }
      throw new Error('ENOENT')
    })

    const { installBuiltinSkills } = await import('../utils/builtinSkills')
    await installBuiltinSkills({ waitForRemoteSync: true })

    expect(fs.mkdir).toHaveBeenCalledWith(path.join(globalSkillsPath, 'my-skill'), { recursive: true })
    expect(fs.cp).toHaveBeenCalledWith(
      path.join(resourceSkillsPath, 'my-skill'),
      path.join(globalSkillsPath, 'my-skill'),
      { recursive: true }
    )
    expect(fs.writeFile).toHaveBeenCalledWith(path.join(globalSkillsPath, 'my-skill', '.version'), '1.0.0', 'utf-8')
    expect(mockEnableForAllAgents).toHaveBeenCalledWith('my-skill', 'my-skill')
  })

  it('should skip bundled copy when installed version is newer than local manifest', async () => {
    vi.mocked(fs.access).mockResolvedValueOnce(undefined)
    vi.mocked(fs.readdir).mockResolvedValueOnce([{ name: 'my-skill', isDirectory: () => true }] as any)
    vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
      const targetPath = String(filePath)
      if (targetPath === localManifestPath) {
        return JSON.stringify(localManifest) as any
      }
      if (targetPath === path.join(globalSkillsPath, 'my-skill', '.version')) {
        return '1.1.0' as any
      }
      throw new Error(`Unexpected readFile: ${targetPath}`)
    })

    const { installBuiltinSkills } = await import('../utils/builtinSkills')
    await installBuiltinSkills({ waitForRemoteSync: true })

    expect(fs.cp).not.toHaveBeenCalled()
    expect(mockEnableForAllAgents).toHaveBeenCalledWith('my-skill', 'my-skill')
  })

  it('should install remote builtin skill update when manifest version is newer', async () => {
    vi.mocked(fs.access).mockResolvedValueOnce(undefined)
    vi.mocked(fs.readdir).mockResolvedValueOnce([{ name: 'my-skill', isDirectory: () => true }] as any)
    vi.mocked(fs.mkdir).mockResolvedValue(undefined as any)
    vi.mocked(fs.writeFile).mockResolvedValue(undefined)
    vi.mocked(fs.rm).mockResolvedValue(undefined as any)

    vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
      const targetPath = String(filePath)
      if (targetPath === localManifestPath) {
        return JSON.stringify(localManifest) as any
      }
      if (targetPath === path.join(globalSkillsPath, 'my-skill', '.version')) {
        return '1.0.0' as any
      }
      throw new Error(`Unexpected readFile: ${targetPath}`)
    })

    mockNetFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          updatedAt: '2026-05-13T10:00:00Z',
          skills: {
            'my-skill': {
              version: '1.2.0',
              downloadUrl: 'https://player.install-ai-guider.top/skills/my-skill.zip',
              minAppVersion: '1.0.0'
            }
          }
        })
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
      } as any)

    const { installBuiltinSkills } = await import('../utils/builtinSkills')
    await installBuiltinSkills({ waitForRemoteSync: true })

    expect(mockInstallFromZip).toHaveBeenCalledWith({
      zipFilePath: expect.stringContaining(path.join(globalSkillsPath, '.downloads', 'my-skill-'))
    })
    expect(fs.writeFile).toHaveBeenCalledWith(path.join(globalSkillsPath, 'my-skill', '.version'), '1.2.0', 'utf-8')
    expect(mockEnableForAllAgents).toHaveBeenCalledWith('my-skill', 'my-skill')
  })

  it('should skip entries with path traversal in name', async () => {
    vi.mocked(fs.access).mockResolvedValueOnce(undefined)
    vi.mocked(fs.readdir).mockResolvedValueOnce([
      { name: '..', isDirectory: () => true },
      { name: '../etc', isDirectory: () => true }
    ] as any)
    vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
      const targetPath = String(filePath)
      if (targetPath === localManifestPath) {
        return JSON.stringify(localManifest) as any
      }
      throw new Error('ENOENT')
    })

    const { installBuiltinSkills } = await import('../utils/builtinSkills')
    await installBuiltinSkills({ waitForRemoteSync: true })

    expect(fs.cp).not.toHaveBeenCalled()
  })

  it('should skip non-directory entries', async () => {
    vi.mocked(fs.access).mockResolvedValueOnce(undefined)
    vi.mocked(fs.readdir).mockResolvedValueOnce([{ name: 'README.md', isDirectory: () => false }] as any)
    vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
      const targetPath = String(filePath)
      if (targetPath === localManifestPath) {
        return JSON.stringify(localManifest) as any
      }
      throw new Error('ENOENT')
    })

    const { installBuiltinSkills } = await import('../utils/builtinSkills')
    await installBuiltinSkills({ waitForRemoteSync: true })

    expect(fs.cp).not.toHaveBeenCalled()
    expect(mockEnableForAllAgents).not.toHaveBeenCalled()
  })

  it('should auto-enable existing agents for remotely added builtin skill', async () => {
    vi.mocked(fs.access).mockResolvedValueOnce(undefined)
    vi.mocked(fs.readdir).mockResolvedValueOnce([] as any)
    vi.mocked(fs.mkdir).mockResolvedValue(undefined as any)
    vi.mocked(fs.writeFile).mockResolvedValue(undefined)
    vi.mocked(fs.rm).mockResolvedValue(undefined as any)
    vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
      const targetPath = String(filePath)
      if (targetPath === localManifestPath) {
        return JSON.stringify({ updatedAt: '2026-05-13T00:00:00Z', skills: {} }) as any
      }
      if (targetPath === syncStatePath) {
        throw new Error('ENOENT')
      }
      throw new Error(`Unexpected readFile: ${targetPath}`)
    })

    mockInstallFromZip.mockResolvedValue({
      id: 'new-skill',
      name: 'new-skill',
      description: null,
      folderName: 'new-skill',
      source: 'builtin',
      sourceUrl: null,
      namespace: null,
      author: null,
      tags: [],
      contentHash: '',
      isEnabled: false,
      createdAt: 0,
      updatedAt: 0
    })

    mockNetFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          updatedAt: '2026-05-13T10:00:00Z',
          skills: {
            'new-skill': {
              version: '1.0.0',
              downloadUrl: 'https://player.install-ai-guider.top/skills/new-skill.zip',
              minAppVersion: '1.0.0'
            }
          }
        })
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
      } as any)

    const { installBuiltinSkills } = await import('../utils/builtinSkills')
    await installBuiltinSkills({ waitForRemoteSync: true })

    expect(mockEnableForAllAgents).toHaveBeenCalledWith('new-skill', 'new-skill')
  })

  it('should uninstall remotely deleted builtin skill and persist tombstone', async () => {
    vi.mocked(fs.access).mockResolvedValueOnce(undefined)
    vi.mocked(fs.readdir).mockResolvedValueOnce([{ name: 'my-skill', isDirectory: () => true }] as any)
    vi.mocked(fs.writeFile).mockResolvedValue(undefined)
    vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
      const targetPath = String(filePath)
      if (targetPath === localManifestPath) {
        return JSON.stringify(localManifest) as any
      }
      if (targetPath === syncStatePath) {
        throw new Error('ENOENT')
      }
      throw new Error(`Unexpected readFile: ${targetPath}`)
    })

    mockNetFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        updatedAt: '2026-05-13T10:00:00Z',
        skills: {
          'my-skill': {
            deleted: true,
            tombstoneVersion: '2.0.0'
          }
        }
      })
    } as any)

    const { installBuiltinSkills } = await import('../utils/builtinSkills')
    await installBuiltinSkills({ waitForRemoteSync: true })

    expect(mockUninstallByFolderName).toHaveBeenCalledWith('my-skill')
    expect(fs.writeFile).toHaveBeenCalledWith(
      syncStatePath,
      expect.stringContaining('"deleted": true'),
      'utf-8'
    )
  })
})
