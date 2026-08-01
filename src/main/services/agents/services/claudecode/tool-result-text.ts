type TextLikeBlock = {
  type?: unknown
  text?: unknown
  content?: unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const collectTextParts = (value: unknown, bucket: string[]): void => {
  if (typeof value === 'string') {
    if (value) {
      bucket.push(value)
    }
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectTextParts(item, bucket)
    }
    return
  }

  if (!isRecord(value)) {
    return
  }

  const block = value as TextLikeBlock
  if (block.type === 'text' && typeof block.text === 'string' && block.text) {
    bucket.push(block.text)
    return
  }

  if (Array.isArray(block.content)) {
    collectTextParts(block.content, bucket)
  }
}

export const summarizeToolResultForArtifact = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return ''

  const textParts: string[] = []
  collectTextParts(value, textParts)
  if (textParts.length > 0) {
    return textParts.join('\n').trim()
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
