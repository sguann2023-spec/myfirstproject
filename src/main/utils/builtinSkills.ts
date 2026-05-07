import fs from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'
import { app } from 'electron'

import { skillService } from '../services/agents/skills/SkillService'
import { getDataPath, toAsarUnpackedPath } from '.'

const logger = loggerService.withContext('builtinSkills')

const VERSION_FILE = '.version'

/**
 * Copy built-in skills from app resources to the global skills storage
 * directory.
 *
 * Storage:  {userData}/Data/Skills/{folderName}/
 *
 * Per-agent sync is filesystem-only: each existing agent gets a copied
 * `{agentWorkspace}/.claude/skills/{folderName}/` directory.
 *
 * Each installed skill gets a `.version` file recording the app version that
 * installed it. On subsequent launches the bundled version is compared with
 * the installed version — the skill files are overwritten only when the app
 * ships a newer version.
 */
// TODO: v2-backup
export async function installBuiltinSkills(options?: { distributeToAgents?: boolean }): Promise<void> {
  const resourceSkillsPath = toAsarUnpackedPath(path.join(app.getAppPath(), 'resources', 'skills'))
  const globalSkillsPath = getDataPath('Skills')
  const appVersion = app.getVersion()
  const distributeToAgents = options?.distributeToAgents ?? true

  try {
    await fs.access(resourceSkillsPath)
  } catch {
    return
  }

  const entries = await fs.readdir(resourceSkillsPath, { withFileTypes: true })
  const dirs = entries.filter((e) => {
    if (!e.isDirectory()) return false
    const destPath = path.join(globalSkillsPath, e.name)
    return destPath.startsWith(globalSkillsPath + path.sep)
  })

  let installed = 0
  for (const entry of dirs) {
    const destPath = path.join(globalSkillsPath, entry.name)
    const upToDate = await isUpToDate(destPath, appVersion)

    if (!upToDate) {
      await fs.mkdir(destPath, { recursive: true })
      await fs.cp(path.join(resourceSkillsPath, entry.name), destPath, { recursive: true })
      await fs.writeFile(path.join(destPath, VERSION_FILE), appVersion, 'utf-8')
      installed++
    }

    // Distribute to agent workspaces on demand (e.g. post-login), not necessarily at startup.
    if (distributeToAgents) {
      await skillService.enableForAllAgents(entry.name, entry.name)
    }
  }

  if (installed > 0) {
    logger.info('Built-in skills installed', { installed, version: appVersion })
  }
}

async function isUpToDate(destPath: string, appVersion: string): Promise<boolean> {
  try {
    const installedVersion = (await fs.readFile(path.join(destPath, VERSION_FILE), 'utf-8')).trim()
    return installedVersion === appVersion
  } catch {
    return false
  }
}
