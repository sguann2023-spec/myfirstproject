import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { SwitchToolId } from '@shared/switchSettings'
import { assertSafePath, readConfigFile } from './configTransaction'

/** Retire only an identifiable legacy envelope; never decrypt or use it for config writes. */
export function retireLegacySwitchBackup(tool: SwitchToolId, userData = app.getPath('userData')): void {
  const file = path.join(userData, 'switch-backups', `${tool}.json`)
  try {
    const current = readConfigFile(file)
    if (current.content === null) return
    const value = JSON.parse(current.content)
    if (!value || Array.isArray(value) || value.version !== 1 || typeof value.encrypted !== 'string' ||
      Object.keys(value).some(key => key !== 'version' && key !== 'encrypted') ||
      !value.encrypted || Buffer.from(value.encrypted, 'base64').toString('base64') !== value.encrypted) return
    assertSafePath(file)
    if (readConfigFile(file).content !== current.content) return
    fs.unlinkSync(file)
  } catch {
    // An unreadable/unknown old backup must not block independent current-config cleanup.
  }
}
