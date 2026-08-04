import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages/messages'

export function extractImageUrlsFromToolOutput(output: unknown): string[] {
  const collected = new Set<string>()
  const imageUrlPattern = /https?:\/\/[^\s"'`]+/g

  const collectUrl = (candidate: unknown, mimeType?: unknown) => {
    const url = String(candidate || '').trim()
    if (!url || !url.startsWith('http')) {
      return
    }

    const normalizedMimeType = String(mimeType || '').trim().toLowerCase()
    if (normalizedMimeType && !normalizedMimeType.startsWith('image/')) {
      return
    }

    collected.add(url)
  }

  const collectUrlsFromText = (text: unknown) => {
    const rawText = String(text || '')
    if (!rawText) {
      return
    }

    for (const match of rawText.matchAll(imageUrlPattern)) {
      collectUrl(match[0], 'image/png')
    }
  }

  if (typeof output === 'string') {
    collectUrlsFromText(output)
    return Array.from(collected)
  }

  if (!output || typeof output !== 'object') {
    return []
  }

  const outputRecord = output as {
    content?: unknown[]
    structuredContent?: Record<string, unknown>
    publicUrl?: string
    url?: string
  }

  collectUrl(outputRecord.publicUrl, 'image/png')
  collectUrl(outputRecord.url, 'image/png')

  const structuredContent = outputRecord.structuredContent
  if (structuredContent && typeof structuredContent === 'object') {
    collectUrl(structuredContent.publicUrl, structuredContent.mimeType)
    collectUrl(structuredContent.url, structuredContent.mimeType)

    const uploadedImageUrls = Array.isArray(structuredContent.uploadedImageUrls)
      ? structuredContent.uploadedImageUrls
      : []
    for (const url of uploadedImageUrls) {
      collectUrl(url, structuredContent.mimeType)
    }

    collectUrlsFromText(structuredContent.text)
    collectUrlsFromText(structuredContent.summary)
  }

  const content = Array.isArray(outputRecord.content) ? outputRecord.content : []
  for (const item of content) {
    if (!item || typeof item !== 'object') {
      continue
    }

    const candidate = item as { type?: string; uri?: string; mimeType?: string; text?: string }
    if (candidate.type === 'resource_link') {
      collectUrl(candidate.uri, candidate.mimeType)
      continue
    }

    if (candidate.type === 'text') {
      collectUrlsFromText(candidate.text)
    }
  }

  return Array.from(collected)
}

export function buildSyntheticToolImageMessage(imageUrls: string[]): SDKUserMessage {
  const content: ContentBlockParam[] = [
    {
      type: 'text',
      text:
        'The previous browser screenshot tool returned uploaded images. Use the attached images as the visual context for the current task and continue answering based on them.'
    }
  ]

  for (const url of imageUrls) {
    content.push({
      type: 'image',
      source: {
        type: 'url',
        url
      }
    })
  }

  return {
    type: 'user',
    session_id: '',
    parent_tool_use_id: null,
    isSynthetic: true,
    message: {
      role: 'user',
      content
    }
  }
}
