import Database from 'better-sqlite3'
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'
import { configureDatabase, finalizeRecords, importLegacyLog, prepareDatabase } from './legacyRecordMigration'
import { initializeRecords } from './recordSchema'
import { checkpoint, RECORD_CONSTRAINT_REVISION, upgradeRecordConstraints } from './recordConstraintUpgrade'
import { markRecordIndexesComplete, upgradeRecordIndexes } from './recordIndexUpgrade'
import { splitSqlStatements } from './sqlStatements'
import { backupOverlayStorage, emptyOverlaySchema, guardOverlaySql, initializeOverlay, inspectOverlaySources, inspectOverlayTarget } from './recordOverlay'
import type { OverlayOptions, OverlaySource, OverlayWarning, StorageManifest } from './recordOverlay'
export type { OverlayOptions, OverlayWarning, StorageManifest } from './recordOverlay'

export interface WireResult { columns: string[]; columnTypes: string[]; rows: any[][]; rowsAffected: number; lastInsertRowid?: bigint }
const binding = (value: any): any => {
  if (value === undefined) return null
  if (typeof value === 'boolean') return Number(value)
  if (value instanceof ArrayBuffer) return Buffer.from(value)
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  return value
}
function guard(sql: string): void {
  const head = sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, '').trim()
  if (/^(BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE|ATTACH|DETACH|VACUUM)\b/i.test(head)) throw new Error('Explicit transactions and external database writes are unsupported')
  if (/^PRAGMA\s+(?:\w+\.)?user_version\s*(?:=|\()/i.test(head)) throw new Error('Record constraint revision belongs to the writer')
  if (/^(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|REPLACE\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:["`]?main["`]?\.)?["`\[]?storage_upgrade\b/i.test(head)) throw new Error('Record upgrade versions belong to the writer')
  if (/\bload_extension\s*\(/i.test(head) || /^PRAGMA\s+(?:\w+\.)?(?:writable_schema|journal_mode|busy_timeout|locking_mode|synchronous)\b/i.test(head)) throw new Error('Database connection controls belong to the writer')
}

/** One durable SQLite database. Business facts append; current views reduce on read. */
export class PersistentRecordStore {
  readonly filename: string
  private db: Database.Database
  private failed?: Error
  private closed = false
  private written: Array<{ entity: string; position: bigint }> = []
  private pending?: string
  private identity?: string
  private progress: (phase: string, count?: number, total?: number, detail?: string) => void = () => undefined
  readonly startup: { migrated: boolean; warnings: OverlayWarning[] } = { migrated: false, warnings: [] }
  private overlay?: { sources: OverlaySource[]; entities: Set<string> }

  /** filename is the exact new database path, not the legacy storage identity. */
  static async openOverlay(filename: string, intMode: 'number' | 'bigint' | 'string' = 'number', progress: (phase: string, count?: number, total?: number, detail?: string) => void = () => undefined, options: OverlayOptions): Promise<PersistentRecordStore> {
    const sources = inspectOverlaySources(filename, options.legacyPaths)
    inspectOverlayTarget(filename)
    const schema = emptyOverlaySchema(options.migrationDir, progress)
    if (filename !== ':memory:') mkdirSync(path.dirname(path.resolve(filename)), { recursive: true })
    const store = new PersistentRecordStore(filename, intMode, filename, false)
    store.progress = progress
    store.overlay = { sources, entities: new Set() }
    try {
      store.db.defaultSafeIntegers(false)
      initializeOverlay(store.db, schema, sources, progress, store.startup.warnings)
      store.overlay = { sources, entities: new Set((store.db.prepare('SELECT name FROM storage_entities').all() as Array<{ name: string }>).map(row => row.name)) }
      store.db.defaultSafeIntegers(true)
      return store
    } catch (error) { store.close(); throw error }
  }

  static async open(identity: string, intMode: 'number' | 'bigint' | 'string' = 'number', progress?: (phase: string, count?: number, total?: number, detail?: string) => void): Promise<PersistentRecordStore> {
    const notify = (phase: string, count?: number, total?: number, detail?: string) => progress?.(phase, count, total, detail)
    if (identity.startsWith('memory:')) {
      const store = new PersistentRecordStore(':memory:', intMode)
      store.progress = notify
      return store
    }
    const filename = `${identity}.v2.db`
    if (existsSync(filename)) {
      const existing = new Database(filename, { readonly: true, timeout: 0 })
      let complete = false
      try {
        if (existing.prepare("SELECT 1 FROM sqlite_master WHERE name='storage_upgrade'").get()) {
          complete = (existing.prepare('SELECT phase FROM storage_upgrade WHERE version=2').get() as { phase: string } | undefined)?.phase === 'complete'
        }
      } finally { existing.close() }
      if (complete) {
        const upgraded = await upgradeRecordConstraints(filename, notify)
        const store = new PersistentRecordStore(filename, intMode)
        store.progress = notify
        try {
          store.startup.migrated = upgradeRecordIndexes(store.db, notify) || upgraded
          store.removeLegacyFiles(identity)
          return store
        } catch (error) { store.close(); throw error }
      }
      if (!existsSync(identity) && !existsSync(`${identity}.append.db`)) throw new Error('Incomplete database has no legacy source; refusing to discard data')
      for (const suffix of ['', '-wal', '-shm']) rmSync(filename + suffix, { force: true })
    }
    const pending = `${filename}.importing`
    for (const suffix of ['', '-wal', '-shm']) rmSync(pending + suffix, { force: true })
    await prepareDatabase(identity, pending, notify)
    const store = new PersistentRecordStore(filename, intMode, pending)
    store.progress = notify
    store.pending = pending
    store.identity = identity
    try {
      store.db.defaultSafeIntegers(false)
      importLegacyLog(store.db, identity, notify)
      const count = (store.db.prepare('SELECT count(*) AS count FROM storage_entities').get() as { count: number }).count
      const migrations = store.db.prepare("SELECT 1 FROM sqlite_master WHERE name='migrations'").get()
      const version = migrations ? (store.db.prepare('SELECT coalesce(max(version),-1) AS version FROM migrations').get() as { version: number }).version : 15
      if (existsSync(`${identity}.append.db`)) {
        // Legacy clock/random overrides must never leak into new schema or business writes.
        store.db.close()
        store.db = new Database(pending, { timeout: 0 })
        configureDatabase(store.db)
        store.registerWriter()
      }
      store.db.defaultSafeIntegers(true)
      if (count && version >= 15) store.finalizeSchema()
      store.startup.migrated = true
    } catch (error) { store.close(); throw error }
    return store
  }

  private constructor(filename: string, private intMode: 'number' | 'bigint' | 'string', openedFilename = filename, initializeMemory = true) {
    this.filename = filename
    this.db = new Database(openedFilename, { timeout: 0 })
    configureDatabase(this.db)
    if (filename === ':memory:' && initializeMemory) initializeRecords(this.db)
    this.db.defaultSafeIntegers(true)
    this.registerWriter()
  }
  private registerWriter(): void {
    this.db.function('record_written', (entity: string, position: bigint | number) => {
      this.written.push({ entity, position: BigInt(position) })
      return null
    })
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Database writer is closed')
    if (this.failed) throw Object.assign(new Error('Database writer stopped after an earlier failure'), { code: 'APPEND_WRITER_STOPPED', cause: this.failed })
  }
  private stop(error: unknown): never {
    this.failed = error instanceof Error ? error : new Error(String(error))
    throw this.failed
  }
  private wire(value: any): any {
    if (typeof value === 'bigint') {
      if (this.intMode === 'bigint') return value
      if (this.intMode === 'string') return value.toString()
      const number = Number(value)
      if (!Number.isSafeInteger(number)) throw new RangeError('SQLite integer exceeds JavaScript safe integer range')
      return number
    }
    return Buffer.isBuffer(value) ? value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) : value
  }

  execute(input: string | { sql: string; args?: any }, positionalArgs?: any): WireResult {
    this.assertOpen()
    const sql = typeof input === 'string' ? input : input.sql
    const args = typeof input === 'string' ? positionalArgs ?? [] : input.args ?? []
    try {
      guard(sql)
      if (this.overlay) guardOverlaySql(sql, this.overlay.entities)
      if (splitSqlStatements(sql).length !== 1) throw new Error('execute requires exactly one SQL statement')
      const statement = this.db.prepare(sql)
      const values = Array.isArray(args) ? args.map(binding) : [Object.fromEntries(Object.entries(args).map(([key, value]) => [key.replace(/^[:@$]/, ''), binding(value)]))]
      this.written = []
      if (statement.reader) {
        const columns = statement.columns()
        let rows = statement.raw().all(...values) as any[][]
        // View RETURNING reports NEW before defaults/autogenerated IDs. Resolve
        // direct column returns from the just-committed structured record.
        const root = /^\s*(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE|DELETE\s+FROM)\s+["`]?([\w]+)/i.exec(sql)?.[1]
        const writes = this.written.filter(write => write.entity === root)
        const definition = root && this.db.prepare('SELECT definition FROM storage_entities WHERE name=?').get(root) as { definition: string } | undefined
        const fields: string[] = definition ? JSON.parse(definition.definition).columns.map((column: { name: string }) => column.name) : []
        if (writes.length && writes.length === rows.length && columns.every(column => fields.includes(column.column ?? column.name))) {
          rows = writes.map(write => {
            const select = columns.map(column => {
              const name = column.column ?? column.name
              const field = `'$."${name.replace(/"/g, '\\"')}"'`
              return `CASE WHEN json_type(payload,${field})='object' THEN unhex(json_extract(payload,'$."${name}"."$blob"')) ELSE json_extract(payload,${field}) END`
            }).join(',')
            return this.db.prepare(`SELECT ${select} FROM entity_records WHERE position=?`).raw().get(write.position) as any[]
          })
        }
        return { columns: columns.map(column => column.name), columnTypes: columns.map(column => column.type ?? ''), rows: rows.map(row => row.map(value => this.wire(value))), rowsAffected: writes.length }
      }
      const info = statement.run(...values)
      return { columns: [], columnTypes: [], rows: [], rowsAffected: this.written.length || info.changes, lastInsertRowid: BigInt(info.lastInsertRowid) }
    } catch (error) { return this.stop(error) }
  }
  executeMultiple(sql: string): void { for (const statement of splitSqlStatements(sql)) this.execute(statement) }
  batch(statements: Array<string | { sql: string; args?: any }>): WireResult[] { return statements.map(statement => this.execute(statement)) }

  applyMigration(version: number, tag: string, sql: string): void {
    this.assertOpen()
    if (this.overlay) throw new Error('Overlay schema is generated by openOverlay; runtime migrations are unsupported')
    try {
      if (this.db.prepare("SELECT 1 FROM sqlite_master WHERE name='migrations'").get() && this.db.prepare('SELECT 1 FROM migrations WHERE version=?').get(version)) return
      for (const statement of splitSqlStatements(sql)) {
        guard(statement)
        this.db.exec(statement)
      }
      this.db.prepare('INSERT INTO migrations(version,tag,executed_at) VALUES (?,?,?)').run(version, tag, Date.now())
    } catch (error) { this.stop(error) }
  }
  finalizeSchema(): void {
    this.assertOpen()
    if (this.overlay) return
    if (!this.pending && this.filename !== ':memory:') return
    if ((this.db.prepare('SELECT phase FROM storage_upgrade WHERE version=2').get() as { phase: string }).phase === 'complete') return
    this.db.defaultSafeIntegers(false)
    try {
      finalizeRecords(this.db, this.progress)
      markRecordIndexesComplete(this.db)
      this.db.prepare("UPDATE storage_upgrade SET phase='complete' WHERE version=2").run()
      this.db.pragma(`user_version=${RECORD_CONSTRAINT_REVISION}`)
      if (this.pending) {
        this.progress('publish')
        // Publish only a self-contained, fully verified image, never a partial migration.
        checkpoint(this.db)
        this.db.close()
        const fd = openSync(this.pending, 'r')
        try { fsyncSync(fd) } finally { closeSync(fd) }
        renameSync(this.pending, this.filename)
        if (process.platform !== 'win32') {
          const directory = openSync(path.dirname(this.filename), 'r')
          try { fsyncSync(directory) } finally { closeSync(directory) }
        }
        for (const suffix of ['-wal', '-shm']) rmSync(this.pending + suffix, { force: true })
        this.pending = undefined
        this.db = new Database(this.filename, { timeout: 0 })
        configureDatabase(this.db)
        this.registerWriter()
        this.removeLegacyFiles(this.identity!)
      }
    } catch (error) { this.stop(error) }
    finally { if (this.db.open) this.db.defaultSafeIntegers(true) }
  }
  private removeLegacyFiles(identity: string): void {
    this.progress('cleanup')
    for (const base of [identity, `${identity}.append.db`, `${identity}.append.db.baseline.db`]) {
      for (const suffix of ['', '-wal', '-shm']) rmSync(base + suffix, { force: true })
    }
    rmSync(`${identity}.append.db.read-cache`, { recursive: true, force: true })
  }
  async backup(destination: string): Promise<void> {
    this.assertOpen()
    if (this.overlay) throw new Error('Overlay backups require backupStorage(directory) to include legacy sources')
    if (this.pending) throw new Error('Database migration must finish before backup')
    if (destination === this.filename) throw new Error('Cannot overwrite the active database')
    await this.db.backup(destination)
  }
  async backupStorage(directory: string): Promise<StorageManifest> {
    this.assertOpen()
    if (!this.overlay) throw new Error('backupStorage requires an overlay store')
    return backupOverlayStorage(this.db, this.filename, this.overlay.sources, directory)
  }
  close(): void {
    if (this.closed) return
    this.closed = true
    if (this.db.open) this.db.close()
  }
}
