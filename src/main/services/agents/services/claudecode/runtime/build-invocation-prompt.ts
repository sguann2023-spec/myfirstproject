import { randomUUID } from 'node:crypto'

import { configManager } from '@main/services/ConfigManager'
import { CHANNEL_SECURITY_PROMPT } from '@shared/agents/claudecode/constants'
import { languageEnglishNameMap } from '@shared/config/languages'

import type { GetAgentSessionResponse } from '../..'
import { agentArtifactRepository } from '../../../database/repositories/agentArtifactRepository'
import { agentTurnRepository } from '../../../database/repositories/agentTurnRepository'
import { channelService } from '../../ChannelService'
import { PromptBuilder } from '../../cherryclaw/prompt'
import type { ToolGuidanceOptions } from '../capability-router'
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

const buildTraceId = () => `trace_${randomUUID()}`

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

const getLanguageInstruction = () => {
  const lang = configManager.getLanguage()
  const resolvedLanguageName = languageEnglishNameMap[lang]
  return `
  IMPORTANT: You MUST use ${resolvedLanguageName} language for ALL your outputs, including:
  (1) text responses, (2) tool call parameters like "description" fields, and (3) any user-facing content.
  ${lang === 'en-US' ? '' : 'Never use English unless the content is code, file paths, or technical identifiers.'}
  `
}

export type InvocationPromptState = {
  traceId: string
  activeSegment: AgentConversationSegment | null
  currentTurn: AgentTurn | null
  promptEnvelope: SegmentPromptEnvelope
  composedPrompt: string
  clawSystemPrompt?: string
  factsRecall?: string
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
  activeClaudeSkillNames: string[]
  lastAgentSessionId?: string
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
    activeClaudeSkillNames,
    lastAgentSessionId
  } = input

  const linkedChannel = await channelService.findBySessionId(session.id)
  const channelSecurityBlock = linkedChannel ? CHANNEL_SECURITY_PROMPT : ''

  let assistantSystemPrompt: string | undefined
  if (isAssistant) {
    try {
      const context = await buildAssistantContext()
      assistantSystemPrompt = session.instructions ? `${session.instructions}\n\n${context}` : context
    } catch {
      assistantSystemPrompt = session.instructions
    }
  }

  const clawSystemPrompt = !isAssistant
    ? await promptBuilder.buildSystemPrompt(cwd, agentConfig, toolGuidanceOptions, {
        activeSkillNames: activeClaudeSkillNames
      })
    : undefined
  const factsRecall =
    !isAssistant && toolGuidanceOptions.hasMemory && cwd ? await promptBuilder.buildFactsSection(cwd) : undefined

  const finalSystemPrompt = assistantSystemPrompt
    ? assistantSystemPrompt
    : [clawSystemPrompt, factsRecall, session.instructions, channelSecurityBlock, getLanguageInstruction()]
        .filter(Boolean)
        .join('\n\n')

  const traceId = buildTraceId()
  let activeSegment = await conversationSegmentService.getActiveSegment(session.id)
  if (!activeSegment && lastAgentSessionId) {
    activeSegment = await conversationSegmentService.createRootSegment({
      topicId: session.id,
      sdkSessionId: lastAgentSessionId,
      systemPromptVersion: 'v1',
      systemPromptHash: 'bootstrap_pending',
      basePromptSnapshot: String(finalSystemPrompt || '')
    })
  }

  const recentTurnLimit = getSegmentRecentTurnLimit(activeSegment?.continuationSummary)
  const recentTurns = activeSegment ? await agentTurnRepository.listBySegmentId(activeSegment.id, recentTurnLimit) : []
  const referencedArtifacts = (
    await Promise.all(recentTurns.map(async (turn) => agentArtifactRepository.listByTurnId(turn.id)))
  )
    .flat()
    .filter((artifact) => artifact.sourceType === 'tool_result')
  const promptView = await promptViewBuilder.build({
    continuationSummary: activeSegment?.continuationSummary,
    recentTurns,
    currentPrompt: sdkPrompt,
    referencedArtifacts
  })
  const promptEnvelope = await segmentPromptService.build({
    stableBasePrompt: assistantSystemPrompt ? String(assistantSystemPrompt) : String(clawSystemPrompt || ''),
    dynamicContextPrompt: assistantSystemPrompt
      ? ''
      : [factsRecall, session.instructions, channelSecurityBlock, getLanguageInstruction()].filter(Boolean).join('\n\n'),
    promptView,
    modelId,
    builtinTools: toolSurface.builtinTools,
    allowedTools: toolSurface.allowedToolsOption
  })
  const composedPrompt = composePromptViewText(promptEnvelope.promptView)

  const currentTurn = activeSegment
    ? await agentTurnRepository.save({
        id: `turn_${randomUUID()}`,
        topicId: session.id,
        segmentId: activeSegment.id,
        traceId,
        userMessageId: '',
        userText: requestPrompt,
        startedAt: new Date().toISOString(),
        status: 'running'
      })
    : null

  return {
    traceId,
    activeSegment,
    currentTurn,
    promptEnvelope,
    composedPrompt,
    clawSystemPrompt,
    factsRecall,
    assistantSystemPrompt
  }
}
