export function buildInlineToolResultPayload(result: unknown): unknown {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return result
  }

  const record = result as Record<string, unknown>
  if (!('content' in record)) {
    return result
  }

  const inlinePayload: Record<string, unknown> = {
    content: record.content
  }

  if ('structuredContent' in record) {
    inlinePayload.structuredContent = record.structuredContent
  }
  if ('isError' in record) {
    inlinePayload.isError = record.isError
  }

  return inlinePayload
}
