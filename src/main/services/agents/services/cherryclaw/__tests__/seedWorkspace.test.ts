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

import { mkdir, writeFile } from 'node:fs/promises'

import { seedWorkspaceTemplates } from '../seedWorkspace'

const mockedMkdir = vi.mocked(mkdir)
const mockedWriteFile = vi.mocked(writeFile)

describe('seedWorkspaceTemplates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedMkdir.mockResolvedValue(undefined)
  })

  it('creates workspace directory only', async () => {
    await seedWorkspaceTemplates('/workspace')

    expect(mockedMkdir).toHaveBeenCalledWith('/workspace', { recursive: true })
    expect(mockedWriteFile).not.toHaveBeenCalled()
  })
})
