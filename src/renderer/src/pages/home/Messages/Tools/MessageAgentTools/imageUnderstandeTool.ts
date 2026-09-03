import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import point2IconUrl from '../../../../../../../../public/point2.svg?url'

type BillingRecord = Record<string, unknown>

export type ImageUnderstandeBillingSummary = {
  totalConsumedPoints: number
  displayText: string
}

export const IMAGE_UNDERSTANDE_TOOL_NAME = 'mcp__image-understand__inspect_image'

export function getImageUnderstandePointIconUrl(): string {
  return point2IconUrl
}

const asRecord = (value: unknown): BillingRecord | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as BillingRecord) : null

const asFiniteNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

const formatConsumedPoints = (value: number): string =>
  `${value.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`

function extractBillingRecord(payload: unknown): BillingRecord | null {
  const record = asRecord(payload)
  if (!record) return null

  const nestedBilling = asRecord(record.billing)
  if (nestedBilling) return nestedBilling

  if ('total_consumed_points' in record) return record
  return null
}

function extractMcpText(output: unknown): string | null {
  const result = CallToolResultSchema.safeParse(output)
  if (!result.success) return null

  const textParts: string[] = []
  for (const item of result.data.content) {
    if (item.type === 'text' && item.text) {
      textParts.push(item.text)
    }
  }
  return textParts.length > 0 ? textParts.join('\n\n') : null
}

export function isImageUnderstandeToolName(name: string): boolean {
  return name === IMAGE_UNDERSTANDE_TOOL_NAME
}

export function extractImageUnderstandeBillingSummary(output: unknown): ImageUnderstandeBillingSummary | null {
  const mcpText = extractMcpText(output)
  if (!mcpText) return null

  try {
    const parsed = JSON.parse(mcpText)
    const billing = extractBillingRecord(parsed)
    const totalConsumedPoints = asFiniteNumber(billing?.total_consumed_points)
    if (totalConsumedPoints === null) return null

    return {
      totalConsumedPoints,
      displayText: formatConsumedPoints(totalConsumedPoints)
    }
  } catch {
    return null
  }
}
