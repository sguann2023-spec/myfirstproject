import type { AgentPersistedMessage } from '@types'

import type {
  AgentMessageStatus,
  AgentMessageWithParts,
  UpsertAgentMessageInput,
  UpsertAgentMessagePartInput
} from './repositories/agentTranscript.types'

const record = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {}

// Canonical records and legacy dual-writes use different token field names.
const persistedUsage = (value: unknown): Record<string, any> => {
  const usage = record(value)
  const normalized = { ...usage }
  for (const [legacy, canonical] of [
    ['prompt_tokens', 'inputTokens'],
    ['completion_tokens', 'outputTokens'],
    ['total_tokens', 'totalTokens'],
    ['cache_read_input_tokens', 'cacheReadTokens'],
    ['cache_creation_input_tokens', 'cacheWriteTokens']
  ]) {
    if (normalized[legacy] == null && usage[canonical] != null) normalized[legacy] = usage[canonical]
  }
  return normalized
}

// An absent legacy error must not become a truthy `{}` in error_json.
// Also normalize empty records already persisted by older dual-writes.
const optionalError = (value: unknown): Record<string, any> | undefined => {
  const error = record(value)
  return Object.keys(error).length > 0 ? error : undefined
}

const messageStatus = (status: AgentMessageStatus, role: string): string => {
  if (role === 'user') return 'success'
  if (status === 'completed') return 'success'
  if (status === 'streaming') return 'processing'
  if (status === 'cancelled') return 'paused'
  if (status === 'failed' || status === 'interrupted') return 'error'
  return 'pending'
}

const blockStatus = (status: AgentMessageStatus, data: Record<string, any>): string => {
  const current = String(data.status ?? '').toLowerCase()
  if (current === 'completed' || current === 'success') return 'success'
  if (current === 'failed' || current === 'error' || current === 'interrupted') return 'error'
  if (current === 'cancelled' || current === 'canceled' || current === 'paused') return 'paused'
  if (current === 'pending') return 'pending'
  if (current === 'running' || current === 'processing' || current === 'streaming') return 'streaming'
  if (status === 'completed') return 'success'
  if (status === 'cancelled') return 'paused'
  if (status === 'failed' || status === 'interrupted') return 'error'
  return status === 'streaming' ? 'streaming' : 'pending'
}

const legacyBlockType = (type: string): string => {
  if (type === 'text') return 'main_text'
  if (type === 'reasoning') return 'thinking'
  return type
}

export function canonicalEntryToPersisted(entry: AgentMessageWithParts): AgentPersistedMessage {
  const { message } = entry
  const status = messageStatus(message.status, message.role)
  const messageError = optionalError(message.error)
  const blocks: Record<string, any>[] = entry.parts.map((part) => {
    const data = record(part.data)
    const type = legacyBlockType(part.type)
    const content = typeof data.text === 'string' && data.content === undefined ? data.text : data.content
    const error = optionalError(data.error) ?? (message.status === 'interrupted'
      ? { message: 'Generation was interrupted before completion', code: 'interrupted' }
      : messageError)
    return {
      ...data,
      id: part.id,
      messageId: message.id,
      type,
      createdAt: part.createdAt,
      updatedAt: part.updatedAt,
      status: blockStatus(message.status, data),
      ...(content !== undefined ? { content } : {}),
      ...(type === 'thinking' && data.thinking_millsec === undefined ? { thinking_millsec: 0 } : {}),
      error
    }
  })

  if (blocks.length === 0 && (message.status === 'failed' || message.status === 'interrupted')) {
    blocks.push({
      id: `${message.id}:error`, messageId: message.id, type: 'error', createdAt: message.createdAt,
      updatedAt: message.updatedAt, status: 'error',
      error: messageError ?? {
        message: message.status === 'interrupted' ? 'Generation was interrupted before completion' : 'Generation failed',
        code: message.status
      }
    })
  }

  return {
    message: {
      id: message.id,
      role: message.role === 'tool' ? 'assistant' : message.role,
      assistantId: '',
      topicId: `agent-session:${message.sessionId}`,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
      status,
      blocks: blocks.map((block) => block.id),
      ...(message.provider?.modelId ? { modelId: message.provider.modelId } : {}),
      ...(message.provider?.requestId ? { traceId: message.provider.requestId } : {}),
      ...(message.usage ? { usage: persistedUsage(message.usage) } : {}),
      ...(messageError ? { error: messageError } : {}),
      ...(message.status === 'cancelled' ? { aborted: true } : {}),
      canonicalStatus: message.status,
      sequence: message.sequence,
      ...(message.turnId ? { turnId: message.turnId } : {}),
      ...(message.parentMessageId ? { askId: message.parentMessageId } : {})
    },
    blocks
  } as unknown as AgentPersistedMessage
}

export function persistedToCanonicalInputs(
  sessionId: string,
  persisted: AgentPersistedMessage,
  metadata?: Record<string, unknown>
): { message: UpsertAgentMessageInput; parts: UpsertAgentMessagePartInput[] } | null {
  const legacyMessage = record(persisted?.message)
  const id = String(legacyMessage.id ?? '').trim()
  const roleValue = legacyMessage.role === 'agent' ? 'assistant' : legacyMessage.role
  if (!id || !['user', 'assistant', 'system', 'tool'].includes(String(roleValue))) return null
  const rawStatus = String(legacyMessage.canonicalStatus ?? legacyMessage.status ?? '').toLowerCase()
  const status: AgentMessageStatus = legacyMessage.aborted === true || ['cancelled', 'canceled', 'paused'].includes(rawStatus)
    ? 'cancelled'
    : ['failed', 'error'].includes(rawStatus)
      ? 'failed'
      : rawStatus === 'interrupted'
        ? 'interrupted'
        : ['streaming', 'processing', 'searching'].includes(rawStatus)
          ? 'streaming'
          : rawStatus === 'pending' ? 'pending' : 'completed'
  const createdAt = String(legacyMessage.createdAt ?? new Date().toISOString())
  const updatedAt = String(legacyMessage.updatedAt ?? createdAt)
  const semantics = record(metadata?.semantics)

  return {
    message: {
      id,
      sessionId,
      turnId: String(legacyMessage.turnId ?? metadata?.turnId ?? '').trim() || undefined,
      parentMessageId: String(legacyMessage.askId ?? metadata?.parentMessageId ?? '').trim() || undefined,
      role: roleValue as UpsertAgentMessageInput['role'],
      status,
      semantics: {
        origin: String(semantics.origin ?? 'legacy_dual_write'),
        uiVisibility: semantics.uiVisibility ?? 'visible',
        providerVisibility: semantics.providerVisibility ?? 'visible',
        ...semantics
      },
      provider: {
        ...(legacyMessage.modelId ? { modelId: legacyMessage.modelId } : {}),
        ...(legacyMessage.traceId ? { requestId: legacyMessage.traceId } : {})
      },
      usage: record(legacyMessage.usage),
      error: optionalError(legacyMessage.error),
      createdAt,
      updatedAt,
      completedAt: ['completed', 'cancelled', 'failed', 'interrupted'].includes(status) ? updatedAt : undefined
    },
    parts: (Array.isArray(persisted.blocks) ? persisted.blocks : []).map((rawBlock, index) => {
      const block = record(rawBlock)
      const data = { ...block }
      delete data.id
      delete data.messageId
      delete data.type
      delete data.createdAt
      delete data.updatedAt
      if (typeof data.content === 'string' && data.text === undefined) data.text = data.content
      return {
        id: String(block.id ?? `${id}:part:${index}`), sessionId, messageId: id,
        type: block.type === 'main_text' ? 'text' : block.type === 'thinking' ? 'reasoning' : String(block.type || 'legacy'),
        data,
        createdAt: String(block.createdAt ?? createdAt),
        updatedAt: String(block.updatedAt ?? updatedAt)
      }
    })
  }
}
