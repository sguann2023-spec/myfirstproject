import { loggerService } from '@logger'
import { USER_INTERACTION_GUIDANCE } from '@shared/userInteraction'
import { CHANNEL_SECURITY_PROMPT } from '@shared/agents/claudecode/constants'

import type { GetAgentSessionResponse } from '../..'
import type { AgentInvocationIds } from '../../../interfaces/AgentStreamInterface'
import { agentArtifactRepository } from '../../../database/repositories/agentArtifactRepository'
import { SqlitePiSessionStorage } from '../../../database/repositories/piSessionStorage'
import { agentTurnRepository } from '../../../database/repositories/agentTurnRepository'
import { channelService } from '../../ChannelService'
import { PromptBuilder, type ToolGuidanceOptions } from '../../cherryclaw/prompt'
import { buildAssistantContext } from './assistant-context'
import { conversationSegmentService } from '../session-architecture/ConversationSegmentService'
import { promptViewBuilder } from '../session-architecture/PromptViewBuilder'
import { segmentPromptService } from '../session-architecture/SegmentPromptService'
import type {
  AgentConversationSegment,
  AgentTurn,
  PromptView,
  SegmentPromptEnvelope
} from '../session-architecture/types'
import type { ToolSurface } from '../tool-surface'

const promptBuilder = new PromptBuilder()
const DEFAULT_SEGMENT_RECENT_TURNS = 20
const CONTINUED_SEGMENT_RECENT_TURNS = 2

const getSegmentRecentTurnLimit = (continuationSummary?: string): number =>
  continuationSummary ? CONTINUED_SEGMENT_RECENT_TURNS : DEFAULT_SEGMENT_RECENT_TURNS

const composePromptViewText = (promptView: PromptView): string => {
  const sections: string[] = []
  if (promptView.continuationSummary) {
    sections.push(['[Continuation Summary]', promptView.continuationSummary].join('\n'))
  }
  if (promptView.recentTurns.length > 0) {
    sections.push(
      ['[Recent Turns]', ...promptView.recentTurns.map((turn) => `${turn.role}: ${turn.text}`)].join('\n')
    )
  }
  if ((promptView.referencedArtifacts?.length ?? 0) > 0) {
    sections.push(
      [
        '[Referenced Artifacts]',
        ...((promptView.referencedArtifacts ?? []).map((artifact) => {
          const source = artifact.toolSubtype || artifact.sourceType
          const location = artifact.filePath ? ` ${artifact.filePath}` : ''
          return `- (${source})${location}\n${artifact.summary}`
        }) ?? [])
      ].join('\n')
    )
  }
  sections.push(promptView.currentPrompt)
  return sections.filter(Boolean).join('\n\n')
}

export type InvocationPromptState = {
  traceId: string
  activeSegment: AgentConversationSegment | null
  currentTurn: AgentTurn | null
  promptEnvelope: SegmentPromptEnvelope
  composedPrompt: string
  clawSystemPrompt?: string
  assistantSystemPrompt?: string
}

export async function buildInvocationPromptState(input: {
  session: GetAgentSessionResponse
  cwd: string
  sdkPrompt: string
  requestPrompt: string
  modelId: string
  toolSurface: ToolSurface
  toolGuidanceOptions: ToolGuidanceOptions
  isAssistant: boolean
  agentConfig: Parameters<PromptBuilder['buildSystemPrompt']>[1]
  lastAgentSessionId?: string
  invocationIds: AgentInvocationIds
}): Promise<InvocationPromptState> {
  const {
    session,
    cwd,
    sdkPrompt,
    requestPrompt,
    modelId,
    toolSurface,
    toolGuidanceOptions,
    isAssistant,
    agentConfig,
    lastAgentSessionId,
    invocationIds
  } = input

  const logger = loggerService.withContext('InvocationPrompt')
  const step = async <T>(stage: string, operation: () => Promise<T>): Promise<T> => {
    const startedAt = Date.now()
    const context = { sessionId: session.id, traceId: invocationIds.traceId, stage }
    const timer = setTimeout(() => logger.warn('Pre-harness prompt stage still pending', {
      ...context, elapsedMs: Date.now() - startedAt
    }), 3000)
    try {
      return await operation()
    } catch (error) {
      logger.error('Pre-harness prompt stage failed', {
        ...context, elapsedMs: Date.now() - startedAt,
        error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error)
      })
      throw error
    } finally {
      clearTimeout(timer)
    }
  }
  const linkedChannel = await step('channel', () => channelService.findBySessionId(session.id))
  const channelSecurityBlock = linkedChannel ? CHANNEL_SECURITY_PROMPT : ''

  let assistantSystemPrompt: string | undefined
  if (isAssistant) {
    try {
      const context = await step('assistant_context', () => buildAssistantContext())
      assistantSystemPrompt = session.instructions ? `${session.instructions}\n\n${context}` : context
    } catch {
      assistantSystemPrompt = session.instructions
    }
  }

  if (isAssistant) assistantSystemPrompt = [assistantSystemPrompt, USER_INTERACTION_GUIDANCE].filter(Boolean).join('\n\n')

  const clawSystemPrompt = !isAssistant
    ? [await step('workspace_instructions', () => promptBuilder.buildSystemPrompt(cwd, agentConfig, toolGuidanceOptions)), USER_INTERACTION_GUIDANCE].join('\n\n')
    : undefined

  const finalSystemPrompt = assistantSystemPrompt
    ? assistantSystemPrompt
    : [clawSystemPrompt, session.instructions, channelSecurityBlock]
        .filter(Boolean)
        .join('\n\n')

  const traceId = invocationIds.traceId
  let activeSegment = await step('active_segment', () => conversationSegmentService.getActiveSegment(session.id))
  if (!activeSegment) {
    activeSegment = await step('create_root_segment', () => conversationSegmentService.createRootSegment({
      topicId: session.id,
      sdkSessionId: lastAgentSessionId,
      systemPromptVersion: 'v1',
      systemPromptHash: 'bootstrap_pending',
      basePromptSnapshot: String(finalSystemPrompt || '')
    }))
  }

  const durablePiHistoryAvailable = await step('durable_history_probe', () => SqlitePiSessionStorage.hasDurableConversation({
    topicId: session.id,
    workspacePath: input.cwd,
    excludeMessageIds: [invocationIds.userMessageId, invocationIds.assistantMessageId]
  }))
  const recentTurnLimit = getSegmentRecentTurnLimit(activeSegment?.continuationSummary)
  const recentTurns = durablePiHistoryAvailable
    ? []
    : activeSegment
      ? await agentTurnRepository.listBySegmentId(activeSegment.id, recentTurnLimit)
      : []
  const referencedArtifacts = durablePiHistoryAvailable
    ? []
    : (
        await Promise.all(recentTurns.map(async (turn) => agentArtifactRepository.listByTurnId(turn.id)))
      )
        .flat()
        .filter((artifact) => artifact.sourceType === 'tool_result')
  const promptView = await promptViewBuilder.build({
    continuationSummary: durablePiHistoryAvailable ? undefined : activeSegment?.continuationSummary,
    recentTurns,
    currentPrompt: sdkPrompt,
    referencedArtifacts
  })
  const promptEnvelope = await segmentPromptService.build({
    stableBasePrompt: assistantSystemPrompt ? String(assistantSystemPrompt) : String(clawSystemPrompt || ''),
    dynamicContextPrompt: assistantSystemPrompt
      ? ''
      : [session.instructions, channelSecurityBlock].filter(Boolean).join('\n\n'),
    promptView,
    modelId,
    builtinTools: toolSurface.builtinTools
  })
  const composedPrompt = composePromptViewText(promptEnvelope.promptView)

  const currentTurn = activeSegment
    ? await step('save_current_turn', () => agentTurnRepository.save({
        id: invocationIds.turnId,
        topicId: session.id,
        segmentId: activeSegment.id,
        traceId,
        userMessageId: invocationIds.userMessageId,
        assistantMessageId: invocationIds.assistantMessageId,
        userText: requestPrompt,
        startedAt: new Date().toISOString(),
        status: 'running'
      }))
    : null

  return {
    traceId,
    activeSegment,
    currentTurn,
    promptEnvelope,
    composedPrompt,
    clawSystemPrompt,
    assistantSystemPrompt
  }
}
