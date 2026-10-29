import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { createClient, type Client } from '@libsql/client'
import { Session } from '@earendil-works/pi-agent-core'
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
import { canonicalMessageToPi, SqlitePiSessionStorage } from '../piSessionStorage'

const createSchemaSql = `
  PRAGMA foreign_keys = ON;
  CREATE TABLE sessions (id TEXT PRIMARY KEY NOT NULL);
  CREATE TABLE pi_sessions (
    topic_id TEXT PRIMARY KEY NOT NULL,
    pi_session_id TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    active_leaf_id TEXT,
    metadata_json TEXT,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (topic_id) REFERENCES sessions(id) ON DELETE CASCADE
  );
  CREATE TABLE pi_session_entries (
    topic_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    entry_id TEXT NOT NULL,
    parent_entry_id TEXT,
    entry_type TEXT NOT NULL,
    entry_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (topic_id) REFERENCES pi_sessions(topic_id) ON DELETE CASCADE
  );
  CREATE UNIQUE INDEX uq_pi_session_entries_topic_sequence ON pi_session_entries(topic_id, sequence);
  CREATE UNIQUE INDEX uq_pi_session_entries_topic_entry ON pi_session_entries(topic_id, entry_id);
  CREATE TABLE pi_invocation_entries (
    topic_id TEXT NOT NULL,
    invocation_id TEXT NOT NULL,
    entry_kind TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (topic_id) REFERENCES pi_sessions(topic_id) ON DELETE CASCADE
  );
  CREATE UNIQUE INDEX uq_pi_invocation_entries_topic_kind
    ON pi_invocation_entries(topic_id, invocation_id, entry_kind);
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
    updated_at TEXT NOT NULL
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
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX uq_agent_message_parts_message_sequence ON agent_message_parts(message_id, sequence);
  CREATE UNIQUE INDEX uq_agent_message_parts_message_id ON agent_message_parts(message_id, id);
`

function userMessage(text: string) {
  return { role: 'user' as const, content: text, timestamp: Date.now() }
}

function assistantMessage(text: string) {
  return {
    role: 'assistant' as const,
    content: [{ type: 'text' as const, text }],
    api: 'openai-completions' as const,
    provider: 'provider',
    model: 'model',
    usage: {
      input: 2,
      output: 3,
      cacheRead: 1,
      cacheWrite: 1,
      totalTokens: 7,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: 'stop' as const,
    timestamp: Date.now()
  }
}

describe('SqlitePiSessionStorage', () => {
  let client: Client
  let database: ReturnType<typeof drizzle<typeof schema>>
  let tempDirectory: string

  beforeEach(async () => {
    tempDirectory = await mkdtemp(path.join(tmpdir(), 'pi-session-storage-'))
    client = createClient({ url: `file:${path.join(tempDirectory, 'sessions.db')}`, intMode: 'number' })
    await client.executeMultiple(createSchemaSql)
    await client.execute("INSERT INTO sessions (id) VALUES ('topic-a')")
    database = drizzle(client, { schema })
  })

  afterEach(async () => {
    client.close()
    await rm(tempDirectory, { recursive: true, force: true })
  })

  async function open(requestedSessionId = 'pi-first') {
    return SqlitePiSessionStorage.openOrCreate({
      topicId: 'topic-a',
      requestedSessionId,
      database
    })
  }

  it('reopens one durable PI session per topic and resumes its context', async () => {
    const first = await open()
    const firstSession = new Session(first)
    await firstSession.appendMessage(userMessage('hello'))
    await firstSession.appendModelChange('provider', 'model')
    await firstSession.appendThinkingLevelChange('high')
    await firstSession.appendActiveToolsChange(['read', 'bash'])
    await firstSession.appendMessage(assistantMessage('world'))

    const reopened = await open('pi-ignored-on-reopen')
    const reopenedSession = new Session(reopened)
    expect(await reopened.getMetadata()).toMatchObject({ id: 'pi-first', topicId: 'topic-a' })
    expect((await reopenedSession.getEntries()).map((entry) => entry.type)).toEqual([
      'message',
      'model_change',
      'thinking_level_change',
      'active_tools_change',
      'message'
    ])
    expect(await reopenedSession.buildContext()).toMatchObject({
      thinkingLevel: 'high',
      model: { provider: 'provider', modelId: 'model' },
      activeToolNames: ['read', 'bash']
    })
    await client.execute("INSERT INTO sessions (id) VALUES ('topic-b')")
    await expect(
      SqlitePiSessionStorage.openOrCreate({
        topicId: 'topic-b',
        requestedSessionId: 'pi-first',
        database
      })
    ).rejects.toThrow('already belongs to topic topic-a')
  })

  it('preserves append ordering and cursor reads', async () => {
    const storage = await open()
    const session = new Session(storage)
    const ids = [
      await session.appendCustomEntry('one', { value: 1 }),
      await session.appendCustomEntry('two', { value: 2 }),
      await session.appendCustomEntry('three', { value: 3 })
    ]
    expect((await storage.getEntries()).map((entry) => entry.id)).toEqual(ids)
    expect((await storage.getEntries({ afterEntrySeq: 1, limit: 1 })).map((entry) => entry.id)).toEqual([ids[1]])
  })

  it('persists branch leaf moves and branch summaries atomically', async () => {
    const storage = await open()
    const session = new Session(storage)
    const root = await session.appendMessage(userMessage('root'))
    await session.appendMessage(assistantMessage('old branch'))
    const summaryId = await session.moveTo(root, { summary: 'return to root' })

    expect(await storage.getLeafId()).toBe(summaryId)
    expect((await storage.getEntries()).map((entry) => entry.type)).toEqual([
      'message',
      'message',
      'leaf',
      'branch_summary'
    ])
    expect((await session.getBranch()).map((entry) => entry.id)).toEqual([root, summaryId])
  })

  it('persists compaction checkpoints including retained tails', async () => {
    const storage = await open()
    const session = new Session(storage)
    await session.appendMessage(userMessage('before'))
    const retained = [assistantMessage('retained')]
    const compactionId = await session.appendCompaction(
      'summary',
      undefined,
      42,
      { reason: 'test' },
      false,
      undefined,
      retained
    )

    const reopened = new Session(await open())
    const entry = await reopened.getEntry(compactionId)
    expect(entry).toMatchObject({
      type: 'compaction',
      summary: 'summary',
      tokensBefore: 42,
      details: { reason: 'test' },
      retainedTail: retained
    })
    expect((await reopened.buildContext()).messages.map((message) => message.role)).toEqual([
      'compactionSummary',
      'assistant'
    ])
  })

  it('hydrates canonical history once and keeps the accepted current message out of reopened context', async () => {
    const now = '2026-01-01T00:00:00.000Z'
    await client.executeMultiple(`
      INSERT INTO agent_messages(id, session_id, sequence, parent_message_id, role, status, semantics_json, created_at, updated_at)
      VALUES
        ('user-old', 'topic-a', 0, NULL, 'user', 'completed', '{"providerVisibility":"visible"}', '${now}', '${now}'),
        ('assistant-old', 'topic-a', 1, 'user-old', 'assistant', 'completed', '{"providerVisibility":"visible"}', '${now}', '${now}'),
        ('user-current', 'topic-a', 2, NULL, 'user', 'completed', '{"providerVisibility":"visible"}', '${now}', '${now}'),
        ('assistant-current', 'topic-a', 3, 'user-current', 'assistant', 'streaming', '{"providerVisibility":"visible"}', '${now}', '${now}');
      INSERT INTO agent_message_parts(id, session_id, message_id, sequence, type, data_json, created_at, updated_at)
      VALUES
        ('part-old-user', 'topic-a', 'user-old', 0, 'text', '{"text":"old question"}', '${now}', '${now}'),
        ('part-old-assistant', 'topic-a', 'assistant-old', 0, 'text', '{"text":"old answer"}', '${now}', '${now}'),
        ('part-current-user', 'topic-a', 'user-current', 0, 'text', '{"text":"current question"}', '${now}', '${now}');
    `)

    const storage = await SqlitePiSessionStorage.openOrCreate({
      topicId: 'topic-a',
      requestedSessionId: 'pi-first',
      invocationId: 'user-current',
      database
    })
    const context = await new Session(storage).buildContext()
    expect(context.messages.map((message: any) => message.role)).toEqual(['user', 'assistant'])
    expect((context.messages[0] as any).content).toBe('old question')
    expect((context.messages[1] as any).content[0].text).toBe('old answer')

    await new Session(storage).appendMessage(userMessage('current question'))
    const reopened = new Session(await open())
    expect((await reopened.buildContext()).messages.filter((message: any) => message.role === 'user')).toHaveLength(2)
  })

  it('hydrates pending tool calls without a fabricated result so restart closure adds exactly one', async () => {
    const now = '2026-01-01T00:00:00.000Z'
    await client.executeMultiple(`
      INSERT INTO agent_messages(id, session_id, sequence, role, status, semantics_json, created_at, updated_at)
      VALUES ('assistant-tool', 'topic-a', 0, 'assistant', 'streaming', '{"providerVisibility":"visible"}', '${now}', '${now}');
      INSERT INTO agent_message_parts(id, session_id, message_id, sequence, type, data_json, created_at, updated_at)
      VALUES ('part-tool', 'topic-a', 'assistant-tool', 0, 'tool', '{"toolCallId":"call-pending","toolName":"Bash","status":"running","arguments":{"command":"sleep 10"}}', '${now}', '${now}');
    `)

    expect((await client.execute('SELECT id FROM agent_messages')).rows).toHaveLength(1)
    const transcript = await new AgentTranscriptRepository(database).listTranscript('topic-a')
    expect(transcript).toHaveLength(1)
    expect(transcript[0]?.parts).toHaveLength(1)
    expect(transcript[0]?.message.semantics).toEqual({ providerVisibility: 'visible' })
    expect(canonicalMessageToPi(transcript[0]!)).toHaveLength(1)
    const storage = await open()
    expect((await client.execute('SELECT entry_id FROM pi_session_entries')).rows).toHaveLength(2)
    expect(await storage.getEntries()).toHaveLength(2)
    const messages = (await new Session(storage).buildContext()).messages as any[]
    expect(messages.map((message) => message.role)).toEqual(['assistant', 'toolResult'])
    expect(messages[1]).toMatchObject({
      toolCallId: 'call-pending',
      isError: true,
      details: { code: 'interrupted', synthetic: true }
    })
    expect(messages.filter((message) => message.role === 'toolResult')).toHaveLength(1)
  })

  it('excludes tombstoned canonical messages from already-established PI context', async () => {
    const now = '2026-01-01T00:00:00.000Z'
    await client.executeMultiple(`
      INSERT INTO agent_messages(id, session_id, sequence, role, status, semantics_json, created_at, updated_at)
      VALUES ('user-visible', 'topic-a', 0, 'user', 'completed', '{"providerVisibility":"visible"}', '${now}', '${now}');
      INSERT INTO agent_message_parts(id, session_id, message_id, sequence, type, data_json, created_at, updated_at)
      VALUES ('part-visible', 'topic-a', 'user-visible', 0, 'text', '{"text":"remove me"}', '${now}', '${now}');
    `)

    const storage = await open()
    expect((await new Session(storage).buildContext()).messages).toHaveLength(1)
    await client.execute(`
      UPDATE agent_messages
      SET semantics_json = '{"providerVisibility":"hidden","tombstone":true}'
      WHERE id = 'user-visible'
    `)
    expect((await new Session(storage).buildContext()).messages).toEqual([])
  })

  it.each(['aborted', 'error'] as const)('does not fabricate tool results for %s partial assistants', async (stopReason) => {
    const storage = await open()
    await new Session(storage).appendMessage({
      ...assistantMessage('partial'),
      content: [{ type: 'toolCall' as const, id: 'call-partial', name: 'Bash', arguments: {} }],
      stopReason
    })

    const reopened = await open()
    await open()
    const entries = await reopened.getEntries()
    expect(entries.filter((entry: any) => entry.type === 'message' && entry.message.role === 'toolResult')).toEqual([])
    expect(entries.filter((entry: any) => entry.type === 'message' && entry.message.role === 'assistant')).toHaveLength(1)
  })

  it.each(['aborted', 'error'] as const)('hides previously persisted results for %s partial calls from provider context', async (stopReason) => {
    const storage = await open()
    const session = new Session(storage)
    await session.appendMessage({
      ...assistantMessage('partial'),
      content: [{ type: 'toolCall' as const, id: 'call-old', name: 'Bash', arguments: {} }],
      stopReason
    })
    await session.appendMessage({
      role: 'toolResult', toolCallId: 'call-old', toolName: 'Bash',
      content: [{ type: 'text', text: 'interrupted' }], isError: true, timestamp: Date.now()
    })
    const reopened = await open()
    const messages = (await new Session(reopened).buildContext()).messages
    expect(messages.filter((message: any) => message.role === 'toolResult')).toEqual([])
    // Audit/history records remain intact; this is only a context projection.
    const rows = await client.execute("SELECT entry_id FROM pi_session_entries WHERE topic_id = 'topic-a'")
    expect(rows.rows).toHaveLength(2)
  })

  it('closes orphaned tool calls with a stable interrupted result after restart', async () => {
    const storage = await open()
    const session = new Session(storage)
    await session.appendMessage({
      ...assistantMessage(''),
      content: [{ type: 'toolCall' as const, id: 'call-crashed', name: 'Bash', arguments: { command: 'sleep 10' } }],
      stopReason: 'toolUse'
    })

    const reopened = new Session(await open())
    const messages = (await reopened.buildContext()).messages as any[]
    expect(messages.map((message) => message.role)).toEqual(['assistant', 'toolResult'])
    expect(messages[1]).toMatchObject({
      toolCallId: 'call-crashed',
      toolName: 'Bash',
      isError: true,
      details: { code: 'interrupted', synthetic: true }
    })

    await open()
    expect((await storage.getEntries()).filter((entry: any) => entry.type === 'message' && entry.message.role === 'toolResult')).toHaveLength(1)
  })

  it('prefers existing durable entries and reports canonical history for legacy fallback detection', async () => {
    expect(await SqlitePiSessionStorage.hasDurableConversation({ topicId: 'topic-a', database })).toBe(false)
    const now = '2026-01-01T00:00:00.000Z'
    await client.execute(`
      INSERT INTO agent_messages(id, session_id, sequence, role, status, created_at, updated_at)
      VALUES ('legacy-user', 'topic-a', 0, 'user', 'completed', '${now}', '${now}')
    `)
    expect(await SqlitePiSessionStorage.hasDurableConversation({ topicId: 'topic-a', database })).toBe(true)
    expect(
      await SqlitePiSessionStorage.hasDurableConversation({
        topicId: 'topic-a',
        excludeMessageIds: ['legacy-user'],
        database
      })
    ).toBe(false)
  })

  it('serializes concurrent appends and deduplicates stable invocation user messages', async () => {
    const first = await open()
    const second = await open()
    first.setInvocationId('msg-stable')
    second.setInvocationId('msg-stable')
    const firstSession = new Session(first)
    const secondSession = new Session(second)

    await Promise.all([
      firstSession.appendMessage(userMessage('same request')),
      secondSession.appendMessage(userMessage('same request'))
    ])
    await Promise.all(
      Array.from({ length: 8 }, (_, index) => firstSession.appendCustomEntry('parallel', { index }))
    )

    const entries = await first.getEntries()
    expect(entries.filter((entry) => entry.type === 'message')).toHaveLength(1)
    expect(entries).toHaveLength(9)
    expect((await client.execute('SELECT sequence FROM pi_session_entries ORDER BY sequence')).rows).toEqual(
      Array.from({ length: 9 }, (_, sequence) => ({ sequence }))
    )
  })
})
