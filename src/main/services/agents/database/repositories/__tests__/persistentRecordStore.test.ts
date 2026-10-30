import { afterEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { existsSync, mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { serialize } from 'node:v8'
import { createRequire } from 'node:module'
import { WorkerDatabaseClient } from '../../workerClient'
import { PersistentRecordStore } from '../../persistentRecordStore'
import { configureDatabase, finalizeRecords } from '../../legacyRecordMigration'
import { initializeRecords, installCurrentView, quote, storedEntities, withMessageConstraints } from '../../recordSchema'
import { RECORD_CONSTRAINT_REVISION } from '../../recordConstraintUpgrade'
import { RECORD_INDEX_VERSION } from '../../recordIndexUpgrade'

const stores: PersistentRecordStore[] = [], directories: string[] = []
function file(): string { const dir = mkdtempSync(path.join(tmpdir(), 'record-upgrade-')); directories.push(dir); return path.join(dir, 'agents.db') }
async function open(filename: string) { const store = await PersistentRecordStore.open(filename, 'bigint'); stores.push(store); return store }
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }) })

it('reports copy totals and finalization stages without losing the progress callback', async () => {
  const filename = file()
  const source = new Database(filename)
  source.exec("CREATE TABLE items(id TEXT PRIMARY KEY,name TEXT); INSERT INTO items VALUES ('a','source')")
  source.close()
  const progress = vi.fn()
  const store = await PersistentRecordStore.open(filename, 'bigint', progress)
  stores.push(store)
  expect(progress.mock.calls.some(([phase, count, total]) => phase === 'copy-baseline' && typeof count === 'number' && total > 0)).toBe(true)
  expect(progress.mock.calls).toContainEqual(['import-records', 1, undefined, 'items'])
  expect(progress.mock.calls.map(([phase]) => phase)).toEqual(expect.arrayContaining(['verify', 'replace-tables', 'publish', 'cleanup']))
  expect(progress.mock.calls.map(([phase]) => phase)).not.toContain('validate-constraints')
})

function oldComplete(filename: string): void {
  const db = new Database(`${filename}.v2.db`)
  try {
    configureDatabase(db)
    const directory = path.resolve('resources/database/drizzle')
    for (const name of readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(path.join(directory, name), 'utf8'))
    db.exec("CREATE TABLE items(id INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB, alias TEXT UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)")
    db.exec("INSERT INTO agents(id,type,name,model,created_at,updated_at) VALUES ('a','x','Agent','model','now','now'); INSERT INTO sessions(id,agent_type,agent_id,name,model,created_at,updated_at) VALUES ('s','x','a','Session','model','now','now'),('other','x','a','Other','model','now','now')")
    db.exec("INSERT INTO agent_messages(id,session_id,sequence,role,status,created_at,updated_at) VALUES ('parent','s',1,'user','completed','now','now'),('child','s',2,'assistant','completed','now','now'),('foreign','other',1,'user','completed','now','now'); UPDATE agent_messages SET parent_message_id='parent' WHERE id='child'")
    db.exec("INSERT INTO agent_message_parts(id,session_id,message_id,sequence,type,data_json,created_at,updated_at) VALUES ('part','s','parent',1,'text','{}','now','now'); INSERT INTO session_messages(session_id,role,content) VALUES ('s','agent','{}')")
    initializeRecords(db)
    db.function('record_written', { varargs: true }, () => null)
    finalizeRecords(db, () => undefined)
    const entities = storedEntities(db)
    for (const entity of entities.filter(entity => ['agent_messages', 'agent_message_parts', 'session_messages'].includes(entity.name))) {
      for (const column of entity.columns) column.notnull = 0
      delete entity.enums
      entity.references = entity.name === 'agent_messages'
        ? [{ table: 'agent_messages', from: 'parent_message_id', to: 'id', on_delete: 'SET NULL' }]
        : entity.name === 'agent_message_parts'
          ? [{ table: 'agent_messages', from: 'message_id', to: 'id', on_delete: 'CASCADE' }] : []
      db.prepare('UPDATE storage_entities SET definition=? WHERE name=?').run(JSON.stringify(entity), entity.name)
    }
    for (const entity of entities) db.exec(`DROP VIEW ${quote(entity.name)}`)
    for (const entity of entities) installCurrentView(db, entity, entities)
    db.exec("UPDATE storage_upgrade SET phase='complete' WHERE version=2; PRAGMA user_version=0")
  } finally { db.close() }
}

describe('complete v2 constraint revision', () => {
  it('upgrades stored definitions and all commands once without changing history or unrelated metadata', async () => {
    const filename = file()
    oldComplete(filename)
    const source = new Database(`${filename}.v2.db`)
    const before = source.prepare('SELECT * FROM entity_records ORDER BY position').all()
    const items = storedEntities(source).find(entity => entity.name === 'items')!
    source.close()
    const store = await open(filename)
    expect(store.startup.migrated).toBe(true)
    expect(store.execute('PRAGMA user_version').rows).toEqual([[BigInt(RECORD_CONSTRAINT_REVISION)]])
    store.close()
    const upgraded = new Database(`${filename}.v2.db`)
    upgraded.function('record_written', { varargs: true }, () => null)
    try {
      expect(upgraded.prepare('SELECT * FROM entity_records ORDER BY position').all()).toEqual(before)
      const entities = storedEntities(upgraded)
      expect(entities.find(entity => entity.name === 'items')).toEqual(items)
      expect(entities.map(withMessageConstraints)).toEqual(entities)
      expect(() => upgraded.exec("UPDATE agent_messages SET role='invalid' WHERE id='child'")).toThrow('enum')
      expect(() => upgraded.exec("UPDATE agent_messages SET created_at=NULL WHERE id='child'")).toThrow('required')
      expect(() => upgraded.exec("UPDATE agent_messages SET parent_message_id='foreign' WHERE id='child'")).toThrow('referenced')
      expect(() => upgraded.exec("UPDATE agent_message_parts SET message_id='foreign' WHERE id='part'")).toThrow('referenced')
      expect(() => upgraded.exec("INSERT INTO session_messages(session_id,role,content) VALUES ('missing','agent','{}')")).toThrow('referenced')
      upgraded.exec("INSERT INTO items(data,alias) VALUES (x'0102','unique')")
      expect(upgraded.prepare('SELECT id,data,created_at FROM items').get()).toMatchObject({ id: 1, data: Buffer.from([1, 2]), created_at: expect.any(String) })
      expect(() => upgraded.exec("INSERT INTO items(alias) VALUES ('unique')")).toThrow('unique')
      upgraded.exec("DELETE FROM agent_messages WHERE id='parent'")
      expect(upgraded.prepare("SELECT session_id,parent_message_id FROM agent_messages WHERE id='child'").get()).toEqual({ session_id: 's', parent_message_id: null })
      expect(upgraded.prepare('SELECT * FROM agent_message_parts').all()).toEqual([])
      upgraded.exec("DELETE FROM sessions WHERE id='s'")
      expect(upgraded.prepare("SELECT * FROM session_messages WHERE session_id='s'").all()).toEqual([])
      expect(upgraded.prepare("SELECT * FROM agent_messages WHERE session_id='s'").all()).toEqual([])
      expect(upgraded.prepare("SELECT id FROM agent_messages WHERE session_id='other'").all()).toEqual([{ id: 'foreign' }])
    } finally { upgraded.close() }
    const reopened = await open(filename)
    expect(reopened.startup.migrated).toBe(false)
    expect(existsSync(`${filename}.v2.db.constraints.importing`)).toBe(false)
  })

  it.each(['constraint-copy', 'constraint-rebuild', 'constraint-verified', 'constraint-publish'])('starts from the original after a failure at %s, ignoring even a revision-marked candidate', async phase => {
    const filename = file()
    oldComplete(filename)
    const before = readFileSync(`${filename}.v2.db`)
    await expect(PersistentRecordStore.open(filename, 'bigint', current => {
      if (current === phase) throw new Error('interrupted constraint upgrade')
    })).rejects.toThrow('interrupted constraint upgrade')
    expect(readFileSync(`${filename}.v2.db`)).toEqual(before)
    const pending = `${filename}.v2.db.constraints.importing`
    expect(existsSync(pending)).toBe(false)
    const stale = new Database(pending)
    stale.exec(`CREATE TABLE stale(value TEXT); INSERT INTO stale VALUES ('must not publish'); PRAGMA user_version=${RECORD_CONSTRAINT_REVISION}`)
    stale.close()
    const restarted = await open(filename)
    expect(restarted.startup.migrated).toBe(true)
    expect(restarted.execute("SELECT name FROM sqlite_master WHERE name='stale'").rows).toEqual([])
    expect(restarted.execute("SELECT id FROM agent_messages WHERE session_id='s' ORDER BY sequence").rows).toEqual([['parent'], ['child']])
    expect(existsSync(pending)).toBe(false)
  })

  it('does not revalidate or repair existing facts but SQLite rejects invalid new writes', async () => {
    const filename = file()
    oldComplete(filename)
    const source = new Database(`${filename}.v2.db`)
    source.exec(`INSERT INTO entity_records(entity_type,entity_key,operation,payload)
      SELECT entity_type,entity_key,'put',json_set(payload,'$.role','invalid') FROM entity_records
      WHERE entity_type='agent_messages' AND json_extract(payload,'$.id')='child' ORDER BY position DESC LIMIT 1`)
    const before = source.prepare('SELECT * FROM entity_records ORDER BY position').safeIntegers().all()
    source.close()
    const progress = vi.fn()
    const store = await PersistentRecordStore.open(filename, 'bigint', progress)
    stores.push(store)
    expect(progress.mock.calls.map(([phase]) => phase)).not.toContain('validate-constraints')
    expect(store.execute("SELECT role FROM agent_messages WHERE id='child'").rows).toEqual([['invalid']])
    const result = new Database(`${filename}.v2.db`, { readonly: true })
    try { expect(result.prepare('SELECT * FROM entity_records ORDER BY position').safeIntegers().all()).toEqual(before) } finally { result.close() }
    expect(() => store.execute("UPDATE agent_messages SET role='another-invalid' WHERE id='parent'")).toThrow('invalid entity enum')
    expect(existsSync(`${filename}.v2.db.constraints.importing`)).toBe(false)
  })

  it('preserves superseded invalid facts, tombstones and native values', async () => {
    const filename = file()
    oldComplete(filename)
    const source = new Database(`${filename}.v2.db`)
    source.function('record_written', { varargs: true }, () => null)
    source.exec("UPDATE agent_messages SET status='old-invalid' WHERE id='child'; UPDATE agent_messages SET status='completed' WHERE id='child'")
    source.exec("INSERT INTO items(id,data,alias) VALUES (9223372036854775806,x'ff00','gone'); DELETE FROM items WHERE alias='gone'")
    const before = source.prepare('SELECT * FROM entity_records ORDER BY position').safeIntegers().all()
    source.close()
    const store = await open(filename)
    store.close()
    const result = new Database(`${filename}.v2.db`, { readonly: true })
    try { expect(result.prepare('SELECT * FROM entity_records ORDER BY position').safeIntegers().all()).toEqual(before) } finally { result.close() }
  })

  it('detects candidate history mutation before publishing', async () => {
    const filename = file()
    oldComplete(filename)
    const before = readFileSync(`${filename}.v2.db`)
    let mutated = false
    await expect(PersistentRecordStore.open(filename, 'bigint', phase => {
      if (phase !== 'constraint-rebuild' || mutated) return
      mutated = true
      const candidate = new Database(`${filename}.v2.db.constraints.importing`)
      try {
        candidate.exec("INSERT INTO entity_records(entity_type,entity_key,operation,payload) VALUES ('items','[7]','delete','{\"id\":7}')")
      } finally { candidate.close() }
    })).rejects.toThrow('changed current rows or history')
    expect(readFileSync(`${filename}.v2.db`)).toEqual(before)
  })

  it('permits reads during backup without transactions or explicit locks', async () => {
    const filename = file()
    oldComplete(filename)
    let readDuringCopy = false
    const restarted = await PersistentRecordStore.open(filename, 'bigint', phase => {
      if (phase !== 'constraint-copy') return
      const other = new Database(`${filename}.v2.db`, { timeout: 0 })
      try {
        expect(other.prepare('SELECT count(*) AS count FROM entity_records').get()).toEqual({ count: expect.any(Number) })
        expect(other.pragma('locking_mode', { simple: true })).toBe('normal')
        readDuringCopy = true
      } finally { other.close() }
    })
    stores.push(restarted)
    expect(readDuringCopy).toBe(true)
    expect(restarted.startup.migrated).toBe(true)
  })

  it('compares giant TEXT/BLOB history in SQLite and only returns scalar difference flags', async () => {
    const filename = file()
    oldComplete(filename)
    const source = new Database(`${filename}.v2.db`)
    source.function('record_written', { varargs: true }, () => null)
    source.exec("INSERT INTO items(id,data,alias) VALUES (1,zeroblob(4194304),replace(hex(zeroblob(2097152)),'0','x')); DELETE FROM items WHERE id=1")
    source.close()
    const prepare = Database.prototype.prepare
    const flags: unknown[] = []
    const spy = vi.spyOn(Database.prototype, 'prepare').mockImplementation(function (sql) {
      const statement = prepare.call(this, sql)
      if (sql.startsWith('SELECT EXISTS(')) {
        const get = statement.get.bind(statement)
        statement.get = ((...args: unknown[]) => {
          const result = get(...args)
          flags.push(result)
          return result
        }) as typeof statement.get
      }
      return statement
    })
    try {
      const store = await open(filename)
      expect(flags.length).toBeGreaterThan(0)
      expect(flags.every(value => Object.keys(value as object).length === 1 && (value as { changed: bigint }).changed === 0n)).toBe(true)
      expect(store.execute("SELECT length(payload) FROM entity_records WHERE entity_type='items' ORDER BY position DESC LIMIT 1").rows[0][0]).toBeGreaterThan(12000000n)
      expect(store.execute('SELECT count(*) FROM items').rows).toEqual([[0n]])
    } finally { spy.mockRestore() }
  })

  it('queues concurrent clients behind the unique broker until the upgraded image is published', async () => {
    const filename = file()
    oldComplete(filename)
    const require = createRequire(path.resolve('package.json'))
    // Compile the current source, rather than accidentally testing an old out/main worker.
    const { build } = createRequire(require.resolve('vite/package.json'))('esbuild')
    const workerPath = path.join(path.dirname(filename), 'databaseWorker.cjs')
    await build({
      entryPoints: [path.resolve('src/main/services/agents/database/databaseWorker.ts')],
      outfile: workerPath, bundle: true, platform: 'node', format: 'cjs',
      plugins: [{ name: 'native-sqlite', setup(build: { onResolve: (options: { filter: RegExp }, callback: () => { path: string; external: boolean }) => void }) {
        build.onResolve({ filter: /^better-sqlite3$/ }, () => ({ path: require.resolve('better-sqlite3'), external: true }))
      } }]
    })
    const clients = [0, 1].map(() => new WorkerDatabaseClient({ url: `file:${filename}`, intMode: 'bigint' }, workerPath))
    try {
      // Submit immediately, before either client observes broker readiness.
      const results = await Promise.all(clients.map((client, index) => client.batch([
        'PRAGMA user_version',
        { sql: 'INSERT INTO items(alias) VALUES (?)', args: [`client-${index}`] }
      ])))
      for (const result of results) expect(result[0].rows[0][0]).toBe(BigInt(RECORD_CONSTRAINT_REVISION))
      expect((await clients[0].execute({ sql: 'SELECT phase FROM storage_upgrade WHERE version=?', args: [RECORD_INDEX_VERSION] })).rows[0].phase).toBe('complete')
      expect((await clients[0].execute('SELECT count(*) FROM items')).rows[0][0]).toBe(2n)
      expect((await clients[1].execute("SELECT count(*) FROM entity_records WHERE entity_type='items'")).rows[0][0]).toBe(2n)
      await expect(clients[1].execute("UPDATE agent_messages SET role='invalid' WHERE id='child'")).rejects.toThrow('enum')
      expect(existsSync(`${filename}.v2.db.constraints.importing`)).toBe(false)
    } finally {
      for (const client of clients.reverse()) await client.closeAsync()
    }
  })

  it('refuses future revisions and prevents business SQL from forging the marker', async () => {
    const filename = file()
    oldComplete(filename)
    const source = new Database(`${filename}.v2.db`)
    source.pragma(`user_version=${RECORD_CONSTRAINT_REVISION + 1}`)
    source.close()
    const before = readFileSync(`${filename}.v2.db`)
    await expect(PersistentRecordStore.open(filename)).rejects.toThrow('Unsupported record constraint revision')
    expect(readFileSync(`${filename}.v2.db`)).toEqual(before)
    const reset = new Database(`${filename}.v2.db`)
    reset.pragma('user_version=0')
    reset.close()
    const store = await open(filename)
    expect(() => store.execute('PRAGMA user_version=0')).toThrow('belongs to the writer')
  })
})

describe('durable record table upgrade', () => {
  it('migrates the complete production schema and retains message history without snapshots', async () => {
    const filename = file()
    const legacy = new Database(filename)
    const directory = path.resolve('resources/database/drizzle')
    for (const name of readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) legacy.exec(readFileSync(path.join(directory, name), 'utf8'))
    legacy.exec("INSERT INTO agents(id,type,name,model,created_at,updated_at) VALUES ('a','x','Agent','model','now','now'); INSERT INTO sessions(id,agent_type,agent_id,name,model,created_at,updated_at) VALUES ('s','x','a','Session','model','now','now')")
    legacy.exec("INSERT INTO agent_messages(id,session_id,sequence,role,status,created_at,updated_at) VALUES ('m','s',1,'user','completed','now','now'); UPDATE agent_messages SET status='interrupted' WHERE id='m'")
    legacy.exec("INSERT INTO migrations VALUES (10002,'legacy',0)")
    legacy.close()
    const store = await open(filename)
    expect(store.execute("SELECT status FROM agent_messages WHERE id='m'").rows).toEqual([['interrupted']])
    expect(store.execute("SELECT count(*) FROM entity_records WHERE entity_type='agent_messages'").rows).toEqual([[2n]])
    expect(store.execute("SELECT name FROM sqlite_master WHERE name IN ('agent_message_events','agent_message_snapshots')").rows).toEqual([])
    expect(store.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").rows).toEqual([['entity_records'], ['migrations'], ['storage_entities'], ['storage_upgrade']])
    store.execute("UPDATE sessions SET name='New session' WHERE id='s'")
    expect(store.execute('SELECT name FROM sessions').rows).toEqual([['New session']])
  })

  it('replaces old tables once and reads committed records after an unclean close', async () => {
    const filename = file()
    const legacy = new Database(filename)
    legacy.exec("CREATE TABLE sessions(id TEXT PRIMARY KEY,name TEXT NOT NULL); INSERT INTO sessions VALUES ('a','old')")
    legacy.close()
    const store = await open(filename)
    expect(store.startup.migrated).toBe(true)
    expect(store.execute("SELECT type FROM sqlite_master WHERE name='sessions'").rows).toEqual([['view']])
    store.execute("UPDATE sessions SET name='new' WHERE id='a'")
    expect(store.execute('SELECT count(*) FROM entity_records').rows).toEqual([[2n]])
    expect(store.execute('SELECT name FROM sessions').rows).toEqual([['new']])
    ;(store as any).db.close() // No graceful store close or checkpoint publication.
    expect(existsSync(filename)).toBe(false)
    const restarted = await open(filename)
    expect(restarted.startup.migrated).toBe(false)
    expect(restarted.execute('SELECT name FROM sessions').rows).toEqual([['new']])
    expect(restarted.execute('SELECT phase FROM storage_upgrade WHERE version=2').rows).toEqual([['complete']])
  })

  it('imports every committed SQL row change once, then no longer needs the old log', async () => {
    const filename = file()
    const baseline = new Database(':memory:')
    baseline.exec("CREATE TABLE sessions(id TEXT PRIMARY KEY,name TEXT); INSERT INTO sessions VALUES ('a','first')")
    const log = new Database(`${filename}.append.db`)
    log.exec('CREATE TABLE append_records(sequence INTEGER PRIMARY KEY,kind TEXT,payload BLOB)')
    const append = log.prepare('INSERT INTO append_records VALUES (?,?,?)')
    append.run(1, 'baseline', serialize(baseline.serialize()))
    append.run(2, 'sql', serialize({ sql: "UPDATE sessions SET name=? WHERE id='a'", args: ['second'], time: '2026-01-01T00:00:00Z', seed: 1 }))
    append.run(3, 'sql', serialize({ sql: "INSERT INTO sessions VALUES ('b','third')", args: [], time: '2026-01-01T00:00:00Z', seed: 2 }))
    log.close(); baseline.close()
    const store = await open(filename)
    expect(store.execute('SELECT id,name FROM sessions ORDER BY id').rows).toEqual([['a', 'second'], ['b', 'third']])
    expect(store.execute("SELECT json_extract(payload,'$.name') FROM entity_records WHERE entity_key='[\"a\"]' ORDER BY position").rows).toEqual([['first'], ['second']])
    store.close(); expect(existsSync(`${filename}.append.db`)).toBe(false)
    const again = await open(filename)
    expect(again.startup.migrated).toBe(false)
    expect(again.execute('SELECT count(*) FROM entity_records').rows).toEqual([[3n]])
  })

  it('preserves native 64-bit integers, blobs and generated defaults through append views', async () => {
    const filename = file()
    const legacy = new Database(filename)
    legacy.exec("CREATE TABLE items(id INTEGER PRIMARY KEY AUTOINCREMENT,data BLOB,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)")
    legacy.close()
    const store = await open(filename)
    const row = store.execute({ sql: 'INSERT INTO items(data) VALUES (?) RETURNING id,created_at', args: [new Uint8Array([1, 2]).buffer] })
    expect(row.rows[0][0]).toBe(1n)
    expect(typeof row.rows[0][1]).toBe('string')
    store.execute('DELETE FROM items WHERE id=1')
    expect(store.execute('INSERT INTO items(data) VALUES(NULL) RETURNING id').rows).toEqual([[2n]])
    store.execute({ sql: 'INSERT INTO items(id,data) VALUES (?,?)', args: [9223372036854775806n, new Uint8Array([3, 4]).buffer] })
    const saved = store.execute('SELECT id,data FROM items WHERE id=9223372036854775806').rows[0]
    expect(saved[0]).toBe(9223372036854775806n)
    expect(new Uint8Array(saved[1])).toEqual(new Uint8Array([3, 4]))
  })

  it('enforces immutable facts, uniqueness and cascade semantics without erasing history', async () => {
    const filename = file()
    const legacy = new Database(filename)
    legacy.exec("PRAGMA foreign_keys=ON; CREATE TABLE parents(id TEXT PRIMARY KEY); CREATE TABLE children(id TEXT PRIMARY KEY,parent_id TEXT REFERENCES parents(id) ON DELETE CASCADE,alias TEXT UNIQUE); INSERT INTO parents VALUES ('p'); INSERT INTO children VALUES ('c','p','x')")
    legacy.close()
    const store = await open(filename)
    store.execute("DELETE FROM parents WHERE id='p'")
    expect(store.execute('SELECT * FROM children').rows).toEqual([])
    expect(store.execute('SELECT count(*) FROM entity_records').rows).toEqual([[4n]])
    expect(() => store.execute('DELETE FROM entity_records')).toThrow('immutable')
    expect(() => store.execute('SELECT 1')).toThrow('stopped')
  })

  it('leaves source data intact when an unknown table cannot be migrated safely', async () => {
    const filename = file()
    const legacy = new Database(filename)
    legacy.exec("CREATE TABLE unknown(content TEXT); INSERT INTO unknown VALUES ('keep')")
    legacy.close()
    await expect(PersistentRecordStore.open(filename)).rejects.toThrow('stable identity')
    const original = new Database(filename, { readonly: true })
    expect(original.prepare('SELECT content FROM unknown').get()).toEqual({ content: 'keep' })
    original.close()
  })

  it('discards failed temporary data and starts again from the unchanged source', async () => {
    const filename = file()
    const legacy = new Database(filename)
    legacy.exec("CREATE TABLE items(id TEXT PRIMARY KEY,name TEXT); INSERT INTO items VALUES ('a','source')")
    legacy.close()
    await expect(PersistentRecordStore.open(filename, 'bigint', phase => {
      if (phase === 'import-records') throw new Error('interrupted migration')
    })).rejects.toThrow('interrupted migration')
    expect(existsSync(`${filename}.v2.db`)).toBe(false)
    expect(existsSync(filename)).toBe(true)
    const pending = new Database(`${filename}.v2.db.importing`)
    pending.exec("INSERT INTO entity_records(entity_type,entity_key,operation,payload) VALUES ('items','[\"fake\"]','put','{\"id\":\"fake\",\"name\":\"partial\"}')")
    pending.close()
    const restarted = await open(filename)
    expect(restarted.execute('SELECT id,name FROM items').rows).toEqual([['a', 'source']])
    expect(restarted.execute('SELECT count(*) FROM entity_records').rows).toEqual([[1n]])
    expect(existsSync(filename)).toBe(false)
    expect(existsSync(`${filename}.v2.db.importing`)).toBe(false)
  })

  it('publishes nothing after a schema failure and reruns the full schema on restart', async () => {
    const filename = file()
    const first = await open(filename)
    expect(existsSync(`${filename}.v2.db`)).toBe(false)
    expect(() => first.applyMigration(0, 'broken', 'CREATE TABLE migrations(version INTEGER PRIMARY KEY,tag TEXT,executed_at INTEGER); CREATE TABLE items(id TEXT PRIMARY KEY); INSERT INTO missing VALUES (1)')).toThrow()
    first.close()
    const restarted = await open(filename)
    expect(restarted.execute("SELECT name FROM sqlite_master WHERE name='items'").rows).toEqual([])
    restarted.applyMigration(0, 'initial', 'CREATE TABLE migrations(version INTEGER PRIMARY KEY,tag TEXT,executed_at INTEGER); CREATE TABLE items(id TEXT PRIMARY KEY)')
    restarted.finalizeSchema()
    expect(existsSync(`${filename}.v2.db`)).toBe(true)
    expect(restarted.execute("SELECT type FROM sqlite_master WHERE name='items'").rows).toEqual([['view']])
  })

  it('builds the complete production schema before publishing a fresh database', async () => {
    const filename = file()
    const store = await open(filename)
    const directory = path.resolve('resources/database/drizzle')
    const journal = JSON.parse(readFileSync(path.join(directory, 'meta/_journal.json'), 'utf8')) as { entries: Array<{ idx: number; tag: string }> }
    for (const entry of journal.entries) {
      store.applyMigration(entry.idx, entry.tag, readFileSync(path.join(directory, `${entry.tag}.sql`), 'utf8'))
      expect(existsSync(`${filename}.v2.db`)).toBe(false)
    }
    store.finalizeSchema()
    expect(existsSync(`${filename}.v2.db`)).toBe(true)
    expect(store.execute('PRAGMA integrity_check').rows).toEqual([['ok']])
    store.close()
    const restarted = await open(filename)
    expect(restarted.startup.migrated).toBe(false)
    expect(restarted.execute('SELECT count(*) FROM migrations').rows).toEqual([[BigInt(journal.entries.length)]])
  })
})
