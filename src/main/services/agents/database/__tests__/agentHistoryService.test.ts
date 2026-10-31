import { describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ warn: vi.fn(), info: vi.fn() }) }
}))
vi.mock('../repositories/agentTranscriptRepository', () => ({
  agentTranscriptRepository: { listTranscript: vi.fn() }
}))
vi.mock('../sessionMessageRepository', () => ({
  agentMessageRepository: { getSessionHistory: vi.fn() }
}))

import { canonicalEntryToPersisted, persistedToCanonicalInputs } from '../agentHistoryMapper'
import { AgentHistoryService } from '../agentHistoryService'
import type { AgentMessageWithParts } from '../repositories/agentTranscript.types'

const entry = (id: string, sequence: number, status: AgentMessageWithParts['message']['status'] = 'completed'): AgentMessageWithParts => ({
  message: {
    id,
    sessionId: 'session-a',
    sequence,
    role: sequence % 2 ? 'assistant' : 'user',
    status,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:01.000Z',
    error: status === 'failed' ? { message: 'boom' } : undefined
  },
  parts: [{
    id: `${id}-text`, sessionId: 'session-a', messageId: id, sequence: 0, type: 'text',
    data: { text: id }, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:01.000Z'
  }]
})

describe('agent history mapper', () => {
  it('restores canonical token fields in the format consumed by the footer', () => {
    const source = entry('usage', 1)
    source.message.usage = { inputTokens: 100, outputTokens: 50, totalTokens: 150, cacheReadTokens: 80, cacheWriteTokens: 10 }
    const mapped = canonicalEntryToPersisted(source)
    expect(mapped.message.usage).toMatchObject({
      prompt_tokens: 100, completion_tokens: 50, total_tokens: 150,
      cache_read_input_tokens: 80, cache_creation_input_tokens: 10
    })
    expect(mapped.blocks[0]).toMatchObject({ content: 'usage' })
    expect(source.message.usage).not.toHaveProperty('prompt_tokens')
  })

  it('preserves legacy usage fields including explicit zero and provider details', () => {
    const source = entry('legacy-usage', 1)
    source.message.usage = { prompt_tokens: 0, inputTokens: 100, completion_tokens: 50, total_tokens: 50, extra: 'provider' }
    expect(canonicalEntryToPersisted(source).message.usage).toMatchObject({
      prompt_tokens: 0, completion_tokens: 50, total_tokens: 50, extra: 'provider'
    })
  })

  it.each([
    ['completed', 'success', 'success'],
    ['streaming', 'processing', 'streaming'],
    ['cancelled', 'paused', 'paused'],
    ['failed', 'error', 'error'],
    ['interrupted', 'error', 'error']
  ] as const)('maps canonical %s lifecycle to legacy UI state', (canonical, messageStatus, blockStatus) => {
    const mapped = canonicalEntryToPersisted(entry('assistant', 1, canonical))
    expect(mapped.message.status).toBe(messageStatus)
    expect(mapped.blocks[0]?.status).toBe(blockStatus)
    expect((mapped.message as any).canonicalStatus).toBe(canonical)
  })

  it('maps a legacy payload back into canonical message and parts', () => {
    const mapped = persistedToCanonicalInputs('session-a', {
      message: {
        id: 'legacy-1', role: 'assistant', assistantId: 'agent', topicId: 'agent-session:session-a',
        createdAt: '2026-01-01T00:00:00.000Z', status: 'paused', aborted: true, blocks: ['block-1']
      } as any,
      blocks: [{
        id: 'block-1', messageId: 'legacy-1', type: 'main_text', createdAt: '2026-01-01T00:00:00.000Z',
        status: 'paused', content: 'partial'
      } as any]
    })
    expect(mapped?.message.status).toBe('cancelled')
    expect(mapped?.parts[0]).toMatchObject({ id: 'block-1', type: 'text', data: { text: 'partial' } })
  })
})

describe('AgentHistoryService', () => {
  it('returns usable tokens from canonical history even when the legacy ID is deduplicated', async () => {
    const source = entry('same-usage', 1)
    source.message.usage = { inputTokens: 100, outputTokens: 50, totalTokens: 150 }
    const transcript = { listTranscript: vi.fn().mockResolvedValue([source]) }
    const legacy = { getSessionHistory: vi.fn().mockResolvedValue([
      { message: { id: 'same-usage', role: 'assistant' }, blocks: [] }
    ]) }
    const result = await new AgentHistoryService(transcript as any, legacy as any).getHistory('session-a')
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0].message.usage).toMatchObject({ prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 })
  })

  it('queries canonical and legacy current readers without a snapshot prefix', async () => {
    const transcript = {
      listTranscript: vi.fn().mockResolvedValue([entry('canonical', 0)])
    }
    const legacy = { getSessionHistory: vi.fn().mockResolvedValue([]) }
    const result = await new AgentHistoryService(transcript as any, legacy as any).getHistory('session-a')
    expect(transcript.listTranscript).toHaveBeenCalledExactlyOnceWith('session-a')
    expect(legacy.getSessionHistory).toHaveBeenCalledExactlyOnceWith('session-a')
    expect(result.messages.map(item => item.message.id)).toEqual(['canonical'])
  })

  it('uses canonical ordering, appends legacy-only fallback, and deduplicates IDs', async () => {
    const transcript = { listTranscript: vi.fn().mockResolvedValue([entry('same', 0), entry('canonical', 1)]) }
    const legacy = { getSessionHistory: vi.fn().mockResolvedValue([
      { message: { id: 'same', createdAt: '2025-01-01', role: 'user' }, blocks: [] },
      { message: { id: 'legacy-only', createdAt: '2026-01-02', role: 'user' }, blocks: [] }
    ]) }
    const service = new AgentHistoryService(transcript as any, legacy as any)
    const result = await service.getHistory('session-a')
    expect(result.messages.map((item) => item.message.id)).toEqual(['same', 'canonical', 'legacy-only'])
  })

  it('does not resurrect a tombstoned canonical message from the legacy fallback', async () => {
    const hidden = entry('deleted', 0)
    hidden.message.semantics = { uiVisibility: 'hidden', transcriptVisibility: 'hidden', tombstone: true }
    const transcript = { listTranscript: vi.fn().mockResolvedValue([hidden, entry('visible', 1)]) }
    const legacy = { getSessionHistory: vi.fn().mockResolvedValue([
      { message: { id: 'deleted', createdAt: '2026-01-01', role: 'user' }, blocks: [] },
      { message: { id: 'legacy-only', createdAt: '2026-01-02', role: 'user' }, blocks: [] }
    ]) }
    const service = new AgentHistoryService(transcript as any, legacy as any)
    const result = await service.getHistory('session-a')
    expect(result.messages.map((item) => item.message.id)).toEqual(['visible', 'legacy-only'])
  })

  it('reserves hidden slots while assigning fallback pagination cursors', async () => {
    const hidden = entry('hidden', 1)
    hidden.message.semantics = { uiVisibility: 'hidden', transcriptVisibility: 'hidden' }
    const transcript = { listTranscript: vi.fn().mockResolvedValue([entry('canonical', 0), hidden]) }
    const legacy = { getSessionHistory: vi.fn().mockResolvedValue([
      { message: { id: 'legacy-a', createdAt: '2026-01-02', role: 'user' }, blocks: [] },
      { message: { id: 'legacy-b', createdAt: '2026-01-03', role: 'user' }, blocks: [] }
    ]) }
    const service = new AgentHistoryService(transcript as any, legacy as any)
    const firstPage = await service.getHistory('session-a', { afterSequence: -1, limit: 2 })
    expect(firstPage.messages.map((item) => item.message.id)).toEqual(['canonical', 'legacy-a'])
    const base = firstPage.sequences[0]
    expect(firstPage.sequences).toEqual([base, base + 2])
    expect(firstPage.nextAfterSequence).toBe(base + 2)
    const secondPage = await service.getHistory('session-a', { afterSequence: firstPage.nextAfterSequence, limit: 2 })
    expect(secondPage.messages.map((item) => item.message.id)).toEqual(['legacy-b'])
    expect(secondPage.sequences).toEqual([base + 3])
  })

  it('falls back when canonical records are unavailable or corrupt and paginates by sequence', async () => {
    const transcript = { listTranscript: vi.fn().mockRejectedValue(new Error('corrupt')) }
    const legacy = { getSessionHistory: vi.fn().mockResolvedValue([
      { message: { id: 'b', createdAt: '2026-01-01', role: 'user' }, blocks: [] },
      { message: { id: 'a', createdAt: '2026-01-01', role: 'user' }, blocks: [] }
    ]) }
    const service = new AgentHistoryService(transcript as any, legacy as any)
    const result = await service.getHistory('session-a', { afterSequence: -1, limit: 1 })
    expect(result.messages[0]?.message.id).toBe('b')
    expect(result.hasMore).toBe(true)
    expect(result.nextAfterSequence).toBe(result.sequences[0])
  })

  it('keeps legacy row order for equal or missing times instead of sorting logical IDs', async () => {
    const transcript = { listTranscript: vi.fn().mockResolvedValue([]) }
    const legacy = { getSessionHistory: vi.fn().mockResolvedValue([
      { message: { id: 'z-user', role: 'user' }, blocks: [] },
      { message: { id: 'a-assistant', role: 'assistant' }, blocks: [] }
    ]) }
    const result = await new AgentHistoryService(transcript as any, legacy as any).getHistory('session-a')
    expect(result.messages.map(item => item.message.id)).toEqual(['z-user', 'a-assistant'])
  })

  it('places a legacy question before its canonical answer and paginates without omissions', async () => {
    const answer = entry('answer', 0)
    answer.message.role = 'assistant'
    answer.message.parentMessageId = 'question'
    const transcript = { listTranscript: vi.fn().mockResolvedValue([answer]) }
    const legacy = { getSessionHistory: vi.fn().mockResolvedValue([
      { message: { id: 'question', role: 'user', createdAt: answer.message.createdAt }, blocks: [] },
      { message: { id: 'answer', role: 'assistant', createdAt: answer.message.createdAt }, blocks: [] }
    ]) }
    const service = new AgentHistoryService(transcript as any, legacy as any)
    const first = await service.getHistory('session-a', { limit: 1 })
    const second = await service.getHistory('session-a', { afterSequence: first.nextAfterSequence, limit: 1 })
    expect([...first.messages, ...second.messages].map(item => item.message.id)).toEqual(['question', 'answer'])
    expect(second.hasMore).toBe(false)
  })

  it('awaits lazy migration on opening history and reloads the canonical result', async () => {
    const transcript = {
      listTranscript: vi.fn().mockResolvedValueOnce([]).mockResolvedValue([entry('user', 0), entry('assistant', 1)]),
      migrateLegacyHistory: vi.fn().mockResolvedValue(undefined)
    }
    const payloads = [
      { message: { id: 'user', role: 'user' }, blocks: [] },
      { message: { id: 'assistant', role: 'assistant' }, blocks: [] }
    ]
    const legacy = { getSessionHistory: vi.fn().mockResolvedValue(payloads) }
    const result = await new AgentHistoryService(transcript as any, legacy as any).getHistory('session-a')
    expect(transcript.migrateLegacyHistory).toHaveBeenCalledWith('session-a')
    expect(transcript.listTranscript).toHaveBeenCalledTimes(2)
    expect(result.messages.map(item => item.message.id)).toEqual(['user', 'assistant'])
  })

  it('preserves ordered history and retries when lazy migration fails', async () => {
    const transcript = {
      listTranscript: vi.fn().mockResolvedValue([]),
      migrateLegacyHistory: vi.fn().mockRejectedValue(new Error('write failed'))
    }
    const legacy = { getSessionHistory: vi.fn().mockResolvedValue([
      { message: { id: 'z-user', role: 'user' }, blocks: [] },
      { message: { id: 'a-answer', role: 'assistant' }, blocks: [] }
    ]) }
    const service = new AgentHistoryService(transcript as any, legacy as any)
    for (let index = 0; index < 2; index++) {
      expect((await service.getHistory('session-a')).messages.map(item => item.message.id)).toEqual(['z-user', 'a-answer'])
    }
    expect(transcript.migrateLegacyHistory).toHaveBeenCalledTimes(2)
  })

  it('keeps full legacy text visible if canonical migration stopped before writing parts', async () => {
    const partial = entry('question', 0)
    partial.message.semantics = { origin: 'legacy_open_migration', legacyHistoryComplete: false }
    partial.parts = []
    const transcript = {
      listTranscript: vi.fn().mockResolvedValue([partial]),
      migrateLegacyHistory: vi.fn().mockRejectedValue(new Error('part write failed'))
    }
    const legacy = { getSessionHistory: vi.fn().mockResolvedValue([
      { message: { id: 'question', role: 'user' }, blocks: [{ id: 'text', type: 'main_text', content: 'complete old text' }] }
    ]) }
    const result = await new AgentHistoryService(transcript as any, legacy as any).getHistory('session-a')
    expect(result.messages[0].blocks[0]).toMatchObject({ content: 'complete old text' })
  })

  it('keeps fallback cursor slots after a previously read message is removed', async () => {
    const transcript = { listTranscript: vi.fn().mockResolvedValue([]) }
    const messages = ['a', 'b', 'c'].map(id => ({ message: { id, role: 'user' }, blocks: [] }))
    const legacy = { getSessionHistory: vi.fn().mockResolvedValueOnce(messages).mockResolvedValue(messages.slice(1)) }
    const service = new AgentHistoryService(transcript as any, legacy as any)
    const first = await service.getHistory('session-a', { limit: 1 })
    const second = await service.getHistory('session-a', { afterSequence: first.nextAfterSequence, limit: 1 })
    expect(second.messages.map(item => item.message.id)).toEqual(['b'])
    expect(second.nextAfterSequence).toBe(first.nextAfterSequence! + 1)
  })

  it('repairs canonical parent order with only one legacy anchor without forming a cycle', async () => {
    const answer = entry('answer', 0)
    answer.message.parentMessageId = 'question'
    answer.message.role = 'assistant'
    const question = entry('question', 1)
    question.message.role = 'user'
    const transcript = { listTranscript: vi.fn().mockResolvedValue([answer, question]) }
    const legacy = { getSessionHistory: vi.fn().mockResolvedValue([
      { message: { id: 'question', role: 'user' }, blocks: [] }
    ]) }
    const result = await new AgentHistoryService(transcript as any, legacy as any).getHistory('session-a')
    expect(result.messages.map(item => item.message.id)).toEqual(['question', 'answer'])
  })

  it('keeps separate fallback cursors when another reader refreshes canonical history', async () => {
    const transcript = { listTranscript: vi.fn().mockResolvedValue([]) }
    const legacy = { getSessionHistory: vi.fn().mockResolvedValue([
      { message: { id: 'a', role: 'user' }, blocks: [] },
      { message: { id: 'b', role: 'assistant' }, blocks: [] }
    ]) }
    const service = new AgentHistoryService(transcript as any, legacy as any)
    const first = await service.getHistory('session-a', { limit: 1 })
    transcript.listTranscript.mockResolvedValue([entry('a', 5), entry('b', 6)])
    await service.getHistory('session-a', { limit: 1 })
    const next = await service.getHistory('session-a', { afterSequence: first.nextAfterSequence, limit: 1 })
    expect(next.messages.map(item => item.message.id)).toEqual(['b'])
  })
})
