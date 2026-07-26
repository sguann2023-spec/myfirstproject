import type { AgentArtifact, AgentConversationSegment, AgentFileChange, AgentTurn } from './types'

const MAX_RECENT_USER_REQUESTS = 2
const MAX_RECENT_ASSISTANT_RESPONSES = 2
const MAX_PENDING_WORK_ITEMS = 3
const MAX_FILE_CHANGES = 5
const MAX_REFERENCED_ARTIFACTS = 3
const MAX_SUMMARY_LINE_CHARS = 220
const STABLE_HANDLE_LINE_LIMIT = 8
const SUMMARY_STATE_LINE_PATTERN =
  /\b(task[_ -]?id|draft[_ -]?id|job[_ -]?id|file[_ -]?path|url|session[_ -]?id|sdk[_ -]?session[_ -]?id)\b/i
const SUMMARY_PROGRESS_LINE_PATTERN = /\b(pending|in[_ -]?progress|remaining|next|todo|step\s+\d+)\b|下一步|待处理|进行中/i
const URL_PATTERN = /https?:\/\/[^\s`'"]+/i
const PATH_PATTERN = /\/[^\s`'"]+/i

const normalizeSummaryText = (text: string): string =>
  String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim()

const truncateSummaryLine = (text: string, maxChars = MAX_SUMMARY_LINE_CHARS): string => {
  const normalized = normalizeSummaryText(text)
  if (normalized.length <= maxChars) {
    return normalized
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`
}

const toBullet = (text: string): string => `- ${truncateSummaryLine(text)}`

const buildUniqueLines = (lines: string[], limit: number): string[] =>
  Array.from(new Map(lines.filter(Boolean).map((line) => [line.toLowerCase(), line])).values()).slice(0, limit)

const extractStableStateLines = (text: string, limit = STABLE_HANDLE_LINE_LIMIT): string[] => {
  const normalized = normalizeSummaryText(text)
  if (!normalized) {
    return []
  }

  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const matchedLines = lines
    .filter((line) => SUMMARY_STATE_LINE_PATTERN.test(line) || URL_PATTERN.test(line) || PATH_PATTERN.test(line))
    .map((line) => toBullet(line))

  const progressLines = lines.filter((line) => SUMMARY_PROGRESS_LINE_PATTERN.test(line)).map((line) => toBullet(line))

  return buildUniqueLines([...matchedLines, ...progressLines], limit)
}

const summarizeRecentAssistantResponse = (text: string): string[] => {
  const stableStateLines = extractStableStateLines(text, 4)
  if (stableStateLines.length > 0) {
    return stableStateLines
  }
  const normalized = normalizeSummaryText(text)
  return normalized ? [toBullet(normalized)] : []
}

const summarizeRecentUserRequest = (text: string): string => toBullet(text)

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
      .slice(-MAX_RECENT_USER_REQUESTS)
      .map((value) => summarizeRecentUserRequest(value))
    const recentAssistantResponses = buildUniqueLines(
      input.recentTurns
        .map((turn) => turn.assistantText)
        .filter((value): value is string => Boolean(value))
        .slice(-MAX_RECENT_ASSISTANT_RESPONSES)
        .flatMap((value) => summarizeRecentAssistantResponse(value)),
      6
    )
    const pendingWork = input.recentTurns
      .filter((turn) => turn.status !== 'completed')
      .map((turn) => turn.userText || turn.id)
      .slice(0, MAX_PENDING_WORK_ITEMS)
      .map((value) => summarizeRecentUserRequest(value))
    const fileChanges = input.fileChanges
      .slice(0, MAX_FILE_CHANGES)
      .map((change) => `- ${change.operation} \`${change.filePath}\``)
    const referencedArtifacts = input.artifacts
      .slice(0, MAX_REFERENCED_ARTIFACTS)
      .map((artifact) => {
        const location = artifact.filePath || artifact.uri || artifact.toolSubtype || artifact.sourceType
        return location ? `- artifact: ${truncateSummaryLine(location, 180)}` : ''
      })
      .filter(Boolean)
    const previousContextLines = input.segment.continuationSummary
      ? extractStableStateLines(input.segment.continuationSummary)
      : []
    const previousContext = previousContextLines.length > 0 ? ['## Structured State', ...previousContextLines] : []

    return [
      '## Scope',
      `- Topic ${input.segment.topicId}`,
      `- Segment ${input.segment.id}`,
      ...previousContext,
      '## Recent User Requests',
      ...(recentUserRequests.length > 0 ? recentUserRequests : ['- No recent user requests captured']),
      '## Recent Assistant State',
      ...(recentAssistantResponses.length > 0 ? recentAssistantResponses : ['- No recent assistant state captured']),
      '## Referenced Artifacts',
      ...(referencedArtifacts.length > 0 ? referencedArtifacts : ['- No referenced artifacts captured']),
      '## File Changes',
      ...(fileChanges.length > 0 ? fileChanges : ['- No file changes recorded']),
      '## Pending Work',
      ...(pendingWork.length > 0 ? pendingWork : ['- No pending work captured'])
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
