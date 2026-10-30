import type Database from 'better-sqlite3'
import { installCurrentView, installRecordIndexes, quote, storedEntities } from './recordSchema'

export const RECORD_INDEX_VERSION = 3
type Progress = (phase: string, count?: number, total?: number, detail?: string) => void

export function markRecordIndexesComplete(db: Database.Database): void {
  db.prepare("INSERT OR REPLACE INTO storage_upgrade(version,phase) VALUES (?,'complete')").run(RECORD_INDEX_VERSION)
}

/** Run on the broker's writer before accepting requests. Incomplete DDL is rebuilt,
 * never resumed; facts are neither copied nor validated by this index-only upgrade. */
export function upgradeRecordIndexes(db: Database.Database, progress: Progress): boolean {
  const versions = db.prepare('SELECT version,phase FROM storage_upgrade WHERE version>=?').all(RECORD_INDEX_VERSION) as Array<{ version: number | bigint; phase: string }>
  if (versions.some(row => Number(row.version) > RECORD_INDEX_VERSION)) throw new Error('Unsupported record index version')
  if (versions.some(row => row.phase === 'complete')) return false
  const entities = storedEntities(db)
  progress('index-rebuild', 0, entities.length)
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='entity_records' AND substr(name,1,9)='v2_index_'").all() as Array<{ name: string }>
  for (const { name } of indexes) db.exec(`DROP INDEX ${quote(name)}`)
  // DROP VIEW also drops its commands. IF EXISTS repairs an interrupted rebuild.
  for (const entity of entities) db.exec(`DROP VIEW IF EXISTS ${quote(entity.name)}`)
  for (const [index, entity] of entities.entries()) {
    installCurrentView(db, entity, entities, false)
    installRecordIndexes(db, entity)
    progress('index-rebuild', index + 1, entities.length, entity.name)
  }
  progress('index-complete')
  markRecordIndexesComplete(db)
  return true
}
