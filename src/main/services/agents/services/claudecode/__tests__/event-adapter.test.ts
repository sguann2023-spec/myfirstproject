import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

import type { AgentStream } from '../../../interfaces/AgentStreamInterface'
import type { ClaudeCodeHarnessAdapter } from '../harness/create-harness'
import { emitChunk, emitError, emitLifecycleEvent } from '../harness/event-adapter'

vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ warn: vi.fn() }) } }))

describe('turn-level projection events', () => {
  it('delivers all chunks without adding durable projection events', () => {
    const stream = new EventEmitter() as AgentStream
    const received = vi.fn()
    stream.on('data', received)
    const recordProjectionEvent = vi.fn()
    const harness = {
      enabled: true,
      recordProjectionEvent,
      invokeContext: { runtime: { traceId: 'trace' }, projection: { topicId: 'topic' } }
    } as unknown as ClaudeCodeHarnessAdapter

    for (let index = 0; index < 2000; index++) {
      emitChunk(stream, { type: 'text-delta', id: 'text', text: 'x' }, harness)
      emitChunk(stream, { type: 'reasoning-delta', id: 'thinking', text: 'x' }, harness)
      emitChunk(stream, { type: 'tool-input-delta', id: 'tool', delta: 'x' }, harness)
    }
    expect(received).toHaveBeenCalledTimes(6000)
    expect(recordProjectionEvent).not.toHaveBeenCalled()

    emitLifecycleEvent(stream, 'complete', harness)
    expect(recordProjectionEvent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      kind: 'lifecycle', streamEventType: 'complete'
    }))
    recordProjectionEvent.mockClear()
    emitError(stream, new Error('provider failed'), harness)
    expect(recordProjectionEvent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      kind: 'error', errorMessage: 'provider failed'
    }))
  })
})
