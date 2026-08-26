import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ChunkType, type Chunk } from '../../../types/chunk'
import { AiSdkToChunkAdapter } from '../AiSdkToChunkAdapter'

type AdapterState = {
  text: string
  reasoningContent: string
  webSearchResults: unknown[]
  reasoningId: string
  providerMetadata: undefined
}

const createAdapterHarness = () => {
  const emitted: Chunk[] = []
  const adapter = new AiSdkToChunkAdapter((chunk) => emitted.push(chunk), [])
  const state: AdapterState = {
    text: '',
    reasoningContent: '',
    webSearchResults: [],
    reasoningId: '',
    providerMetadata: undefined
  }

  const emit = (chunk: unknown) => {
    ;(adapter as any).convertAndEmitChunk(chunk, state)
  }

  return { emitted, emit, state }
}

describe('AiSdkToChunkAdapter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('completes thinking before tool input starts', () => {
    const { emitted, emit, state } = createAdapterHarness()

    emit({ type: 'reasoning-start', id: 'reasoning-1' })
    emit({ type: 'reasoning-delta', text: '先想一下' })
    emit({ type: 'tool-input-start', id: 'tool-1', toolName: 'builtin_read' })

    expect(emitted.map((chunk) => chunk.type)).toEqual([
      ChunkType.THINKING_START,
      ChunkType.THINKING_DELTA,
      ChunkType.THINKING_COMPLETE,
      ChunkType.MCP_TOOL_STREAMING
    ])
    expect(emitted[2]).toMatchObject({
      type: ChunkType.THINKING_COMPLETE,
      text: '先想一下'
    })
    expect(state.reasoningContent).toBe('')
    expect(state.reasoningId).toBe('')
  })

  it('completes thinking on tool call even when no reasoning delta arrived', () => {
    const { emitted, emit, state } = createAdapterHarness()

    emit({ type: 'reasoning-start', id: 'reasoning-2' })
    emit({
      type: 'tool-call',
      toolCallId: 'tool-2',
      toolName: 'builtin_read',
      input: { path: '/tmp/demo.txt' }
    })

    expect(emitted.map((chunk) => chunk.type)).toEqual([
      ChunkType.THINKING_START,
      ChunkType.THINKING_COMPLETE,
      ChunkType.MCP_TOOL_PENDING
    ])
    expect(emitted[1]).toMatchObject({
      type: ChunkType.THINKING_COMPLETE,
      text: ''
    })
    expect(state.reasoningContent).toBe('')
    expect(state.reasoningId).toBe('')
  })
})
