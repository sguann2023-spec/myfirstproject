import fs from 'node:fs'
import path from 'node:path'

import { app } from 'electron'

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

export function getGlobalSkillsRoot(): string {
  const globalSkillsRoot = path.join(app.getPath('userData'), 'Data', 'GlobalSkills')
  ensureDir(globalSkillsRoot)
  return globalSkillsRoot
}

export function getGlobalSkillsDisplayRoot(): string {
  return path.join(app.getPath('userData'), 'Data', 'GlobalSkills')
}
