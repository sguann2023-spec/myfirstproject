import fs from 'fs/promises'
import * as nodeFs from 'fs'
import path from 'path'
import { Writable } from 'stream'
import { net } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ net: { fetch: vi.fn() } }))
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return { ...actual, createWriteStream: vi.fn(actual.createWriteStream) }
})
vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
  }
}))

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
    vi.mocked(nodeFs.createWriteStream).mockReset()
    vi.unstubAllGlobals()
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

  it('downloads through Electron instead of Node fetch into the configured workspace root', async () => {
    const workspaceRoot = await createTempDir('download-root-')
    const nodeFetch = vi.fn()
    vi.stubGlobal('fetch', nodeFetch)
    const response = new Response('mp3-data', { headers: { 'content-type': 'audio/mpeg' } })
    const arrayBuffer = vi.spyOn(response, 'arrayBuffer').mockRejectedValue(new Error('Must stream'))
    const mockFetch = vi.spyOn(net, 'fetch').mockResolvedValue(response)

    const result = await handleDownloadTool(
      {
        url: 'https://example.com/audio.mp3',
        path: 'assets/audio/test.mp3'
      },
      workspaceRoot
    )

    const savedPath = path.join(workspaceRoot, 'assets', 'audio', 'test.mp3')
    await expect(fs.readFile(savedPath, 'utf-8')).resolves.toBe('mp3-data')
    expect(result).toEqual({ content: [{ type: 'text', text:
      'Downloaded file: assets/audio/test.mp3\nSize: 8 bytes\nContent-Type: audio/mpeg'
    }] })
    expect(arrayBuffer).not.toHaveBeenCalled()
    expect(mockFetch).toHaveBeenCalledWith('https://example.com/audio.mp3', { redirect: 'follow' })
    expect(nodeFetch).not.toHaveBeenCalled()
  })

  it('reports Electron network failures', async () => {
    const workspaceRoot = await createTempDir('download-network-error-')
    await fs.writeFile(path.join(workspaceRoot, 'existing.mp4'), 'original')
    vi.spyOn(net, 'fetch').mockRejectedValue(new Error('net::ERR_PROXY_CONNECTION_FAILED'))

    await expect(handleDownloadTool({
      url: 'https://example.com/video.mp4',
      file_path: 'video.mp4'
    }, workspaceRoot)).rejects.toThrow('Failed to download file: net::ERR_PROXY_CONNECTION_FAILED')
    await expect(fs.stat(path.join(workspaceRoot, 'video.mp4'))).rejects.toThrow()
    await expect(handleDownloadTool({
      url: 'https://example.com/video.mp4', file_path: 'existing.mp4'
    }, workspaceRoot)).rejects.toThrow('Failed to download file: net::ERR_PROXY_CONNECTION_FAILED')
    await expect(fs.readFile(path.join(workspaceRoot, 'existing.mp4'), 'utf8')).resolves.toBe('original')
    await expect(fs.readdir(workspaceRoot)).resolves.toEqual(['existing.mp4'])
  })

  it('reports HTTP download failures without saving a file', async () => {
    const workspaceRoot = await createTempDir('download-http-error-')
    vi.spyOn(net, 'fetch').mockResolvedValue(new Response(null, { status: 403, statusText: 'Forbidden' }))

    await expect(handleDownloadTool({
      url: 'https://example.com/video.mp4',
      file_path: 'video.mp4'
    }, workspaceRoot)).rejects.toThrow('Failed to download file: HTTP 403 Forbidden')
    await expect(fs.stat(path.join(workspaceRoot, 'video.mp4'))).rejects.toThrow()
  })

  it('writes chunks before EOF and replaces an existing file only after completion', async () => {
    const workspaceRoot = await createTempDir('download-stream-')
    const target = path.join(workspaceRoot, 'video.mp4')
    await fs.writeFile(target, 'original')
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const body = new ReadableStream<Uint8Array>({ start(value) { controller = value } })
    const response = new Response(body, { headers: { 'content-length': '1' } })
    vi.spyOn(response, 'arrayBuffer').mockRejectedValue(new Error('Must stream'))
    vi.spyOn(net, 'fetch').mockResolvedValue(response)
    const chunk = new Uint8Array(128 * 1024).fill(42)
    const pending = handleDownloadTool({ url: 'https://example.com/video.mp4', path: 'video.mp4' }, workspaceRoot)
    // Observe disk progress while the response is still open, not just the final result.
    try {
      controller.enqueue(chunk)
      await vi.waitFor(async () => {
        const tempDir = (await fs.readdir(workspaceRoot)).find((entry) => entry.startsWith('.download-'))
        expect(tempDir).toBeDefined()
        expect((await fs.stat(path.join(workspaceRoot, tempDir!, 'download'))).size).toBe(chunk.length)
      })
      await expect(fs.readFile(target, 'utf8')).resolves.toBe('original')
    } finally {
      controller.enqueue(new Uint8Array([0, 255, 128]))
      controller.close()
      await pending
    }
    const result = await pending
    expect(result.content[0].text).toBe(
      `Downloaded file: video.mp4\nSize: ${chunk.length + 3} bytes\nContent-Type: unknown`
    )
    await expect(fs.readFile(target)).resolves.toEqual(Buffer.concat([chunk, new Uint8Array([0, 255, 128])]))
    await expect(fs.readdir(workspaceRoot)).resolves.toEqual(['video.mp4'])
  })

  it.each([false, true])('cleans partial downloads without damaging the destination (existing: %s)', async (existing) => {
    const workspaceRoot = await createTempDir('download-interrupted-')
    const target = path.join(workspaceRoot, 'video.mp4')
    if (existing) await fs.writeFile(target, 'original')
    let pulls = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulls++ === 0) controller.enqueue(new Uint8Array(128 * 1024))
        else controller.error(new Error('connection interrupted'))
      }
    })
    vi.spyOn(net, 'fetch').mockResolvedValue(new Response(body))

    await expect(handleDownloadTool({ url: 'https://example.com/video.mp4', file_path: 'video.mp4' }, workspaceRoot))
      .rejects.toThrow('Failed to download file: connection interrupted')
    if (existing) await expect(fs.readFile(target, 'utf8')).resolves.toBe('original')
    await expect(fs.readdir(workspaceRoot)).resolves.toEqual(existing ? ['video.mp4'] : [])
  })

  it.each([null, ''])('supports an empty response body (%s)', async (body) => {
    const workspaceRoot = await createTempDir('download-empty-')
    await fs.writeFile(path.join(workspaceRoot, 'empty.bin'), 'original')
    vi.spyOn(net, 'fetch').mockResolvedValue(new Response(body))

    const result = await handleDownloadTool({ url: 'https://example.com/empty', file_path: 'empty.bin' }, workspaceRoot)
    expect(result.content[0].text).toBe('Downloaded file: empty.bin\nSize: 0 bytes\nContent-Type: ' +
      (body === null ? 'unknown' : 'text/plain;charset=UTF-8'))
    await expect(fs.readFile(path.join(workspaceRoot, 'empty.bin'))).resolves.toEqual(Buffer.alloc(0))
    await expect(fs.readdir(workspaceRoot)).resolves.toEqual(['empty.bin'])
  })

  it('preserves existing files and cancels HTTP error bodies', async () => {
    const workspaceRoot = await createTempDir('download-http-existing-')
    const target = path.join(workspaceRoot, 'video.mp4')
    await fs.writeFile(target, 'original')
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({ cancel })
    vi.spyOn(net, 'fetch').mockResolvedValue(new Response(body, { status: 403, statusText: 'Forbidden' }))

    await expect(handleDownloadTool({ url: 'https://example.com/video.mp4', file_path: 'video.mp4' }, workspaceRoot))
      .rejects.toThrow('Failed to download file: HTTP 403 Forbidden')
    expect(cancel).toHaveBeenCalledOnce()
    await expect(fs.readFile(target, 'utf8')).resolves.toBe('original')
    await expect(fs.readdir(workspaceRoot)).resolves.toEqual(['video.mp4'])
  })

  it('cancels the response when temporary file setup fails', async () => {
    const workspaceRoot = await createTempDir('download-setup-error-')
    const cancel = vi.fn()
    vi.spyOn(net, 'fetch').mockResolvedValue(new Response(new ReadableStream({ cancel })))
    vi.spyOn(fs, 'mkdtemp').mockRejectedValue(new Error('EACCES'))

    await expect(handleDownloadTool({ url: 'https://example.com/video.mp4', file_path: 'video.mp4' }, workspaceRoot))
      .rejects.toThrow('Failed to download file: EACCES')
    expect(cancel).toHaveBeenCalledOnce()
    await expect(fs.readdir(workspaceRoot)).resolves.toEqual([])
  })

  it('cancels the source and preserves existing files on disk write failure', async () => {
    const workspaceRoot = await createTempDir('download-write-error-')
    const target = path.join(workspaceRoot, 'video.mp4')
    await fs.writeFile(target, 'original')
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])) },
      cancel
    })
    vi.spyOn(net, 'fetch').mockResolvedValue(new Response(body))
    const destination = new Writable({ write(_chunk, _encoding, callback) { callback(new Error('ENOSPC')) } })
    vi.mocked(nodeFs.createWriteStream).mockReturnValueOnce(destination as nodeFs.WriteStream)

    await expect(handleDownloadTool({ url: 'https://example.com/video.mp4', file_path: 'video.mp4' }, workspaceRoot))
      .rejects.toThrow('Failed to download file: ENOSPC')
    expect(destination.destroyed).toBe(true)
    expect(cancel).toHaveBeenCalledOnce()
    await expect(fs.readFile(target, 'utf8')).resolves.toBe('original')
    await expect(fs.readdir(workspaceRoot)).resolves.toEqual(['video.mp4'])
  })

  it('propagates backpressure to the response and resumes reads when the writer drains', async () => {
    const workspaceRoot = await createTempDir('download-backpressure-')
    let pulls = 0
    const cancel = vi.fn()
    const totalChunks = 1024
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++
        controller.enqueue(new Uint8Array(64 * 1024))
        if (pulls === totalChunks) controller.close()
      },
      cancel
    })
    vi.spyOn(net, 'fetch').mockResolvedValue(new Response(body))
    const callbacks: Array<(error?: Error | null) => void> = []
    const destination = new Writable({
      highWaterMark: 1,
      write(_chunk, _encoding, callback) { callbacks.push(callback) }
    })
    vi.mocked(nodeFs.createWriteStream).mockReturnValueOnce(destination as nodeFs.WriteStream)
    const pending = handleDownloadTool({ url: 'https://example.com/video.mp4', file_path: 'video.mp4' }, workspaceRoot)
    const outcome = expect(pending).rejects.toThrow('Failed to download file: blocked writer failed')

    try {
      await vi.waitFor(() => expect(callbacks).toHaveLength(1))
      // Let all bounded intermediate buffers fill while the first write remains blocked.
      await new Promise((resolve) => setTimeout(resolve, 50))
      const pausedPulls = pulls
      expect(pausedPulls).toBeLessThan(totalChunks)
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(pulls).toBe(pausedPulls)
      callbacks[0]()
      await vi.waitFor(() => {
        expect(callbacks).toHaveLength(2)
        expect(pulls).toBeGreaterThan(pausedPulls)
      })
    } finally {
      destination.destroy(new Error('blocked writer failed'))
      await outcome
    }
    expect(cancel).toHaveBeenCalledOnce()
    expect(destination.destroyed).toBe(true)
    await expect(fs.readdir(workspaceRoot)).resolves.toEqual([])
  })

  it('cancels the response and cleans staging files when write-stream creation throws', async () => {
    const workspaceRoot = await createTempDir('download-write-setup-error-')
    const cancel = vi.fn()
    vi.spyOn(net, 'fetch').mockResolvedValue(new Response(new ReadableStream({ cancel })))
    vi.mocked(nodeFs.createWriteStream).mockImplementationOnce(() => { throw new Error('write setup failed') })

    await expect(handleDownloadTool({ url: 'https://example.com/video.mp4', file_path: 'video.mp4' }, workspaceRoot))
      .rejects.toThrow('Failed to download file: write setup failed')
    expect(cancel).toHaveBeenCalledOnce()
    await expect(fs.readdir(workspaceRoot)).resolves.toEqual([])
  })

  it('preserves existing files and removes staging files when rename fails', async () => {
    const workspaceRoot = await createTempDir('download-rename-error-')
    const target = path.join(workspaceRoot, 'video.mp4')
    await fs.writeFile(target, 'original')
    vi.spyOn(net, 'fetch').mockResolvedValue(new Response('replacement'))
    vi.spyOn(fs, 'rename').mockRejectedValue(new Error('EPERM'))

    await expect(handleDownloadTool({ url: 'https://example.com/video.mp4', file_path: 'video.mp4' }, workspaceRoot))
      .rejects.toThrow('Failed to download file: EPERM')
    await expect(fs.readFile(target, 'utf8')).resolves.toBe('original')
    await expect(fs.readdir(workspaceRoot)).resolves.toEqual(['video.mp4'])
  })

  it('does not replace an existing directory', async () => {
    const workspaceRoot = await createTempDir('download-directory-')
    await fs.mkdir(path.join(workspaceRoot, 'video.mp4'))
    await fs.writeFile(path.join(workspaceRoot, 'video.mp4', 'keep.txt'), 'original')
    vi.spyOn(net, 'fetch').mockResolvedValue(new Response('replacement'))

    await expect(handleDownloadTool({ url: 'https://example.com/video.mp4', file_path: 'video.mp4' }, workspaceRoot))
      .rejects.toThrow('Failed to download file:')
    await expect(fs.readFile(path.join(workspaceRoot, 'video.mp4', 'keep.txt'), 'utf8')).resolves.toBe('original')
    await expect(fs.readdir(workspaceRoot)).resolves.toEqual(['video.mp4'])
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
