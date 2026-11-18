import { randomUUID } from 'node:crypto'

import type { TextStreamPart } from 'ai'
import type { ContextCompactionEvent } from '@shared/agents/claudecode/types'
import { isTokenTelemetry, mergeTokenTelemetry, type TokenTelemetry } from '@shared/tokenTelemetry'

export type HeadlessPersistedBlock = {
  id: string
  messageId: string
  type: string
  createdAt: string
  updatedAt?: string
  status: string
  [key: string]: any
}

type PersistedUsage = {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  prompt_tokens_details?: {
    cached_tokens?: number
    cache_creation_input_tokens?: number
    cache_write_tokens?: number
  }
  input_tokens_details?: {
    cached_tokens?: number
    cache_creation_input_tokens?: number
    cache_write_tokens?: number
  }
}

export class TextStreamAccumulator {
  private readonly orderedContentSegments: Array<
    { kind: 'text'; text: string } | { kind: 'tool'; toolCallId: string } | { kind: 'compact'; operationId: string }
  > = []
  private readonly compactions = new Map<string, ContextCompactionEvent>()
  private textBuffer = ''
  private totalText = ''
  private currentReasoningId: string | null = null
  private readonly reasoningBlocks = new Map<string, string>()
  private readonly reasoningOrder: string[] = []
  private readonly toolCalls = new Map<string, { toolName?: string; input?: unknown; partialArguments?: string }>()
  private readonly toolResults = new Map<
    string,
    {
      inline: unknown
      raw: unknown
      truncated: boolean
      status: 'done' | 'error'
    }
  >()
  private readonly toolCallOrder: string[] = []
  private initSlashCommands: string[] = []
  private tokenTelemetry?: TokenTelemetry
  private committedUsage?: PersistedUsage
  private pendingUsage?: PersistedUsage
  private readonly committedUsageSteps: PersistedUsage[] = []

  private flushTextBuffer(): void {
    if (!this.textBuffer) {
      return
    }

    this.totalText += this.textBuffer
    this.orderedContentSegments.push({ kind: 'text', text: this.textBuffer })
    this.textBuffer = ''
  }

  private getToolCallKey(chunk: Record<string, any>): string | undefined {
    if (typeof chunk.toolCallId === 'string' && chunk.toolCallId) {
      return chunk.toolCallId
    }
    if (typeof chunk.id === 'string' && chunk.id) {
      return chunk.id
    }
    return undefined
  }

  private ensureToolEntry(toolCallId: string, toolName?: string): void {
    if (!this.toolCalls.has(toolCallId)) {
      this.toolCallOrder.push(toolCallId)
      this.toolCalls.set(toolCallId, {
        toolName,
        input: undefined
      })
      this.orderedContentSegments.push({ kind: 'tool', toolCallId })
      return
    }

    if (toolName) {
      const existing = this.toolCalls.get(toolCallId)
      this.toolCalls.set(toolCallId, {
        ...existing,
        toolName: existing?.toolName || toolName
      })
    }
  }

  private getToolInput(toolCallId: string): unknown {
    const toolCall = this.toolCalls.get(toolCallId)
    if (toolCall?.input !== undefined) {
      return toolCall?.input
    }
    if (toolCall?.partialArguments) {
      try {
        return JSON.parse(toolCall.partialArguments)
      } catch {
        // Keep incomplete or invalid JSON available as partialArguments.
      }
    }
    return undefined
  }

  private addCompaction(value: unknown): void {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    const event = value as ContextCompactionEvent
    if (typeof event.operationId !== 'string' || !event.operationId.trim() ||
      !['start', 'chunk', 'complete', 'error', 'cancelled'].includes(event.phase)) return

    const existing = this.compactions.get(event.operationId)
    // Replayed progress must not reopen an operation that already settled.
    if (existing && ['complete', 'error', 'cancelled'].includes(existing.phase)) return
    const next: ContextCompactionEvent = {
      ...existing,
      type: 'context_compaction',
      operationId: event.operationId,
      phase: event.phase
    }
    for (const key of ['chunk', 'tokensBefore', 'tokensAfter'] as const) {
      const number = event[key]
      if (typeof number === 'number' && Number.isFinite(number) && number >= 0) next[key] = number
    }
    if (typeof event.summary === 'string') next.summary = event.summary
    if (typeof event.error === 'string') next.error = event.error
    if (!existing) this.orderedContentSegments.push({ kind: 'compact', operationId: event.operationId })
    this.compactions.set(event.operationId, next)
  }

  add(part: TextStreamPart<Record<string, any>>): void {
    const chunk = part as any
    const partType = chunk.type as string | undefined
    if (partType && !['text-start', 'text-delta', 'text-end'].includes(partType)) {
      this.flushTextBuffer()
    }
    switch (partType) {
      case 'text-start':
        this.textBuffer = ''
        break
      case 'reasoning-start': {
        const reasoningId = typeof chunk.id === 'string' && chunk.id ? chunk.id : 'default-reasoning'
        if (!this.reasoningBlocks.has(reasoningId)) {
          this.reasoningOrder.push(reasoningId)
          this.reasoningBlocks.set(reasoningId, '')
        }
        this.currentReasoningId = reasoningId
        break
      }
      case 'reasoning-delta': {
        const reasoningId =
          (typeof chunk.id === 'string' && chunk.id) || this.currentReasoningId || 'default-reasoning'
        if (!this.reasoningBlocks.has(reasoningId)) {
          this.reasoningOrder.push(reasoningId)
          this.reasoningBlocks.set(reasoningId, '')
        }
        if (typeof chunk.text === 'string' && chunk.text) {
          this.reasoningBlocks.set(reasoningId, `${this.reasoningBlocks.get(reasoningId) || ''}${chunk.text}`)
        }
        this.currentReasoningId = reasoningId
        break
      }
      case 'reasoning-end':
        if (!chunk.id || chunk.id === this.currentReasoningId) {
          this.currentReasoningId = null
        }
        break
      case 'text-delta':
        if (chunk.text) {
          this.textBuffer += chunk.text
        }
        break
      case 'text-end': {
        const blockText = (chunk.providerMetadata?.text?.value as string | undefined) ?? this.textBuffer
        if (blockText) {
          if (this.textBuffer) {
            this.totalText += blockText
            this.orderedContentSegments.push({ kind: 'text', text: blockText })
          }
        }
        this.textBuffer = ''
        break
      }
      case 'tool-input-start': {
        const toolCallId = this.getToolCallKey(chunk)
        if (toolCallId) {
          this.ensureToolEntry(toolCallId, chunk.toolName)
        }
        break
      }
      case 'tool-input-delta': {
        const toolCallId = this.getToolCallKey(chunk)
        if (toolCallId && typeof chunk.delta === 'string' && chunk.delta) {
          this.ensureToolEntry(toolCallId, chunk.toolName)
          const toolCall = this.toolCalls.get(toolCallId)!
          toolCall.partialArguments = (toolCall.partialArguments ?? '') + chunk.delta
        }
        break
      }
      case 'tool-call': {
        const toolCallId = this.getToolCallKey(chunk)
        if (toolCallId) {
          this.ensureToolEntry(toolCallId, chunk.toolName)
          const legacyPart = chunk as {
            args?: unknown
            providerMetadata?: { raw?: { input?: unknown } }
          }
          this.toolCalls.set(toolCallId, {
            ...this.toolCalls.get(toolCallId),
            input: chunk.input ?? legacyPart.args ?? legacyPart.providerMetadata?.raw?.input
          })
        }
        break
      }
      case 'tool-result': {
        const toolCallId = this.getToolCallKey(chunk)
        if (toolCallId) {
          this.ensureToolEntry(toolCallId, chunk.toolName)
          const legacyPart = chunk as {
            result?: unknown
            providerMetadata?: { raw?: unknown }
            rawOutput?: unknown
            truncated?: boolean
          }
          const inline = chunk.output ?? legacyPart.result ?? legacyPart.providerMetadata?.raw
          const raw = legacyPart.rawOutput ?? inline
          this.toolResults.set(toolCallId, {
            inline,
            raw,
            truncated: typeof legacyPart.truncated === 'boolean' ? legacyPart.truncated : raw !== inline,
            status: 'done'
          })
        }
        break
      }
      case 'tool-error': {
        const toolCallId = this.getToolCallKey(chunk)
        if (toolCallId) {
          this.ensureToolEntry(toolCallId, chunk.toolName)
          const legacyPart = chunk as {
            error?: unknown
            rawError?: unknown
            providerMetadata?: { raw?: unknown }
            truncated?: boolean
          }
          const inline = legacyPart.error ?? legacyPart.providerMetadata?.raw
          const raw = legacyPart.rawError ?? inline
          this.toolResults.set(toolCallId, {
            inline,
            raw,
            truncated: typeof legacyPart.truncated === 'boolean' ? legacyPart.truncated : raw !== inline,
            status: 'error'
          })
        }
        break
      }
      case 'raw': {
        const rawPart = chunk as {
          rawValue?: { type?: string; slash_commands?: unknown; data?: unknown }
        }
        const rawValue = rawPart.rawValue
        if (rawValue?.type === 'context_compaction') this.addCompaction(rawValue)
        if (rawValue?.type === 'token-telemetry' && isTokenTelemetry(rawValue.data)) {
          this.tokenTelemetry = mergeTokenTelemetry(this.tokenTelemetry, rawValue.data)
        }
        if (rawValue?.type === 'init' && Array.isArray(rawValue.slash_commands)) {
          this.initSlashCommands = rawValue.slash_commands.filter((cmd): cmd is string => typeof cmd === 'string')
        }
        break
      }
      case 'usage': {
        const usagePart = chunk as {
          usage?: {
            inputTokens?: number | null
            outputTokens?: number | null
            totalTokens?: number | null
          }
        }
        this.setPendingUsageFromSdk(usagePart.usage)
        break
      }
      case 'finish-step': {
        const finishStepPart = chunk as {
          usage?: {
            inputTokens?: number | null
            outputTokens?: number | null
            totalTokens?: number | null
          }
        }
        this.commitUsageFromSdk(finishStepPart.usage, true)
        break
      }
      case 'finish': {
        const finishPart = chunk as {
          totalUsage?: {
            inputTokens?: number | null
            outputTokens?: number | null
            totalTokens?: number | null
          }
        }
        this.commitUsageFromSdk(finishPart.totalUsage)
        break
      }
      default:
        break
    }
  }

  private static addUsage(base?: PersistedUsage, delta?: PersistedUsage): PersistedUsage | undefined {
    if (!base) return delta ? { ...delta } : undefined
    if (!delta) return { ...base }
    const baseCacheRead = Number(base.cache_read_input_tokens ?? 0) || 0
    const baseCacheWrite = Number(base.cache_creation_input_tokens ?? 0) || 0
    const deltaCacheRead = Number(delta.cache_read_input_tokens ?? 0) || 0
    const deltaCacheWrite = Number(delta.cache_creation_input_tokens ?? 0) || 0
    const cacheReadTokens = baseCacheRead + deltaCacheRead
    const cacheWriteTokens = baseCacheWrite + deltaCacheWrite
    return {
      prompt_tokens: base.prompt_tokens + delta.prompt_tokens,
      completion_tokens: base.completion_tokens + delta.completion_tokens,
      total_tokens: base.total_tokens + delta.total_tokens,
      cache_read_input_tokens: cacheReadTokens,
      cache_creation_input_tokens: cacheWriteTokens,
      prompt_tokens_details: {
        cached_tokens: cacheReadTokens,
        cache_creation_input_tokens: cacheWriteTokens,
        cache_write_tokens: cacheWriteTokens
      },
      input_tokens_details: {
        cached_tokens: cacheReadTokens,
        cache_creation_input_tokens: cacheWriteTokens,
        cache_write_tokens: cacheWriteTokens
      }
    }
  }

  private normalizeUsageFromSdk(usage?: {
    inputTokens?: number | null
    outputTokens?: number | null
    totalTokens?: number | null
    inputTokenDetails?: {
      cacheReadTokens?: number | null
      cacheWriteTokens?: number | null
    }
  }): PersistedUsage | undefined {
    if (!usage) {
      return undefined
    }

    const promptTokens = Number(usage.inputTokens ?? 0)
    const completionTokens = Number(usage.outputTokens ?? 0)
    const totalTokens = Number(usage.totalTokens ?? promptTokens + completionTokens)
    const cacheReadTokens = Number(usage.inputTokenDetails?.cacheReadTokens ?? 0) || 0
    const cacheWriteTokens = Number(usage.inputTokenDetails?.cacheWriteTokens ?? 0) || 0

    if (promptTokens <= 0 && completionTokens <= 0 && totalTokens <= 0) {
      return undefined
    }

    return {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
      cache_read_input_tokens: cacheReadTokens,
      cache_creation_input_tokens: cacheWriteTokens,
      prompt_tokens_details: {
        cached_tokens: cacheReadTokens,
        cache_creation_input_tokens: cacheWriteTokens,
        cache_write_tokens: cacheWriteTokens
      },
      input_tokens_details: {
        cached_tokens: cacheReadTokens,
        cache_creation_input_tokens: cacheWriteTokens,
        cache_write_tokens: cacheWriteTokens
      }
    }
  }

  private setPendingUsageFromSdk(usage?: {
    inputTokens?: number | null
    outputTokens?: number | null
    totalTokens?: number | null
    inputTokenDetails?: {
      cacheReadTokens?: number | null
      cacheWriteTokens?: number | null
    }
  }): void {
    const normalizedUsage = this.normalizeUsageFromSdk(usage)
    if (!normalizedUsage) {
      return
    }

    this.pendingUsage = normalizedUsage
  }

  private commitUsageFromSdk(usage?: {
    inputTokens?: number | null
    outputTokens?: number | null
    totalTokens?: number | null
    inputTokenDetails?: {
      cacheReadTokens?: number | null
      cacheWriteTokens?: number | null
    }
  }, distinctStep = false): void {
    const normalizedUsage = this.normalizeUsageFromSdk(usage) ?? this.pendingUsage
    if (!normalizedUsage) {
      return
    }

    const lastCommittedUsage = this.committedUsageSteps[this.committedUsageSteps.length - 1]
    if (!distinctStep && lastCommittedUsage && JSON.stringify(lastCommittedUsage) === JSON.stringify(normalizedUsage)) {
      this.pendingUsage = undefined
      return
    }

    this.committedUsageSteps.push({ ...normalizedUsage })
    this.committedUsage = TextStreamAccumulator.addUsage(this.committedUsage, normalizedUsage)
    this.pendingUsage = undefined
  }

  /** Settle display-only progress if the stream ends before its operation event. */
  settleCompactions(status: 'completed' | 'cancelled' | 'failed'): void {
    for (const event of this.compactions.values()) {
      if (event.phase !== 'start' && event.phase !== 'chunk') continue
      this.addCompaction({
        ...event,
        phase: status === 'cancelled' ? 'cancelled' : 'error',
        error: event.error ?? (status === 'cancelled'
          ? 'Context compaction was cancelled before completion.'
          : 'Context compaction was interrupted before completion.')
      })
    }
  }

  getText(): string {
    return (this.totalText + this.textBuffer).replace(/\n+$/, '')
  }

  getReasoningText(): string {
    return this.reasoningOrder
      .map((reasoningId) => (this.reasoningBlocks.get(reasoningId) || '').replace(/\n+$/, ''))
      .filter(Boolean)
      .join('\n\n')
  }

  getInitSlashCommands(): string[] {
    return [...this.initSlashCommands]
  }

  getTokenTelemetry(): TokenTelemetry | undefined {
    return this.tokenTelemetry ? structuredClone(this.tokenTelemetry) : undefined
  }

  getUsage(): PersistedUsage | undefined {
    return TextStreamAccumulator.addUsage(this.committedUsage, this.pendingUsage)
  }

  getUsageSteps(): PersistedUsage[] {
    return this.committedUsageSteps.map((usage) => ({ ...usage }))
  }

  summarizeState(): Record<string, unknown> {
    return {
      reasoningBlockCount: this.reasoningOrder.length,
      reasoningChars: this.getReasoningText().length,
      totalTextChars: this.totalText.length,
      textBufferChars: this.textBuffer.length,
      toolCallCount: this.toolCallOrder.length,
      toolResultCount: this.toolResults.size,
      slashCommandCount: this.initSlashCommands.length,
      hasUsage: Boolean(this.getUsage())
    }
  }

  getAssistantBlocks(messageId: string, modelId?: string): HeadlessPersistedBlock[] {
    const now = new Date().toISOString()
    const blocks: HeadlessPersistedBlock[] = []

    const reasoningText = this.getReasoningText()
    if (reasoningText) {
      blocks.push({
        id: randomUUID(),
        messageId,
        type: 'thinking',
        createdAt: now,
        updatedAt: now,
        status: 'success',
        modelId,
        content: reasoningText,
        thinking_millsec: 0
      })
    }

    const emittedToolBlocks = new Set<string>()
    for (const segment of this.orderedContentSegments) {
      if (segment.kind === 'text') {
        if (!segment.text) continue
        blocks.push({
          id: randomUUID(),
          messageId,
          type: 'main_text',
          createdAt: now,
          updatedAt: now,
          status: 'success',
          modelId,
          content: segment.text
        })
        continue
      }

      if (segment.kind === 'compact') {
        const compaction = this.compactions.get(segment.operationId)
        if (!compaction) continue
        const { type: _type, summary, ...contextCompaction } = compaction
        blocks.push({
          id: `${messageId}:context-compaction:${segment.operationId}`,
          messageId,
          type: 'compact',
          createdAt: now,
          updatedAt: now,
          status: contextCompaction.phase === 'complete' ? 'success'
            : contextCompaction.phase === 'error' ? 'error'
              : contextCompaction.phase === 'cancelled' ? 'paused' : 'processing',
          modelId,
          content: summary ?? '',
          compactedContent: '',
          metadata: { contextCompaction }
        })
        continue
      }

      const toolCall = this.toolCalls.get(segment.toolCallId)
      if (!toolCall) continue
      const toolInput = this.getToolInput(segment.toolCallId)
      const toolResult = this.toolResults.get(segment.toolCallId)
      const isToolError = toolResult?.status === 'error'
      emittedToolBlocks.add(segment.toolCallId)
      blocks.push({
        id: randomUUID(),
        messageId,
        type: 'tool',
        createdAt: now,
        updatedAt: now,
        status: isToolError ? 'error' : toolResult !== undefined ? 'success' : 'processing',
        model: modelId,
        toolId: segment.toolCallId,
        toolName: toolCall.toolName,
        arguments: toolInput && typeof toolInput === 'object' ? toolInput : undefined,
        partialArguments: toolCall.partialArguments,
        content: toolResult?.inline,
        ...(isToolError
          ? {
              error: {
                message: 'Tool execution failed/error',
                details: toolResult.inline,
                name: null,
                stack: null
              }
            }
          : {}),
        metadata: {
          rawMcpToolResponse: {
            id: segment.toolCallId,
            tool: {
              id: toolCall.toolName || segment.toolCallId,
              name: toolCall.toolName || segment.toolCallId
            },
            arguments:
              toolInput && typeof toolInput === 'object'
                ? toolInput
                : toolInput !== undefined
                  ? String(toolInput)
                  : undefined,
            partialArguments: toolCall.partialArguments,
            status: isToolError ? 'error' : toolResult !== undefined ? 'done' : 'pending',
            response: toolResult?.inline,
            responseRaw: toolResult?.raw,
            truncated: toolResult?.truncated ?? false
          }
        }
      })
    }

    for (const toolCallId of this.toolCallOrder) {
      if (emittedToolBlocks.has(toolCallId)) {
        continue
      }
      const toolCall = this.toolCalls.get(toolCallId)
      if (!toolCall) continue
      const toolInput = this.getToolInput(toolCallId)
      const toolResult = this.toolResults.get(toolCallId)
      const isToolError = toolResult?.status === 'error'
      blocks.push({
        id: randomUUID(),
        messageId,
        type: 'tool',
        createdAt: now,
        updatedAt: now,
        status: isToolError ? 'error' : toolResult !== undefined ? 'success' : 'processing',
        model: modelId,
        toolId: toolCallId,
        toolName: toolCall.toolName,
        arguments: toolInput && typeof toolInput === 'object' ? toolInput : undefined,
        partialArguments: toolCall.partialArguments,
        content: toolResult?.inline,
        ...(isToolError
          ? {
              error: {
                message: 'Tool execution failed/error',
                details: toolResult.inline,
                name: null,
                stack: null
              }
            }
          : {}),
        metadata: {
          rawMcpToolResponse: {
            id: toolCallId,
            tool: {
              id: toolCall.toolName || toolCallId,
              name: toolCall.toolName || toolCallId
            },
            arguments:
              toolInput && typeof toolInput === 'object'
                ? toolInput
                : toolInput !== undefined
                  ? String(toolInput)
                  : undefined,
            partialArguments: toolCall.partialArguments,
            status: isToolError ? 'error' : toolResult !== undefined ? 'done' : 'pending',
            response: toolResult?.inline,
            responseRaw: toolResult?.raw,
            truncated: toolResult?.truncated ?? false
          }
        }
      })
    }

    // Include the live tail without flushing so snapshot reads do not alter the stream.
    if (this.textBuffer) {
      blocks.push({
        id: randomUUID(),
        messageId,
        type: 'main_text',
        createdAt: now,
        updatedAt: now,
        status: 'success',
        modelId,
        content: this.textBuffer
      })
    }

    return blocks
  }
}
