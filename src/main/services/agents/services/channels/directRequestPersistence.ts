import type { AgentMessagePersistExchangePayload } from '@types'

import { SqlitePiSessionStorage } from '../../database/repositories/piSessionStorage'
import { agentMessageRepository } from '../../database/sessionMessageRepository'

export async function persistDirectRequestExchange(
  input: AgentMessagePersistExchangePayload & { turnId: string }
) {
  const { turnId, user, assistant, ...exchange } = input
  if (!user?.payload?.message?.id || !assistant?.payload?.message?.id) {
    throw new Error('Direct request requires a complete user/assistant exchange')
  }
  const userMessageId = user.payload.message.id
  const assistantMessageId = assistant.payload.message.id
  const userPayload = { ...user.payload, message: { ...user.payload.message, turnId } }
  const assistantPayload = {
    ...assistant.payload, message: { ...assistant.payload.message, turnId, askId: userMessageId }
  }
  const persisted = await agentMessageRepository.persistExchange({
    ...exchange,
    user: {
      ...user,
      payload: userPayload,
      metadata: { ...user.metadata, semantics: { ...(user.metadata?.semantics as object), origin: 'direct_request' } }
    },
    assistant: {
      ...assistant,
      payload: assistantPayload,
      metadata: { ...assistant.metadata, semantics: { ...(assistant.metadata?.semantics as object), origin: 'direct_request' } }
    }
  })
  await SqlitePiSessionStorage.appendCanonicalExchange({
    topicId: exchange.sessionId, userMessageId, assistantMessageId
  })
  return persisted
}
