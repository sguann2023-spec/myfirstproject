function summarizeImageContentBlock(value: Record<string, unknown>): Record<string, unknown> {
  const data = typeof value.data === 'string' ? value.data : ''
  return {
    ...value,
    data: data
      ? `[image base64 omitted from inline tool log, ${data.length} chars]`
      : undefined,
    inlineImage: true
  }
}

function sanitizeToolResultContentForInline(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeToolResultContentForInline(item))
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  const record = value as Record<string, unknown>
  if (record.type === 'image') {
    return summarizeImageContentBlock(record)
  }

  const next: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(record)) {
    next[key] = sanitizeToolResultContentForInline(entry)
  }
  return next
}

export function buildInlineToolResultPayload(result: unknown): unknown {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return result
  }

  const record = result as Record<string, unknown>
  if (!('content' in record)) {
    return result
  }

  const inlinePayload: Record<string, unknown> = {
    content: sanitizeToolResultContentForInline(record.content)
  }

  if ('structuredContent' in record) {
    inlinePayload.structuredContent = record.structuredContent
  } else if ('details' in record) {
    inlinePayload.structuredContent = record.details
  }
  if ('isError' in record) {
    inlinePayload.isError = record.isError
  }

  return inlinePayload
}
