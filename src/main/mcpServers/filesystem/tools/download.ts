import fs from 'fs/promises'
import { createWriteStream } from 'fs'
import path from 'path'
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
    url: parsed.data.url,
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
