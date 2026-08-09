import { AgentToolsType, type EditToolInput, type MultiEditToolInput, type WriteToolInput } from './types'

type ChangeStats = {
  added: number
  removed?: number
  approximate?: boolean
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function toComparableLines(text: string): string[] {
  if (!text) return []

  const normalized = text.replace(/\r\n/g, '\n')
  if (!normalized) return []

  const withoutTrailingEof = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized
  if (!withoutTrailingEof) return ['']

  return withoutTrailingEof.split('\n')
}

function countLines(text: string): number {
  return toComparableLines(text).length
}

function summarizeReplacement(oldText: string, newText: string): ChangeStats {
  const oldLines = toComparableLines(oldText)
  const newLines = toComparableLines(newText)

  let prefix = 0
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) {
    prefix += 1
  }

  let oldSuffixIndex = oldLines.length - 1
  let newSuffixIndex = newLines.length - 1
  while (
    oldSuffixIndex >= prefix
    && newSuffixIndex >= prefix
    && oldLines[oldSuffixIndex] === newLines[newSuffixIndex]
  ) {
    oldSuffixIndex -= 1
    newSuffixIndex -= 1
  }

  return {
    added: Math.max(0, newSuffixIndex - prefix + 1),
    removed: Math.max(0, oldSuffixIndex - prefix + 1)
  }
}

function summarizeWriteInput(input: unknown): ChangeStats | null {
  if (!isRecord(input)) return null

  const content = typeof input.content === 'string' ? input.content : ''
  const added = countLines(content)
  if (added <= 0) return null

  return {
    added,
    approximate: true
  }
}

function summarizeEditInput(input: unknown): ChangeStats | null {
  if (!isRecord(input)) return null

  const oldString = typeof input.old_string === 'string' ? input.old_string : ''
  const newString = typeof input.new_string === 'string' ? input.new_string : ''
  const stats = summarizeReplacement(oldString, newString)

  if (stats.added <= 0 && (stats.removed ?? 0) <= 0) return null
  return stats
}

function summarizeMultiEditInput(input: unknown): ChangeStats | null {
  if (!isRecord(input) || !Array.isArray(input.edits)) return null

  const total = input.edits.reduce<ChangeStats>(
    (acc, edit) => {
      if (!isRecord(edit)) return acc

      const oldString = typeof edit.old_string === 'string' ? edit.old_string : ''
      const newString = typeof edit.new_string === 'string' ? edit.new_string : ''
      const stats = summarizeReplacement(oldString, newString)

      acc.added += stats.added
      acc.removed = (acc.removed ?? 0) + (stats.removed ?? 0)
      return acc
    },
    { added: 0, removed: 0 }
  )

  if (total.added <= 0 && (total.removed ?? 0) <= 0) return null
  return total
}

export function getToolChangeStats(
  toolName: string,
  input: WriteToolInput | EditToolInput | MultiEditToolInput | Record<string, unknown> | undefined
): ChangeStats | null {
  switch (toolName) {
    case AgentToolsType.Write:
      return summarizeWriteInput(input)
    case AgentToolsType.Edit:
      return summarizeEditInput(input)
    case AgentToolsType.MultiEdit:
      return summarizeMultiEditInput(input)
    default:
      return null
  }
}

export function renderToolChangeStats(
  toolName: string,
  input: WriteToolInput | EditToolInput | MultiEditToolInput | Record<string, unknown> | undefined
): string | null {
  const stats = getToolChangeStats(toolName, input)
  if (!stats) return null

  const parts: string[] = []
  if (stats.added > 0) {
    parts.push(`+ ${stats.added} 行`)
  }
  if ((stats.removed ?? 0) > 0) {
    parts.push(`- ${stats.removed} 行`)
  }

  if (parts.length === 0) return null

  const rendered = parts.join('  ')
  return stats.approximate ? `约 ${rendered}` : rendered
}
