import type { AgentArtifact, AgentTurn, PromptView } from './types'

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
        turn.userText ? { role: 'user' as const, text: turn.userText } : null,
        turn.assistantText ? { role: 'assistant' as const, text: turn.assistantText } : null
      ])
      .filter((turn): turn is { role: 'user' | 'assistant'; text: string } => Boolean(turn))

    return {
      continuationSummary: input.continuationSummary,
      recentTurns,
      currentPrompt: input.currentPrompt,
      referencedArtifacts: []
    }
  }
}

export const promptViewBuilder = new PromptViewBuilderImpl()
