import Database from 'better-sqlite3'
import { closeSync, existsSync, fsyncSync, openSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'
import { configureDatabase } from './legacyRecordMigration'
import { installCurrentView, quote, storedEntities, withMessageConstraints } from './recordSchema'
import type { Entity } from './recordSchema'

export const RECORD_CONSTRAINT_REVISION = 1
type Progress = (phase: string, count?: number, total?: number, detail?: string) => void

function verifyUnchanged(db: Database.Database, filename: string, entities: Entity[]): void {
  // Internal read-only comparison: SQLite handles large TEXT/BLOB values and file-backed
  // temporary sets. Only a scalar difference flag crosses the JS boundary.
  db.prepare('ATTACH DATABASE ? AS original').run(filename)
  db.pragma('query_only=ON')
  try {
    const tables = db.prepare("SELECT name FROM original.sqlite_master WHERE type='table' AND name<>'storage_entities' ORDER BY name").all() as Array<{ name: string }>
    const compare = (name: string, columns: string[]) => {
      const fields = columns.flatMap(column => [quote(column), `typeof(${quote(column)})`]).join(',')
      const current = `SELECT ${fields} FROM main.${quote(name)}`
      const original = `SELECT ${fields} FROM original.${quote(name)}`
      const result = db.prepare(`SELECT EXISTS(${current} EXCEPT ${original}) OR EXISTS(${original} EXCEPT ${current}) AS changed`).get() as { changed: bigint }
      if (result.changed) throw new Error('Constraint upgrade changed current rows or history')
    }
    for (const { name } of tables) {
      const columns = db.prepare(`PRAGMA original.table_info(${quote(name)})`).all() as Array<{ name: string }>
      // Physical identity preserves multiplicity as well as every fact, including sqlite_sequence.
      compare(name, ['rowid', ...columns.map(column => column.name)])
    }
    for (const entity of entities) compare(entity.name, entity.columns.map(column => column.name))
  } finally {
    db.pragma('query_only=OFF')
    db.exec('DETACH DATABASE original')
  }
}

export function checkpoint(db: Database.Database): void {
  const result = db.pragma('wal_checkpoint(TRUNCATE)') as Array<{ busy: number; log: number; checkpointed: number }>
  if (result.some(row => row.busy || row.log > row.checkpointed)) throw new Error('Cannot publish database: checkpoint busy')
}

function syncFile(filename: string): void {
  const fd = openSync(filename, 'r')
  try { fsyncSync(fd) } finally { closeSync(fd) }
}

/** The unique broker owns the endpoint and queues requests until open finishes.
 * Never resume or publish a stale candidate; no SQL transaction or explicit lock is needed. */
export async function upgradeRecordConstraints(filename: string, progress: Progress): Promise<boolean> {
  const pending = `${filename}.constraints.importing`
  const inspection = new Database(filename, { readonly: true, fileMustExist: true, timeout: 0 })
  let revision: number
  try { revision = inspection.pragma('user_version', { simple: true }) as number } finally { inspection.close() }
  if (revision > RECORD_CONSTRAINT_REVISION) throw new Error('Unsupported record constraint revision')
  if (revision === RECORD_CONSTRAINT_REVISION) return false

  const source = new Database(filename, { fileMustExist: true, timeout: 0 })
  let candidate: Database.Database | undefined
  let published = false
  let ownsPending = false
  try {
    ownsPending = true
    for (const suffix of ['', '-wal', '-shm']) rmSync(pending + suffix, { force: true })
    const definitions = storedEntities(source)
    progress('constraint-copy')
    await source.backup(pending, { progress: ({ totalPages, remainingPages }) => {
      progress('constraint-copy', totalPages - remainingPages, totalPages)
      return 512
    } })
    candidate = new Database(pending, { timeout: 0 })
    configureDatabase(candidate)
    candidate.defaultSafeIntegers(true)
    const entities = definitions.map(withMessageConstraints)
    for (const entity of entities) candidate.prepare('UPDATE storage_entities SET definition=? WHERE name=?').run(JSON.stringify(entity), entity.name)
    // Dropping each view removes its old commands. Rebuild parents too so their
    // dependent cascades reflect the patched child definitions.
    for (const entity of entities) candidate.exec(`DROP VIEW ${quote(entity.name)}`)
    for (const [index, entity] of entities.entries()) {
      installCurrentView(candidate, entity, entities)
      progress('constraint-rebuild', index + 1, entities.length, entity.name)
    }
    progress('constraint-compare')
    verifyUnchanged(candidate, filename, entities)
    progress('integrity-check')
    if (candidate.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Constraint upgrade integrity check failed')
    progress('constraint-verified')
    candidate.pragma(`user_version=${RECORD_CONSTRAINT_REVISION}`)
    checkpoint(candidate)
    candidate.close()
    syncFile(pending)
    progress('constraint-publish')
    checkpoint(source)
    source.close()
    // SQLite has closed and checkpointed both images; no old sidecars may survive replacement.
    for (const base of [filename, pending]) for (const suffix of ['-wal', '-shm']) rmSync(base + suffix, { force: true })
    renameSync(pending, filename)
    published = true
    if (process.platform !== 'win32') syncFile(path.dirname(filename))
    return true
  } finally {
    if (candidate?.open) candidate.close()
    if (source.open) source.close()
    if (ownsPending && (!published || existsSync(pending))) for (const suffix of ['', '-wal', '-shm']) rmSync(pending + suffix, { force: true })
  }
}
