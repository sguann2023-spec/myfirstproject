import { afterEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { configureDatabase, finalizeRecords } from '../../legacyRecordMigration'
import { PersistentRecordStore } from '../../persistentRecordStore'
import { initializeRecords, quote, recordIndexFields, storedEntities } from '../../recordSchema'
import { RECORD_CONSTRAINT_REVISION } from '../../recordConstraintUpgrade'
import { RECORD_INDEX_VERSION } from '../../recordIndexUpgrade'

const stores: PersistentRecordStore[] = []
const directories: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const store of stores.splice(0)) store.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function completed(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'record-index-'))
  directories.push(directory)
  const identity = path.join(directory, 'agents.db')
  const db = new Database(`${identity}.v2.db`)
  try {
    configureDatabase(db)
    const migrations = path.resolve('resources/database/drizzle')
    for (const name of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(path.join(migrations, name), 'utf8'))
    db.exec("CREATE TABLE lookups(id INTEGER PRIMARY KEY, alias TEXT UNIQUE, parent TEXT REFERENCES sessions(id)); CREATE TABLE binary_keys(id BLOB PRIMARY KEY, \"dotted.name\" TEXT UNIQUE)")
    initializeRecords(db)
    db.function('record_written', { varargs: true }, () => null)
    finalizeRecords(db, () => undefined)
    // Reproduce the old index expressions and lossy message-view index metadata.
    for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name GLOB 'v2_index_*'").all() as Array<{ name: string }>) db.exec(`DROP INDEX ${quote(name)}`)
    db.exec("CREATE INDEX v2_index_agent_messages_0 ON entity_records(json_extract(payload,'$.id'),position) WHERE entity_type='agent_messages'")
    db.exec(`UPDATE storage_upgrade SET phase='complete' WHERE version=2; PRAGMA user_version=${RECORD_CONSTRAINT_REVISION}`)
    db.exec(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<30000)
      INSERT INTO entity_records(entity_type,entity_key,operation,payload)
      SELECT 'agent_messages',json_array('unrelated-'||x),'put',json_object('id','unrelated-'||x,'session_id','unrelated','sequence',x) FROM n`)
    db.exec(`INSERT INTO entity_records(entity_type,entity_key,operation,payload) VALUES
      ('lookups','[1]','put','{"id":1,"alias":"before"}'),
      ('lookups','[1]','put','{"id":1,"alias":"after"}'),
      ('lookups','[2]','put','{"id":2,"alias":"deleted"}'),
      ('lookups','[2]','delete','{"id":2,"alias":"deleted"}')`)
  } finally { db.close() }
  return identity
}

async function open(identity: string, progress: (phase: string, count?: number, total?: number, detail?: string) => void = vi.fn()): Promise<PersistentRecordStore> {
  const store = await PersistentRecordStore.open(identity, 'number', progress)
  stores.push(store)
  return store
}

function indexed(store: PersistentRecordStore, query: string, args: unknown[] = []): string {
  const plan = store.execute(`EXPLAIN QUERY PLAN ${query}`, args).rows.map(row => row[3]).join('\n')
  expect(plan).toMatch(/SEARCH e USING INDEX v2_index_/)
  expect(plan).toContain('entity_records_latest')
  expect(plan).not.toMatch(/SCAN (?:e|newer)\b/)
  return plan
}

describe('record expression indexes', () => {
  it('uses indexed primary, unique, foreign-key prefix and session queries with 30000 unrelated facts', async () => {
    const store = await open(completed())
    for (const query of [
      "SELECT * FROM sessions WHERE id='missing'",
      "SELECT * FROM agent_messages WHERE id='missing'",
      "SELECT * FROM agent_messages WHERE session_id='s' AND sequence=1",
      "SELECT * FROM agent_messages WHERE session_id='s' AND parent_message_id='missing'",
      "SELECT * FROM agent_message_parts WHERE message_id='missing' AND sequence=1",
      "SELECT * FROM agent_message_parts WHERE session_id='s' AND message_id='missing'",
      "SELECT * FROM lookups WHERE id=1",
      "SELECT * FROM lookups WHERE alias='after'",
      "SELECT * FROM lookups WHERE parent='missing'"
    ]) indexed(store, query)
    for (const query of [
      "SELECT * FROM agent_messages WHERE session_id='s' ORDER BY sequence",
      "SELECT * FROM agent_message_parts WHERE session_id='s' ORDER BY message_id,sequence",
      "SELECT * FROM session_messages WHERE session_id='s' ORDER BY id"
    ]) expect(indexed(store, query)).not.toContain('USE TEMP B-TREE FOR ORDER BY')
    expect(store.execute('SELECT id,alias FROM lookups').rows).toEqual([[1, 'after']])
  })

  it('indexes every declared lookup with the exact view expression, including decoded blobs and dotted names', async () => {
    const store = await open(completed())
    const db = new Database(store.filename, { readonly: true })
    try {
      for (const entity of storedEntities(db)) {
        for (const fields of recordIndexFields(entity)) {
          const plan = indexed(store, `SELECT * FROM ${quote(entity.name)} WHERE ${fields.map(field => `${quote(field)}=?`).join(' AND ')}`, fields.map(() => 'missing'))
          expect((plan.split('\n')[0].match(/<expr>=\?/g) ?? []).length).toBe(fields.length)
        }
      }
    } finally { db.close() }
    // A blob index must search decoded bytes, not the JSON object used for storage.
    store.execute('INSERT INTO binary_keys(id,"dotted.name") VALUES (?,?)', [new Uint8Array([0, 255]), 'key'])
    const blob = store.execute('SELECT "dotted.name" FROM binary_keys WHERE id=?', [new Uint8Array([0, 255])])
    expect(blob.rows).toEqual([['key']])
  })

  it('upgrades in place once without copying, validating facts, or changing stored definitions/history', async () => {
    const identity = completed()
    const filename = `${identity}.v2.db`
    const inode = statSync(filename).ino
    const db = new Database(filename, { readonly: true })
    const facts = db.prepare('SELECT * FROM entity_records ORDER BY position').all()
    const definitions = storedEntities(db)
    db.close()
    const backup = vi.spyOn(Database.prototype, 'backup').mockImplementation(() => { throw new Error('must not copy') })
    const exec = vi.spyOn(Database.prototype, 'exec')
    const prepare = vi.spyOn(Database.prototype, 'prepare')
    const pragma = vi.spyOn(Database.prototype, 'pragma')
    const progress = vi.fn()
    const store = await open(identity, progress)
    expect(store.startup.migrated).toBe(true)
    expect(backup).not.toHaveBeenCalled()
    expect(exec.mock.calls.some(([sql]) => /\b(?:EXCEPT|VACUUM|ATTACH)\b/i.test(sql) || /^\s*(?:INSERT INTO|UPDATE|DELETE FROM) entity_records/i.test(sql))).toBe(false)
    expect(prepare.mock.calls.map(([sql]) => sql).join('\n')).not.toMatch(/\bEXCEPT\b|SELECT .* FROM entity_records/i)
    expect(pragma.mock.calls.map(([sql]) => sql).join('\n')).not.toMatch(/integrity_check|quick_check|foreign_key_check/i)
    expect(progress.mock.calls.map(([phase]) => phase)).toContain('index-complete')
    expect(store.execute('SELECT phase FROM storage_upgrade WHERE version=?', [RECORD_INDEX_VERSION]).rows).toEqual([['complete']])
    store.close()
    expect(statSync(filename).ino).toBe(inode)
    const result = new Database(filename, { readonly: true })
    try {
      expect(result.prepare('SELECT * FROM entity_records ORDER BY position').all()).toEqual(facts)
      expect(storedEntities(result)).toEqual(definitions)
    } finally { result.close() }
    progress.mockClear()
    expect((await open(identity, progress)).startup.migrated).toBe(false)
    expect(progress.mock.calls.map(([phase]) => phase)).not.toContain('index-rebuild')
  })

  it.each(['index-rebuild', 'index-complete'])('rebuilds partial views and wrong same-name indexes after failure at %s', async phase => {
    const identity = completed()
    await expect(open(identity, current => {
      if (current === phase) throw new Error('interrupted indexes')
    })).rejects.toThrow('interrupted indexes')
    const db = new Database(`${identity}.v2.db`)
    try {
      expect(db.prepare('SELECT 1 FROM storage_upgrade WHERE version=?').get(RECORD_INDEX_VERSION)).toBeUndefined()
      db.exec('DROP VIEW IF EXISTS agent_messages; DROP INDEX IF EXISTS v2_index_agent_messages_0')
      db.exec('CREATE INDEX v2_index_agent_messages_0 ON entity_records(position)')
    } finally { db.close() }
    const store = await open(identity)
    expect(store.startup.migrated).toBe(true)
    indexed(store, "SELECT * FROM agent_messages WHERE id='missing'")
    expect(store.execute('SELECT count(*) FROM entity_records').rows).toEqual([[30004]])
  })

  it('rejects an actual SQLite DDL failure without marking completion and recovers on restart', async () => {
    const identity = completed()
    const exec = Database.prototype.exec
    const spy = vi.spyOn(Database.prototype, 'exec').mockImplementation(function (sql) {
      if (sql.startsWith('CREATE INDEX IF NOT EXISTS "v2_index_agent_messages_1"')) return exec.call(this, 'CREATE INDEX broken ON entity_records(no_such_column)')
      return exec.call(this, sql)
    })
    await expect(open(identity)).rejects.toThrow('no such column')
    spy.mockRestore()
    expect((await open(identity)).startup.migrated).toBe(true)
  })

  it('refuses future index versions and rejects business writes to the upgrade marker', async () => {
    const identity = completed()
    const db = new Database(`${identity}.v2.db`)
    try { db.prepare("INSERT INTO storage_upgrade VALUES (?,'complete')").run(RECORD_INDEX_VERSION + 1) } finally { db.close() }
    await expect(open(identity)).rejects.toThrow('Unsupported record index version')
    const reset = new Database(`${identity}.v2.db`)
    try { reset.prepare('DELETE FROM storage_upgrade WHERE version=?').run(RECORD_INDEX_VERSION + 1) } finally { reset.close() }
    const store = await open(identity)
    expect(() => store.execute('UPDATE storage_upgrade SET phase=\'seed\' WHERE version=3')).toThrow('belong to the writer')
  })
})
