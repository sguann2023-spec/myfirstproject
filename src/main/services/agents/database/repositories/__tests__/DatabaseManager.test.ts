import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) } }))
vi.mock('@main/utils', () => ({ getResourcePath: () => '/resources' }))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/agent-db-init-test' } }))
vi.mock('../../DataMigrationService', () => ({ DataMigrationService: class {} }))
const migration = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('../../MigrationService', () => ({ MigrationService: class { runMigrations = migration.run } }))
const worker = vi.hoisted(() => ({ construct: vi.fn(), ready: vi.fn(async () => {}), backup: vi.fn(async () => {}), finalize: vi.fn() }))
vi.mock('../../workerClient', () => ({ WorkerDatabaseClient: class {
  constructor(...args: any[]) { worker.construct(...args) }
  waitUntilReady = worker.ready
  backupStorage = worker.backup
  finalizeSchema = worker.finalize
  closeAsync = vi.fn(async () => {})
} }))
const files = vi.hoisted(() => ({ lstatSync: vi.fn(() => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }) }), existsSync: vi.fn((filename: string) => !filename.endsWith('record-storage')), statSync: vi.fn(() => ({ size: 0 })), renameSync: vi.fn(), unlinkSync: vi.fn(), mkdirSync: vi.fn() }))
vi.mock('fs', () => ({ default: files }))
vi.mock('../../canonicalTranscriptMigration', () => ({ reconcileInterruptedAgentWork: vi.fn() }))

import { DatabaseManager } from '../../DatabaseManager'

afterEach(async () => {
  await DatabaseManager.close()
  ;(DatabaseManager as any).shuttingDown = false
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('DatabaseManager initialization singleflight', () => {
  it('shares one initializer and waits for it during close', async () => {
    let release!: () => void
    const initialize = vi.spyOn(DatabaseManager.prototype, 'initialize').mockImplementation(
      () => new Promise<void>((resolve) => { release = resolve })
    )
    const first = DatabaseManager.getInstance()
    const second = DatabaseManager.getInstance()
    let closed = false
    const closing = DatabaseManager.close().then(() => { closed = true })
    expect(closed).toBe(false)
    expect(initialize).toHaveBeenCalledTimes(1)
    release()
    expect(await first).toBe(await second)
    await closing
    initialize.mockResolvedValue(undefined)
    expect(await DatabaseManager.getInstance()).not.toBe(await first)
    expect(initialize).toHaveBeenCalledTimes(2)
  })

  it('shares initialization failure and permits a later clean attempt', async () => {
    const failure = new Error('initialization failed')
    const initialize = vi.spyOn(DatabaseManager.prototype, 'initialize').mockRejectedValueOnce(failure)
    const results = await Promise.allSettled([DatabaseManager.getInstance(), DatabaseManager.getInstance()])
    expect(results).toEqual([{ status: 'rejected', reason: failure }, { status: 'rejected', reason: failure }])
    expect(initialize).toHaveBeenCalledTimes(1)
    initialize.mockResolvedValue(undefined)
    await DatabaseManager.getInstance()
    expect(initialize).toHaveBeenCalledTimes(2)
  })
  it('does not publish readiness until the overlay worker is ready', async () => {
    let release!: () => void
    let entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    worker.ready.mockImplementationOnce(() => { entered(); return new Promise<void>(resolve => { release = resolve }) })
    let ready = false
    const result = DatabaseManager.getInstance().then(manager => { ready = true; return manager })
    await started
    await Promise.resolve()
    expect(ready).toBe(false)
    release()
    expect((await result).isInitialized()).toBe(true)
  })

  it('rejects readiness when overlay initialization fails', async () => {
    worker.ready.mockRejectedValueOnce(new Error('overlay failed'))
    await expect(DatabaseManager.getInstance()).rejects.toThrow('overlay failed')
  })

  it('opens records.db with ordered legacy sources without moving, deleting or migrating them', async () => {
    const manager = await DatabaseManager.getInstance()
    expect(worker.construct).toHaveBeenCalledWith(
      { url: 'file:/tmp/agent-db-init-test/Data/records.db', intMode: 'number' }, undefined, expect.any(Function),
      { legacyPaths: [
        '/tmp/agent-db-init-test/Data/agents.db.v2.db', '/tmp/agent-db-init-test/Data/agents.db',
        '/tmp/agent-db-init-test/agents.db.v2.db', '/tmp/agent-db-init-test/agents.db'
      ], migrationDir: '/resources/database/drizzle' }
    )
    expect(files.renameSync).not.toHaveBeenCalled()
    expect(files.unlinkSync).not.toHaveBeenCalled()
    expect(files.statSync).not.toHaveBeenCalled()
    expect(migration.run).not.toHaveBeenCalled()
    expect(worker.finalize).not.toHaveBeenCalled()
    await manager.backupStorage('/backup')
    expect(worker.backup).toHaveBeenCalledWith('/backup')
  })

  it('passes only existing legacy sources to the worker', async () => {
    files.existsSync.mockImplementation(filename => !filename.endsWith('record-storage') && !filename.endsWith('agents.db'))
    await DatabaseManager.getInstance()
    expect(worker.construct.mock.calls[0][3].legacyPaths).toEqual([
      '/tmp/agent-db-init-test/Data/agents.db.v2.db', '/tmp/agent-db-init-test/agents.db.v2.db'
    ])
    files.existsSync.mockImplementation(filename => !filename.endsWith('record-storage'))
  })

  it('closes on app shutdown and refuses late requests that would reopen the writer', async () => {
    const initialize = vi.spyOn(DatabaseManager.prototype, 'initialize').mockResolvedValue(undefined)
    const manager = await DatabaseManager.getInstance()
    const closeAsync = vi.fn(async () => undefined)
    ;(manager as any).client = { closeAsync }
    await DatabaseManager.shutdown()
    expect(closeAsync).toHaveBeenCalledTimes(1)
    await expect(DatabaseManager.getInstance()).rejects.toThrow('Database is shutting down')
    expect(initialize).toHaveBeenCalledTimes(1)
  })

})
