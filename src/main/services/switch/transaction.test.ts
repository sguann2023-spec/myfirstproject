import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SWITCH_ERROR_MESSAGES as errors } from '@shared/switchSettings'
import { ConfigTransaction, assertSafePath, atomicPrivateWrite, readConfigFile } from './configTransaction'

const roots: string[] = []
const children: ChildProcess[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const child of children.splice(0)) child.kill()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})
function setup() {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'switch-transaction-'))
  roots.push(root)
  const file = path.join(root, 'config.json')
  const original = '{"userField":{"keep":true},"model":"old"}\n'
  fs.writeFileSync(file, original, { mode: 0o600 })
  return { root, file, original, lock: `${file}.vectcut-switch.lock`, transaction: new ConfigTransaction() }
}
function expectOnlyConfig(t: ReturnType<typeof setup>, content = t.original) {
  expect(fs.readFileSync(t.file, 'utf8')).toBe(content)
  expect(fs.readdirSync(t.root)).toEqual(['config.json'])
}

// Use an actual second process without loading application code or touching real configs.
async function childHoldingLock(lock: string) {
  const child = spawn(process.execPath, ['-e', `
    const fs = require('node:fs')
    const lock = process.argv[1]
    const temp = lock + '.child.tmp'
    const metadata = JSON.stringify({ pid: process.pid, token: 'child' })
    fs.writeFileSync(temp, metadata, { flag: 'wx', mode: 0o600 })
    fs.linkSync(temp, lock)
    fs.unlinkSync(temp)
    process.stdout.write('ready')
    setInterval(() => {}, 1000)
  `, lock], { stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(child)
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', () => reject(new Error('lock child exited before initialization')))
    child.stdout!.once('data', () => resolve())
  })
  return child
}

describe('single-file Switch configuration transaction', () => {
  it('plans from the latest locked file and preserves user-owned fields without any journal', () => {
    const t = setup()
    fs.writeFileSync(t.file, '{"userField":{"keep":"latest"},"model":"external"}\n')
    const guard = vi.fn(() => {
      expect(fs.existsSync(t.lock)).toBe(true)
      expect(JSON.parse(fs.readFileSync(t.lock, 'utf8')).pid).toBe(process.pid)
    })
    t.transaction.update(t.file, (current) => {
      expect(current).toEqual({ path: t.file, content: fs.readFileSync(t.file, 'utf8'), mode: 0o600 })
      expect(fs.existsSync(t.lock)).toBe(true)
      const value = JSON.parse(current.content!)
      value.model = 'selected'
      return `${JSON.stringify(value)}\n`
    }, guard)
    expect(guard).toHaveBeenCalledTimes(1)
    expectOnlyConfig(t, '{"userField":{"keep":"latest"},"model":"selected"}\n')
    if (process.platform !== 'win32') expect(fs.statSync(t.file).mode & 0o777).toBe(0o600)
    expect('recover' in t.transaction).toBe(false)
    expect('backup' in t.transaction).toBe(false)
    expect('commit' in t.transaction).toBe(false)
  })

  it('creates missing configs privately and never stores original text on disk', () => {
    const t = setup()
    const file = path.join(t.root, 'new', 'nested', 'tool.json')
    t.transaction.update(file, (current) => {
      expect(current).toEqual({ path: file, content: null })
      return '{"model":"selected"}'
    })
    expect(fs.readFileSync(file, 'utf8')).toBe('{"model":"selected"}')
    expect(fs.readdirSync(path.dirname(file))).toEqual(['tool.json'])
    expect(fs.readdirSync(t.root).sort()).toEqual(['config.json', 'new'])
    if (process.platform !== 'win32') {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600)
      expect(fs.statSync(path.dirname(file)).mode & 0o777).toBe(0o700)
    }
    expect(fs.readFileSync(t.file, 'utf8')).toBe(t.original)
  })

  it.each(['null', 'unchanged'] as const)('%s is a no-op and never deletes an existing user config', (kind) => {
    const t = setup()
    const rename = vi.spyOn(fs, 'renameSync')
    const guard = vi.fn()
    const before = fs.statSync(t.file)
    t.transaction.update(t.file, (current) => kind === 'null' ? null : current.content, guard)
    expectOnlyConfig(t)
    expect(rename).not.toHaveBeenCalled()
    expect(guard).not.toHaveBeenCalled()
    expect(fs.statSync(t.file).ino).toBe(before.ino)
  })

  it('removes newly created empty parent directories on a missing-file no-op or plan failure', () => {
    const t = setup()
    const file = path.join(t.root, 'absent', 'nested', 'tool.json')
    t.transaction.update(file, () => null)
    expectOnlyConfig(t)
    expect(() => t.transaction.update(file, () => { throw new Error('invalid plan secret') })).toThrow(errors.fileAccess)
    expectOnlyConfig(t)
  })

  it('does not remove parent directories that already existed', () => {
    const t = setup()
    const parent = path.join(t.root, 'existing')
    fs.mkdirSync(parent)
    t.transaction.update(path.join(parent, 'missing', 'tool.json'), () => null)
    expect(fs.readdirSync(parent)).toEqual([])
    expect(fs.existsSync(parent)).toBe(true)
  })

  it('runs the guard before publication and preserves the original on guard failure', () => {
    const t = setup()
    expect(() => t.transaction.update(t.file, () => 'new', () => {
      expect(fs.readFileSync(t.file, 'utf8')).toBe(t.original)
      throw new Error(errors.accountChanged)
    })).toThrow(errors.accountChanged)
    expectOnlyConfig(t)
  })

  it.each(['plan', 'guard', 'staging'] as const)('rejects external content edits during %s without overwriting them', (when) => {
    const t = setup()
    if (when === 'staging') {
      const sync = fs.fsyncSync.bind(fs)
      vi.spyOn(fs, 'fsyncSync').mockImplementation((fd) => {
        sync(fd)
        fs.writeFileSync(t.file, 'external')
      })
    }
    expect(() => t.transaction.update(t.file, () => {
      if (when === 'plan') fs.writeFileSync(t.file, 'external')
      return 'new'
    }, () => {
      if (when === 'guard') fs.writeFileSync(t.file, 'external')
    })).toThrow(errors.concurrentChange)
    expectOnlyConfig(t, 'external')
  })

  it.each(['existing', 'missing'] as const)('rejects an external save during final temp lstat for an initially %s target', (initial) => {
    const t = setup()
    if (initial === 'missing') fs.unlinkSync(t.file)
    const lstat = fs.lstatSync.bind(fs)
    let tempChecks = 0
    vi.spyOn(fs, 'lstatSync').mockImplementation(((file: fs.PathLike, ...args: any[]) => {
      const stat = (lstat as any)(file, ...args)
      // The first temp lstat is assertSafePath; the second is the final inode/mode check.
      if (path.basename(String(file)).startsWith('.config.json.') && ++tempChecks === 2) {
        fs.writeFileSync(t.file, 'external-save')
      }
      return stat
    }) as any)
    const rename = vi.spyOn(fs, 'renameSync')
    expect(() => t.transaction.update(t.file, () => 'new')).toThrow(errors.concurrentChange)
    expect(tempChecks).toBeGreaterThanOrEqual(2)
    expect(rename).not.toHaveBeenCalled()
    expectOnlyConfig(t, 'external-save')
  })

  it('rejects an actual second process editing the config during the guard', () => {
    const t = setup()
    expect(() => t.transaction.update(t.file, () => 'new', () => {
      const result = spawnSync(process.execPath, ['-e', "require('node:fs').writeFileSync(process.argv[1], 'external-process')", t.file])
      expect(result.status).toBe(0)
    })).toThrow(errors.concurrentChange)
    expectOnlyConfig(t, 'external-process')
  })

  it('keeps a private baseline even if the plan mutates its argument', () => {
    const t = setup()
    expect(() => t.transaction.update(t.file, (current) => {
      fs.writeFileSync(t.file, 'external')
      current.content = 'external'
      current.path = path.join(t.root, 'other')
      return 'new'
    })).toThrow(errors.concurrentChange)
    expectOnlyConfig(t, 'external')
  })

  it('rejects a file created concurrently instead of overwriting it', () => {
    const t = setup()
    const file = path.join(t.root, 'new.json')
    expect(() => t.transaction.update(file, () => 'new', () => fs.writeFileSync(file, 'external'))).toThrow(errors.concurrentChange)
    expect(fs.readFileSync(file, 'utf8')).toBe('external')
    expect(fs.readdirSync(t.root).sort()).toEqual(['config.json', 'new.json'])
  })

  it.each(['transaction', 'atomic helper'] as const)('uses exclusive publication for a missing target in %s even after the final recheck', (writer) => {
    const t = setup()
    const file = path.join(t.root, 'new.json')
    const link = fs.linkSync.bind(fs)
    let attemptedPublication = false
    vi.spyOn(fs, 'linkSync').mockImplementation((source, destination) => {
      if (String(destination) === file) {
        attemptedPublication = true
        fs.writeFileSync(file, 'external-after-recheck', { flag: 'wx' })
      }
      return link(source, destination)
    })
    const rename = vi.spyOn(fs, 'renameSync')
    expect(() => writer === 'transaction'
      ? t.transaction.update(file, () => 'new')
      : atomicPrivateWrite(file, 'new')).toThrow(errors.concurrentChange)
    expect(attemptedPublication).toBe(true)
    expect(rename).not.toHaveBeenCalled()
    expect(fs.readFileSync(file, 'utf8')).toBe('external-after-recheck')
    expect(fs.readFileSync(t.file, 'utf8')).toBe(t.original)
    expect(fs.readdirSync(t.root).sort()).toEqual(['config.json', 'new.json'])
  })

  it('rejects a concurrent deletion instead of resurrecting the config', () => {
    const t = setup()
    expect(() => t.transaction.update(t.file, () => 'new', () => fs.unlinkSync(t.file))).toThrow(errors.concurrentChange)
    expect(fs.readdirSync(t.root)).toEqual([])
  })

  it.skipIf(process.platform === 'win32')('detects permission-only external changes', () => {
    const t = setup()
    expect(() => t.transaction.update(t.file, () => 'new', () => fs.chmodSync(t.file, 0o640))).toThrow(errors.concurrentChange)
    expectOnlyConfig(t)
    expect(fs.statSync(t.file).mode & 0o777).toBe(0o640)
  })

  it.skipIf(process.platform === 'win32')('makes changed content private even when the original config is public', () => {
    const t = setup()
    fs.chmodSync(t.file, 0o644)
    t.transaction.update(t.file, () => 'new')
    expectOnlyConfig(t, 'new')
    expect(fs.statSync(t.file).mode & 0o777).toBe(0o600)
  })

  it('holds the same exclusive lock across plans, guards and atomic replacement', () => {
    const t = setup()
    const nested = () => expect(() => new ConfigTransaction().update(t.file, () => 'nested')).toThrow(errors.locked)
    const rename = fs.renameSync.bind(fs)
    vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      nested()
      return rename(source, destination)
    })
    t.transaction.update(t.file, () => { nested(); return 'new' }, nested)
    expectOnlyConfig(t, 'new')
  })

  it('rejects an actual other process holding the lock, without changing its metadata', async () => {
    const t = setup()
    const child = await childHoldingLock(t.lock)
    const metadata = fs.readFileSync(t.lock, 'utf8')
    const plan = vi.fn(() => 'new')
    expect(() => t.transaction.update(t.file, plan)).toThrow(errors.locked)
    expect(plan).not.toHaveBeenCalled()
    expect(fs.readFileSync(t.lock, 'utf8')).toBe(metadata)
    expect(fs.readFileSync(t.file, 'utf8')).toBe(t.original)
    child.kill()
    await new Promise<void>((resolve) => child.once('exit', () => resolve()))
    // Even a now-dead PID does not justify unlinking an unowned lock.
    expect(() => t.transaction.update(t.file, plan)).toThrow(errors.locked)
    expect(fs.readFileSync(t.lock, 'utf8')).toBe(metadata)
  })

  it('prevents a second process from publishing a competing lock during the plan', () => {
    const t = setup()
    t.transaction.update(t.file, () => {
      const result = spawnSync(process.execPath, ['-e', `
        const fs = require('node:fs')
        const lock = process.argv[1]
        const temp = lock + '.competitor.tmp'
        fs.writeFileSync(temp, JSON.stringify({ pid: process.pid }), { flag: 'wx', mode: 0o600 })
        try { fs.linkSync(temp, lock); process.exitCode = 2 }
        catch (e) { process.exitCode = e.code === 'EEXIST' ? 0 : 3 }
        finally { fs.unlinkSync(temp) }
      `, t.lock], { encoding: 'utf8' })
      expect(result.status).toBe(0)
      return 'new'
    })
    expectOnlyConfig(t, 'new')
  })

  it.each(['', 'invalid json', '{"pid":0}', '{"pid":99999999}'])('never deletes unknown/stale lock metadata %j', (metadata) => {
    const t = setup()
    fs.writeFileSync(t.lock, metadata)
    expect(() => t.transaction.update(t.file, () => 'new')).toThrow(errors.locked)
    expect(fs.readFileSync(t.lock, 'utf8')).toBe(metadata)
    expect(fs.readFileSync(t.file, 'utf8')).toBe(t.original)
    expect(fs.readdirSync(t.root).sort()).toEqual(['config.json', 'config.json.vectcut-switch.lock'])
  })

  it.each(['inode', 'metadata'] as const)('does not commit or unlink a lock whose %s was replaced', (kind) => {
    const t = setup()
    const replacement = JSON.stringify({ pid: process.pid, token: 'foreign' })
    expect(() => t.transaction.update(t.file, () => {
      if (kind === 'inode') {
        const foreign = path.join(t.root, 'foreign-lock')
        fs.writeFileSync(foreign, replacement)
        fs.renameSync(foreign, t.lock)
      } else fs.writeFileSync(t.lock, replacement)
      return 'new'
    })).toThrow(errors.locked)
    expect(fs.readFileSync(t.lock, 'utf8')).toBe(replacement)
    expect(fs.readFileSync(t.file, 'utf8')).toBe(t.original)
    expect(fs.readdirSync(t.root).sort()).toEqual(['config.json', 'config.json.vectcut-switch.lock'])
  })

  it('never publishes an empty lock if initializing metadata fails', () => {
    const t = setup()
    const write = fs.writeFileSync.bind(fs)
    vi.spyOn(fs, 'writeFileSync').mockImplementation((file, ...args: any[]) => {
      if (typeof file === 'number' && String(args[0]).includes('"token"')) throw new Error('EIO secret')
      return (write as any)(file, ...args)
    })
    expect(() => t.transaction.update(t.file, () => 'new')).toThrow(errors.fileAccess)
    expectOnlyConfig(t)
  })

  it.each(['open', 'write', 'fsync', 'rename'] as const)('leaves the live file unchanged and no backups/temps when %s fails', (failure) => {
    const t = setup()
    if (failure === 'open') {
      const open = fs.openSync.bind(fs)
      vi.spyOn(fs, 'openSync').mockImplementation((file, ...args: any[]) => {
        if (path.basename(String(file)).startsWith('.config.json.')) throw new Error('EACCES secret')
        return (open as any)(file, ...args)
      })
    } else if (failure === 'write') {
      const write = fs.writeFileSync.bind(fs)
      vi.spyOn(fs, 'writeFileSync').mockImplementation((file, ...args: any[]) => {
        if (args[0] === 'new') throw new Error('EIO secret')
        return (write as any)(file, ...args)
      })
    } else {
      vi.spyOn(fs, failure === 'fsync' ? 'fsyncSync' : 'renameSync').mockImplementation(() => { throw new Error('EIO secret') })
    }
    expect(() => t.transaction.update(t.file, () => 'new')).toThrow(errors.fileAccess)
    expectOnlyConfig(t)
  })

  it.skipIf(process.platform === 'win32')('fails on staging chmod before replacing the original', () => {
    const t = setup()
    vi.spyOn(fs, 'fchmodSync').mockImplementation(() => { throw new Error('EPERM') })
    const rename = vi.spyOn(fs, 'renameSync')
    expect(() => t.transaction.update(t.file, () => 'new')).toThrow(errors.fileAccess)
    expect(rename).not.toHaveBeenCalled()
    expectOnlyConfig(t)
  })

  it.skipIf(process.platform === 'win32')('verifies mode before rename even if chmod silently did nothing', () => {
    const t = setup()
    const originalUmask = process.umask(0o777)
    vi.spyOn(fs, 'fchmodSync').mockImplementation(() => {})
    try {
      // An unreadable lock would fail first; exercise the public atomic helper directly.
      expect(() => atomicPrivateWrite(t.file, 'new')).toThrow(errors.fileAccess)
      expectOnlyConfig(t)
    } finally { process.umask(originalUmask) }
  })

  it('does not chmod or run any guard after a successful rename', () => {
    const t = setup()
    let published = false
    const rename = fs.renameSync.bind(fs)
    vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      rename(source, destination)
      published = true
    })
    const chmod = vi.spyOn(fs, 'chmodSync').mockImplementation(() => { throw new Error('post-rename chmod failure') })
    const guard = vi.fn(() => expect(published).toBe(false))
    t.transaction.update(t.file, () => 'new', guard)
    expect(published).toBe(true)
    expect(guard).toHaveBeenCalledTimes(1)
    expect(chmod).not.toHaveBeenCalled()
    expectOnlyConfig(t, 'new')
  })

  it('does not report a committed write as failed if lock cleanup fails', () => {
    const t = setup()
    const unlink = fs.unlinkSync.bind(fs)
    vi.spyOn(fs, 'unlinkSync').mockImplementation((file) => {
      if (String(file) === t.lock) throw new Error('EACCES')
      return unlink(file)
    })
    expect(() => t.transaction.update(t.file, () => 'new')).not.toThrow()
    expect(fs.readFileSync(t.file, 'utf8')).toBe('new')
    expect(fs.existsSync(t.lock)).toBe(true)
  })

  it.each(['directory', 'invalid UTF-8', 'oversized'] as const)('leaves an existing %s config entirely untouched', (kind) => {
    const t = setup()
    fs.unlinkSync(t.file)
    if (kind === 'directory') fs.mkdirSync(t.file)
    else if (kind === 'invalid UTF-8') fs.writeFileSync(t.file, Buffer.from([0xc3, 0x28]))
    else fs.writeFileSync(t.file, Buffer.alloc(8 * 1024 * 1024 + 1, 0x61))
    const original = kind === 'directory' ? null : fs.readFileSync(t.file)
    const plan = vi.fn(() => 'new')
    expect(() => t.transaction.update(t.file, plan)).toThrow(errors.fileAccess)
    expect(plan).not.toHaveBeenCalled()
    if (original) expect(fs.readFileSync(t.file).equals(original)).toBe(true)
    else expect(fs.statSync(t.file).isDirectory()).toBe(true)
    expect(fs.readdirSync(t.root)).toEqual(['config.json'])
    expect(() => atomicPrivateWrite(t.file, 'new')).toThrow(errors.fileAccess)
  })

  it.skipIf(process.platform === 'win32')('does not overwrite an unreadable config', () => {
    const t = setup()
    if (process.getuid?.() === 0) return
    fs.chmodSync(t.file, 0)
    const plan = vi.fn(() => 'new')
    try {
      expect(() => t.transaction.update(t.file, plan)).toThrow(errors.fileAccess)
      expect(plan).not.toHaveBeenCalled()
      expect(fs.statSync(t.file).mode & 0o777).toBe(0)
      expect(fs.readdirSync(t.root)).toEqual(['config.json'])
    } finally { fs.chmodSync(t.file, 0o600) }
    expectOnlyConfig(t)
  })

  it('rejects a file changed while the bounded reader is reading it', () => {
    const t = setup()
    const read = fs.readSync.bind(fs)
    let modified = false
    vi.spyOn(fs, 'readSync').mockImplementation(((...args: any[]) => {
      const count = (read as any)(...args)
      if (!modified) {
        modified = true
        fs.appendFileSync(t.file, 'external')
      }
      return count
    }) as any)
    expect(() => readConfigFile(t.file)).toThrow(errors.concurrentChange)
    expectOnlyConfig(t, `${t.original}external`)
  })

  it.each(['oversized', 'unpaired surrogate', 'async plan'] as const)('rejects %s output without creating a backup', (kind) => {
    const t = setup()
    const plan = kind === 'oversized' ? () => 'a'.repeat(8 * 1024 * 1024 + 1)
      : kind === 'unpaired surrogate' ? () => '\ud800'
      : (() => Promise.resolve('new')) as any
    expect(() => t.transaction.update(t.file, plan)).toThrow('配置')
    expectOnlyConfig(t)
  })

  it.each(['file', 'parent', 'lock'] as const)('refuses a symlinked %s without changing its target', (kind) => {
    const t = setup()
    let file = t.file
    if (kind === 'file') {
      file = path.join(t.root, 'link.json')
      fs.symlinkSync(t.file, file)
    } else if (kind === 'parent') {
      const link = path.join(t.root, 'link-dir')
      fs.symlinkSync(t.root, link, 'dir')
      file = path.join(link, 'config.json')
    } else fs.symlinkSync(t.file, t.lock)
    expect(() => t.transaction.update(file, () => 'new')).toThrow(errors.fileAccess)
    expect(fs.readFileSync(t.file, 'utf8')).toBe(t.original)
    expect(fs.readdirSync(t.root)).toHaveLength(2)
    if (kind !== 'lock') {
      expect(() => readConfigFile(file)).toThrow(errors.fileAccess)
      expect(() => atomicPrivateWrite(file, 'new')).toThrow(errors.fileAccess)
    }
  })

  it('rejects a destination replaced with a symlink during the guard', () => {
    const t = setup()
    const target = path.join(t.root, 'external.json')
    fs.writeFileSync(target, 'external')
    expect(() => t.transaction.update(t.file, () => 'new', () => {
      fs.unlinkSync(t.file)
      fs.symlinkSync(target, t.file)
    })).toThrow(errors.fileAccess)
    expect(fs.lstatSync(t.file).isSymbolicLink()).toBe(true)
    expect(fs.readFileSync(target, 'utf8')).toBe('external')
    expect(fs.readdirSync(t.root).sort()).toEqual(['config.json', 'external.json'])
  })

  it('rejects symlink substitution between lstat and open without following the link', () => {
    const t = setup()
    const target = path.join(t.root, 'external.json')
    fs.writeFileSync(target, 'external')
    const open = fs.openSync.bind(fs)
    vi.spyOn(fs, 'openSync').mockImplementation((file, ...args: any[]) => {
      if (String(file) === t.file) {
        fs.unlinkSync(t.file)
        fs.symlinkSync(target, t.file)
      }
      return (open as any)(file, ...args)
    })
    expect(() => readConfigFile(t.file)).toThrow(errors.fileAccess)
    expect(fs.readFileSync(target, 'utf8')).toBe('external')
  })

  it('keeps the exported reader/path/writer helpers compatible for safe private files', () => {
    const t = setup()
    const missing = path.join(t.root, 'missing.json')
    expect(readConfigFile(missing)).toEqual({ path: missing, content: null })
    expect(() => assertSafePath('relative.json')).toThrow(errors.fileAccess)
    expect(() => readConfigFile(path.join(t.file, 'child'))).toThrow(errors.fileAccess)
    atomicPrivateWrite(missing, '你好\n')
    expect(readConfigFile(missing)).toEqual({ path: missing, content: '你好\n', mode: process.platform === 'win32' ? expect.any(Number) : 0o600 })
    expect(fs.readdirSync(t.root).sort()).toEqual(['config.json', 'missing.json'])
  })

  it('accepts the exact 8MiB boundary and valid Unicode', () => {
    const t = setup()
    const content = '你好' + 'a'.repeat(8 * 1024 * 1024 - Buffer.byteLength('你好'))
    t.transaction.update(t.file, () => content)
    expect(readConfigFile(t.file).content).toBe(content)
    expect(fs.readdirSync(t.root)).toEqual(['config.json'])
  })

  it.each([0o644, 0o777, -1, 0o1600, 1.5, NaN])('rejects nonprivate/invalid mode %s before writing', (mode) => {
    const t = setup()
    expect(() => atomicPrivateWrite(t.file, 'new', mode)).toThrow(errors.fileAccess)
    expectOnlyConfig(t)
  })
})
