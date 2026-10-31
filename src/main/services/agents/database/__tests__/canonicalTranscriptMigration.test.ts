import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { WorkerDatabaseClient } from '../workerClient'
const createClient = (config: ConstructorParameters<typeof WorkerDatabaseClient>[0]) => new WorkerDatabaseClient(config, path.resolve('out/main/databaseWorker.js'))
import { drizzle } from 'drizzle-orm/libsql'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import * as schema from '../schema'
import { backfillCanonicalTranscript, reconcileInterruptedAgentWork } from '../canonicalTranscriptMigration'

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
  CREATE TABLE agent_conversation_segments (
    id TEXT PRIMARY KEY NOT NULL,
    topic_id TEXT NOT NULL,
    sdk_session_id TEXT NOT NULL DEFAULT '',
    parent_segment_id TEXT,
    fork_from_sdk_session_id TEXT,
    system_prompt_version TEXT NOT NULL,
    system_prompt_hash TEXT NOT NULL,
    base_prompt_snapshot TEXT,
    raw_summary TEXT,
    continuation_summary TEXT,
    compact_reason TEXT,
    summary_version TEXT,
    start_message_id TEXT,
    end_message_id TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (topic_id) REFERENCES sessions(id) ON DELETE CASCADE
  );
  CREATE TABLE agent_turns (
    id TEXT PRIMARY KEY NOT NULL,
    topic_id TEXT NOT NULL,
    segment_id TEXT NOT NULL,
    trace_id TEXT,
    user_message_id TEXT NOT NULL DEFAULT '',
    assistant_message_id TEXT,
    user_text TEXT,
    assistant_text TEXT,
    cumulative_input_tokens INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    status TEXT NOT NULL,
    FOREIGN KEY (topic_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (segment_id) REFERENCES agent_conversation_segments(id) ON DELETE CASCADE
  );
  CREATE TABLE agent_artifacts (
    id TEXT PRIMARY KEY NOT NULL,
    topic_id TEXT NOT NULL,
    segment_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    source_type TEXT NOT NULL,
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (turn_id) REFERENCES agent_turns(id) ON DELETE CASCADE
  );
  CREATE TABLE agent_file_changes (
    id TEXT PRIMARY KEY NOT NULL,
    topic_id TEXT NOT NULL,
    segment_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    operation TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (turn_id) REFERENCES agent_turns(id) ON DELETE CASCADE
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
    FOREIGN KEY (session_id, message_id) REFERENCES agent_messages(session_id, id) ON DELETE CASCADE
  );
  CREATE UNIQUE INDEX uq_agent_message_parts_message_sequence ON agent_message_parts(message_id, sequence);
`

const payload = (id: string, role: string, text: string, status = 'success') =>
  JSON.stringify({
    message: { id, role, status, createdAt: '2026-01-01T00:00:00.000Z' },
    blocks: [{ id: `${id}-text`, type: 'main_text', content: text }]
  })

describe('canonical transcript migration and crash reconciliation', () => {
  let client: WorkerDatabaseClient
  let db: ReturnType<typeof drizzle<typeof schema>>
  let tempDirectory: string

  beforeEach(async () => {
    tempDirectory = await mkdtemp(path.join(tmpdir(), 'canonical-backfill-'))
    client = createClient({ url: `file:${path.join(tempDirectory, 'agents.db')}`, intMode: 'number' })
    await client.executeMultiple(createSchemaSql)
    await client.finalizeSchema()
    await client.execute("INSERT INTO sessions (id) VALUES ('session-a'), ('session-b'), ('session-c')")
    db = drizzle(client, { schema })
  })

  afterEach(async () => {
    await (client as WorkerDatabaseClient).closeAsync()
    await rm(tempDirectory, { recursive: true, force: true })
  })

  it('ignores retained deleted-session history while repairing active sessions', async () => {
    await client.executeMultiple(`
      INSERT INTO agent_conversation_segments(id,topic_id,system_prompt_version,system_prompt_hash,status,created_at,updated_at)
      VALUES ('active-seg','session-a','v','h','active','2026-01-01','2026-01-01');
      INSERT INTO agent_turns(id,topic_id,segment_id,user_message_id,started_at,status)
      VALUES ('active-turn','session-a','active-seg','u','2026-01-01','running');
      INSERT INTO agent_messages(id,session_id,sequence,role,status,created_at,updated_at) VALUES
      ('active-message','session-a',0,'assistant','streaming','2026-01-01','2026-01-01'),
      ('deleted-message','session-b',0,'assistant','streaming','2026-01-01','2026-01-01');
    `)
    await client.execute({ sql: 'INSERT INTO session_messages(session_id,role,content,created_at,updated_at) VALUES (?,?,?,?,?)', args: ['session-b','user',payload('deleted-legacy','user','retained'), '2026-01-01','2026-01-01'] })
    const history = await client.execute("SELECT * FROM entity_records WHERE json_extract(payload,'$.session_id')='session-b' ORDER BY position")
    await client.execute("DELETE FROM sessions WHERE id='session-b'")
    const retained = await client.execute("SELECT * FROM entity_records WHERE json_extract(payload,'$.session_id')='session-b' ORDER BY position")
    expect(retained.rows.slice(0, history.rows.length)).toEqual(history.rows)
    expect(retained.rows.slice(history.rows.length).map(row => [row.entity_type, row.operation])).toEqual([
      ['agent_messages', 'delete'], ['session_messages', 'delete']
    ])
    const result = await reconcileInterruptedAgentWork(db as any)
    expect(result.turnsInterrupted).toBe(1)
    expect(result.messagesInterrupted).toBe(1)
    expect((await client.execute("SELECT status FROM agent_turns WHERE id='active-turn'")).rows[0].status).toBe('interrupted')
    expect((await client.execute("SELECT * FROM agent_messages WHERE id='deleted-message'")).rows).toEqual([])
    expect((await client.execute("SELECT * FROM session_messages WHERE session_id='session-b'")).rows).toEqual([])
    const backfill = await backfillCanonicalTranscript(db as any)
    expect(backfill.legacyRows).toBe(0)
    expect(backfill.messagesInserted).toBe(0)
    expect((await client.execute("SELECT * FROM entity_records WHERE json_extract(payload,'$.session_id')='session-b' ORDER BY position")).rows).toEqual(retained.rows)
  })

  it('backfills legacy messages, prefers the terminal duplicate, and is idempotent', async () => {
    await client.execute({
      sql: 'INSERT INTO session_messages(session_id, role, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      args: ['session-a', 'user', payload('user-1', 'user', 'question'), '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z']
    })
    await client.execute({
      sql: 'INSERT INTO session_messages(session_id, role, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      args: ['session-a', 'assistant', payload('assistant-1', 'assistant', 'partial', 'streaming'), '2026-01-01T00:00:01.000Z', '2026-01-01T00:00:01.000Z']
    })
    await client.execute({
      sql: 'INSERT INTO session_messages(session_id, role, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      args: ['session-a', 'assistant', payload('assistant-1', 'assistant', 'final'), '2026-01-01T00:00:01.000Z', '2026-01-01T00:00:02.000Z']
    })

    const first = await backfillCanonicalTranscript(db as any)
    const second = await backfillCanonicalTranscript(db as any)
    const messages = await client.execute('SELECT id, status FROM agent_messages ORDER BY sequence')
    const parts = await client.execute("SELECT data_json FROM agent_message_parts WHERE message_id = 'assistant-1'")
    const segments = await client.execute('SELECT count(*) AS count FROM agent_conversation_segments')
    const turns = await client.execute('SELECT count(*) AS count FROM agent_turns')

    expect(first.legacyRows).toBe(3)
    expect(first.duplicateRows).toBe(1)
    expect(first.messagesInserted).toBe(2)
    expect(second.messagesInserted).toBe(0)
    expect(messages.rows).toMatchObject([{ id: 'user-1', status: 'completed' }, { id: 'assistant-1', status: 'completed' }])
    expect(JSON.parse(String(parts.rows[0].data_json)).text).toBe('final')
    expect(Number(segments.rows[0].count)).toBe(1)
    expect(Number(turns.rows[0].count)).toBe(1)
    const legacyHistory = await client.execute("SELECT operation, payload FROM entity_records WHERE entity_type='session_messages' ORDER BY position")
    expect(legacyHistory.rows.map(row => row.operation)).toEqual(['put', 'put', 'put'])
    expect(legacyHistory.rows.map(row => JSON.parse(JSON.parse(String(row.payload)).content).blocks[0].content)).toEqual(['question', 'partial', 'final'])
    const currentRecords = await client.execute("SELECT count(DISTINCT entity_key) AS count FROM entity_records WHERE entity_type='agent_messages'")
    expect(Number(currentRecords.rows[0].count)).toBe(2)
  })

  it('repairs an unambiguous existing turn without replacing artifact or file-change ownership', async () => {
    await client.executeMultiple(`
      INSERT INTO agent_conversation_segments(id, topic_id, system_prompt_version, system_prompt_hash, status, created_at, updated_at)
      VALUES ('seg-existing', 'session-b', 'legacy', 'hash', 'closed', '2026-01-01', '2026-01-01');
      INSERT INTO agent_turns(id, topic_id, segment_id, user_message_id, assistant_message_id, user_text, assistant_text, started_at, status)
      VALUES ('turn-existing', 'session-b', 'seg-existing', '', NULL, 'hello', 'world', '2026-01-01', 'completed');
      INSERT INTO agent_artifacts(id, topic_id, segment_id, turn_id, source_type, content, content_hash, created_at)
      VALUES ('artifact-1', 'session-b', 'seg-existing', 'turn-existing', 'read', 'kept', 'hash', '2026-01-01');
      INSERT INTO agent_file_changes(id, topic_id, segment_id, turn_id, file_path, operation, created_at)
      VALUES ('file-1', 'session-b', 'seg-existing', 'turn-existing', '/tmp/a', 'update', '2026-01-01');
    `)
    for (const [role, content, time] of [
      ['user', payload('user-b', 'user', 'hello'), '2026-01-01T00:00:00.000Z'],
      ['assistant', payload('assistant-b', 'assistant', 'world'), '2026-01-01T00:00:01.000Z']
    ] as const) {
      await client.execute({
        sql: 'INSERT INTO session_messages(session_id, role, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        args: ['session-b', role, content, time, time]
      })
    }

    const result = await backfillCanonicalTranscript(db as any)
    const turn = await client.execute("SELECT user_message_id, assistant_message_id FROM agent_turns WHERE id = 'turn-existing'")
    const artifact = await client.execute("SELECT turn_id FROM agent_artifacts WHERE id = 'artifact-1'")
    const fileChange = await client.execute("SELECT turn_id FROM agent_file_changes WHERE id = 'file-1'")

    expect(result.turnsRepaired).toBe(1)
    expect(turn.rows[0]).toMatchObject({ user_message_id: 'user-b', assistant_message_id: 'assistant-b' })
    expect(artifact.rows[0].turn_id).toBe('turn-existing')
    expect(fileChange.rows[0].turn_id).toBe('turn-existing')
  })

  it('leaves ambiguous blank turns and orphan messages unresolved', async () => {
    await client.executeMultiple(`
      INSERT INTO agent_conversation_segments(id, topic_id, system_prompt_version, system_prompt_hash, status, created_at, updated_at)
      VALUES ('seg-c', 'session-c', 'legacy', 'hash', 'closed', '2026-01-01', '2026-01-01');
      INSERT INTO agent_turns(id, topic_id, segment_id, user_message_id, started_at, status)
      VALUES ('turn-c', 'session-c', 'seg-c', '', '2026-01-01', 'completed');
    `)
    for (const [id, role, text, time] of [
      ['u1', 'user', 'same', '2026-01-01T00:00:00.000Z'],
      ['a1', 'assistant', 'same', '2026-01-01T00:00:01.000Z'],
      ['u2', 'user', 'same', '2026-01-01T00:00:02.000Z'],
      ['a2', 'assistant', 'same', '2026-01-01T00:00:03.000Z'],
      ['orphan', 'assistant', 'orphan', '2026-01-01T00:00:04.000Z']
    ] as const) {
      await client.execute({
        sql: 'INSERT INTO session_messages(session_id, role, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        args: ['session-c', role, payload(id, role, text), time, time]
      })
    }

    const result = await backfillCanonicalTranscript(db as any)
    const turn = await client.execute("SELECT user_message_id, assistant_message_id FROM agent_turns WHERE id = 'turn-c'")

    expect(result.unresolvedTurns).toBe(1)
    expect(result.orphanMessages).toBe(1)
    expect(turn.rows[0]).toMatchObject({ user_message_id: '', assistant_message_id: null })
  })

  it('settles stale turns, assistant messages, text, and tool parts without deleting partial output', async () => {
    await client.executeMultiple(`
      INSERT INTO agent_conversation_segments(id, topic_id, system_prompt_version, system_prompt_hash, status, created_at, updated_at)
      VALUES ('seg-r', 'session-a', 'v', 'h', 'active', '2026-01-01', '2026-01-01');
      INSERT INTO agent_turns(id, topic_id, segment_id, user_message_id, assistant_message_id, started_at, status)
      VALUES ('turn-r', 'session-a', 'seg-r', 'user-r', 'assistant-r', '2026-01-01', 'running');
      INSERT INTO agent_messages(id, session_id, sequence, turn_id, role, status, created_at, updated_at)
      VALUES ('assistant-r', 'session-a', 0, 'turn-r', 'assistant', 'streaming', '2026-01-01', '2026-01-01');
      INSERT INTO agent_message_parts(id, session_id, message_id, sequence, type, data_json, created_at, updated_at)
      VALUES
        ('part-text', 'session-a', 'assistant-r', 0, 'text', '{"text":"partial","status":"streaming"}', '2026-01-01', '2026-01-01'),
        ('part-tool', 'session-a', 'assistant-r', 1, 'tool', '{"toolCallId":"call-1","status":"running","input":{"x":1}}', '2026-01-01', '2026-01-01');
    `)

    const before = await client.execute('SELECT * FROM entity_records ORDER BY position')
    const first = await reconcileInterruptedAgentWork(db as any)
    const after = await client.execute('SELECT * FROM entity_records ORDER BY position')
    expect(after.rows.slice(0, before.rows.length)).toEqual(before.rows)
    expect(after.rows.slice(before.rows.length).map(row => row.entity_type)).toEqual([
      'agent_turns', 'agent_messages', 'agent_message_parts', 'agent_message_parts'
    ])
    const second = await reconcileInterruptedAgentWork(db as any)
    expect((await client.execute('SELECT * FROM entity_records ORDER BY position')).rows).toEqual(after.rows)
    const turn = await client.execute("SELECT status FROM agent_turns WHERE id = 'turn-r'")
    const message = await client.execute("SELECT status FROM agent_messages WHERE id = 'assistant-r'")
    const parts = await client.execute('SELECT id, data_json FROM agent_message_parts ORDER BY sequence')

    expect(first).toMatchObject({ turnsInterrupted: 1, messagesInterrupted: 1, toolsInterrupted: 1 })
    expect(second).toMatchObject({ turnsInterrupted: 0, messagesInterrupted: 0, toolsInterrupted: 0 })
    expect(turn.rows[0].status).toBe('interrupted')
    expect(message.rows[0].status).toBe('interrupted')
    expect(JSON.parse(String(parts.rows[0].data_json))).toMatchObject({ text: 'partial', status: 'interrupted' })
    expect(JSON.parse(String(parts.rows[1].data_json))).toMatchObject({
      toolCallId: 'call-1',
      input: { x: 1 },
      status: 'error',
      interruptionStatus: 'interrupted',
      result: { type: 'error', error: { code: 'interrupted' } }
    })
  })

  it('never settles live rows created after the beforeTimestamp watermark', async () => {
    await client.executeMultiple(`
      INSERT INTO agent_conversation_segments(id, topic_id, system_prompt_version, system_prompt_hash, status, created_at, updated_at)
      VALUES ('seg-w', 'session-a', 'v', 'h', 'active', '2026-01-01', '2026-01-01');
      INSERT INTO agent_turns(id, topic_id, segment_id, user_message_id, assistant_message_id, started_at, status)
      VALUES
        ('turn-stale', 'session-a', 'seg-w', 'user-stale', 'assistant-stale', '2026-01-01T00:00:00.000Z', 'running'),
        ('turn-live', 'session-a', 'seg-w', 'user-live', 'assistant-live', '2026-01-02T00:00:00.000Z', 'running');
      INSERT INTO agent_messages(id, session_id, sequence, turn_id, role, status, created_at, updated_at)
      VALUES
        ('assistant-stale', 'session-a', 0, 'turn-stale', 'assistant', 'streaming', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
        ('assistant-live', 'session-a', 1, 'turn-live', 'assistant', 'streaming', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
    `)

    const result = await reconcileInterruptedAgentWork(db as any, {
      beforeTimestamp: '2026-01-01T12:00:00.000Z'
    })
    const turnStale = await client.execute("SELECT status FROM agent_turns WHERE id = 'turn-stale'")
    const turnLive = await client.execute("SELECT status FROM agent_turns WHERE id = 'turn-live'")
    const messageStale = await client.execute("SELECT status FROM agent_messages WHERE id = 'assistant-stale'")
    const messageLive = await client.execute("SELECT status FROM agent_messages WHERE id = 'assistant-live'")

    expect(result).toMatchObject({ turnsInterrupted: 1, messagesInterrupted: 1 })
    expect(turnStale.rows[0].status).toBe('interrupted')
    expect(messageStale.rows[0].status).toBe('interrupted')
    expect(turnLive.rows[0].status).toBe('running')
    expect(messageLive.rows[0].status).toBe('streaming')
  })
})
