import { afterEach, expect, it } from 'vitest'
import { WorkerDatabaseClient } from '../../workerClient'
import Database from 'better-sqlite3'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
const clients: WorkerDatabaseClient[] = []
const dirs: string[] = []
afterEach(async () => { for (const c of clients.splice(0)) await c.closeAsync(); await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))) })
function open(url: string) { const c = new WorkerDatabaseClient({ url, intMode: 'bigint' }, path.resolve('out/main/databaseWorker.js')); clients.push(c); return c }
it('forwards migration progress after broker readiness during schema finalization', async () => {
  const phases: string[] = []
  const client = new WorkerDatabaseClient({ url: ':memory:', intMode: 'bigint' }, path.resolve('out/main/databaseWorker.js'), phase => phases.push(phase))
  clients.push(client)
  await client.execute('CREATE TABLE entries(id TEXT PRIMARY KEY)')
  await client.finalizeSchema()
  expect(phases).toEqual(expect.arrayContaining(['verify', 'replace-tables']))
  expect(phases).not.toContain('validate-constraints')
})
it('shares one writer during concurrent startup and never writes the legacy database', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'worker-db-')); dirs.push(dir)
  const file = path.join(dir, 'test.db')
  const legacy = new Database(file)
  legacy.exec('CREATE TABLE test(id INTEGER PRIMARY KEY,name TEXT)')
  const url = `file:${file}`
  const a = open(url), b = open(url)
  await Promise.all([a.execute('SELECT 1'), b.execute('SELECT 1')])
  await a.finalizeSchema()
  await Promise.all(Array.from({ length: 100 }, (_, index) => (index % 2 ? a : b).execute({ sql: 'INSERT INTO test VALUES (?,?)', args: [index, `entry-${index}`] })))
  expect((await a.execute('SELECT count(*) FROM test')).rows[0][0]).toBe(100n)
  expect(legacy.prepare('SELECT count(*) AS count FROM test').get()).toEqual({ count: 0 })
  legacy.close()
  const records = new Database(`${file}.v2.db`, { readonly: true })
  expect(records.prepare("SELECT count(*) AS count FROM entity_records WHERE entity_type='test' AND operation='put'").get()).toEqual({ count: 100 })
  expect(records.prepare("SELECT type FROM sqlite_master WHERE name='test'").get()).toEqual({ type: 'view' })
  records.close()
})
it('round trips blobs and native SQL results, including UPSERT, batch and migrate', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'worker-values-')); dirs.push(dir)
  const c = open(`file:${path.join(dir, 'test.db')}`)
  await c.migrate(['CREATE TABLE test (id INTEGER PRIMARY KEY, data BLOB)'])
  const results = await c.batch([{ sql: 'INSERT INTO test VALUES (?, ?)', args: [9223372036854775806n, new Uint8Array([1, 2]).buffer] }, 'SELECT * FROM test'])
  expect(results[1].rows[0][0]).toBe(9223372036854775806n)
  expect(results[1].rows[0].id).toBe(9223372036854775806n)
  expect(new Uint8Array(results[1].rows[0].data as ArrayBuffer)).toEqual(new Uint8Array([1, 2]))
  expect(() => JSON.stringify(results[1])).not.toThrow()
  await c.execute('INSERT INTO test VALUES (9223372036854775806,NULL) ON CONFLICT(id) DO UPDATE SET data=excluded.data RETURNING id')
  await c.finalizeSchema()
  expect((await c.execute('SELECT count(*) AS count FROM test')).rows[0].count).toBe(1n)
  expect((await c.execute('SELECT id, data FROM test')).rows[0]).toEqual({ id: 9223372036854775806n, data: null })
  await expect(c.transaction()).rejects.toThrow(/transactions/)
  await expect(c.sync()).rejects.toThrow(/sync/)
  expect(() => c.reconnect()).toThrow(/unsupported/)
})
it('close rejects pending requests without admitting another business write', async () => {
  const c = open(':memory:')
  await c.execute('SELECT 1')
  const pending = c.execute('SELECT 1')
  const rejected = expect(pending).rejects.toThrow('closed')
  await c.closeAsync(); await rejected
  await expect(c.execute('SELECT 1')).rejects.toThrow('closed')
})

it('failure stops every client of that database and preserves only successful appends on restart', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'worker-stop-')); dirs.push(dir)
  const url = `file:${path.join(dir, 'test.db')}`
  const owner = open(url)
  await owner.execute('CREATE TABLE test(id INTEGER PRIMARY KEY)')
  await owner.finalizeSchema()
  const other = open(url)
  await other.execute('INSERT INTO test VALUES (1)')
  await expect(owner.batch(['INSERT INTO test VALUES (2)', 'INSERT INTO missing VALUES (3)', 'INSERT INTO test VALUES (4)'])).rejects.toThrow(/missing/)
  await expect(other.execute('INSERT INTO test VALUES (5)')).rejects.toThrow(/stopped/)
  await other.closeAsync()
  await owner.closeAsync()
  const restarted = open(url)
  expect((await restarted.execute('SELECT id FROM test')).rows.map(row => row.id)).toEqual([1n, 2n])
})

it('an independent database continues after another database stops', async () => {
  const a = open(':memory:'), b = open(':memory:')
  await expect(a.execute('INSERT INTO missing VALUES (1)')).rejects.toThrow()
  expect((await b.execute('SELECT 42 AS value')).rows[0].value).toBe(42n)
})

it('separate processes submit to the same broker and non-owners cannot shut it down', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'worker-processes-')); dirs.push(dir)
  const url = `file:${path.join(dir, 'test.db')}`
  const owner = open(url)
  await owner.execute('CREATE TABLE test(id INTEGER PRIMARY KEY)')
  await owner.finalizeSchema()
  const script = `const {WorkerDatabaseClient}=require(${JSON.stringify(path.resolve('out/main/workerClient.cjs'))});
    const c=new WorkerDatabaseClient({url:${JSON.stringify(url)},intMode:'bigint'},${JSON.stringify(path.resolve('out/main/databaseWorker.js'))});
    (async()=>{for(let i=0;i<20;i++) await c.execute({sql:'INSERT INTO test VALUES (?)',args:[Number(process.argv[1])+i]}); await c.closeAsync()})().catch(e=>{console.error(e);process.exitCode=1});`
  const run = (offset: number) => new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', script, String(offset)], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
    let errors = ''
    child.stderr.on('data', chunk => { errors += chunk })
    child.on('error', reject)
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(errors)))
  })
  await Promise.all([run(0), run(100)])
  expect((await owner.execute('SELECT count(*) FROM test')).rows[0][0]).toBe(40n)
})

it('backs up a consistent database in FIFO order and reserves the broker while replacing storage', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'worker-maintenance-')); dirs.push(dir)
  const url = `file:${path.join(dir, 'test.db')}`
  const owner = open(url)
  await owner.execute('CREATE TABLE t(x INTEGER PRIMARY KEY)')
  await owner.finalizeSchema()
  await Promise.all([
    owner.execute('INSERT INTO t VALUES (1)'),
    owner.execute('INSERT INTO t VALUES (2)')
  ])
  const exportPath = path.join(dir, 'export.db')
  await owner.backupDatabase(exportPath)
  await owner.execute('INSERT INTO t VALUES (3)')
  const exported = new Database(exportPath, { readonly: true })
  expect(exported.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
  expect(exported.prepare('SELECT x FROM t ORDER BY x').all()).toEqual([{ x: 1 }, { x: 2 }])
  expect(exported.prepare("SELECT entity_type, entity_key, operation, json_extract(payload,'$.x') AS x FROM entity_records ORDER BY position").all()).toEqual([
    { entity_type: 't', entity_key: '[1]', operation: 'put', x: 1 },
    { entity_type: 't', entity_key: '[2]', operation: 'put', x: 2 }
  ])
  exported.close()
  expect((await owner.execute('SELECT x FROM t ORDER BY x')).rows.map(row => row.x)).toEqual([1n, 2n, 3n])
  const other = open(url)
  await other.execute('SELECT 1')
  await expect(other.beginStorageMaintenance()).rejects.toThrow(/other database owner/)
  await owner.beginStorageMaintenance()
  await owner.beginStorageMaintenance()
  await expect(other.execute('INSERT INTO t VALUES (4)')).rejects.toThrow(/offline/)
  const newcomer = open(url)
  await expect(newcomer.execute('INSERT INTO t VALUES (5)')).rejects.toThrow(/offline/)
  await other.closeAsync()
  await newcomer.closeAsync()
})
