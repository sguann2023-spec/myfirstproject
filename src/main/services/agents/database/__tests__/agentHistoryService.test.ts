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

  it('assigns stable fallback sequences after all canonical slots for cursor pagination', async () => {
    const hidden = entry('hidden', 1)
    hidden.message.semantics = { uiVisibility: 'hidden', transcriptVisibility: 'hidden' }
    const transcript = { listTranscript: vi.fn().mockResolvedValue([entry('canonical', 0), hidden]) }
    const legacy = { getSessionHistory: vi.fn().mockResolvedValue([
      { message: { id: 'legacy-b', createdAt: '2026-01-03', role: 'user' }, blocks: [] },
      { message: { id: 'legacy-a', createdAt: '2026-01-02', role: 'user' }, blocks: [] }
    ]) }
    const service = new AgentHistoryService(transcript as any, legacy as any)
    const firstPage = await service.getHistory('session-a', { afterSequence: -1, limit: 2 })
    expect(firstPage.messages.map((item) => item.message.id)).toEqual(['canonical', 'legacy-a'])
    expect(firstPage.sequences).toEqual([0, 2])
    expect(firstPage.nextAfterSequence).toBe(2)
    const secondPage = await service.getHistory('session-a', { afterSequence: 2, limit: 2 })
    expect(secondPage.messages.map((item) => item.message.id)).toEqual(['legacy-b'])
    expect(secondPage.sequences).toEqual([3])
  })

  it('falls back when canonical records are unavailable or corrupt and paginates by sequence', async () => {
    const transcript = { listTranscript: vi.fn().mockRejectedValue(new Error('corrupt')) }
    const legacy = { getSessionHistory: vi.fn().mockResolvedValue([
      { message: { id: 'b', createdAt: '2026-01-01', role: 'user' }, blocks: [] },
      { message: { id: 'a', createdAt: '2026-01-01', role: 'user' }, blocks: [] }
    ]) }
    const service = new AgentHistoryService(transcript as any, legacy as any)
    const result = await service.getHistory('session-a', { afterSequence: -1, limit: 1 })
    expect(result.messages[0]?.message.id).toBe('a')
    expect(result.hasMore).toBe(true)
    expect(result.nextAfterSequence).toBe(0)
  })
})
