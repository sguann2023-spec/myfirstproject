import fs from 'fs/promises'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveFilesystemBaseDir } from '../config'
import { handleDownloadTool } from '../tools/download'
import { handleGlobTool } from '../tools/glob'
import { handleLsTool } from '../tools/ls'
import { handleReadTool } from '../tools/read'
import * as types from '../types'
import { validatePath } from '../types'

describe('filesystem MCP security', () => {
  const tempDirs: string[] = []

  async function createTempDir(prefix: string) {
    const tempRoot = path.join(process.cwd(), '.context', 'vitest-temp')
    await fs.mkdir(tempRoot, { recursive: true })
    const tempDir = await fs.mkdtemp(path.join(tempRoot, prefix))
    tempDirs.push(tempDir)
    return tempDir
  }

  afterEach(async () => {
    vi.restoreAllMocks()
    await Promise.all(tempDirs.splice(0).map((tempDir) => fs.rm(tempDir, { recursive: true, force: true })))
  })

  it('prefers WORKSPACE_ROOT and falls back to args for filesystem root', () => {
    expect(resolveFilesystemBaseDir(['C:/args-root'], {})).toBe('C:/args-root')
    expect(resolveFilesystemBaseDir(['C:/args-root'], { WORKSPACE_ROOT: 'C:/env-root' })).toBe('C:/env-root')
    expect(resolveFilesystemBaseDir([], {})).toBeUndefined()
  })

  it('allows paths inside the configured root and rejects paths outside it', async () => {
    const workspaceRoot = await createTempDir('filesystem-root-')
    const outsideRoot = await createTempDir('filesystem-outside-')
    const insideFile = path.join(workspaceRoot, 'inside.txt')
    const outsideFile = path.join(outsideRoot, 'outside.txt')

    await fs.writeFile(insideFile, 'inside')
    await fs.writeFile(outsideFile, 'outside')

    await expect(validatePath(insideFile, workspaceRoot)).resolves.toBe(insideFile)
    await expect(validatePath(outsideFile, workspaceRoot)).rejects.toThrow('outside the configured workspace root')
  })

  it('rejects symlink escapes outside the configured root', async () => {
    const workspaceRoot = await createTempDir('filesystem-symlink-root-')
    const outsideRoot = await createTempDir('filesystem-symlink-outside-')
    const outsideFile = path.join(outsideRoot, 'secret.txt')
    const symlinkPath = path.join(workspaceRoot, 'escape-link')

    await fs.writeFile(outsideFile, 'top-secret')
    await fs.symlink(outsideFile, symlinkPath)

    await expect(validatePath(symlinkPath, workspaceRoot)).rejects.toThrow('outside the configured workspace root')
  })

  it('rejects relative path traversal outside the configured root', async () => {
    const workspaceRoot = await createTempDir('filesystem-relative-root-')
    const outsideFile = path.join(path.dirname(workspaceRoot), 'outside.txt')

    await fs.writeFile(outsideFile, 'outside')

    await expect(validatePath('../outside.txt', workspaceRoot)).rejects.toThrow('outside the configured workspace root')
  })

  it('rejects home expansion outside the configured root', async () => {
    const workspaceRoot = await createTempDir('filesystem-home-root-')

    await expect(validatePath('~/sensitive-file', workspaceRoot)).rejects.toThrow(
      'outside the configured workspace root'
    )
  })

  it('falls back to process.cwd() when baseDir is omitted', async () => {
    const workspaceRoot = await createTempDir('filesystem-cwd-root-')
    const allowedFile = path.join(workspaceRoot, 'allowed.txt')
    const outsideFile = path.join(path.dirname(workspaceRoot), 'outside.txt')

    await fs.writeFile(allowedFile, 'allowed')
    await fs.writeFile(outsideFile, 'outside')

    vi.spyOn(process, 'cwd').mockReturnValue(workspaceRoot)

    await expect(validatePath('allowed.txt')).resolves.toBe(allowedFile)
    await expect(validatePath('../outside.txt')).rejects.toThrow('outside the configured workspace root')
  })

  it('glob excludes files reached via symlinked directories outside root', async () => {
    const workspaceRoot = await createTempDir('glob-symlink-root-')
    const outsideRoot = await createTempDir('glob-symlink-outside-')

    // Create a file inside the workspace and one outside
    const legitFile = path.join(workspaceRoot, 'legit.txt')
    const secretFile = path.join(outsideRoot, 'secret.txt')
    await fs.writeFile(legitFile, 'legit')
    await fs.writeFile(secretFile, 'secret')

    // Create a symlink inside workspace pointing to the outside directory
    await fs.symlink(outsideRoot, path.join(workspaceRoot, 'escape-dir'))

    // Mock ripgrep to return both files (simulating --follow traversing the symlink)
    vi.spyOn(types, 'runRipgrep').mockResolvedValue({
      ok: true,
      stdout: [legitFile, secretFile].join('\n'),
      exitCode: 0
    })

    const result = await handleGlobTool({ pattern: '*.txt' }, workspaceRoot)
    const text = result.content[0].text

    expect(text).toContain('legit.txt')
    expect(text).not.toContain('secret.txt')
  })

  it('ls excludes symlinked directories outside root in recursive mode', async () => {
    const workspaceRoot = await createTempDir('ls-symlink-root-')
    const outsideRoot = await createTempDir('ls-symlink-outside-')

    await fs.writeFile(path.join(workspaceRoot, 'legit.txt'), 'legit')
    await fs.mkdir(path.join(outsideRoot, 'private'))
    await fs.writeFile(path.join(outsideRoot, 'private', 'secret.txt'), 'secret')

    // Create a symlink inside workspace pointing to the outside directory
    await fs.symlink(outsideRoot, path.join(workspaceRoot, 'escape-dir'))

    const result = await handleLsTool({ recursive: true }, workspaceRoot)
    const text = result.content[0].text

    expect(text).toContain('legit.txt')
    // The symlink entry itself may appear, but its children should not be listed
    expect(text).not.toContain('secret.txt')
  })

  it('downloads remote files into the configured workspace root', async () => {
    const workspaceRoot = await createTempDir('download-root-')
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'audio/mpeg' }),
      arrayBuffer: async () => new TextEncoder().encode('mp3-data').buffer
    })
    vi.stubGlobal('fetch', mockFetch)

    const result = await handleDownloadTool(
      {
        url: 'https://example.com/audio.mp3',
        path: 'assets/audio/test.mp3'
      },
      workspaceRoot
    )

    const savedPath = path.join(workspaceRoot, 'assets', 'audio', 'test.mp3')
    await expect(fs.readFile(savedPath, 'utf-8')).resolves.toBe('mp3-data')
    expect(result.content[0].text).toContain('assets/audio/test.mp3')
    expect(result.content[0].text).toContain('audio/mpeg')
  })

  it('truncates read output to the 5 KB inline limit', async () => {
    const workspaceRoot = await createTempDir('read-output-limit-root-')
    const largeFile = path.join(workspaceRoot, 'large.log')
    await fs.writeFile(largeFile, Array.from({ length: 400 }, (_, index) => `line-${index + 1} ${'x'.repeat(40)}`).join('\n'))

    const result = await handleReadTool({ file_path: largeFile }, workspaceRoot)
    const text = result.content[0].text

    expect(text).toContain('读取结果 已截断')
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(5 * 1024)
  })

  it('returns a summary instead of offset guidance for files above the hard inline limit', async () => {
    const workspaceRoot = await createTempDir('read-summary-root-')
    const largeFile = path.join(workspaceRoot, 'huge.log')
    const oversizedContent = ['start-line', 'A'.repeat(2 * 1024 * 1024 + 256), 'end-line'].join('\n')
    await fs.writeFile(largeFile, oversizedContent)

    const result = await handleReadTool({ file_path: largeFile }, workspaceRoot)
    const text = result.content[0].text

    expect(text).toContain('Large file summary only')
    expect(text).toContain('Start preview:')
    expect(text).toContain('End preview:')
    expect(text).toContain('start-line')
    expect(text).toContain('end-line')
    expect(text).not.toContain('offset and limit')
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(5 * 1024)
  })

  it('rejects download destinations outside the configured workspace root', async () => {
    const workspaceRoot = await createTempDir('download-reject-root-')

    await expect(
      handleDownloadTool(
        {
          url: 'https://example.com/audio.mp3',
          path: '../outside.mp3'
        },
        workspaceRoot
      )
    ).rejects.toThrow('outside the configured workspace root')
  })
})
