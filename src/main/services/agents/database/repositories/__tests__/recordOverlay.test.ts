import { afterEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { PersistentRecordStore } from '../../persistentRecordStore'
import { initializeRecords, discoverEntities, installCurrentView } from '../../recordSchema'
import { OVERLAY_INTEGER_START, canonicalPath, guardOverlaySql } from '../../recordOverlay'

const stores: PersistentRecordStore[] = [], directories: string[] = []
const fixture = () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'record-overlay-'))
  directories.push(directory)
  const migrationDir = path.join(directory, 'schema')
  mkdirSync(path.join(migrationDir, 'meta'), { recursive: true })
  const schema = `CREATE TABLE parents(id TEXT PRIMARY KEY,name TEXT NOT NULL);
    CREATE TABLE items(id INTEGER PRIMARY KEY AUTOINCREMENT,parent_id TEXT REFERENCES parents(id) ON DELETE CASCADE,alias TEXT UNIQUE,data BLOB,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`
  writeFileSync(path.join(migrationDir, 'meta', '_journal.json'), JSON.stringify({ entries: [{ idx: 0, tag: 'initial' }] }))
  writeFileSync(path.join(migrationDir, 'initial.sql'), schema)
  const legacy = path.join(directory, 'legacy #?.db'), filename = path.join(directory, 'new.db')
  const db = new Database(legacy)
  db.exec(schema + "INSERT INTO parents VALUES ('p','old'); INSERT INTO items(id,parent_id,alias,data) VALUES (20,'p','old',x'ff00'); INSERT INTO items(id,alias) VALUES(90,'deleted'); DELETE FROM items WHERE id=90;")
  db.close()
  return { directory, migrationDir, legacy, filename }
}
function recordSource(f: ReturnType<typeof fixture>): string {
  const filename = path.join(f.directory, 'indexed-records.db')
  const db = new Database(filename)
  try {
    db.exec(readFileSync(path.join(f.migrationDir, 'initial.sql'), 'utf8'))
    const entities = discoverEntities(db)
    db.exec('DROP TABLE items; DROP TABLE parents')
    initializeRecords(db)
    db.function('record_written', { varargs: true }, () => null)
    for (const entity of entities) {
      db.prepare('INSERT INTO storage_entities VALUES (?,?)').run(entity.name, JSON.stringify(entity))
      installCurrentView(db, entity, entities)
    }
    db.exec(`INSERT INTO parents VALUES('old','old'),('p','parent');
      WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n<30000)
      INSERT INTO entity_records(entity_type,entity_key,operation,payload)
      SELECT 'items',json_array(n),'put',json_object('id',n,'parent_id','old','alias','item-'||n,'data',NULL,'created_at','now') FROM numbers;
      INSERT INTO items(id,parent_id,alias) VALUES(${OVERLAY_INTEGER_START},'p','gone');
      DELETE FROM items WHERE id=${OVERLAY_INTEGER_START};`)
  } finally { db.close() }
  return filename
}
async function open(f: ReturnType<typeof fixture>, legacyPaths: string[] = [f.legacy], filename = f.filename) {
  const store = await PersistentRecordStore.openOverlay(filename, 'bigint', undefined, { legacyPaths, migrationDir: f.migrationDir })
  stores.push(store)
  return store
}
afterEach(() => { stores.splice(0).forEach(store => store.close()); directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })) })

describe('record overlay', () => {
  it('opens the exact new path, creates no imported facts and leaves the source byte-identical', async () => {
    const f = fixture(), before = readFileSync(f.legacy), progress = vi.fn()
    const store = await PersistentRecordStore.openOverlay(f.filename, 'bigint', progress, { legacyPaths: [f.legacy], migrationDir: f.migrationDir })
    stores.push(store)
    expect(store.filename).toBe(f.filename)
    expect(existsSync(f.filename)).toBe(true)
    expect(existsSync(f.filename + '.v2.db')).toBe(false)
    expect(store.startup.migrated).toBe(false)
    expect(store.execute('SELECT count(*) FROM entity_records').rows).toEqual([[0n]])
    expect(store.execute('SELECT name FROM parents').rows).toEqual([['old']])
    expect(progress.mock.calls.map(([phase]) => phase)).toEqual(expect.arrayContaining(['overlay-schema', 'overlay-attach', 'overlay-ready']))
    expect(progress.mock.calls.map(([phase]) => phase).some(phase => /copy|import|verify|cleanup|upgrade/.test(phase))).toBe(false)
    expect(store.execute("SELECT type FROM sqlite_temp_master WHERE name='items'").rows).toEqual([['view']])
    store.close()
    expect(readFileSync(f.legacy)).toEqual(before)
  })

  it('writes updates, continuation rows and persistent tombstones only to the new database', async () => {
    const f = fixture(), before = readFileSync(f.legacy), store = await open(f)
    store.execute("UPDATE parents SET name='continued' WHERE id='p'")
    expect(store.execute("INSERT INTO items(parent_id,alias) VALUES ('p','new') RETURNING id,created_at").rows).toEqual([[OVERLAY_INTEGER_START, expect.any(String)]])
    store.execute('DELETE FROM items WHERE id=20')
    store.close()
    const again = await open(f)
    expect(again.execute('SELECT id,alias FROM items').rows).toEqual([[OVERLAY_INTEGER_START, 'new']])
    expect(again.execute('SELECT name FROM parents').rows).toEqual([['continued']])
    expect(again.execute('SELECT count(*) FROM entity_records').rows).toEqual([[3n]])
    again.execute("DELETE FROM parents WHERE id='p'")
    expect(again.execute('SELECT * FROM items').rows).toEqual([])
    again.close()
    expect(readFileSync(f.legacy)).toEqual(before)
  })

  it('uses merged rows for unique and foreign-key checks', async () => {
    const f = fixture(), store = await open(f)
    expect(() => store.execute("INSERT INTO items(alias) VALUES ('old')")).toThrow('unique')
    const other = await open(f)
    expect(() => other.execute("INSERT INTO items(parent_id,alias) VALUES ('missing','new')")).toThrow('referenced')
  })

  it('keeps BLOBs and giant integer IDs native and never reuses a deleted new ID', async () => {
    const f = fixture(), store = await open(f)
    const value = store.execute('SELECT data FROM items WHERE id=20').rows[0][0]
    expect(new Uint8Array(value)).toEqual(new Uint8Array([255, 0]))
    store.execute('INSERT INTO items(id,alias) VALUES(9223372036854775806,\'giant\')')
    store.execute("DELETE FROM items WHERE alias='giant'")
    expect(store.execute("INSERT INTO items(alias) VALUES ('last') RETURNING id").rows).toEqual([[OVERLAY_INTEGER_START]])
    store.execute('DELETE FROM items WHERE id=' + OVERLAY_INTEGER_START)
    store.close()
    const again = await open(f)
    expect(again.execute("INSERT INTO items(alias) VALUES ('next') RETURNING id").rows).toEqual([[OVERLAY_INTEGER_START + 1n]])
    expect(() => again.execute("INSERT INTO items(id,alias) VALUES(9223372036854775806,'reuse')")).toThrow('already used')
  })

  it('uses attached source expression indexes for empty-session and primary-key filters without virtual scans', async () => {
    const f = fixture(), source = recordSource(f), before = createHash('sha256').update(readFileSync(source)).digest('hex')
    const dbTable = vi.spyOn(Database.prototype, 'table')
    const store = await open(f, [source])
    expect(dbTable).not.toHaveBeenCalled()
    dbTable.mockRestore()
    const connection = (store as any).db as Database.Database
    for (const sql of ["SELECT id FROM items WHERE parent_id='new-session'", 'SELECT alias FROM items WHERE id=12345']) {
      const plan = connection.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as Array<{ detail: string }>
      expect(plan.filter(row => /SEARCH e USING INDEX v2_index_items_\d+ \(<expr>=\?\)/.test(row.detail))).toHaveLength(2)
      expect(plan.some(row => /SCAN e\b|VIRTUAL TABLE|MATERIALIZE/.test(row.detail))).toBe(false)
    }
    expect(store.execute("SELECT id FROM items WHERE parent_id='new-session'").rows).toEqual([])
    expect(store.execute('SELECT alias FROM items WHERE id=12345').rows).toEqual([['item-12345']])
    for (let i = 0; i < 5; i++) store.execute(`INSERT INTO items(parent_id,alias) VALUES('p','new-${i}')`)
    expect(store.execute("SELECT id FROM items WHERE parent_id='p' ORDER BY id").rows).toEqual(Array.from({ length: 5 }, (_, i) => [OVERLAY_INTEGER_START + 1n + BigInt(i)]))
    const triggers = connection.prepare("SELECT sql FROM sqlite_temp_master WHERE type='trigger'").all() as Array<{ sql: string }>
    expect(triggers.every(row => !/\bmax\s*\(/i.test(row.sql))).toBe(true)
    expect(connection.prepare("SELECT sql FROM sqlite_temp_master WHERE name='items'").pluck().get()).toContain('"overlay_source_0".entity_records')
    store.close()
    expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(before)
  })

  it('uses key lookups for legacy and new tombstone collisions and stays safe in number mode', async () => {
    const f = fixture(), source = recordSource(f), store = await PersistentRecordStore.openOverlay(f.filename, 'number', undefined, { legacyPaths: [source], migrationDir: f.migrationDir })
    stores.push(store)
    const first = Number(OVERLAY_INTEGER_START + 1n)
    expect(store.execute("INSERT INTO items(parent_id,alias) VALUES('p','first') RETURNING id").rows).toEqual([[first]])
    expect(Number.isSafeInteger(first)).toBe(true)
    store.execute('DELETE FROM items WHERE id=' + first)
    store.close()
    const again = await open(f, [source])
    expect(again.execute("INSERT INTO items(parent_id,alias) VALUES('p','second') RETURNING id").rows).toEqual([[OVERLAY_INTEGER_START + 2n]])
    expect(() => again.execute(`INSERT INTO items(id,parent_id,alias) VALUES(${OVERLAY_INTEGER_START},'p','reuse-legacy')`)).toThrow('already used')
    const fresh = await open(f, [source])
    const connection = (fresh as any).db as Database.Database
    const collisionPlan = connection.prepare(`EXPLAIN QUERY PLAN SELECT 1 FROM overlay_source_0.entity_records WHERE entity_type='items' AND entity_key=json_array(?)`).all(OVERLAY_INTEGER_START) as Array<{ detail: string }>
    expect(collisionPlan.every(row => !/SCAN/.test(row.detail))).toBe(true)
    connection.prepare("UPDATE storage_overlay_ids SET last_id=? WHERE entity='items'").run(9007199254740990n)
    expect(fresh.execute("INSERT INTO items(alias) VALUES('last-safe') RETURNING id").rows).toEqual([[9007199254740991n]])
    expect(() => fresh.execute("INSERT INTO items(alias) VALUES('exhausted')")).toThrow('namespace exhausted')
  })

  it('matches JSON index paths per legacy entity and keeps quoted BLOB decoding intact', async () => {
    const f = fixture(), source = recordSource(f)
    const db = new Database(source)
    try {
      const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'v2_index_items_%'").all() as Array<{ name: string }>
      for (const index of indexes) db.exec(`DROP INDEX "${index.name}"`)
      db.exec(`CREATE INDEX old_items_id ON entity_records(json_extract(payload,'$.id'),position) WHERE entity_type='items';
        CREATE INDEX old_items_blob ON entity_records(CASE WHEN json_type(payload,'$."data"')='object' THEN unhex(json_extract(payload,'$."data"."$blob"')) ELSE json_extract(payload,'$."data"') END,position) WHERE entity_type='items'`)
      db.function('record_written', { varargs: true }, () => null)
      db.exec("INSERT INTO items(id,parent_id,alias,data) VALUES(40000,'p','blob',x'ff00')")
    } finally { db.close() }
    const before = createHash('sha256').update(readFileSync(source)).digest('hex')
    const store = await open(f, [source])
    expect(new Uint8Array(store.execute('SELECT data FROM items WHERE id=40000').rows[0][0])).toEqual(new Uint8Array([255, 0]))
    for (const [sql, index] of [["SELECT id FROM items WHERE id=40000", 'old_items_id'], ["SELECT id FROM items WHERE data=x'ff00'", 'old_items_blob']]) {
      const plan = store.execute(`EXPLAIN QUERY PLAN ${sql}`).rows.map(row => String(row[3]))
      expect(plan.some(row => row.includes(`USING INDEX ${index} (<expr>=?)`))).toBe(true)
    }
    const connection = (store as any).db as Database.Database
    expect(connection.prepare("SELECT sql FROM sqlite_temp_master WHERE name='parents'").pluck().get()).toContain("$.\"id\"")
    store.close()
    expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(before)
  })

  it('allocates one ID per row and rolls back the counter with a failed multi-row statement', async () => {
    const f = fixture(), store = await open(f)
    expect(store.execute("INSERT INTO items(parent_id,alias) VALUES('p','one'),('p','two') RETURNING id").rows).toEqual([[OVERLAY_INTEGER_START], [OVERLAY_INTEGER_START + 1n]])
    expect(() => store.execute("INSERT INTO items(parent_id,alias) VALUES('p','three'),('missing','four')")).toThrow('referenced')
    store.close()
    const again = await open(f)
    expect(again.execute("INSERT INTO items(parent_id,alias) VALUES('p','three') RETURNING id").rows).toEqual([[OVERLAY_INTEGER_START + 2n]])
  })

  it.each([
    "UPDATE overlay_source_0.parents SET name='bad'",
    "UPDATE /*gap*/ [overlay_source_0] . [parents] SET name='bad'",
    "UPDATE OR REPLACE `overlay_source_0`.`parents` SET name='bad'",
    "INSERT INTO \"overlay_source_0\".\"parents\" VALUES('bad','bad')",
    "REPLACE INTO overlay_source_0.parents VALUES('bad','bad')",
    'DELETE FROM overlay_source_0.parents',
    'WITH x AS (SELECT 1) DELETE FROM overlay_source_0.parents',
    "CREATE TEMP TRIGGER bad AFTER INSERT ON main.entity_records BEGIN DELETE FROM overlay_source_0.parents; END",
    'DROP TABLE overlay_source_0.parents',
    "ATTACH DATABASE 'another.db' AS bad",
    'DETACH overlay_source_0',
    'PRAGMA overlay_source_0.journal_mode=DELETE',
    'PRAGMA "overlay_source_0"."writable_schema"=ON',
    "VACUUM overlay_source_0 INTO 'another.db'",
    'UPDATE main.storage_overlay_ids SET last_id=0',
    'EXPLAIN UPDATE overlay_source_0.parents SET name=\'bad\'',
    'SELECT "load_extension"(\'bad\')',
    "SELECT 1; DELETE FROM overlay_source_0.parents"
  ])('rejects old-source or connection write bypass: %s', sql => {
    expect(() => guardOverlaySql(sql, new Set(['parents', 'items']))).toThrow('unqualified')
  })

  it('keeps attached sources unchanged after rejected public writes', async () => {
    const f = fixture(), before = readFileSync(f.legacy), store = await open(f)
    expect(store.execute("SELECT name FROM overlay_source_0.parents").rows).toEqual([['old']])
    expect(() => store.execute('UPDATE /* comment */ "overlay_source_0"."parents" SET name=\'bad\'')).toThrow('unqualified')
    store.close()
    expect(readFileSync(f.legacy)).toEqual(before)
  })

  it.each(['corrupt', 'missing', 'incompatible', 'attach-failure'])('warns for %s legacy source, keeps new writes available and refuses incomplete backup', async failure => {
    const f = fixture(), bad = path.join(f.directory, 'bad.db'), progress = vi.fn()
    if (failure === 'corrupt') writeFileSync(bad, 'not a SQLite database')
    if (failure === 'incompatible') {
      const db = new Database(bad)
      db.exec('CREATE TABLE parents(other_id TEXT PRIMARY KEY,name TEXT)')
      db.close()
    }
    if (failure === 'attach-failure') {
      const db = new Database(bad)
      db.exec('CREATE TABLE parents(id TEXT PRIMARY KEY,name TEXT)')
      db.close()
    }
    const prepare = Database.prototype.prepare
    const spy = vi.spyOn(Database.prototype, 'prepare').mockImplementation(function(sql) {
      if (failure === 'attach-failure' && /^ATTACH/.test(sql) && /overlay_source_1/.test(sql)) throw new Error('injected attach failure')
      return prepare.call(this, sql)
    })
    let store: PersistentRecordStore
    try {
      store = await PersistentRecordStore.openOverlay(f.filename, 'bigint', progress, { legacyPaths: [f.legacy, bad], migrationDir: f.migrationDir })
      stores.push(store)
    } finally { spy.mockRestore() }
    expect(store.startup.warnings).toHaveLength(1)
    expect(store.startup.warnings[0].filename).toBe(canonicalPath(bad))
    expect(progress.mock.calls.some(([phase]) => phase === 'overlay-warning')).toBe(true)
    store.execute("INSERT INTO parents VALUES('new','new-session')")
    expect(store.execute("INSERT INTO items(parent_id,alias) VALUES('new','continued') RETURNING id").rows).toEqual([[OVERLAY_INTEGER_START]])
    const destination = path.join(f.directory, 'must-not-publish')
    await expect(store.backupStorage(destination)).rejects.toThrow('incomplete')
    expect(existsSync(destination)).toBe(false)
    expect(store.execute("SELECT name FROM parents WHERE id='new'").rows).toEqual([['new-session']])
  })

  it('does not publish a manifest if a source snapshot fails after startup', async () => {
    const f = fixture(), store = await open(f), backup = Database.prototype.backup
    const spy = vi.spyOn(Database.prototype, 'backup').mockImplementation(function(destination, options) {
      if (this.readonly) return Promise.reject(new Error('legacy snapshot failed'))
      return backup.call(this, destination, options)
    })
    const destination = path.join(f.directory, 'snapshot-failure')
    try { await expect(store.backupStorage(destination)).rejects.toThrow('legacy snapshot failed') }
    finally { spy.mockRestore() }
    expect(existsSync(path.join(destination, 'manifest.json'))).toBe(false)
    expect(store.execute('SELECT name FROM parents').rows).toEqual([['old']])
  })

  it('starts with only corrupt sources and retains the warning on reopen', async () => {
    const f = fixture(), bad = path.join(f.directory, 'only-bad.db')
    writeFileSync(bad, 'broken source')
    const store = await open(f, [bad])
    store.execute("INSERT INTO parents VALUES('new','new')")
    store.close()
    const again = await open(f, [bad])
    expect(again.startup.warnings).toHaveLength(1)
    expect(again.execute('SELECT name FROM parents').rows).toEqual([['new']])
    await expect(again.backupStorage(path.join(f.directory, 'cannot-backup'))).rejects.toThrow('incomplete')
    expect(readFileSync(bad, 'utf8')).toBe('broken source')
  })

  it('prioritizes earlier legacy sources and their record tombstones over later rows', async () => {
    const f = fixture(), newer = path.join(f.directory, 'record.db')
    const db = new Database(newer)
    db.exec('CREATE TABLE parents(id TEXT PRIMARY KEY,name TEXT NOT NULL)')
    const entities = discoverEntities(db)
    db.exec('DROP TABLE parents')
    initializeRecords(db)
    for (const entity of entities) {
      db.prepare('INSERT INTO storage_entities VALUES (?,?)').run(entity.name, JSON.stringify(entity))
      installCurrentView(db, entity, entities)
    }
    db.function('record_written', { varargs: true }, () => null)
    db.exec("INSERT INTO parents VALUES('p','newer'); DELETE FROM parents WHERE id='p'")
    db.close()
    const store = await open(f, [newer, f.legacy])
    expect(store.execute('SELECT * FROM parents').rows).toEqual([])
    expect(store.execute('SELECT count(*) FROM entity_records').rows).toEqual([[0n]])
  })

  it('opens sources in SQLite readonly mode and blocks qualified/storage writes', async () => {
    const f = fixture(), store = await open(f)
    expect(store.execute('PRAGMA database_list').rows.some(row => row[1] === 'overlay_source_0')).toBe(true)
    expect(() => store.execute("UPDATE overlay_source_0.parents SET name='bad'")).toThrow('unqualified')
    const fresh = await open(f)
    expect(() => fresh.execute("UPDATE main.parents SET name='bad'")).toThrow('unqualified')
    const second = await open(f)
    expect(() => second.execute("INSERT INTO entity_records(entity_type,entity_key,operation,payload) VALUES('parents','[]','put','{}')")).toThrow('unqualified')
    await expect(second.backup(path.join(f.directory, 'bad.db'))).rejects.toThrow('earlier failure')
  })

  it('creates a portable manifest with old-source WAL snapshots and restores using relative files', async () => {
    const f = fixture(), writer = new Database(f.legacy)
    writer.pragma('journal_mode=WAL')
    writer.exec("UPDATE parents SET name='wal' WHERE id='p'")
    try {
      const store = await open(f)
      store.execute("INSERT INTO items(parent_id,alias) VALUES('p','continued')")
      const destination = path.join(f.directory, 'backupStorage')
      const manifest = await store.backupStorage(destination)
      expect(JSON.parse(readFileSync(path.join(destination, 'manifest.json'), 'utf8'))).toEqual(manifest)
      const restored = await open(f, manifest.legacyPaths.map(file => path.join(destination, file)), path.join(destination, manifest.database))
      expect(restored.execute('SELECT name FROM parents').rows).toEqual([['wal']])
      expect(restored.execute('SELECT id,alias FROM items ORDER BY id').rows).toEqual([[20n, 'old'], [OVERLAY_INTEGER_START, 'continued']])
      await expect(store.backupStorage(destination)).rejects.toThrow()
      await expect(store.backup(path.join(f.directory, 'incomplete.db'))).rejects.toThrow('backupStorage')
    } finally { writer.close() }
  })

  it('refuses source aliases and append logs without modifying or deleting them', async () => {
    const f = fixture(), link = path.join(f.directory, 'alias.db'), before = readFileSync(f.legacy)
    symlinkSync(f.legacy, link)
    await expect(open(f, [f.legacy], link)).rejects.toThrow('also be a legacy')
    const hardlink = path.join(f.directory, 'hardlink.db')
    linkSync(f.legacy, hardlink)
    await expect(open(f, [f.legacy], hardlink)).rejects.toThrow('also be a legacy')
    const log = new Database(path.join(f.directory, 'log.db'))
    log.exec('CREATE TABLE append_records(sequence INTEGER PRIMARY KEY,kind TEXT,payload BLOB)')
    log.close()
    const store = await open(f, [path.join(f.directory, 'log.db')])
    expect(store.startup.warnings[0].message).toContain('never replays')
    await expect(store.backupStorage(path.join(f.directory, 'incomplete'))).rejects.toThrow('incomplete')
    expect(readFileSync(f.legacy)).toEqual(before)
    expect(existsSync(f.filename)).toBe(true)
  })

  it('rejects relational targets before changing their journal or facts', async () => {
    const f = fixture(), before = readFileSync(f.legacy)
    await expect(open(f, [], f.legacy)).rejects.toThrow('not an empty or record')
    expect(readFileSync(f.legacy)).toEqual(before)
  })

  it('supports read CTEs and restarts after an initialization failure', async () => {
    const f = fixture()
    await expect(PersistentRecordStore.openOverlay(f.filename, 'bigint', phase => {
      if (phase === 'overlay-ready') throw new Error('interrupted')
    }, { legacyPaths: [f.legacy], migrationDir: f.migrationDir })).rejects.toThrow('interrupted')
    const store = await open(f)
    for (let i = 0; i < 3; i++) expect(store.execute('WITH visible AS (SELECT id FROM items) SELECT id FROM visible LIMIT 1').rows).toEqual([[20n]])
    expect(store.execute("INSERT INTO items(alias) VALUES('after-read') RETURNING id").rows).toEqual([[OVERLAY_INTEGER_START]])
    expect(() => store.execute("WITH x AS (SELECT 1) DELETE FROM entity_records")).toThrow('unqualified')
    store.close()
  })

  it('builds the full empty production schema and supports continuing an old session in the new store', async () => {
    const f = fixture(), schema = path.resolve('resources/database/drizzle')
    const seed = await PersistentRecordStore.openOverlay(':memory:', 'bigint', undefined, { legacyPaths: [], migrationDir: schema })
    stores.push(seed)
    seed.execute("INSERT INTO agents(id,type,name,model,created_at,updated_at) VALUES ('a','x','Agent','model','now','now')")
    seed.execute("INSERT INTO sessions(id,agent_type,agent_id,name,model,created_at,updated_at) VALUES ('s','x','a','Session','model','now','now')")
    const backup = path.join(f.directory, 'seed')
    const manifest = await seed.backupStorage(backup)
    const old = path.join(backup, manifest.database)
    const store = await PersistentRecordStore.openOverlay(f.filename, 'bigint', undefined, { legacyPaths: [old], migrationDir: schema })
    stores.push(store)
    expect(store.execute('SELECT count(*) FROM entity_records').rows).toEqual([[0n]])
    expect(store.execute("INSERT INTO session_messages(session_id,role,content) VALUES('s','agent','{}') RETURNING id").rows).toEqual([[OVERLAY_INTEGER_START]])
    store.execute("INSERT INTO agent_messages(id,session_id,sequence,role,status,created_at,updated_at) VALUES('m','s',1,'assistant','completed','now','now')")
    expect(store.execute("SELECT id FROM agent_messages WHERE session_id='s'").rows).toEqual([['m']])
    const legacy = new Database(old, { readonly: true })
    expect(legacy.prepare('SELECT count(*) AS count FROM entity_records').get()).toEqual({ count: 2 })
    legacy.close()
  })
})
