import { readFile } from 'node:fs/promises'
import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { type Client } from '@libsql/client'
import { WorkerDatabaseClient } from '../../workerClient'
let workerPath: string
let buildDirectory: string
const createClient = (config: ConstructorParameters<typeof WorkerDatabaseClient>[0]) => new WorkerDatabaseClient(config, workerPath)
import { Session } from '@earendil-works/pi-agent-core'
import { drizzle } from 'drizzle-orm/libsql'
import { getTableConfig } from 'drizzle-orm/sqlite-core'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { build } from 'vite'
import Database from 'better-sqlite3'

vi.mock('../../DatabaseManager', () => ({
  DatabaseManager: class DatabaseManager {
    static async getInstance() {
      return { getDatabase: () => (globalThis as any).__pressureDatabase }
    }
  }
}))
vi.mock('../../../BaseService', async () => {
  const { DatabaseManager } = await import('../../DatabaseManager')
  return { BaseService: class { async getDatabase() { return (await DatabaseManager.getInstance()).getDatabase() } } }
})

import { agentArtifactRepository } from '../agentArtifactRepository'
import { agentTurnRepository } from '../agentTurnRepository'
import { insertMissingTaskSubscriptions } from '../taskSubscriptionRepository'

import * as schema from '../../schema'
import { AgentTranscriptRepository } from '../agentTranscriptRepository'
import { canonicalMessageToPi, PI_HISTORY_LIMITS, PI_PERSISTENCE_LIMITS, SqlitePiSessionStorage } from '../piSessionStorage'

vi.mock('../../canonicalTranscriptMigration', () => ({ backfillCanonicalTranscript: vi.fn(() => { throw new Error('backfill forbidden') }) }))

const createSchemaSql = `
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

beforeAll(async () => {
  const cache = path.resolve('node_modules/.cache')
  await mkdir(cache, { recursive: true })
  buildDirectory = await mkdtemp(path.join(cache, 'pi-storage-worker-'))
  workerPath = path.join(buildDirectory, 'databaseWorker.cjs')
  await build({ configFile: false, logLevel: 'error', build: {
    target: 'node22', outDir: buildDirectory, emptyOutDir: false, minify: false,
    lib: { entry: path.resolve('src/main/services/agents/database/databaseWorker.ts'), formats: ['cjs'], fileName: () => 'databaseWorker.cjs' },
    rollupOptions: { external: ['better-sqlite3', /^node:/] }
  } })
}, 30000)
afterAll(async () => { if (buildDirectory) await rm(buildDirectory, { recursive: true, force: true }) })

describe('SqlitePiSessionStorage', () => {
  let client: Client
  let database: ReturnType<typeof drizzle<typeof schema>>
  let tempDirectory: string
  let storages: SqlitePiSessionStorage[]

  // Test-only barrier for disk assertions/restarts; production exposes no drain.
  async function settlePersistence() {
    await Promise.all(storages.map(storage => (storage as any).state.writes.run(async () => undefined)))
  }

  async function recover() {
    await settlePersistence()
    database = drizzle(client, { schema })
    return open()
  }

  beforeEach(async () => {
    storages = []
    const originalOpen = SqlitePiSessionStorage.openOrCreate.bind(SqlitePiSessionStorage)
    vi.spyOn(SqlitePiSessionStorage, 'openOrCreate').mockImplementation(async input => {
      const storage = await originalOpen(input)
      storages.push(storage)
      return storage
    })
    tempDirectory = await mkdtemp(path.join(tmpdir(), 'pi-session-storage-'))
    client = createClient({ url: `file:${path.join(tempDirectory, 'sessions.db')}`, intMode: 'number' })
    await client.executeMultiple(createSchemaSql)
    await client.executeMultiple('CREATE TABLE session_messages (id INTEGER PRIMARY KEY,session_id TEXT,agent_session_id TEXT,role TEXT,content TEXT,metadata TEXT,created_at TEXT,updated_at TEXT)')
    await client.executeMultiple(await readFile(path.resolve('resources/database/drizzle/0013_append_only_messages.sql'), 'utf8'))
    await client.executeMultiple(await readFile(path.resolve('resources/database/drizzle/0014_event_command_views.sql'), 'utf8'))
    await client.execute("INSERT INTO sessions (id) VALUES ('topic-a')")
    database = drizzle(client, { schema })
  })

  afterEach(async () => {
    await settlePersistence()
    vi.restoreAllMocks()
    delete (globalThis as any).__pressureDatabase
    await (client as WorkerDatabaseClient).closeAsync()
    await rm(tempDirectory, { recursive: true, force: true })
  })

  async function open(requestedSessionId = 'pi-first') {
    return SqlitePiSessionStorage.openOrCreate({
      topicId: 'topic-a',
      requestedSessionId,
      database
    })
  }

  async function insertHistory(count: number, text: string) {
    for (let index = 0; index < count; index++) {
      const id = `bounded-${index}`
      const parent = index ? `bounded-${index - 1}` : null
      await client.execute({
        sql: 'INSERT INTO pi_session_entries (topic_id,sequence,entry_id,parent_entry_id,entry_type,entry_json,created_at) VALUES (?,?,?,?,?,?,?)',
        args: ['topic-a', index, id, parent, 'message', JSON.stringify({ type: 'message', id, parentId: parent, timestamp: new Date().toISOString(), message: userMessage(text) }), new Date().toISOString()]
      })
    }
  }

  async function useOverlay(sourcePath?: string) {
    await settlePersistence()
    await (client as WorkerDatabaseClient).finalizeSchema()
    await (client as WorkerDatabaseClient).closeAsync()
    const legacyPath = sourcePath ?? path.join(tempDirectory, 'sessions.db.v2.db')
    const before = await readFile(legacyPath)
    const options = { legacyPaths: [legacyPath], migrationDir: path.resolve('resources/database/drizzle') }
    const filename = path.join(tempDirectory, 'overlay.db')
    const restart = async () => {
      await settlePersistence()
      await (client as WorkerDatabaseClient).closeAsync()
      client = new WorkerDatabaseClient({ url: `file:${filename}`, intMode: 'number' }, workerPath, undefined, options)
      database = drizzle(client, { schema })
      await (client as WorkerDatabaseClient).waitUntilReady()
    }
    await restart()
    return { restart, legacyPath, before }
  }

  async function addCanonical(id: string, text: string, parentMessageId?: string) {
    const repository = new AgentTranscriptRepository(database)
    await repository.upsertMessage({ id, sessionId: 'topic-a', role: 'user', status: 'completed', parentMessageId, createdAt: '2026-01-01T00:00:00.000Z' })
    await repository.upsertPart({ id: `${id}-text`, sessionId: 'topic-a', messageId: id, type: 'text', data: { text } })
  }

  async function addLegacy(rowId: number, id: string, text: string, status = 'success', askId?: string) {
    await client.execute({ sql: 'INSERT INTO session_messages(id,session_id,role,content,created_at,updated_at) VALUES (?,?,?,?,?,?)', args: [
      BigInt(rowId), 'topic-a', 'user', JSON.stringify({ message: { id, role: 'user', status, askId, createdAt: '2026-01-01T00:00:00.000Z' }, blocks: [{ id: `${id}-text`, type: 'main_text', content: text }] }), '2026-01-01', '2026-01-01'
    ] })
  }

  it('overlay projects canonical history without migration and restores prefix parents, branches and cursors after a worker restart', async () => {
    await addCanonical('old-user', 'old question')
    await addCanonical('current-user', 'current question')
    const overlay = await useOverlay()
    const storage = await SqlitePiSessionStorage.openOrCreate({ topicId: 'topic-a', invocationId: 'current-user', database })
    const session = new Session(storage)
    const root = await storage.getLeafId()
    expect((await session.buildContext()).messages.map((message: any) => message.content)).toEqual(['old question'])
    expect((await client.execute("SELECT entity_type FROM entity_records WHERE entity_type IN ('pi_session_entries','pi_invocation_entries','agent_messages','agent_message_parts')")).rows).toEqual([])
    const current = await session.appendMessage(userMessage('current question'))
    expect(await storage.getEntry(current)).toMatchObject({ parentId: root })
    await session.moveTo(root!)
    storage.setInvocationId(undefined)
    const branch = await session.appendMessage(userMessage('new branch'))
    expect((await session.getBranch()).map(entry => entry.id)).toEqual([root, branch])
    expect((await storage.getEntries({ afterEntrySeq: 1, limit: 1 })).map(entry => entry.id)).toEqual([current])
    await overlay.restart()
    const reopened = await open()
    expect(await reopened.getLeafId()).toBe(branch)
    expect((await new Session(reopened).buildContext()).messages.map((message: any) => message.content)).toEqual(['old question', 'new branch'])
    await reopened.setLeafId(null)
    await overlay.restart()
    expect(await (await open()).getLeafId()).toBeNull()
    expect((await client.execute("SELECT entry_id FROM pi_session_entries WHERE entry_id LIKE 'canonical_%'")).rows).toEqual([])
    expect(await readFile(overlay.legacyPath)).toEqual(overlay.before)
  })

  it('overlay reads legacy-only histories without backfill, prefers terminal duplicates and freezes the prefix boundary', async () => {
    await addLegacy(1, 'legacy-user', 'partial', 'processing')
    await addLegacy(2, 'legacy-user', 'complete')
    const overlay = await useOverlay()
    expect(await SqlitePiSessionStorage.hasDurableConversation({ topicId: 'topic-a', database })).toBe(true)
    expect(await SqlitePiSessionStorage.hasDurableConversation({ topicId: 'topic-a', database, excludeMessageIds: ['legacy-user'] })).toBe(false)
    const storage = await open()
    const session = new Session(storage)
    expect((await session.buildContext()).messages.map((message: any) => message.content)).toEqual(['complete'])
    const fresh = await session.appendMessage(userMessage('fresh'))
    await addCanonical('new-canonical', 'must not join prefix')
    await addLegacy(3, 'new-legacy', 'must not join prefix either')
    await overlay.restart()
    const reopened = await open()
    expect((await new Session(reopened).buildContext()).messages.map((message: any) => message.content)).toEqual(['complete', 'fresh'])
    expect(await reopened.getEntry(fresh)).toMatchObject({ parentId: (await reopened.getEntries())[0].id })
    expect((await client.execute("SELECT entry_id FROM pi_session_entries WHERE entry_id LIKE 'canonical_%'")).rows).toEqual([])
    expect(await readFile(overlay.legacyPath)).toEqual(overlay.before)
    const { backfillCanonicalTranscript } = await import('../../canonicalTranscriptMigration')
    expect(backfillCanonicalTranscript).not.toHaveBeenCalled()
  })

  it('overlay merges canonical and legacy-only messages while canonical hidden messages suppress legacy duplicates', async () => {
    await addCanonical('canonical', 'canonical question')
    await addLegacy(1, 'canonical', 'duplicate')
    await addLegacy(2, 'legacy-only', 'legacy question')
    await addCanonical('hidden', 'hidden question')
    await client.execute(`UPDATE agent_messages SET semantics_json='{"providerVisibility":"hidden"}' WHERE id='hidden'`)
    await addLegacy(3, 'hidden', 'must stay hidden')
    await useOverlay()
    const storage = await open()
    expect((await new Session(storage).buildContext()).messages.map((message: any) => message.content)).toEqual(['canonical question', 'legacy question'])
    expect((await client.execute("SELECT entry_id FROM pi_session_entries")).rows).toEqual([])
  })

  it('overlay uses the existing legacy PI tree as authoritative and branches into new entries without copying old entries', async () => {
    const original = new Session(await open())
    const root = await original.appendMessage(userMessage('PI root'))
    const abandoned = await original.appendMessage(userMessage('old branch'))
    await addCanonical('not-in-pi', 'do not hydrate')
    const overlay = await useOverlay()
    const storage = await open()
    expect((await storage.getEntries()).map(entry => entry.id)).toEqual([root, abandoned])
    expect((await client.execute("SELECT entity_type FROM entity_records")).rows).toEqual([])
    const session = new Session(storage)
    await session.moveTo(root)
    const branch = await session.appendMessage(userMessage('overlay branch'))
    await overlay.restart()
    const reopened = new Session(await open())
    expect((await reopened.getBranch()).map(entry => entry.id)).toEqual([root, branch])
    expect((await reopened.buildContext()).messages.map((message: any) => message.content)).toEqual(['PI root', 'overlay branch'])
    expect((await client.execute("SELECT json_extract(payload,'$.entry_id') AS id FROM entity_records WHERE entity_type='pi_session_entries'")).rows.map(row => row.id)).not.toContain(root)
    expect(await readFile(overlay.legacyPath)).toEqual(overlay.before)
  })

  it.each(['canonical', 'legacy'])('overlay rejects oversized %s context before transferring message bodies', async (source) => {
    if (source === 'legacy') await addLegacy(1, 'huge', 'x'.repeat(PI_HISTORY_LIMITS.entryBytes))
    else await addCanonical('huge', 'x'.repeat(PI_HISTORY_LIMITS.entryBytes))
    await useOverlay()
    const reads = vi.spyOn(database, 'all')
    await expect(open()).rejects.toMatchObject({ name: 'PiHistoryLimitError' })
    expect(reads.mock.calls.some(([query]) => (database as any).dialect.sqlToQuery(query).sql.includes('WITH page AS') && (database as any).dialect.sqlToQuery(query).sql.includes(source === 'legacy' ? 'session_messages' : 'agent_message_parts'))).toBe(false)
    expect((await client.execute("SELECT entity_type FROM entity_records WHERE entity_type='pi_session_entries'")).rows).toEqual([])
  })

  it('overlay preserves explicit canonical fork parents and restores compaction referring to a virtual entry', async () => {
    await addCanonical('root', 'root')
    await addCanonical('fork-a', 'branch A', 'root')
    await addCanonical('fork-b', 'branch B', 'root')
    const overlay = await useOverlay()
    const storage = await open()
    const entries = await storage.getEntries()
    expect(entries[2].parentId).toBe(entries[0].id)
    const session = new Session(storage)
    expect((await session.buildContext()).messages.map((message: any) => message.content)).toEqual(['root', 'branch B'])
    await session.moveTo(entries[1].id)
    await session.appendCompaction('summary', entries[1].id, 10)
    await overlay.restart()
    expect((await new Session(await open()).buildContext()).messages.map((message: any) => message.role)).toEqual(['compactionSummary', 'user'])
    expect((await client.execute("SELECT entry_id FROM pi_session_entries WHERE entry_id LIKE 'canonical_%'")).rows).toEqual([])
  })

  it('overlay rejects unavailable legacy parents rather than fabricating a linear history', async () => {
    await addLegacy(1, 'orphan', 'orphan', 'success', 'missing')
    await useOverlay()
    await expect(open()).rejects.toThrow(/parent missing is unavailable/)
    expect((await client.execute("SELECT entry_id FROM pi_session_entries")).rows).toEqual([])
  })

  it('overlay closes interrupted old tools only in context, without persisting synthetic entries', async () => {
    const original = new Session(await open())
    await original.appendMessage({ ...assistantMessage(''), content: [{ type: 'toolCall', id: 'old-call', name: 'Bash', arguments: {} }], stopReason: 'toolUse' })
    const overlay = await useOverlay()
    const storage = await open()
    expect(await storage.getEntries()).toHaveLength(1)
    expect((await new Session(storage).buildContext()).messages.map((message: any) => message.role)).toEqual(['assistant', 'toolResult'])
    expect((await client.execute('SELECT entity_type FROM entity_records')).rows).toEqual([])
    await overlay.restart()
    const restored = new Session(await open())
    expect((await restored.buildContext()).messages.filter((message: any) => message.role === 'toolResult')).toHaveLength(1)
    expect((await client.execute('SELECT entity_type FROM entity_records')).rows).toEqual([])
    const closure = (await restored.getBranch()).find(entry => entry.type === 'message' && entry.message.role === 'toolResult')!
    expect(await restored.getEntry(closure.id)).toEqual(closure)
    await restored.moveTo(closure.id)
    await restored.appendMessage(userMessage('continue after interruption'))
    await overlay.restart()
    expect((await new Session(await open()).buildContext()).messages.map((message: any) => message.role)).toEqual(['assistant', 'toolResult', 'user'])
  })

  it('overlay resumes a plain legacy SQLite history with no canonical or PI tables and no payload timestamp', async () => {
    const filename = path.join(tempDirectory, 'plain-legacy.db')
    const raw = new Database(filename)
    raw.exec(`CREATE TABLE sessions(id TEXT PRIMARY KEY NOT NULL);
      CREATE TABLE session_messages(id INTEGER PRIMARY KEY,session_id TEXT,role TEXT,content TEXT,metadata TEXT,created_at TEXT,updated_at TEXT);
      INSERT INTO sessions(id) VALUES('topic-a');`)
    raw.prepare('INSERT INTO session_messages(id,session_id,content,created_at) VALUES(?,?,?,?)').run(1, 'topic-a', JSON.stringify({ message: { id: 'plain-user', role: 'user' }, blocks: [{ type: 'main_text', content: 'plain question' }] }), '2025-01-01')
    raw.close()
    const overlay = await useOverlay(filename)
    const storage = await open()
    const session = new Session(storage)
    const before = await session.buildContext()
    expect(before.messages.map((message: any) => message.content)).toEqual(['plain question'])
    await session.appendMessage(userMessage('reply'))
    await overlay.restart()
    const restored = await new Session(await open()).buildContext()
    expect(restored.messages[0]).toEqual(before.messages[0])
    expect(restored.messages.map((message: any) => message.content)).toEqual(['plain question', 'reply'])
    expect((await client.execute("SELECT entity_type FROM entity_records WHERE entity_type IN ('agent_messages','agent_message_parts')")).rows).toEqual([])
    expect(await readFile(filename)).toEqual(overlay.before)
  })

  it('overlay rejects restoration when its old prefix source disappears instead of silently dropping context', async () => {
    await addCanonical('old', 'old context')
    const overlay = await useOverlay()
    await new Session(await open()).appendMessage(userMessage('new context'))
    await settlePersistence()
    await (client as WorkerDatabaseClient).closeAsync()
    await rename(overlay.legacyPath, overlay.legacyPath + '.unavailable')
    await overlay.restart()
    await expect(open()).rejects.toThrow(/source context changed or is unavailable/)
  })

  it('rejects oversized UTF-8 history during initialization before reading bodies', async () => {
    await open()
    await settlePersistence()
    await insertHistory(1, '\u4f60'.repeat(Math.ceil(PI_HISTORY_LIMITS.entryBytes / 3)))
    database = drizzle(client, { schema })
    const reads = vi.spyOn(database, 'all')
    await expect(open()).rejects.toMatchObject({ name: 'PiHistoryLimitError' })
    expect(reads).toHaveBeenCalledTimes(1)
  })

  it('rejects aggregate history overflow during initialization before reading bodies', async () => {
    await open()
    await settlePersistence()
    await insertHistory(5, 'x'.repeat(Math.floor(3.5 * 1024 * 1024)))
    database = drizzle(client, { schema })
    const reads = vi.spyOn(database, 'all')
    await expect(open()).rejects.toMatchObject({ name: 'PiHistoryLimitError' })
    expect(reads).toHaveBeenCalledTimes(1)
  })

  it('recovers valid bodies in byte-bounded batches and uses no runtime SQL', async () => {
    await open()
    await settlePersistence()
    await insertHistory(3, 'x'.repeat(Math.floor(2.2 * 1024 * 1024)))
    database = drizzle(client, { schema })
    const reads = vi.spyOn(database, 'all')
    const storage = await open()
    expect(reads).toHaveBeenCalledTimes(5)
    reads.mockClear()
    expect((await storage.getPathToRootOrCompaction('bounded-2')).map(entry => entry.id)).toEqual(['bounded-0', 'bounded-1', 'bounded-2'])
    expect(reads).not.toHaveBeenCalled()
  })

  it('restores across metadata page boundaries without per-entry SQL', async () => {
    await open()
    await settlePersistence()
    const count = PI_HISTORY_LIMITS.metadataBatch + 1
    await client.execute({
      sql: `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i+1 FROM n WHERE i+1<?)
        INSERT INTO pi_session_entries (topic_id,sequence,entry_id,parent_entry_id,entry_type,entry_json,created_at)
        SELECT 'topic-a',i,'span-'||i,CASE WHEN i>0 THEN 'span-'||(i-1) END,'message',
          json_object('type','message','id','span-'||i,'parentId',CASE WHEN i>0 THEN 'span-'||(i-1) END,
            'timestamp','2026-01-01','message',json_object('role','user','content','hello','timestamp',0)), '2026-01-01' FROM n`,
      args: [count]
    })
    database = drizzle(client, { schema })
    const reads = vi.spyOn(database, 'all')
    const storage = await open()
    expect(reads).toHaveBeenCalledTimes(5)
    reads.mockClear()
    const entries = await storage.getPathToRootOrCompaction(`span-${count - 1}`)
    expect(entries).toHaveLength(count)
    expect(entries[0].id).toBe('span-0')
    expect(reads).not.toHaveBeenCalled()
  })

  it('rejects cyclic active trees during recovery and evicts failed initialization', async () => {
    await open()
    await settlePersistence()
    await insertHistory(2, 'hello')
    await client.execute("UPDATE pi_session_entries SET parent_entry_id='bounded-1', entry_json=json_set(entry_json,'$.parentId','bounded-1') WHERE entry_id='bounded-0'")
    await client.execute("UPDATE pi_sessions SET active_leaf_id='bounded-1'")
    database = drizzle(client, { schema })
    await expect(open()).rejects.toThrow(/Cycle/)
    await client.execute("UPDATE pi_session_entries SET parent_entry_id=NULL, entry_json=json_set(entry_json,'$.parentId',NULL) WHERE entry_id='bounded-0'")
    expect((await (await open()).getEntries()).length).toBe(2)
  })

  it('hydrates canonical history in memory without awaiting writes or using transactions', async () => {
    await addCanonical('no-tx-user', 'hello')
    const transaction = vi.spyOn(database, 'transaction')
    const storage = await open()
    expect(transaction).not.toHaveBeenCalled()
    expect(await storage.getEntries()).toHaveLength(1)
    expect(await storage.getLeafId()).toBe((await storage.getEntries())[0].id)
  })

  it('serializes competing first openers and hydrates only once', async () => {
    const repository = new AgentTranscriptRepository(database)
    await repository.upsertMessage({ id: 'race-user', sessionId: 'topic-a', role: 'user', status: 'completed' })
    await repository.upsertPart({ id: 'race-text', sessionId: 'topic-a', messageId: 'race-user', type: 'text', data: { text: 'hydrate once' } })
    const storages = await Promise.all([open(), open()])
    expect(await storages[0].getEntries()).toHaveLength(1)
    expect(await storages[1].getEntries()).toHaveLength(1)
  })

  it('keeps PI usable after background SQL failure and restores only durable entries after restart', async () => {
    await (client as WorkerDatabaseClient).finalizeSchema()
    const storage = await open()
    const first = { type: 'custom' as const, id: 'first', parentId: null, timestamp: '2026-01-01', customType: 'test', data: { value: 1 } }
    await storage.appendEntry(first)
    await settlePersistence()
    await client.executeMultiple(`CREATE TRIGGER reject_pi_entry BEFORE INSERT ON entity_records
      WHEN NEW.entity_type='pi_session_entries' AND json_extract(NEW.payload,'$.entry_id')='bad'
      BEGIN SELECT RAISE(ABORT,'injected PI append failure'); END;`)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const transaction = vi.spyOn(database, 'transaction')
    await expect(storage.appendEntry({ ...first, id: 'bad', parentId: 'first' })).resolves.toBeUndefined()
    await settlePersistence()
    expect(client.closed).toBe(true)
    await storage.appendEntry({ ...first, id: 'tail', parentId: 'bad' })
    expect((await storage.getEntries()).map(entry => entry.id)).toEqual(['first', 'bad', 'tail'])
    expect(await storage.getLeafId()).toBe('tail')
    expect(transaction).not.toHaveBeenCalled()
    expect(errors).toHaveBeenCalledTimes(1)
    await settlePersistence()
    await (client as WorkerDatabaseClient).closeAsync()
    client = createClient({ url: `file:${path.join(tempDirectory, 'sessions.db')}`, intMode: 'number' })
    database = drizzle(client, { schema })
    const reopened = await open()
    expect(await reopened.getEntries()).toEqual([first])
    expect(await reopened.getLeafId()).toBe('first')
    await reopened.appendEntry({ ...first, id: 'new', parentId: 'first' })
    expect(await reopened.getLeafId()).toBe('new')
  })

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

  it('creates and reopens a writable PI current view without replacing existing metadata or identity', async () => {
    await client.executeMultiple(`
      ALTER TABLE pi_sessions RENAME TO pi_session_records;
      CREATE VIEW pi_sessions AS SELECT * FROM pi_session_records;
      CREATE TRIGGER pi_sessions_insert INSTEAD OF INSERT ON pi_sessions BEGIN
        INSERT INTO pi_session_records VALUES (NEW.topic_id, NEW.pi_session_id, NEW.created_at, NEW.active_leaf_id, NEW.metadata_json, NEW.updated_at);
      END;
    `)
    const first = await SqlitePiSessionStorage.openOrCreate({ topicId: 'topic-a', requestedSessionId: 'pi-first', metadata: { original: true }, database })
    const before = await first.getMetadata()
    const reopened = await SqlitePiSessionStorage.openOrCreate({ topicId: 'topic-a', requestedSessionId: 'pi-replacement', metadata: { replacement: true }, database })
    expect(await reopened.getMetadata()).toEqual(before)
    await settlePersistence()
    expect(Number((await client.execute('SELECT count(*) FROM pi_session_records')).rows[0][0])).toBe(1)
    await client.execute("INSERT INTO sessions (id) VALUES ('topic-b')")
    await SqlitePiSessionStorage.openOrCreate({ topicId: 'topic-b', requestedSessionId: 'pi-other', database })
    expect(await (await SqlitePiSessionStorage.openOrCreate({ topicId: 'topic-a', requestedSessionId: 'pi-other', database })).getMetadata()).toEqual(before)
    expect(await reopened.getMetadata()).toEqual(before)
  })

  it('writes turns, artifacts and subscriptions through append-only current views', async () => {
    for (const [table, keys] of [
      [schema.agentTurnsTable, ['id']],
      [schema.agentArtifactsTable, ['id']],
      [schema.channelTaskSubscriptionsTable, ['channel_id', 'task_id']]
    ] as const) {
      const { name, columns } = getTableConfig(table)
      const names = columns.map((column) => `"${column.name}"`).join(', ')
      const definitions = columns.map((column) => `"${column.name}" ${column.getSQLType()}`).join(', ')
      const incoming = columns.map((column) => `NEW."${column.name}"`).join(', ')
      await client.executeMultiple(`
        CREATE TABLE ${name}_records (_record INTEGER PRIMARY KEY AUTOINCREMENT, ${definitions});
        CREATE VIEW ${name} AS SELECT ${names} FROM ${name}_records
          WHERE _record IN (SELECT max(_record) FROM ${name}_records GROUP BY ${keys.join(', ')});
        CREATE TRIGGER ${name}_insert INSTEAD OF INSERT ON ${name} BEGIN
          INSERT INTO ${name}_records (${names}) VALUES (${incoming});
        END;
        CREATE TRIGGER ${name}_update INSTEAD OF UPDATE ON ${name} BEGIN
          INSERT INTO ${name}_records (${names}) VALUES (${incoming});
        END;
      `)
    }
    ;(globalThis as any).__pressureDatabase = database
    const turn = { id: 'view-turn', topicId: 'topic-a', segmentId: 'segment', userMessageId: 'user', assistantMessageId: 'assistant', startedAt: 'original-start', status: 'running', traceId: 'original-trace', userText: 'original-text', cumulativeInputTokens: 1 } as const
    await agentTurnRepository.save(turn)
    const saved = await agentTurnRepository.save({ ...turn, topicId: 'ignored-topic', startedAt: 'ignored-start', traceId: undefined, userText: undefined, status: 'completed', completedAt: 'end' })
    expect(saved).toMatchObject({ topicId: 'topic-a', startedAt: 'original-start', traceId: 'original-trace', userText: 'original-text', status: 'completed' })
    expect(await agentTurnRepository.getById(turn.id)).toEqual(saved)
    expect(Number((await client.execute('SELECT count(*) FROM agent_turns_records')).rows[0][0])).toBe(2)

    const artifact = { id: 'view-artifact', topicId: 'topic-a', segmentId: 'segment', turnId: turn.id, sourceType: 'tool_result', content: 'blob', contentHash: 'hash', summary: 'original', createdAt: 'original-time' } as const
    const first = await agentArtifactRepository.save(artifact)
    expect(await agentArtifactRepository.save({ ...artifact, summary: 'ignored', createdAt: 'ignored' })).toEqual(first)
    await expect(agentArtifactRepository.save({ ...artifact, topicId: 'other-topic' })).rejects.toThrow('Artifact ID conflict')
    expect(Number((await client.execute('SELECT count(*) FROM agent_artifacts_records')).rows[0][0])).toBe(1)

    await insertMissingTaskSubscriptions(database, 'task', ['channel-a', 'channel-a', 'channel-b'])
    await insertMissingTaskSubscriptions(database, 'task', ['channel-a', 'channel-b'])
    await insertMissingTaskSubscriptions(database, 'other-task', ['channel-a'])
    expect(Number((await client.execute('SELECT count(*) FROM channel_task_subscriptions_records')).rows[0][0])).toBe(3)
  })

  it('serves all runtime APIs and topic reuse from memory while background writes are hung', async () => {
    const storage = await open()
    await settlePersistence()
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    void (storage as any).state.writes.run(() => gate)
    const select = vi.spyOn(database, 'select')
    const all = vi.spyOn(database, 'all')
    const insert = vi.spyOn(database, 'insert')
    const update = vi.spyOn(database, 'update')
    try {
      const session = new Session(storage)
      const root = await session.appendMessage(userMessage('memory only'))
      await session.appendSessionName('memory name')
      await session.appendLabel(root, 'root label')
      await storage.setLeafId(root)
      expect(await storage.getMetadata()).toMatchObject({ id: 'pi-first' })
      expect(await storage.getEntry(root)).toMatchObject({ id: root })
      expect(await storage.findEntries('message')).toHaveLength(1)
      expect(await storage.getLabel(root)).toBe('root label')
      expect(await storage.getSessionName()).toBe('memory name')
      expect(await storage.getSessionStats()).toMatchObject({ messageCount: 1 })
      expect(await storage.getPathToRootOrCompaction(root)).toHaveLength(1)
      expect(await storage.getEntries()).toHaveLength(4)
      expect(await storage.createEntryId()).toBeTypeOf('string')
      const reused = await open('ignored')
      expect(await reused.getLeafId()).toBe(root)
      expect((await new Session(reused).buildContext()).messages).toHaveLength(1)
      expect(await SqlitePiSessionStorage.hasDurableConversation({ topicId: 'topic-a', database })).toBe(true)
      expect(select).not.toHaveBeenCalled()
      expect(all).not.toHaveBeenCalled()
      expect(insert).not.toHaveBeenCalled()
      expect(update).not.toHaveBeenCalled()
      expect((storage as any).drain).toBeUndefined()
    } finally {
      release()
    }
    await settlePersistence()
    expect((await (await recover()).getEntries())).toHaveLength(4)
  })

  it('does not wait for even the initial background session creation', async () => {
    const original = database.insert.bind(database)
    const insert = vi.spyOn(database, 'insert')
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    insert.mockImplementation(((table: any) => {
      const builder = original(table)
      return { values: async (values: any) => { await gate; return builder.values(values) } }
    }) as any)
    try {
      const storage = await open()
      await storage.appendEntry({ type: 'custom', id: 'before-disk', parentId: null, timestamp: '2026-01-01', customType: 'test' })
      expect(await storage.getLeafId()).toBe('before-disk')
      expect((await client.execute('SELECT topic_id FROM pi_sessions')).rows).toEqual([])
    } finally {
      release()
    }
    await settlePersistence()
    expect((await client.execute('SELECT entry_id FROM pi_session_entries')).rows).toEqual([{ entry_id: 'before-disk' }])
  })

  it.each(['tasks', 'bytes'] as const)('bounds %s including an in-flight permanently pending write and keeps topic memory usable', async (limit) => {
    const storage = await open()
    await settlePersistence()
    const state = (storage as any).state
    const original = database.insert.bind(database)
    let release!: () => void
    let started!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const running = new Promise<void>(resolve => { started = resolve })
    const insert = vi.spyOn(database, 'insert').mockImplementation(((table: any) => {
      const builder = original(table)
      return { values: async (values: any) => { started(); await gate; return builder.values(values) } }
    }) as any)
    const scheduled = vi.spyOn(state.writes, 'run')
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const text = limit === 'bytes' ? '\u4f60'.repeat(500000) : 'small'
    const append = async (index: number) => storage.appendEntry({ type: 'custom', id: `pending-${index}`,
      parentId: null, timestamp: '2026-01-01', customType: 'test', data: { text } })
    try {
      await append(0)
      await running
      expect(state.pendingWrites).toBe(1)
      expect(state.pendingWriteBytes).toBeGreaterThan(Buffer.byteLength(text))
      const maximum = limit === 'tasks' ? PI_PERSISTENCE_LIMITS.tasks + 1 : 8
      for (let index = 1; index < maximum; index++) {
        await append(index)
        expect(state.pendingWrites).toBeLessThanOrEqual(PI_PERSISTENCE_LIMITS.tasks)
        expect(state.pendingWriteBytes).toBeLessThanOrEqual(PI_PERSISTENCE_LIMITS.bytes)
      }
      expect(state.persistenceFailed).toBe(true)
      const admitted = scheduled.mock.calls.length
      const bytes = state.pendingWriteBytes
      const count = state.pendingWrites
      for (let index = maximum; index < maximum + 20; index++) await append(index)
      expect(scheduled).toHaveBeenCalledTimes(admitted)
      expect(state.pendingWriteBytes).toBe(bytes)
      expect(state.pendingWrites).toBe(count)
      expect(await (await open()).getEntries()).toHaveLength(maximum + 20)
      expect(errors).toHaveBeenCalledTimes(1)
      expect((storage as any).drain).toBeUndefined()
    } finally {
      // The write stays pending for all assertions; release solely for test teardown.
      release()
    }
    await settlePersistence()
    expect(state.pendingWrites).toBe(0)
    expect(state.pendingWriteBytes).toBe(0)
    expect(insert).toHaveBeenCalledTimes(1)
    await append(99999)
    expect(state.pendingWrites).toBe(0)
    expect(insert).toHaveBeenCalledTimes(1)
    expect((await client.execute('SELECT entry_id FROM pi_session_entries')).rows).toEqual([{ entry_id: 'pending-0' }])
  })

  it('releases queue capacity after successful writes instead of limiting total session writes', async () => {
    const storage = await open()
    await settlePersistence()
    const state = (storage as any).state
    for (let index = 0; index < 3; index++) {
      await storage.appendEntry({ type: 'custom', id: `capacity-${index}`, parentId: null,
        timestamp: '2026-01-01', customType: 'test', data: { text: 'x'.repeat(3 * 1024 * 1024) } })
      expect(state.pendingWriteBytes).toBeGreaterThan(0)
      await settlePersistence()
      expect(state.pendingWrites).toBe(0)
      expect(state.pendingWriteBytes).toBe(0)
    }
    expect(state.persistenceFailed).toBe(false)
    expect(await storage.getEntries()).toHaveLength(3)
  })

  it('rejects a single oversized recording without rejecting its in-memory entry', async () => {
    const storage = await open()
    await settlePersistence()
    const insert = vi.spyOn(database, 'insert')
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    await storage.appendEntry({ type: 'custom', id: 'oversized', parentId: null,
      timestamp: '2026-01-01', customType: 'test', data: { text: 'x'.repeat(PI_PERSISTENCE_LIMITS.bytes) } })
    expect(await storage.getLeafId()).toBe('oversized')
    expect(await storage.getEntries()).toHaveLength(1)
    expect((storage as any).state.pendingWrites).toBe(0)
    expect((storage as any).state.pendingWriteBytes).toBe(0)
    expect(insert).not.toHaveBeenCalled()
    expect(errors).toHaveBeenCalledTimes(1)
  })

  it('bounds deferred recovery recordings before scheduling any SQL', async () => {
    const count = PI_PERSISTENCE_LIMITS.tasks + 1
    vi.spyOn(AgentTranscriptRepository.prototype, 'listTranscript').mockResolvedValue(
      Array.from({ length: count }, (_, index) => ({
        message: { id: `recovery-${index}`, sessionId: 'topic-a', role: 'user', createdAt: '2026-01-01' },
        parts: [{ type: 'text', data: { text: 'history' } }]
      })) as any)
    const insert = vi.spyOn(database, 'insert')
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const storage = await open()
    expect(await storage.getEntries()).toHaveLength(count)
    expect((storage as any).state.persistenceFailed).toBe(true)
    expect((storage as any).state.pendingWrites).toBe(0)
    expect((storage as any).state.pendingWriteBytes).toBe(0)
    expect((storage as any).recoveryWrites).toBeUndefined()
    expect(insert).not.toHaveBeenCalled()
    expect(errors).toHaveBeenCalledTimes(1)
  })

  it('counts session metadata against the recovery byte budget', async () => {
    const insert = vi.spyOn(database, 'insert')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const storage = await SqlitePiSessionStorage.openOrCreate({ topicId: 'topic-a', database,
      metadata: { large: 'x'.repeat(PI_PERSISTENCE_LIMITS.bytes) } })
    expect((await storage.getMetadata()).metadata?.large).toHaveLength(PI_PERSISTENCE_LIMITS.bytes)
    expect((storage as any).state.persistenceFailed).toBe(true)
    expect((storage as any).state.pendingWrites).toBe(0)
    expect((storage as any).state.pendingWriteBytes).toBe(0)
    expect(insert).not.toHaveBeenCalled()
  })

  it('documents that database deletion does not currently invalidate an existing topic cache', async () => {
    const storage = await open()
    await new Session(storage).appendMessage(userMessage('cached conversation'))
    await settlePersistence()
    await client.execute("DELETE FROM pi_invocation_entries WHERE topic_id='topic-a'")
    await client.execute("DELETE FROM pi_session_entries WHERE topic_id='topic-a'")
    await client.execute("DELETE FROM pi_sessions WHERE topic_id='topic-a'")
    await client.execute("DELETE FROM sessions WHERE id='topic-a'")
    const select = vi.spyOn(database, 'select')
    const reused = await open('replacement')
    expect(await reused.getMetadata()).toMatchObject({ id: 'pi-first' })
    expect(await reused.getEntries()).toHaveLength(1)
    expect(await SqlitePiSessionStorage.hasDurableConversation({ topicId: 'topic-a', database })).toBe(true)
    expect(select).not.toHaveBeenCalled()
  })

  it('preserves explicit branch parents and makes repeated IDs idempotent without moving the leaf', async () => {
    const storage = await open()
    const entry = { type: 'custom' as const, id: 'root', parentId: null, timestamp: '2026-01-01', customType: 'test', data: { value: 1 } }
    await storage.appendEntry(entry)
    await storage.appendEntry({ ...entry, id: 'old', parentId: 'root' })
    await storage.appendEntry({ ...entry, id: 'branch', parentId: 'root' })
    await storage.appendEntry(entry)
    expect(await storage.getLeafId()).toBe('branch')
    expect((await storage.getPathToRootOrCompaction('branch')).map(item => item.id)).toEqual(['root', 'branch'])
    await expect(storage.appendEntry({ ...entry, data: { value: 2 } })).rejects.toThrow(/different content/)
    await expect(storage.appendEntry({ ...entry, id: 'orphan', parentId: 'missing' })).rejects.toThrow(/Parent/)
    const restored = await recover()
    expect((await restored.getPathToRootOrCompaction('branch')).map(item => item.id)).toEqual(['root', 'branch'])
  })

  it('isolates invocation handles and snapshots caller-owned data', async () => {
    const first = await open()
    const second = await open()
    first.setInvocationId('request-a')
    second.setInvocationId('request-b')
    const entry = { type: 'message' as const, id: 'a', parentId: null, timestamp: '2026-01-01', message: userMessage('original') }
    await first.appendEntry(entry)
    entry.message.content = 'mutated'
    await second.appendEntry({ ...entry, id: 'b', parentId: 'a' })
    await first.appendEntry({ ...entry, id: 'retry', parentId: 'b' })
    expect(await first.getEntry('a')).toMatchObject({ message: { content: 'original' } })
    const returned: any = await second.getEntry('a')
    returned.message.content = 'mutated again'
    expect(await first.getEntry('a')).toMatchObject({ message: { content: 'original' } })
    expect((await first.getEntries()).map(item => item.id)).toEqual(['a', 'b'])
    expect(await first.getLeafId()).toBe('b')
  })

  it('recovers invocation deduplication when the entry persisted but its claim did not', async () => {
    const storage = await open()
    storage.setInvocationId('request')
    await new Session(storage).appendMessage(userMessage('once'))
    await settlePersistence()
    await client.execute('DELETE FROM pi_invocation_entries')
    const restored = await recover()
    restored.setInvocationId('request')
    await new Session(restored).appendMessage(userMessage('retry'))
    expect(await restored.getEntries()).toHaveLength(1)
  })

  it('restores canonical forks without flattening them', async () => {
    await addCanonical('root', 'root')
    await addCanonical('a', 'branch A', 'root')
    await addCanonical('b', 'branch B', 'root')
    const storage = await open()
    const entries = await storage.getEntries()
    expect(entries[2].parentId).toBe(entries[0].id)
    expect((await new Session(storage).buildContext()).messages.map((message: any) => message.content)).toEqual(['root', 'branch B'])
    expect((await new Session(await recover()).buildContext()).messages.map((message: any) => message.content)).toEqual(['root', 'branch B'])
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

  it('persists ordered branch leaf moves and branch summaries', async () => {
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
    await settlePersistence()
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

  it('snapshots visibility in memory and restores tombstones on database restart', async () => {
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
    expect((await new Session(storage).buildContext()).messages).toHaveLength(1)
    expect((await new Session(await open()).buildContext()).messages).toHaveLength(1)
    expect((await new Session(await recover()).buildContext()).messages).toEqual([])
  })

  it('documents that canonical tombstones do not yet hide native PI invocation entries even after recovery', async () => {
    await addCanonical('native-request', 'remove native message')
    const storage = await SqlitePiSessionStorage.openOrCreate({ topicId: 'topic-a', database,
      invocationId: 'native-request' })
    const entryId = await new Session(storage).appendMessage(userMessage('remove native message'))
    await settlePersistence()
    expect(await new AgentTranscriptRepository(database).tombstoneMessage('topic-a', 'native-request')).toBe(true)
    expect((await new Session(await open()).buildContext()).messages).toHaveLength(1)
    const restored = await recover()
    expect((await new Session(restored).buildContext()).messages).toHaveLength(1)
    expect((await restored.getEntries())[0].id).toBe(entryId)
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
    await settlePersistence()
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

    const reopened = new Session(await recover())
    const messages = (await reopened.buildContext()).messages as any[]
    expect(messages.map((message) => message.role)).toEqual(['assistant', 'toolResult'])
    expect(messages[1]).toMatchObject({
      toolCallId: 'call-crashed',
      toolName: 'Bash',
      isError: true,
      details: { code: 'interrupted', synthetic: true }
    })

    await open()
    expect((await reopened.getEntries()).filter((entry: any) => entry.type === 'message' && entry.message.role === 'toolResult')).toHaveLength(1)
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
    await settlePersistence()
    expect((await client.execute('SELECT sequence FROM pi_session_entries ORDER BY sequence')).rows).toEqual(
      Array.from({ length: 9 }, (_, sequence) => ({ sequence }))
    )
  })
  it('persists concurrent PI appends and canonical snapshots through the production worker', async () => {
    const storage = await open()
    const session = new Session(storage)
    const repository = new AgentTranscriptRepository(database)
    await client.execute(`CREATE TABLE agent_artifacts (
      id TEXT PRIMARY KEY, topic_id TEXT NOT NULL, segment_id TEXT NOT NULL, turn_id TEXT NOT NULL,
      source_type TEXT NOT NULL, tool_subtype TEXT, tool_call_id TEXT, file_path TEXT, uri TEXT,
      line_start INTEGER, line_end INTEGER, content TEXT NOT NULL, content_hash TEXT NOT NULL,
      summary TEXT, created_at TEXT NOT NULL)`)
    ;(globalThis as any).__pressureDatabase = database
    await Promise.all([
      (async () => {
        for (let index = 0; index < 300; index++) await session.appendCustomEntry('claudecode_projection_event', { type: 'text-delta', delta: String(index) })
      })(),
      (async () => {
        for (let index = 0; index < 30; index++) await repository.upsertMessages([
          { id: `snapshot-${index}`, sessionId: 'topic-a', role: 'assistant', status: 'completed' }
        ])
      })(),
      (async () => {
        for (let index = 0; index < 30; index++) await agentArtifactRepository.save({
          id: `artifact-${index}`, topicId: 'topic-a', segmentId: 'segment', turnId: 'turn',
          sourceType: 'tool_result', toolCallId: `tool-${index}`, content: 'x'.repeat(20000), contentHash: `hash-${index}`,
          createdAt: '2026-01-01T00:00:00.000Z'
        })
      })()
    ])
    expect(await storage.getEntries()).toHaveLength(300)
    expect(await repository.listMessages('topic-a')).toHaveLength(30)
    expect(Number((await client.execute('SELECT count(*) FROM agent_artifacts')).rows[0][0])).toBe(30)
    const before = await agentArtifactRepository.listByToolCallId('tool-0')
    const repeated = await agentArtifactRepository.save(before[0])
    expect(repeated).toEqual(before[0])
    expect(Number((await client.execute('SELECT count(*) FROM agent_artifacts')).rows[0][0])).toBe(30)
    expect((await client.execute('PRAGMA integrity_check')).rows[0][0]).toBe('ok')
  })

})
