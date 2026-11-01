import { createHash } from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'

import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { ImageContent } from '@earendil-works/pi-ai'

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
  'image/svg+xml': 'svg', 'image/avif': 'avif'
}

function isReadImageTool(name: string): boolean {
  return ['ReadImageAsContent', 'builtin_ReadImageAsContent', 'Read', 'builtin_Read'].includes(name)
}

function unpackImageContent(value: unknown, depth = 0): Array<{ type: 'text'; text: string } | ImageContent> | undefined {
  if (depth > 3) return undefined
  if (typeof value === 'string') {
    if (!/^[\s]*[\[{"]/.test(value)) return undefined
    try { return unpackImageContent(JSON.parse(value), depth + 1) } catch { return undefined }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return unpackImageContent((value as { content?: unknown }).content, depth + 1)
  }
  if (!Array.isArray(value)) return undefined
  const content: Array<{ type: 'text'; text: string } | ImageContent> = []
  let hasImage = false
  for (const item of value) {
    if (item?.type === 'text' && typeof item.text === 'string') {
      content.push({ type: 'text', text: item.text })
    } else if (item?.type === 'image' && typeof item.data === 'string'
      && typeof item.mimeType === 'string' && IMAGE_EXTENSIONS[item.mimeType]
      && item.data.length > 0 && item.data.length % 4 === 0
      && /^[A-Za-z0-9+/]*={0,2}$/.test(item.data)) {
      content.push({ type: 'image', data: item.data, mimeType: item.mimeType })
      hasImage = true
    } else {
      // Do not reinterpret arbitrary tool JSON or UI image-omission placeholders.
      return undefined
    }
  }
  return hasImage ? content : undefined
}

function normalizeHistoricalImageResult(message: AgentMessage): AgentMessage {
  if (message.role !== 'toolResult' || !isReadImageTool(message.toolName) || message.isError) return message
  if (message.content.some(part => part.type === 'image')) return message
  let changed = false
  const content = message.content.flatMap(part => {
    if (part.type !== 'text') return [part]
    const unpacked = unpackImageContent(part.text)
    if (!unpacked) return [part]
    changed = true
    return unpacked
  })
  return changed ? { ...message, content } : message
}

async function saveImageReference(image: ImageContent, workspacePath: string): Promise<string> {
  const hash = createHash('sha256').update(image.data).digest('hex')
  const directory = path.resolve(workspacePath, '.tool-results')
  const filePath = path.join(directory, `image-${hash}.${IMAGE_EXTENSIONS[image.mimeType] ?? 'img'}`)
  await fsp.mkdir(directory, { recursive: true })
  try {
    // Keep the original bytes; this is offloading, not image compression.
    await fsp.writeFile(filePath, Buffer.from(image.data, 'base64'), { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  return filePath
}

export function createReadImageContextProjector(
  workspacePath: string,
  onSummary?: (summary: Record<string, number>) => void,
  options: { beginNewTurn?: boolean } = {}
) {
  const cached = new WeakMap<object, Promise<AgentMessage>>()
  const normalized = new WeakMap<object, AgentMessage>()
  const historicalImageCalls = new Set<string>()
  let firstRequest = true
  return async (messages: AgentMessage[]): Promise<AgentMessage[]> => {
    const restored = messages.map(message => {
      let result = normalized.get(message)
      if (!result) {
        result = normalizeHistoricalImageResult(message)
        normalized.set(message, result)
      }
      return result
    })
    const projected = [...restored]
    if (firstRequest && options.beginNewTurn) {
      // This projector is created per invocation. Calls already present before
      // its first model request belong to old turns, not this turn's retries.
      for (const message of restored) {
        if (message.role === 'toolResult' && isReadImageTool(message.toolName)) {
          historicalImageCalls.add(message.toolCallId)
        }
      }
    }
    firstRequest = false
    const retiredCalls = new Map<string, string>()
    let seenSuccessfulResponse = false
    for (let index = restored.length - 1; index >= 0; index--) {
      const message = restored[index]
      if (message.role === 'assistant' && ['stop', 'toolUse', 'length'].includes(message.stopReason)) {
        seenSuccessfulResponse = true
      }
      if (message.role !== 'toolResult'
        || (!seenSuccessfulResponse && !historicalImageCalls.has(message.toolCallId))
        || !isReadImageTool(message.toolName) || message.isError
        || !message.content.some(part => part.type === 'image')) continue
      let pending = cached.get(message)
      if (!pending) {
        pending = (async (): Promise<AgentMessage> => {
          const references: string[] = []
          const content = []
          for (const part of message.content) {
            if (part.type !== 'image') {
              content.push(part)
              continue
            }
            const filePath = await saveImageReference(part, workspacePath)
            references.push(filePath)
            content.push({
              type: 'text' as const,
              text: `Previously loaded image: ${JSON.stringify(filePath)}. Raw image omitted from this later response or conversation turn. Use ReadImageAsContent with this file_path if visual inspection is needed again.`
            })
          }
          const details = message.details as { mimeType?: unknown; byteLength?: unknown } | undefined
          return { ...message, content, details: {
            source: references[0], imageReferences: references,
            mimeType: details?.mimeType, byteLength: details?.byteLength
          } }
        })()
        cached.set(message, pending)
      }
      try {
        const result = await pending
        projected[index] = result
        retiredCalls.set(message.toolCallId, ((result as typeof message).details as { source: string }).source)
      } catch (error) {
        cached.delete(message)
        throw error
      }
    }
    // A data URL may also be present in the assistant's original tool arguments.
    const output = projected.map(message => {
      if (message.role !== 'assistant') return message
      let changed = false
      const content = message.content.map(part => {
        if (part.type !== 'toolCall' || !isReadImageTool(part.name)) return part
        const reference = retiredCalls.get(part.id)
        if (!reference) return part
        const args = { ...part.arguments }
        let argsChanged = false
        for (const key of ['file_path', 'path', 'url', 'data_url']) {
          if (typeof args[key] === 'string' && /^data:/i.test(args[key])) {
            args[key] = reference
            argsChanged = true
          }
        }
        if (!argsChanged) return part
        changed = true
        return { ...part, arguments: args }
      })
      return changed ? { ...message, content } : message
    })
    if (onSummary) {
      let remainingReadImageBase64Bytes = 0
      let remainingOtherImageBase64Bytes = 0
      let remainingImageLikeTextBytes = 0
      for (const message of output) {
        if (!('content' in message)) continue
        const parts = typeof message.content === 'string' ? [{ type: 'text' as const, text: message.content }] : message.content
        if (!Array.isArray(parts)) continue
        for (const part of parts) {
          if (part.type === 'image') {
            const bytes = Buffer.byteLength(part.data, 'utf8')
            if (message.role === 'toolResult' && isReadImageTool(message.toolName)) remainingReadImageBase64Bytes += bytes
            else remainingOtherImageBase64Bytes += bytes
          } else if (part.type === 'text' && part.text.length > 16 * 1024
            && /base64|"(?:image_base64|data_url|image_url)"|"type"\s*:\s*"image"/i.test(part.text)) {
            remainingImageLikeTextBytes += Buffer.byteLength(part.text, 'utf8')
          }
        }
      }
      onSummary({
        restoredImageResults: restored.filter((message, index) => message !== messages[index]).length,
        retiredImageResults: retiredCalls.size,
        retiredHistoricalImageResults: [...retiredCalls.keys()].filter(id => historicalImageCalls.has(id)).length,
        remainingReadImageBase64Bytes,
        remainingOtherImageBase64Bytes,
        remainingImageLikeTextBytes
      })
    }
    return output
  }
}
