import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ app: { getPath: () => { throw new Error('Provide an isolated test directory') } } }))
import { retireLegacySwitchBackup } from './legacyBackupCleanup'

let root: string
let directory: string
const envelope = JSON.stringify({ version: 1, encrypted: Buffer.from('opaque-encrypted-data').toString('base64') })
beforeEach(() => {
  root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'switch-retire-'))
  directory = path.join(root, 'switch-backups')
})
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }) })
const plant = (text: string) => { fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(path.join(directory, 'codex.json'), text) }

describe('legacy backup retirement', () => {
  it('does not create a backup directory or require OS encryption', () => {
    retireLegacySwitchBackup('codex', root)
    expect(fs.existsSync(directory)).toBe(false)
  })
  it('removes only the selected known envelope without reading a tool config or decrypting', () => {
    plant(envelope)
    fs.writeFileSync(path.join(directory, 'workbuddy.json'), envelope)
    fs.writeFileSync(path.join(directory, 'personal.json'), envelope)
    retireLegacySwitchBackup('codex', root)
    expect(fs.readdirSync(directory).sort()).toEqual(['personal.json', 'workbuddy.json'])
  })
  it.each(['not-json', '{}', '[]', '{"version":2,"encrypted":"YQ=="}', '{"version":1,"encrypted":"bad"}', '{"version":1,"encrypted":"YQ==","personal":true}'])('leaves unknown legacy data untouched: %s', text => {
    plant(text)
    expect(() => retireLegacySwitchBackup('codex', root)).not.toThrow()
    expect(fs.readFileSync(path.join(directory, 'codex.json'), 'utf8')).toBe(text)
  })
  it('does not follow a backup symlink or a symlinked directory', () => {
    const target = path.join(root, 'personal.json')
    fs.writeFileSync(target, envelope)
    fs.mkdirSync(directory)
    fs.symlinkSync(target, path.join(directory, 'codex.json'))
    retireLegacySwitchBackup('codex', root)
    expect(fs.readFileSync(target, 'utf8')).toBe(envelope)
    expect(fs.lstatSync(path.join(directory, 'codex.json')).isSymbolicLink()).toBe(true)
  })
  it('retains the backup if it changes during inspection', () => {
    plant(envelope)
    const read = fs.readSync.bind(fs)
    let reads = 0
    vi.spyOn(fs, 'readSync').mockImplementation(((...args: any[]) => {
      if (++reads === 3) fs.writeFileSync(path.join(directory, 'codex.json'), envelope + ' ')
      return (read as Function)(...args)
    }) as typeof fs.readSync)
    retireLegacySwitchBackup('codex', root)
    expect(fs.existsSync(path.join(directory, 'codex.json'))).toBe(true)
  })
  it('does not turn an unreadable old backup into a current-config failure', () => {
    plant(envelope)
    vi.spyOn(fs, 'unlinkSync').mockImplementation(() => { throw new Error('EACCES private contents') })
    expect(() => retireLegacySwitchBackup('codex', root)).not.toThrow()
    expect(fs.existsSync(path.join(directory, 'codex.json'))).toBe(true)
  })
})
