import { randomUUID } from 'node:crypto'

import type { TextStreamPart } from 'ai'

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
}

export class TextStreamAccumulator {
  private readonly orderedContentSegments: Array<{ kind: 'text'; text: string } | { kind: 'tool'; toolCallId: string }> =
    []
  private textBuffer = ''
  private totalText = ''
  private currentReasoningId: string | null = null
  private readonly reasoningBlocks = new Map<string, string>()
  private readonly reasoningOrder: string[] = []
  private readonly toolCalls = new Map<string, { toolName?: string; input?: unknown }>()
  private readonly toolResults = new Map<
    string,
    {
      inline: unknown
      raw: unknown
      truncated: boolean
    }
  >()
  private readonly toolCallOrder: string[] = []
  private initSlashCommands: string[] = []
  private latestUsage?: PersistedUsage

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
        toolName: existing?.toolName ?? toolName,
        input: existing?.input
      })
    }
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
      case 'tool-call': {
        const toolCallId = this.getToolCallKey(chunk)
        if (toolCallId) {
          this.ensureToolEntry(toolCallId, chunk.toolName)
          const legacyPart = chunk as {
            args?: unknown
            providerMetadata?: { raw?: { input?: unknown } }
          }
          this.toolCalls.set(toolCallId, {
            toolName: chunk.toolName,
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
          }
          const inline = chunk.output ?? legacyPart.result ?? legacyPart.providerMetadata?.raw
          const raw = legacyPart.rawOutput ?? inline
          this.toolResults.set(toolCallId, {
            inline,
            raw,
            truncated: raw !== inline
          })
        }
        break
      }
      case 'raw': {
        const rawPart = chunk as {
          rawValue?: { type?: string; slash_commands?: unknown }
        }
        const rawValue = rawPart.rawValue
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
        this.setUsageFromSdk(usagePart.usage)
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
        this.setUsageFromSdk(finishPart.totalUsage)
        break
      }
      default:
        break
    }
  }

  private setUsageFromSdk(usage?: {
    inputTokens?: number | null
    outputTokens?: number | null
    totalTokens?: number | null
  }): void {
    if (!usage) {
      return
    }

    const promptTokens = Number(usage.inputTokens ?? 0)
    const completionTokens = Number(usage.outputTokens ?? 0)
    const totalTokens = Number(usage.totalTokens ?? promptTokens + completionTokens)

    if (promptTokens <= 0 && completionTokens <= 0 && totalTokens <= 0) {
      return
    }

    this.latestUsage = {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens
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

  getUsage(): PersistedUsage | undefined {
    return this.latestUsage ? { ...this.latestUsage } : undefined
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
      hasUsage: Boolean(this.latestUsage)
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

    const text = this.getText()
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

      const toolCall = this.toolCalls.get(segment.toolCallId)
      if (!toolCall) continue
      const toolResult = this.toolResults.get(segment.toolCallId)
      emittedToolBlocks.add(segment.toolCallId)
      blocks.push({
        id: randomUUID(),
        messageId,
        type: 'tool',
        createdAt: now,
        updatedAt: now,
        status: toolResult !== undefined ? 'success' : 'processing',
        model: modelId,
        toolId: segment.toolCallId,
        toolName: toolCall.toolName,
        arguments: toolCall.input && typeof toolCall.input === 'object' ? toolCall.input : undefined,
        content: toolResult?.inline,
        metadata: {
          rawMcpToolResponse: {
            id: segment.toolCallId,
            tool: {
              id: toolCall.toolName || segment.toolCallId,
              name: toolCall.toolName || segment.toolCallId
            },
            arguments:
              toolCall.input && typeof toolCall.input === 'object'
                ? toolCall.input
                : toolCall.input !== undefined
                  ? String(toolCall.input)
                  : undefined,
            status: toolResult !== undefined ? 'done' : 'pending',
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
      const toolResult = this.toolResults.get(toolCallId)
      blocks.push({
        id: randomUUID(),
        messageId,
        type: 'tool',
        createdAt: now,
        updatedAt: now,
        status: toolResult !== undefined ? 'success' : 'processing',
        model: modelId,
        toolId: toolCallId,
        toolName: toolCall.toolName,
        arguments: toolCall.input && typeof toolCall.input === 'object' ? toolCall.input : undefined,
        content: toolResult?.inline,
        metadata: {
          rawMcpToolResponse: {
            id: toolCallId,
            tool: {
              id: toolCall.toolName || toolCallId,
              name: toolCall.toolName || toolCallId
            },
            arguments:
              toolCall.input && typeof toolCall.input === 'object'
                ? toolCall.input
                : toolCall.input !== undefined
                  ? String(toolCall.input)
                  : undefined,
            status: toolResult !== undefined ? 'done' : 'pending',
            response: toolResult?.inline,
            responseRaw: toolResult?.raw,
            truncated: toolResult?.truncated ?? false
          }
        }
      })
    }

    if (!this.orderedContentSegments.length && text) {
      blocks.push({
        id: randomUUID(),
        messageId,
        type: 'main_text',
        createdAt: now,
        updatedAt: now,
        status: 'success',
        modelId,
        content: text
      })
    }

    return blocks
  }
}
