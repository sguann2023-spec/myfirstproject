import { type Model, type Usage } from '@renderer/types'
import type { LanguageModelUsage } from 'ai'

/** Token usage from streaming (OpenAI format) or non-streaming (AI SDK format) */
type TokenUsage = Usage | LanguageModelUsage

interface TokenUsageParams {
  usage: TokenUsage | undefined
  model: Model | undefined
  source?: 'chat' | 'agent'
}

/**
 * Type guard to check if usage is in AI SDK format (LanguageModelUsage)
 * AI SDK format uses inputTokens/outputTokens, OpenAI format uses prompt_tokens/completion_tokens
 */
function isAiSdkUsage(usage: TokenUsage): usage is LanguageModelUsage {
  return 'inputTokens' in usage
}

/**
 * Track token usage for analytics
 * Handles both OpenAI format (prompt_tokens) and AI SDK format (inputTokens)
 */
export function trackTokenUsage({ usage, model, source = 'chat' }: TokenUsageParams): void {
  if (!usage || !model?.provider || !model?.id) return

  const [inputTokens, outputTokens] = isAiSdkUsage(usage)
    ? [usage.inputTokens ?? 0, usage.outputTokens ?? 0]
    : [usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0]

  void inputTokens
  void outputTokens
  void source
}
