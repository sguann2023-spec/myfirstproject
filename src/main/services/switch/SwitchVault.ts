import fs from 'node:fs'
import path from 'node:path'
import { app, safeStorage } from 'electron'
import type { SwitchToolId } from '@shared/switchSettings'
import { atomicPrivateWrite, readConfigFile, type ConfigFile, type SwitchVault } from './configTransaction'

type Journal = ReturnType<SwitchVault['read']>
const MAX_VAULT_BYTES = 8 * 1024 * 1024 // Must match readConfigFile's limit, including envelope/base64 overhead.
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))

function validateJournal(value: unknown, tool: SwitchToolId): asserts value is Journal {
  if (!object(value) || Object.keys(value).some((key) => key !== 'active' && key !== 'pending')) throw new Error()
  const count = tool === 'codex' ? 2 : 1
  const files = (items: unknown): items is ConfigFile[] => Array.isArray(items) && items.length === count && items.every((file) =>
    object(file) && typeof file.path === 'string' && path.isAbsolute(file.path) &&
    (file.content === null || (typeof file.content === 'string' && Buffer.byteLength(file.content, 'utf8') <= MAX_VAULT_BYTES)) &&
    (file.mode === undefined || (Number.isInteger(file.mode) && Number(file.mode) >= 0 && Number(file.mode) <= 0o777))
  )
  const paired = (before: unknown, after: unknown) => files(before) && files(after) &&
    before.every((file, index) => file.path === after[index].path) && new Set(before.map((file) => file.path)).size === count
  if (value.active !== undefined) {
    const active = value.active
    if (!object(active) || active.version !== 1 || active.tool !== tool ||
      typeof active.userId !== 'string' || !active.userId.trim() ||
      typeof active.catalogSignature !== 'string' || !active.catalogSignature.trim() ||
      (active.modelId !== undefined && (typeof active.modelId !== 'string' || !active.modelId.trim())) ||
      !paired(active.before, active.applied) ||
      (active.originalBefore !== undefined && !paired(active.originalBefore, active.applied))) throw new Error()
  }
  if (value.pending !== undefined && (!object(value.pending) || !paired(value.pending.before, value.pending.after))) throw new Error()
}

/** Snapshots include native credentials, so even backups are encrypted at rest. */
export class EncryptedSwitchVault implements SwitchVault {
  constructor(private readonly directory = path.join(app.getPath('userData'), 'switch-backups')) {}

  private file(tool: SwitchToolId) { return path.join(this.directory, `${tool}.json`) }
  private requireEncryption() {
    if (!safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === 'basic_text') {
      throw new Error('系统安全存储不可用，无法安全备份工具配置')
    }
  }

  read(tool: SwitchToolId): Journal {
    const file = readConfigFile(this.file(tool))
    if (file.content === null) return {}
    this.requireEncryption()
    try {
      const payload = JSON.parse(file.content)
      if (payload.version !== 1 || typeof payload.encrypted !== 'string') throw new Error()
      const journal: unknown = JSON.parse(safeStorage.decryptString(Buffer.from(payload.encrypted, 'base64')))
      validateJournal(journal, tool)
      return journal
    } catch {
      throw new Error('无法读取加密配置备份，请勿删除备份文件')
    }
  }

  write(tool: SwitchToolId, value: Journal) {
    this.requireEncryption()
    let content: string
    try {
      validateJournal(value, tool)
      const encrypted = safeStorage.encryptString(JSON.stringify(value)).toString('base64')
      content = JSON.stringify({ version: 1, encrypted }) + '\n'
    } catch {
      throw new Error('无法安全保存配置备份，请检查配置格式或系统安全存储')
    }
    // Reject before touching the existing vault or publishing native config. A backup
    // accepted here must remain readable by readConfigFile during rollback/recovery.
    if (Buffer.byteLength(content, 'utf8') > MAX_VAULT_BYTES) {
      throw new Error('配置备份过大，无法安全保存；原配置和备份未修改')
    }
    try {
      atomicPrivateWrite(this.file(tool), content)
      if (process.platform !== 'win32') fs.chmodSync(this.directory, 0o700)
    } catch {
      throw new Error('无法安全保存配置备份，请检查配置目录权限')
    }
  }
}
