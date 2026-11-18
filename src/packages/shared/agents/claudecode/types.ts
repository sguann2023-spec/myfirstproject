import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages'

export interface ContextCompactionEvent {
  type: 'context_compaction'
  operationId: string
  phase: 'start' | 'chunk' | 'complete' | 'error' | 'cancelled'
  chunk?: number
  tokensBefore?: number
  tokensAfter?: number
  summary?: string
  error?: string
}

export type ClaudeCodeRawValue =
  | ContextCompactionEvent
  | {
      type: string
      session_id: string
      slash_commands: string[]
      tools: string[]
      raw: Extract<SDKMessage, { type: 'system' }>
    }
  | {
      type: 'compact_status'
      session_id: string
      status: string
      raw: Extract<SDKMessage, { type: 'system' }>
    }
  | ContentBlockParam
