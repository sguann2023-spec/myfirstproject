import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'vite'
import { WorkerDatabaseClient } from '../../workerClient'
import type { OverlayOptions } from '../../persistentRecordStore'
import { OVERLAY_INTEGER_START } from '../../recordOverlay'
import { drizzle } from 'drizzle-orm/libsql'
import { eq } from 'drizzle-orm'
import * as schema from '../../schema'
import { initializeRecords } from '../../recordSchema'
import { finalizeRecords } from '../../legacyRecordMigration'
import { readMessageProjection } from '../../messageEventStore'

vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) } }))
vi.mock('@main/utils', () => ({ getResourcePath: () => '/resources', getDataPath: () => tmpdir() }))
vi.mock('electron', () => ({ app: { getPath: () => '/unused' } }))
vi.mock('@shared/parseToolArguments', () => import('../../../../../../packages/shared/parseToolArguments'))
vi.mock('@shared/tokenTelemetry', () => import('../../../../../../packages/shared/tokenTelemetry'))
vi.mock('@shared/userInteraction', () => import('../../../../../../packages/shared/userInteraction'))
vi.mock('../../../BaseService', () => ({ BaseService: class { async getDatabase(): Promise<never> { throw new Error('Test database not injected') } } }))
import { resolveStorageConfiguration } from '../../DatabaseManager'
import { AgentTranscriptRepository } from '../agentTranscriptRepository'
import { agentMessageRepository } from '../../sessionMessageRepository'
import { AgentHistoryService } from '../../agentHistoryService'

const clients: WorkerDatabaseClient[] = []
const directories: string[] = []
const databases: Database.Database[] = []
const TEST_FRAME_BYTES = 8192
let workerPath: string
let lowBudgetWorkerPath: string
let buildDirectory: string
beforeAll(async () => {
  const cache = path.resolve('node_modules/.cache')
  mkdirSync(cache, { recursive: true })
  buildDirectory = mkdtempSync(path.join(cache, 'overlay-worker-'))
  workerPath = path.join(buildDirectory, 'databaseWorker.cjs')
  lowBudgetWorkerPath = path.join(buildDirectory, 'databaseWorker.low-budget.cjs')
  // Build the real current Worker, independently of app build output and mocks.
  for (const lowBudget of [false, true]) {
    let budgetReplaced = false
    await build({ configFile: false, logLevel: 'error', plugins: lowBudget ? [{
      name: 'overlay-worker-test-frame-budget',
      enforce: 'pre',
      transform(source, id) {
        if (id !== path.resolve('src/main/services/agents/database/brokerProtocol.ts')) return
        const declaration = 'const MAX_FRAME_BYTES = 256 * 1024 * 1024'
        if (!source.includes(declaration)) throw new Error('Worker frame budget declaration changed')
        budgetReplaced = true
        return { code: source.replace(declaration, `const MAX_FRAME_BYTES = ${TEST_FRAME_BYTES}`), map: null }
      }
    }] : [], build: {
      target: 'node22', outDir: buildDirectory, emptyOutDir: false, minify: false,
      lib: { entry: path.resolve('src/main/services/agents/database/databaseWorker.ts'), formats: ['cjs'], fileName: () => path.basename(lowBudget ? lowBudgetWorkerPath : workerPath) },
      rollupOptions: { external: ['better-sqlite3', /^node:/] }
    } })
    if (lowBudget) expect(budgetReplaced).toBe(true)
  }
}, 30000)
afterEach(async () => {
  await Promise.all(clients.splice(0).reverse().map(client => client.closeAsync()))
  databases.splice(0).forEach(database => { if (database.open) database.close() })
  directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true }))
})
afterAll(() => { if (buildDirectory) rmSync(buildDirectory, { recursive: true, force: true }) })

function fixture() {
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'overlay-integration-')))
  directories.push(directory)
  const migrationDir = path.join(directory, 'schema')
  mkdirSync(path.join(migrationDir, 'meta'), { recursive: true })
  const schema = 'CREATE TABLE entries(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,data BLOB);'
  writeFileSync(path.join(migrationDir, 'initial.sql'), schema)
  writeFileSync(path.join(migrationDir, 'meta/_journal.json'), JSON.stringify({ entries: [{ idx: 0, tag: 'initial' }] }))
  const legacyPaths = [path.join(directory, 'newer.db'), path.join(directory, 'older.db')]
  for (const [index, filename] of legacyPaths.entries()) {
    const db = new Database(filename)
    db.exec(schema)
    db.prepare('INSERT INTO entries(id,name,data) VALUES(?,?,?)').run(1, index ? 'older' : 'newer', Buffer.from([255, 0]))
    db.prepare('INSERT INTO entries(id,name) VALUES(?,?)').run(index ? 20 : 10, 'source-only')
    db.close()
  }
  return { directory, filename: path.join(directory, 'records.db'), options: { legacyPaths, migrationDir } }
}
function open(filename: string, options?: OverlayOptions, progress?: (phase: string) => void, intMode: 'bigint' | 'number' = 'bigint') {
  const client = new WorkerDatabaseClient({ url: `file:${filename}`, intMode }, workerPath, progress, options)
  clients.push(client)
  return client
}

it('reads ordered legacy sources and persists only new writes/tombstones at the exact records path', async () => {
  const f = fixture()
  const before = f.options.legacyPaths.map(filename => readFileSync(filename))
  const phases: string[] = []
  const owner = open(f.filename, f.options, phase => phases.push(phase))
  await owner.waitUntilReady()
  expect(phases).toContain('overlay-ready')
  expect((await owner.execute('SELECT count(*) AS count FROM entity_records')).rows[0].count).toBe(0n)
  expect((await owner.execute('SELECT name,data FROM entries WHERE id=1')).rows[0].name).toBe('newer')
  expect(new Uint8Array((await owner.execute('SELECT data FROM entries WHERE id=1')).rows[0].data as ArrayBuffer)).toEqual(new Uint8Array([255, 0]))
  await owner.execute("UPDATE entries SET name='continued' WHERE id=1")
  await owner.execute('DELETE FROM entries WHERE id=20')
  expect((await owner.execute("INSERT INTO entries(name) VALUES('new') RETURNING id")).rows[0].id).toBe(OVERLAY_INTEGER_START)
  await owner.closeAsync()
  const again = open(f.filename, f.options)
  expect((await again.execute('SELECT id,name FROM entries ORDER BY id')).rows.map(row => [row.id, row.name])).toEqual([[1n, 'continued'], [10n, 'source-only'], [OVERLAY_INTEGER_START, 'new']])
  expect(existsSync(f.filename + '.v2.db')).toBe(false)
  const records = new Database(f.filename, { readonly: true })
  expect(records.prepare('SELECT count(*) AS count FROM entity_records').get()).toEqual({ count: 3 })
  records.close()
  await again.closeAsync()
  expect(f.options.legacyPaths.map(filename => readFileSync(filename))).toEqual(before)
}, 15000)

it('revises the trusted stamp for main appends and external writes to every attached source, ignoring TEMP work', async () => {
  const f = fixture()
  const owner = open(f.filename, f.options)
  const initial = await owner.historyRevision()
  const topicInitial = await owner.topicHistoryRevision('topic-a')
  expect(typeof topicInitial).toBe('string')
  expect(topicInitial).not.toContain(f.directory)
  expect(await owner.topicHistoryRevision('topic-a')).toBe(topicInitial)
  expect(typeof initial).toBe('string')
  expect(await owner.historyRevision()).toBe(initial)
  expect(initial).not.toContain(f.directory)
  const other = open(f.filename, f.options, undefined, 'number')
  expect(await other.historyRevision()).toBe(initial)
  expect(await other.topicHistoryRevision('topic-a')).toBe(topicInitial)
  const historyTable = 'pi_history_images_0123456789abcdef0123456789abcdef'
  await owner.execute(`CREATE TEMP TABLE "${historyTable}"(doc INTEGER PRIMARY KEY, source_id UNIQUE, body, canonical INTEGER, payload BLOB)`)
  await owner.execute(`INSERT INTO temp."${historyTable}"(doc,body) VALUES(1,'temporary')`)
  await owner.execute(`DROP TABLE temp."${historyTable}"`)
  expect(await owner.historyRevision()).toBe(initial)
  expect(await owner.topicHistoryRevision('topic-a')).toBe(topicInitial)
  await other.execute("INSERT INTO entries(name) VALUES('appended')")
  expect(await owner.topicHistoryRevision('topic-a')).toBe(topicInitial)
  const appended = await owner.historyRevision()
  expect(appended).not.toBe(initial)
  expect(JSON.parse(appended!)[1]).toBe('1')
  let previous = appended
  let topicPrevious = topicInitial
  for (const filename of [f.filename, ...f.options.legacyPaths]) {
    const source = new Database(filename)
    try { source.exec('CREATE TABLE revision_probe(id INTEGER PRIMARY KEY,value INTEGER); INSERT INTO revision_probe VALUES(1,1)') }
    finally { source.close() }
    const revision = await owner.historyRevision()
    expect(typeof revision).toBe('string')
    expect(revision).not.toBe(previous)
    expect(await owner.historyRevision()).toBe(revision)
    const topicRevision = await owner.topicHistoryRevision('topic-a')
    expect(typeof topicRevision).toBe('string')
    expect(topicRevision).not.toBe(topicPrevious)
    expect(await owner.topicHistoryRevision('topic-a')).toBe(topicRevision)
    const writer = new Database(filename)
    try { writer.exec('UPDATE revision_probe SET value=2') }
    finally { writer.close() }
    previous = await owner.historyRevision()
    expect(previous).not.toBe(revision)
    topicPrevious = await owner.topicHistoryRevision('topic-a')
    expect(topicPrevious).not.toBe(topicRevision)
  }
  expect((await owner.execute('SELECT count(*) AS count FROM entity_records')).rows[0].count).toBe(1n)
  expect(JSON.parse(previous!)[2].map(([name]: [string]) => name)).toEqual(['main', 'overlay_source_0', 'overlay_source_1'])
  await other.closeAsync()
  await owner.closeAsync()
  const again = open(f.filename, f.options)
  expect(await again.historyRevision()).not.toBe(previous)
  expect(await again.topicHistoryRevision('topic-a')).not.toBe(topicPrevious)
})

it('shares topic epochs across real clients while ignoring model/stat writes and unrelated history', async () => {
  const f = fixture()
  const options = { legacyPaths: [], migrationDir: path.resolve('resources/database/drizzle') }
  const owner = open(f.filename, options)
  await owner.execute("INSERT INTO agents(id,type,name,model,created_at,updated_at) VALUES('a','x','Agent','model','now','now')")
  for (const topic of ['s', 'other', 'empty']) await owner.execute({
    sql: "INSERT INTO sessions(id,agent_type,agent_id,name,model,created_at,updated_at) VALUES(?,'x','a',?,'model','now','now')", args: [topic, topic]
  })
  const peer = open(f.filename, options, undefined, 'number')
  let revision = await owner.topicHistoryRevision('s')
  expect(typeof revision).toBe('string')
  expect(await peer.topicHistoryRevision('s')).toBe(revision)
  const other = await peer.topicHistoryRevision('other')
  await peer.execute("UPDATE sessions SET model='other-model',configuration='{\"stats\":{\"tokens\":123}}',updated_at='later' WHERE id='s'")
  expect(await owner.topicHistoryRevision('s')).toBe(revision)
  await peer.execute("INSERT INTO agent_messages(id,session_id,sequence,role,status,created_at,updated_at) VALUES('other-message','other',1,'assistant','completed','now','now')")
  expect(await owner.topicHistoryRevision('s')).toBe(revision)
  expect(await peer.topicHistoryRevision('other')).not.toBe(other)
  const unaffected = await peer.topicHistoryRevision('other')
  for (const sql of [
    "INSERT INTO agent_messages(id,session_id,sequence,role,status,created_at,updated_at) VALUES('message','s',1,'assistant','completed','now','now')",
    "UPDATE agent_messages SET semantics_json='{\"edited\":true}' WHERE id='message'",
    "INSERT INTO agent_message_parts(id,session_id,message_id,sequence,type,data_json,created_at,updated_at) VALUES('part','s','message',1,'text','{}','now','now')",
    "UPDATE agent_message_parts SET data_json='{\"text\":\"changed\"}' WHERE id='part'",
    "INSERT INTO session_messages(session_id,role,content,created_at,updated_at) VALUES('s','agent','{}','now','now')",
    "UPDATE session_messages SET content='{\"edited\":true}' WHERE session_id='s'",
    "INSERT INTO pi_sessions(topic_id,pi_session_id,created_at,updated_at) VALUES('s','pi-s','now','now')",
    "UPDATE pi_sessions SET active_leaf_id='entry' WHERE topic_id='s'",
    "INSERT INTO pi_session_entries(topic_id,sequence,entry_id,entry_type,entry_json,created_at) VALUES('s',1,'entry','message','{}','now')",
    "UPDATE pi_session_entries SET entry_json='{\"edited\":true}' WHERE topic_id='s'",
    "INSERT INTO pi_invocation_entries(topic_id,invocation_id,entry_kind,entry_id,created_at) VALUES('s','invocation','user_message','entry','now')",
    "UPDATE pi_invocation_entries SET entry_id='replacement' WHERE topic_id='s'",
    "DELETE FROM pi_invocation_entries WHERE topic_id='s'",
    "DELETE FROM agent_message_parts WHERE id='part'",
    "DELETE FROM agent_messages WHERE id='message'",
    "DELETE FROM session_messages WHERE session_id='s'",
    "DELETE FROM sessions WHERE id='s'"
  ]) {
    await peer.execute(sql)
    const next = await owner.topicHistoryRevision('s')
    expect(next, sql).not.toBe(revision)
    expect(typeof next, sql).toBe('string')
    expect(await peer.topicHistoryRevision('s')).toBe(next)
    expect(await owner.topicHistoryRevision('other'), sql).toBe(unaffected)
    revision = next
  }
  const empty = await owner.topicHistoryRevision('empty')
  await peer.execute("DELETE FROM sessions WHERE id='empty'")
  expect(await owner.topicHistoryRevision('empty')).not.toBe(empty) // No child callbacks to mask the session tombstone.
  await peer.closeAsync()
  await owner.closeAsync()
  const again = open(f.filename, options)
  expect(await again.topicHistoryRevision('s')).not.toBe(revision)
}, 15000)

it('atomically stamps a requested PI session owner without invalidating unrelated topic-only epochs', async () => {
  const f = fixture()
  const options = { legacyPaths: [], migrationDir: path.resolve('resources/database/drizzle') }
  const owner = open(f.filename, options)
  await owner.execute("INSERT INTO agents(id,type,name,model,created_at,updated_at) VALUES('a','x','Agent','model','now','now')")
  for (const topic of ['s', 'other']) await owner.execute({
    sql: "INSERT INTO sessions(id,agent_type,agent_id,name,model,created_at,updated_at) VALUES(?,'x','a',?,'model','now','now')", args: [topic, topic]
  })
  const peer = open(f.filename, options)
  const topicOnly = await owner.topicHistoryRevision('s')
  const requested = await owner.topicHistoryRevision('s', 'requested-id')
  expect(typeof requested).toBe('string')
  expect(await peer.topicHistoryRevision('s', 'requested-id')).toBe(requested)
  await peer.execute("INSERT INTO pi_sessions(topic_id,pi_session_id,created_at,updated_at) VALUES('other','requested-id','now','now')")
  const claimed = await owner.topicHistoryRevision('s', 'requested-id')
  expect(claimed).not.toBe(requested)
  expect(JSON.parse(claimed!).at(-1)).toEqual(['requested-id', ['other', 'requested-id']])
  expect(await owner.topicHistoryRevision('s')).toBe(topicOnly)
  await peer.execute("UPDATE pi_sessions SET metadata_json='{\"recovery\":true}',active_leaf_id='leaf' WHERE topic_id='other'")
  expect(await owner.topicHistoryRevision('s', 'requested-id')).toBe(claimed)
  await peer.execute("UPDATE pi_sessions SET pi_session_id='different-id' WHERE topic_id='other'")
  expect(await owner.topicHistoryRevision('s', 'requested-id')).toBe(requested)
  expect(await owner.topicHistoryRevision('s', 'different-id')).not.toBe(requested)
  expect(await owner.topicHistoryRevision('s')).toBe(topicOnly)
  await peer.execute("DELETE FROM pi_sessions WHERE topic_id='other'")
  expect(await owner.topicHistoryRevision('s', 'requested-id')).toBe(requested)
  expect(await owner.topicHistoryRevision('s')).toBe(topicOnly)
})

it.each(['relational', 'records'] as const)('invalidates both topics when a %s legacy session_messages row is moved', async format => {
  const f = fixture()
  const migrationDir = path.resolve('resources/database/drizzle')
  const filename = path.join(f.directory, 'legacy-messages.db')
  const source = new Database(filename)
  const journal = JSON.parse(readFileSync(path.join(migrationDir, 'meta/_journal.json'), 'utf8'))
  for (const entry of journal.entries) source.exec(readFileSync(path.join(migrationDir, `${entry.tag}.sql`), 'utf8'))
  source.exec("INSERT INTO agents(id,type,name,model,created_at,updated_at) VALUES('a','x','Agent','model','now','now')")
  for (const topic of ['old', 'new']) source.prepare("INSERT INTO sessions(id,agent_type,agent_id,name,model,created_at,updated_at) VALUES(?,'x','a',?,'model','now','now')").run(topic, topic)
  const content = JSON.stringify({ text: 'large legacy body '.repeat(100000) })
  source.prepare("INSERT INTO session_messages(id,session_id,role,content,created_at,updated_at) VALUES(1,'old','agent',?,'now','now')").run(content)
  if (format === 'records') { initializeRecords(source); finalizeRecords(source, () => undefined) }
  source.close()
  const owner = open(f.filename, { legacyPaths: [filename], migrationDir })
  const old = await owner.topicHistoryRevision('old')
  const next = await owner.topicHistoryRevision('new')
  const untouched = await owner.topicHistoryRevision('untouched')
  await owner.execute("UPDATE session_messages SET session_id='new' WHERE id=1")
  expect(await owner.topicHistoryRevision('old')).not.toBe(old)
  expect(await owner.topicHistoryRevision('new')).not.toBe(next)
  expect(await owner.topicHistoryRevision('untouched')).toBe(untouched)
  const oldAfter = await owner.topicHistoryRevision('old')
  const nextAfter = await owner.topicHistoryRevision('new')
  await owner.execute("UPDATE session_messages SET session_id='old' WHERE id=1")
  expect(await owner.topicHistoryRevision('old')).not.toBe(oldAfter)
  expect(await owner.topicHistoryRevision('new')).not.toBe(nextAfter)
  expect(await owner.topicHistoryRevision('untouched')).toBe(untouched)
  expect((await owner.execute("SELECT length(content) AS chars FROM session_messages WHERE session_id='old'")).rows[0].chars).toBe(BigInt(content.length))
}, 15000)

it('does not offer topic stamps when a configured legacy source is unavailable', async () => {
  const f = fixture()
  const owner = open(f.filename, { ...f.options, legacyPaths: [path.join(f.directory, 'missing.db')] })
  expect(await owner.topicHistoryRevision('s')).toBeUndefined()
  expect(owner.closed).toBe(false)
  expect((await owner.execute('SELECT 1')).rows[0][0]).toBe(1n)
})

it('shares equivalent canonical configuration across clients with independent integer modes', async () => {
  const f = fixture()
  const owner = open(f.filename, f.options)
  await owner.waitUntilReady()
  const alias = path.join(f.directory, 'source-alias.db')
  symlinkSync(f.options.legacyPaths[0], alias)
  const schemaAlias = path.join(f.directory, 'schema-alias')
  symlinkSync(f.options.migrationDir, schemaAlias)
  const other = open(f.filename, { legacyPaths: [alias, f.options.legacyPaths[1]], migrationDir: schemaAlias }, undefined, 'number')
  expect((await other.execute('SELECT id FROM entries WHERE id=1')).rows[0].id).toBe(1)
  await other.execute("UPDATE entries SET name='shared' WHERE id=1")
  await other.closeAsync()
  expect((await owner.execute('SELECT id,name FROM entries WHERE id=1')).rows[0]).toEqual({ id: 1n, name: 'shared' })
})

it('isolates a failed history query from concurrent skills/agent reads and later writes', async () => {
  const f = fixture()
  const owner = open(f.filename, f.options)
  await owner.waitUntilReady()
  const other = open(f.filename, f.options)
  await other.waitUntilReady()
  const results = await Promise.allSettled([
    owner.execute("SELECT json_extract('not-json', '$.id')"),
    owner.execute('SELECT name FROM entries WHERE id=1'),
    other.execute('SELECT name FROM entries WHERE id=1')
  ])
  expect(results[0]).toMatchObject({ status: 'rejected', reason: { code: 'SQLITE_ERROR' } })
  expect(results.slice(1).map(result => result.status)).toEqual(['fulfilled', 'fulfilled'])
  expect(owner.closed).toBe(false)
  await expect(owner.execute('SELECT missing_column FROM entries')).rejects.toThrow('no such column')
  await expect(owner.execute('UPDATE main.entity_records SET payload=NULL')).rejects.toThrow('unqualified')
  await expect(owner.execute("INSERT INTO entries(id,name) VALUES(1,'duplicate')")).rejects.toThrow(/identity/)
  await owner.execute("UPDATE entries SET name='still-usable' WHERE id=1")
  expect((await other.execute('SELECT name FROM entries WHERE id=1')).rows[0].name).toBe('still-usable')
})

it.each(['agent_messages', 'agent_message_parts', 'session_messages'] as const)('recovers oversized %s pages through the real low-budget worker and keeps later queries usable', async entity => {
  const f = fixture()
  const numericId = entity === 'session_messages'
  const options = { legacyPaths: [], migrationDir: path.resolve('resources/database/drizzle') }
  const owner = new WorkerDatabaseClient({ url: `file:${f.filename}`, intMode: 'number' }, lowBudgetWorkerPath, undefined, options)
  clients.push(owner)
  await owner.waitUntilReady()
  await owner.execute("INSERT INTO agents(id,type,name,model,created_at,updated_at) VALUES('a','x','Agent','model','now','now')")
  for (const sessionId of ['s', 'other']) {
    await owner.execute({
      sql: "INSERT INTO sessions(id,agent_type,agent_id,name,model,created_at,updated_at) VALUES(?,'x','a',?,'model','now','now')",
      args: [sessionId, sessionId]
    })
    if (entity === 'agent_message_parts') {
      await owner.execute({
        sql: "INSERT INTO agent_messages(id,session_id,sequence,role,status,created_at,updated_at) VALUES(?,?,0,'assistant','completed','now','now')",
        args: [`parent-${sessionId}`, sessionId]
      })
    }
  }
  function messageRow(id: string | number, sessionId: string, index: number, text: string): Record<string, string | number | null | { index: number; text: string }> & { id: string | number } {
    const common = { id, session_id: sessionId, created_at: 'now', updated_at: 'now' }
    const payload = { index, text }
    if (entity === 'agent_messages') return {
      ...common, sequence: index, turn_id: null, parent_message_id: null, role: 'assistant', status: 'completed',
      semantics_json: payload, provider_json: null, usage_json: null, error_json: null, finish_json: null, completed_at: null
    }
    if (entity === 'agent_message_parts') return {
      ...common, message_id: `parent-${sessionId}`, sequence: index, type: 'text', data_json: payload
    }
    return { ...common, agent_session_id: '', role: 'agent', content: JSON.stringify(payload), metadata: null }
  }
  const expected = Array.from({ length: 145 }, (_, index) => messageRow(
    numericId ? Number(OVERLAY_INTEGER_START) + index : `message-${String(index).padStart(3, '0')}`,
    's', index, index < 64 ? 'small' : '\u4f60\u597d\ud83c\udfac'.repeat(400)
  ))
  const otherId = numericId ? Number(OVERLAY_INTEGER_START) + 999 : 'other'
  const otherRow = messageRow(otherId, 'other', 0, 'unrelated')
  for (const row of [...expected, otherRow]) {
    const columns = Object.keys(row)
    await owner.execute({
      sql: `INSERT INTO ${entity}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`,
      args: columns.map(column => {
        const value = row[column]
        if (numericId && column === 'id') return BigInt(value as number)
        if (typeof value === 'string' || typeof value === 'number') return value
        return value === null ? null : JSON.stringify(value)
      })
    })
  }
  // Large rows force a request-only frame error in the real broker.
  await expect(owner.execute({
    sql: `SELECT * FROM ${entity} WHERE session_id=? AND id > ? ORDER BY id LIMIT 64`,
    args: ['s', expected[63].id]
  })).rejects.toMatchObject({ message: 'Database frame exceeds size limit', maxFrameBytes: TEST_FRAME_BYTES, frameBytes: expect.any(Number) })
  const execute = vi.spyOn(owner, 'execute')
  try {
    const orm = drizzle(owner, { schema })
    expect(await readMessageProjection(orm, entity, 's')).toEqual(expected)
    const inputs: unknown[] = execute.mock.calls.map(([input]) => input)
    const pages = inputs.filter((input): input is { sql: string; args: unknown[] } =>
      typeof input === 'object' && input !== null && 'sql' in input && typeof input.sql === 'string'
      && 'args' in input && Array.isArray(input.args) && /ORDER BY id LIMIT \?/.test(input.sql))
    expect(pages[0].args).toEqual(['s', 64])
    const retries = pages.filter(page => page.args.length === 3 && page.args[1] === expected[63].id)
    expect(retries.length).toBeGreaterThan(1)
    expect(retries[retries.length - 1].args[2]).toBe(2)
    for (let index = 1; index < retries.length; index++) {
      expect(retries[index].args[2]).toBe(Number(retries[index - 1].args[2]) / 2)
    }
    expect(pages.some(page => page.args.length === 3 && page.args[1] === expected[143].id)).toBe(true)
    expect(pages.every(page => !/OFFSET/i.test(page.sql))).toBe(true)
    expect(owner.closed).toBe(false)
    expect((await owner.execute(`SELECT count(*) AS count FROM ${entity}`)).rows[0].count).toBe(146)
    expect(await readMessageProjection(orm, entity, 'other')).toEqual([otherRow])
    await owner.execute("UPDATE sessions SET name='after-pagination' WHERE id='s'")
    expect((await owner.execute("SELECT name FROM sessions WHERE id='s'")).rows[0].name).toBe('after-pagination')
  } finally { execute.mockRestore() }
}, 15000)

it.each(['relational', 'records'])('opens v11 %s history with data-migration v10001 without copying old bodies', async format => {
  const f = fixture(), migrationDir = path.resolve('resources/database/drizzle')
  const legacy = path.join(f.directory, 'agents.db')
  const db = new Database(legacy)
  const journal = JSON.parse(readFileSync(path.join(migrationDir, 'meta/_journal.json'), 'utf8'))
  for (const entry of journal.entries.filter((entry: { idx: number }) => entry.idx <= 11)) {
    db.exec(readFileSync(path.join(migrationDir, `${entry.tag}.sql`), 'utf8'))
    db.prepare('INSERT INTO migrations(version,tag,executed_at) VALUES(?,?,?)').run(entry.idx, entry.tag, 1)
  }
  db.exec("INSERT INTO migrations VALUES(10001,'fix_block_references',1)")
  db.exec("INSERT INTO agents(id,type,name,model,created_at,updated_at) VALUES('vectcut_claw_default','x','Agent','model','now','now'); INSERT INTO sessions(id,agent_type,agent_id,name,model,created_at,updated_at) VALUES('s','x','vectcut_claw_default','Session','model','now','now'),('s2','x','vectcut_claw_default','Second','model','now','now')")
  const payload = { message: { id: 'old', role: 'assistant', assistantId: 'vectcut_claw_default', topicId: 'agent-session:s', status: 'success', blocks: ['block-old'] }, blocks: [{ id: 'block-old', messageId: 'old', type: 'main_text', content: 'history '.repeat(100000), status: 'success' }] }
  const content = JSON.stringify(payload)
  db.prepare("INSERT INTO session_messages(session_id,role,content,created_at,updated_at) VALUES('s','agent',?,'2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z')").run(content)
  db.prepare("INSERT INTO session_messages(session_id,role,content,created_at,updated_at) VALUES('s2','agent',?,'2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z')").run(JSON.stringify({ ...payload, message: { ...payload.message, id: 'second' } }))
  db.exec("INSERT INTO skills(id,name,folder_name,source,content_hash,is_enabled,created_at,updated_at) VALUES('skill','Skill','pop-y2k-consumer-12s-storyboard','local','hash',1,1,1)")
  if (format === 'records') { initializeRecords(db); finalizeRecords(db, () => {}) }
  db.close()
  const before = readFileSync(legacy)
  const options = { legacyPaths: [legacy], migrationDir }
  const owner = open(f.filename, options, undefined, 'number')
  const orm = drizzle(owner, { schema })
  const [history, skills, agents] = await Promise.all([
    owner.execute({ sql: 'SELECT * FROM session_messages WHERE session_id=?', args: ['s'] }),
    orm.select().from(schema.skillsTable),
    orm.select().from(schema.agentsTable).where(eq(schema.agentsTable.id, 'vectcut_claw_default'))
  ])
  expect(history.rows[0].content).toBe(content)
  expect(skills[0].folder_name).toBe('pop-y2k-consumer-12s-storyboard')
  expect(agents[0].id).toBe('vectcut_claw_default')
  const database = vi.spyOn(agentMessageRepository, 'getDatabase').mockResolvedValue(orm)
  try {
    const service = new AgentHistoryService(new AgentTranscriptRepository(orm), agentMessageRepository, { readQuestions: async () => [] } as any)
    const first = await service.getHistory('s')
    expect(first.messages.map(item => item.message.id)).toEqual(['old'])
    expect(first.messages[0].blocks[0].content).toBe(payload.blocks[0].content)
    expect((await service.getHistory('s2')).messages.map(item => item.message.id)).toEqual(['second'])
    expect((await owner.execute('SELECT count(*) AS count FROM entity_records')).rows[0].count).toBe(0)
  } finally { database.mockRestore() }
  const nextContent = JSON.stringify({ message: { ...payload.message, id: 'raw-new', blocks: [] }, blocks: [] })
  await owner.execute({ sql: "INSERT INTO session_messages(session_id,role,content) VALUES('s','agent',?)", args: [nextContent] })
  await owner.closeAsync()
  const again = open(f.filename, options, undefined, 'number')
  expect((await again.execute("SELECT content FROM session_messages WHERE session_id='s' ORDER BY id")).rows.map(row => row.content)).toEqual([content, nextContent])
  const reopenedOrm = drizzle(again, { schema })
  const reopenedDatabase = vi.spyOn(agentMessageRepository, 'getDatabase').mockResolvedValue(reopenedOrm)
  try {
    // Verify both compatibility-row and canonical continuations after restart.
    const transcript = new AgentTranscriptRepository(reopenedOrm)
    const service = new AgentHistoryService(transcript, agentMessageRepository, { readQuestions: async () => [] } as any)
    expect((await service.getHistory('s')).messages.map(item => item.message.id)).toEqual(['old', 'raw-new'])
    expect((await service.getHistory('s2')).messages.map(item => item.message.id)).toEqual(['second'])
    await transcript.upsertMessage({ id: 'continued', sessionId: 's2', role: 'assistant', status: 'completed', createdAt: '2026-11-03T00:00:00.000Z' })
    await transcript.upsertPart({ id: 'continued-text', sessionId: 's2', messageId: 'continued', type: 'text', data: { text: 'new answer' } })
    expect((await service.getHistory('s2')).messages.map(item => item.message.id)).toEqual(['second', 'continued'])
    expect((await again.execute("SELECT count(*) AS count FROM entity_records WHERE entity_type='agent_messages' AND json_extract(payload,'$.id')='second'")).rows[0].count).toBe(0)
  } finally { reopenedDatabase.mockRestore() }
  await again.closeAsync()
  expect(readFileSync(legacy)).toEqual(before)
}, 15000)

it('rejects different sources, precedence, schema path and legacy mode without disturbing the owner', async () => {
  const f = fixture()
  const owner = open(f.filename, f.options)
  await owner.waitUntilReady()
  for (const options of [
    { ...f.options, legacyPaths: [] },
    { ...f.options, legacyPaths: [...f.options.legacyPaths].reverse() },
    { ...f.options, migrationDir: path.join(f.directory, 'different-schema') },
    undefined
  ]) {
    const other = open(f.filename, options)
    await expect(other.execute("INSERT INTO entries(name) VALUES('forbidden')")).rejects.toThrow('configuration mismatch')
    await other.closeAsync()
    expect((await owner.execute('SELECT count(*) AS count FROM entity_records')).rows[0].count).toBe(0n)
  }
})

it('returns and restores a self-contained backup suite including committed legacy WAL data', async () => {
  const f = fixture()
  const legacy = new Database(f.options.legacyPaths[0])
  databases.push(legacy)
  legacy.pragma('journal_mode=WAL')
  legacy.prepare('INSERT INTO entries(id,name) VALUES(?,?)').run(30, 'wal-only')
  const before = readFileSync(f.options.legacyPaths[0])
  const walBefore = readFileSync(f.options.legacyPaths[0] + '-wal')
  const owner = open(f.filename, f.options)
  await owner.execute("UPDATE entries SET name='backed-up' WHERE id=1")
  await owner.execute('DELETE FROM entries WHERE id=20')
  const suite = path.join(f.directory, 'backup/Data/record-storage')
  const manifest = await owner.backupStorage(suite)
  expect(manifest).toMatchObject({ format: 'record-overlay-v1', database: 'records.db', legacyPaths: ['legacy/0.db', 'legacy/1.db'] })
  expect(JSON.parse(readFileSync(path.join(suite, 'manifest.json'), 'utf8'))).toEqual(manifest)
  const snapshot = new Database(path.join(suite, 'legacy/0.db'), { readonly: true })
  expect(snapshot.prepare('SELECT name FROM entries WHERE id=30').pluck().get()).toBe('wal-only')
  snapshot.close()
  await owner.closeAsync()
  expect(readFileSync(f.options.legacyPaths[0])).toEqual(before)
  expect(readFileSync(f.options.legacyPaths[0] + '-wal')).toEqual(walBefore)
  legacy.close()
  for (const filename of f.options.legacyPaths) rmSync(filename)
  const restoredUserData = path.join(f.directory, 'restored')
  mkdirSync(path.join(restoredUserData, 'Data'), { recursive: true })
  renameSync(suite, path.join(restoredUserData, 'Data/record-storage'))
  // Stale live paths must not be included when a restored suite exists.
  writeFileSync(path.join(restoredUserData, 'agents.db'), 'not a database')
  const restored = resolveStorageConfiguration(restoredUserData, f.options.migrationDir)
  const reader = open(restored.database, restored.overlayStorage)
  expect((await reader.execute('SELECT id,name FROM entries ORDER BY id')).rows.map(row => [row.id, row.name])).toEqual([[1n, 'backed-up'], [10n, 'source-only'], [30n, 'wal-only']])
  await reader.execute("INSERT INTO entries(name) VALUES('after-restore')")
  expect((await reader.execute('SELECT max(id) AS id FROM entries')).rows[0].id).toBe(OVERLAY_INTEGER_START)
}, 15000)

it('rejects directory backup by a non-owner while the real owner remains available', async () => {
  const f = fixture()
  const owner = open(f.filename, f.options)
  await owner.waitUntilReady()
  const other = open(f.filename, f.options)
  await expect(other.backupStorage(path.join(f.directory, 'forbidden'))).rejects.toThrow('other database owner')
  expect(existsSync(path.join(f.directory, 'forbidden'))).toBe(false)
  expect((await owner.execute('SELECT name FROM entries WHERE id=1')).rows[0].name).toBe('newer')
})
