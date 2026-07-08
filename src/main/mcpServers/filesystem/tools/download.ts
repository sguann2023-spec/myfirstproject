import fs from 'fs/promises'
import path from 'path'
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
    response = await fetch(parsed.data.url, { redirect: 'follow' })
  } catch (error: any) {
    throw new Error(`Failed to download file: ${error?.message || String(error)}`)
  }

  if (!response.ok) {
    throw new Error(`Failed to download file: HTTP ${response.status} ${response.statusText}`.trim())
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  await fs.writeFile(validPath, buffer)

  const relativePath = path.relative(baseDir, validPath)
  const contentType = response.headers.get('content-type') || 'unknown'

  logger.info('File downloaded', {
    url: parsed.data.url,
    path: validPath,
    size: buffer.length,
    contentType
  })

  return {
    content: [
      {
        type: 'text',
        text:
          `Downloaded file: ${relativePath}\n` +
          `Size: ${buffer.length} bytes\n` +
          `Content-Type: ${contentType}`
      }
    ]
  }
}
