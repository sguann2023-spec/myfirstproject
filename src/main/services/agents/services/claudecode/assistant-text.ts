import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'

const stripLocalCommandTags = (text: string): string => {
  return text.replace(/<local-command-(stdout|stderr)>(.*?)<\/local-command-\1>/gs, '$2').replace('(no content)', '')
}

const stripCommandTags = (text: string): string => {
  return stripLocalCommandTags(text).replace(/<command-[^>]+>.*?<\/command-[^>]+>/gs, '')
}

export const normalizeAssistantTranscriptText = (text: string): string => {
  return stripCommandTags(String(text || '')).replace(/\r\n/g, '\n').trim()
}

export const extractAssistantTextFromSdkMessage = (message: SDKMessage): string => {
  if (message.type !== 'assistant') {
    return ''
  }

  const content = message.message.content
  if (typeof content === 'string') {
    return normalizeAssistantTranscriptText(content)
  }

  if (!Array.isArray(content)) {
    return ''
  }

  return normalizeAssistantTranscriptText(
    content
      .filter((block) => block.type === 'text' && typeof (block as { text?: unknown }).text === 'string')
      .map((block) => String((block as { text?: string }).text || ''))
      .join('')
  )
}

export const buildPersistedAssistantText = (input: { snapshotTexts: string[]; streamedText: string }): string => {
  const dedupedSnapshots = Array.from(
    new Map(
      input.snapshotTexts
        .map((text) => normalizeAssistantTranscriptText(text))
        .filter(Boolean)
        .map((text) => [text, text] as const)
    ).values()
  )

  if (dedupedSnapshots.length > 0) {
    return dedupedSnapshots.join('\n\n')
  }

  return normalizeAssistantTranscriptText(input.streamedText)
}
