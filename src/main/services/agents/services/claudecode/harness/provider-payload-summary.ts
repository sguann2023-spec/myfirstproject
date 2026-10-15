import { createHash } from 'node:crypto'

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

function measure(value: unknown) {
  const text = value === undefined ? '' : JSON.stringify(value)
  return {
    chars: text.length,
    bytes: Buffer.byteLength(text, 'utf8'),
    hash: createHash('sha256').update(text).digest('hex').slice(0, 16)
  }
}

// Describe the wire payload without logging message text, schemas, images, or credentials.
export function summarizeProviderPayload(payload: unknown) {
  const record = asRecord(payload)
  const messages = Array.isArray(record.messages) ? record.messages : []
  const tools = Array.isArray(record.tools) ? record.tools : []
  const messageSummaries = messages.map((message, index) => {
    const item = asRecord(message)
    return {
      index,
      role: item.role,
      content: measure(item.content),
      toolCalls: measure(item.tool_calls),
      serialized: measure(message)
    }
  })
  const toolSummaries = tools.map((tool) => {
    const item = asRecord(tool)
    const definition = item.function ? asRecord(item.function) : item
    return {
      name: definition.name,
      description: measure(definition.description),
      schema: measure(definition.parameters ?? definition.input_schema),
      serialized: measure(tool)
    }
  })
  return {
    payload: measure(payload),
    system: measure(record.system),
    messageCount: messages.length,
    messages: messageSummaries,
    messagesSerialized: measure(record.messages),
    toolCount: tools.length,
    tools: toolSummaries,
    toolsSerialized: measure(record.tools),
    tokenEstimateNote: 'Lengths are not tokenizer counts; multimodal and provider-added context require upstream usage.'
  }
}
