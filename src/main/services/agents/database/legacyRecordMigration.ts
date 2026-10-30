import Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { deserialize } from 'node:v8'
import { discoverEntities, entityKey, initializeRecords, installCurrentView, payload, quote, storedEntities, viewSql } from './recordSchema'
import type { Entity } from './recordSchema'
import { splitSqlStatements } from './sqlStatements'
import type { MigrationProgress } from '../../../../shared/databaseInitializationProgress'

type Progress = MigrationProgress
const seededDefinitions = new WeakMap<Database.Database, Map<string, string>>()
const seededHistory = new WeakSet<Database.Database>()

export function configureDatabase(db: Database.Database): void {
  db.pragma('journal_mode=WAL')
  db.pragma('synchronous=FULL')
  db.pragma('cache_size=-8192')
  db.pragma('mmap_size=0')
  db.pragma('temp_store=FILE')
  db.pragma('foreign_keys=ON')
  db.pragma('recursive_triggers=ON')
}

/** Build only the caller-supplied temporary database; publication belongs to the caller. */
export async function prepareDatabase(identity: string, destination: string, progress: Progress): Promise<void> {
  mkdirSync(path.dirname(destination), { recursive: true })
  let source: Database.Database
  const logPath = `${identity}.append.db`
  if (existsSync(logPath)) {
    const log = new Database(logPath, { readonly: true, timeout: 0 })
    try {
      const row = log.prepare("SELECT payload FROM append_records WHERE kind='baseline' ORDER BY sequence LIMIT 1").get() as { payload: Buffer } | undefined
      if (!row) throw new Error('Legacy append log has no baseline')
      const image = deserialize(row.payload) as Buffer | { format: string } | null
      if (Buffer.isBuffer(image)) { image[18] = 1; image[19] = 1; source = new Database(image) }
      else if (image) {
        if (image.format !== 'sqlite-file-v1') throw new Error('Unsupported legacy baseline format')
        source = new Database(`${logPath}.baseline.db`, { readonly: true, fileMustExist: true, timeout: 0 })
      } else source = new Database(':memory:')
    } finally { log.close() }
  } else source = existsSync(identity) ? new Database(identity, { readonly: true, fileMustExist: true, timeout: 0 }) : new Database(':memory:')
  try {
    source.pragma('cache_size=-8192')
    progress('copy-baseline')
    await source.backup(destination, { progress: ({ totalPages, remainingPages }) => {
      progress('copy-baseline', totalPages - remainingPages, totalPages)
      return 512
    } })
  } finally { source.close() }
  const seeded = new Database(destination)
  try { initializeRecords(seeded) } finally { seeded.close() }
}

function importRows(db: Database.Database, source: string, origin: string, insert: string, bytes: string, progress: Progress): void {
  let after = 0
  let processed = 0
  for (;;) {
    const rows = db.prepare(`SELECT rowid AS id,${bytes} AS bytes FROM ${quote(source)} WHERE rowid>? ORDER BY rowid LIMIT 512`).all(after) as Array<{ id: number; bytes: number }>
    if (!rows.length) return
    let total = 0, end = after, batchCount = 0
    for (const row of rows) {
      if (end !== after && total + row.bytes > 8 * 1024 * 1024) break
      total += row.bytes; end = row.id
      batchCount++
    }
    db.prepare(insert).run(origin, after, end)
    after = end
    processed += batchCount
    progress('import-records', processed, undefined, source)
  }
}

export function seedEntities(db: Database.Database, progress: Progress): void {
  db.exec('DROP TRIGGER IF EXISTS automatic_message_snapshot')
  let definitions = seededDefinitions.get(db)
  if (!definitions) {
    definitions = new Map(storedEntities(db).map(entity => [entity.name, JSON.stringify(entity)]))
    seededDefinitions.set(db, definitions)
  }
  const hasHistory = !!db.prepare("SELECT 1 FROM sqlite_master WHERE name='agent_message_events' AND type='table'").get()
  if (hasHistory) {
    if (!seededHistory.has(db)) {
      importRows(db, 'agent_message_events', 'message-history', `INSERT OR IGNORE INTO entity_records(entity_type,entity_key,operation,payload,recorded_at,import_origin,import_id)
        SELECT entity_type,json_array(CASE WHEN entity_type='session_messages' THEN CAST(entity_id AS INTEGER) ELSE entity_id END),operation,payload,recorded_at,?,position
        FROM agent_message_events WHERE rowid>? AND rowid<=? ORDER BY rowid`, 'length(CAST(payload AS BLOB))', progress)
      seededHistory.add(db)
    }
    db.exec(`DROP TRIGGER IF EXISTS v2_capture_message_history;
      CREATE TRIGGER v2_capture_message_history AFTER INSERT ON agent_message_events BEGIN
        INSERT OR IGNORE INTO entity_records(entity_type,entity_key,operation,payload,recorded_at,import_origin,import_id)
        VALUES (NEW.entity_type,json_array(CASE WHEN NEW.entity_type='session_messages' THEN CAST(NEW.entity_id AS INTEGER) ELSE NEW.entity_id END),
          NEW.operation,NEW.payload,NEW.recorded_at,'message-history',NEW.position);
      END;`)
  }
  for (const entity of discoverEntities(db)) {
    const definition = JSON.stringify(entity)
    const previous = definitions.get(entity.name)
    if (previous !== definition) db.prepare('INSERT INTO storage_entities(name,definition) VALUES (?,?) ON CONFLICT(name) DO UPDATE SET definition=excluded.definition').run(entity.name, definition)
    const isView = (db.prepare('SELECT type FROM sqlite_master WHERE name=?').get(entity.name) as { type: string }).type === 'view'
    if (previous !== definition) {
      if (isView) {
        if (!hasHistory) throw new Error(`Cannot migrate ${entity.name}: missing source history`)
      } else {
        const origin = `${entity.name}:${createHash('sha256').update(definition).digest('hex')}`
        const bytes = entity.columns.map(column => `coalesce(length(CAST(${quote(column.name)} AS BLOB)),0)`).join('+')
        importRows(db, entity.name, origin, `INSERT OR IGNORE INTO entity_records(entity_type,entity_key,operation,payload,import_origin,import_id)
          SELECT '${entity.name.replace(/'/g, "''")}',${entityKey(entity, 'source')},'put',${payload(entity, 'source')},?,source.rowid
          FROM ${quote(entity.name)} source WHERE source.rowid>? AND source.rowid<=? ORDER BY source.rowid`, bytes, progress)
      }
      definitions.set(entity.name, definition)
    }
    installImportTriggers(db, entity)
  }
}

function installImportTriggers(db: Database.Database, entity: Entity): void {
  if ((db.prepare('SELECT type FROM sqlite_master WHERE name=?').get(entity.name) as { type: string }).type !== 'table') return
  const name = `'${entity.name.replace(/'/g, "''")}'`
  for (const operation of ['insert', 'update', 'delete']) {
    const prefix = operation === 'delete' ? 'OLD' : 'NEW'
    const trigger = quote(`v2_capture_${entity.name}_${operation}`)
    db.exec(`DROP TRIGGER IF EXISTS ${trigger};
      CREATE TRIGGER ${trigger} AFTER ${operation.toUpperCase()} ON ${quote(entity.name)} BEGIN
        ${operation === 'update' ? `INSERT INTO entity_records(entity_type,entity_key,operation,payload)
          SELECT ${name},${entityKey(entity, 'OLD')},'delete',${payload(entity, 'OLD')}
          WHERE ${entityKey(entity, 'OLD')}<>${entityKey(entity, 'NEW')};` : ''}
        INSERT INTO entity_records(entity_type,entity_key,operation,payload)
        VALUES (${name},${entityKey(entity, prefix)},'${operation === 'delete' ? 'delete' : 'put'}',${payload(entity, prefix)});
      END;`)
  }
}

/** Only this upgrade importer understands the old SQL format. No runtime SQL journal remains. */
export function importLegacyLog(db: Database.Database, identity: string, progress: Progress): void {
  seedEntities(db, progress)
  if (!existsSync(`${identity}.append.db`)) return
  const log = new Database(`${identity}.append.db`, { readonly: true, timeout: 0 })
  const clock = new Database(':memory:')
  let context: any, random = 1
  const nextRandom = () => { random ^= random << 13; random ^= random >>> 17; random ^= random << 5; return random >>> 0 }
  for (const name of ['datetime', 'date', 'time', 'julianday', 'unixepoch', 'strftime', 'timediff']) {
    db.function(name, { varargs: true }, (...args: any[]) => {
      const values = args.map((value, index) => context && !(name === 'strftime' && index === 0) && typeof value === 'string' && /^now$/i.test(value) ? context.time : value)
      const timeIndex = name === 'strftime' ? 1 : 0
      if (!values.length && name !== 'strftime' && name !== 'timediff') values.push(context?.time ?? 'now')
      if (name === 'strftime' && values.length === 1) values.push(context?.time ?? 'now')
      if (typeof values[timeIndex] === 'string' && /^subsec(?:ond)?$/i.test(values[timeIndex])) values.splice(timeIndex, 0, context?.time ?? 'now')
      return (clock.prepare(`SELECT ${name}(${values.map(() => '?').join(',')}) AS value`).get(...values) as any)?.value
    })
  }
  for (const [name, format] of [['current_timestamp', 'datetime'], ['current_date', 'date'], ['current_time', 'time']]) db.function(name, () => (clock.prepare(`SELECT ${format}(?) AS value`).get(context?.time ?? 'now') as any)?.value)
  db.function('random', () => BigInt(nextRandom()) * 4294967296n + BigInt(nextRandom()) - 9223372036854775808n)
  db.function('randomblob', (length: number) => { const buffer = Buffer.alloc(Math.max(1, Number(length))); for (let i = 0; i < buffer.length; i++) buffer[i] = nextRandom() & 255; return buffer })
  try {
    let processed = 0
    for (const row of log.prepare("SELECT sequence,kind,payload FROM append_records WHERE kind<>'baseline' ORDER BY sequence").iterate() as Iterable<any>) {
      context = deserialize(row.payload); random = context.seed
      const statements = row.kind === 'schema' ? splitSqlStatements(context.sql) : [context.sql]
      for (const sql of statements) {
        if (row.kind === 'schema') db.exec(sql)
        else {
          const statement = db.prepare(sql)
          const args = Array.isArray(context.args) ? context.args : [context.args]
          if (statement.reader) for (const _row of statement.raw().iterate(...args)) { /* Discard historical responses. */ }
          else statement.run(...args)
        }
        if (row.kind === 'schema') seedEntities(db, progress)
      }
      progress('import-log', ++processed)
    }
  } finally { log.close(); clock.close() }
}

export function finalizeRecords(db: Database.Database, progress: Progress): void {
  seedEntities(db, progress)
  const entities = storedEntities(db)
  progress('verify', 0, entities.length)
  for (const [index, entity] of entities.entries()) {
    progress('verify', index, entities.length, entity.name)
    const view = `v2_check_${entity.name}`
    db.exec(`DROP VIEW IF EXISTS ${quote(view)};${viewSql(entity, view)}`)
    const columns = entity.columns.map(column => quote(column.name)).join(',')
    const difference = db.prepare(`SELECT 1 FROM (SELECT ${columns} FROM ${quote(entity.name)} EXCEPT SELECT ${columns} FROM ${quote(view)}) LIMIT 1`).get()
    const reverse = db.prepare(`SELECT 1 FROM (SELECT ${columns} FROM ${quote(view)} EXCEPT SELECT ${columns} FROM ${quote(entity.name)}) LIMIT 1`).get()
    if (difference || reverse) throw new Error(`Migration verification failed for ${entity.name}; source was not deleted`)
    db.exec(`DROP VIEW ${quote(view)}`)
    progress('verify', index + 1, entities.length, entity.name)
  }
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE name='agent_message_events'").get()) {
    progress('verify-history')
    const missing = db.prepare("SELECT 1 FROM agent_message_events old WHERE NOT EXISTS(SELECT 1 FROM entity_records record WHERE record.import_origin='message-history' AND record.import_id=old.position AND record.payload=old.payload AND record.operation=old.operation) LIMIT 1").get()
    if (missing) throw new Error('Message history verification failed; source was not deleted')
  }
  db.pragma('foreign_keys=OFF')
  try {
    for (const [index, entity] of entities.entries()) {
      const old = db.prepare('SELECT type FROM sqlite_master WHERE name=?').get(entity.name) as { type: string } | undefined
      if (old) db.exec(`DROP ${old.type === 'table' ? 'TABLE' : 'VIEW'} ${quote(entity.name)}`)
      installCurrentView(db, entity, entities)
      progress('replace-tables', index + 1, entities.length, entity.name)
    }
    for (const row of db.prepare("SELECT name FROM sqlite_master WHERE type='view' AND name LIKE 'replay_%'").all() as Array<{ name: string }>) db.exec(`DROP VIEW ${quote(row.name)}`)
    for (const name of ['agent_message_snapshots', 'agent_message_events']) db.exec(`DROP TABLE IF EXISTS ${quote(name)}`)
  } finally { db.pragma('foreign_keys=ON') }
}
