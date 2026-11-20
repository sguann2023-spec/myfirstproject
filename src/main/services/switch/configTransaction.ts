import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { SWITCH_ERROR_MESSAGES } from '@shared/switchSettings'

export type ConfigFile = { path: string; content: string | null; mode?: number }

const MAX_CONFIG_BYTES = 8 * 1024 * 1024
const changed = () => new Error(SWITCH_ERROR_MESSAGES.concurrentChange)
const sameFile = (a: fs.Stats, b: fs.Stats) => a.dev === b.dev && a.ino === b.ino
const sameRead = (a: fs.Stats, b: fs.Stats) => sameFile(a, b)
  && a.size === b.size && a.mode === b.mode && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs

export function readConfigFile(filePath: string): ConfigFile {
  assertSafePath(filePath)
  let descriptor: number | undefined
  try {
    let initial: fs.Stats
    try { initial = fs.lstatSync(filePath) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { path: filePath, content: null }
      throw error
    }
    if (!initial.isFile() || initial.size > MAX_CONFIG_BYTES) throw new Error(SWITCH_ERROR_MESSAGES.fileAccess)
    // NOFOLLOW protects the final component between lstat and open; NONBLOCK avoids
    // hanging if a regular file is exchanged for a FIFO in that interval.
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0))
    const opened = fs.fstatSync(descriptor)
    if (!opened.isFile() || !sameRead(initial, opened)) throw changed()
    // Bound the actual read as well as stat.size, including files that grow while read.
    const bytes = Buffer.alloc(Math.min(opened.size + 1, MAX_CONFIG_BYTES + 1))
    let length = 0
    while (length < bytes.length) {
      const count = fs.readSync(descriptor, bytes, length, bytes.length - length, null)
      if (count === 0) break
      length += count
    }
    if (length > MAX_CONFIG_BYTES || length !== opened.size || !sameRead(opened, fs.fstatSync(descriptor))) throw changed()
    assertSafePath(filePath)
    if (!sameRead(opened, fs.lstatSync(filePath))) throw changed()
    const data = bytes.subarray(0, length)
    const content = data.toString('utf8')
    if (!Buffer.from(content, 'utf8').equals(data)) throw new Error(SWITCH_ERROR_MESSAGES.fileAccess)
    return { path: filePath, content, mode: opened.mode & 0o777 }
  } catch (error) {
    if (error instanceof Error && error.message === SWITCH_ERROR_MESSAGES.concurrentChange) throw error
    throw new Error(SWITCH_ERROR_MESSAGES.fileAccess)
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor) } catch { throw new Error(SWITCH_ERROR_MESSAGES.fileAccess) }
    }
  }
}

/** Refuse symlinked files/directories instead of replacing an unrelated destination. */
export function assertSafePath(filePath: string) {
  if (!path.isAbsolute(filePath)) throw new Error(SWITCH_ERROR_MESSAGES.fileAccess)
  let current = path.parse(filePath).root
  for (const component of filePath.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component)
    try {
      const stat = fs.lstatSync(current)
      if (stat.isSymbolicLink() || (current !== path.normalize(filePath) && !stat.isDirectory())) {
        throw new Error(SWITCH_ERROR_MESSAGES.fileAccess)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') break
      throw new Error(SWITCH_ERROR_MESSAGES.fileAccess)
    }
  }
}

/** Remove only the inode we created, never a replacement supplied by another process. */
function removeOwnedFile(filePath: string, identity: fs.Stats) {
  try {
    assertSafePath(filePath)
    const current = fs.lstatSync(filePath)
    if (current.isFile() && sameFile(current, identity)) fs.unlinkSync(filePath)
  } catch { /* Cleanup must not turn a successful rename into a reported write failure. */ }
}

/** Record only newly created directories so missing-file no-ops leave no empty tree. */
function ensureParents(filePath: string): () => void {
  const created: Array<{ path: string; identity: fs.Stats }> = []
  const cleanup = () => {
    for (const directory of [...created].reverse()) {
      try {
        assertSafePath(directory.path)
        const current = fs.lstatSync(directory.path)
        if (current.isDirectory() && sameFile(current, directory.identity)) fs.rmdirSync(directory.path)
      } catch { /* A nonempty/replaced directory belongs to its current users. */ }
    }
  }
  try {
    const parent = path.dirname(filePath)
    let current = path.parse(parent).root
    for (const component of parent.slice(current.length).split(path.sep).filter(Boolean)) {
      current = path.join(current, component)
      assertSafePath(current)
      try {
        fs.mkdirSync(current, { mode: 0o700 })
        created.push({ path: current, identity: fs.lstatSync(current) })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
      assertSafePath(current)
      if (!fs.lstatSync(current).isDirectory()) throw new Error(SWITCH_ERROR_MESSAGES.fileAccess)
    }
    return cleanup
  } catch (error) {
    cleanup()
    throw error
  }
}

function validateWrite(content: string, mode: number) {
  if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > MAX_CONFIG_BYTES
    || Buffer.from(content, 'utf8').toString('utf8') !== content) throw new Error(SWITCH_ERROR_MESSAGES.fileAccess)
  if (!Number.isInteger(mode) || mode < 0 || mode > 0o700 || (mode & 0o077) !== 0) throw new Error(SWITCH_ERROR_MESSAGES.fileAccess)
}

function assertUnchanged(filePath: string, expected: ConfigFile) {
  const current = readConfigFile(filePath)
  if (current.content !== expected.content || current.mode !== expected.mode) throw changed()
}

/** Validate staging first, then recheck immediately before the single publication step. */
function replaceFile(filePath: string, content: string, mode: number, beforeReplace: () => void, createOnly = false) {
  validateWrite(content, mode)
  assertSafePath(filePath)
  const cleanupParents = ensureParents(filePath)
  const temp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`)
  let descriptor: number | undefined
  let identity: fs.Stats | undefined
  try {
    assertSafePath(filePath)
    descriptor = fs.openSync(temp, 'wx', mode)
    identity = fs.fstatSync(descriptor)
    fs.writeFileSync(descriptor, content, 'utf8')
    // Set and verify exact permissions on the unpublished inode, not on the live file.
    if (process.platform !== 'win32') fs.fchmodSync(descriptor, mode)
    fs.fsyncSync(descriptor)
    fs.closeSync(descriptor)
    descriptor = undefined
    assertSafePath(temp)
    const ready = fs.lstatSync(temp)
    if (!ready.isFile() || !sameFile(ready, identity) || ready.size !== Buffer.byteLength(content, 'utf8')
      || (process.platform !== 'win32' && (ready.mode & 0o7777) !== mode)) throw new Error(SWITCH_ERROR_MESSAGES.fileAccess)
    assertSafePath(filePath)
    if (createOnly) {
      beforeReplace()
      try { fs.linkSync(temp, filePath) } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw changed()
        throw error
      }
    } else {
      // Portable rename has no compare-and-swap: a small race remains after this
      // final recheck, but no staging/path checks further widen that interval.
      beforeReplace()
      fs.renameSync(temp, filePath)
    }
  } finally {
    if (descriptor !== undefined) { try { fs.closeSync(descriptor) } catch { /* Preserve the original error. */ } }
    if (identity) removeOwnedFile(temp, identity)
    cleanupParents()
  }
}

export function atomicPrivateWrite(filePath: string, content: string, mode = 0o600) {
  try {
    validateWrite(content, mode)
    const current = readConfigFile(filePath)
    replaceFile(filePath, content, mode, () => assertUnchanged(filePath, current), current.content === null)
  } catch (error) {
    if (error instanceof Error && error.message === SWITCH_ERROR_MESSAGES.concurrentChange) throw error
    throw new Error(SWITCH_ERROR_MESSAGES.fileAccess)
  }
}

function acquireLock(filePath: string): { assertOwned: () => void; release: () => void } {
  assertSafePath(filePath)
  const cleanupParents = ensureParents(filePath)
  const lock = `${filePath}.vectcut-switch.lock`
  const temp = `${lock}.${randomUUID()}.tmp`
  const metadata = JSON.stringify({ pid: process.pid, token: randomUUID() })
  let descriptor: number | undefined
  let identity: fs.Stats | undefined
  let published = false
  const assertOwned = () => {
    try {
      assertSafePath(lock)
      const current = fs.lstatSync(lock)
      if (!identity || !current.isFile() || !sameFile(current, identity) || readConfigFile(lock).content !== metadata) {
        throw new Error(SWITCH_ERROR_MESSAGES.locked)
      }
    } catch { throw new Error(SWITCH_ERROR_MESSAGES.locked) }
  }
  const release = () => {
    try {
      assertOwned()
      if (identity) removeOwnedFile(lock, identity)
    } catch { /* Never unlink a missing, modified or foreign lock. */ }
    cleanupParents()
  }
  try {
    assertSafePath(lock)
    descriptor = fs.openSync(temp, 'wx', 0o600)
    identity = fs.fstatSync(descriptor)
    fs.writeFileSync(descriptor, metadata, 'utf8')
    fs.closeSync(descriptor)
    descriptor = undefined
    assertSafePath(lock)
    // Publish fully initialized metadata atomically. Existing locks, even apparently
    // stale ones, are never removed: a PID check cannot prove ownership safely.
    fs.linkSync(temp, lock)
    published = true
    assertOwned()
    return { assertOwned, release }
  } catch (error) {
    if (published) release()
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(SWITCH_ERROR_MESSAGES.locked)
    throw error
  } finally {
    if (descriptor !== undefined) { try { fs.closeSync(descriptor) } catch { /* Preserve the original error. */ } }
    if (identity) removeOwnedFile(temp, identity)
    cleanupParents()
  }
}

/** Single-file, lock-scoped read/plan/replace. No history, rollback or deletion. */
export class ConfigTransaction {
  update(filePath: string, plan: (current: ConfigFile) => string | null, guard: () => void = () => {}): void {
    let lock: ReturnType<typeof acquireLock> | undefined
    try {
      lock = acquireLock(filePath)
      const current = readConfigFile(filePath)
      // Do not expose the comparison baseline to mutation by the caller's plan.
      const content = plan({ ...current })
      if (content !== null && typeof content !== 'string') throw new Error(SWITCH_ERROR_MESSAGES.fileAccess)
      // null means no-op, including for an existing file; it never means delete.
      if (content === null || content === current.content) return
      replaceFile(filePath, content, 0o600, () => {
        guard()
        lock!.assertOwned()
        assertUnchanged(filePath, current)
      }, current.content === null)
    } catch (error) {
      if (error instanceof Error && (Object.values(SWITCH_ERROR_MESSAGES) as string[]).includes(error.message)) throw error
      throw new Error(SWITCH_ERROR_MESSAGES.fileAccess)
    } finally {
      lock?.release()
    }
  }
}
