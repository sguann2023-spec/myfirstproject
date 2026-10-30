import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ChunkType, type Chunk } from '../../../types/chunk'
import { AiSdkToChunkAdapter } from '../AiSdkToChunkAdapter'

vi.mock('@renderer/services/KnowledgeService', () => ({ processKnowledgeReferences: vi.fn() }))
vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ silly: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) } }))

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

 describe('tool terminal ordering', () => {
  it.each(['tool-result', 'tool-error'])('retains %s before start and ignores duplicate starts/results', (type) => {
    const { emitted, emit } = createAdapterHarness()
    const id = `out-of-order-${type}`
    emit({ type, toolCallId: id, toolName: 'Bash', input: {}, output: 'ok', error: 'failed' })
    emit({ type: 'tool-input-start', id, toolName: 'Bash' })
    emit({ type: 'tool-call', toolCallId: id, toolName: 'Bash', input: {} })
    emit({ type, toolCallId: id, toolName: 'Bash', output: 'duplicate', error: 'duplicate' })
    const tools = emitted.filter(c => c.type === ChunkType.MCP_TOOL_COMPLETE || c.type === ChunkType.MCP_TOOL_PENDING || c.type === ChunkType.MCP_TOOL_STREAMING)
    expect(tools).toHaveLength(1)
    expect(tools[0]).toMatchObject({ responses: [{ status: type === 'tool-result' ? 'done' : 'error' }] })
  })
 })

 describe('stream cleanup', () => {
  it.each([false, true])('finalizes only unfinished calls at end (abort=%s)', async (aborted) => {
    const emitted: Chunk[] = []
    const adapter = new AiSdkToChunkAdapter(chunk => emitted.push(chunk), [])
    const chunks = [
      { type: 'tool-call', toolCallId: 'finished', toolName: 'Bash', input: {} },
      { type: 'tool-result', toolCallId: 'finished', toolName: 'Bash', output: 'ok' },
      { type: 'tool-call', toolCallId: 'unfinished', toolName: 'Bash', input: {} },
      ...(aborted ? [{ type: 'abort' }] : [])
    ]
    await adapter.processStream({ fullStream: new ReadableStream({ start(controller) { chunks.forEach(chunk => controller.enqueue(chunk)); controller.close() } }) })
    const complete = emitted.filter(c => c.type === ChunkType.MCP_TOOL_COMPLETE)
    expect(complete).toHaveLength(2)
    expect(complete[0]).toMatchObject({ responses: [{ status: 'done' }] })
    expect(complete[1]).toMatchObject({ responses: [{ status: aborted ? 'cancelled' : 'error' }] })
  })
 })

 it('does not finalize a slow parallel tool when a later tool completes or watchdog fires', () => {
  vi.useFakeTimers()
  const { emitted, emit } = createAdapterHarness()
  emit({ type: 'tool-call', toolCallId: 'slow-parallel', toolName: 'Bash', input: {} })
  emit({ type: 'tool-call', toolCallId: 'fast-parallel', toolName: 'Read', input: {} })
  emit({ type: 'tool-result', toolCallId: 'fast-parallel', toolName: 'Read', output: 'ok' })
  vi.advanceTimersByTime(60000)
  expect(emitted.filter(c => c.type === ChunkType.MCP_TOOL_COMPLETE)).toHaveLength(1)
  emit({ type: 'tool-result', toolCallId: 'slow-parallel', toolName: 'Bash', output: 'done' })
  expect(emitted.filter(c => c.type === ChunkType.MCP_TOOL_COMPLETE)).toHaveLength(2)
  vi.useRealTimers()
 })

 it('isolates identical tool IDs in separate source streams', () => {
  const first = createAdapterHarness()
  const second = createAdapterHarness()
  for (const harness of [first, second]) harness.emit({ type: 'tool-call', toolCallId: 'shared-id', toolName: 'Bash', input: {} })
  first.emit({ type: 'tool-result', toolCallId: 'shared-id', toolName: 'Bash', output: 'first' })
  second.emit({ type: 'tool-error', toolCallId: 'shared-id', toolName: 'Bash', error: 'second' })
  expect(first.emitted.filter(c => c.type === ChunkType.MCP_TOOL_COMPLETE)).toMatchObject([{ responses: [{ status: 'done' }] }])
  expect(second.emitted.filter(c => c.type === ChunkType.MCP_TOOL_COMPLETE)).toMatchObject([{ responses: [{ status: 'error' }] }])
 })
