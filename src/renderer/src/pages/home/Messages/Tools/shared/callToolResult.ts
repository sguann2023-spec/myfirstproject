import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import type { MCPCallToolResponse, MCPToolResultContent } from '../../../../../types'

export type ToolResultPreviewImage = {
  source: string
  mimeType: string
  kind: 'base64' | 'url'
}

export type ToolResultPreview = {
  text: string
  images: ToolResultPreviewImage[]
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const safeStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

const normalizeContentItem = (item: unknown): MCPToolResultContent | null => {
  if (!isRecord(item) || typeof item.type !== 'string') {
    return null
  }

  switch (item.type) {
    case 'text':
      return typeof item.text === 'string' ? { type: 'text', text: item.text } : null
    case 'image':
      return typeof item.data === 'string'
        ? {
            type: 'image',
            data: item.data,
            mimeType: typeof item.mimeType === 'string' ? item.mimeType : undefined
          }
        : null
    case 'audio':
      return typeof item.data === 'string'
        ? {
            type: 'audio',
            data: item.data,
            mimeType: typeof item.mimeType === 'string' ? item.mimeType : undefined
          }
        : null
    case 'resource_link':
      return typeof item.uri === 'string'
        ? {
            type: 'resource_link',
            uri: item.uri,
            name: typeof item.name === 'string' ? item.name : undefined,
            title: typeof item.title === 'string' ? item.title : undefined,
            mimeType: typeof item.mimeType === 'string' ? item.mimeType : undefined
          }
        : null
    case 'resource':
      return {
        type: 'resource',
        resource: isRecord(item.resource)
          ? {
              uri: typeof item.resource.uri === 'string' ? item.resource.uri : undefined,
              text: typeof item.resource.text === 'string' ? item.resource.text : undefined,
              mimeType: typeof item.resource.mimeType === 'string' ? item.resource.mimeType : undefined,
              blob: typeof item.resource.blob === 'string' ? item.resource.blob : undefined
            }
          : undefined
      }
    default:
      return null
  }
}

export function normalizeToCallToolResult(output: unknown, options: { isError?: boolean } = {}): MCPCallToolResponse {
  const parsed = CallToolResultSchema.safeParse(output)
  if (parsed.success) {
    return {
      content: parsed.data.content as MCPToolResultContent[],
      structuredContent: parsed.data.structuredContent,
      isError: options.isError ?? parsed.data.isError
    }
  }

  if (Array.isArray(output)) {
    const content = output.map((item) => normalizeContentItem(item)).filter((item): item is MCPToolResultContent => Boolean(item))
    if (content.length > 0) {
      return {
        content,
        isError: options.isError
      }
    }
  }

  if (output === undefined || output === null) {
    return {
      content: [],
      isError: options.isError
    }
  }

  return {
    content: [
      {
        type: 'text',
        text: typeof output === 'string' ? output : safeStringify(output)
      }
    ],
    isError: options.isError
  }
}

export function extractPreviewContentFromToolResult(response: unknown): ToolResultPreview {
  const normalized = normalizeToCallToolResult(response)
  const textParts: string[] = []
  const images: ToolResultPreviewImage[] = []

  for (const content of normalized.content) {
    switch (content.type) {
      case 'text':
        if (content.text) {
          try {
            const parsed = JSON.parse(content.text)
            textParts.push(JSON.stringify(parsed, null, 2))
          } catch {
            textParts.push(content.text)
          }
        }
        break
      case 'image':
        if (content.data) {
          images.push({ source: content.data, mimeType: content.mimeType ?? 'image/png', kind: 'base64' })
        }
        break
      case 'resource_link':
        if (content.uri && (content.mimeType || '').startsWith('image/')) {
          images.push({ source: content.uri, mimeType: content.mimeType ?? 'image/png', kind: 'url' })
        } else if (content.uri) {
          textParts.push(`[Resource Link: ${content.uri}]`)
        }
        break
      case 'resource':
        if (content.resource?.text) {
          textParts.push(content.resource.text)
        } else if (content.resource?.uri) {
          textParts.push(`[Resource: ${content.resource.uri}]`)
        }
        break
      case 'audio':
        textParts.push(`[Audio: ${content.mimeType ?? 'audio/mp3'}]`)
        break
      default:
        break
    }
  }

  return { text: textParts.join('\n\n'), images }
}

export function extractTextPreviewFromToolResult(response: unknown): string {
  return extractPreviewContentFromToolResult(response).text
}
