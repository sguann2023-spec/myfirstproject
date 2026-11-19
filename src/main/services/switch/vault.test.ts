import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  available: vi.fn(), backend: vi.fn(), encrypt: vi.fn(), decrypt: vi.fn()
}))
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => { throw new Error('Tests must provide an isolated vault directory') }) },
  safeStorage: {
    isEncryptionAvailable: mocks.available,
    getSelectedStorageBackend: mocks.backend,
    encryptString: mocks.encrypt,
    decryptString: mocks.decrypt
  }
}))

import { EncryptedSwitchVault } from './SwitchVault'
import { ConfigTransaction, readConfigFile, type SwitchRecord } from './configTransaction'

const MAX_BYTES = 8 * 1024 * 1024
const roots: string[] = []
let root: string
let vault: EncryptedSwitchVault
let directory: string
let file: string

function record(content = 'native-secret'): SwitchRecord {
  const paths = [path.join(root, 'native', 'config.toml'), path.join(root, 'native', 'catalog.json')]
  return {
    version: 1, tool: 'codex', userId: 'user-a', catalogSignature: 'catalog-digest', modelId: 'gpt-test',
    before: paths.map((path, index) => ({ path, content: index === 0 ? content : null, mode: 0o600 })),
    applied: paths.map((path, index) => ({ path, content: index === 0 ? 'vectcut-secret' : 'catalog', mode: 0o600 }))
  }
}
function encoded(value: unknown) {
  return JSON.stringify({ version: 1, encrypted: Buffer.from(JSON.stringify(value)).toString('base64') }) + '\n'
}
function plant(content: string) {
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(file, content)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.available.mockReset().mockReturnValue(true)
  mocks.backend.mockReset().mockReturnValue('keychain')
  // Mock cipher uses an opaque reversible byte transform; never invokes real OS keychain.
  mocks.encrypt.mockReset().mockImplementation((text: string) => Buffer.from(text).map((byte) => byte ^ 0x5a))
  mocks.decrypt.mockReset().mockImplementation((bytes: Buffer) => Buffer.from(Uint8Array.from(bytes, (byte) => byte ^ 0x5a)).toString('utf8'))
  root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'switch-vault-'))
  roots.push(root)
  directory = path.join(root, 'vault')
  file = path.join(directory, 'codex.json')
  vault = new EncryptedSwitchVault(directory)
})
afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('EncryptedSwitchVault', () => {
  it('returns an empty journal without requiring encryption for a nonexistent backup', () => {
    mocks.available.mockReturnValue(false)
    expect(vault.read('codex')).toEqual({})
    expect(mocks.decrypt).not.toHaveBeenCalled()
    expect(fs.existsSync(directory)).toBe(false)
  })

  it('roundtrips active and pending journals privately without plaintext credentials on disk', () => {
    const active = record()
    const journal = { active, pending: { before: active.before, after: active.applied } }
    vault.write('codex', journal)
    const disk = fs.readFileSync(file, 'utf8')
    expect(disk).not.toContain('native-secret')
    expect(disk).not.toContain('vectcut-secret')
    expect(vault.read('codex')).toEqual(journal)
    expect(mocks.encrypt).toHaveBeenCalledTimes(1)
    expect(mocks.decrypt).toHaveBeenCalledTimes(1)
    if (process.platform !== 'win32') {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600)
      expect(fs.statSync(directory).mode & 0o777).toBe(0o700)
    }
  })

  it('supports an empty journal after disable', () => {
    vault.write('codex', { active: undefined })
    expect(vault.read('codex')).toEqual({})
  })

  it.each(['unavailable', 'basic_text'])('rejects %s encryption without overwriting an existing backup', (scenario) => {
    vault.write('codex', { active: record() })
    const original = fs.readFileSync(file)
    if (scenario === 'unavailable') mocks.available.mockReturnValue(false)
    else mocks.backend.mockReturnValue('basic_text')
    expect(() => vault.read('codex')).toThrow('系统安全存储不可用')
    expect(() => vault.write('codex', {})).toThrow('系统安全存储不可用')
    expect(fs.readFileSync(file)).toEqual(original)
  })

  it.each(['not-json', JSON.stringify({ version: 2, encrypted: 'x' }), JSON.stringify({ version: 1, encrypted: 123 })])('rejects corrupt envelope without leaking its contents', (content) => {
    plant(content)
    expect(() => vault.read('codex')).toThrow('无法读取加密配置备份，请勿删除备份文件')
  })

  it('sanitizes decryption and encryption errors, retaining the previous vault', () => {
    vault.write('codex', { active: record() })
    const original = fs.readFileSync(file)
    mocks.decrypt.mockImplementationOnce(() => { throw new Error('secret-decryption-detail') })
    expect(() => vault.read('codex')).toThrow('无法读取加密配置备份，请勿删除备份文件')
    mocks.encrypt.mockImplementationOnce(() => { throw new Error('secret-encryption-detail') })
    expect(() => vault.write('codex', {})).toThrow('无法安全保存配置备份，请检查配置格式或系统安全存储')
    expect(fs.readFileSync(file)).toEqual(original)
  })

  it.each([
    null,
    [],
    { active: null },
    { pending: null },
    { unexpected: 'value' },
    { active: { version: 1, tool: 'workbuddy', before: [], applied: [] } },
    { pending: { before: [], after: [] } }
  ])('rejects malformed decrypted journal structures', (journal) => {
    mocks.decrypt.mockReturnValue(JSON.stringify(journal))
    plant(encoded({}))
    expect(() => vault.read('codex')).toThrow('无法读取加密配置备份，请勿删除备份文件')
  })

  it.each(['missing owner', 'relative path', 'invalid content', 'invalid mode', 'mismatched paths', 'duplicate paths'])('rejects %s both on write and read', (scenario) => {
    const active = record()
    if (scenario === 'missing owner') active.userId = ''
    if (scenario === 'relative path') active.before[0].path = 'relative/config.toml'
    if (scenario === 'invalid content') (active.before[0] as any).content = { secret: 'bad shape' }
    if (scenario === 'invalid mode') active.before[0].mode = 0o1777
    if (scenario === 'mismatched paths') active.applied[0].path = path.join(root, 'elsewhere')
    if (scenario === 'duplicate paths') {
      active.before[1].path = active.before[0].path
      active.applied[1].path = active.applied[0].path
    }
    expect(() => vault.write('codex', { active })).toThrow('无法安全保存配置备份')
    expect(fs.existsSync(file)).toBe(false)
    plant(encoded({}))
    mocks.decrypt.mockReturnValue(JSON.stringify({ active }))
    expect(() => vault.read('codex')).toThrow('无法读取加密配置备份')
  })

  it('accepts a backup near the bounded reader size and can read it back', () => {
    const active = record('x'.repeat(5 * 1024 * 1024))
    vault.write('codex', { active })
    expect(fs.statSync(file).size).toBeLessThanOrEqual(MAX_BYTES)
    expect(vault.read('codex')).toEqual({ active })
  })

  it('rejects base64/envelope expansion beyond the reader limit without replacing the last readable vault', () => {
    vault.write('codex', { active: record() })
    const original = fs.readFileSync(file)
    const oversized = { active: record('x'.repeat(6 * 1024 * 1024)) }
    expect(Buffer.byteLength(JSON.stringify(oversized))).toBeLessThan(MAX_BYTES)
    expect(() => vault.write('codex', oversized)).toThrow('配置备份过大')
    expect(fs.readFileSync(file)).toEqual(original)
    expect(vault.read('codex').active?.before[0].content).toBe('native-secret')
  })

  it('preflights the actual cipher output, not just plaintext length', () => {
    mocks.encrypt.mockReturnValueOnce(Buffer.alloc(6 * 1024 * 1024))
    expect(() => vault.write('codex', {})).toThrow('配置备份过大')
    expect(fs.existsSync(file)).toBe(false)
  })

  it('rejects an oversized pending write before ConfigTransaction publishes native config', () => {
    const active = record()
    fs.mkdirSync(path.dirname(active.before[0].path), { recursive: true })
    fs.writeFileSync(active.before[0].path, 'original-config')
    const before = active.before.map((entry) => readConfigFile(entry.path))
    const after = before.map((entry, index) => ({ ...entry, content: index === 0 ? 'x'.repeat(6 * 1024 * 1024) : 'catalog' }))
    expect(() => new ConfigTransaction(vault).commit('codex', before, after, { ...active, before, applied: after }, () => {})).toThrow('配置备份过大')
    expect(fs.readFileSync(before[0].path, 'utf8')).toBe('original-config')
    expect(fs.existsSync(before[1].path)).toBe(false)
    expect(fs.existsSync(file)).toBe(false)
    expect(fs.readdirSync(path.dirname(before[0].path))).toEqual(['config.toml'])
  })
})
