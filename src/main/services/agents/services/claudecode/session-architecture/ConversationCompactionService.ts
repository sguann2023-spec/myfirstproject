import type { AgentConversationSegment, AgentTurn, CompactDecision } from './types'

const COMPACTION_INPUT_TOKENS_THRESHOLD = 200_000

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
    const shouldCompact = input.cumulativeInputTokens >= COMPACTION_INPUT_TOKENS_THRESHOLD

    if (shouldCompact) {
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
