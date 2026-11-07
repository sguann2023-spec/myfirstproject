import fs from 'fs/promises'
import { createWriteStream } from 'fs'
import path from 'path'
import { createHash } from 'node:crypto'
import { Readable, Transform } from 'stream'
import { pipeline } from 'stream/promises'
import type { ReadableStream } from 'stream/web'
import { net } from 'electron'
import * as z from 'zod'

import { logger, validatePath } from '../types'

export const DownloadToolSchema = z
  .object({
    url: z.url().describe('The remote URL to download'),
    file_path: z.string().optional().describe('The workspace-relative or absolute path to save the file to'),
    path: z.string().optional().describe('Alias of file_path for compatibility with older prompts')
  })
  .refine((data) => Boolean(String(data.file_path || data.path || '').trim()), {
    message: 'Either file_path or path is required'
  })

export const downloadToolDefinition = {
  name: 'download',
  description: `Downloads a remote file into the local filesystem workspace.

- Use this tool for HTTP or HTTPS file downloads instead of shell commands
- The destination must resolve within the configured workspace root
- Parent directories will be created automatically if they do not exist
- Prefer saving artifacts into the current workspace rather than the user's Downloads folder`,
  inputSchema: z.toJSONSchema(DownloadToolSchema)
}

export async function downloadWithRetry(args: unknown, baseDir: string) {
  let lastError: unknown
  for (let attempt = 0; attempt < 5; attempt++) {
    try { return await handleDownloadTool(args, baseDir) } catch (error) { lastError = error }
    if (attempt < 4) await new Promise(resolve => setTimeout(resolve, 250 * 2 ** attempt))
  }
  throw lastError
}

export async function saveArtifactFile(input: { workspaceRoot?: string; url?: string; filePath?: string; extension?: string }) {
  const root = String(input.workspaceRoot || process.env.WORKSPACE_ROOT || '').trim()
  if (!root || !path.isAbsolute(root)) throw new Error('An absolute workspace root is required to save artifact')
  const artifactDir = await validatePath(path.join(root, 'artifact'), root)
  await fs.mkdir(artifactDir, { recursive: true })
  const realDir = await fs.realpath(artifactDir)
  await validatePath(realDir, root)
  if (input.filePath) {
    const source = await fs.realpath(input.filePath)
    if (!(await fs.stat(source)).isFile()) throw new Error('Artifact must be a regular file')
    const relative = path.relative(realDir, source)
    if (relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) return path.join(artifactDir, relative)
    const hash = createHash('sha256').update(source).digest('hex')
    const target = await validatePath(path.join(realDir, `${hash}${path.extname(source)}`), root)
    const staging = await fs.mkdtemp(path.join(realDir, '.copy-'))
    try {
      await fs.copyFile(source, path.join(staging, 'data'))
      await fs.rename(path.join(staging, 'data'), target)
    } finally { await fs.rm(staging, { recursive: true, force: true }) }
    return path.join(artifactDir, path.basename(target))
  }
  const url = new URL(input.url || '')
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported artifact URL')
  const ext = path.extname(url.pathname).toLowerCase()
  const extension = /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : input.extension || '.bin'
  const hash = createHash('sha256').update(url.href).digest('hex')
  const target = await validatePath(path.join(realDir, `${hash}${extension}`), root)
  try { if ((await fs.stat(target)).isFile()) return path.join(artifactDir, path.basename(target)) } catch {}
  try { await downloadWithRetry({ url: url.href, file_path: target }, root) }
  catch (error) { throw new Error(`Generation succeeded but artifact saving failed: ${error instanceof Error ? error.message : String(error)}`) }
  return path.join(artifactDir, path.basename(target))
}

export async function handleDownloadTool(args: unknown, baseDir: string) {
  const parsed = DownloadToolSchema.safeParse(args)
  if (!parsed.success) {
    throw new Error(`Invalid arguments for download: ${parsed.error}`)
  }

  const requestedPath = String(parsed.data.file_path || parsed.data.path || '').trim()
  const validPath = await validatePath(requestedPath, baseDir)

  const parentDir = path.dirname(validPath)
  await fs.mkdir(parentDir, { recursive: true })

  let response: Response
  try {
    // Use Electron's session proxy settings, including the OS system proxy.
    response = await net.fetch(parsed.data.url, { redirect: 'follow' })
  } catch (error: any) {
    throw new Error(`Failed to download file: ${error?.message || String(error)}`)
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    throw new Error(`Failed to download file: HTTP ${response.status} ${response.statusText}`.trim())
  }

  let tempDir: string | undefined
  let source: Readable | undefined
  let size = 0
  try {
    // Stage on the same filesystem so failed downloads never truncate an existing file.
    tempDir = await fs.mkdtemp(path.join(parentDir, '.download-'))
    const tempPath = path.join(tempDir, 'download')
    source = response.body
      ? Readable.fromWeb(response.body as ReadableStream<Uint8Array>)
      : Readable.from([])
    const counter = new Transform({
      transform(chunk, _encoding, callback) {
        size += chunk.length
        callback(null, chunk)
      }
    })
    await pipeline(source, counter, createWriteStream(tempPath, { flags: 'wx' }))
    await fs.rename(tempPath, validPath)
  } catch (error: any) {
    // A synchronous write-stream setup error occurs before pipeline can destroy the source.
    if (source && !source.destroyed) source.destroy()
    await response.body?.cancel().catch(() => {})
    throw new Error(`Failed to download file: ${error?.message || String(error)}`)
  } finally {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch((error) => {
        logger.warn('Failed to clean up download temporary directory', { path: tempDir, error })
      })
    }
  }

  const relativePath = path.relative(baseDir, validPath)
  const contentType = response.headers.get('content-type') || 'unknown'

  logger.info('File downloaded', {
    path: validPath,
    size,
    contentType
  })

  return {
    content: [
      {
        type: 'text',
        text:
          `Downloaded file: ${relativePath}\n` +
          `Size: ${size} bytes\n` +
          `Content-Type: ${contentType}`
      }
    ]
  }
}
