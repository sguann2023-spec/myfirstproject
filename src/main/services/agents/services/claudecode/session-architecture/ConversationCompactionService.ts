import type { AgentConversationSegment, AgentTurn, CompactDecision } from './types'

export interface EvaluateCompactionInput {
  segment: AgentConversationSegment
  completedTurn: AgentTurn
  cumulativeInputTokens: number
}

export interface ConversationCompactionService {
  evaluate(input: EvaluateCompactionInput): Promise<CompactDecision>
}

export class ConversationCompactionServiceImpl implements ConversationCompactionService {
  async evaluate(input: EvaluateCompactionInput): Promise<CompactDecision> {
    if (input.cumulativeInputTokens >= 100_000) {
      return {
        shouldCompact: true,
        reason: 'input_tokens_threshold',
        cumulativeInputTokens: input.cumulativeInputTokens
      }
    }

    return {
      shouldCompact: false,
      cumulativeInputTokens: input.cumulativeInputTokens
    }
  }
}

export const conversationCompactionService = new ConversationCompactionServiceImpl()
