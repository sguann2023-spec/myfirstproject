import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'vite'
import { WorkerDatabaseClient } from '../../workerClient'
import type { OverlayOptions } from '../../persistentRecordStore'
import { OVERLAY_INTEGER_START } from '../../recordOverlay'

vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) } }))
vi.mock('@main/utils', () => ({ getResourcePath: () => '/resources' }))
vi.mock('electron', () => ({ app: { getPath: () => '/unused' } }))
import { resolveStorageConfiguration } from '../../DatabaseManager'

const clients: WorkerDatabaseClient[] = []
const directories: string[] = []
const databases: Database.Database[] = []
let workerPath: string
let buildDirectory: string
beforeAll(async () => {
  const cache = path.resolve('node_modules/.cache')
  mkdirSync(cache, { recursive: true })
  buildDirectory = mkdtempSync(path.join(cache, 'overlay-worker-'))
  workerPath = path.join(buildDirectory, 'databaseWorker.cjs')
  // Build the real current Worker, independently of app build output and mocks.
  await build({ configFile: false, logLevel: 'error', build: {
    target: 'node22', outDir: buildDirectory, emptyOutDir: false, minify: false,
    lib: { entry: path.resolve('src/main/services/agents/database/databaseWorker.ts'), formats: ['cjs'], fileName: () => 'databaseWorker.cjs' },
    rollupOptions: { external: ['better-sqlite3', /^node:/] }
  } })
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
