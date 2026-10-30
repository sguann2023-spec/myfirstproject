import type Database from 'better-sqlite3'

export const quote = (name: string): string => `"${name.replace(/"/g, '""')}"`
const literal = (value: string): string => `'${value.replace(/'/g, "''")}'`
interface Column { name: string; type: string; notnull: number; dflt_value: string | null; pk: number }
interface Reference { id?: number; table: string; from: string; to: string; on_delete: string; on_delete_columns?: string[] }
export interface Entity { name: string; columns: Column[]; keys: string[]; references: Reference[]; indexes: string[][]; uniques: string[][]; enums?: Record<string, string[]> }
const ignored = new Set(['migrations', 'agent_message_events', 'agent_message_snapshots'])
function referenceGroups(references: Reference[]): Reference[][] {
  const groups = new Map<string, Reference[]>()
  references.forEach((reference, index) => {
    const key = `${reference.table}:${reference.id ?? `manual-${index}`}`
    const group = groups.get(key) ?? []
    group.push(reference); groups.set(key, group)
  })
  return [...groups.values()]
}

export function initializeRecords(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS storage_upgrade (
    version INTEGER PRIMARY KEY, phase TEXT NOT NULL);
    INSERT OR IGNORE INTO storage_upgrade(version,phase) VALUES (2,'seed');
    CREATE TABLE IF NOT EXISTS storage_entities (
      name TEXT PRIMARY KEY, definition TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS entity_records (
      position INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL, entity_key TEXT NOT NULL,
      operation TEXT NOT NULL CHECK(operation IN ('put','delete')), payload TEXT NOT NULL CHECK(json_valid(payload)),
      recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      import_origin TEXT, import_id INTEGER, UNIQUE(import_origin,import_id));
    CREATE INDEX IF NOT EXISTS entity_records_latest ON entity_records(entity_type,entity_key,position);
    CREATE TRIGGER IF NOT EXISTS entity_records_no_update BEFORE UPDATE ON entity_records
      BEGIN SELECT RAISE(ABORT,'entity records are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS entity_records_no_delete BEFORE DELETE ON entity_records
      BEGIN SELECT RAISE(ABORT,'entity records are immutable'); END;`)
}

function jsonValue(expression: string): string {
  return `CASE WHEN typeof(${expression})='blob' THEN json_object('$blob',hex(${expression})) ELSE ${expression} END`
}
export function payload(entity: Entity, prefix: string): string {
  return `json_object(${entity.columns.flatMap(column => [literal(column.name), jsonValue(`${prefix}.${quote(column.name)}`)]).join(',')})`
}
export function entityKey(entity: Entity, prefix: string): string {
  return `json_array(${entity.keys.map(key => jsonValue(`${prefix}.${quote(key)}`)).join(',')})`
}
export function decodeColumn(column: Column, alias?: string, jsonPath = `$."${column.name.replace(/"/g, '\\"')}"`): string {
  const source = alias ? `${alias}.payload` : 'payload'
  const field = literal(jsonPath)
  const value = `json_extract(${source},${field})`
  return /BLOB/i.test(column.type) ? `CASE WHEN json_type(${source},${field})='object' THEN unhex(json_extract(${source},${literal(`${jsonPath}."$blob"`)})) ELSE ${value} END` : value
}
export function viewSql(entity: Entity, name = entity.name): string {
  return `CREATE VIEW ${quote(name)} AS SELECT ${entity.columns.map(column => `${decodeColumn(column, 'e')} AS ${quote(column.name)}`).join(',')}
    FROM entity_records e WHERE e.entity_type=${literal(entity.name)} AND e.operation='put'
    AND NOT EXISTS (SELECT 1 FROM entity_records newer WHERE newer.entity_type=e.entity_type
      AND newer.entity_key=e.entity_key AND newer.position>e.position)`
}

export function discoverEntities(db: Database.Database): Entity[] {
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>
  return names.filter(({ name }) => !ignored.has(name) && !name.startsWith('storage_') && name !== 'entity_records' && !name.startsWith('replay_') && !name.startsWith('v2_check_')).map(({ name }) => {
    const columns = db.prepare(`PRAGMA table_info(${quote(name)})`).all() as Column[]
    const indexRows = db.prepare(`PRAGMA index_list(${quote(name)})`).all() as Array<{ name: string; unique: number }>
    const indexes = indexRows.map(index => ({ ...index, columns: (db.prepare(`PRAGMA index_info(${quote(index.name)})`).all() as Array<{ name: string | null }>).map(column => column.name).filter((column): column is string => !!column) }))
    let keys = columns.filter(column => column.pk).sort((a, b) => a.pk - b.pk).map(column => column.name)
    if (!keys.length) keys = name === 'pi_session_entries' ? ['topic_id', 'entry_id']
      : columns.some(column => column.name === 'id') ? ['id'] : indexes.find(index => index.unique)?.columns ?? []
    if (!keys.length) throw new Error(`Cannot migrate ${name}: no stable identity`)
    const references = db.prepare(`PRAGMA foreign_key_list(${quote(name)})`).all() as Reference[]
    const uniques = indexes.filter(index => index.unique).map(index => index.columns)
    return withMessageConstraints({ name, columns, keys, references, indexes: indexes.map(index => index.columns), uniques })
  })
}

/** Patch stored metadata without rediscovering constraints from lossy view PRAGMAs. */
export function withMessageConstraints(entity: Entity): Entity {
  entity = JSON.parse(JSON.stringify(entity)) as Entity
  const { name, columns, references, uniques } = entity
  // Migration 0014 command views no longer expose constraints through PRAGMA.
  const required = name === 'agent_messages' ? ['id', 'session_id', 'sequence', 'role', 'status', 'created_at', 'updated_at']
    : name === 'agent_message_parts' ? ['id', 'session_id', 'message_id', 'sequence', 'type', 'data_json', 'created_at', 'updated_at']
      : name === 'session_messages' ? ['session_id', 'role', 'content'] : []
  for (const column of columns) if (required.includes(column.name)) column.notnull = 1
  if (name === 'session_messages') Object.assign(columns.find(column => column.name === 'id')!, { pk: 1, type: 'INTEGER' })
  if (required.length && !references.some(reference => reference.table === 'sessions' && reference.from === 'session_id')) {
    references.push({ table: 'sessions', from: 'session_id', to: 'id', on_delete: 'CASCADE' })
  }
  let enums = entity.enums
  if (name === 'agent_messages') {
    if (!uniques.some(fields => fields.join(',') === 'session_id,sequence')) uniques.push(['session_id', 'sequence'])
    enums = { role: ['user', 'assistant', 'system', 'tool'], status: ['pending', 'streaming', 'completed', 'cancelled', 'failed', 'interrupted'] }
    // Both columns belong to one reference, but deleting a parent must retain the session.
    for (let i = references.length - 1; i >= 0; i--) if (references[i].table === 'agent_messages') references.splice(i, 1)
    const id = Math.max(-1, ...references.map(reference => reference.id ?? -1)) + 1
    references.push(
      { id, table: 'agent_messages', from: 'session_id', to: 'session_id', on_delete: 'SET NULL', on_delete_columns: ['parent_message_id'] },
      { id, table: 'agent_messages', from: 'parent_message_id', to: 'id', on_delete: 'SET NULL' }
    )
  }
  if (name === 'agent_message_parts') {
    if (!uniques.some(fields => fields.join(',') === 'message_id,sequence')) uniques.push(['message_id', 'sequence'])
    for (let i = references.length - 1; i >= 0; i--) if (references[i].table === 'agent_messages') references.splice(i, 1)
    const id = Math.max(-1, ...references.map(reference => reference.id ?? -1)) + 1
    references.push(
      { id, table: 'agent_messages', from: 'session_id', to: 'session_id', on_delete: 'CASCADE' },
      { id, table: 'agent_messages', from: 'message_id', to: 'id', on_delete: 'CASCADE' }
    )
  }
  entity.enums = enums
  return entity
}

export function storedEntities(db: Database.Database): Entity[] {
  return (db.prepare('SELECT definition FROM storage_entities ORDER BY name').all() as Array<{ definition: string }>).map(row => JSON.parse(row.definition))
}

export function recordIndexFields(entity: Entity): string[][] {
  const references = referenceGroups(entity.references).flatMap(group => {
    const fields = group.map(reference => reference.from)
    return fields.map((_, index) => fields.slice(0, index + 1))
  })
  const session = entity.name === 'agent_messages' ? [['session_id', 'sequence']]
    : entity.name === 'agent_message_parts' ? [['session_id', 'message_id', 'sequence']]
      : entity.name === 'session_messages' ? [['session_id', 'id']] : []
  const candidates = [entity.keys, ...entity.uniques, ...entity.indexes, ...references, ...session]
  const fields = new Map<string, string[]>()
  for (const candidate of candidates) {
    if (candidate.length && candidate.every(field => entity.columns.some(column => column.name === field))) {
      fields.set(JSON.stringify(candidate), candidate)
    }
  }
  return [...fields.values()]
}

export function installRecordIndexes(db: Database.Database, entity: Entity): void {
  for (const [index, fields] of recordIndexFields(entity).entries()) {
    // These are lookup indexes over history, not UNIQUE indexes over current rows.
    const expressions = fields.map(field => decodeColumn(entity.columns.find(column => column.name === field)!))
    db.exec(`CREATE INDEX IF NOT EXISTS ${quote(`v2_index_${entity.name}_${index}`)} ON entity_records(${expressions.join(',')},position) WHERE entity_type=${literal(entity.name)}`)
  }
}

/** Persistent current views are the read model; their commands only append facts. */
export interface CurrentViewOptions { temporary?: boolean; selectSql?: string; integerIdSql?: string; insertPrelude?: string; insertHistoryCheck?: string; existsSql?: (entity: string, predicate: string) => string }
export function installCurrentView(db: Database.Database, entity: Entity, entities: Entity[], indexes = true, options: CurrentViewOptions = {}): void {
  const create = options.temporary ? 'CREATE TEMP' : 'CREATE'
  db.exec(options.selectSql ? `${create} VIEW ${quote(entity.name)} AS ${options.selectSql}` : viewSql(entity))
  const inserted = entity.columns.map(column => {
    const value = `NEW.${quote(column.name)}`
    let expression = column.dflt_value === null ? value : `coalesce(${value},${column.dflt_value})`
    if (entity.keys.length === 1 && column.pk && /INTEGER/i.test(column.type)) {
      const generated = options.integerIdSql ?? `(SELECT coalesce(max(${decodeColumn(column)}),0)+1 FROM entity_records WHERE entity_type=${literal(entity.name)})`
      expression = `coalesce(${value},${generated})`
    }
    return `${expression} AS ${quote(column.name)}`
  }).join(',')
  const checks = (prefix: string) => entity.columns.filter(column => column.notnull || entity.keys.includes(column.name)).map(column =>
    `SELECT CASE WHEN ${prefix}.${quote(column.name)} IS NULL THEN RAISE(ABORT,${literal(`${entity.name}.${column.name} must not be null`)}) END FROM (SELECT ${inserted}) value;`).join('\n')
  // INSERT/UPDATE checks use the normalized row so omitted SQL defaults survive.
  const insertChecks = checks('value')
  const exists = (name: string, predicate: string) => options.existsSql?.(name, predicate) ?? `EXISTS(SELECT 1 FROM ${quote(name)} existing WHERE ${predicate})`
  const identityMatch = entity.keys.map(key => `existing.${quote(key)} IS value.${quote(key)}`).join(' AND ')
  const insertIdentity = `SELECT CASE WHEN ${exists(entity.name, identityMatch)} THEN RAISE(ABORT,'duplicate entity identity') END FROM (SELECT ${inserted}) value;`
  const constraints = (prefix: string, normalized: boolean) => {
    const from = normalized ? ` FROM (SELECT ${inserted}) value` : ''
    const uniqueness = entity.uniques.filter(fields => fields.length).map(fields => `SELECT CASE WHEN ${exists(entity.name, `${fields.map(field => `existing.${quote(field)}=${prefix}.${quote(field)}`).join(' AND ')} AND NOT (${entity.keys.map(key => `existing.${quote(key)} IS ${prefix}.${quote(key)}`).join(' AND ')})`)} THEN RAISE(ABORT,'unique entity constraint') END${from};`).join('\n')
    const required = entity.columns.filter(column => column.notnull || entity.keys.includes(column.name)).map(column => `SELECT CASE WHEN ${prefix}.${quote(column.name)} IS NULL THEN RAISE(ABORT,'required entity field') END${from};`).join('\n')
    const foreign = referenceGroups(entity.references).map(group => `SELECT CASE WHEN ${group.map(reference => `${prefix}.${quote(reference.from)} IS NOT NULL`).join(' AND ')} AND NOT ${exists(group[0].table, group.map(reference => `existing.${quote(reference.to)}=${prefix}.${quote(reference.from)}`).join(' AND '))} THEN RAISE(ABORT,'missing referenced entity') END${from};`).join('\n')
    const enums = Object.entries(entity.enums ?? {}).map(([field, values]) => `SELECT CASE WHEN ${prefix}.${quote(field)} NOT IN (${values.map(literal).join(',')}) THEN RAISE(ABORT,'invalid entity enum') END${from};`).join('\n')
    const integers = options.temporary ? entity.columns.filter(column => column.pk && entity.keys.length === 1 && /INTEGER/i.test(column.type)).map(column => `SELECT CASE WHEN typeof(${prefix}.${quote(column.name)})<>'integer' THEN RAISE(ABORT,'integer entity identity overflow or invalid type') END${from};`).join('\n') : ''
    return `${required}\n${uniqueness}\n${foreign}\n${enums}\n${integers}`
  }
  db.exec(`${create} TRIGGER ${quote(`v2_insert_${entity.name}`)} INSTEAD OF INSERT ON ${quote(entity.name)} BEGIN
    ${options.insertPrelude ?? ''}
    ${insertChecks} ${insertIdentity} ${options.insertHistoryCheck ?? ''} ${constraints('value', true)}
    INSERT INTO entity_records(entity_type,entity_key,operation,payload)
      SELECT ${literal(entity.name)},${entityKey(entity, 'value')},'put',${payload(entity, 'value')} FROM (SELECT ${inserted}) value;
    SELECT record_written(${literal(entity.name)},last_insert_rowid()); END;
    ${create} TRIGGER ${quote(`v2_update_${entity.name}`)} INSTEAD OF UPDATE ON ${quote(entity.name)} BEGIN
    SELECT CASE WHEN ${entity.keys.map(key => `NEW.${quote(key)} IS NOT OLD.${quote(key)}`).join(' OR ')} THEN RAISE(ABORT,'entity identity is immutable') END;
    ${['agent_messages', 'agent_message_parts'].includes(entity.name) ? "SELECT CASE WHEN NEW.session_id IS NOT OLD.session_id THEN RAISE(ABORT,'message identity is immutable') END;" : ''}
    ${constraints('NEW', false)}
    INSERT INTO entity_records(entity_type,entity_key,operation,payload)
      VALUES (${literal(entity.name)},${entityKey(entity, 'NEW')},'put',${payload(entity, 'NEW')});
    SELECT record_written(${literal(entity.name)},last_insert_rowid()); END;`)
  const dependents = entities.flatMap(child => referenceGroups(child.references.filter(reference => reference.table === entity.name)).map(group => ({ child, group })))
  // Keep parents visible during child checks; tombstone first only for self references.
  const cascade = (beforeDelete: boolean) => dependents.filter(({ child }) => (child.name !== entity.name) === beforeDelete).map(({ child, group }) => {
    const match = group.map(reference => `${quote(reference.from)}=OLD.${quote(reference.to)}`).join(' AND ')
    return group[0].on_delete === 'CASCADE' ? `DELETE FROM ${quote(child.name)} WHERE ${match};`
      : group[0].on_delete === 'SET NULL' ? `UPDATE ${quote(child.name)} SET ${(group[0].on_delete_columns ?? group.map(reference => reference.from)).map(field => `${quote(field)}=NULL`).join(',')} WHERE ${match};` : ''
  }).join('\n')
  const restricted = dependents.filter(({ group }) => !['CASCADE', 'SET NULL'].includes(group[0].on_delete)).map(({ child, group }) => `SELECT CASE WHEN EXISTS(SELECT 1 FROM ${quote(child.name)} WHERE ${group.map(reference => `${quote(reference.from)}=OLD.${quote(reference.to)}`).join(' AND ')}) THEN RAISE(ABORT,'referenced entity cannot be deleted') END;`).join('\n')
  db.exec(`${create} TRIGGER ${quote(`v2_delete_${entity.name}`)} INSTEAD OF DELETE ON ${quote(entity.name)} BEGIN
    ${restricted}
    ${cascade(true)}
    INSERT INTO entity_records(entity_type,entity_key,operation,payload)
      VALUES (${literal(entity.name)},${entityKey(entity, 'OLD')},'delete',${payload(entity, 'OLD')});
    SELECT record_written(${literal(entity.name)},last_insert_rowid()); ${cascade(false)} END;`)
  if (indexes) installRecordIndexes(db, entity)
}
