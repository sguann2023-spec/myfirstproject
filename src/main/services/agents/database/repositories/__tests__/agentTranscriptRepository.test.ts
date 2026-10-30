import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { WorkerDatabaseClient } from '../../workerClient'
const createClient = (config: ConstructorParameters<typeof WorkerDatabaseClient>[0]) => new WorkerDatabaseClient(config, path.resolve('out/main/databaseWorker.js'))
import { drizzle } from 'drizzle-orm/libsql'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../DatabaseManager', () => ({
  DatabaseManager: class DatabaseManager {
    static async getInstance(): Promise<never> {
      throw new Error('Tests must inject a database')
    }
  }
}))
vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ warn: vi.fn(), info: vi.fn() }) }
}))
vi.mock('../../sessionMessageRepository', () => ({
  agentMessageRepository: { getSessionHistory: vi.fn() }
}))

import { AgentHistoryService } from '../../agentHistoryService'
import { readMessageProjection } from '../../messageEventStore'
import * as schema from '../../schema'
import { AgentTranscriptRepository } from '../agentTranscriptRepository'

const createSchemaSql = `
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
    FOREIGN KEY (parent_message_id) REFERENCES agent_messages(id) ON DELETE SET NULL
  );
  CREATE UNIQUE INDEX uq_agent_messages_session_sequence ON agent_messages(session_id, sequence);
  CREATE UNIQUE INDEX uq_agent_messages_session_id ON agent_messages(session_id, id);
  CREATE INDEX idx_agent_messages_session_status ON agent_messages(session_id, status);
  CREATE INDEX idx_agent_messages_turn_id ON agent_messages(turn_id);
  CREATE INDEX idx_agent_messages_parent_message_id ON agent_messages(parent_message_id);
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
  CREATE INDEX idx_agent_message_parts_session_message ON agent_message_parts(session_id, message_id);
  CREATE INDEX idx_agent_message_parts_type ON agent_message_parts(type);
`

const createLegacySchemaSql = `
  CREATE TABLE session_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    agent_session_id TEXT DEFAULT '',
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );
`

describe('AgentTranscriptRepository', () => {
  let client: WorkerDatabaseClient
  let repository: AgentTranscriptRepository
  let tempDirectory: string

  it('indexes command reads and writes with 30000 unrelated historical events', async () => {
    await client.executeMultiple(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<30000)
      INSERT INTO entity_records(entity_type,entity_key,operation,payload)
      SELECT 'agent_messages',json_array('load-'||x),'put',json_object('id','load-'||x,'session_id','unrelated','sequence',x,'role','user','status','completed') FROM n`)
    const queries = [
      "SELECT * FROM agent_messages WHERE id='missing'",
      "SELECT * FROM agent_messages WHERE session_id='session-a' AND sequence=1",
      "SELECT * FROM agent_message_parts WHERE message_id='missing' AND sequence=1"
    ]
    for (const query of queries) {
      const plan = await client.execute('EXPLAIN QUERY PLAN ' + query)
      expect(plan.rows.map(row => row.detail).join(' ')).toContain('entity_records_latest')
      expect(plan.rows.map(row => row.detail).join(' ')).not.toContain('SCAN e')
      expect(plan.rows.some(row => String(row.detail).includes('SEARCH e USING INDEX v2_index_') && String(row.detail).includes('<expr>=?'))).toBe(true)
    }
    const indexes = await client.execute("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='entity_records'")
    expect(indexes.rows.map(row => row.name)).toEqual(expect.arrayContaining([
      expect.stringContaining('v2_index_agent_messages_'), expect.stringContaining('v2_index_agent_message_parts_')
    ]))
    const started = performance.now()
    for (let index = 0; index < 12; index++) {
      await repository.upsertMessage({ id: `active-${index}`, sessionId: 'session-a', role: 'user', status: 'completed' })
    }
    expect(performance.now() - started).toBeLessThan(2000)
    expect(await repository.listMessages('session-a')).toHaveLength(12)
  }, 30000)

  it('reads the latest part directly from the current view after repeated edits and deletion', async () => {
    await repository.upsertMessage({ id: 'message', sessionId: 'session-a', role: 'assistant', status: 'completed' })
    await client.executeMultiple(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<2048)
      INSERT INTO entity_records(entity_type,entity_key,operation,payload)
      SELECT 'agent_message_parts',json_array('edited'),'put',json_object('id','edited','session_id','session-a','message_id','message','sequence',0,'type','text','data_json',json_object('version',x),'created_at','2026-01-01','updated_at','2026-01-01') FROM n`)
    const db = drizzle(client, { schema })
    const execute = vi.spyOn(client, 'execute')
    const rows = await readMessageProjection<schema.AgentMessagePartRow>(db, 'agent_message_parts', 'session-a')
    expect(rows[0].data_json).toEqual({ version: 2048 })
    expect(execute).toHaveBeenCalledTimes(1)
    const [statement] = execute.mock.calls[0]
    expect(typeof statement === 'string' ? statement : (statement as { sql: string }).sql).toMatch(/SELECT \* FROM "agent_message_parts" WHERE session_id=/)
    execute.mockRestore()
    await client.execute("DELETE FROM agent_message_parts WHERE id='edited'")
    expect(await readMessageProjection(db, 'agent_message_parts', 'session-a')).toEqual([])
    const history = await client.execute("SELECT operation FROM entity_records WHERE entity_type='agent_message_parts' AND entity_key=json_array('edited') ORDER BY position")
    expect(history.rows).toHaveLength(2049)
    expect(history.rows.slice(0, -1).every(row => row.operation === 'put')).toBe(true)
    expect(history.rows[history.rows.length - 1].operation).toBe('delete')
  })

  it('retains immutable edit/status/deletion history while reading current state', async () => {
    await repository.upsertMessage({ id: 'event-message', sessionId: 'session-a', role: 'assistant', status: 'streaming' })
    await repository.upsertPart({ id: 'event-part', sessionId: 'session-a', messageId: 'event-message', type: 'text', data: { text: 'first' } })
    await repository.upsertPart({ id: 'event-part', sessionId: 'session-a', messageId: 'event-message', type: 'text', data: { text: 'edited' } })
    await repository.upsertMessage({ id: 'event-message', sessionId: 'session-a', role: 'assistant', status: 'completed' })
    await repository.tombstoneMessage('session-a', 'event-message')
    expect((await repository.listTranscript('session-a'))[0]).toMatchObject({
      message: { status: 'completed', semantics: { tombstone: true } },
      parts: [{ data: { text: 'edited' } }]
    })
    const history = await client.execute("SELECT payload FROM entity_records WHERE entity_type='agent_message_parts' AND entity_key=json_array('event-part') ORDER BY position")
    expect(history.rows.map(row => JSON.parse(String(row.payload)).data_json)).toEqual([JSON.stringify({ text: 'first' }), JSON.stringify({ text: 'edited' })])
    expect((await repository.getMessage('session-a', 'event-message'))?.semantics?.tombstone).toBe(true)
    const statuses = await client.execute("SELECT payload FROM entity_records WHERE entity_type='agent_messages' AND entity_key=json_array('event-message') ORDER BY position")
    expect(statuses.rows.map(row => JSON.parse(String(row.payload)).status)).toEqual(['streaming', 'completed', 'completed'])
    expect(JSON.parse(JSON.parse(String(statuses.rows[2].payload)).semantics_json).tombstone).toBe(true)
    await expect(client.execute('DELETE FROM entity_records')).rejects.toThrow('immutable')
    expect(client.closed).toBe(true)
    await expect(repository.getMessage('session-a', 'event-message')).rejects.toMatchObject({
      cause: { message: expect.stringContaining('immutable') }
    })
  })

  it('finalizes the schema once and retains physical deletion history', async () => {
    await repository.upsertMessage({ id: 'legacy', sessionId: 'session-a', role: 'user', status: 'completed' })
    const before = await client.execute('SELECT * FROM entity_records ORDER BY position')
    await client.finalizeSchema()
    expect((await client.execute('SELECT * FROM entity_records ORDER BY position')).rows).toEqual(before.rows)
    await client.execute("DELETE FROM agent_messages WHERE id='legacy'")
    expect(await repository.getMessage('session-a', 'legacy')).toBeNull()
    const events = await client.execute("SELECT operation FROM entity_records WHERE entity_type='agent_messages' AND entity_key=json_array('legacy') ORDER BY position")
    expect(events.rows.map(row => row.operation)).toEqual(['put', 'delete'])
  })

  it('orders cross-instance merges without explicit transactions and recovers after failures', async () => {
    const db = drizzle(client, { schema })
    const first = new AgentTranscriptRepository(db)
    const second = new AgentTranscriptRepository(db)
    const transaction = vi.spyOn(db, 'transaction')
    try {
      await Promise.all([
        first.upsertMessage({ id: 'merge', sessionId: 'session-a', role: 'assistant', status: 'completed', provider: { modelId: 'model' } }),
        second.upsertMessage({ id: 'merge', sessionId: 'session-a', role: 'assistant', status: 'streaming', provider: { providerId: 'provider' } })
      ])
      await expect(first.upsertPart({ id: 'bad', sessionId: 'session-a', messageId: 'missing', type: 'text', data: {} })).rejects.toThrow()
      await second.upsertPart({ id: 'good', sessionId: 'session-a', messageId: 'merge', type: 'text', data: { text: 'ok' } })
      expect((await first.getMessage('session-a', 'merge'))?.provider).toEqual({ modelId: 'model', providerId: 'provider' })
      expect((await first.getMessage('session-a', 'merge'))?.status).toBe('completed')
      await first.tombstoneMessage('session-a', 'merge')
      expect(transaction).not.toHaveBeenCalled()
    } finally { transaction.mockRestore() }
  })

  it('appends concurrently with a database-scoped queue and keeps deterministic message ordering', async () => {
    await Promise.all(Array.from({ length: 12 }, (_, index) => repository.upsertMessage({
      id: `parallel-${index}`, sessionId: 'session-a', role: 'assistant', status: 'completed'
    })))
    const messages = await repository.listMessages('session-a')
    expect(messages).toHaveLength(12)
    expect(new Set(messages.map(message => message.sequence)).size).toBe(12)
    const events = await client.execute("SELECT position FROM entity_records WHERE entity_type='agent_messages' ORDER BY position")
    expect(events.rows).toHaveLength(12)
    expect(new Set(events.rows.map(row => row.position)).size).toBe(12)
  })

  it('backfills a database containing pre-journal canonical and legacy messages', async () => {
    const legacy = createClient({ url: ':memory:' })
    try {
      await legacy.executeMultiple(createSchemaSql)
      await legacy.executeMultiple(createLegacySchemaSql)
      await legacy.execute("INSERT INTO sessions(id) VALUES ('old')")
      await legacy.execute("INSERT INTO agent_messages(id,session_id,sequence,role,status,created_at,updated_at) VALUES ('old-message','old',0,'user','completed','2020','2020')")
      await legacy.execute("INSERT INTO session_messages(id,session_id,role,content,created_at,updated_at) VALUES (1,'old','user','{}','2020','2020')")
      await legacy.finalizeSchema()
      const db = drizzle(legacy, { schema })
      const messages = await readMessageProjection<schema.AgentMessageRow>(db, 'agent_messages', 'old')
      expect(messages[0]).toMatchObject({ id: 'old-message', status: 'completed' })
      expect(await readMessageProjection(db, 'session_messages', 'old')).toMatchObject([{ id: 1 }])
      const records = await legacy.execute('SELECT * FROM entity_records ORDER BY position')
      expect(records.rows).toHaveLength(3)
      await legacy.finalizeSchema()
      expect((await legacy.execute('SELECT * FROM entity_records ORDER BY position')).rows).toEqual(records.rows)
      expect(await readMessageProjection(db, 'agent_messages', 'old')).toEqual(messages)
    } finally { await (legacy as WorkerDatabaseClient).closeAsync() }
  })

  it('uses durable current views and retains history after cascading session deletion', async () => {
    const tables = await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('sessions','agent_messages','agent_message_parts','session_messages')")
    expect(tables.rows).toHaveLength(0)
    const views = await client.execute("SELECT name FROM sqlite_master WHERE type='view' AND name IN ('sessions','agent_messages','agent_message_parts','session_messages')")
    expect(views.rows).toHaveLength(4)
    await repository.upsertMessage({ id: 'retained-message', sessionId: 'session-a', role: 'assistant', status: 'streaming' })
    for (let index = 0; index < 129; index++) {
      await repository.upsertPart({ id: 'retained-part', sessionId: 'session-a', messageId: 'retained-message', type: 'text', data: { text: String(index) } })
    }
    expect((await repository.listMessageParts('session-a', 'retained-message'))[0].data.text).toBe('128')
    const history = await client.execute('SELECT * FROM entity_records ORDER BY position')
    await client.execute("DELETE FROM sessions WHERE id='session-a'")
    const after = await client.execute('SELECT * FROM entity_records ORDER BY position')
    expect(after.rows.slice(0, history.rows.length)).toEqual(history.rows)
    expect(after.rows.slice(history.rows.length).map(row => `${row.entity_type}:${row.operation}`).sort()).toEqual([
      'agent_message_parts:delete', 'agent_messages:delete', 'sessions:delete'
    ])
    expect(await repository.listTranscript('session-a')).toEqual([])
    expect(await repository.listMessageParts('session-a', 'retained-message')).toEqual([])
  })

  it('shares the broker projection across independent connections without resubmitting commands', async () => {
    const other = createClient({ url: `file:${path.join(tempDirectory, 'transcript.db')}`, intMode: 'number' })
    try {
      const second = new AgentTranscriptRepository(drizzle(other, { schema }))
      // Read/modify sequence allocation is not a cross-client transaction.
      for (let index = 0; index < 10; index++) {
        await (index % 2 ? repository : second).upsertMessage({
          id: `connection-${index}`, sessionId: 'session-a', role: 'user', status: 'completed'
        })
      }
      expect(await second.listMessages('session-a')).toHaveLength(10)
      // Independent sequence scopes can still append concurrently through one broker.
      await Promise.all(Array.from({ length: 10 }, (_, index) => (index % 2 ? repository : second).upsertMessage({
        id: `independent-${index}`, sessionId: index % 2 ? 'session-a' : 'session-b', role: 'user', status: 'completed'
      })))
      expect(await second.listMessages('session-a')).toHaveLength(15)
      expect(await repository.listMessages('session-b')).toHaveLength(5)
      expect((await client.execute("SELECT count(*) AS count FROM entity_records WHERE entity_type='agent_messages'")).rows[0].count).toBe(20)
    } finally { await (other as WorkerDatabaseClient).closeAsync() }
  })

  it('records association cascades as retained deletion events', async () => {
    await repository.upsertMessage({ id: 'parent', sessionId: 'session-a', role: 'user', status: 'completed' })
    await repository.upsertMessage({ id: 'child', sessionId: 'session-a', parentMessageId: 'parent', role: 'assistant', status: 'completed' })
    await repository.upsertPart({ id: 'parent-part', sessionId: 'session-a', messageId: 'parent', type: 'text', data: { text: 'retained history' } })
    await client.execute("DELETE FROM agent_messages WHERE id='parent'")
    expect(await repository.listMessageParts('session-a', 'parent')).toHaveLength(0)
    expect((await repository.getMessage('session-a', 'child'))?.parentMessageId).toBeUndefined()
    expect((await client.execute("SELECT operation FROM entity_records WHERE entity_type='agent_message_parts' AND entity_key=json_array('parent-part') ORDER BY position")).rows.map(row => row.operation)).toEqual(['put', 'delete'])
    expect((await client.execute("SELECT json_extract(payload,'$.parent_message_id') AS parent FROM entity_records WHERE entity_type='agent_messages' AND entity_key=json_array('child') ORDER BY position")).rows.map(row => row.parent)).toEqual(['parent', null])
  })

  it('appends legacy edits and deletions without a mutable legacy authority', async () => {
    await client.execute({ sql: "INSERT INTO session_messages(session_id,role,content,created_at,updated_at) VALUES ('session-a','user',?,'2020','2020')", args: [JSON.stringify({ message: { id: 'legacy-command', role: 'user', status: 'pending' } })] })
    const [first] = (await client.execute("SELECT * FROM session_messages WHERE session_id='session-a'")).rows
    await client.execute({ sql: 'UPDATE session_messages SET content=? WHERE id=?', args: [JSON.stringify({ message: { id: 'legacy-command', role: 'user', status: 'completed', text: 'edited' } }), first.id] })
    await client.execute({ sql: 'UPDATE session_messages SET content=? WHERE id=?', args: [JSON.stringify({ message: { id: 'legacy-command', role: 'user', status: 'completed', text: 'final' } }), first.id] })
    const rows = (await client.execute('SELECT * FROM session_messages')).rows
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(first.id)
    await client.execute({ sql: 'DELETE FROM session_messages WHERE id=?', args: [first.id] })
    expect((await client.execute('SELECT * FROM session_messages')).rows).toHaveLength(0)
    const events = await client.execute("SELECT operation, payload FROM entity_records WHERE entity_type='session_messages' ORDER BY position")
    expect(events.rows.map(row => row.operation)).toEqual(['put', 'put', 'put', 'delete'])
    expect(events.rows.map(row => JSON.parse(String(row.payload)).id)).toEqual([first.id, first.id, first.id, first.id])
    expect(events.rows.map(row => JSON.parse(JSON.parse(String(row.payload)).content).message.text)).toEqual([undefined, 'edited', 'final', 'final'])
  })

  beforeEach(async () => {
    tempDirectory = await mkdtemp(path.join(tmpdir(), 'agent-transcript-'))
    client = createClient({ url: `file:${path.join(tempDirectory, 'transcript.db')}`, intMode: 'number' })
    await client.executeMultiple(createSchemaSql)
    await client.executeMultiple(createLegacySchemaSql)
    await client.finalizeSchema()
    await client.execute("INSERT INTO sessions (id) VALUES ('session-a'), ('session-b')")
    repository = new AgentTranscriptRepository(drizzle(client, { schema }))
  })

  afterEach(async () => {
    await (client as WorkerDatabaseClient).closeAsync()
    await rm(tempDirectory, { recursive: true, force: true })
  })

  it('allocates stable message sequence with ordered tasks and returns ordered transcript', async () => {
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

  it('paginates current history across tombstones and deleted sequence gaps without resurrecting legacy copies', async () => {
    await repository.upsertMessages(Array.from({ length: 5 }, (_, index) => ({
      id: `page-${index}`, sessionId: 'session-a', role: 'user' as const, status: 'completed' as const
    })))
    await repository.upsertParts(Array.from({ length: 5 }, (_, index) => ({
      id: `page-part-${index}`, sessionId: 'session-a', messageId: `page-${index}`, type: 'text', data: { text: `text-${index}` }
    })))
    await repository.upsertMessage({ id: 'other-session', sessionId: 'session-b', role: 'user', status: 'completed' })
    for (const id of ['page-1', 'legacy-only']) {
      await client.execute({
        sql: "INSERT INTO session_messages(session_id,role,content,created_at,updated_at) VALUES ('session-a','user',?,'2026-01-01','2026-01-01')",
        args: [JSON.stringify({ message: { id, role: 'user', createdAt: '2026-01-01' }, blocks: [] })]
      })
    }
    await repository.tombstoneMessage('session-a', 'page-1')
    await client.execute("DELETE FROM agent_messages WHERE id='page-2'")
    const service = new AgentHistoryService(repository, {
      getSessionHistory: async (sessionId: string) => {
        const rows = await readMessageProjection<schema.SessionMessageRow>(drizzle(client, { schema }), 'session_messages', sessionId)
        return rows.map(row => JSON.parse(row.content))
      }
    })

    const first = await service.getHistory('session-a', { afterSequence: -1, limit: 2 })
    expect(first.messages.map(item => item.message.id)).toEqual(['page-0', 'page-3'])
    expect(first.messages.map(item => item.blocks[0])).toMatchObject([{ content: 'text-0' }, { content: 'text-3' }])
    expect(first).toMatchObject({ sequences: [0, 3], hasMore: true, nextAfterSequence: 3 })
    const second = await service.getHistory('session-a', { afterSequence: first.nextAfterSequence, limit: 2 })
    expect(second.messages.map(item => item.message.id)).toEqual(['page-4', 'legacy-only'])
    expect(second).toMatchObject({ sequences: [4, 5], hasMore: false, nextAfterSequence: 5 })
    expect(await service.getHistory('session-a', { afterSequence: second.nextAfterSequence, limit: 2 })).toEqual({
      messages: [], sequences: [], hasMore: false, nextAfterSequence: undefined
    })
    expect((await repository.getMessage('session-a', 'page-1'))?.semantics?.tombstone).toBe(true)
    expect(await repository.listMessageParts('session-a', 'page-2')).toEqual([])
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

  it('stops after a bulk SQL failure and restores only the completed prefix on explicit restart', async () => {
    const execute = vi.spyOn(client, 'execute')
    const db = drizzle(client, { schema })
    repository = new AgentTranscriptRepository(db)
    const transaction = vi.spyOn(db, 'transaction')
    await expect(
      repository.upsertMessages([
        { id: 'message-good', sessionId: 'session-a', role: 'user', status: 'completed' },
        { id: 'message-bad', sessionId: 'missing-session', role: 'user', status: 'completed' },
        { id: 'message-tail', sessionId: 'session-a', role: 'user', status: 'completed' }
      ])
    ).rejects.toThrow()

    expect(transaction).not.toHaveBeenCalled()
    const inserts = execute.mock.calls.filter(([statement]) =>
      /insert into/i.test(typeof statement === 'string' ? statement : (statement as { sql: string }).sql))
    expect(inserts).toHaveLength(2)
    expect(client.closed).toBe(true)
    await expect(repository.listMessages('session-a')).rejects.toThrow()
    await expect(repository.upsertMessage({
      id: 'message-stopped', sessionId: 'session-a', role: 'user', status: 'completed'
    })).rejects.toThrow()
    transaction.mockRestore()
    execute.mockRestore()
    await (client as WorkerDatabaseClient).closeAsync()
    client = createClient({ url: `file:${path.join(tempDirectory, 'transcript.db')}`, intMode: 'number' })
    repository = new AgentTranscriptRepository(drizzle(client, { schema }))
    expect((await repository.listMessages('session-a')).map(message => message.id)).toEqual(['message-good'])
    const saved = await repository.upsertMessage({
      id: 'message-after',
      sessionId: 'session-a',
      role: 'user',
      status: 'completed'
    })
    expect(saved.sequence).toBe(1)
  })
})
