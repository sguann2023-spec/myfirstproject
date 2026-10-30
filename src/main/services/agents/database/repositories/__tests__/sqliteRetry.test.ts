import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { WorkerDatabaseClient } from '../../workerClient'
import { withoutTransaction } from '../../withoutTransaction'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isSqliteBusy, retrySqliteBusy, sqliteErrorDiagnostics } from '../../sqliteRetry'

afterEach(() => vi.useRealTimers())

describe('agent DB one-shot writes and safe diagnostics', () => {
  it('preserves nested SQLite codes without exposing SQL or parameters', () => {
    const cause = Object.assign(new Error('SQLITE_BUSY: database is locked'), { code: 'SQLITE_BUSY', rawCode: 5 })
    const error = new Error('Failed query: secret SQL params: secret-token', { cause })
    const diagnostics = sqliteErrorDiagnostics(error)
    expect(diagnostics.causes[1]).toMatchObject({ code: 'SQLITE_BUSY', rawCode: 5, category: 'busy' })
    expect(JSON.stringify(diagnostics)).not.toMatch(/secret|params|Failed query/)
  })

  it.each([
    ['FOREIGN KEY constraint failed', 'foreign_key'],
    ['UNIQUE constraint failed: private.value', 'unique'],
    ['NOT NULL constraint failed: private.value', 'not_null'],
    ['no such table: private', 'missing_table'],
    ['table private has no column named value', 'missing_column']
  ])('classifies %s without logging the message', (message, category) => {
    const diagnostics = sqliteErrorDiagnostics(new Error(message))
    expect(diagnostics.category).toBe(category)
    expect(JSON.stringify(diagnostics)).not.toContain('private')
  })

  it('bounds cyclic diagnostic causes and handles non-errors', () => {
    const cycle = { name: 'Error', cause: null as unknown }
    cycle.cause = cycle
    expect(sqliteErrorDiagnostics(cycle).causes).toHaveLength(1)
    expect(sqliteErrorDiagnostics(null)).toEqual({ name: 'UnknownError', causes: [] })
  })

  it('recognizes nested and aggregate busy errors without cycling', () => {
    const error = new Error('wrapped', { cause: new AggregateError([new Error('SQLITE_BUSY_SNAPSHOT')]) })
    expect(isSqliteBusy(error)).toBe(true)
    const cycle = { cause: null as unknown, message: 'unrelated' }
    cycle.cause = cycle
    expect(isSqliteBusy(cycle)).toBe(false)
  })

  it.each(['SQLITE_BUSY', 'SQLITE_BUSY_SNAPSHOT', 'SQLITE_CONSTRAINT'])('propagates %s once without delaying independent operations', async (code) => {
    vi.useFakeTimers()
    const error = Object.assign(new Error('private SQL and parameters'), { code })
    const operation = vi.fn(async () => { throw error })
    await expect(retrySqliteBusy(operation)).rejects.toBe(error)
    expect(operation).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
    const next = vi.fn(async () => 42)
    expect(await retrySqliteBusy(next)).toBe(42)
    expect(next).toHaveBeenCalledOnce()
  })

  it('runs once on the root executor and propagates callback errors unchanged', async () => {
    const database = { transaction: vi.fn(() => { throw new Error('Unexpected transaction') }) }
    const callback = vi.fn(async executor => {
      expect(executor).toBe(database)
      return 42
    })
    expect(await withoutTransaction(database, callback)).toBe(42)
    expect(callback).toHaveBeenCalledOnce()
    const error = new Error('callback failed')
    const failed = vi.fn(async () => { throw error })
    await expect(withoutTransaction(database, failed)).rejects.toBe(error)
    expect(failed).toHaveBeenCalledOnce()
    expect(database.transaction).not.toHaveBeenCalled()
  })

  it('never retries a failed append, stops later requests, and restores the durable prefix on explicit restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-one-shot-'))
    const config = { url: 'file:' + join(directory, 'test.db'), intMode: 'number' as const }
    let client = new WorkerDatabaseClient(config, resolve('out/main/databaseWorker.js'))
    try {
      await client.execute('CREATE TABLE entries (id INTEGER PRIMARY KEY, value TEXT)')
      await client.finalizeSchema()
      const execute = vi.spyOn(client, 'execute')
      const operation = vi.fn(() => withoutTransaction(client, async executor => {
        await executor.execute("INSERT INTO entries VALUES (1, 'durable')")
        await executor.execute("INSERT INTO entries VALUES (1, 'duplicate')")
        await executor.execute("INSERT INTO entries VALUES (2, 'tail')")
      }))
      await expect(retrySqliteBusy(operation)).rejects.toThrow(/duplicate entity identity/)
      expect(operation).toHaveBeenCalledOnce()
      expect(execute).toHaveBeenCalledTimes(2)
      expect(client.closed).toBe(true)
      await expect(client.execute('SELECT * FROM entries')).rejects.toThrow()
      await expect(client.execute("INSERT INTO entries VALUES (3, 'stopped')")).rejects.toThrow()
      execute.mockRestore()
      await client.closeAsync()
      client = new WorkerDatabaseClient(config, resolve('out/main/databaseWorker.js'))
      expect((await client.execute('SELECT * FROM entries ORDER BY id')).rows).toEqual([{ id: 1, value: 'durable' }])
      await client.execute("INSERT INTO entries VALUES (2, 'explicit new command')")
      expect((await client.execute('SELECT id FROM entries ORDER BY id')).rows).toEqual([{ id: 1 }, { id: 2 }])
    } finally {
      await client.closeAsync()
      await rm(directory, { recursive: true, force: true })
    }
  })
})
