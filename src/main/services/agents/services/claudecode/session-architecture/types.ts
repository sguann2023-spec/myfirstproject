export type AgentConversationSegmentStatus = 'active' | 'compacted' | 'closed'

export interface AgentConversationSegment {
  id: string
  topicId: string
  sdkSessionId: string
  parentSegmentId?: string
  forkFromSdkSessionId?: string
  systemPromptVersion: string
  systemPromptHash: string
  basePromptSnapshot?: string
  rawSummary?: string
  continuationSummary?: string
  compactReason?: string
  summaryVersion?: string
  startMessageId?: string
  endMessageId?: string
  status: AgentConversationSegmentStatus
  createdAt: string
  updatedAt: string
}

export interface AgentTurn {
  id: string
  topicId: string
  segmentId: string
  traceId?: string
  userMessageId: string
  assistantMessageId?: string
  userText?: string
  assistantText?: string
  cumulativeInputTokens?: number
  startedAt: string
  completedAt?: string
  status: 'running' | 'completed' | 'cancelled' | 'failed'
}

export interface AgentArtifact {
  id: string
  topicId: string
  segmentId: string
  turnId: string
  sourceType: 'read' | 'grep' | 'webfetch' | 'tool_result'
  toolSubtype?: string
  toolCallId?: string
  filePath?: string
  uri?: string
  lineStart?: number
  lineEnd?: number
  content: string
  contentHash: string
  summary?: string
  createdAt: string
}

export interface AgentFileChange {
  id: string
  topicId: string
  segmentId: string
  turnId: string
  messageId?: string
  toolCallId?: string
  filePath: string
  operation: 'create' | 'update' | 'delete' | 'rename'
  beforeSnapshot?: string
  afterSnapshot?: string
  patch?: string
  beforeHash?: string
  afterHash?: string
  createdAt: string
}

export interface PromptView {
  continuationSummary?: string
  recentTurns: Array<{
    role: 'user' | 'assistant'
    text: string
  }>
  currentPrompt: string
  referencedArtifacts?: Array<{
    id: string
    sourceType: AgentArtifact['sourceType']
    toolSubtype?: string
    filePath?: string
    summary: string
  }>
}

export interface SegmentPromptEnvelope {
  systemPrompt: string
  promptView: PromptView
  systemPromptHash: string
  systemPromptVersion: string
  modelHash?: string
  toolsHash?: string
  messagesHash?: string
}

export interface CompactDecision {
  shouldCompact: boolean
  reason?: string
  cumulativeInputTokens?: number
}
