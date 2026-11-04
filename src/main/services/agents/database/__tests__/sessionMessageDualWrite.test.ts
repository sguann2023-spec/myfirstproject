import { readFile } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { createClient, type Client } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as schema from '../schema'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), silly: vi.fn() })
  }
}))

vi.mock('@main/apiServer/services/mcp', () => ({
  mcpApiService: { getServerInfo: vi.fn() }
}))

vi.mock('@main/apiServer/utils', () => ({
  validateModelId: vi.fn(),
  ModelValidationError: class ModelValidationError extends Error {}
}))

vi.mock('@main/utils', () => ({
  getDataPath: vi.fn(() => '/tmp/data')
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/dual-write-user-data' }
}))

vi.mock('@main/constant', () => ({ isDev: false }))

vi.mock('../../BaseService', () => ({
  BaseService: class BaseService {
    async getDatabase(): Promise<never> {
      throw new Error('getDatabase must be shadowed by the test')
    }
  }
}))

vi.mock('../DatabaseManager', () => ({
  DatabaseManager: class DatabaseManager {
    static async getInstance(): Promise<never> {
      throw new Error('DatabaseManager must not be used by this test')
    }
  }
}))

const createSchemaSql = `
  PRAGMA foreign_keys = ON;
  CREATE TABLE sessions (id TEXT PRIMARY KEY NOT NULL);
  CREATE TABLE session_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    agent_session_id TEXT DEFAULT '',
    metadata TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );
  CREATE TABLE agent_messages (
    id TEXT PRIMARY KEY NOT NULL,
    session_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    turn_id TEXT,
    parent_message_id TEXT,
    role TEXT NOT NULL,
    status TEXT NOT NULL,
    semantics_json TEXT,
    provider_json TEXT,
    usage_json TEXT,
    error_json TEXT,
    finish_json TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_message_id) REFERENCES agent_messages(id) ON DELETE SET NULL
  );
  CREATE TABLE agent_message_parts (
    id TEXT PRIMARY KEY NOT NULL,
    session_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    type TEXT NOT NULL,
    data_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id, message_id) REFERENCES agent_messages(session_id, id) ON DELETE CASCADE
  );
  CREATE UNIQUE INDEX uq_agent_messages_session_sequence ON agent_messages (session_id, sequence);
  CREATE UNIQUE INDEX uq_agent_messages_session_id ON agent_messages (session_id, id);
  CREATE UNIQUE INDEX uq_agent_message_parts_message_sequence ON agent_message_parts (message_id, sequence);
  CREATE UNIQUE INDEX uq_agent_message_parts_message_id ON agent_message_parts (message_id, id);
`

describe('agentMessageRepository dual-write part dedupe', () => {
  let client: Client
  let db: any
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'dual-write-test-'))
    client = createClient({ url: `file:${path.join(dir, 'test.db')}` })
    await client.executeMultiple(createSchemaSql)
    await client.executeMultiple(await readFile(path.resolve('resources/database/drizzle/0013_append_only_messages.sql'), 'utf8'))
    await client.executeMultiple(await readFile(path.resolve('resources/database/drizzle/0014_event_command_views.sql'), 'utf8'))
    await client.execute("INSERT INTO sessions (id) VALUES ('session-1')")
    db = drizzle(client, { schema })

    const { agentTranscriptRepository } = await import('../repositories/agentTranscriptRepository')
    // Bind the singletons to the per-test database instead of DatabaseManager.
    ;(agentTranscriptRepository as any).database = async () => db

    await agentTranscriptRepository.upsertMessages([
      {
        id: 'user-1',
        sessionId: 'session-1',
        turnId: 'turn-1',
        role: 'user',
        status: 'completed',
        createdAt: '2026-01-01T00:00:00.000Z'
      }
    ])
    await agentTranscriptRepository.upsertParts([
      {
        id: 'part-turnstart-text',
        sessionId: 'session-1',
        messageId: 'user-1',
        type: 'text',
        data: { text: '执行的怎么样了' },
        createdAt: '2026-01-01T00:00:00.000Z'
      }
    ])
  })

  afterEach(async () => {
    client.close()
    await rm(dir, { recursive: true, force: true })
  })

  it.each([undefined, null, {}])('does not manufacture an error on successful digital-human exchange (error=%j)', async (error) => {
    const { agentMessageRepository } = await import('../sessionMessageRepository')
    const { agentTranscriptRepository } = await import('../repositories/agentTranscriptRepository')
    const { canonicalEntryToPersisted } = await import('../agentHistoryMapper')
    ;(agentMessageRepository as any).getDatabase = async () => db
    const payload = {
      message: { id: 'digital-human-success', role: 'assistant', status: 'success', error,
        createdAt: '2026-01-01T00:00:01.000Z', blocks: ['digital-human-tool', 'digital-human-text'] },
      blocks: [
        { id: 'digital-human-tool', messageId: 'digital-human-success', type: 'tool', status: 'success',
          toolName: 'create_omni_image_driven_digital_human', response: { video_url: 'https://example.com/avatar.mp4' } },
        { id: 'digital-human-text', messageId: 'digital-human-success', type: 'main_text', status: 'success', content: '视频生成成功' }
      ]
    } as any
    await agentMessageRepository.persistExchange({
      sessionId: 'session-1', agentSessionId: 'session-1', assistant: { payload }
    })
    const stored = await client.execute("SELECT status, error_json FROM agent_messages WHERE id = 'digital-human-success'")
    expect(stored.rows[0]).toMatchObject({ status: 'completed', error_json: null })
    const transcript = await agentTranscriptRepository.listTranscript('session-1')
    const hydrated = canonicalEntryToPersisted(transcript.find((item) => item.message.id === 'digital-human-success')!)
    expect(hydrated.message.status).toBe('success')
    expect(hydrated.message.error).toBeUndefined()
    expect(hydrated.blocks).toHaveLength(2)
    expect(hydrated.blocks.every((block: any) => !block.error && block.status === 'success')).toBe(true)
  })

  it('preserves real failure details across exchange persistence and canonical hydration', async () => {
    const { agentMessageRepository } = await import('../sessionMessageRepository')
    const { agentTranscriptRepository } = await import('../repositories/agentTranscriptRepository')
    const { canonicalEntryToPersisted } = await import('../agentHistoryMapper')
    ;(agentMessageRepository as any).getDatabase = async () => db
    const error = { message: 'Avatar provider failed', code: 'PROVIDER_ERROR' }
    await agentMessageRepository.persistExchange({
      sessionId: 'session-1', agentSessionId: 'session-1', assistant: { payload: {
        message: { id: 'digital-human-failure', role: 'assistant', status: 'error', error,
          createdAt: '2026-01-01T00:00:01.000Z', blocks: [] }, blocks: []
      } as any }
    })
    const transcript = await agentTranscriptRepository.listTranscript('session-1')
    const hydrated = canonicalEntryToPersisted(transcript.find((item) => item.message.id === 'digital-human-failure')!)
    expect(hydrated.message.status).toBe('error')
    expect(hydrated.message.error).toEqual(error)
    expect(hydrated.blocks[0]).toMatchObject({ type: 'error', error })
  })

  it('normalizes previously persisted empty errors without discarding interrupted failures', async () => {
    const { agentTranscriptRepository } = await import('../repositories/agentTranscriptRepository')
    const { canonicalEntryToPersisted } = await import('../agentHistoryMapper')
    for (const status of ['completed', 'failed', 'interrupted'] as const) {
      await agentTranscriptRepository.upsertMessage({ id: status, sessionId: 'session-1', role: 'assistant', status, error: {} })
    }
    await agentTranscriptRepository.upsertPart({
      id: 'old-success-part', sessionId: 'session-1', messageId: 'completed', type: 'text',
      data: { text: '视频生成成功', status: 'success', error: {} }
    })
    const transcript = await agentTranscriptRepository.listTranscript('session-1')
    const success = canonicalEntryToPersisted(transcript.find((item) => item.message.id === 'completed')!)
    expect(success.blocks[0]?.error).toBeUndefined()
    expect(success.message.error).toBeUndefined()
    for (const status of ['failed', 'interrupted']) {
      const failure = canonicalEntryToPersisted(transcript.find((item) => item.message.id === status)!)
      expect(failure.message.status).toBe('error')
      expect(failure.blocks[0]?.error).toMatchObject({ code: status })
    }
  })

  it.each([
    ['text', 'main_text'],
    ['reasoning', 'thinking'],
    ['image', 'image'],
    ['tool', 'tool'],
    ['legacy', 'legacy']
  ])('reuses %s ids one-to-one and appends excess blocks idempotently', async (type, legacyType) => {
    const { agentMessageRepository } = await import('../sessionMessageRepository')
    const { agentTranscriptRepository } = await import('../repositories/agentTranscriptRepository')
    ;(agentMessageRepository as any).getDatabase = async () => db
    const messageId = `multi-${type}`
    await agentTranscriptRepository.upsertMessage({
      id: messageId, sessionId: 'session-1', role: 'assistant', status: 'streaming'
    })
    await agentTranscriptRepository.upsertParts([0, 1].map((index) => ({
      id: `stream-${type}-${index}`, sessionId: 'session-1', messageId, type,
      data: { content: `partial-${index}` }
    })))
    const payload = {
      message: { id: messageId, role: 'assistant', status: 'success', blocks: [0, 1, 2].map((i) => `legacy-${type}-${i}`) },
      blocks: [0, 1, 2].map((index) => ({
        id: `legacy-${type}-${index}`, messageId, type: legacyType, content: `final-${index}`,
        transcriptBlockIndex: 99
      }))
    } as any
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await agentMessageRepository.persistAssistantMessage({ sessionId: 'session-1', agentSessionId: 'session-1', payload })
      const parts = await agentTranscriptRepository.listMessageParts('session-1', messageId)
      expect(parts.map((part) => part.id)).toEqual([`stream-${type}-0`, `stream-${type}-1`, `legacy-${type}-2`])
      expect(parts.map((part) => part.data.content)).toEqual(['final-0', 'final-1', 'final-2'])
      expect(parts.map((part) => part.data.transcriptBlockIndex)).toEqual([0, 1, 2])
    }
  })

  it('matches tool calls one-to-one and restores interleaved block order without changing stored sequences', async () => {
    const { agentMessageRepository } = await import('../sessionMessageRepository')
    const { agentTranscriptRepository } = await import('../repositories/agentTranscriptRepository')
    const { canonicalEntryToPersisted } = await import('../agentHistoryMapper')
    ;(agentMessageRepository as any).getDatabase = async () => db
    const messageId = 'interleaved'
    await agentTranscriptRepository.upsertMessage({
      id: messageId, sessionId: 'session-1', role: 'assistant', status: 'streaming'
    })
    const existing = [
      { id: 'text-0', type: 'text', data: {} },
      { id: 'text-1', type: 'text', data: {} },
      { id: 'reason-0', type: 'reasoning', data: {} },
      { id: 'tool-a-0', type: 'tool', data: { toolCallId: 'a' } },
      { id: 'tool-a-1', type: 'tool', data: { toolCallId: 'a' } },
      { id: 'tool-b', type: 'tool', data: { toolId: 'b' } }
    ]
    await agentTranscriptRepository.upsertParts(existing.map((part) => ({ ...part, sessionId: 'session-1', messageId })))
    const blocks = [
      { id: 'legacy-text-0', type: 'main_text', content: 'first' },
      { id: 'legacy-tool-b', type: 'tool', toolCallId: 'b' },
      { id: 'legacy-reason', type: 'thinking', content: 'thinking' },
      { id: 'legacy-tool-a-0', type: 'tool', toolId: 'a' },
      { id: 'legacy-text-1', type: 'main_text', content: 'last' },
      { id: 'legacy-tool-a-1', type: 'tool', toolCallId: 'a' },
      { id: 'legacy-tool-c', type: 'tool', toolCallId: 'c' }
    ]
    const payload = {
      message: { id: messageId, role: 'assistant', status: 'success', blocks: blocks.map((block) => block.id) }, blocks
    } as any
    const expectedIds = ['text-0', 'tool-b', 'reason-0', 'tool-a-0', 'text-1', 'tool-a-1', 'legacy-tool-c']
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await agentMessageRepository.persistAssistantMessage({ sessionId: 'session-1', agentSessionId: 'session-1', payload })
      const entry = (await agentTranscriptRepository.listTranscript('session-1')).find((item) => item.message.id === messageId)!
      expect(entry.parts.map((part) => part.id)).toEqual([...existing.map((part) => part.id), 'legacy-tool-c'])
      const hydrated = canonicalEntryToPersisted(entry)
      expect(hydrated.message.blocks).toEqual(expectedIds)
      expect(hydrated.blocks.map((block) => block.id)).toEqual(expectedIds)
      expect(hydrated.blocks.map((block: any) => block.content)).toEqual(blocks.map((block) => block.content))
      expect(entry.parts.map((part) => part.sequence)).toEqual([0, 1, 2, 3, 4, 5, 6])
    }
  })

  it('falls back to sequence for missing or invalid transcript indexes without mutating the source parts', async () => {
    const { agentTranscriptRepository } = await import('../repositories/agentTranscriptRepository')
    const { canonicalEntryToPersisted } = await import('../agentHistoryMapper')
    const indexes = [undefined, null, '0', -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]
    const entry = (await agentTranscriptRepository.listTranscript('session-1'))[0]
    entry.parts = indexes.map((transcriptBlockIndex, sequence) => ({
      ...entry.parts[0], id: `fallback-${sequence}`, sequence, data: { transcriptBlockIndex }
    })).reverse()
    const sourceIds = entry.parts.map((part) => part.id)
    const hydrated = canonicalEntryToPersisted(entry)
    expect(hydrated.message.blocks).toEqual(indexes.map((_, sequence) => `fallback-${sequence}`))
    expect(entry.parts.map((part) => part.id)).toEqual(sourceIds)
  })

  it('reuses the turn-start part instead of appending duplicate text parts', async () => {
    const { agentMessageRepository } = await import('../sessionMessageRepository')
    ;(agentMessageRepository as any).getDatabase = async () => db

    const payload = {
      message: {
        id: 'user-1',
        role: 'user',
        createdAt: '2026-01-01T00:00:00.000Z',
        status: 'success',
        blocks: ['block-legacy-1']
      },
      blocks: [
        {
          id: 'block-legacy-1',
          messageId: 'user-1',
          type: 'main_text',
          createdAt: '2026-01-01T00:00:01.000Z',
          status: 'success',
          content: '执行的怎么样了'
        }
      ]
    } as any

    await agentMessageRepository.persistUserMessage({
      sessionId: 'session-1',
      agentSessionId: '',
      payload,
      createdAt: '2026-01-01T00:00:01.000Z'
    })
    // A second dual-write (e.g. complete-time exchange persist) must stay idempotent.
    await agentMessageRepository.persistUserMessage({
      sessionId: 'session-1',
      agentSessionId: '',
      payload,
      createdAt: '2026-01-01T00:00:02.000Z'
    })

    const parts = await client.execute(
      'SELECT id, type, data_json FROM agent_message_parts WHERE message_id = ? ORDER BY sequence',
      ['user-1']
    )
    expect(parts.rows).toHaveLength(1)
    expect(parts.rows[0]?.id).toBe('part-turnstart-text')
    expect(JSON.parse(String(parts.rows[0]?.data_json))).toMatchObject({ text: '执行的怎么样了' })
  })
})
