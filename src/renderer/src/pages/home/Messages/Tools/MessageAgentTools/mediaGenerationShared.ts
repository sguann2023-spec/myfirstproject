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
  const text = extractTextPreviewFromToolResult(output).trim()
  if (!text) return null
  try {
    const parsed = JSON.parse(text)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
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

export function getPrompt(input: Record<string, unknown> | null, output: Record<string, unknown> | null): string | undefined {
  const promptCandidates = [input?.prompt, input?.text, output?.prompt, output?.text_prompt, output?.copywriting]
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
