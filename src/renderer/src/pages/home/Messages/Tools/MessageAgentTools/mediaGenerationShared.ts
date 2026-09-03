import { parse as parsePartialJson } from 'partial-json'

import { extractTextPreviewFromToolResult } from '../shared/callToolResult'

export type MediaGenerationToolProps = {
  toolName?: string
  input?: unknown
  output?: unknown
  progress?: number
  progressMessage?: string
  isRunning?: boolean
}

export type MediaGenerationVariant = 'audio' | 'image' | 'video' | 'digitalHuman'

const AUDIO_TOOL_NAMES = new Set([
  'generate_speech',
  'mcp__speech__generate_speech',
  'generate_seed_audio',
  'mcp__seed-audio__generate_seed_audio'
])

const IMAGE_TOOL_NAMES = new Set([
  'generate_or_edit_image',
  'mcp__image__generate_or_edit_image',
  'generate_image',
  'mcp__image__generate_image'
])

const VIDEO_TOOL_NAMES = new Set(['generate_video', 'mcp__video__generate_video'])

const DIGITAL_HUMAN_TOOL_NAMES = new Set([
  'create_lip_sync_digital_human',
  'mcp__digital-human__create_lip_sync_digital_human',
  'create_image_driven_digital_human',
  'mcp__digital-human__create_image_driven_digital_human',
  'create_omni_image_driven_digital_human',
  'mcp__digital-human__create_omni_image_driven_digital_human',
  'create_seedance_digital_human',
  'mcp__digital-human__create_seedance_digital_human'
])

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function extractNestedOutputPayload(value: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 6) return null

  if (isRecord(value)) {
    if (
      'status' in value ||
      'success' in value ||
      'output' in value ||
      'result' in value ||
      'image_url' in value ||
      'video_url' in value ||
      'audio_url' in value
    ) {
      return value
    }

    const nestedResponseRaw = extractNestedOutputPayload(value.responseRaw, depth + 1)
    if (nestedResponseRaw) return nestedResponseRaw

    const nestedResponse = extractNestedOutputPayload(value.response, depth + 1)
    if (nestedResponse) return nestedResponse

    const nestedOutput = extractNestedOutputPayload(value.output, depth + 1)
    if (nestedOutput) return nestedOutput

    const nestedResult = extractNestedOutputPayload(value.result, depth + 1)
    if (nestedResult) return nestedResult

    const content = Array.isArray(value.content) ? value.content : []
    for (const item of content) {
      if (!isRecord(item) || typeof item.text !== 'string' || !item.text.trim()) continue
      try {
        const parsed = JSON.parse(item.text)
        const nestedPayload = extractNestedOutputPayload(parsed, depth + 1)
        if (nestedPayload) return nestedPayload
      } catch {
        continue
      }
    }
  }

  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      return extractNestedOutputPayload(parsed, depth + 1)
    } catch {
      return null
    }
  }

  return null
}

export function parseInput(input: unknown): Record<string, unknown> | null {
  if (isRecord(input)) return input
  if (typeof input !== 'string' || !input.trim()) return null
  try {
    const parsed = parsePartialJson(input)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function parseOutput(output: unknown): Record<string, unknown> | null {
  const directPayload = extractNestedOutputPayload(output)
  if (directPayload) return directPayload

  const text = extractTextPreviewFromToolResult(output).trim()
  if (!text) return null
  return extractNestedOutputPayload(text)
}

export function buildPreviewSrc(source?: string): string | undefined {
  if (!source) return undefined
  if (/^(https?:|data:|file:)/i.test(source)) return source
  if (!source.startsWith('/')) return undefined
  try {
    return new URL(`file://${source}`).toString()
  } catch {
    return `file://${source}`
  }
}

export function getMediaGenerationVariant(toolName?: string): MediaGenerationVariant | null {
  if (!toolName) return null
  if (AUDIO_TOOL_NAMES.has(toolName)) return 'audio'
  if (IMAGE_TOOL_NAMES.has(toolName)) return 'image'
  if (VIDEO_TOOL_NAMES.has(toolName)) return 'video'
  if (DIGITAL_HUMAN_TOOL_NAMES.has(toolName)) return 'digitalHuman'
  return null
}

export function isMediaGenerationToolName(toolName?: string): boolean {
  return getMediaGenerationVariant(toolName) !== null
}

export function getDraftUrl(output: Record<string, unknown> | null): string | undefined {
  const nestedOutput = output && isRecord(output.output) ? output.output : null
  const candidate = nestedOutput?.draft_url ?? output?.draft_url
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined
}

function getPromptFromContent(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined

  for (const item of value) {
    if (!isRecord(item)) continue

    if (typeof item.text === 'string' && item.text.trim()) {
      return item.text.trim()
    }

    if (isRecord(item.input_text) && typeof item.input_text.text === 'string' && item.input_text.text.trim()) {
      return item.input_text.text.trim()
    }
  }

  return undefined
}

export function getPrompt(input: Record<string, unknown> | null, output: Record<string, unknown> | null): string | undefined {
  const nestedOutput = output && isRecord(output.output) ? output.output : null
  const request = output && isRecord(output.request) ? output.request : null
  const promptCandidates = [
    input?.prompt,
    input?.text,
    getPromptFromContent(input?.content),
    getPromptFromContent(request?.content),
    output?.prompt,
    output?.text_prompt,
    output?.copywriting,
    nestedOutput?.prompt,
    nestedOutput?.text_prompt,
    nestedOutput?.copywriting,
    getPromptFromContent(output?.content),
    getPromptFromContent(nestedOutput?.content)
  ]
  for (const candidate of promptCandidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }
  return undefined
}

export function getTaskMessage(output: Record<string, unknown> | null, progressMessage?: string, outputText?: string): string {
  if (typeof progressMessage === 'string' && progressMessage.trim()) {
    return progressMessage.trim()
  }
  if (typeof output?.message === 'string' && output.message.trim()) {
    return output.message.trim()
  }
  return String(outputText || '').trim()
}

export function getNormalizedStatus(output: Record<string, unknown> | null): string {
  return String(output?.status || '').trim().toLowerCase()
}

export function isFailedStatus(normalizedStatus: string): boolean {
  return ['failed', 'error', 'not_found', 'cancelled'].includes(normalizedStatus)
}

export function isCompletedStatus(output: Record<string, unknown> | null, normalizedStatus: string, mediaUrl?: string): boolean {
  return Boolean(mediaUrl) || output?.success === true || ['success', 'succeeded', 'completed'].includes(normalizedStatus)
}

export function getImageUrl(output: Record<string, unknown> | null): string | undefined {
  if (!output) return undefined
  const nestedOutput = isRecord(output.output) ? output.output : null
  const nestedResult = isRecord(output.result) ? output.result : null
  const candidates = [nestedOutput?.image_url, nestedResult?.image, output.image_url]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return undefined
}

export function getAudioUrl(output: Record<string, unknown> | null): string | undefined {
  if (!output) return undefined
  const nestedOutput = isRecord(output.output) ? output.output : null
  const candidates = [nestedOutput?.audio_url, output.url, output.audio_url]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return undefined
}

export function getVideoUrl(output: Record<string, unknown> | null): string | undefined {
  if (!output) return undefined
  const nestedOutput = isRecord(output.output) ? output.output : null
  const nestedResult = isRecord(output.result) ? output.result : null
  const candidates = [nestedOutput?.video_url, output.video_url, nestedResult?.video_url]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return undefined
}

export function getDigitalHumanVideoUrl(output: Record<string, unknown> | null): string | undefined {
  if (!output) return undefined
  const nestedOutput = isRecord(output.output) ? output.output : null
  const candidates = [nestedOutput?.video_url, output.video_url, output.digital_human_url]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return undefined
}
