import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { sql } from 'drizzle-orm'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'

test('native busy failure never poisons the next commit, in CJS or ESM', async () => {
  const { createRequire } = await import('node:module')
  const require = createRequire(import.meta.url)
  const NativeDatabase = require('better-sqlite3')
  const prepare = NativeDatabase.prototype.prepare
  const connections = new Set<{ open: boolean }>()
  NativeDatabase.prototype.prepare = function (...args: unknown[]) {
    connections.add(this)
    return prepare.apply(this, args)
  }
  try {
  for (const factory of [createClient, require('@libsql/client').createClient]) {
    for (const option of [{ encryptionKey: 'secret' }, { remoteEncryptionKey: 'secret' }, { syncUrl: 'https://example.com' }]) {
      expect(() => factory({ url: ':memory:', ...option })).toThrow(/does not support encryption or embedded replicas/)
    }
    const dir = mkdtempSync(join(tmpdir(), 'driver-lifecycle-'))
    const client = factory({ url: `file:${join(dir, 'db')}` })
    try {
      await client.execute('pragma journal_mode=wal')
      await client.execute('create table t(x)')
      for (let i = 0; i < 8; i++) {
        const tx = await client.transaction()
        expect((await tx.execute('pragma busy_timeout')).rows[0][0]).toBe(250)
        await tx.execute('insert into t values(1)')
        expect((await client.execute('pragma busy_timeout')).rows[0][0]).toBe(250)
        const started = performance.now()
        await expect(client.execute('insert into t values(2)')).rejects.toMatchObject({ code: 'SQLITE_BUSY' })
        expect(performance.now() - started).toBeLessThan(650)
        await tx.commit()
        expect(tx.closed).toBe(true)
        // No GC, sleeps, retry or reconnect between failed statement and commit.
        const next = await client.transaction()
        await next.execute('insert into t values(3)')
        await next.commit()
        const rollback = await client.transaction()
        await rollback.execute('insert into t values(4)')
        await rollback.rollback()
        rollback.close()
        expect([...connections].filter(db => db.open)).toHaveLength(0)
      }
      expect((await client.execute('select count(*) from t')).rows[0][0]).toBe(16)
      const held = await client.transaction()
      await expect(client.transaction()).rejects.toMatchObject({ code: 'SQLITE_BUSY' })
      await held.commit()
      const afterFailedBegin = await client.transaction()
      await afterFailedBegin.commit()
      const db = drizzle(client)
      await db.transaction(async tx => { await tx.run(sql`insert into t values(5)`) })
      await expect(db.transaction(async tx => {
        await tx.run(sql`insert into t values(6)`)
        throw new Error('rollback')
      })).rejects.toThrow('rollback')
      expect((await client.execute('select count(*) from t')).rows[0][0]).toBe(17)
    } finally {
      client.close()
      rmSync(dir, { recursive: true, force: true })
    }
  }
  expect([...connections].filter(db => db.open)).toHaveLength(0)
  } finally {
    NativeDatabase.prototype.prepare = prepare
  }
}, 15000)
