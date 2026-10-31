import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import * as fs from 'fs-extra'
import path from 'node:path'
import { tmpdir } from 'node:os'
import StreamZip from 'node-stream-zip'
import { PersistentRecordStore } from '../agents/database/persistentRecordStore'

const state = vi.hoisted(() => ({ root: '', userData: '', backup: vi.fn(), maintenance: vi.fn(), isWin: false, relaunch: vi.fn(), exit: vi.fn() }))
vi.mock('electron', () => ({ app: {
  getPath: (name: string) => name === 'userData' ? state.userData : state.root,
  getVersion: () => 'test', relaunch: state.relaunch, exit: state.exit
} }))
vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) } }))
vi.mock('@main/constant', () => ({ get isWin() { return state.isWin } }))
vi.mock('@shared/IpcChannel', () => ({ IpcChannel: { BackupProgress: 'backup' } }))
vi.mock('../WindowService', () => ({ windowService: { getMainWindow: () => undefined } }))
vi.mock('../WebDav', () => ({ default: class {} }))
vi.mock('../S3Storage', () => ({ default: class {} }))
vi.mock('../../utils', () => ({ getDataPath: () => path.join(state.userData, 'Data') }))
vi.mock('../../utils/file', () => ({ resolveAndValidatePath: vi.fn() }))
vi.mock('../agents/database/DatabaseManager', () => ({ DatabaseManager: {
  getInstance: async () => ({ backupStorage: state.backup }),
  beginStorageMaintenance: state.maintenance
} }))

import BackupManager from '../BackupManager'

let store: PersistentRecordStore
let legacy: Database.Database
beforeEach(async () => {
  state.isWin = false
  state.relaunch.mockClear()
  state.exit.mockClear()
  state.root = await fs.mkdtemp(path.join(tmpdir(), 'agent-backup-test-'))
  state.userData = path.join(state.root, 'userData')
  await fs.ensureDir(path.join(state.userData, 'Data'))
  const schema = 'CREATE TABLE items(id TEXT PRIMARY KEY,name TEXT);'
  const migrationDir = path.join(state.root, 'schema')
  await fs.outputJson(path.join(migrationDir, 'meta/_journal.json'), { entries: [{ idx: 0, tag: 'initial' }] })
  await fs.outputFile(path.join(migrationDir, 'initial.sql'), schema)
  legacy = new Database(path.join(state.userData, 'Data/agents.db'))
  legacy.pragma('journal_mode = WAL')
  legacy.exec(schema + "INSERT INTO items VALUES ('a','old'); INSERT INTO items VALUES ('b','legacy');")
  store = await PersistentRecordStore.openOverlay(path.join(state.userData, 'Data/records.db'), 'bigint', undefined, {
    legacyPaths: [legacy.name], migrationDir
  })
  store.execute("UPDATE items SET name='committed' WHERE id='a'")
  state.backup.mockReset().mockImplementation(async (destination: string) => {
    expect(await fs.pathExists(destination)).toBe(false)
    await store.backupStorage(destination) // Manager returns void, not the core manifest.
  })
  state.maintenance.mockReset().mockImplementation(async () => { store.close() })
})
afterEach(async () => {
  store?.close()
  if (legacy?.open) legacy.close()
  await fs.remove(state.root)
})

describe('consistent database backups', () => {
  it.each(['direct', 'legacy'] as const)('%s retains the database when attachments are skipped', async format => {
    await fs.outputFile(path.join(state.userData, 'Data/attachment.txt'), 'attachment')
    const manager = new BackupManager()
    const filename = format === 'direct'
      ? await manager.backup({} as Electron.IpcMainInvokeEvent, 'export.zip', state.root, true)
      : await manager.backupLegacy({} as Electron.IpcMainInvokeEvent, 'export.zip', '{}', state.root, true)
    const zip = new StreamZip.async({ file: filename })
    try {
      const entries = await zip.entries()
      expect(entries['Data/record-storage/records.db']).toBeDefined()
      expect(entries['Data/record-storage/legacy/0.db']).toBeDefined()
      expect(entries['Data/attachment.txt']).toBeUndefined()
      const manifest = JSON.parse((await zip.entryData('Data/record-storage/manifest.json')).toString())
      expect(manifest).toEqual({ format: 'record-overlay-v1', database: 'records.db', legacyPaths: ['legacy/0.db'],
        sources: [{ originalPath: await fs.realpath(legacy.name), snapshot: 'legacy/0.db' }] })
      const image = await zip.entryData('Data/record-storage/legacy/0.db')
      image[18] = 1; image[19] = 1
      const database = new Database(image)
      try {
        expect(database.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
        expect(database.prepare('SELECT id,name FROM items').all()).toEqual([{ id: 'a', name: 'old' }, { id: 'b', name: 'legacy' }])
      } finally { database.close() }
      const extracted = path.join(state.root, 'extracted')
      await fs.ensureDir(extracted)
      await zip.extract('Data/record-storage/', extracted)
      const restored = await PersistentRecordStore.openOverlay(path.join(extracted, manifest.database), 'bigint', undefined, {
        legacyPaths: manifest.legacyPaths.map((file: string) => path.join(extracted, file)), migrationDir: path.join(state.root, 'schema')
      })
      try { expect(restored.execute('SELECT id,name FROM items ORDER BY id').rows).toEqual([['a', 'committed'], ['b', 'legacy']]) }
      finally { restored.close() }
      expect(state.backup).toHaveBeenCalledTimes(1)
    } finally { await zip.close() }
  })

  it.each(['direct', 'legacy'] as const)('%s excludes root storage artifacts without dropping attachment names', async format => {
    const data = path.join(state.userData, 'Data')
    const before = await fs.readFile(legacy.name)
    for (const name of ['agents.db.append.db', 'agents.db.append.db.baseline.db', 'agents.db.v2.db.importing', 'records.db.importing', 'records.db.old']) {
      await fs.outputFile(path.join(data, name), 'obsolete')
    }
    await fs.outputFile(path.join(data, 'agents.db.append.db.read-cache/checkpoint.bin'), 'obsolete')
    await fs.outputFile(path.join(data, 'record-storage/stale.db'), 'stale suite')
    await fs.outputFile(path.join(data, 'files/agents.db'), 'user attachment')
    await fs.outputFile(path.join(data, 'files/records.db'), 'record attachment')
    await fs.outputFile(path.join(data, 'attachment.txt'), 'attachment')
    const manager = new BackupManager()
    const filename = format === 'direct'
      ? await manager.backup({} as Electron.IpcMainInvokeEvent, 'export.zip', state.root)
      : await manager.backupLegacy({} as Electron.IpcMainInvokeEvent, 'export.zip', '{}', state.root)
    const zip = new StreamZip.async({ file: filename })
    try {
      const names = Object.keys(await zip.entries()).filter(name => !name.endsWith('/'))
      expect(names.filter(name => /^Data\/(?:agents|records)\.db/.test(name))).toEqual([])
      expect(names.filter(name => name.startsWith('Data/record-storage/')).sort()).toEqual([
        'Data/record-storage/legacy/0.db', 'Data/record-storage/manifest.json', 'Data/record-storage/records.db'
      ])
      expect(await zip.entryData('Data/files/agents.db')).toEqual(Buffer.from('user attachment'))
      expect(await zip.entryData('Data/files/records.db')).toEqual(Buffer.from('record attachment'))
      expect(await zip.entryData('Data/attachment.txt')).toEqual(Buffer.from('attachment'))
    } finally { await zip.close() }
    expect(await fs.readFile(legacy.name)).toEqual(before)
  })

  it.each(['direct', 'legacy'] as const)('%s fails instead of publishing a database-free archive when export fails', async format => {
    state.backup.mockRejectedValueOnce(new Error('database export failed'))
    const manager = new BackupManager()
    const result = format === 'direct'
      ? manager.backup({} as Electron.IpcMainInvokeEvent, 'export.zip', state.root, true)
      : manager.backupLegacy({} as Electron.IpcMainInvokeEvent, 'export.zip', '{}', state.root, true)
    await expect(result).rejects.toThrow('database export failed')
    expect(await fs.pathExists(path.join(state.root, 'export.zip'))).toBe(false)
  })

  it('rejects an export that resolves without publishing the final manifest', async () => {
    state.backup.mockImplementationOnce(async (directory: string) => {
      await fs.ensureDir(directory)
      await fs.outputFile(path.join(directory, 'records.db'), 'partial')
    })
    await expect(new BackupManager().backup({} as Electron.IpcMainInvokeEvent, 'export.zip', state.root, true))
      .rejects.toThrow('Missing record storage manifest')
    expect(await fs.pathExists(path.join(state.root, 'export.zip'))).toBe(false)
  })

  it('clears stale staging files before a legacy backup', async () => {
    const staging = path.join(state.root, 'cherry-studio/backup/temp')
    await fs.outputJson(path.join(staging, 'metadata.json'), { appName: 'wrong format' })
    const filename = await new BackupManager().backupLegacy({} as Electron.IpcMainInvokeEvent, 'export.zip', '{}', state.root, true)
    const zip = new StreamZip.async({ file: filename })
    try { expect((await zip.entries())['metadata.json']).toBeUndefined() }
    finally { await zip.close() }
  })
})

type RestoreInternals = { tempDir: string; restoreDirect(): Promise<void>; restoreLegacy(): Promise<string> }
const prepareRestore = async () => {
  const manager = new BackupManager()
  const internal = manager as unknown as RestoreInternals
  await fs.emptyDir(internal.tempDir)
  await fs.outputJson(path.join(internal.tempDir, 'metadata.json'), { appName: 'Cherry Studio' })
  await fs.outputFile(path.join(internal.tempDir, 'data.json'), '{"restored":true}')
  await fs.outputFile(path.join(internal.tempDir, 'IndexedDB/new.txt'), 'new indexed')
  await fs.outputFile(path.join(state.userData, 'IndexedDB/old.txt'), 'old indexed')
  const suite = path.join(internal.tempDir, 'Data/record-storage')
  await store.backupStorage(suite)
  return { manager, internal, suite }
}
const restore = (internal: RestoreInternals, format: string) => format === 'direct' ? internal.restoreDirect() : internal.restoreLegacy()

describe('validated storage restoration', () => {
  const invalidCases = ['missing manifest', 'missing snapshot', 'missing database', 'absolute database', 'parent path',
    'windows path', 'wrong format', 'mismatched source', 'duplicate snapshot', 'unexpected sidecar', 'symlink',
    'empty database', 'corrupt database', 'raw active database', 'raw database alongside suite']
  it.each(['direct', 'legacy'].flatMap(format => invalidCases.map(problem => [format, problem])))('%s rejects %s before maintenance or replacement', async (format, problem) => {
    const { internal, suite } = await prepareRestore()
    const manifestPath = path.join(suite, 'manifest.json')
    const manifest = await fs.readJson(manifestPath)
    if (problem === 'missing manifest') await fs.remove(manifestPath)
    if (problem === 'missing snapshot') await fs.remove(path.join(suite, 'legacy/0.db'))
    if (problem === 'missing database') await fs.remove(path.join(suite, 'records.db'))
    if (problem === 'absolute database') manifest.database = '/outside.db'
    if (problem === 'parent path') manifest.legacyPaths[0] = '../outside.db'
    if (problem === 'windows path') manifest.legacyPaths[0] = 'C:\\outside.db'
    if (problem === 'wrong format') manifest.format = 'unknown'
    if (problem === 'mismatched source') manifest.sources[0].snapshot = 'legacy/1.db'
    if (problem === 'duplicate snapshot') { manifest.legacyPaths.push('legacy/0.db'); manifest.sources.push(manifest.sources[0]) }
    if (problem === 'unexpected sidecar') await fs.outputFile(path.join(suite, 'records.db-wal'), 'hot wal')
    if (problem === 'symlink') {
      await fs.remove(path.join(suite, 'legacy/0.db'))
      await fs.symlink(legacy.name, path.join(suite, 'legacy/0.db'))
    }
    if (problem === 'empty database') await fs.writeFile(path.join(suite, 'records.db'), '')
    if (problem === 'corrupt database') {
      const image = await fs.readFile(path.join(suite, 'records.db'))
      image.fill(0xff, 100)
      await fs.writeFile(path.join(suite, 'records.db'), image)
    }
    if (!['missing manifest'].includes(problem)) await fs.writeJson(manifestPath, manifest)
    if (problem === 'raw active database') {
      await fs.remove(suite)
      await fs.outputFile(path.join(internal.tempDir, 'Data/records.db'), 'unsafe hot copy')
    }
    if (problem === 'raw database alongside suite') await fs.outputFile(path.join(internal.tempDir, 'Data/records.db-wal'), 'unsafe hot wal')
    await expect(restore(internal, format)).rejects.toThrow()
    expect(state.maintenance).not.toHaveBeenCalled()
    expect(await fs.readFile(path.join(state.userData, 'IndexedDB/old.txt'), 'utf8')).toBe('old indexed')
    expect(store.execute('SELECT name FROM items WHERE id=\'a\'').rows).toEqual([['committed']])
  })

  it.each(['direct', 'legacy'].flatMap(format => [false, true].map(windows => [format, windows] as const)))('%s replaces old storage after maintenance (Windows=%s)', async (format, windows) => {
    state.isWin = windows
    const { internal } = await prepareRestore()
    await fs.outputFile(path.join(state.userData, 'agents.db'), 'root legacy')
    await fs.outputFile(path.join(state.userData, 'agents.db.append.db.read-cache/stale'), 'root cache')
    await fs.outputFile(path.join(state.userData, 'Data/stale.txt'), 'old data')
    state.maintenance.mockImplementationOnce(async () => {
      expect(await fs.pathExists(path.join(state.userData, 'IndexedDB/old.txt'))).toBe(true)
      expect(await fs.pathExists(path.join(state.userData, 'agents.db'))).toBe(true)
      store.close()
    })
    const result = await restore(internal, format)
    if (format === 'legacy') expect(result).toBe('{"restored":true}')
    expect(state.maintenance).toHaveBeenCalledTimes(1)
    const destination = path.join(state.userData, windows ? 'Data.restore' : 'Data')
    expect(await fs.pathExists(path.join(destination, 'stale.txt'))).toBe(false)
    expect(await fs.pathExists(path.join(destination, 'agents.db'))).toBe(false)
    expect(await fs.pathExists(path.join(state.userData, 'agents.db'))).toBe(false)
    expect(await fs.pathExists(path.join(state.userData, 'agents.db.append.db.read-cache'))).toBe(false)
    const manifest = await fs.readJson(path.join(destination, 'record-storage/manifest.json'))
    expect(manifest.legacyPaths).toEqual(['legacy/0.db'])
    if (windows) {
      await BackupManager.handleStartupRestore()
      expect(await fs.pathExists(destination)).toBe(false)
      expect(await fs.pathExists(path.join(state.userData, 'Data/record-storage/records.db'))).toBe(true)
    }
  })

  it.each(['direct', 'legacy'])('%s leaves all old files intact when maintenance fails', async format => {
    const { internal } = await prepareRestore()
    await fs.outputFile(path.join(state.userData, 'agents.db'), 'root legacy')
    state.maintenance.mockRejectedValueOnce(new Error('maintenance failed'))
    await expect(restore(internal, format)).rejects.toThrow('maintenance failed')
    expect(await fs.readFile(path.join(state.userData, 'agents.db'), 'utf8')).toBe('root legacy')
    expect(await fs.pathExists(path.join(state.userData, 'IndexedDB/old.txt'))).toBe(true)
  })

  it('validates Windows restore markers before replacing any live directory', async () => {
    await fs.outputFile(path.join(state.userData, 'Data.restore/record-storage/records.db'), 'partial')
    await fs.outputFile(path.join(state.userData, 'IndexedDB.restore/new.txt'), 'new')
    await fs.outputFile(path.join(state.userData, 'IndexedDB/old.txt'), 'old')
    await BackupManager.handleStartupRestore()
    expect(await fs.pathExists(path.join(state.userData, 'IndexedDB/old.txt'))).toBe(true)
    expect(await fs.pathExists(path.join(state.userData, 'Data/records.db'))).toBe(true)
  })

  it.each(['direct', 'legacy'])('%s still restores historical backups without overlay storage', async format => {
    const { internal, suite } = await prepareRestore()
    await fs.remove(suite)
    await fs.outputFile(path.join(internal.tempDir, 'Data/agents.db'), 'historical legacy')
    await restore(internal, format)
    expect(await fs.readFile(path.join(state.userData, 'Data/agents.db'), 'utf8')).toBe('historical legacy')
  })

  it.each(['direct', 'legacy'])('%s restores a complete ZIP even when old staging files remain', async format => {
    const manager = new BackupManager()
    const event = {} as Electron.IpcMainInvokeEvent
    const filename = format === 'direct'
      ? await manager.backup(event, 'export.zip', state.root, true)
      : await manager.backupLegacy(event, 'export.zip', '{"restored":true}', state.root, true)
    const staging = (manager as unknown as RestoreInternals).tempDir
    await fs.outputFile(path.join(staging, 'Data/record-storage/legacy/unlisted.db'), 'stale')
    if (format === 'legacy') await fs.outputJson(path.join(staging, 'metadata.json'), { appName: 'wrong format' })
    const result = await manager.restore(event, filename)
    if (format === 'legacy') expect(result).toBe('{"restored":true}')
    expect(state.maintenance).toHaveBeenCalledTimes(1)
    expect(await fs.pathExists(path.join(state.userData, 'Data/record-storage/manifest.json'))).toBe(true)
    expect(await fs.pathExists(path.join(state.userData, 'Data/record-storage/legacy/unlisted.db'))).toBe(false)
  })
})

describe('storage reset', () => {
  it.each([false, true])('resets the suite, old sources and stale restore markers (Windows=%s)', async windows => {
    state.isWin = windows
    await fs.outputFile(path.join(state.userData, 'agents.db'), 'root source')
    await fs.outputFile(path.join(state.userData, 'Data/record-storage/manifest.json'), 'old suite')
    await fs.outputFile(path.join(state.userData, 'Data.restore/stale'), 'old restore')
    await new BackupManager().resetData()
    expect(state.maintenance).toHaveBeenCalledTimes(1)
    expect(await fs.pathExists(path.join(state.userData, 'agents.db'))).toBe(false)
    if (windows) {
      expect(await fs.readdir(path.join(state.userData, 'Data.restore'))).toEqual([])
      await BackupManager.handleStartupRestore()
      expect(await fs.readdir(path.join(state.userData, 'Data'))).toEqual([])
    } else {
      expect(await fs.pathExists(path.join(state.userData, 'Data'))).toBe(false)
      expect(await fs.pathExists(path.join(state.userData, 'Data.restore'))).toBe(false)
    }
  })
})
