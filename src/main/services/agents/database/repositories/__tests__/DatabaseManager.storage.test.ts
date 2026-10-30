import { afterEach, expect, it, vi } from 'vitest'
import { linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) } }))
vi.mock('@main/utils', () => ({ getResourcePath: () => '/resources' }))
const fixtureState = vi.hoisted(() => ({ userData: '', construct: vi.fn(), backup: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: () => fixtureState.userData } }))
vi.mock('../../workerClient', () => ({ WorkerDatabaseClient: class {
  constructor(...args: any[]) { fixtureState.construct(...args) }
  waitUntilReady = vi.fn(async () => undefined)
  closeAsync = vi.fn(async () => undefined)
  backupStorage = fixtureState.backup
} }))
import { DatabaseManager, resolveStorageConfiguration } from '../../DatabaseManager'
import type { StorageManifest } from '../../persistentRecordStore'

const directories: string[] = []
afterEach(async () => {
  await DatabaseManager.close()
  vi.clearAllMocks()
  directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true }))
})
function fixture() {
  const userData = realpathSync(mkdtempSync(path.join(tmpdir(), 'manager-storage-')))
  directories.push(userData)
  fixtureState.userData = userData
  const suite = path.join(userData, 'Data', 'record-storage')
  mkdirSync(path.join(suite, 'legacy'), { recursive: true })
  writeFileSync(path.join(suite, 'records.db'), 'records')
  writeFileSync(path.join(suite, 'legacy', '0.db'), 'legacy')
  const manifest: StorageManifest = { format: 'record-overlay-v1', database: 'records.db', legacyPaths: ['legacy/0.db'], sources: [{ originalPath: '/untrusted/original.db', snapshot: 'legacy/0.db' }] }
  const save = () => writeFileSync(path.join(suite, 'manifest.json'), JSON.stringify(manifest))
  save()
  return { userData, suite, manifest, save }
}

it('initializes the restored suite records path and ignores live databases and original paths', async () => {
  const f = fixture()
  writeFileSync(path.join(f.userData, 'Data', 'records.db'), 'unrelated live record')
  writeFileSync(path.join(f.userData, 'agents.db'), 'unrelated live legacy')
  const before = readFileSync(path.join(f.suite, 'legacy/0.db'))
  const manager = await DatabaseManager.getInstance()
  expect(fixtureState.construct).toHaveBeenCalledWith(
    { url: `file:${path.join(f.suite, 'records.db')}`, intMode: 'number' }, undefined, expect.any(Function),
    { legacyPaths: [path.join(f.suite, 'legacy/0.db')], migrationDir: '/resources/database/drizzle' }
  )
  fixtureState.backup.mockResolvedValueOnce(f.manifest)
  expect(await manager.backupStorage('/backup')).toEqual(f.manifest)
  expect(readFileSync(path.join(f.suite, 'legacy/0.db'))).toEqual(before)
})

it.each(['../outside.db', '/outside.db', 'C:\\outside.db', 'legacy/../outside.db', 'legacy\\0.db', 'legacy//0.db', 'legacy/./0.db'])('rejects unsafe manifest source %s', relative => {
  const f = fixture()
  f.manifest.legacyPaths = [relative]
  f.manifest.sources[0].snapshot = relative
  f.save()
  expect(() => resolveStorageConfiguration(f.userData, '/schema')).toThrow('Invalid record storage')
})

it.each(['database', 'format', 'mapping', 'duplicate', 'missing', 'malformed', 'large'])('fails closed for an invalid %s manifest', kind => {
  const f = fixture()
  if (kind === 'database') f.manifest.database = '../records.db'
  if (kind === 'format') (f.manifest as any).format = 'unknown'
  if (kind === 'mapping') f.manifest.sources[0].snapshot = 'legacy/1.db'
  if (kind === 'duplicate') { f.manifest.legacyPaths.push('legacy/0.db'); f.manifest.sources.push(f.manifest.sources[0]) }
  if (kind === 'missing') { f.manifest.legacyPaths[0] = 'legacy/missing.db'; f.manifest.sources[0].snapshot = 'legacy/missing.db' }
  f.save()
  if (kind === 'malformed') writeFileSync(path.join(f.suite, 'manifest.json'), '{')
  if (kind === 'large') writeFileSync(path.join(f.suite, 'manifest.json'), ' '.repeat(1024 * 1024 + 1))
  expect(() => resolveStorageConfiguration(f.userData, '/schema')).toThrow()
})

it.each(['suite', 'legacy', 'records.db', 'manifest.json', 'legacy/0.db', 'dangling-suite'])('rejects symbolic links at %s', entry => {
  const f = fixture()
  const filename = entry === 'suite' || entry === 'dangling-suite' ? f.suite : path.join(f.suite, entry)
  const outside = path.join(f.userData, 'outside')
  if (entry !== 'dangling-suite') {
    if (entry === 'suite' || entry === 'legacy') mkdirSync(outside)
    else writeFileSync(outside, 'outside')
  }
  rmSync(filename, { recursive: true, force: true })
  symlinkSync(outside, filename)
  expect(() => resolveStorageConfiguration(f.userData, '/schema')).toThrow('Invalid record storage')
})

it('rejects a source hard-linked to the active records database', () => {
  const f = fixture()
  rmSync(path.join(f.suite, 'legacy/0.db'))
  linkSync(path.join(f.suite, 'records.db'), path.join(f.suite, 'legacy/0.db'))
  expect(() => resolveStorageConfiguration(f.userData, '/schema')).toThrow('Invalid record storage')
})

it('does not fall back to live paths when an existing suite has no manifest', async () => {
  const f = fixture()
  rmSync(path.join(f.suite, 'manifest.json'))
  writeFileSync(path.join(f.userData, 'agents.db'), 'live')
  await expect(DatabaseManager.getInstance()).rejects.toThrow('Database initialization failed')
  expect(fixtureState.construct).not.toHaveBeenCalled()
})
