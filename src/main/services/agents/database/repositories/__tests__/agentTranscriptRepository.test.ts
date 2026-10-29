import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { createClient, type Client } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../DatabaseManager', () => ({
  DatabaseManager: class DatabaseManager {
    static async getInstance(): Promise<never> {
      throw new Error('Tests must inject a database')
    }
  }
}))

import * as schema from '../../schema'
import { AgentTranscriptRepository } from '../agentTranscriptRepository'

const createSchemaSql = `
  PRAGMA foreign_keys = ON;
  CREATE TABLE sessions (id TEXT PRIMARY KEY NOT NULL);
  CREATE TABLE agent_messages (
    id TEXT PRIMARY KEY NOT NULL,
    session_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    turn_id TEXT,
    parent_message_id TEXT,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'tool')),
    status TEXT NOT NULL CHECK(status IN ('pending', 'streaming', 'completed', 'cancelled', 'failed', 'interrupted')),
    semantics_json TEXT,
    provider_json TEXT,
    usage_json TEXT,
    error_json TEXT,
    finish_json TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id, parent_message_id) REFERENCES agent_messages(session_id, id) ON DELETE SET NULL
  );
  CREATE UNIQUE INDEX uq_agent_messages_session_sequence ON agent_messages(session_id, sequence);
  CREATE UNIQUE INDEX uq_agent_messages_session_id ON agent_messages(session_id, id);
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
  CREATE UNIQUE INDEX uq_agent_message_parts_message_sequence ON agent_message_parts(message_id, sequence);
  CREATE UNIQUE INDEX uq_agent_message_parts_message_id ON agent_message_parts(message_id, id);
`

describe('AgentTranscriptRepository', () => {
  let client: Client
  let repository: AgentTranscriptRepository
  let tempDirectory: string

  beforeEach(async () => {
    tempDirectory = await mkdtemp(path.join(tmpdir(), 'agent-transcript-'))
    client = createClient({ url: `file:${path.join(tempDirectory, 'transcript.db')}`, intMode: 'number' })
    await client.executeMultiple(createSchemaSql)
    await client.execute("INSERT INTO sessions (id) VALUES ('session-a'), ('session-b')")
    repository = new AgentTranscriptRepository(drizzle(client, { schema }))
  })

  afterEach(async () => {
    client.close()
    await rm(tempDirectory, { recursive: true, force: true })
  })

  it('allocates stable message sequence transactionally and returns ordered transcript', async () => {
    const [user, assistant] = await repository.upsertMessages([
      {
        id: 'message-user',
        sessionId: 'session-a',
        role: 'user',
        status: 'completed',
        semantics: { origin: 'real_user', kind: 'user_prompt' }
      },
      {
        id: 'message-assistant',
        sessionId: 'session-a',
        turnId: 'turn-1',
        parentMessageId: 'message-user',
        role: 'assistant',
        status: 'streaming',
        provider: { providerId: 'provider', modelId: 'model' }
      }
    ])

    expect([user.sequence, assistant.sequence]).toEqual([0, 1])

    const updated = await repository.upsertMessage({
      id: 'message-assistant',
      sessionId: 'session-a',
      turnId: 'turn-1',
      parentMessageId: 'message-user',
      role: 'assistant',
      status: 'interrupted',
      error: { code: 'process_exit' },
      completedAt: '2026-01-01T00:00:01.000Z'
    })

    expect(updated.sequence).toBe(1)
    expect(updated.status).toBe('interrupted')
    expect(updated.error).toEqual({ code: 'process_exit' })
    expect((await repository.listMessages('session-a')).map((message) => message.id)).toEqual([
      'message-user',
      'message-assistant'
    ])
  })

  it('merges sparse legacy dual-writes without regressing lifecycle or canonical metadata', async () => {
    await repository.upsertMessage({
      id: 'message-user',
      sessionId: 'session-a',
      role: 'user',
      status: 'completed'
    })
    await repository.upsertMessage({
      id: 'message-assistant',
      sessionId: 'session-a',
      turnId: 'turn-1',
      parentMessageId: 'message-user',
      role: 'assistant',
      status: 'failed',
      semantics: { origin: 'agent_runtime', providerVisibility: 'hidden' },
      provider: { providerId: 'provider', modelId: 'model', requestId: 'trace-1' },
      usage: { inputTokens: 3, outputTokens: 4 },
      error: { code: 'boom', message: 'failed' },
      finish: { reason: 'error' },
      completedAt: '2026-01-01T00:00:01.000Z'
    })

    const saved = await repository.upsertMessage({
      id: 'message-assistant',
      sessionId: 'session-a',
      role: 'assistant',
      status: 'streaming',
      semantics: { uiVisibility: 'visible' }
    })

    expect(saved).toMatchObject({
      turnId: 'turn-1',
      parentMessageId: 'message-user',
      status: 'failed',
      semantics: { origin: 'agent_runtime', providerVisibility: 'hidden', uiVisibility: 'visible' },
      provider: { providerId: 'provider', modelId: 'model', requestId: 'trace-1' },
      usage: { inputTokens: 3, outputTokens: 4 },
      error: { code: 'boom', message: 'failed' },
      finish: { reason: 'error' },
      completedAt: '2026-01-01T00:00:01.000Z'
    })
  })

  it('allocates and preserves part sequence during lifecycle upserts', async () => {
    await repository.upsertMessage({
      id: 'message-assistant',
      sessionId: 'session-a',
      role: 'assistant',
      status: 'streaming'
    })

    const [text, tool] = await repository.upsertParts([
      {
        id: 'part-text',
        sessionId: 'session-a',
        messageId: 'message-assistant',
        type: 'text',
        data: { text: 'partial' }
      },
      {
        id: 'part-tool',
        sessionId: 'session-a',
        messageId: 'message-assistant',
        type: 'tool',
        data: { toolCallId: 'call-1', status: 'pending' }
      }
    ])

    expect([text.sequence, tool.sequence]).toEqual([0, 1])

    const completedTool = await repository.upsertPart({
      id: 'part-tool',
      sessionId: 'session-a',
      messageId: 'message-assistant',
      type: 'tool',
      data: { toolCallId: 'call-1', status: 'completed', output: 'done' }
    })

    expect(completedTool.sequence).toBe(1)
    expect(completedTool.data).toEqual({ toolCallId: 'call-1', status: 'completed', output: 'done' })

    const staleTool = await repository.upsertPart({
      id: 'part-tool',
      sessionId: 'session-a',
      messageId: 'message-assistant',
      type: 'tool',
      data: { toolCallId: 'call-1', status: 'running', output: undefined, metadata: { late: true } }
    })
    expect(staleTool.data).toEqual({
      toolCallId: 'call-1',
      status: 'completed',
      output: 'done',
      metadata: { late: true }
    })
    expect((await repository.listMessageParts('session-a', 'message-assistant')).map((part) => part.id)).toEqual([
      'part-text',
      'part-tool'
    ])
  })

  it('supports ordered bulk lookup and transcript assembly', async () => {
    await repository.upsertMessages([
      { id: 'message-1', sessionId: 'session-a', role: 'user', status: 'completed' },
      { id: 'message-2', sessionId: 'session-a', role: 'assistant', status: 'completed' },
      { id: 'message-other', sessionId: 'session-b', role: 'user', status: 'completed' }
    ])
    await repository.upsertParts([
      { id: 'part-1', sessionId: 'session-a', messageId: 'message-1', type: 'text', data: { text: 'one' } },
      { id: 'part-2', sessionId: 'session-a', messageId: 'message-2', type: 'text', data: { text: 'two' } }
    ])

    expect((await repository.getMessagesByIds('session-a', ['message-2', 'message-1'])).map((row) => row.id)).toEqual([
      'message-1',
      'message-2'
    ])
    expect(
      (await repository.getPartsByMessageIds('session-a', ['message-2', 'message-1'])).map((row) => row.id)
    ).toEqual(['part-1', 'part-2'])
    expect((await repository.getPartsByMessageIds('session-a', ['message-2'])).map((row) => row.id)).toEqual([
      'part-2'
    ])
    expect((await repository.listTranscript('session-a')).map((entry) => entry.parts[0]?.data.text)).toEqual([
      'one',
      'two'
    ])
  })

  it('tombstones messages without deleting turn-linked transcript data', async () => {
    await repository.upsertMessage({ id: 'message-1', sessionId: 'session-a', turnId: 'turn-1', role: 'assistant', status: 'completed' })
    await repository.upsertPart({ id: 'part-1', sessionId: 'session-a', messageId: 'message-1', type: 'text', data: { text: 'kept' } })

    expect(await repository.tombstoneMessage('session-a', 'message-1')).toBe(true)
    const saved = await repository.getMessage('session-a', 'message-1')
    expect(saved?.semantics).toMatchObject({
      uiVisibility: 'hidden',
      providerVisibility: 'hidden',
      transcriptVisibility: 'hidden',
      tombstone: true
    })
    expect(saved?.turnId).toBe('turn-1')
    expect((await repository.listMessageParts('session-a', 'message-1'))[0]?.data.text).toBe('kept')
    expect(await repository.tombstoneMessage('session-a', 'missing')).toBe(false)
  })

  it('rejects moving stable message and part IDs across scopes', async () => {
    await repository.upsertMessage({ id: 'message-1', sessionId: 'session-a', role: 'user', status: 'completed' })
    await repository.upsertPart({
      id: 'part-1',
      sessionId: 'session-a',
      messageId: 'message-1',
      type: 'text',
      data: { text: 'one' }
    })
    await repository.upsertMessage({ id: 'message-2', sessionId: 'session-a', role: 'assistant', status: 'completed' })

    await expect(
      repository.upsertMessage({ id: 'message-1', sessionId: 'session-b', role: 'user', status: 'completed' })
    ).rejects.toThrow('already belongs to session')
    await expect(
      repository.upsertPart({
        id: 'part-1',
        sessionId: 'session-a',
        messageId: 'message-2',
        type: 'text',
        data: { text: 'moved' }
      })
    ).rejects.toThrow('already belongs to another message')
  })

  it('rolls back bulk writes on failure without consuming sequence', async () => {
    await expect(
      repository.upsertMessages([
        { id: 'message-good', sessionId: 'session-a', role: 'user', status: 'completed' },
        { id: 'message-bad', sessionId: 'missing-session', role: 'user', status: 'completed' }
      ])
    ).rejects.toThrow()

    expect(await repository.listMessages('session-a')).toEqual([])
    const saved = await repository.upsertMessage({
      id: 'message-after',
      sessionId: 'session-a',
      role: 'user',
      status: 'completed'
    })
    expect(saved.sequence).toBe(0)
  })
})
