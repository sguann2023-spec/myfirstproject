import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ root: '', rows: [] as any[], parts: [] as any[] }))
vi.mock('@main/utils', () => ({ getDataPath: () => state.root }))
vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ warn: vi.fn() }) } }))
vi.mock('../../messageEventStore', () => ({ readMessageProjection: vi.fn() }))
vi.mock('../../../BaseService', () => ({ BaseService: class {
  async getDatabase() { return {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    insert: () => ({ values: (value: any) => { state.rows.push(value); return { returning: async () => [{ id: 1, ...value }] } } })
  } }
} }))
vi.mock('../agentTranscriptRepository', () => ({ agentTranscriptRepository: {
  upsertMessage: vi.fn(), listMessageParts: async () => [], upsertParts: async (parts: any[]) => { state.parts.push(...parts) }
} }))
import { agentMessageRepository } from '../../sessionMessageRepository'
it('serializes only offloaded copies and shares them with canonical dual write', async () => {
  state.root = await mkdtemp(path.join(os.tmpdir(), 'legacy-media-'))
  try {
    const media = { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }
    const payload = { message: { id: 'message', role: 'user' }, blocks: [{ id: 'block', ...media, raw: JSON.stringify(media) }] }
    const original = JSON.stringify(payload)
    await agentMessageRepository.persistUserMessage({ sessionId: 'session', payload: payload as any, metadata: { copy: media } })
    expect(JSON.stringify(state.rows)).not.toContain('aGVsbG8=')
    expect(JSON.stringify(state.parts)).not.toContain('aGVsbG8=')
    expect(JSON.stringify(state.rows)).toContain('history-media')
    expect(JSON.stringify(state.parts)).toContain('history-media')
    expect(JSON.stringify(payload)).toBe(original)
  } finally { await rm(state.root, { recursive: true, force: true }) }
})
