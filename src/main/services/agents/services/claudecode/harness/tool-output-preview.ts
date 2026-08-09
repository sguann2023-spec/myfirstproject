type ToolPreviewSection = {
  label: string
  text: string
  startLine?: number
}

type ToolPreviewContext = Record<string, unknown>

type ToolPreviewResult = {
  content: Array<{ type: 'text'; text: string }>
  structuredContent: {
    toolName: string
    mode: 'full' | 'summary' | 'empty'
    context?: ToolPreviewContext
    totalChars: number
    totalLines: number
    sectionStats: Array<{
      label: string
      chars: number
      lines: number
      startLine?: number
    }>
  }
  details?: {
    rawSections: Array<{ label: string; text: string; startLine?: number }>
  }
}

const SUMMARY_TRIGGER_CHARS = 6 * 1024
const SUMMARY_TRIGGER_LINES = 160
const PREVIEW_HEAD_LINES = 40
const PREVIEW_TAIL_LINES = 20
const PREVIEW_MAX_LINE_CHARS = 240

function countLines(text: string): number {
  if (!text) return 0
  return text.split('\n').length
}

function truncateLine(text: string): string {
  if (text.length <= PREVIEW_MAX_LINE_CHARS) return text
  return `${text.slice(0, PREVIEW_MAX_LINE_CHARS - 3)}...`
}

function formatPreviewLine(line: string, lineNumber?: number): string {
  const body = truncateLine(line)
  return typeof lineNumber === 'number' ? `${lineNumber} | ${body}` : body
}

function buildSectionPreview(section: ToolPreviewSection): string {
  const lines = section.text.split('\n')
  if (lines.length === 0) {
    return `[${section.label} 预览]\n(空)`
  }

  const head = lines.slice(0, PREVIEW_HEAD_LINES)
  const tailStart = Math.max(PREVIEW_HEAD_LINES, lines.length - PREVIEW_TAIL_LINES)
  const tail = lines.slice(tailStart)
  const previewLines = head.map((line, index) =>
    formatPreviewLine(line, typeof section.startLine === 'number' ? section.startLine + index : undefined)
  )

  if (tailStart > PREVIEW_HEAD_LINES) {
    previewLines.push(`... 中间省略 ${tailStart - PREVIEW_HEAD_LINES} 行 ...`)
    previewLines.push(
      ...tail.map((line, index) =>
        formatPreviewLine(line, typeof section.startLine === 'number' ? section.startLine + tailStart + index : undefined)
      )
    )
  } else if (lines.length > PREVIEW_HEAD_LINES) {
    previewLines.push(
      ...tail.slice(PREVIEW_HEAD_LINES - tailStart).map((line, index) =>
        formatPreviewLine(line, typeof section.startLine === 'number' ? section.startLine + tailStart + index : undefined)
      )
    )
  }

  return [`[${section.label} 预览]`, ...previewLines].join('\n')
}

function buildSummaryText(input: {
  toolName: string
  context?: ToolPreviewContext
  totalChars: number
  totalLines: number
  sections: ToolPreviewSection[]
}): string {
  const summaryLines = [
    `[${input.toolName} 结果摘要预览]`,
    `- 返回字符: ${input.totalChars}`,
    `- 返回行数: ${input.totalLines}`
  ]

  for (const [key, value] of Object.entries(input.context ?? {})) {
    if (value === undefined || value === null || value === '') continue
    summaryLines.push(`- ${key}: ${String(value)}`)
  }

  summaryLines.push('- 说明: 原始完整结果已保留在 rawOutput；如需中间片段，请缩小读取范围或收窄命令。')

  return [...summaryLines, '', ...input.sections.map((section) => buildSectionPreview(section))].join('\n')
}

function buildFullText(sections: ToolPreviewSection[]): string {
  if (sections.length === 1) {
    return sections[0]?.text ?? ''
  }

  return sections.map((section) => `[${section.label}]\n${section.text}`).join('\n')
}

export function buildToolOutputPreview(args: {
  toolName: string
  sections: ToolPreviewSection[]
  emptyText: string
  context?: ToolPreviewContext
}): ToolPreviewResult {
  const sections = args.sections
    .map((section) => ({
      ...section,
      text: String(section.text || '')
    }))
    .filter((section) => section.text.length > 0)

  const totalChars = sections.reduce((sum, section) => sum + section.text.length, 0)
  const totalLines = sections.reduce((sum, section) => sum + countLines(section.text), 0)
  const sectionStats = sections.map((section) => ({
    label: section.label,
    chars: section.text.length,
    lines: countLines(section.text),
    ...(typeof section.startLine === 'number' ? { startLine: section.startLine } : {})
  }))

  if (sections.length === 0) {
    return {
      content: [{ type: 'text', text: args.emptyText }],
      structuredContent: {
        toolName: args.toolName,
        mode: 'empty',
        context: args.context,
        totalChars: 0,
        totalLines: 0,
        sectionStats: []
      }
    }
  }

  const shouldSummarize =
    totalChars > SUMMARY_TRIGGER_CHARS ||
    totalLines > SUMMARY_TRIGGER_LINES ||
    sections.some((section) => section.text.length > SUMMARY_TRIGGER_CHARS / 2)

  if (!shouldSummarize) {
    return {
      content: [{ type: 'text', text: buildFullText(sections) }],
      structuredContent: {
        toolName: args.toolName,
        mode: 'full',
        context: args.context,
        totalChars,
        totalLines,
        sectionStats
      }
    }
  }

  return {
    content: [
      {
        type: 'text',
        text: buildSummaryText({
          toolName: args.toolName,
          context: args.context,
          totalChars,
          totalLines,
          sections
        })
      }
    ],
    structuredContent: {
      toolName: args.toolName,
      mode: 'summary',
      context: args.context,
      totalChars,
      totalLines,
      sectionStats
    },
    details: {
      rawSections: sections.map((section) => ({
        label: section.label,
        text: section.text,
        ...(typeof section.startLine === 'number' ? { startLine: section.startLine } : {})
      }))
    }
  }
}
