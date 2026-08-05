import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import type { CollapseProps } from 'antd'

import ImageViewer from '@renderer/components/ImageViewer'
import { SkeletonValue, ToolHeader } from './GenericTools'
import type { TextOutput } from './types'
import { AgentToolsType } from './types'

type InspectImageToolInput = {
  file_path?: string
  path?: string
  url?: string
  question?: string
  prompt?: string
}

type InspectImageToolOutput = string | Array<TextOutput> | { content?: Array<{ type?: string; text?: string }> } | { value?: string }

const extractTextFromChunkRecord = (record: Record<string, unknown>): string => {
  const choices = Array.isArray(record.choices) ? record.choices : []
  const textParts: string[] = []

  for (const choice of choices) {
    if (!choice || typeof choice !== 'object') continue
    const choiceRecord = choice as Record<string, unknown>
    const delta = choiceRecord.delta && typeof choiceRecord.delta === 'object'
      ? (choiceRecord.delta as Record<string, unknown>)
      : null
    const message = choiceRecord.message && typeof choiceRecord.message === 'object'
      ? (choiceRecord.message as Record<string, unknown>)
      : null

    for (const candidate of [delta, message]) {
      if (!candidate) continue
      for (const key of ['content', 'reasoning_content']) {
        const value = candidate[key]
        if (typeof value === 'string' && value.trim()) {
          textParts.push(value)
          continue
        }
        if (Array.isArray(value)) {
          for (const item of value) {
            if (!item || typeof item !== 'object') continue
            const part = item as Record<string, unknown>
            if (part.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
              textParts.push(part.text)
            }
          }
        }
      }
    }
  }

  return textParts.join('').trim()
}

const extractTextFromSseString = (text: string): string => {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('data:'))

  if (lines.length === 0) return text

  const textParts: string[] = []
  for (const line of lines) {
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    try {
      const parsed = JSON.parse(payload) as Record<string, unknown>
      const extracted = extractTextFromChunkRecord(parsed)
      if (extracted) {
        textParts.push(extracted)
      }
    } catch {
      return text
    }
  }

  return textParts.join('').trim() || text
}

const normalizeOutput = (output?: InspectImageToolOutput): string => {
  if (!output) return ''
  if (typeof output === 'string') return extractTextFromSseString(output)
  if (Array.isArray(output)) {
    return output
      .filter((item): item is TextOutput => item.type === 'text' && typeof item.text === 'string')
      .map((item) => item.text)
      .join('\n')
  }
  const callToolResult = CallToolResultSchema.safeParse(output)
  if (callToolResult.success) {
    return callToolResult.data.content
      .filter((item): item is { type: 'text'; text: string } => item.type === 'text' && typeof item.text === 'string')
      .map((item) => item.text)
      .join('\n')
  }
  const valueOutput = output as { value?: unknown }
  if (typeof valueOutput.value === 'string') return valueOutput.value
  return ''
}

const buildPreviewSrc = (source: string): string | undefined => {
  if (!source) return undefined
  if (/^(https?:|data:|file:)/i.test(source)) return source
  if (!source.startsWith('/')) return undefined
  try {
    return new URL(`file://${source}`).toString()
  } catch {
    return `file://${source}`
  }
}

export function InspectImageTool({
  input,
  output
}: {
  input?: InspectImageToolInput
  output?: InspectImageToolOutput
}): NonNullable<CollapseProps['items']>[number] {
  const source = input?.file_path || input?.path || input?.url || ''
  const outputText = normalizeOutput(output)
  const question = input?.question || input?.prompt || ''
  const previewSrc = buildPreviewSrc(source)

  return {
    key: AgentToolsType.InspectImage,
    label: (
      <ToolHeader
        toolName={AgentToolsType.InspectImage}
        params={<SkeletonValue value={source || question || undefined} width="160px" />}
        variant="collapse-label"
        showStatus={false}
      />
    ),
    children: outputText ? (
      <div className="space-y-3">
        {previewSrc && (
          <ImageViewer
            src={previewSrc}
            style={{ maxWidth: 240, maxHeight: 180, borderRadius: 8, padding: 0 }}
            preview
          />
        )}
        <div className="whitespace-pre-wrap break-words text-sm leading-6">{outputText}</div>
      </div>
    ) : (
      <div className="space-y-3">
        {previewSrc && (
          <ImageViewer
            src={previewSrc}
            style={{ maxWidth: 240, maxHeight: 180, borderRadius: 8, padding: 0 }}
            preview
          />
        )}
        <div className="text-sm text-foreground-500">{question || source || 'Inspect image'}</div>
      </div>
    )
  }
}
