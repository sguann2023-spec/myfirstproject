import type { PromptView, SegmentPromptEnvelope } from './types'

export interface BuildSegmentPromptInput {
  stableBasePrompt: string
  dynamicContextPrompt: string
  promptView: PromptView
  modelId?: string
  builtinTools?: string[]
  allowedTools?: string[]
}

export interface SegmentPromptService {
  build(input: BuildSegmentPromptInput): Promise<SegmentPromptEnvelope>
}

const buildPromptHash = (value: string): string => {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0
  }
  return `prompt_${hash.toString(16)}`
}

const stableStringify = (value: unknown): string => {
  if (value === undefined) return ''
  if (value === null) return 'null'
  if (typeof value !== 'object') return String(value)
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`
}

export class SegmentPromptServiceImpl implements SegmentPromptService {
  async build(input: BuildSegmentPromptInput): Promise<SegmentPromptEnvelope> {
    const systemPrompt = [input.stableBasePrompt, input.dynamicContextPrompt].filter(Boolean).join('\n\n')
    return {
      systemPrompt,
      promptView: input.promptView,
      systemPromptHash: buildPromptHash(systemPrompt),
      systemPromptVersion: 'v1',
      modelHash: input.modelId ? buildPromptHash(input.modelId) : undefined,
      toolsHash: buildPromptHash(stableStringify([...(input.builtinTools ?? []), ...(input.allowedTools ?? [])])),
      messagesHash: buildPromptHash(stableStringify(input.promptView))
    }
  }
}

export const segmentPromptService = new SegmentPromptServiceImpl()
