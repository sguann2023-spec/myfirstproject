import type { AgentArtifact, AgentTurn, PromptView } from './types'

const MAX_RECENT_TURN_TEXT_CHARS = 280

const normalizePromptTurnText = (text: string): string =>
  String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim()

const truncatePromptTurnText = (text: string): string => {
  const normalized = normalizePromptTurnText(text)
  if (normalized.length <= MAX_RECENT_TURN_TEXT_CHARS) {
    return normalized
  }
  return `${normalized.slice(0, MAX_RECENT_TURN_TEXT_CHARS - 1).trimEnd()}…`
}

export interface BuildPromptViewInput {
  continuationSummary?: string
  recentTurns: AgentTurn[]
  currentPrompt: string
  referencedArtifacts?: AgentArtifact[]
}

export interface PromptViewBuilder {
  build(input: BuildPromptViewInput): Promise<PromptView>
}

export class PromptViewBuilderImpl implements PromptViewBuilder {
  async build(input: BuildPromptViewInput): Promise<PromptView> {
    const recentTurns = input.recentTurns
      .flatMap((turn) => [
        turn.userText ? { role: 'user' as const, text: truncatePromptTurnText(turn.userText) } : null,
        turn.assistantText ? { role: 'assistant' as const, text: truncatePromptTurnText(turn.assistantText) } : null
      ])
      .filter((turn): turn is { role: 'user' | 'assistant'; text: string } => Boolean(turn?.text))

    return {
      continuationSummary: input.continuationSummary,
      recentTurns,
      currentPrompt: input.currentPrompt,
      referencedArtifacts: []
    }
  }
}

export const promptViewBuilder = new PromptViewBuilderImpl()
