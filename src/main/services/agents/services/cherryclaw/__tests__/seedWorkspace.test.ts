import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() })
  }
}))

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
  stat: vi.fn(),
  writeFile: vi.fn()
}))

import { mkdir, stat, writeFile } from 'node:fs/promises'

import { seedWorkspaceTemplates } from '../seedWorkspace'

const mockedMkdir = vi.mocked(mkdir)
const mockedStat = vi.mocked(stat)
const mockedWriteFile = vi.mocked(writeFile)

describe('seedWorkspaceTemplates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedMkdir.mockResolvedValue(undefined)
    mockedWriteFile.mockResolvedValue(undefined)
  })

  it('creates directories and seeds templates when files do not exist', async () => {
    mockedStat.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

    await seedWorkspaceTemplates('/workspace')

    expect(mockedMkdir).toHaveBeenCalledWith('/workspace', { recursive: true })
    expect(mockedMkdir).toHaveBeenCalledWith('/workspace/images', { recursive: true })
    expect(mockedMkdir).toHaveBeenCalledWith('/workspace/assets', { recursive: true })
    expect(mockedMkdir).toHaveBeenCalledWith('/workspace/assets/css', { recursive: true })
    expect(mockedMkdir).toHaveBeenCalledWith('/workspace/assets/js', { recursive: true })

    expect(mockedWriteFile).toHaveBeenCalledTimes(3)
    const writeCalls = mockedWriteFile.mock.calls.map((c) => c[0])
    expect(writeCalls).toContain('/workspace/index.html')
    expect(writeCalls).toContain('/workspace/assets/css/main.css')
    expect(writeCalls).toContain('/workspace/assets/js/main.js')

    // Verify template content
    const htmlCall = mockedWriteFile.mock.calls.find((c) => c[0] === '/workspace/index.html')
    expect(htmlCall![1]).toContain('<!DOCTYPE html>')
    expect(htmlCall![1]).toContain('欢迎来到你的新工作空间')
  })

  it('skips writing files that already exist (idempotent)', async () => {
    mockedStat.mockResolvedValue({ mtimeMs: 1000 } as any)

    await seedWorkspaceTemplates('/workspace')

    expect(mockedWriteFile).not.toHaveBeenCalled()
  })

  it('writes only missing files', async () => {
    mockedStat.mockImplementation(async (filePath) => {
      const p = typeof filePath === 'string' ? filePath : filePath.toString()
      if (p.includes('index.html') || p.includes('main.css')) {
        return { mtimeMs: 1000 } as any
      }
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })

    await seedWorkspaceTemplates('/workspace')

    expect(mockedWriteFile).toHaveBeenCalledTimes(1)
    expect(mockedWriteFile.mock.calls[0][0]).toBe('/workspace/assets/js/main.js')
  })
})
