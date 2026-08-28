import { randomUUID } from 'node:crypto'

import type { SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { loggerService } from '@logger'

import { syncSlashCommandsFromSdk } from '../bridges/slash-commands'
import {
  buildSyntheticToolImageMessage,
  extractImageUrlsFromToolOutput
} from '../bridges/screenshot-image-bridge'
import { agentArtifactRepository } from '../../../database/repositories/agentArtifactRepository'
import { agentTurnRepository } from '../../../database/repositories/agentTurnRepository'
import { artifactStoreService, buildArtifactHash } from '../session-architecture/ArtifactStoreService'
import { conversationSegmentService } from '../session-architecture/ConversationSegmentService'
import { conversationSummaryService } from '../session-architecture/ConversationSummaryService'
import { fileChangeJournalService } from '../session-architecture/FileChangeJournalService'
import type {
  AgentConversationSegment,
  AgentTurn,
  SegmentPromptEnvelope
} from '../session-architecture/types'
import { summarizeToolResultForArtifact } from '../tool-result-text'

const logger = loggerService.withContext('ClaudeCodeQueryEffects')

export type QueryArchitectureContext = {
  traceId: string
  topicId: string
  currentPrompt: string
  promptEnvelope: SegmentPromptEnvelope
  pendingFileChanges: Map<
    string,
    Array<{
      filePath: string
      operation: 'create' | 'update' | 'delete'
      existedBefore: boolean
      beforeSnapshot?: string
      beforeHash?: string
    }>
  >
}

export function summarizeChunkField(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const safeSerializedLength = (value: unknown): number => {
  if (typeof value === 'string') return value.length
  if (value === undefined || value === null) return 0
  try {
    return JSON.stringify(value).length
  } catch {
    return String(value).length
  }
}

export async function handleInitSystemMessage(input: {
  message: SDKMessage & { type: 'system'; subtype: 'init'; session_id?: string; slash_commands?: string[] }
  stream: { sdkSessionId?: string }
  sessionId: string
  agentId: string
  architectureContext: QueryArchitectureContext
  currentSegment: AgentConversationSegment | null
  currentTurn: AgentTurn | null
}): Promise<{
  currentSegment: AgentConversationSegment | null
  currentTurn: AgentTurn | null
}> {
  const { message, stream, sessionId, agentId, architectureContext } = input
  let { currentSegment, currentTurn } = input

  if (message.session_id) {
    stream.sdkSessionId = message.session_id
    logger.info('Captured SDK session_id from init message', {
      sdkSessionId: message.session_id,
      sessionId
    })

    if (!currentSegment) {
      currentSegment = await conversationSegmentService.createRootSegment({
        topicId: architectureContext.topicId,
        sdkSessionId: message.session_id,
        systemPromptVersion: architectureContext.promptEnvelope.systemPromptVersion,
        systemPromptHash: architectureContext.promptEnvelope.systemPromptHash,
        basePromptSnapshot: architectureContext.promptEnvelope.systemPrompt
      })
    } else if (!currentSegment.sdkSessionId) {
      await conversationSegmentService.bindSdkSession(currentSegment.id, message.session_id)
      currentSegment = {
        ...currentSegment,
        sdkSessionId: message.session_id,
        updatedAt: new Date().toISOString()
      }
      logger.info('[ForkContinuation] bind-child-session', {
        topicId: architectureContext.topicId,
        traceId: architectureContext.traceId,
        segmentId: currentSegment.id,
        sdkSessionId: message.session_id,
        forkFromSdkSessionId: currentSegment.forkFromSdkSessionId ?? ''
      })
    }

    if (!currentTurn && currentSegment) {
      currentTurn = await agentTurnRepository.save({
        id: `turn_${randomUUID()}`,
        topicId: architectureContext.topicId,
        segmentId: currentSegment.id,
        traceId: architectureContext.traceId,
        userMessageId: '',
        userText: architectureContext.currentPrompt,
        startedAt: new Date().toISOString(),
        status: 'running'
      })
    }
  }

  await syncSlashCommandsFromSdk({
    agentId,
    sessionId,
    sdkSlashCommands: message.slash_commands || []
  })

  return { currentSegment, currentTurn }
}

export async function handleToolResultSideEffects(input: {
  chunk: any
  architectureContext: QueryArchitectureContext
  currentSegment: AgentConversationSegment | null
  currentTurn: AgentTurn | null
  pendingToolCalls: Map<string, { emittedId?: string; providerToolCallId?: string; toolName: string; input?: unknown }>
  getArtifactSourceType: (toolName: string) => 'read' | 'grep' | 'webfetch' | 'tool_result'
  shouldOffloadToolResult: (toolName: string, outputText: string) => boolean
  tryExtractFilePath: (toolInput: unknown) => string | undefined
}): Promise<void> {
  const {
    chunk,
    architectureContext,
    currentSegment,
    currentTurn,
    pendingToolCalls,
    getArtifactSourceType,
    shouldOffloadToolResult,
    tryExtractFilePath
  } = input

  const toolCallId = String(chunk.toolCallId || '')
  const toolName = String(chunk.toolName || '')
  const pendingToolCall = pendingToolCalls.get(toolCallId)
  const providerToolCallId = String(pendingToolCall?.providerToolCallId || toolCallId)
  const rawOutput = chunk.rawOutput ?? chunk.output
  const actuallyTruncated =
    typeof chunk.truncated === 'boolean' ? chunk.truncated : Boolean(chunk.rawOutput) && chunk.rawOutput !== chunk.output
  const outputText = summarizeToolResultForArtifact(rawOutput)

  if (currentTurn && currentSegment && shouldOffloadToolResult(toolName, outputText)) {
    const artifact = await artifactStoreService.save({
      topicId: architectureContext.topicId,
      segmentId: currentSegment.id,
      turnId: currentTurn.id,
      sourceType: getArtifactSourceType(toolName),
      toolSubtype: toolName,
      toolCallId: providerToolCallId,
      filePath: tryExtractFilePath(pendingToolCall?.input),
      content: outputText,
      contentHash: buildArtifactHash(outputText),
      summary: outputText.slice(0, 500)
    })
    logger.info('[ArtifactStore] offload', {
      topicId: architectureContext.topicId,
      turnId: currentTurn.id,
      segmentId: currentSegment.id,
      toolCallId: providerToolCallId,
      sourceType: artifact.sourceType,
      toolSubtype: artifact.toolSubtype,
      contentChars: outputText.length,
      inlineChars: safeSerializedLength(chunk.output),
      rawChars: outputText.length,
      truncated: actuallyTruncated,
      storedAsArtifact: true,
      artifactId: artifact.id,
      contentHash: artifact.contentHash
    })
  }

  const pendingChanges = architectureContext.pendingFileChanges.get(providerToolCallId) ?? []
  if (currentTurn && currentSegment && pendingChanges.length > 0) {
    for (const pendingChange of pendingChanges) {
      const after = await fileChangeJournalService.readSnapshot(pendingChange.filePath)
      const operation = pendingChange.operation === 'create' && pendingChange.existedBefore ? 'update' : pendingChange.operation
      await fileChangeJournalService.record({
        topicId: architectureContext.topicId,
        segmentId: currentSegment.id,
        turnId: currentTurn.id,
        toolCallId: providerToolCallId,
        filePath: pendingChange.filePath,
        operation,
        beforeSnapshot: pendingChange.beforeSnapshot,
        afterSnapshot: after.content,
        beforeHash: pendingChange.beforeHash,
        afterHash: after.hash,
        patch: fileChangeJournalService.buildPatch(pendingChange.beforeSnapshot, after.content)
      })
    }
    logger.info('[FileChangeJournal] recorded', {
      topicId: architectureContext.topicId,
      traceId: architectureContext.traceId,
      turnId: currentTurn.id,
      segmentId: currentSegment.id,
      toolCallId: providerToolCallId,
      count: pendingChanges.length,
      paths: pendingChanges.map((item) => item.filePath)
    })
  }

  architectureContext.pendingFileChanges.delete(providerToolCallId)
  pendingToolCalls.delete(toolCallId)
  if (providerToolCallId !== toolCallId) {
    pendingToolCalls.delete(providerToolCallId)
  }
}

export function maybeBridgeScreenshotToolResult(input: {
  chunk: any
  sessionId: string
  bridgedScreenshotUrls: Set<string>
  enqueuePromptMessage: (value: SDKUserMessage | null) => void
}): void {
  const { chunk, sessionId, bridgedScreenshotUrls, enqueuePromptMessage } = input
  if (chunk.type !== 'tool-result' || chunk.toolName !== 'mcp__browser__screenshot') {
    return
  }

  const imageUrls = extractImageUrlsFromToolOutput(chunk.output).filter((url) => {
    if (bridgedScreenshotUrls.has(url)) {
      return false
    }
    bridgedScreenshotUrls.add(url)
    return true
  })

  if (imageUrls.length > 0) {
    logger.info('Bridging screenshot tool result back into SDK as image input', {
      sessionId,
      toolCallId: chunk.toolCallId ?? '',
      imageCount: imageUrls.length,
      imageUrls
    })
    enqueuePromptMessage(buildSyntheticToolImageMessage(imageUrls))
  } else {
    logger.warn('Screenshot tool result did not expose any bridgeable image URL', {
      sessionId,
      toolCallId: chunk.toolCallId ?? '',
      output: summarizeChunkField(chunk.output).slice(0, 1200)
    })
  }
}

export async function recoverFreshSegmentAfterCompactionLoop(input: {
  currentSegment: AgentConversationSegment | null
  currentTurn: AgentTurn | null
  architectureContext: QueryArchitectureContext
  compactBoundaryCount: number
}): Promise<void> {
  const { currentSegment, currentTurn, architectureContext, compactBoundaryCount } = input
  if (!currentSegment) {
    return
  }

  const recoveryRecentTurns = currentTurn ? [currentTurn] : []
  const recoveryArtifacts = currentTurn ? await agentArtifactRepository.listByTurnId(currentTurn.id) : []
  const recoveryFileChanges = currentTurn ? await fileChangeJournalService.listByTurn(currentTurn.id) : []
  const rawSummary = await conversationSummaryService.buildRawSummary({
    segment: currentSegment,
    recentTurns: recoveryRecentTurns,
    artifacts: recoveryArtifacts,
    fileChanges: recoveryFileChanges
  })
  const continuationSummary = await conversationSummaryService.compressSummary({
    rawSummary,
    maxChars: 800,
    maxLines: 16,
    maxLineChars: 140
  })

  await conversationSegmentService.closeSegment(currentSegment.id)
  const childSegment = await conversationSegmentService.createChildSegment({
    topicId: currentSegment.topicId,
    parentSegmentId: currentSegment.id,
    forkFromSdkSessionId: currentSegment.sdkSessionId,
    systemPromptVersion: architectureContext.promptEnvelope.systemPromptVersion,
    systemPromptHash: architectureContext.promptEnvelope.systemPromptHash,
    basePromptSnapshot: architectureContext.promptEnvelope.systemPrompt,
    continuationSummary,
    compactReason: 'repeated_auto_compaction',
    summaryVersion: 'v1'
  })

  logger.warn('[CompactionFuse] created fresh child segment after repeated auto-compaction', {
    topicId: architectureContext.topicId,
    traceId: architectureContext.traceId,
    parentSegmentId: currentSegment.id,
    childSegmentId: childSegment.id,
    compactBoundaryCount,
    continuationSummaryChars: continuationSummary.length
  })
}
