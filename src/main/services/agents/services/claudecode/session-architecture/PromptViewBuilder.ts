import type { AgentArtifact, AgentTurn, PromptView } from './types'
import { buildInlineToolResultText } from '../tool-result-text'

const MAX_RECENT_TURN_TEXT_CHARS = 2800
const MAX_REFERENCED_ARTIFACTS = 20

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
      .flatMap((turn) => {
        const userText = turn.userText ? truncatePromptTurnText(turn.userText) : ''
        const assistantText = turn.assistantText ? truncatePromptTurnText(turn.assistantText) : ''
        if (turn.status === 'cancelled' || turn.status === 'interrupted') {
          const userLabel = turn.status === 'cancelled' ? '[该轮对话被用户中断]' : '[该轮对话因进程中断而结束]'
          const assistantLabel =
            turn.status === 'cancelled'
              ? '[以下是中断前产生的部分输出]'
              : '[以下是进程中断前保存的部分输出]'
          return [
            userText ? { role: 'user' as const, text: `${userLabel}\n${userText}` } : null,
            assistantText ? { role: 'assistant' as const, text: `${assistantLabel}\n${assistantText}` } : null
          ]
        }
        return [
          userText ? { role: 'user' as const, text: userText } : null,
          assistantText ? { role: 'assistant' as const, text: assistantText } : null
        ]
      })
      .filter((turn): turn is { role: 'user' | 'assistant'; text: string } => Boolean(turn?.text))

    const referencedArtifacts = (input.referencedArtifacts ?? []).slice(-MAX_REFERENCED_ARTIFACTS).map((artifact) => ({
      id: artifact.id,
      sourceType: artifact.sourceType,
      toolSubtype: artifact.toolSubtype,
      filePath: artifact.filePath,
      summary: buildInlineToolResultText(artifact.content, artifact.toolSubtype || artifact.sourceType)
    }))

    return {
      continuationSummary: input.continuationSummary,
      recentTurns,
      currentPrompt: input.currentPrompt,
      referencedArtifacts
    }
  }
}

export const promptViewBuilder = new PromptViewBuilderImpl()
