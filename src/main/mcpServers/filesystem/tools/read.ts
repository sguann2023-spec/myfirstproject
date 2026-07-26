import fs from 'fs/promises'
import path from 'path'
import * as z from 'zod'
import { MAX_INLINE_PAYLOAD_BYTES, formatByteSize, limitInlineText } from '@shared/sessionPayloadLimits'

import { DEFAULT_READ_LIMIT, isBinaryFile, MAX_LINE_LENGTH, validatePath } from '../types'

const MAX_READ_OUTPUT_BYTES = 5 * 1024
const LARGE_FILE_HEAD_SAMPLE_BYTES = 2 * 1024
const LARGE_FILE_TAIL_SAMPLE_BYTES = 2 * 1024
const LARGE_FILE_PREVIEW_LINES = 12

// Schema definition
export const ReadToolSchema = z.object({
  file_path: z.string().describe('The path to the file to read'),
  offset: z.number().optional().describe('The line number to start reading from (1-based)'),
  limit: z.number().optional().describe('The number of lines to read (defaults to 2000)')
})

// Tool definition with detailed description
export const readToolDefinition = {
  name: 'read',
  description: `Reads a file from the local filesystem.

- Only files within the configured workspace root can be read
- The file_path parameter must resolve within the configured workspace root
- By default, reads up to 2000 lines starting from the beginning
- You can optionally specify a line offset and limit for long files
- Any lines longer than 2000 characters will be truncated
- Results are returned with line numbers starting at 1
- Files above the hard inline limit return a concise summary instead of full content
- Final inline output is capped at 5 KB
- Binary files are detected and rejected with an error
- Empty files return a warning`,
  inputSchema: z.toJSONSchema(ReadToolSchema)
}

function normalizePreviewLines(sample: string, options: { fromTail?: boolean; dropFirstPartialLine?: boolean } = {}): string[] {
  const normalized = sample.replace(/\r\n/g, '\n')
  let lines = normalized.split('\n')

  if (options.dropFirstPartialLine && lines.length > 0) {
    lines = lines.slice(1)
  }
  if (lines[lines.length - 1] === '') {
    lines = lines.slice(0, -1)
  }

  const selected = options.fromTail ? lines.slice(-LARGE_FILE_PREVIEW_LINES) : lines.slice(0, LARGE_FILE_PREVIEW_LINES)
  return selected.map((line) => (line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH)}...` : line))
}

async function buildLargeFileSummary(validPath: string, relativePath: string, fileSize: number): Promise<string> {
  const fileHandle = await fs.open(validPath, 'r')

  try {
    const headBytes = Math.min(fileSize, LARGE_FILE_HEAD_SAMPLE_BYTES)
    const headBuffer = Buffer.alloc(headBytes)
    if (headBytes > 0) {
      await fileHandle.read(headBuffer, 0, headBytes, 0)
    }

    const tailBytes = fileSize > headBytes ? Math.min(fileSize, LARGE_FILE_TAIL_SAMPLE_BYTES) : 0
    const tailStart = Math.max(0, fileSize - tailBytes)
    const tailBuffer = Buffer.alloc(tailBytes)
    if (tailBytes > 0) {
      await fileHandle.read(tailBuffer, 0, tailBytes, tailStart)
    }

    const headLines = normalizePreviewLines(headBuffer.toString('utf8'))
    const tailLines = tailBytes > 0
      ? normalizePreviewLines(tailBuffer.toString('utf8'), { fromTail: true, dropFirstPartialLine: tailStart > 0 })
      : []

    const sections = [
      `File: ${relativePath}`,
      `Size: ${formatByteSize(fileSize)}`,
      '',
      `Large file summary only. Full inline read was skipped because this file exceeds the ${formatByteSize(MAX_INLINE_PAYLOAD_BYTES)} hard limit.`
    ]

    if (headLines.length > 0) {
      sections.push('', 'Start preview:')
      sections.push(...headLines.map((line) => `  ${line}`))
    }

    if (tailLines.length > 0) {
      sections.push('', 'End preview:')
      sections.push(...tailLines.map((line) => `  ${line}`))
    }

    return limitInlineText(sections.join('\n'), {
      label: '大文件摘要',
      maxBytes: MAX_READ_OUTPUT_BYTES
    })
  } finally {
    await fileHandle.close()
  }
}

// Handler implementation
export async function handleReadTool(args: unknown, baseDir: string) {
  const parsed = ReadToolSchema.safeParse(args)
  if (!parsed.success) {
    throw new Error(`Invalid arguments for read: ${parsed.error}`)
  }

  const filePath = parsed.data.file_path
  const validPath = await validatePath(filePath, baseDir)

  // Check if file exists
  let fileSize = 0
  try {
    const stats = await fs.stat(validPath)
    if (!stats.isFile()) {
      throw new Error(`Path is not a file: ${filePath}`)
    }
    fileSize = Number(stats.size) || 0
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw new Error(`File not found: ${filePath}`)
    }
    throw error
  }

  // Check if file is binary
  if (await isBinaryFile(validPath)) {
    throw new Error(`Cannot read binary file: ${filePath}`)
  }

  if (fileSize > MAX_INLINE_PAYLOAD_BYTES) {
    const relativePath = path.relative(baseDir, validPath)
    return {
      content: [
        {
          type: 'text',
          text: await buildLargeFileSummary(validPath, relativePath, fileSize)
        }
      ]
    }
  }

  // Read file content
  const content = await fs.readFile(validPath, 'utf-8')
  const lines = content.split('\n')

  // Apply offset and limit
  const offset = (parsed.data.offset || 1) - 1 // Convert to 0-based
  const limit = parsed.data.limit || DEFAULT_READ_LIMIT

  if (offset < 0 || offset >= lines.length) {
    throw new Error(`Invalid offset: ${offset + 1}. File has ${lines.length} lines.`)
  }

  const selectedLines = lines.slice(offset, offset + limit)

  // Format output with line numbers and truncate long lines
  const output: string[] = []
  const relativePath = path.relative(baseDir, validPath)

  output.push(`File: ${relativePath}`)
  if (offset > 0 || limit < lines.length) {
    output.push(`Lines ${offset + 1} to ${Math.min(offset + limit, lines.length)} of ${lines.length}`)
  }
  output.push('')

  selectedLines.forEach((line, index) => {
    const lineNumber = offset + index + 1
    const truncatedLine = line.length > MAX_LINE_LENGTH ? line.substring(0, MAX_LINE_LENGTH) + '...' : line
    output.push(`${lineNumber.toString().padStart(6)}\t${truncatedLine}`)
  })

  if (offset + limit < lines.length) {
    output.push('')
    output.push(`(${lines.length - (offset + limit)} more lines not shown)`)
  }

  return {
    content: [
      {
        type: 'text',
        text: limitInlineText(output.join('\n'), {
          label: '读取结果',
          maxBytes: MAX_READ_OUTPUT_BYTES
        })
      }
    ]
  }
}
