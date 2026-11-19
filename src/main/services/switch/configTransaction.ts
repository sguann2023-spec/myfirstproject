import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { SwitchToolId } from '@shared/switchSettings'

export type ConfigFile = { path: string; content: string | null; mode?: number }
export type SwitchRecord = {
  version: 1
  tool: SwitchToolId
  userId: string
  modelId?: string
  catalogSignature: string
  before: ConfigFile[]
  applied: ConfigFile[]
  originalBefore?: ConfigFile[]
}
type Journal = { active?: SwitchRecord; pending?: { before: ConfigFile[]; after: ConfigFile[] } }
export interface SwitchVault {
  read(tool: SwitchToolId): Journal
  write(tool: SwitchToolId, value: Journal): void
}

export function readConfigFile(filePath: string): ConfigFile {
  assertSafePath(filePath)
  try {
    const stat = fs.lstatSync(filePath)
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new Error('配置文件类型或大小不受支持')
    const bytes = fs.readFileSync(filePath)
    const content = bytes.toString('utf8')
    if (!Buffer.from(content, 'utf8').equals(bytes)) throw new Error('配置文件必须使用 UTF-8 编码')
    return { path: filePath, content, mode: stat.mode & 0o777 }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { path: filePath, content: null }
    throw new Error('无法安全读取配置文件，请检查文件格式、路径和权限')
  }
}

/** Refuse symlinked files/directories instead of replacing an unrelated destination. */
export function assertSafePath(filePath: string) {
  if (!path.isAbsolute(filePath)) throw new Error('配置目录必须是绝对路径')
  let current = path.parse(filePath).root
  for (const component of filePath.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component)
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error('不支持符号链接配置路径')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') break
      throw error
    }
  }
}

export function atomicPrivateWrite(filePath: string, content: string, mode = 0o600) {
  assertSafePath(filePath)
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 })
  const temp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`)
  let descriptor: number | undefined
  try {
    descriptor = fs.openSync(temp, 'wx', mode)
    fs.writeFileSync(descriptor, content, 'utf8')
    fs.fsyncSync(descriptor)
    fs.closeSync(descriptor)
    descriptor = undefined
    fs.renameSync(temp, filePath)
    if (process.platform !== 'win32') fs.chmodSync(filePath, mode)
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
    if (fs.existsSync(temp)) fs.unlinkSync(temp)
  }
}

const same = (a: ConfigFile, b: ConfigFile) => a.path === b.path && a.content === b.content
const publish = (file: ConfigFile) => {
  if (file.content === null) {
    assertSafePath(file.path)
    if (fs.existsSync(file.path)) fs.unlinkSync(file.path)
  } else atomicPrivateWrite(file.path, file.content, file.mode ?? 0o600)
}

/** Encrypted write-ahead journal plus guarded rollback; never restores over third-party edits. */
export class ConfigTransaction {
  constructor(private readonly vault: SwitchVault) {}

  private checkLock(filePath: string, ownLocks = false) {
    const lock = `${filePath}.vectcut-switch.lock`
    assertSafePath(lock)
    if (!fs.existsSync(lock) || ownLocks) return
    let pid = 0
    try { pid = Number(JSON.parse(fs.readFileSync(lock, 'utf8')).pid) } catch { throw new Error('配置锁异常，请关闭目标工具并检查配置目录') }
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('配置锁异常，请关闭目标工具并检查配置目录')
    try { process.kill(pid, 0) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') { fs.unlinkSync(lock); return }
    }
    throw new Error('配置正在由其他进程处理，请稍后重试')
  }

  private lock(filePath: string): () => void {
    assertSafePath(filePath)
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 })
    this.checkLock(filePath)
    const lock = `${filePath}.vectcut-switch.lock`
    const temp = `${lock}.${randomUUID()}.tmp`
    try {
      fs.writeFileSync(temp, JSON.stringify({ pid: process.pid }), { flag: 'wx', mode: 0o600 })
      // A hard link publishes fully initialized metadata, failing if a lock exists.
      fs.linkSync(temp, lock)
    } finally {
      if (fs.existsSync(temp)) fs.unlinkSync(temp)
    }
    return () => fs.unlinkSync(lock)
  }

  recover(tool: SwitchToolId, ownLocks = false): SwitchRecord | undefined {
    const initial = this.vault.read(tool)
    if (!initial.pending) return initial.active
    const paths = initial.pending.before.map((file) => file.path)
    const releases: Array<() => void> = []
    try {
      if (!ownLocks) paths.forEach((file) => releases.push(this.lock(file)))
      // Another process may have finished recovery before these locks were acquired.
      const journal = this.vault.read(tool)
      if (!journal.pending) return journal.active
      const { before, after } = journal.pending
      if (before.length !== paths.length || before.length !== after.length || before.some((file, i) => file.path !== paths[i] || file.path !== after[i].path)) throw new Error('配置恢复事务无效')
      const current = before.map((file) => readConfigFile(file.path))
      if (current.some((file, index) => !same(file, before[index]) && !same(file, after[index]))) {
        throw new Error('上次写入中断且配置已被外部修改，请先恢复备份后重试')
      }
      before.forEach((file, index) => {
        if (!same(readConfigFile(file.path), current[index])) throw new Error('配置文件已变化，请刷新后重试')
        if (!same(current[index], file)) publish(file)
      })
      this.vault.write(tool, { active: journal.active })
      return journal.active
    } finally {
      for (const release of releases.reverse()) { try { release() } catch { /* Keep the journal for retry. */ } }
    }
  }

  commit(tool: SwitchToolId, expected: ConfigFile[], after: ConfigFile[], active: SwitchRecord | undefined, guard: () => void) {
    if (expected.length !== after.length || expected.some((file, index) => file.path !== after[index].path)) {
      throw new Error('配置事务无效')
    }
    const previous = this.vault.read(tool)
    if (previous.pending) throw new Error('请先恢复上次中断的配置写入')
    const releases: Array<() => void> = []
    let journalSaved = false
    try {
      for (const file of expected) releases.push(this.lock(file.path))
      if (JSON.stringify(this.vault.read(tool)) !== JSON.stringify(previous)) throw new Error('配置备份已变化，请刷新后重试')
      guard()
      expected.forEach((file) => {
        if (!same(readConfigFile(file.path), file)) throw new Error('配置文件已变化，请刷新后重试')
      })
      this.vault.write(tool, { active: previous.active, pending: { before: expected, after } })
      journalSaved = true
      after.forEach((file, index) => {
        guard()
        if (!same(readConfigFile(file.path), expected[index])) throw new Error('配置文件已变化，请刷新后重试')
        if (!same(file, expected[index])) publish(file)
      })
      guard()
      this.vault.write(tool, { active })
    } catch (error) {
      if (journalSaved) {
        try { this.recover(tool, true) } catch { throw new Error('配置写入未完成，备份已保留；请关闭目标工具后重试恢复') }
      }
      if (error instanceof Error && /配置|账号|登录|密钥/.test(error.message) && !error.message.includes('\n')) throw error
      throw new Error('配置写入失败，请检查目录权限或关闭目标工具后重试')
    } finally {
      for (const release of releases.reverse()) {
        try { release() } catch { /* A retained journal remains recoverable independently of lock cleanup. */ }
      }
    }
  }
}
