import Database from 'better-sqlite3'
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { decodeColumn, discoverEntities, entityKey, initializeRecords, installCurrentView, quote, storedEntities } from './recordSchema'
import type { Entity } from './recordSchema'
import { RECORD_CONSTRAINT_REVISION } from './recordConstraintUpgrade'
import { markRecordIndexesComplete } from './recordIndexUpgrade'

export type OverlayProgress = (phase: string, count?: number, total?: number, detail?: string) => void
export interface OverlayOptions { legacyPaths: readonly string[]; migrationDir: string }
export interface OverlayWarning { filename: string; message: string }
export interface OverlaySource { filename: string; alias: string; entities: Entity[]; records: boolean; messageEvents: boolean; attached?: boolean; warning?: OverlayWarning; jsonPaths?: Record<string, Record<string, string>> }
export const OVERLAY_INTEGER_START = 4503599627370496n
const INTEGER_LIMIT = 9007199254740991n
export interface StorageManifest {
  format: 'record-overlay-v1'
  database: string
  legacyPaths: string[]
  sources: Array<{ originalPath: string; snapshot: string }>
}
const literal = (value: string) => `'${value.replace(/'/g, "''")}'`
export function canonicalPath(filename: string): string {
  const absolute = path.resolve(filename)
  if (existsSync(absolute)) return realpathSync(absolute)
  const parent = path.dirname(absolute)
  return parent === absolute ? absolute : path.join(canonicalPath(parent), path.basename(absolute))
}

/** Read schema metadata only. SQL append logs are deliberately not replayed. */
export function inspectOverlaySources(filename: string, legacyPaths: readonly string[]): OverlaySource[] {
  const target = canonicalPath(filename), seen = new Set<string>()
  const targetStat = existsSync(target) ? statSync(target) : undefined
  return legacyPaths.flatMap(filename => {
    const resolved = canonicalPath(filename)
    if (resolved === target) throw new Error('Overlay database cannot also be a legacy source')
    if (seen.has(resolved)) return []
    seen.add(resolved)
    const source: OverlaySource = { filename: resolved, alias: `overlay_source_${seen.size - 1}`, entities: [], records: false, messageEvents: false }
    if (existsSync(resolved)) {
      const sourceStat = statSync(resolved)
      if (targetStat && targetStat.dev === sourceStat.dev && targetStat.ino === sourceStat.ino) throw new Error('Overlay database cannot also be a legacy source')
    }
    let db: Database.Database | undefined
    try {
      db = new Database(resolved, { readonly: true, fileMustExist: true, timeout: 0 })
      const has = (name: string) => !!db!.prepare('SELECT 1 FROM sqlite_master WHERE name=?').get(name)
      if (has('append_records')) throw new Error('SQL append logs require a read model; overlay never replays legacy SQL')
      source.records = has('entity_records')
      source.entities = source.records ? storedEntities(db) : discoverEntities(db)
      source.messageEvents = has('agent_message_events')
      if (source.records) source.jsonPaths = legacyIndexPaths(db, source.entities)
      for (const entity of source.entities) {
        if (!entity.name || /^(?:storage_|sqlite_|overlay_source_)|^(?:entity_records|migrations)$/i.test(entity.name) || !entity.keys.length || entity.keys.some(key => !entity.columns.some(column => column.name === key))) throw new Error('Invalid legacy entity metadata')
        if (!Array.isArray(entity.references) || !Array.isArray(entity.uniques) || !Array.isArray(entity.indexes)) throw new Error('Invalid legacy entity constraints')
        for (const reference of entity.references) {
          const parent = source.entities.find(parent => parent.name === reference.table)
          if (!parent || !entity.columns.some(column => column.name === reference.from) || !parent.columns.some(column => column.name === reference.to)) throw new Error('Invalid legacy entity reference')
        }
        const sql = source.records ? 'SELECT entity_key,operation,payload,position FROM entity_records LIMIT 0' : `SELECT ${entity.columns.map(column => quote(column.name)).join(',')} FROM ${quote(entity.name)} LIMIT 0`
        db.prepare(sql)
      }
    } catch (error) { source.warning = { filename: resolved, message: error instanceof Error ? error.message : String(error) }; source.entities = [] }
    finally { db?.close() }
    return [source]
  })
}

/** SQLite matches expression indexes syntactically, not by JSON path meaning. */
function legacyIndexPaths(db: Database.Database, entities: Entity[]): Record<string, Record<string, string>> {
  const paths: Record<string, Record<string, string>> = Object.create(null)
  const indexes = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='entity_records' AND sql IS NOT NULL ORDER BY name").all() as Array<{ sql: string }>
  for (const entity of entities) {
    const fields: Record<string, string> = Object.create(null)
    for (const index of indexes) {
      const type = /\bentity_type\s*=\s*'((?:''|[^'])*)'/i.exec(index.sql)?.[1]?.replace(/''/g, "'")
      if (type !== undefined && type !== entity.name) continue
      for (const match of index.sql.matchAll(/\bjson_extract\s*\(\s*["`]?payload["`]?\s*,\s*'((?:''|[^'])*)'\s*\)/gi)) {
        const jsonPath = match[1].replace(/''/g, "'")
        for (const column of entity.columns) {
          const quoted = `$."${column.name.replace(/"/g, '\\"')}"`
          if (jsonPath === quoted || (/^[A-Za-z_][\w$]*$/.test(column.name) && jsonPath === `$.${column.name}`)) fields[column.name] ??= jsonPath
        }
      }
    }
    paths[entity.name] = fields
  }
  return paths
}

export function inspectOverlayTarget(filename: string): void {
  if (filename === ':memory:' || !existsSync(filename)) return
  const db = new Database(filename, { readonly: true, fileMustExist: true, timeout: 0 })
  try {
    const has = (name: string) => !!db.prepare('SELECT 1 FROM sqlite_master WHERE type=\'table\' AND name=?').get(name)
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' LIMIT 1").get() && (!has('storage_entities') || !has('entity_records') || !has('storage_upgrade'))) throw new Error('Overlay target is not an empty or record database')
    if (Number(db.pragma('user_version', { simple: true })) > RECORD_CONSTRAINT_REVISION) throw new Error('Unsupported record constraint revision')
  } finally { db.close() }
}

/** Run migrations against an empty, disposable database, never against old facts. */
export function emptyOverlaySchema(migrationDir: string, progress: OverlayProgress): { entities: Entity[]; migrations: Array<{ idx: number; tag: string }> } {
  const journal = JSON.parse(readFileSync(path.join(migrationDir, 'meta', '_journal.json'), 'utf8')) as { entries: Array<{ idx: number; tag: string }> }
  const migrations = [...journal.entries].sort((a, b) => a.idx - b.idx)
  const db = new Database(':memory:')
  try {
    for (const [index, entry] of migrations.entries()) {
      if (!Number.isSafeInteger(entry.idx) || !/^[\w-]+$/.test(entry.tag)) throw new Error('Invalid overlay schema journal entry')
      progress('overlay-schema', index, migrations.length, entry.tag)
      db.exec(readFileSync(path.join(migrationDir, `${entry.tag}.sql`), 'utf8'))
    }
    progress('overlay-schema', migrations.length, migrations.length)
    return { entities: discoverEntities(db), migrations }
  } finally { db.close() }
}

export function initializeOverlay(db: Database.Database, schema: ReturnType<typeof emptyOverlaySchema>, sources: OverlaySource[], progress: OverlayProgress, warnings: OverlayWarning[]): void {
  const existing = !!db.prepare("SELECT 1 FROM sqlite_master WHERE name='storage_entities'").get()
  if (!existing && db.prepare("SELECT 1 FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' LIMIT 1").get()) throw new Error('Overlay target is not an empty or record database')
  if (Number(db.pragma('user_version', { simple: true })) > RECORD_CONSTRAINT_REVISION) throw new Error('Unsupported record constraint revision')
  initializeRecords(db)
  const entities = new Map(schema.entities.map(entity => [entity.name, entity]))
  if (existing) for (const entity of storedEntities(db)) entities.set(entity.name, entity)
  for (const source of sources) {
    if (!source.warning) {
      try {
        for (const old of source.entities) {
          const entity = entities.get(old.name)
          if (entity && old.keys.join('\0') !== entity.keys.join('\0')) throw new Error(`Incompatible overlay identity: ${old.name}`)
        }
        // Ordinary filesystem paths only; public SQL can never write or detach.
        db.prepare(`ATTACH DATABASE ? AS ${quote(source.alias)}`).run(source.filename)
        source.attached = true
        for (const entity of source.entities) if (!entities.has(entity.name)) entities.set(entity.name, entity)
      } catch (error) { source.warning = { filename: source.filename, message: error instanceof Error ? error.message : String(error) } }
    }
    if (source.warning) {
      warnings.push(source.warning)
      progress('overlay-warning', undefined, undefined, `${source.filename}: ${source.warning.message}`)
    } else progress('overlay-attach', undefined, undefined, source.filename)
  }
  for (const entity of entities.values()) db.prepare('INSERT OR IGNORE INTO storage_entities(name,definition) VALUES (?,?)').run(entity.name, JSON.stringify(entity))
  db.exec('CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY,tag TEXT NOT NULL,executed_at INTEGER NOT NULL)')
  for (const entry of schema.migrations) db.prepare('INSERT OR IGNORE INTO migrations(version,tag,executed_at) VALUES (?,?,?)').run(entry.idx, entry.tag, Date.now())
  if (!existing) db.prepare("UPDATE storage_upgrade SET phase='complete' WHERE version=2").run()
  // Fresh indexes contain only new records. No legacy index/constraint upgrade runs.
  if (!existing) db.pragma(`user_version=${RECORD_CONSTRAINT_REVISION}`)
  db.exec(`CREATE TABLE IF NOT EXISTS storage_overlay_ids(entity TEXT PRIMARY KEY,last_id INTEGER NOT NULL)`)
  const definitions = [...entities.values()]
  const active = sources.filter(source => source.attached && !source.warning)
  const decode = (entity: Entity, column: Entity['columns'][number], source?: OverlaySource) => decodeColumn(column, 'e', source?.jsonPaths?.[entity.name]?.[column.name])
  // Probe old session identity history, not messages, even when session-message
  // indexes never existed. Deleted sessions remain classified as legacy.
  const legacySessions = active.flatMap(source => {
    const entity = source.entities.find(entity => entity.name === 'sessions')
    const id = entity?.columns.find(column => column.name === 'id')
    if (!entity || !id) return []
    const alias = quote(source.alias)
    return [source.records
      ? `SELECT ${decode(entity, id, source)} AS id FROM ${alias}.entity_records e WHERE e.entity_type='sessions'`
      : `SELECT id FROM ${alias}.sessions`]
  })
  db.exec(`CREATE TEMP VIEW overlay_legacy_sessions AS ${legacySessions.length ? legacySessions.join(' UNION ALL ') : 'SELECT NULL AS id WHERE 0'}`)
  const historyExists = (source: OverlaySource, entity: Entity, prefix: string): string => {
    const alias = quote(source.alias)
    if (source.records) return `EXISTS(SELECT 1 FROM ${alias}.entity_records h WHERE h.entity_type=${literal(entity.name)} AND h.entity_key=${entityKey(entity, prefix)})`
    const rows = `EXISTS(SELECT 1 FROM ${alias}.${quote(entity.name)} h WHERE ${entity.keys.map(key => `h.${quote(key)} IS ${prefix}.${quote(key)}`).join(' AND ')})`
    if (!source.messageEvents || !['agent_messages', 'agent_message_parts', 'session_messages'].includes(entity.name)) return rows
    return `(${rows} OR EXISTS(SELECT 1 FROM ${alias}.agent_message_events h WHERE h.entity_type=${literal(entity.name)} AND h.entity_id=CAST(${prefix}.${quote(entity.keys[0])} AS TEXT)))`
  }
  const readSql = (entity: Entity, predicate = '', newOnly = false): string => {
    const columns = (source?: OverlaySource) => entity.columns.map(column => `${decode(entity, column, source)} AS ${quote(column.name)}`).join(',')
    const substitute = (sql: string, records: boolean, source?: OverlaySource) => sql.replace(/existing\."((?:""|[^"])*)"/g, (_, field: string) => {
      const column = entity.columns.find(column => column.name === field.replace(/""/g, '"'))!
      return records ? decode(entity, column, source) : `old.${quote(column.name)}`
    })
    const filter = (records: boolean, source?: OverlaySource) => predicate ? ` AND (${substitute(predicate, records, source)})` : ''
    const branches = [`SELECT ${columns()} FROM main.entity_records e WHERE e.entity_type=${literal(entity.name)} AND e.operation='put' AND NOT EXISTS(SELECT 1 FROM main.entity_records n WHERE n.entity_type=e.entity_type AND n.entity_key=e.entity_key AND n.position>e.position)${filter(true)}`]
    const relevant = newOnly ? [] : active.filter(source => source.entities.some(old => old.name === entity.name))
    for (const [priority, source] of relevant.entries()) {
      const old = source.entities.find(old => old.name === entity.name)
      if (!old) continue
      const alias = quote(source.alias)
      // Every branch exposes the same decode expression as the source's
      // projection indexes. Outer session/key filters can push into each branch.
      if (source.records) {
        const shadow = [`EXISTS(SELECT 1 FROM main.entity_records n WHERE n.entity_type=${literal(entity.name)} AND n.entity_key=e.entity_key)`, ...relevant.slice(0, priority).map(previous => substitute(historyExists(previous, entity, 'existing'), true, source))]
        branches.push(`SELECT ${columns(source)} FROM ${alias}.entity_records e WHERE e.entity_type=${literal(entity.name)} AND e.operation='put' AND NOT EXISTS(SELECT 1 FROM ${alias}.entity_records n WHERE n.entity_type=e.entity_type AND n.entity_key=e.entity_key AND n.position>e.position) AND NOT (${shadow.join(' OR ')})${filter(true, source)}`)
      } else {
        const projected = entity.columns.map(column => `${old.columns.some(old => old.name === column.name) ? quote(column.name) : column.dflt_value ?? 'NULL'} AS ${quote(column.name)}`).join(',')
        const shadow = [`EXISTS(SELECT 1 FROM main.entity_records n WHERE n.entity_type=${literal(entity.name)} AND n.entity_key=${entityKey(entity, 'old')})`, ...relevant.slice(0, priority).map(previous => historyExists(previous, entity, 'old'))]
        branches.push(`SELECT ${entity.columns.map(column => `old.${quote(column.name)}`).join(',')} FROM (SELECT ${projected} FROM ${alias}.${quote(entity.name)}) old WHERE NOT (${shadow.join(' OR ')})${filter(false)}`)
      }
    }
    return branches.join(' UNION ALL ')
  }
  const existsSql = (name: string, predicate: string) => {
    const target = entities.get(name)
    if (!target) throw new Error(`Unknown overlay reference: ${name}`)
    return `EXISTS(SELECT 1 FROM (${readSql(target, predicate)}) LIMIT 1)`
  }
  for (const entity of definitions) {
    const integer = entity.columns.find(column => entity.keys.length === 1 && column.pk && /INTEGER/i.test(column.type))
    const relevant = active.filter(source => source.entities.some(old => old.name === entity.name))
    let integerIdSql: string | undefined, insertPrelude: string | undefined, insertHistoryCheck: string | undefined
    if (integer) {
      db.prepare('INSERT OR IGNORE INTO storage_overlay_ids(entity,last_id) VALUES (?,?)').run(entity.name, OVERLAY_INTEGER_START - 1n)
      const collision = (prefix: string) => [`EXISTS(SELECT 1 FROM main.entity_records h WHERE h.entity_type=${literal(entity.name)} AND h.entity_key=${entityKey(entity, prefix)})`, ...relevant.map(source => historyExists(source, entity, prefix))].join(' OR ')
      const field = quote(integer.name)
      integerIdSql = `(SELECT last_id FROM main.storage_overlay_ids WHERE entity=${literal(entity.name)})`
      // Each candidate uses indexed identity lookups, including deleted facts.
      // Update runs once per inserted row; all default normalization reads it.
      insertPrelude = `UPDATE storage_overlay_ids SET last_id=coalesce((WITH RECURSIVE candidate(${field}) AS (
        SELECT last_id+1 WHERE last_id<${INTEGER_LIMIT} UNION ALL SELECT ${field}+1 FROM candidate WHERE ${field}<${INTEGER_LIMIT} AND (${collision('candidate')}))
        SELECT ${field} FROM candidate WHERE NOT (${collision('candidate')}) LIMIT 1),RAISE(ABORT,'overlay integer namespace exhausted')) WHERE entity=${literal(entity.name)} AND NEW.${field} IS NULL;`
      insertHistoryCheck = `SELECT CASE WHEN NEW.${field} IS NOT NULL AND (${collision('NEW')}) THEN RAISE(ABORT,'integer entity identity was already used') END;`
    }
    installCurrentView(db, entity, definitions, true, { temporary: true, selectSql: readSql(entity), integerIdSql, insertPrelude, insertHistoryCheck, existsSql })
    if (['agent_messages', 'agent_message_parts', 'session_messages'].includes(entity.name)) db.exec(`CREATE TEMP VIEW ${quote(`overlay_new_${entity.name}`)} AS ${readSql(entity, '', true)}`)
  }
  if (!existing) markRecordIndexesComplete(db)
  progress('overlay-ready')
}

/** Tokenize strings/comments before checking targets, never splice SQL tokens. */
function sqlTokens(sql: string): Array<{ value: string; quoted: boolean }> {
  const result: Array<{ value: string; quoted: boolean }> = []
  const pattern = /\s+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|[A-Za-z_][\w$]*|./g
  for (const token of sql.match(pattern) ?? []) {
    if (/^\s|^--|^\/\*/.test(token)) continue
    const quoted = /^["`\[]/.test(token)
    result.push({ value: quoted ? token.slice(1, -1).replace(/""/g, '"').replace(/``/g, '`') : token, quoted })
  }
  return result
}

/** Only entity DML is writable. Ordinary ATTACH connections are protected here. */
export function guardOverlaySql(sql: string, entities: Set<string>): void {
  const tokens = sqlTokens(sql)
  const keyword = (index: number, value: string) => !tokens[index]?.quoted && tokens[index]?.value.toUpperCase() === value
  const deny = () => { throw new Error('Overlay SQL must read or write an unqualified entity view; storage and connection controls belong to the writer') }
  for (let i = 0; i < tokens.length; i++) {
    if (/^(?:load_extension|writefile|readfile|eval)$/i.test(tokens[i].value) && tokens[i + 1]?.value === '(') deny()
    if (tokens[i].value === ';' && i !== tokens.length - 1) deny()
  }
  if (keyword(0, 'SELECT')) return
  if (keyword(0, 'EXPLAIN')) {
    const start = keyword(1, 'QUERY') && keyword(2, 'PLAN') ? 3 : 1
    if (keyword(start, 'SELECT')) return
    deny()
  }
  if (keyword(0, 'WITH')) {
    if (tokens.some(token => !token.quoted && /^(?:INSERT|UPDATE|DELETE|REPLACE)$/i.test(token.value))) deny()
    if (tokens.some(token => !token.quoted && /^SELECT$/i.test(token.value))) return
    deny()
  }
  if (keyword(0, 'PRAGMA')) {
    let index = 1
    if (tokens[index + 1]?.value === '.') index += 2
    if (!/^(?:table_info|index_info|index_list|database_list|user_version|integrity_check|foreign_key_check)$/i.test(tokens[index]?.value ?? '')) deny()
    if (tokens.some(token => token.value === '=')) deny()
    if (tokens[index]?.value.toLowerCase() === 'user_version' && tokens[index + 1] && tokens[index + 1].value !== ';') deny()
    return
  }
  let index = 1
  if (keyword(0, 'INSERT') || keyword(0, 'REPLACE')) {
    if (keyword(index, 'OR')) index += 2
    if (!keyword(index++, 'INTO')) deny()
  } else if (keyword(0, 'UPDATE')) {
    if (keyword(index, 'OR')) index += 2
  } else if (keyword(0, 'DELETE')) {
    if (!keyword(index++, 'FROM')) deny()
  } else deny()
  const target = tokens[index]
  if (!target || /^(?:storage_|sqlite_|overlay_source_)|^(?:entity_records|migrations)$/i.test(target.value) || !entities.has(target.value) || tokens[index + 1]?.value === '.') deny()
}

export async function backupOverlayStorage(db: Database.Database, filename: string, sources: OverlaySource[], directory: string): Promise<StorageManifest> {
  const unavailable = sources.filter(source => source.warning || !source.attached)
  if (unavailable.length) throw new Error(`Overlay backup incomplete: unavailable legacy sources: ${unavailable.map(source => source.filename).join(', ')}`)
  const target = canonicalPath(directory)
  if ([filename, ...sources.map(source => source.filename)].some(file => canonicalPath(file) === target || canonicalPath(file).startsWith(target + path.sep))) throw new Error('Backup directory cannot contain an active database or legacy source')
  // Never overwrite a previous valid backup, nor publish a partial manifest.
  mkdirSync(path.dirname(target), { recursive: true })
  mkdirSync(target, { recursive: false })
  const manifest: StorageManifest = { format: 'record-overlay-v1', database: 'records.db', legacyPaths: [], sources: [] }
  await db.backup(path.join(target, manifest.database))
  mkdirSync(path.join(target, 'legacy'))
  for (const [index, source] of sources.entries()) {
    const snapshot = `legacy/${index}.db`
    const reader = new Database(source.filename, { readonly: true, fileMustExist: true, timeout: 0 })
    try { await reader.backup(path.join(target, snapshot)) } finally { reader.close() }
    manifest.legacyPaths.push(snapshot)
    manifest.sources.push({ originalPath: source.filename, snapshot })
  }
  writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' })
  return manifest
}
