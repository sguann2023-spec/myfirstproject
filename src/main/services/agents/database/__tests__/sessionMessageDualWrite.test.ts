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
