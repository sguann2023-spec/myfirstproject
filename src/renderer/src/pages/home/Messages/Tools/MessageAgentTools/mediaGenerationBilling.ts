import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import point2IconUrl from '../../../../../../../../public/point2.svg?url'

import { parseOutput } from './mediaGenerationShared'

type BillingRecord = Record<string, unknown>
type GenericRecord = Record<string, unknown>

export type MediaGenerationBillingSummary = {
  totalConsumedPoints: number
  displayText: string
}

export function getMediaGenerationPointIconUrl(): string {
  return point2IconUrl
}

const asRecord = (value: unknown): GenericRecord | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as GenericRecord) : null

const asFiniteNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

const formatConsumedPoints = (value: number): string =>
  value.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })

const decodeJsonLikeText = (value: string): string => {
  let current = value.trim()
  if (!current) return ''

  for (let index = 0; index < 3; index += 1) {
    try {
      const parsed = JSON.parse(current)
      if (typeof parsed === 'string') {
        current = parsed.trim()
        continue
      }
      if (parsed && typeof parsed === 'object') {
        return JSON.stringify(parsed)
      }
    } catch {
      // ignore and try the lightweight unescape pass below
    }

    const decoded = current
      .replace(/\\\\/g, '\\')
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .trim()

    if (decoded === current) break
    current = decoded
  }

  return current
}

const safeStringify = (value: unknown): string => {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value ?? '')
  }
}

function collectTextCandidates(value: unknown, depth = 0): string[] {
  if (depth > 4 || value === null || value === undefined) return []

  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) return []
    const decoded = decodeJsonLikeText(text)
    return decoded && decoded !== text ? [text, decoded] : [text]
  }

  const record = asRecord(value)
  if (record) {
    const candidates = [safeStringify(record)]

    const content = Array.isArray(record.content) ? record.content : []
    for (const item of content) {
      const itemRecord = asRecord(item)
      if (typeof itemRecord?.text === 'string') {
        candidates.push(...collectTextCandidates(itemRecord.text, depth + 1))
      }
    }

    if ('response' in record) {
      candidates.push(...collectTextCandidates(record.response, depth + 1))
    }
    if ('responseRaw' in record) {
      candidates.push(...collectTextCandidates(record.responseRaw, depth + 1))
    }

    return Array.from(new Set(candidates.filter(Boolean)))
  }

  return [safeStringify(value)]
}

const extractNumberField = (text: string, key: string): number | null => {
  const pattern = new RegExp(`"${key}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`)
  return asFiniteNumber(pattern.exec(text)?.[1])
}

function extractTruncatedPayloadFromText(value: unknown): GenericRecord | null {
  const candidates = collectTextCandidates(value)

  for (const candidate of candidates) {
    if (!candidate.includes('billing') && !candidate.includes('points_consumed') && !candidate.includes('total_consumed_points')) {
      continue
    }

    const consume = extractNumberField(candidate, 'consume')
    const pointsConsumed = extractNumberField(candidate, 'points_consumed')
    const totalConsumedPoints = extractNumberField(candidate, 'total_consumed_points')

    if (consume === null && pointsConsumed === null && totalConsumedPoints === null) {
      continue
    }

    return {
      billing: {
        ...(consume !== null ? { consume } : {}),
        ...(pointsConsumed !== null ? { points_consumed: pointsConsumed } : {}),
        ...(totalConsumedPoints !== null ? { total_consumed_points: totalConsumedPoints } : {})
      }
    }
  }

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

function hasBillingShape(record: GenericRecord): boolean {
  return (
    'billing' in record ||
    'points_consumed' in record ||
    'total_consumed_points' in record ||
    'consume' in record
  )
}

function extractNestedPayload(value: unknown, depth = 0): GenericRecord | null {
  if (depth > 6) return null

  const record = asRecord(value)
  if (record) {
    if (hasBillingShape(record)) {
      return record
    }

    const nestedResponseRaw = extractNestedPayload(record.responseRaw, depth + 1)
    if (nestedResponseRaw) return nestedResponseRaw

    const nestedResponse = extractNestedPayload(record.response, depth + 1)
    if (nestedResponse) return nestedResponse

    const nestedOutput = extractNestedPayload(record.output, depth + 1)
    if (nestedOutput) return nestedOutput

    const nestedResult = extractNestedPayload(record.result, depth + 1)
    if (nestedResult) return nestedResult

    const content = Array.isArray(record.content) ? record.content : []
    for (const item of content) {
      const itemRecord = asRecord(item)
      const text = typeof itemRecord?.text === 'string' ? itemRecord.text.trim() : ''
      if (!text) continue
      try {
        const parsed = JSON.parse(text)
        const nestedPayload = extractNestedPayload(parsed, depth + 1)
        if (nestedPayload) return nestedPayload
      } catch {
        continue
      }
    }
  }

  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) return null
    try {
      const parsed = JSON.parse(text)
      return extractNestedPayload(parsed, depth + 1)
    } catch {
      return null
    }
  }

  return null
}

function extractBillingRecord(payload: unknown): BillingRecord | null {
  const record = asRecord(payload)
  if (!record) return null

  const nestedBilling = asRecord(record.billing)
  if (nestedBilling) return nestedBilling

  if ('total_consumed_points' in record || 'points_consumed' in record || 'consume' in record) {
    return record
  }

  const responseRaw = asRecord(record.responseRaw)
  if (responseRaw) {
    const fromResponseRaw = extractBillingRecord(responseRaw)
    if (fromResponseRaw) return fromResponseRaw
  }

  const response = asRecord(record.response)
  if (response) {
    const fromResponse = extractBillingRecord(response)
    if (fromResponse) return fromResponse
  }

  const output = asRecord(record.output)
  if (output) {
    const fromOutput = extractBillingRecord(output)
    if (fromOutput) return fromOutput
  }

  const result = asRecord(record.result)
  if (result) {
    const fromResult = extractBillingRecord(result)
    if (fromResult) return fromResult
  }

  const content = Array.isArray(record.content) ? record.content : []
  for (const item of content) {
    const itemRecord = asRecord(item)
    const text = typeof itemRecord?.text === 'string' ? itemRecord.text.trim() : ''
    if (!text) continue
    try {
      const parsed = JSON.parse(text)
      const fromText = extractBillingRecord(parsed)
      if (fromText) return fromText
    } catch {
      continue
    }
  }

  return null
}

function extractMcpJson(output: unknown): GenericRecord | null {
  const nestedPayload = extractNestedPayload(output)
  if (nestedPayload) return nestedPayload

  const mcpText = extractMcpText(output)
  if (mcpText) {
    const parsedFromText = extractNestedPayload(mcpText)
    if (parsedFromText) return parsedFromText

    const fallbackFromText = extractTruncatedPayloadFromText(mcpText)
    if (fallbackFromText) return fallbackFromText
  }

  return extractTruncatedPayloadFromText(output)
}

export function extractMediaGenerationBillingSummary(output: unknown): MediaGenerationBillingSummary | null {
  const parsedFromSharedOutput = parseOutput(output)
  const parsed = parsedFromSharedOutput ?? extractMcpJson(output)
  const billing = extractBillingRecord(parsed ?? output)
  const totalConsumedPoints = asFiniteNumber(
    billing?.total_consumed_points ?? billing?.points_consumed ?? billing?.consume
  )

  // #region debug-point D:media-generation-billing-helper
  fetch('http://127.0.0.1:7777/event', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: 'media-billing-missing',
      runId: 'pre-fix',
      hypothesisId: 'D',
      location: 'mediaGenerationBilling.ts:extractMediaGenerationBillingSummary',
      msg: '[DEBUG] media generation billing helper evaluated',
      data: {
        parsedKeys: parsed ? Object.keys(parsed).slice(0, 10) : [],
        billingKeys: billing ? Object.keys(billing).slice(0, 10) : [],
        totalConsumedPoints,
        parsedPreview: (() => {
          try {
            return JSON.stringify(parsed).slice(0, 320)
          } catch {
            return String(parsed).slice(0, 320)
          }
        })(),
        billingPreview: (() => {
          try {
            return JSON.stringify(billing).slice(0, 320)
          } catch {
            return String(billing).slice(0, 320)
          }
        })(),
        outputPreview: (() => {
          try {
            return JSON.stringify(output).slice(0, 320)
          } catch {
            return String(output).slice(0, 320)
          }
        })()
      },
      ts: Date.now()
    })
  }).catch(() => {})
  // #endregion

  if (totalConsumedPoints === null) return null

  return {
    totalConsumedPoints,
    displayText: formatConsumedPoints(totalConsumedPoints)
  }
}
