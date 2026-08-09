import { limitInlineToolText } from '@shared/sessionPayloadLimits'

export const stringifyToolResult = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return ''

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export const summarizeToolResultForArtifact = (value: unknown): string => stringifyToolResult(value)

export const buildInlineToolResultText = (value: unknown, label = '工具回包'): string =>
  limitInlineToolText(stringifyToolResult(value), { label })
