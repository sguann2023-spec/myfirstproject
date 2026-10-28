import { createHash, randomUUID } from 'node:crypto'

import type { AgentInvocationIds } from '../interfaces/AgentStreamInterface'

export const allocateAgentInvocationIds = (): AgentInvocationIds => ({
  turnId: `turn_${randomUUID()}`,
  traceId: `trace_${randomUUID()}`,
  userMessageId: `msg_${randomUUID()}`,
  assistantMessageId: `msg_${randomUUID()}`
})

export const agentInvocationIdsFromIdempotencyKey = (scope: string, key: string): AgentInvocationIds => {
  const digest = createHash('sha256').update(`${scope}\u0000${key}`).digest('hex').slice(0, 32)
  return {
    turnId: `turn_${digest}`,
    traceId: `trace_${digest}`,
    userMessageId: `msg_${digest}_user`,
    assistantMessageId: `msg_${digest}_assistant`
  }
}
