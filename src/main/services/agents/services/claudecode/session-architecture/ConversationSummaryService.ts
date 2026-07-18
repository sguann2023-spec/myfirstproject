import type { AgentArtifact, AgentConversationSegment, AgentFileChange, AgentTurn } from './types'

export interface BuildRawSummaryInput {
  segment: AgentConversationSegment
  recentTurns: AgentTurn[]
  artifacts: AgentArtifact[]
  fileChanges: AgentFileChange[]
}

export interface CompressSummaryInput {
  rawSummary: string
  maxChars?: number
  maxLines?: number
  maxLineChars?: number
}

export interface ConversationSummaryService {
  buildRawSummary(input: BuildRawSummaryInput): Promise<string>
  compressSummary(input: CompressSummaryInput): Promise<string>
}

export class ConversationSummaryServiceImpl implements ConversationSummaryService {
  async buildRawSummary(input: BuildRawSummaryInput): Promise<string> {
    const recentUserRequests = input.recentTurns
      .map((turn) => turn.userText)
      .filter((value): value is string => Boolean(value))
      .slice(-3)
    const pendingWork = input.recentTurns
      .filter((turn) => turn.status !== 'completed')
      .map((turn) => turn.userText || turn.id)
      .slice(0, 3)
    const fileChanges = input.fileChanges.slice(0, 5).map((change) => `- ${change.operation} \`${change.filePath}\``)
    const toolFindings = input.artifacts
      .slice(0, 5)
      .map((artifact) => `- ${artifact.sourceType}${artifact.filePath ? ` \`${artifact.filePath}\`` : ''}`)
    const previousContext = input.segment.continuationSummary
      ? ['## Previously Compacted Context', input.segment.continuationSummary]
      : []

    return [
      '## Scope',
      `- Segment ${input.segment.id} for topic ${input.segment.topicId}`,
      ...previousContext,
      '## Recent User Requests',
      ...(recentUserRequests.length > 0 ? recentUserRequests.map((value) => `- ${value}`) : ['- No recent user requests captured']),
      '## Tool Findings',
      ...(toolFindings.length > 0 ? toolFindings : ['- No persisted artifact findings']),
      '## File Changes',
      ...(fileChanges.length > 0 ? fileChanges : ['- No file changes recorded']),
      '## Pending Work',
      ...(pendingWork.length > 0 ? pendingWork.map((value) => `- ${value}`) : ['- No pending work captured'])
    ].join('\n')
  }

  async compressSummary(input: CompressSummaryInput): Promise<string> {
    const maxChars = input.maxChars ?? 1_200
    const maxLines = input.maxLines ?? 24
    const maxLineChars = input.maxLineChars ?? 160
    const normalizedLines = input.rawSummary
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
    const dedupedLines = Array.from(new Map(normalizedLines.map((line) => [line.toLowerCase(), line])).values())
    const limitedLines = dedupedLines.slice(0, maxLines).map((line) =>
      line.length > maxLineChars ? `${line.slice(0, maxLineChars - 1)}…` : line
    )
    const compressed = limitedLines.join('\n')
    return compressed.length > maxChars ? `${compressed.slice(0, maxChars - 1)}…` : compressed
  }
}

export const conversationSummaryService = new ConversationSummaryServiceImpl()
