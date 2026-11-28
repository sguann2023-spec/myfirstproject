import { readFile } from 'node:fs/promises'
import { mkdir, mkdtemp, rename, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { type Client } from '@libsql/client'
import { WorkerDatabaseClient } from '../../workerClient'
let workerPath: string
let buildDirectory: string
const createClient = (config: ConstructorParameters<typeof WorkerDatabaseClient>[0]) => new WorkerDatabaseClient(config, workerPath)
import { Session } from '@earendil-works/pi-agent-core'
import * as agentCore from '@earendil-works/pi-agent-core'
import { isRetryableAssistantError, type Models } from '@earendil-works/pi-ai'
import { drizzle } from 'drizzle-orm/libsql'
import { getTableConfig } from 'drizzle-orm/sqlite-core'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { build } from 'vite'
import Database from 'better-sqlite3'

const mediaRoot = vi.hoisted(() => ({ path: '' }))
vi.mock('@main/utils', () => ({ getDataPath: () => mediaRoot.path }))
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
const storageLogger = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() }))
vi.mock('@logger', () => ({ loggerService: { withContext: () => storageLogger } }))

import { agentArtifactRepository } from '../agentArtifactRepository'
import { agentTurnRepository } from '../agentTurnRepository'
import { insertMissingTaskSubscriptions } from '../taskSubscriptionRepository'

import * as schema from '../../schema'
import { AgentTranscriptRepository } from '../agentTranscriptRepository'
import { canonicalMessageToPi, PI_HISTORY_LIMITS, PI_PERSISTENCE_LIMITS, SqlitePiSessionStorage } from '../piSessionStorage'
import { createReadImageContextProjector } from '../../../services/claudecode/harness/read-image-context'
import { createContextCompactor } from '../../../services/claudecode/harness/context-compaction'
import { persistDirectRequestExchange } from '../../../services/channels/directRequestPersistence'

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
    storageLogger.info.mockClear()
    storages = []
    const originalOpen = SqlitePiSessionStorage.openOrCreate.bind(SqlitePiSessionStorage)
    vi.spyOn(SqlitePiSessionStorage, 'openOrCreate').mockImplementation(async input => {
      const storage = await originalOpen(input)
      storages.push(storage)
      return storage
    })
    tempDirectory = await mkdtemp(path.join(tmpdir(), 'pi-session-storage-'))
    mediaRoot.path = tempDirectory
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

  it('opens legacy overlay PI history without materializing canonical bodies or changing the old database', async () => {
    await addLegacy(1, 'z-question', 'old question')
    await addLegacy(2, 'a-answer', 'old answer')
    const overlay = await useOverlay()
    const repository = new AgentTranscriptRepository(database)
    await repository.migrateLegacyHistory('topic-a')
    expect(await repository.listMessages('topic-a')).toEqual([])
    expect((await client.execute("SELECT entity_type FROM entity_records WHERE entity_type IN ('agent_messages','agent_message_parts')")).rows).toEqual([])
    const storage = await open()
    expect((await new Session(storage).buildContext()).messages.map((message: any) => message.content)).toEqual(['old question', 'old answer'])
    await overlay.restart()
    expect((await new Session(await open()).buildContext()).messages.map((message: any) => message.content)).toEqual(['old question', 'old answer'])
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

  it('budgets only eligible overlay records before projecting oversized superseded and excluded bodies', async () => {
    const huge = 'x'.repeat(PI_HISTORY_LIMITS.entryBytes)
    await addCanonical('kept', 'keep this')
    await addLegacy(1, 'kept', huge)
    await addCanonical('current', huge)
    await addCanonical('current-child', huge, 'current')
    await addLegacy(2, 'current', huge)
    await addLegacy(3, 'legacy-child', huge, 'success', 'current')
    await addLegacy(4, 'metadata-child', huge)
    await client.execute(`UPDATE session_messages SET metadata='{"parentMessageId":"current"}' WHERE id=4`)
    const overlay = await useOverlay()
    const storage = await SqlitePiSessionStorage.openOrCreate({ topicId: 'topic-a', invocationId: 'current', database })
    expect((await new Session(storage).buildContext()).messages.map((message: any) => message.content)).toEqual(['keep this'])
    await overlay.restart()
    expect((await new Session(await open()).buildContext()).messages.map((message: any) => message.content)).toEqual(['keep this'])
    expect((await readFile(overlay.legacyPath)).equals(overlay.before)).toBe(true)
  }, 30000)

  it.each(['canonical', 'legacy'])('overlay rejects oversized %s context before transferring message bodies', async (source) => {
    if (source === 'legacy') await addLegacy(1, 'huge', 'x'.repeat(PI_HISTORY_LIMITS.entryBytes))
    else await addCanonical('huge', 'x'.repeat(PI_HISTORY_LIMITS.entryBytes))
    await useOverlay()
    const reads = vi.spyOn(database, 'all')
    await expect(open()).rejects.toMatchObject({ name: 'PiHistoryLimitError' })
    expect(reads.mock.calls.some(([query]) => (database as any).dialect.sqlToQuery(query).sql.includes('WITH page AS') && (database as any).dialect.sqlToQuery(query).sql.includes(source === 'legacy' ? 'session_messages' : 'agent_message_parts'))).toBe(false)
    expect((await client.execute("SELECT entity_type FROM entity_records WHERE entity_type='pi_session_entries'")).rows).toEqual([])
  })

  it.each(['canonical', 'legacy', 'pi', 'canonical-hydration'])('restores oversized inline user images as file references before the budget check (%s)', async source => {
    const bytes = Buffer.alloc(PI_HISTORY_LIMITS.entryBytes / 4 * 3 + 3, 0x71)
    const data = bytes.toString('base64')
    const repository = new AgentTranscriptRepository(database)
    if (source === 'pi') {
      const session = new Session(await open())
      await session.appendMessage({ role: 'user', timestamp: Date.now(), content: [
        { type: 'text', text: 'Inspect this image' }, { type: 'image', data, mimeType: 'image/png' }
      ] })
    } else if (source === 'legacy') {
      await client.execute({ sql: 'INSERT INTO session_messages(id,session_id,role,content,created_at,updated_at) VALUES (?,?,?,?,?,?)', args: [
        1, 'topic-a', 'user', JSON.stringify({ message: { id: 'image-user', role: 'user', status: 'success', createdAt: '2026-01-01' },
          blocks: [{ type: 'main_text', content: 'Inspect this image' }, { type: 'image', url: `data:image/png;base64,${data}` }] }), '2026-01-01', '2026-01-01'
      ] })
    } else {
      await addCanonical('image-user', 'Inspect this image')
      await repository.upsertPart({ id: 'image-part', sessionId: 'topic-a', messageId: 'image-user', type: 'image',
        data: { data, mediaType: 'image/png', url: `data:image/png;base64,${data}` } })
    }
    const overlay = source === 'canonical-hydration' ? undefined : await useOverlay()
    expect(await SqlitePiSessionStorage.hasDurableConversation({ topicId: 'topic-a', database, workspacePath: tempDirectory })).toBe(true)
    const storage = await SqlitePiSessionStorage.openOrCreate({ topicId: 'topic-a', database, metadata: { workspacePath: tempDirectory } })
    const session = new Session(storage)
    const context = await session.buildContext()
    expect(context.messages).toHaveLength(1)
    expect(JSON.stringify(context)).not.toContain(data)
    expect(JSON.stringify(context)).toContain('Inspect this image')
    const parts = (context.messages[0] as any).content as Array<{ type: string; text: string }>
    const referenceText = parts.find(part => part.text?.startsWith('Previously loaded image:'))!.text
    const file = JSON.parse(/^Previously loaded image: (".*?")\./.exec(referenceText)![1])
    expect((await readFile(file)).equals(bytes)).toBe(true)
    const root = await storage.getLeafId()
    await session.appendMessage(userMessage('Continue the same conversation'))
    if (overlay) await overlay.restart()
    else { await settlePersistence(); database = drizzle(client, { schema }) }
    const reopened = await open()
    const restoredContext = await new Session(reopened).buildContext()
    expect(JSON.stringify(restoredContext)).not.toContain(data)
    expect(JSON.stringify(restoredContext)).toContain(file)
    expect(JSON.stringify(restoredContext)).toContain('Continue the same conversation')
    expect((await reopened.getEntries())[1].parentId).toBe(root)
    if (overlay) expect((await readFile(overlay.legacyPath)).equals(overlay.before)).toBe(true)
    expect((await client.execute("SELECT name FROM sqlite_temp_master WHERE name LIKE 'pi_history_images_%'")).rows).toEqual([])
  })

  it('restores workspace history with many plain entries and one image using bounded projection queries', async () => {
    await open()
    await settlePersistence()
    const count = 260
    await insertHistory(count, 'mixed plain history')
    const data = Buffer.from('mixed history image').toString('base64')
    const entry = { type: 'message', id: 'mixed-image', parentId: `bounded-${count - 1}`, timestamp: '2026-01-01',
      message: { role: 'user', timestamp: 0, content: [{ type: 'image', data, mimeType: 'image/png' }] } }
    await client.execute({
      sql: 'INSERT INTO pi_session_entries (topic_id,sequence,entry_id,parent_entry_id,entry_type,entry_json,created_at) VALUES (?,?,?,?,?,?,?)',
      args: ['topic-a', count, entry.id, entry.parentId, entry.type, JSON.stringify(entry), entry.timestamp]
    })
    await client.execute("UPDATE pi_sessions SET active_leaf_id='mixed-image'")
    database = drizzle(client, { schema })
    const reads = vi.spyOn(database, 'all')
    const writes = vi.spyOn(database, 'run')
    const storage = await SqlitePiSessionStorage.openOrCreate({ topicId: 'topic-a', database,
      metadata: { workspacePath: tempDirectory } })
    const entries = await storage.getEntries()
    expect(entries).toHaveLength(count + 1)
    expect((entries[0] as any).message.content).toBe('mixed plain history')
    const image = entries.at(-1) as any
    const reference = image.message.content[0].text as string
    expect(reference).toContain('Previously loaded image:')
    const file = JSON.parse(/^Previously loaded image: (".*?")\./.exec(reference)![1])
    expect(await readFile(file, 'utf8')).toBe('mixed history image')
    expect(JSON.stringify(entries)).not.toContain(data)
    // Projection work scales with metadata pages and actual images, not 260 plain documents.
    expect(reads.mock.calls.length + writes.mock.calls.length).toBeLessThan(60)
    const queryCount = reads.mock.calls.length + writes.mock.calls.length
    expect(await storage.getPathToRootOrCompaction(entry.id)).toHaveLength(count + 1)
    expect(reads.mock.calls.length + writes.mock.calls.length).toBe(queryCount)
    expect((await client.execute("SELECT name FROM sqlite_temp_master WHERE name LIKE 'pi_history_images_%'")).rows).toEqual([])
  })

  it('projects images inside duplicated legacy tool result JSON before restoring the overlay prefix', async () => {
    const data = Buffer.alloc(PI_HISTORY_LIMITS.entryBytes / 4, 0x71).toString('base64')
    const response = { content: [{ type: 'text', text: 'Loaded grid' }, { type: 'image', data, mimeType: 'image/png' }] }
    const tool = { id: 'tool-block', type: 'tool', toolName: 'ReadImageAsContent', toolCallId: 'grid-call', status: 'success',
      input: { file_path: 'data-url' }, content: JSON.stringify(response), rawOutput: response,
      metadata: { rawMcpToolResponse: { responseRaw: response } } }
    await client.execute({ sql: 'INSERT INTO session_messages(id,session_id,role,content,created_at,updated_at) VALUES (?,?,?,?,?,?)', args: [
      1, 'topic-a', 'assistant', JSON.stringify({ message: { id: 'image-tool', role: 'assistant', status: 'success', createdAt: '2026-01-01' }, blocks: [tool] }), '2026-01-01', '2026-01-01'
    ] })
    const overlay = await useOverlay()
    const storage = await SqlitePiSessionStorage.openOrCreate({ topicId: 'topic-a', database, metadata: { workspacePath: tempDirectory } })
    const context = await new Session(storage).buildContext()
    expect(JSON.stringify(context)).not.toContain(data)
    expect(JSON.stringify(context)).toContain('Loaded grid')
    expect(JSON.stringify(context)).toContain('Previously loaded image:')
    expect((await readFile(overlay.legacyPath)).equals(overlay.before)).toBe(true)
  })

  it('keeps hydrated image references usable after a workspace rename and subsequent restarts', async () => {
    const workspace = path.join(tempDirectory, 'old-workspace')
    const renamed = path.join(tempDirectory, 'new-workspace')
    await mkdir(workspace)
    await addCanonical('image-user', 'Inspect this image')
    await new AgentTranscriptRepository(database).upsertPart({ id: 'image-part', sessionId: 'topic-a', messageId: 'image-user',
      type: 'image', data: { data: Buffer.from('original image').toString('base64'), mediaType: 'image/png' } })
    await SqlitePiSessionStorage.openOrCreate({ topicId: 'topic-a', database, metadata: { workspacePath: workspace } })
    await settlePersistence()
    await rename(workspace, renamed)
    database = drizzle(client, { schema })
    const moved = await SqlitePiSessionStorage.openOrCreate({ topicId: 'topic-a', database, metadata: { workspacePath: renamed } })
    expect(JSON.stringify(await new Session(moved).buildContext())).toContain('history-media')
    expect(JSON.stringify(await new Session(moved).buildContext())).not.toContain(workspace)
    const restarted = await recover()
    const context = await new Session(restarted).buildContext()
    expect(JSON.stringify(context)).toContain('history-media')
    expect(JSON.stringify(context)).not.toContain(workspace)
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

  it.each([false, true])('restores oversized read-image results as references without changing disk or live messages (overlay=%s)', async overlayMode => {
    const session = new Session(await open())
    const source = '/workspace/segments/seg2-grid.png'
    const text = { type: 'text' as const, text: 'Loaded image content' }
    const image = { type: 'image' as const, data: 'A'.repeat(PI_HISTORY_LIMITS.entryBytes + 4), mimeType: 'image/png' }
    const message = {
      role: 'toolResult' as const, toolCallId: 'image-call', toolName: 'ReadImageAsContent',
      content: [text, image, text, image], details: { source, mimeType: image.mimeType, byteLength: 6291459 },
      isError: false, timestamp: Date.now()
    }
    const entryId = await session.appendMessage(message)
    await settlePersistence()
    const disk = (await client.execute({ sql: 'SELECT entry_json FROM pi_session_entries WHERE entry_id=?', args: [entryId] })).rows[0].entry_json
    expect(JSON.stringify(JSON.parse(String(disk)).message) === JSON.stringify(message)).toBe(true)
    expect(JSON.stringify((await session.getEntry(entryId) as any).message) === JSON.stringify(message)).toBe(true)

    const readsBeforeRestart = vi.spyOn(database, 'all')
    const liveContext = await session.buildContext()
    const projector = createReadImageContextProjector(tempDirectory)
    const current = await projector(liveContext.messages as any)
    expect(JSON.stringify(current[0]) === JSON.stringify(message)).toBe(true)
    expect(readsBeforeRestart).not.toHaveBeenCalled()
    readsBeforeRestart.mockRestore()
    await session.appendMessage(assistantMessage('image inspected'))
    const later = await projector((await session.buildContext()).messages as any)
    expect((later[0] as any).content.every((part: any) => part.type === 'text')).toBe(true)
    expect(JSON.stringify((await session.getEntry(entryId) as any).message) === JSON.stringify(message)).toBe(true)

    const overlay = overlayMode ? await useOverlay() : undefined
    const restored = await recover()
    const reads = vi.spyOn(database, 'all')
    const entry = (await restored.getEntries())[0] as any
    expect(entry.id).toBe(entryId)
    expect(entry.message.details).toEqual(message.details)
    expect(entry.message.toolCallId).toBe(message.toolCallId)
    expect(entry.message.content).toHaveLength(4)
    expect(entry.message.content[0]).toEqual(text)
    expect(entry.message.content[2]).toEqual(text)
    for (const index of [1, 3]) {
      expect(entry.message.content[index].type).toBe('text')
      expect(entry.message.content[index].text).toContain(source)
    }
    expect(JSON.stringify(entry).includes(image.data)).toBe(false)
    expect(await restored.getPathToRootOrCompaction(entryId)).toEqual([entry])
    expect(reads).not.toHaveBeenCalled()
    expect((await client.execute({ sql: 'SELECT entry_json FROM pi_session_entries WHERE entry_id=?', args: [entryId] })).rows[0].entry_json === disk).toBe(true)
    if (overlay) expect((await readFile(overlay.legacyPath)).equals(overlay.before)).toBe(true)
  })

  it('does not discard an oversized image without a reusable source', async () => {
    const session = new Session(await open())
    await session.appendMessage({
      role: 'toolResult', toolCallId: 'inline-image', toolName: 'ReadImageAsContent',
      content: [{ type: 'image', data: 'A'.repeat(PI_HISTORY_LIMITS.entryBytes + 4), mimeType: 'image/png' }],
      details: { source: 'data-url' }, isError: false, timestamp: Date.now()
    })
    await expect(recover()).rejects.toMatchObject({ name: 'PiHistoryLimitError' })
  })

  it('rejects oversized UTF-8 history during initialization before reading bodies', async () => {
    await open()
    await settlePersistence()
    await insertHistory(1, '\u4f60'.repeat(Math.ceil(PI_HISTORY_LIMITS.entryBytes / 3)))
    database = drizzle(client, { schema })
    const reads = vi.spyOn(database, 'all')
    await expect(open()).rejects.toMatchObject({ name: 'PiHistoryLimitError' })
    expect(reads).toHaveBeenCalledTimes(1)
    expect(storageLogger.info).toHaveBeenCalledWith('[PiSessionStorage] stored entries timing', expect.objectContaining({
      stage: 'entry_reads', status: 'error', elapsedMs: expect.any(Number)
    }))
    expect(storageLogger.info).toHaveBeenCalledWith('[PiSessionStorage] restore timing', expect.objectContaining({
      stage: 'stored_entries', status: 'error', elapsedMs: expect.any(Number)
    }))
  })

  it('rejects aggregate history overflow during initialization before reading bodies', async () => {
    await open()
    await settlePersistence()
    database = drizzle(client, { schema })
    // Exercise the metadata guard without allocating more than 256 MiB of bodies.
    const count = Math.floor(PI_HISTORY_LIMITS.totalBytes / PI_HISTORY_LIMITS.entryBytes) + 1
    const reads = vi.spyOn(database, 'all').mockResolvedValueOnce(Array.from({ length: count }, (_, sequence) => ({
      id: `bounded-${sequence}`, bytes: PI_HISTORY_LIMITS.entryBytes, sequence
    })))
    await expect(open()).rejects.toMatchObject({ name: 'PiHistoryLimitError' })
    expect(reads).toHaveBeenCalledTimes(1)
  })

  it('recovers entries above 4 MiB and history above 16 MiB in byte-bounded batches without runtime SQL', async () => {
    await open()
    await settlePersistence()
    await insertHistory(3, 'x'.repeat(6 * 1024 * 1024))
    database = drizzle(client, { schema })
    const reads = vi.spyOn(database, 'all')
    const storage = await open()
    expect(reads).toHaveBeenCalledTimes(5)
    expect(storageLogger.info).toHaveBeenCalledWith('[PiSessionStorage] stored entries timing', expect.objectContaining({
      stage: 'projection', status: 'success', elapsedMs: expect.any(Number)
    }))
    const entryReads = storageLogger.info.mock.calls.filter(([event, fields]) =>
      event === '[PiSessionStorage] stored entries timing' && fields.stage === 'entry_reads').at(-1)?.[1]
    expect(entryReads).toMatchObject({ status: 'success', entryCount: 3, elapsedMs: expect.any(Number) })
    expect(entryReads.projectedBytes).toBeGreaterThan(16 * 1024 * 1024)
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
    expect(storageLogger.info).toHaveBeenCalledWith('[PiSessionStorage] restore timing', expect.objectContaining({
      stage: 'tree_validation', status: 'error', elapsedMs: expect.any(Number)
    }))
    expect(storageLogger.info).toHaveBeenCalledWith('[PiSessionStorage] initialization timing', expect.objectContaining({
      status: 'error', queueWaitMs: expect.any(Number), elapsedMs: expect.any(Number)
    }))
    expect(storageLogger.info).toHaveBeenCalledWith('[PiSessionStorage] open timing', expect.objectContaining({
      cache: 'cold', status: 'error', elapsedMs: expect.any(Number)
    }))
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

  it.each([
    { overlay: false, opened: false }, { overlay: false, opened: true },
    { overlay: true, opened: false }, { overlay: true, opened: true }
  ])('appends direct video results to PI context exactly once and restores them ($overlay, $opened)', async ({ overlay, opened }) => {
    await addCanonical('old-question', 'previous conversation')
    const overlayState = overlay ? await useOverlay() : undefined
    const existing = opened ? await open() : undefined
    if (existing) await new Session(existing).appendMessage(assistantMessage('previous answer'))
    const repository = new AgentTranscriptRepository(database)
    await addCanonical('direct-user', 'generate a video')
    await repository.upsertMessage({ id: 'direct-assistant', sessionId: 'topic-a', role: 'assistant',
      status: 'completed', parentMessageId: 'direct-user', createdAt: '2026-01-01T00:00:00.000Z' })
    const result = { success: true, task_id: 'video-task', video_url: 'https://example.com/generated.mp4' }
    await repository.upsertPart({ id: 'direct-tool', sessionId: 'topic-a', messageId: 'direct-assistant', type: 'tool',
      data: { toolCallId: 'ai_video_request_direct', toolName: 'mcp__vectcut__video__generate_video',
        status: 'success', arguments: { model: 'seedance-2.0-fast' }, content: JSON.stringify(result),
        metadata: { rawMcpToolResponse: { responseRaw: result } } } })
    await repository.upsertPart({ id: 'direct-text', sessionId: 'topic-a', messageId: 'direct-assistant', type: 'text',
      data: { text: 'video generated' } })
    const exchange = { topicId: 'topic-a', userMessageId: 'direct-user', assistantMessageId: 'direct-assistant', database }
    await SqlitePiSessionStorage.appendCanonicalExchange(exchange)
    const storage = await open()
    const session = new Session(storage)
    const messages = (await session.buildContext()).messages as any[]
    expect(messages.map(message => message.role)).toEqual([
      'user', ...(opened ? ['assistant'] : []), 'user', 'assistant', 'toolResult'
    ])
    expect(messages[messages.length - 1]).toMatchObject({ toolCallId: 'ai_video_request_direct', isError: false,
      content: [{ type: 'text', text: JSON.stringify(result) }] })
    const nextId = await session.appendMessage(userMessage('use the generated video'))
    await SqlitePiSessionStorage.appendCanonicalExchange(exchange)
    expect(await storage.getLeafId()).toBe(nextId)
    expect((await session.buildContext()).messages).toHaveLength(messages.length + 1)
    if (overlayState) await overlayState.restart()
    const restored = new Session(await recover())
    expect((await restored.buildContext()).messages).toEqual((await session.buildContext()).messages)
    expect((await restored.buildContext()).messages.filter((message: any) => message.role === 'toolResult')).toHaveLength(1)
    if (overlayState) expect(await readFile(overlayState.legacyPath)).toEqual(overlayState.before)
  })

  it.each([false, true])('persists all direct request families including failures and partial stage results (overlay=%s)', async overlayMode => {
    await addCanonical('prior-user', 'prior question')
    const overlay = overlayMode ? await useOverlay() : undefined
    ;(globalThis as any).__pressureDatabase = database
    const session = new Session(await open())
    await session.appendMessage(assistantMessage('prior answer'))
    const requests = [
      ['draftRequest', 'draft-management__create_draft'],
      ['draftModifyRequest', 'draft-management__modify_draft'],
      ['textAddRequest', 'draft-elements__add_text'],
      ['imageAddRequest', 'draft-elements__add_image'],
      ['presetAddRequest', 'draft-elements__add_preset'],
      ['audioAddRequest', 'draft-elements__add_audio'],
      ['draftDownloadRequest', 'draft-download__download_draft'],
      ['draftExportRequest', 'draft-download__export_draft'],
      ['speechRequest', 'speech__generate_speech'],
      ['seedAudioRequest', 'seed-audio__generate_seed_audio'],
      ['voiceConversionRequest', 'voice-conversion__submit_voice_conversion_task'],
      ['aiVideoRequest', 'video__generate_video'],
      ['imageGenerateRequest', 'image__generate_or_edit_image'],
      ['digitalHumanRequest', 'digital-human__create_seedance_digital_human'],
      ['reversePromptRequest', 'copylab__derive_copy_prompt'],
      ['subtitleRecognitionRequest', 'subtitle-recognition__submit_subtitle_recognition_task'],
      ['videoUnderstandRequest', 'video-understand__understand_video']
    ]
    const expectedResults: Record<string, unknown>[] = []
    for (const [marker, toolName] of requests) {
      for (const failed of [false, true]) {
        const id = `${marker}-${failed}`
        const now = new Date().toISOString()
        const raw = failed ? { error: 'backend_failure', task_id: id, billing: { consume: 3 } }
          : { success: true, task_id: id, output_url: `https://example.com/${id}`, billing: { consume: 2 } }
        expectedResults.push(raw)
        const blocks: any[] = [{ id: `${id}-tool`, messageId: `${id}-assistant`, type: 'tool',
          status: failed ? 'error' : 'success', createdAt: now,
          toolId: `${id}-call`, toolName: `mcp__vectcut__${toolName}`, input: { request: id },
          content: JSON.stringify(raw), metadata: { rawMcpToolResponse: { responseRaw: raw } } }]
        if (marker === 'digitalHumanRequest' && failed) {
          const priorResult = { success: true, video_url: 'https://example.com/digital-human.mp4' }
          blocks.unshift({ ...blocks[0], id: `${id}-generated`, toolId: `${id}-generated-call`,
            status: 'success', content: JSON.stringify(priorResult),
            metadata: { rawMcpToolResponse: { responseRaw: priorResult } } })
          expectedResults.splice(expectedResults.length - 1, 0, priorResult)
        }
        blocks.push({ id: `${id}-text`, messageId: `${id}-assistant`, type: 'main_text',
          status: failed ? 'error' : 'success', createdAt: now, content: `${id} response` })
        const exchange: any = { sessionId: 'topic-a', agentSessionId: 'topic-a', turnId: `${id}-turn`,
          user: { payload: { message: { id: `${id}-user`, role: 'user', status: 'success', createdAt: now,
            [marker]: { requestId: id } }, blocks: [{ id: `${id}-user-text`, type: 'main_text', content: id }] } },
          assistant: { payload: { message: { id: `${id}-assistant`, role: 'assistant',
            status: failed ? 'error' : 'success', createdAt: now }, blocks } } }
        await persistDirectRequestExchange(exchange)
        const leaf = await session.getLeafId()
        await persistDirectRequestExchange(exchange)
        expect(await session.getLeafId()).toBe(leaf)
        const canonical = await new AgentTranscriptRepository(database).getMessage('topic-a', `${id}-assistant`)
        expect(canonical).toMatchObject({ turnId: `${id}-turn`, parentMessageId: `${id}-user`,
          semantics: { origin: 'direct_request' } })
      }
    }
    const context = await session.buildContext()
    const results = context.messages.filter((message: any) => message.role === 'toolResult') as any[]
    expect(results.map(message => JSON.parse(message.content[0].text))).toEqual(expectedResults)
    expect(results.filter(message => message.isError)).toHaveLength(requests.length)
    expect(context.messages.filter(message => message.role === 'user')).toHaveLength(1 + requests.length * 2)
    if (overlay) await overlay.restart()
    expect((await new Session(await recover()).buildContext()).messages).toEqual(context.messages)
  })

  it('serializes competing first openers and hydrates only once', async () => {
    const repository = new AgentTranscriptRepository(database)
    await repository.upsertMessage({ id: 'race-user', sessionId: 'topic-a', role: 'user', status: 'completed' })
    await repository.upsertPart({ id: 'race-text', sessionId: 'topic-a', messageId: 'race-user', type: 'text', data: { text: 'hydrate once' } })
    const storages = await Promise.all([open(), open()])
    expect(await storages[0].getEntries()).toHaveLength(1)
    expect(await storages[1].getEntries()).toHaveLength(1)
    await open()
    const timings = storageLogger.info.mock.calls.filter(([event]) => event === '[PiSessionStorage] open timing')
    expect(timings.map(([, fields]) => fields.cache)).toEqual(['cold', 'reused', 'reused'])
    for (const [, fields] of timings) {
      expect(fields).toMatchObject({ topicId: 'topic-a', status: 'success', elapsedMs: expect.any(Number) })
    }
    expect(storageLogger.info).toHaveBeenCalledWith('[PiSessionStorage] initialization timing', {
      topicId: 'topic-a', status: 'success', queueWaitMs: expect.any(Number), elapsedMs: expect.any(Number)
    })
    const stages = storageLogger.info.mock.calls.filter(([event]) => event === '[PiSessionStorage] restore timing')
    expect(stages.map(([, fields]) => fields.stage)).toEqual([
      'metadata', 'stored_entries', 'relocation', 'claims_hidden', 'overlay_prefix', 'stored_tree',
      'canonical_hydration', 'tree_validation', 'interrupted_tools'
    ])
    for (const [, fields] of stages) expect(fields.status).toBe('success')
    expect(stages.find(([, fields]) => fields.stage === 'canonical_hydration')?.[1]).toMatchObject({
      canonicalMessageCount: 1, hydratedEntryCount: 1
    })
    expect(stages.find(([, fields]) => fields.stage === 'tree_validation')?.[1]).toMatchObject({
      entryCount: 1, bytes: expect.any(Number)
    })
    expect(JSON.stringify(storageLogger.info.mock.calls)).not.toContain('hydrate once')
  })

  describe('detached context preparation', () => {
    beforeEach(async () => { await (client as WorkerDatabaseClient).finalizeSchema() })

    function revisionClient() {
      return client as unknown as { topicHistoryRevision?: (topicId?: string, requestedSessionId?: string) => Promise<string | undefined> }
    }

    function enableRevision() {
      const source = revisionClient()
      expect(source.topicHistoryRevision).toBeTypeOf('function')
      return source
    }

    function contextInput(topicId = 'topic-a', requestedSessionId = 'pi-prepared') {
      return { topicId, requestedSessionId, database }
    }

    function deferred<T>() {
      let resolve!: (value: T | PromiseLike<T>) => void
      const promise = new Promise<T>(complete => { resolve = complete })
      return { promise, resolve }
    }

    it('holds all business recovery writes until adoption and reuses restored memory without another restore', async () => {
      await addCanonical('warm-user', 'detached history')
      await (client as WorkerDatabaseClient).finalizeSchema()
      const source = enableRevision()
      const revision = await source.topicHistoryRevision!('topic-a')
      const input = contextInput()
      const before = (await client.execute('SELECT * FROM entity_records')).rows
      const insert = vi.spyOn(database, 'insert')
      const update = vi.spyOn(database, 'update')
      const restore = vi.spyOn(SqlitePiSessionStorage.prototype as any, 'restore')
      const read = vi.spyOn(AgentTranscriptRepository.prototype, 'listTranscript')
      await Promise.all([SqlitePiSessionStorage.prepareContext(input), SqlitePiSessionStorage.prepareContext(input)])
      expect(restore).toHaveBeenCalledTimes(1)
      expect(read).toHaveBeenCalledTimes(1)
      expect(insert).not.toHaveBeenCalled()
      expect(update).not.toHaveBeenCalled()
      expect((await client.execute('SELECT * FROM entity_records')).rows).toEqual(before)
      expect((await client.execute('SELECT * FROM pi_sessions')).rows).toEqual([])
      expect((await client.execute('SELECT * FROM pi_session_entries')).rows).toEqual([])
      expect(await source.topicHistoryRevision!('topic-a')).toBe(revision)
      expect(await SqlitePiSessionStorage.adoptPreparedContext(input)).toBe(true)
      const storage = await open('ignored-after-adoption')
      expect(await storage.getMetadata()).toMatchObject({ id: 'pi-prepared' })
      expect((await new Session(storage).buildContext()).messages.map(message => message.content)).toEqual(['detached history'])
      expect(restore).toHaveBeenCalledTimes(1)
      expect(read).toHaveBeenCalledTimes(1)
      expect((storage as any).recoveryWrites).toBeUndefined()
      await settlePersistence()
      expect((await client.execute('SELECT pi_session_id FROM pi_sessions')).rows).toEqual([{ pi_session_id: 'pi-prepared' }])
      expect((await client.execute('SELECT entry_id FROM pi_session_entries')).rows).toHaveLength(1)
      expect((storage as any).state.pendingWrites).toBe(0)
      expect(await SqlitePiSessionStorage.adoptPreparedContext(input)).toBe(false)
    })

    it('can externalize bounded image history without publishing or changing business records', async () => {
      await addCanonical('warm-image', 'image history')
      await new AgentTranscriptRepository(database).upsertPart({ id: 'warm-image-data', sessionId: 'topic-a',
        messageId: 'warm-image', type: 'image', data: { data: Buffer.from('prepared image').toString('base64'), mimeType: 'image/png' } })
      await (client as WorkerDatabaseClient).finalizeSchema()
      const source = enableRevision()
      const revision = await source.topicHistoryRevision!('topic-a')
      const input = { ...contextInput(), metadata: { workspacePath: tempDirectory } }
      const before = (await client.execute('SELECT * FROM entity_records')).rows
      const restore = vi.spyOn(SqlitePiSessionStorage.prototype as any, 'restore')
      await SqlitePiSessionStorage.prepareContext(input)
      expect((await client.execute('SELECT * FROM entity_records')).rows).toEqual(before)
      expect((await client.execute('SELECT * FROM pi_sessions')).rows).toEqual([])
      expect((await client.execute("SELECT name FROM sqlite_temp_master WHERE name LIKE 'pi_history_images_%'")).rows).toEqual([])
      expect(await source.topicHistoryRevision!('topic-a')).toBe(revision)
      expect(await SqlitePiSessionStorage.adoptPreparedContext(input)).toBe(true)
      const storage = await open()
      const entries = await storage.getEntries()
      const reference = (entries[0] as any).message.content.find((part: any) => part.text?.includes('Previously loaded image:')).text
      const file = JSON.parse(/^Previously loaded image: (".*?")\./.exec(reference)![1])
      expect(await readFile(file, 'utf8')).toBe('prepared image')
      expect(restore).toHaveBeenCalledTimes(1)
    })

    it.each(['absent', 'undefined'] as const)('skips detached work when the revision accessor is %s', async mode => {
      const source = revisionClient()
      const original = source.topicHistoryRevision
      Object.defineProperty(source, 'topicHistoryRevision', { configurable: true, writable: true,
        value: mode === 'absent' ? undefined : vi.fn(async () => undefined) })
      const restore = vi.spyOn(SqlitePiSessionStorage.prototype as any, 'restore')
      try {
        await SqlitePiSessionStorage.prepareContext(contextInput())
        expect(await SqlitePiSessionStorage.adoptPreparedContext(contextInput())).toBe(false)
        expect(restore).not.toHaveBeenCalled()
        expect((await client.execute('SELECT * FROM pi_sessions')).rows).toEqual([])
      } finally {
        if (original) source.topicHistoryRevision = original
        else delete source.topicHistoryRevision
      }
    })

    it.each(['during', 'after'] as const)('rejects a source revision change %s preparation and permits retry', async when => {
      const source = enableRevision()
      const readRevision = source.topicHistoryRevision!.bind(source)
      let changed = false
      const revision = vi.spyOn(source, 'topicHistoryRevision').mockImplementation(async (...args) => `${await readRevision(...args)}:${changed}`)
      const original = (SqlitePiSessionStorage.prototype as any).restore
      const restore = vi.spyOn(SqlitePiSessionStorage.prototype as any, 'restore')
      if (when === 'during') {
        restore.mockImplementationOnce(async function (this: any, ...args: any[]) {
          await original.apply(this, args)
          changed = true
        })
      }
      const input = contextInput()
      await SqlitePiSessionStorage.prepareContext(input)
      changed = true
      expect(await SqlitePiSessionStorage.adoptPreparedContext(input)).toBe(false)
      expect((await client.execute('SELECT * FROM pi_sessions')).rows).toEqual([])
      await SqlitePiSessionStorage.prepareContext(input)
      expect(restore).toHaveBeenCalledTimes(2)
      expect(await SqlitePiSessionStorage.adoptPreparedContext(input)).toBe(true)
      await open()
      expect(revision.mock.calls.length).toBeGreaterThanOrEqual(5)
    })

    it('rejects canonical writes made in the real disposable broker after preparation', async () => {
      const source = revisionClient()
      if (!source.topicHistoryRevision) return
      const input = contextInput()
      await SqlitePiSessionStorage.prepareContext(input)
      await addCanonical('new-after-warm', 'new source')
      expect(await SqlitePiSessionStorage.adoptPreparedContext(input)).toBe(false)
      expect((await client.execute('SELECT * FROM pi_sessions')).rows).toEqual([])
      await SqlitePiSessionStorage.prepareContext(input)
      expect(await SqlitePiSessionStorage.adoptPreparedContext(input)).toBe(true)
      expect((await new Session(await open()).buildContext()).messages.map(message => message.content)).toEqual(['new source'])
    })

    it('matches only the requested session and canonical workspace, not arbitrary metadata', async () => {
      enableRevision()
      const workspace = path.join(tempDirectory, 'workspace')
      await mkdir(workspace)
      const alias = path.join(tempDirectory, 'workspace-alias')
      await symlink(workspace, alias)
      const input = { ...contextInput(), metadata: { workspacePath: workspace, other: 'prepared' } }
      await SqlitePiSessionStorage.prepareContext(input)
      expect(await SqlitePiSessionStorage.adoptPreparedContext({ ...input, requestedSessionId: 'replacement' })).toBe(false)
      expect(await SqlitePiSessionStorage.adoptPreparedContext({ ...input, metadata: { workspacePath: tempDirectory } })).toBe(false)
      expect(await SqlitePiSessionStorage.adoptPreparedContext({ ...input,
        metadata: { workspacePath: alias, other: 'not-an-identity-field' } })).toBe(true)
      expect((await (await open()).getMetadata()).metadata).toMatchObject({ other: 'prepared' })
    })

    it('evicts a failed preparation and restores again on retry', async () => {
      enableRevision()
      const restore = vi.spyOn(SqlitePiSessionStorage.prototype as any, 'restore')
      restore.mockRejectedValueOnce(new Error('injected detached restore failure'))
      const input = contextInput()
      await expect(SqlitePiSessionStorage.prepareContext(input)).resolves.toBeUndefined()
      expect(await SqlitePiSessionStorage.adoptPreparedContext(input)).toBe(false)
      expect((await client.execute('SELECT * FROM pi_sessions')).rows).toEqual([])
      await SqlitePiSessionStorage.prepareContext(input)
      expect(restore).toHaveBeenCalledTimes(2)
      expect(await SqlitePiSessionStorage.adoptPreparedContext(input)).toBe(true)
      await open()
    })

    it('expires preparations by pruning without timers and admits a fresh preparation', async () => {
      enableRevision()
      const restore = vi.spyOn(SqlitePiSessionStorage.prototype as any, 'restore')
      const now = Date.now()
      const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
      const timers = vi.spyOn(globalThis, 'setTimeout')
      const input = contextInput()
      await SqlitePiSessionStorage.prepareContext(input)
      expect(timers).not.toHaveBeenCalled()
      clock.mockReturnValue(now + 60_001)
      expect(await SqlitePiSessionStorage.adoptPreparedContext(input)).toBe(false)
      expect((await client.execute('SELECT * FROM pi_sessions')).rows).toEqual([])
      await SqlitePiSessionStorage.prepareContext(input)
      expect(restore).toHaveBeenCalledTimes(2)
      expect(await SqlitePiSessionStorage.adoptPreparedContext(input)).toBe(true)
      await open()
    })

    it('bounds pending preparations and serializes restore even while invalid generations are discarded', async () => {
      enableRevision()
      await client.execute("INSERT INTO sessions (id) VALUES ('topic-b'),('topic-c'),('topic-d')")
      const running = deferred<void>()
      const release = deferred<void>()
      let current = true
      const original = (SqlitePiSessionStorage.prototype as any).restore
      const restore = vi.spyOn(SqlitePiSessionStorage.prototype as any, 'restore')
      restore.mockImplementationOnce(async function (this: any, ...args: any[]) {
        running.resolve()
        await release.promise
        return original.apply(this, args)
      })
      const a = { ...contextInput('topic-a', 'pi-a'), isCurrent: () => current }
      const first = SqlitePiSessionStorage.prepareContext(a)
      await running.promise
      const second = SqlitePiSessionStorage.prepareContext(contextInput('topic-b', 'pi-b'))
      await SqlitePiSessionStorage.prepareContext(contextInput('topic-c', 'pi-c'))
      current = false
      const fourth = SqlitePiSessionStorage.prepareContext(contextInput('topic-d', 'pi-d'))
      try {
        await fourth
        expect(restore).toHaveBeenCalledTimes(1)
      } finally {
        release.resolve()
        await Promise.all([first, second])
      }
      expect(restore).toHaveBeenCalledTimes(2)
      expect(await SqlitePiSessionStorage.adoptPreparedContext(a)).toBe(false)
      expect(await SqlitePiSessionStorage.adoptPreparedContext(contextInput('topic-c', 'pi-c'))).toBe(false)
      expect(await SqlitePiSessionStorage.adoptPreparedContext(contextInput('topic-b', 'pi-b'))).toBe(true)
      await SqlitePiSessionStorage.openOrCreate(contextInput('topic-b', 'pi-b'))
      await SqlitePiSessionStorage.prepareContext(contextInput('topic-c', 'pi-c'))
      expect(restore).toHaveBeenCalledTimes(3)
      expect(await SqlitePiSessionStorage.adoptPreparedContext(contextInput('topic-c', 'pi-c'))).toBe(true)
      await SqlitePiSessionStorage.openOrCreate(contextInput('topic-c', 'pi-c'))
    })

    it('aborts pending adoption promptly without cancelling preparation or another adopter', async () => {
      enableRevision()
      const running = deferred<void>()
      const release = deferred<void>()
      const original = (SqlitePiSessionStorage.prototype as any).restore
      const restore = vi.spyOn(SqlitePiSessionStorage.prototype as any, 'restore')
      restore.mockImplementationOnce(async function (this: any, ...args: any[]) {
        running.resolve()
        await release.promise
        return original.apply(this, args)
      })
      const input = contextInput()
      const preparation = SqlitePiSessionStorage.prepareContext(input)
      await running.promise
      const controller = new AbortController()
      const adoption = SqlitePiSessionStorage.adoptPreparedContext({ ...input, signal: controller.signal })
      const reason = new Error('sender cancelled')
      const aborted = expect(adoption).rejects.toBe(reason)
      controller.abort(reason)
      try {
        await aborted
        expect((await client.execute('SELECT * FROM pi_sessions')).rows).toEqual([])
      } finally {
        release.resolve()
        await preparation
      }
      expect((await client.execute('SELECT * FROM pi_sessions')).rows).toEqual([])
      expect(await SqlitePiSessionStorage.adoptPreparedContext(input)).toBe(true)
      await open()
      expect(restore).toHaveBeenCalledTimes(1)
    })

    it('never publishes a late aborted adopter after its source revision check finishes', async () => {
      const source = enableRevision()
      const input = contextInput()
      await SqlitePiSessionStorage.prepareContext(input)
      const checking = deferred<void>()
      const release = deferred<void>()
      const originalRevision = source.topicHistoryRevision!.bind(source)
      const revision = vi.spyOn(source, 'topicHistoryRevision').mockImplementationOnce(async (...args) => {
        checking.resolve()
        await release.promise
        return originalRevision(...args)
      })
      const controller = new AbortController()
      const adoption = SqlitePiSessionStorage.adoptPreparedContext({ ...input, signal: controller.signal })
      await checking.promise
      const aborted = expect(adoption).rejects.toMatchObject({ name: 'AbortError' })
      controller.abort()
      try {
        await aborted
      } finally {
        release.resolve()
      }
      // This retry queues behind the abandoned adopter and proves its late
      // completion did not claim the topic or cancel the shared warm state.
      expect(await SqlitePiSessionStorage.adoptPreparedContext(input)).toBe(true)
      await open()
      expect(revision).toHaveBeenCalledTimes(2)
    })

    it.each(['during preparation', 'during adoption'] as const)('rejects an invalidated generation %s', async when => {
      const source = enableRevision()
      let current = true
      const input = { ...contextInput(), isCurrent: () => current }
      if (when === 'during preparation') {
        const original = (SqlitePiSessionStorage.prototype as any).restore
        const restore = vi.spyOn(SqlitePiSessionStorage.prototype as any, 'restore')
        restore.mockImplementationOnce(async function (this: any, ...args: any[]) {
          await original.apply(this, args)
          current = false
        })
      }
      await SqlitePiSessionStorage.prepareContext(input)
      if (when === 'during adoption') {
        const originalRevision = source.topicHistoryRevision!.bind(source)
        vi.spyOn(source, 'topicHistoryRevision').mockImplementationOnce(async (...args) => {
          current = false
          return originalRevision(...args)
        })
      }
      expect(await SqlitePiSessionStorage.adoptPreparedContext(input)).toBe(false)
      expect((await client.execute('SELECT * FROM pi_sessions')).rows).toEqual([])
    })

    it('keeps prepared history across unrelated topic writes and session metadata puts', async () => {
      enableRevision()
      await client.execute("INSERT INTO sessions (id) VALUES ('topic-b')")
      await addCanonical('prepared-user', 'history to reuse')
      const input = contextInput()
      const restore = vi.spyOn(SqlitePiSessionStorage.prototype as any, 'restore')
      await SqlitePiSessionStorage.prepareContext(input)
      await new AgentTranscriptRepository(database).upsertMessage({ id: 'other-user', sessionId: 'topic-b', role: 'user', status: 'completed' })
      // This fixture's sessions schema contains only its id. An ordinary put is
      // the same command category used by model/telemetry metadata updates.
      await client.execute("UPDATE sessions SET id=id WHERE id='topic-a'")
      expect(await SqlitePiSessionStorage.adoptPreparedContext(input)).toBe(true)
      expect((await new Session(await open()).buildContext()).messages.map(message => message.content)).toEqual(['history to reuse'])
      expect(restore).toHaveBeenCalledTimes(1)
      expect(storageLogger.info).toHaveBeenCalledWith('[PiPrewarm] outcome', expect.objectContaining({ topicId: 'topic-a', phase: 'adopted' }))
    })

    it('runs a pending foreground cold open ahead of unrelated background preparations', async () => {
      enableRevision()
      await client.execute("INSERT INTO sessions (id) VALUES ('topic-b'),('topic-c'),('topic-d')")
      const started = deferred<void>()
      const release = deferred<void>()
      const aQueued = deferred<void>()
      const bQueued = deferred<void>()
      const order: string[] = []
      let active = 0
      const original = (SqlitePiSessionStorage.prototype as any).restore
      vi.spyOn(SqlitePiSessionStorage.prototype as any, 'restore').mockImplementation(async function (this: any, ...args: any[]) {
        expect(active++).toBe(0)
        order.push(this.topicId)
        try {
          if (this.topicId === 'topic-d') { started.resolve(); await release.promise }
          return await original.apply(this, args)
        } finally { active-- }
      })
      const running = SqlitePiSessionStorage.openOrCreate(contextInput('topic-d', 'pi-d'))
      await started.promise
      const a = SqlitePiSessionStorage.prepareContext({ ...contextInput(), onQueued: () => aQueued.resolve() })
      const b = SqlitePiSessionStorage.prepareContext({ ...contextInput('topic-b', 'pi-b'), onQueued: () => bQueued.resolve() })
      await Promise.all([aQueued.promise, bQueued.promise])
      const foreground = SqlitePiSessionStorage.openOrCreate(contextInput('topic-c', 'pi-c'))
      // The injected database open yields once before registering its queue task.
      await Promise.resolve(); await Promise.resolve()
      release.resolve()
      await Promise.all([running, a, b, foreground])
      expect(order).toEqual(['topic-d', 'topic-c', 'topic-a', 'topic-b'])
      expect(active).toBe(0)
    })

    it('promotes the selected pending preparation without restoring it twice', async () => {
      enableRevision()
      await client.execute("INSERT INTO sessions (id) VALUES ('topic-b'),('topic-d')")
      const started = deferred<void>()
      const release = deferred<void>()
      const aQueued = deferred<void>()
      const bQueued = deferred<() => () => void>()
      const order: string[] = []
      const original = (SqlitePiSessionStorage.prototype as any).restore
      vi.spyOn(SqlitePiSessionStorage.prototype as any, 'restore').mockImplementation(async function (this: any, ...args: any[]) {
        order.push(this.topicId)
        if (this.topicId === 'topic-d') { started.resolve(); await release.promise }
        return original.apply(this, args)
      })
      const running = SqlitePiSessionStorage.openOrCreate(contextInput('topic-d', 'pi-d'))
      await started.promise
      const a = SqlitePiSessionStorage.prepareContext({ ...contextInput(), onQueued: () => aQueued.resolve() })
      const selectedInput = contextInput('topic-b', 'pi-b')
      const b = SqlitePiSessionStorage.prepareContext({ ...selectedInput, onQueued: promote => bQueued.resolve(promote) })
      const [, promote] = await Promise.all([aQueued.promise, bQueued.promise])
      const releaseForeground = promote()
      release.resolve()
      await Promise.all([running, b])
      expect(order).toEqual(['topic-d', 'topic-b'])
      try {
        expect(await SqlitePiSessionStorage.adoptPreparedContext(selectedInput)).toBe(true)
        await SqlitePiSessionStorage.openOrCreate(selectedInput)
        expect(order).toEqual(['topic-d', 'topic-b'])
      } finally { releaseForeground() }
      await a
      expect(order).toEqual(['topic-d', 'topic-b', 'topic-a'])
      expect(order.filter(topic => topic === 'topic-b')).toHaveLength(1)
    })

    it('rejects a durable session ID claimed by another topic without an in-process owner', async () => {
      enableRevision()
      await client.execute("INSERT INTO sessions (id) VALUES ('topic-b')")
      const input = contextInput('topic-a', 'durable-claimed-id')
      await SqlitePiSessionStorage.prepareContext(input)
      await client.execute("INSERT INTO pi_sessions(topic_id,pi_session_id,created_at,metadata_json,updated_at) VALUES ('topic-b','durable-claimed-id','now','{}','now')")
      expect(await SqlitePiSessionStorage.adoptPreparedContext(input)).toBe(false)
      expect(storageLogger.info).toHaveBeenCalledWith('[PiPrewarm] outcome', expect.objectContaining({ topicId: 'topic-a', phase: 'discarded', reason: 'owner_conflict' }))
      expect((await client.execute("SELECT * FROM pi_sessions WHERE topic_id='topic-a'")).rows).toEqual([])
    })

    it('does not reserve the detached session ID and rechecks its owner at adoption', async () => {
      const source = enableRevision()
      // Hold the revision constant to exercise the owner guard independently.
      vi.spyOn(source, 'topicHistoryRevision').mockResolvedValue('owner-test-revision')
      await client.execute("INSERT INTO sessions (id) VALUES ('topic-b')")
      const input = contextInput('topic-a', 'shared-session')
      await SqlitePiSessionStorage.prepareContext(input)
      const other = await SqlitePiSessionStorage.openOrCreate(contextInput('topic-b', 'shared-session'))
      expect((await other.getMetadata()).id).toBe('shared-session')
      expect(await SqlitePiSessionStorage.adoptPreparedContext(input)).toBe(false)
      expect((await client.execute("SELECT * FROM pi_sessions WHERE topic_id='topic-a'")).rows).toEqual([])
    })

    it('does not overwrite an ordinary open queued while adoption is awaiting its revision', async () => {
      const source = enableRevision()
      const input = contextInput()
      await SqlitePiSessionStorage.prepareContext(input)
      const checking = deferred<void>()
      const release = deferred<void>()
      const originalRevision = source.topicHistoryRevision!.bind(source)
      vi.spyOn(source, 'topicHistoryRevision').mockImplementationOnce(async (...args) => {
        checking.resolve()
        await release.promise
        return originalRevision(...args)
      })
      const adoption = SqlitePiSessionStorage.adoptPreparedContext(input)
      await checking.promise
      const ordinary = open('ordinary-race-winner')
      // open publishes its topic Promise before its queued restore can start.
      await Promise.resolve()
      release.resolve()
      expect(await adoption).toBe(false)
      expect((await (await ordinary).getMetadata()).id).toBe('ordinary-race-winner')
      expect(await SqlitePiSessionStorage.adoptPreparedContext(input)).toBe(false)
      await settlePersistence()
      expect((await client.execute('SELECT pi_session_id FROM pi_sessions')).rows).toEqual([{ pi_session_id: 'ordinary-race-winner' }])
    })

    it('leaves ordinary open independent and skips preparation/adoption for an existing topic', async () => {
      enableRevision()
      const input = contextInput()
      const restore = vi.spyOn(SqlitePiSessionStorage.prototype as any, 'restore')
      await SqlitePiSessionStorage.prepareContext(input)
      const storage = await open('ordinary-session')
      expect(restore).toHaveBeenCalledTimes(2)
      expect((await storage.getMetadata()).id).toBe('ordinary-session')
      expect(await SqlitePiSessionStorage.adoptPreparedContext(input)).toBe(false)
      await SqlitePiSessionStorage.prepareContext(input)
      expect(restore).toHaveBeenCalledTimes(2)
      expect((await (await open('ignored')).getMetadata()).id).toBe('ordinary-session')
    })
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
    expect(client.closed).toBe(false)
    expect((await client.execute('SELECT 1 AS alive')).rows[0].alive).toBe(1)
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
      const maximum = limit === 'tasks' ? PI_PERSISTENCE_LIMITS.tasks + 1
        : Math.ceil(PI_PERSISTENCE_LIMITS.bytes / Buffer.byteLength(text)) + 1
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

  it('restores two generated context checkpoints from SQLite after cold worker restarts without stale-usage recompaction', async () => {
    const model: Parameters<typeof createContextCompactor>[0]['model'] = {
      id: 'model', name: 'Storage compaction test', api: 'openai-completions', provider: 'provider',
      baseUrl: 'https://unused.invalid/v1', reasoning: false, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 20_000, maxTokens: 2000
    }
    let checkpointText = ''
    const completeSimple = vi.fn<Models['completeSimple']>().mockImplementation(async () => assistantMessage(checkpointText))
    const log = vi.fn()
    const makeCompactor = (session: Session) => createContextCompactor({
      core: agentCore, models: { completeSimple } as unknown as Models, isRetryableAssistantError, model, session,
      systemPrompt: '', tools: [], log
    })
    await (client as WorkerDatabaseClient).finalizeSchema()
    let storage = await open()
    let session = new Session(storage)
    const originalUsageEntries: string[] = []

    for (const turn of [1, 2]) {
      checkpointText = turn === 1
        ? 'Checkpoint one: preserve the original goal and /tmp/first.txt.'
        : 'Checkpoint two: preserve the original goal, /tmp/first.txt and /tmp/second.txt.'
      const callsBefore = completeSimple.mock.calls.length
      await session.appendMessage(assistantMessage(`OLD-HISTORY-${turn} ${'x'.repeat(32_000)}`))
      const current = userMessage(`CURRENT REQUEST ${turn}: keep this verbatim`)
      await session.appendMessage(current)
      const response = assistantMessage(`RETAINED ANSWER ${turn}`)
      response.usage = { ...response.usage, input: 18_000, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 18_000 }
      originalUsageEntries.push(await session.appendMessage(response))
      const projected = await makeCompactor(session).project((await session.buildContext()).messages)
      const callsAfter = completeSimple.mock.calls.length
      expect(callsAfter).toBeGreaterThan(callsBefore)
      expect(projected.map(message => message.role)).toEqual(['compactionSummary', 'user', 'assistant'])
      expect(projected[0]).toMatchObject({ summary: expect.stringContaining(turn === 1 ? 'Checkpoint one' : 'Checkpoint two') })
      expect(projected.slice(1)).toEqual([
        current,
        { ...response, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: response.usage.cost } }
      ])
      if (turn === 2) expect(JSON.stringify(completeSimple.mock.calls[callsBefore][1])).toContain('Checkpoint one')
      const checkpoints = await storage.findEntries('compaction')
      expect(checkpoints).toHaveLength(turn)
      expect(checkpoints.at(-1)).toMatchObject({
        retainedTail: projected.slice(1), fromHook: true,
        details: { policy: 'pre-request-70-percent', chunks: callsAfter - callsBefore }
      })
      const expectedContext = await session.buildContext()
      const leaf = await storage.getLeafId()
      await settlePersistence()
      const diskCheckpoints = await client.execute("SELECT entry_json FROM pi_session_entries WHERE entry_type='compaction' ORDER BY sequence")
      expect(diskCheckpoints.rows.map(row => JSON.parse(String(row.entry_json)))).toEqual(checkpoints)

      // The topic cache is keyed by the Drizzle database object. A fresh worker
      // and wrapper force a cache miss rather than reopening the live memory state.
      const oldState = (storage as any).state
      await (client as WorkerDatabaseClient).closeAsync()
      client = createClient({ url: `file:${path.join(tempDirectory, 'sessions.db')}`, intMode: 'number' })
      database = drizzle(client, { schema })
      storage = await open('ignored-after-restart')
      expect((storage as any).state).not.toBe(oldState)
      expect(await storage.getMetadata()).toMatchObject({ id: 'pi-first', topicId: 'topic-a' })
      expect(await storage.getLeafId()).toBe(leaf)
      expect(await storage.findEntries('compaction')).toEqual(checkpoints)
      session = new Session(storage)
      const restored = await session.buildContext()
      expect(restored).toEqual(expectedContext)
      expect(restored.messages.filter(message => message.role === 'compactionSummary')).toHaveLength(1)
      for (const id of originalUsageEntries) {
        expect(await storage.getEntry(id)).toMatchObject({ type: 'message', message: { usage: { totalTokens: 18_000 } } })
      }
      log.mockClear()
      const restoredCompactor = makeCompactor(session)
      expect(await restoredCompactor.project(restored.messages)).toBe(restored.messages)
      expect(await restoredCompactor.project((await session.buildContext()).messages)).toEqual(restored.messages)
      expect(completeSimple).toHaveBeenCalledTimes(callsAfter)
      expect(await storage.findEntries('compaction')).toEqual(checkpoints)
      expect(log).toHaveBeenCalledWith('budget', expect.objectContaining({ latestUsageTokens: 0 }))
      expect(restoredCompactor.getFailure()).toBeUndefined()
    }
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

  it.each([
    ['invalid JSON', '{broken', 'error'],
    ['missing message', JSON.stringify({ blocks: [] }), 'error'],
    ['missing message ID', JSON.stringify({ message: { role: 'user' } }), 'error'],
    ['scalar message', JSON.stringify({ message: 'not a message' }), 'error'],
    ['invalid role', JSON.stringify({ message: { id: 'bad', role: 'event' } }), 'error'],
    ['system record', JSON.stringify({ message: { id: 'system', role: 'system' } }), 'empty'],
    ['tool without result', JSON.stringify({ message: { id: 'tool', role: 'tool' }, blocks: [] }), 'empty'],
    ['completed tool result', JSON.stringify({ message: { id: 'tool', role: 'tool' }, blocks: [
      { type: 'tool', status: 'success', content: 'result' }
    ] }), 'present']
  ])('validates lightweight legacy probe: %s', async (_label, content, outcome) => {
    await client.execute({ sql: 'INSERT INTO session_messages(id,session_id,role,content,created_at,updated_at) VALUES (?,?,?,?,?,?)',
      args: [1, 'topic-a', 'user', content, '2026-01-01', '2026-01-01'] })
    await useOverlay()
    const run = vi.spyOn(database, 'run')
    const probe = SqlitePiSessionStorage.hasDurableConversation({ topicId: 'topic-a', database })
    if (outcome === 'error') await expect(probe).rejects.toThrow('invalid or unsupported message payload')
    else await expect(probe).resolves.toBe(outcome === 'present')
    expect(run).not.toHaveBeenCalled()
  })

  it('does not hide corrupt legacy records behind valid canonical history', async () => {
    await addCanonical('valid-user', 'question')
    await client.execute({ sql: 'INSERT INTO session_messages(id,session_id,role,content,created_at,updated_at) VALUES (?,?,?,?,?,?)',
      args: [1, 'topic-a', 'user', '{broken', '2026-01-01', '2026-01-01'] })
    await useOverlay()
    await expect(SqlitePiSessionStorage.hasDurableConversation({ topicId: 'topic-a', database }))
      .rejects.toThrow('invalid or unsupported message payload')
  })

  it.each(['system', 'tool'])('does not count unconvertible canonical %s records', async role => {
    await new AgentTranscriptRepository(database).upsertMessage({
      id: 'nonchat', sessionId: 'topic-a', role: role as 'system' | 'tool', status: 'completed'
    })
    await expect(SqlitePiSessionStorage.hasDurableConversation({ topicId: 'topic-a', database })).resolves.toBe(false)
  })

  it('probes unopened overlay history without restoring bodies or requiring a valid workspace', async () => {
    const now = '2026-01-01T00:00:00.000Z'
    await client.execute(`INSERT INTO agent_messages(id, session_id, sequence, role, status, created_at, updated_at)
      VALUES ('previous-user', 'topic-a', 0, 'user', 'completed', '${now}', '${now}')`)
    await useOverlay()
    const all = vi.spyOn(database, 'all')
    const run = vi.spyOn(database, 'run')
    expect(await SqlitePiSessionStorage.hasDurableConversation({
      topicId: 'topic-a', database, workspacePath: '/nonexistent/history-probe-workspace'
    })).toBe(true)
    // The old probe invoked readOverlayPrefix -> image projection TEMP writes,
    // scanned all bodies, and even tried publishing images during startup.
    expect(run).not.toHaveBeenCalled()
    expect(all.mock.calls.length).toBeLessThan(10)
    expect(await SqlitePiSessionStorage.hasDurableConversation({
      topicId: 'topic-a', database, excludeMessageIds: ['previous-user']
    })).toBe(false)
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
