import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { configureDatabase, finalizeRecords } from '../../legacyRecordMigration'
import { initializeRecords } from '../../recordSchema'

type Row = Record<string, string | number | null>
const rows: Record<string, Row> = {
  agent_messages: { id: 'new-message', session_id: 's', sequence: 3, role: 'assistant', status: 'pending', created_at: 'now', updated_at: 'now' },
  agent_message_parts: { id: 'new-part', session_id: 's', message_id: 'parent', sequence: 2, type: 'text', data_json: '{}', created_at: 'now', updated_at: 'now' },
  session_messages: { id: 2, session_id: 's', role: 'agent', content: '{}', created_at: 'now', updated_at: 'now' }
}
const required: Record<string, string[]> = {
  agent_messages: ['id', 'session_id', 'sequence', 'role', 'status', 'created_at', 'updated_at'],
  agent_message_parts: ['id', 'session_id', 'message_id', 'sequence', 'type', 'data_json', 'created_at', 'updated_at'],
  session_messages: ['session_id', 'role', 'content']
}
const images = new Map<string, Buffer>()
let db: Database.Database

function insert(table: string, row: Row): void {
  const fields = Object.keys(row)
  db.prepare(`INSERT INTO ${table} (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`).run(...Object.values(row))
}
function update(table: string, field: string, value: string | number | null): void {
  db.prepare(`UPDATE ${table} SET ${field}=? WHERE id=?`).run(value, rows[table].id)
}
function history(): unknown {
  const table = db.prepare("SELECT name FROM sqlite_master WHERE name='entity_records'").get() ? 'entity_records' : 'agent_message_events'
  return db.prepare(`SELECT count(*) AS count FROM ${table}`).get()
}
function rejectsWithoutAppend(action: () => void): void {
  const before = history()
  expect(action).toThrow()
  expect(history()).toEqual(before)
}

beforeAll(() => {
  const source = new Database(':memory:')
  try {
    configureDatabase(source)
    const directory = path.resolve('resources/database/drizzle')
    // Use the actual production SQL, not a permissive table-shaped test fixture.
    for (const name of readdirSync(directory).filter(name => name.endsWith('.sql') && name < '0015').sort()) {
      source.exec(readFileSync(path.join(directory, name), 'utf8'))
    }
    source.exec("INSERT INTO agents(id,type,name,model,created_at,updated_at) VALUES ('a','x','Agent','model','now','now')")
    for (const id of ['s', 'other']) source.prepare("INSERT INTO sessions(id,agent_type,agent_id,name,model,created_at,updated_at) VALUES (?,'x','a','Session','model','now','now')").run(id)
    source.exec("INSERT INTO agent_messages(id,session_id,sequence,role,status,created_at,updated_at) VALUES ('parent','s',1,'user','completed','now','now'),('child','s',2,'assistant','completed','now','now'),('foreign','other',1,'user','completed','now','now')")
    source.exec("UPDATE agent_messages SET parent_message_id='parent' WHERE id='child'")
    source.exec("INSERT INTO agent_message_parts(id,session_id,message_id,sequence,type,data_json,created_at,updated_at) VALUES ('part','s','parent',1,'text','{}','now','now')")
    source.exec("INSERT INTO session_messages(id,session_id,role,content) VALUES (1,'s','user','{}')")
    images.set('0014', source.serialize())
    initializeRecords(source)
    source.function('record_written', { varargs: true }, () => null)
    finalizeRecords(source, () => undefined)
    images.set('records', source.serialize())
  } finally { source.close() }
})
afterEach(() => db?.close())

describe.each(['0014', 'records'])('%s message view constraints', stage => {
  beforeEach(() => {
    db = new Database(images.get(stage)!)
    configureDatabase(db)
    db.function('record_written', { varargs: true }, () => null)
  })

  for (const [table, fields] of Object.entries(required)) {
    for (const field of fields) {
      it(`${table}.${field} is required on INSERT and UPDATE`, () => {
        rejectsWithoutAppend(() => insert(table, { ...rows[table], [field]: null }))
        const omitted = { ...rows[table] }
        delete omitted[field]
        rejectsWithoutAppend(() => insert(table, omitted))
        insert(table, rows[table])
        rejectsWithoutAppend(() => update(table, field, null))
      })
    }

    it(`${table} requires an existing session on INSERT and UPDATE`, () => {
      rejectsWithoutAppend(() => insert(table, { ...rows[table], session_id: 'missing' }))
      insert(table, rows[table])
      rejectsWithoutAppend(() => update(table, 'session_id', 'missing'))
    })

    it(`${table} rejects duplicate IDs`, () => {
      insert(table, rows[table])
      rejectsWithoutAppend(() => insert(table, rows[table]))
    })
  }

  it.each(['role', 'status'])('rejects invalid message %s on INSERT and UPDATE', field => {
    rejectsWithoutAppend(() => insert('agent_messages', { ...rows.agent_messages, [field]: 'invalid' }))
    insert('agent_messages', rows.agent_messages)
    rejectsWithoutAppend(() => update('agent_messages', field, 'invalid'))
  })

  it('accepts every production role/status and optional fields', () => {
    insert('agent_messages', { ...rows.agent_messages, parent_message_id: null, completed_at: null })
    for (const role of ['user', 'assistant', 'system', 'tool']) update('agent_messages', 'role', role)
    for (const status of ['pending', 'streaming', 'completed', 'cancelled', 'failed', 'interrupted']) update('agent_messages', 'status', status)
    // 0014 permits arbitrary legacy roles and nullable legacy timestamps; part types are not enums.
    insert('session_messages', { session_id: 's', role: 'custom', content: '{}', created_at: null, updated_at: null })
    insert('agent_message_parts', { ...rows.agent_message_parts, type: 'custom' })
  })

  it.each(['missing', 'foreign'])('rejects parent %s on INSERT and UPDATE', parent => {
    rejectsWithoutAppend(() => insert('agent_messages', { ...rows.agent_messages, parent_message_id: parent }))
    insert('agent_messages', rows.agent_messages)
    rejectsWithoutAppend(() => update('agent_messages', 'parent_message_id', parent))
    update('agent_messages', 'parent_message_id', 'parent')
    update('agent_messages', 'parent_message_id', null)
  })

  it.each(['missing', 'foreign'])('rejects part message %s on INSERT and UPDATE', message => {
    rejectsWithoutAppend(() => insert('agent_message_parts', { ...rows.agent_message_parts, message_id: message }))
    insert('agent_message_parts', rows.agent_message_parts)
    rejectsWithoutAppend(() => update('agent_message_parts', 'message_id', message))
    update('agent_message_parts', 'message_id', 'child')
  })

  it.each(['agent_messages', 'agent_message_parts'])('%s enforces sequence uniqueness and immutable session identity', table => {
    rejectsWithoutAppend(() => insert(table, { ...rows[table], sequence: 1 }))
    insert(table, rows[table])
    rejectsWithoutAppend(() => update(table, 'sequence', 1))
    rejectsWithoutAppend(() => update(table, 'id', 'renamed'))
    rejectsWithoutAppend(() => update(table, 'session_id', 'other'))
  })

  it('deletes parts and clears only the parent reference while retaining history', () => {
    const before = history() as { count: number }
    db.exec("DELETE FROM agent_messages WHERE id='parent'")
    expect(db.prepare("SELECT session_id,parent_message_id FROM agent_messages WHERE id='child'").get()).toEqual({ session_id: 's', parent_message_id: null })
    expect(db.prepare("SELECT * FROM agent_message_parts WHERE message_id='parent'").all()).toEqual([])
    expect((history() as { count: number }).count).toBeGreaterThan(before.count)
    expect(db.prepare("SELECT id FROM agent_messages WHERE id='foreign'").get()).toEqual({ id: 'foreign' })
  })

  if (stage === 'records') {
    it('cascades session deletion across message views without deleting facts', () => {
      const before = history() as { count: number }
      db.exec("DELETE FROM sessions WHERE id='s'")
      for (const table of Object.keys(rows)) expect(db.prepare(`SELECT * FROM ${table} WHERE session_id='s'`).all()).toEqual([])
      expect((history() as { count: number }).count).toBeGreaterThan(before.count)
      expect(db.prepare("SELECT id FROM agent_messages WHERE session_id='other'").all()).toEqual([{ id: 'foreign' }])
    })
  }
})
