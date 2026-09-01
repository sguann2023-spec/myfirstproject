import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import point2IconUrl from '../../../../../../../../public/point2.svg?url'

type BillingRecord = Record<string, unknown>
type GenericRecord = Record<string, unknown>

export type VideoUnderstandeBillingSummary = {
  totalConsumedPoints: number
  displayText: string
}

export type VideoUnderstandeResultFile = {
  kind: string
  filePath: string
  relativePath: string
  videoIndex?: number
  originalInput?: string
}

export type VideoUnderstandeOutputSummary = {
  totalVideoCount: number | null
  defaultFps: number | null
  totalDurationSeconds: number | null
  totalConsumedPoints: number | null
  resultFiles: VideoUnderstandeResultFile[]
  artifactFile: VideoUnderstandeResultFile | null
}

export const VIDEO_UNDERSTANDE_TOOL_NAME = 'mcp__video-understand__submit_video_detail_task'

export function getVideoUnderstandePointIconUrl(): string {
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

  for (let i = 0; i < 3; i += 1) {
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

const extractStringField = (text: string, key: string): string => {
  const pattern = new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`)
  return pattern.exec(text)?.[1]?.trim() || ''
}

const extractNumberField = (text: string, key: string): number | null => {
  const pattern = new RegExp(`"${key}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`)
  return asFiniteNumber(pattern.exec(text)?.[1])
}

function extractTruncatedPayloadFromText(value: unknown): GenericRecord | null {
  const candidates = collectTextCandidates(value)

  for (const candidate of candidates) {
    if (!candidate.includes('total_video_count') && !candidate.includes('result_files') && !candidate.includes('billing')) {
      continue
    }

    const totalVideoCount = extractNumberField(candidate, 'total_video_count')
    const defaultFps = extractNumberField(candidate, 'default_fps')
    const totalConsumedPoints = extractNumberField(candidate, 'total_consumed_points')

    const durationMatches = candidate.match(/"duration_seconds"\s*:\s*(-?\d+(?:\.\d+)?)/g) || []
    const videos = durationMatches
      .map((item) => asFiniteNumber(item.split(':').pop()))
      .filter((duration): duration is number => duration !== null)
      .map((duration) => ({ duration_seconds: duration }))

    const resultFileBlocks = candidate.match(/\{[^{}]*"kind"\s*:\s*"[^"]+"[^{}]*"file_path"\s*:\s*"[^"]+"[^{}]*\}/g) || []
    const resultFiles = resultFileBlocks
      .map((block: string) => {
        const kind = extractStringField(block, 'kind')
        const filePath = extractStringField(block, 'file_path')
        const relativePath = extractStringField(block, 'relative_path')
        if (!kind || !filePath) return null

        const videoIndex = extractNumberField(block, 'video_index')
        const originalInput = extractStringField(block, 'original_input')

        return {
          kind,
          file_path: filePath,
          relative_path: relativePath || filePath,
          ...(videoIndex !== null ? { video_index: videoIndex } : {}),
          ...(originalInput ? { original_input: originalInput } : {})
        }
      })
      .filter(Boolean) as Array<{
      kind: string
      file_path: string
      relative_path: string
      video_index?: number
      original_input?: string
    }>

    const artifactBlockMatch = candidate.match(/"artifact"\s*:\s*\{[^{}]*"file_path"\s*:\s*"[^"]+"[^{}]*\}/)
    const artifactBlock = artifactBlockMatch?.[0] || ''
    const artifactFilePath = extractStringField(artifactBlock, 'file_path')
    const artifactRelativePath = extractStringField(artifactBlock, 'relative_path')

    if (
      totalVideoCount === null &&
      defaultFps === null &&
      totalConsumedPoints === null &&
      resultFiles.length === 0 &&
      !artifactFilePath
    ) {
      continue
    }

    return {
      ...(totalVideoCount !== null ? { total_video_count: totalVideoCount } : {}),
      ...(defaultFps !== null ? { default_fps: defaultFps } : {}),
      ...(totalConsumedPoints !== null ? { billing: { total_consumed_points: totalConsumedPoints } } : {}),
      ...(videos.length > 0 ? { videos } : {}),
      ...(resultFiles.length > 0 ? { result_files: resultFiles } : {}),
      ...(artifactFilePath
        ? {
            artifact: {
              file_path: artifactFilePath,
              relative_path: artifactRelativePath || artifactFilePath
            }
          }
        : {})
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

function extractNestedPayload(value: unknown, depth = 0): GenericRecord | null {
  if (depth > 6) return null

  const record = asRecord(value)
  if (record) {
    if (
      'billing' in record ||
      'result_files' in record ||
      'total_video_count' in record ||
      'default_fps' in record ||
      'artifact' in record
    ) {
      return record
    }

    const nestedResponse = extractNestedPayload(record.response, depth + 1)
    if (nestedResponse) return nestedResponse

    const nestedResponseRaw = extractNestedPayload(record.responseRaw, depth + 1)
    if (nestedResponseRaw) return nestedResponseRaw

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

  if ('total_consumed_points' in record) return record

  const response = asRecord(record.response)
  if (response) {
    const fromResponse = extractBillingRecord(response)
    if (fromResponse) return fromResponse
  }

  const responseRaw = asRecord(record.responseRaw)
  if (responseRaw) {
    const fromResponseRaw = extractBillingRecord(responseRaw)
    if (fromResponseRaw) return fromResponseRaw
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

function extractResultFiles(payload: GenericRecord | null): VideoUnderstandeResultFile[] {
  const files = Array.isArray(payload?.result_files) ? payload.result_files : []

  return files
    .map((item) => {
      const record = asRecord(item)
      if (!record) return null

      const filePath = typeof record.file_path === 'string' ? record.file_path.trim() : ''
      const relativePath = typeof record.relative_path === 'string' ? record.relative_path.trim() : ''
      if (!filePath) return null

      const videoIndex = asFiniteNumber(record.video_index)
      const originalInput = typeof record.original_input === 'string' ? record.original_input.trim() : ''

      return {
        kind: typeof record.kind === 'string' && record.kind.trim() ? record.kind.trim() : 'result_file',
        filePath,
        relativePath: relativePath || filePath,
        ...(videoIndex !== null ? { videoIndex } : {}),
        ...(originalInput ? { originalInput } : {})
      }
    })
    .filter((item): item is VideoUnderstandeResultFile => Boolean(item))
}

function extractTotalDurationSeconds(payload: GenericRecord | null): number | null {
  const topLevelDuration = asFiniteNumber(payload?.total_duration_seconds)
  if (topLevelDuration !== null) return topLevelDuration

  const videos = Array.isArray(payload?.videos) ? payload.videos : []
  const durationValues = videos
    .map((item) => asFiniteNumber(asRecord(item)?.duration_seconds))
    .filter((value): value is number => value !== null)

  if (durationValues.length === 0) return null
  return durationValues.reduce((sum, value) => sum + value, 0)
}

export function isVideoUnderstandeToolName(name: string): boolean {
  return name === VIDEO_UNDERSTANDE_TOOL_NAME
}

export function extractVideoUnderstandeBillingSummary(output: unknown): VideoUnderstandeBillingSummary | null {
  const parsed = extractMcpJson(output)
  const billing = extractBillingRecord(parsed)
  const totalConsumedPoints = asFiniteNumber(billing?.total_consumed_points)
  if (totalConsumedPoints === null) return null

  return {
    totalConsumedPoints,
    displayText: formatConsumedPoints(totalConsumedPoints)
  }
}

export function extractVideoUnderstandeOutputSummary(output: unknown): VideoUnderstandeOutputSummary | null {
  const parsed = extractMcpJson(output)
  if (!parsed) return null

  const artifactRecord = asRecord(parsed.artifact)
  const artifactFilePath = typeof artifactRecord?.file_path === 'string' ? artifactRecord.file_path.trim() : ''
  const artifactRelativePath = typeof artifactRecord?.relative_path === 'string' ? artifactRecord.relative_path.trim() : ''

  return {
    totalVideoCount: asFiniteNumber(parsed.total_video_count),
    defaultFps: asFiniteNumber(parsed.default_fps),
    totalDurationSeconds: extractTotalDurationSeconds(parsed),
    totalConsumedPoints: asFiniteNumber(extractBillingRecord(parsed)?.total_consumed_points),
    resultFiles: extractResultFiles(parsed),
    artifactFile: artifactFilePath
      ? {
          kind: 'artifact',
          filePath: artifactFilePath,
          relativePath: artifactRelativePath || artifactFilePath
        }
      : null
  }
}
