import { afterEach, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { Client } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import * as schema from '../../schema'
import { PersistentRecordStore } from '../../persistentRecordStore'
import { readMessageProjection, resolveMessageProjectionTables } from '../../messageEventStore'

vi.mock('../../DatabaseManager', () => ({ DatabaseManager: class { static getInstance() { throw new Error('Inject the test database') } } }))
import { SqlitePiSessionStorage } from '../piSessionStorage'

const stores: PersistentRecordStore[] = [], directories: string[] = []
const entities = ['agent_messages', 'agent_message_parts', 'session_messages'] as const
const hash = (filename: string) => createHash('sha256').update(readFileSync(filename)).digest('hex')

function adapter(store: PersistentRecordStore, overlayEnabled?: boolean) {
  const queries: Array<{ sql: string; args: any[] }> = []
  const client = { overlayEnabled, execute: async (input: { sql: string; args: any[] }) => {
    queries.push(input)
    const result = store.execute(input)
    const rows = result.rows.map(values => {
      const row = Object.fromEntries(result.columns.map((column, index) => [column, values[index]]))
      Object.defineProperty(row, 'length', { value: values.length })
      values.forEach((value, index) => Object.defineProperty(row, index, { value }))
      return row
    })
    return { ...result, rows }
  } } as unknown as Client
  return { database: drizzle(client, { schema }), queries }
}

async function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'message-overlay-'))
  directories.push(directory)
  const migrationDir = path.resolve('resources/database/drizzle')
  const seed = await PersistentRecordStore.openOverlay(':memory:', 'number', undefined, { legacyPaths: [], migrationDir })
  stores.push(seed)
  seed.execute("INSERT INTO agents(id,type,name,model,created_at,updated_at) VALUES('a','x','Agent','model','now','now')")
  seed.execute("INSERT INTO sessions(id,agent_type,agent_id,name,model,created_at,updated_at) VALUES('old','x','a','Old','model','now','now')")
  seed.execute("INSERT INTO agent_messages(id,session_id,sequence,role,status,created_at,updated_at) VALUES('old-m','old',0,'user','completed','now','now')")
  seed.execute("INSERT INTO agent_message_parts(id,session_id,message_id,sequence,type,data_json,created_at,updated_at) VALUES('old-p','old','old-m',0,'text','{\"text\":\"legacy\"}','now','now')")
  seed.execute("INSERT INTO session_messages(session_id,role,content) VALUES('old','user','legacy')")
  const snapshot = path.join(directory, 'snapshot')
  mkdirSync(path.dirname(snapshot), { recursive: true })
  const manifest = await seed.backupStorage(snapshot)
  const legacy = path.join(snapshot, manifest.database)
  const source = new Database(legacy)
  try {
    // Real pre-session-index v2 used $.id. Leave no message session index.
    const indexes = source.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='entity_records' AND name LIKE 'v2_index_%'").all() as Array<{ name: string }>
    for (const index of indexes) source.exec(`DROP INDEX "${index.name}"`)
    for (const entity of [...entities, 'sessions']) source.exec(`CREATE INDEX legacy_${entity}_id ON entity_records(json_extract(payload,'$.id'),position) WHERE entity_type='${entity}'`)
    source.exec(`WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n<30000)
      INSERT INTO entity_records(entity_type,entity_key,operation,payload)
      SELECT 'agent_messages',json_array('unrelated-'||n),'put',json_object('id','unrelated-'||n,'session_id','old','sequence',n,'role','user','status','completed','created_at','now','updated_at','now') FROM numbers;
      CREATE INDEX legacy_pi_topic ON entity_records(json_extract(payload,'$.topic_id'),position) WHERE entity_type='pi_sessions';
      CREATE INDEX legacy_pi_entries_topic ON entity_records(json_extract(payload,'$.topic_id'),position) WHERE entity_type='pi_session_entries';`)
  } finally { source.close() }
  const before = hash(legacy)
  const store = await PersistentRecordStore.openOverlay(path.join(directory, 'new.db'), 'number', undefined, { legacyPaths: [legacy], migrationDir })
  stores.push(store)
  store.execute("INSERT INTO sessions(id,agent_type,agent_id,name,model,created_at,updated_at) VALUES('new','x','a','New','model','now','now')")
  return { store, legacy, before, directory, ...adapter(store, true) }
}

afterEach(() => {
  stores.splice(0).forEach(store => store.close())
  directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true }))
})

it('selects $.id from sqlite_master for old v2 projection indexes without rewriting the source', async () => {
  const f = await fixture(), db = (f.store as any).db as Database.Database
  for (const entity of entities) {
    const sql = db.prepare('SELECT sql FROM sqlite_temp_master WHERE name=?').pluck().get(entity) as string
    expect(sql).toContain("json_extract(e.payload,'$.id')")
    expect(sql).toContain("json_extract(e.payload,'$.\"id\"')") // New branch keeps the new expression.
    const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT id FROM ${entity} WHERE id=?`).all(entity === 'session_messages' ? 4503599627370496 : entity === 'agent_messages' ? 'old-m' : 'old-p') as Array<{ detail: string }>
    expect(plan.some(row => row.detail.includes(`USING INDEX legacy_${entity}_id (<expr>=?)`))).toBe(true)
  }
  const plan = db.prepare('EXPLAIN QUERY PLAN SELECT id FROM overlay_legacy_sessions WHERE id=? LIMIT 1').all('new') as Array<{ detail: string }>
  expect(plan.some(row => row.detail.includes('USING INDEX legacy_sessions_id (<expr>=?)'))).toBe(true)
  expect(plan.some(row => /SCAN e\b/.test(row.detail))).toBe(false)
  f.store.close()
  expect(hash(f.legacy)).toBe(f.before)
})

it('reads all new-session message histories only from main when the old store lacks session indexes', async () => {
  const f = await fixture(), db = (f.store as any).db as Database.Database
  f.store.execute("INSERT INTO agent_messages(id,session_id,sequence,role,status,created_at,updated_at) VALUES('new-m','new',0,'user','completed','now','now')")
  f.store.execute("INSERT INTO agent_message_parts(id,session_id,message_id,sequence,type,data_json,created_at,updated_at) VALUES('new-p','new','new-m',0,'text','{\"text\":\"new text\"}','now','now')")
  f.store.execute("INSERT INTO session_messages(session_id,role,content) VALUES('new','user','new history')")
  f.queries.length = 0
  for (const entity of entities) {
    const rows = await readMessageProjection<Record<string, any>>(f.database, entity, 'new')
    expect(rows).toHaveLength(1)
    expect(rows[0].session_id).toBe('new')
    if (entity === 'agent_message_parts') expect(rows[0].data_json).toEqual({ text: 'new text' })
    const view = `overlay_new_${entity}`
    expect(f.queries.some(query => query.sql.includes(`FROM "${view}"`))).toBe(true)
    expect(db.prepare('SELECT sql FROM sqlite_temp_master WHERE name=?').pluck().get(view)).not.toContain('overlay_source_')
    const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT * FROM ${view} WHERE session_id=?`).all('new') as Array<{ detail: string }>
    expect(plan.filter(row => /SEARCH e USING INDEX v2_index_/.test(row.detail))).toHaveLength(1)
    expect(plan.some(row => /SCAN e\b/.test(row.detail))).toBe(false)
  }
  f.store.execute("DELETE FROM agent_messages WHERE id='new-m'")
  expect(await readMessageProjection(f.database, 'agent_messages', 'new')).toEqual([])
  expect(await readMessageProjection(f.database, 'agent_message_parts', 'new')).toEqual([])
  expect((await resolveMessageProjectionTables(f.database, 'old')).agent_messages).toBe('agent_messages')
  expect(await readMessageProjection<Record<string, any>>(f.database, 'agent_message_parts', 'old')).toMatchObject([{ id: 'old-p', data_json: { text: 'legacy' } }])
  // Continuing an old session still includes both its old and new rows.
  f.store.execute("INSERT INTO agent_message_parts(id,session_id,message_id,sequence,type,data_json,created_at,updated_at) VALUES('continued-p','old','old-m',1,'text','{\"text\":\"continued\"}','now','now')")
  expect(await readMessageProjection(f.database, 'agent_message_parts', 'old')).toHaveLength(2)
  // New-only selection is not a permanent ownership cache.
  expect((await resolveMessageProjectionTables(f.database, 'later-old')).agent_messages).toBe('overlay_new_agent_messages')
  const writer = new Database(f.legacy)
  try { writer.exec(`INSERT INTO entity_records(entity_type,entity_key,operation,payload) VALUES('sessions','["later-old"]','delete','{"id":"later-old"}')`) }
  finally { writer.close() }
  expect((await resolveMessageProjectionTables(f.database, 'later-old')).agent_messages).toBe('agent_messages')
})

it('routes PI canonical hydration and hidden-message history JOINs through new-only message views', async () => {
  const f = await fixture()
  f.store.execute("INSERT INTO agent_messages(id,session_id,sequence,role,status,semantics_json,created_at,updated_at) VALUES('visible','new',0,'user','completed',NULL,'now','now'),('hidden','new',1,'assistant','completed','{\"providerVisibility\":\"hidden\"}','now','now')")
  f.store.execute("INSERT INTO agent_message_parts(id,session_id,message_id,sequence,type,data_json,created_at,updated_at) VALUES('text','new','visible',0,'text','{\"text\":\"hello\"}','now','now')")
  f.queries.length = 0
  const pi = await SqlitePiSessionStorage.openOrCreate({ topicId: 'new', database: f.database })
  const entries = await pi.getEntries()
  expect(entries).toHaveLength(1)
  expect(entries[0]).toMatchObject({ type: 'message', message: { role: 'user', content: 'hello' } })
  const leaf = await pi.getLeafId()
  expect(await pi.getPathToRootOrCompaction(leaf)).toHaveLength(1)
  expect(f.queries.some(query => /FROM "overlay_new_agent_messages" m LEFT JOIN "overlay_new_agent_message_parts" p/.test(query.sql))).toBe(true)
  expect(f.queries.some(query => /FROM (?:"?agent_messages"?|"?agent_message_parts"?)(?:\s|$)/.test(query.sql))).toBe(false)
  expect(await SqlitePiSessionStorage.hasDurableConversation({ topicId: 'new', database: f.database })).toBe(true)
  const db = (f.store as any).db as Database.Database
  for (const query of f.queries.filter(query => /FROM "overlay_new_agent_messages" m/.test(query.sql))) {
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${query.sql}`).all(...query.args) as Array<{ detail: string }>
    expect(plan.some(row => /SCAN e\b/.test(row.detail))).toBe(false)
  }
})

it('leaves non-overlay history tables unchanged and never queries a missing TEMP view', async () => {
  const store = await PersistentRecordStore.open('memory:projection', 'number')
  stores.push(store)
  store.execute('CREATE TABLE agent_messages(id TEXT PRIMARY KEY,session_id TEXT,semantics_json TEXT)')
  store.execute("INSERT INTO agent_messages VALUES('plain','s','{\"visible\":true}')")
  const { database, queries } = adapter(store, false)
  expect(await readMessageProjection(database, 'agent_messages', 's')).toEqual([{ id: 'plain', session_id: 's', semantics_json: { visible: true } }])
  expect(queries).toHaveLength(1)
  expect(queries.some(query => /FROM overlay_legacy_sessions|FROM "overlay_new_/.test(query.sql))).toBe(false)
  expect(store.execute('SELECT 1').rows).toEqual([[1]])
  const unknownClient = adapter(store)
  expect(await readMessageProjection(unknownClient.database, 'agent_messages', 's')).toHaveLength(1)
  expect(unknownClient.queries).toHaveLength(2)
})
