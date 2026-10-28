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
