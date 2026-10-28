export const AGENT_MESSAGE_ROLES = ['user', 'assistant', 'system', 'tool'] as const
export type AgentMessageRole = (typeof AGENT_MESSAGE_ROLES)[number]

export const AGENT_MESSAGE_STATUSES = [
  'pending',
  'streaming',
  'completed',
  'cancelled',
  'failed',
  'interrupted'
] as const
export type AgentMessageStatus = (typeof AGENT_MESSAGE_STATUSES)[number]

export interface AgentMessageSemantics {
  origin?: 'real_user' | 'agent_runtime' | 'system' | 'migration' | 'import' | string
  kind?: string
  source?: string
  uiVisibility?: 'visible' | 'hidden' | 'debug'
  providerVisibility?: 'visible' | 'hidden'
  transcriptVisibility?: 'visible' | 'hidden'
  [key: string]: unknown
}

export interface AgentMessageProviderMetadata {
  providerId?: string
  modelId?: string
  reasoningLevel?: string
  requestId?: string
  [key: string]: unknown
}

export interface AgentMessageUsageMetadata {
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  totalTokens?: number
  [key: string]: unknown
}

export interface AgentMessageErrorMetadata {
  name?: string
  code?: string
  message?: string
  retryable?: boolean
  [key: string]: unknown
}

export interface AgentMessageFinishMetadata {
  reason?: string
  [key: string]: unknown
}

export interface AgentMessage {
  id: string
  sessionId: string
  sequence: number
  turnId?: string
  parentMessageId?: string
  role: AgentMessageRole
  status: AgentMessageStatus
  semantics?: AgentMessageSemantics
  provider?: AgentMessageProviderMetadata
  usage?: AgentMessageUsageMetadata
  error?: AgentMessageErrorMetadata
  finish?: AgentMessageFinishMetadata
  createdAt: string
  completedAt?: string
  updatedAt: string
}

export interface UpsertAgentMessageInput extends Omit<AgentMessage, 'sequence' | 'createdAt' | 'updatedAt'> {
  createdAt?: string
  updatedAt?: string
}

export interface AgentMessagePart<TData extends Record<string, unknown> = Record<string, unknown>> {
  id: string
  sessionId: string
  messageId: string
  sequence: number
  type: string
  data: TData
  createdAt: string
  updatedAt: string
}

export interface UpsertAgentMessagePartInput<TData extends Record<string, unknown> = Record<string, unknown>>
  extends Omit<AgentMessagePart<TData>, 'sequence' | 'createdAt' | 'updatedAt'> {
  createdAt?: string
  updatedAt?: string
}

export interface AgentMessageWithParts {
  message: AgentMessage
  parts: AgentMessagePart[]
}
