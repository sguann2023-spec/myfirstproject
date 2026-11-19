import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfigTransaction, readConfigFile, type SwitchVault, type SwitchRecord } from './configTransaction'

const roots: string[] = []
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })
function setup() {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'switch-transaction-'))
  roots.push(root)
  let data: ReturnType<SwitchVault['read']> = {}
  const vault: SwitchVault = { read: () => structuredClone(data), write: (_tool, value) => { data = structuredClone(value) } }
  const transaction = new ConfigTransaction(vault)
  const first = path.join(root, 'config.toml')
  const second = path.join(root, 'catalog.json')
  fs.writeFileSync(first, 'original')
  const before = [first, second].map(readConfigFile)
  const after = before.map((file, index) => ({ ...file, content: `applied-${index}`, mode: 0o600 }))
  const record: SwitchRecord = { version: 1, tool: 'codex', userId: 'user-1', catalogSignature: 'x', before, applied: after }
  return { root, vault, transaction, first, second, before, after, record }
}

describe('Switch configuration transaction', () => {
  it('writes private files with a saved baseline and restores original absence', () => {
    const t = setup()
    t.transaction.commit('codex', t.before, t.after, t.record, () => {})
    expect(t.vault.read('codex').active).toEqual(t.record)
    expect(fs.readFileSync(t.first, 'utf8')).toBe('applied-0')
    if (process.platform !== 'win32') expect(fs.statSync(t.second).mode & 0o777).toBe(0o600)
    t.transaction.commit('codex', t.after, t.before, undefined, () => {})
    expect(fs.readFileSync(t.first, 'utf8')).toBe('original')
    expect(fs.existsSync(t.second)).toBe(false)
    expect(t.vault.read('codex')).toEqual({ active: undefined })
    expect(fs.readdirSync(t.root)).toEqual(['config.toml'])
  })

  it('rejects changed files and account changes without writing', () => {
    const t = setup()
    fs.writeFileSync(t.first, 'external')
    expect(() => t.transaction.commit('codex', t.before, t.after, t.record, () => {})).toThrow('配置文件已变化')
    expect(fs.readFileSync(t.first, 'utf8')).toBe('external')
    expect(t.vault.read('codex')).toEqual({})
  })

  it('rolls back already published files when a later write fails', () => {
    const t = setup()
    const rename = fs.renameSync.bind(fs)
    vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      if (String(destination) === t.second) throw new Error('EACCES secret-value')
      return rename(source, destination)
    })
    expect(() => t.transaction.commit('codex', t.before, t.after, t.record, () => {})).toThrow('配置写入失败')
    expect(fs.readFileSync(t.first, 'utf8')).toBe('original')
    expect(fs.existsSync(t.second)).toBe(false)
    expect(t.vault.read('codex').pending).toBeUndefined()
    expect(fs.readdirSync(t.root)).toEqual(['config.toml'])
  })

  it('rolls back if account changes during publication', () => {
    const t = setup()
    let checks = 0
    expect(() => t.transaction.commit('codex', t.before, t.after, t.record, () => {
      if (++checks === 3) throw new Error('账号已变化')
    })).toThrow('账号已变化')
    expect(fs.readFileSync(t.first, 'utf8')).toBe('original')
    expect(fs.existsSync(t.second)).toBe(false)
  })

  it('recovers an interrupted journal but refuses outside modifications', () => {
    const t = setup()
    t.vault.write('codex', { pending: { before: t.before, after: t.after } })
    fs.writeFileSync(t.first, t.after[0].content!)
    expect(t.transaction.recover('codex')).toBeUndefined()
    expect(fs.readFileSync(t.first, 'utf8')).toBe('original')
    t.vault.write('codex', { pending: { before: t.before, after: t.after } })
    fs.writeFileSync(t.first, 'outside')
    expect(() => t.transaction.recover('codex')).toThrow('外部修改')
    expect(fs.readFileSync(t.first, 'utf8')).toBe('outside')
    expect(t.vault.read('codex').pending).toBeDefined()
  })

  it('requires a durable backup before the first live write', () => {
    const t = setup()
    t.vault.write = () => { throw new Error('encryption failed') }
    expect(() => t.transaction.commit('codex', t.before, t.after, t.record, () => {})).toThrow('配置写入失败')
    expect(fs.readFileSync(t.first, 'utf8')).toBe('original')
    expect(fs.existsSync(t.second)).toBe(false)
  })

  it('holds exclusive locks during recovery and does not overwrite another process', () => {
    const t = setup()
    t.vault.write('codex', { pending: { before: t.before, after: t.after } })
    fs.writeFileSync(t.first, t.after[0].content!)
    fs.writeFileSync(`${t.first}.vectcut-switch.lock`, JSON.stringify({ pid: process.pid }))
    expect(() => t.transaction.recover('codex')).toThrow('其他进程')
    expect(fs.readFileSync(t.first, 'utf8')).toBe(t.after[0].content)
    expect(t.vault.read('codex').pending).toBeDefined()
    fs.unlinkSync(`${t.first}.vectcut-switch.lock`)
    t.transaction.recover('codex')
    expect(fs.readFileSync(t.first, 'utf8')).toBe('original')
  })

  it('never publishes an empty lock if initializing lock metadata fails', () => {
    const t = setup()
    const write = fs.writeFileSync.bind(fs)
    vi.spyOn(fs, 'writeFileSync').mockImplementation((file, ...args: any[]) => {
      if (typeof file === 'string' && file.includes('.vectcut-switch.lock.') && file.endsWith('.tmp')) throw new Error('EIO')
      return (write as any)(file, ...args)
    })
    expect(() => t.transaction.commit('codex', t.before, t.after, t.record, () => {})).toThrow('配置写入失败')
    expect(fs.readdirSync(t.root)).toEqual(['config.toml'])
    expect(fs.readFileSync(t.first, 'utf8')).toBe('original')
  })

  it('does not follow destination symlinks', () => {
    const t = setup()
    fs.symlinkSync(t.first, t.second)
    expect(() => readConfigFile(t.second)).toThrow('不支持符号链接')
    expect(fs.readFileSync(t.first, 'utf8')).toBe('original')
  })
})
