import fs from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'
import { app, net } from 'electron'
import semver from 'semver'

import { skillService } from '../services/agents/skills/SkillService'
import { getDataPath, getResourcePath } from '.'

const logger = loggerService.withContext('builtinSkills')

const VERSION_FILE = '.version'
const MANIFEST_FILE = 'manifest.json'
const SYNC_STATE_FILE = '.builtin-sync-state.json'
const REMOTE_MANIFEST_URL = 'https://player.install-ai-guider.top/skills/manifest.json'

interface BuiltinSkillManifestEntry {
  version?: string
  downloadUrl?: string
  minAppVersion?: string
  deleted?: boolean
  tombstoneVersion?: string
  autoEnableExistingAgents?: boolean
}

interface BuiltinSkillManifest {
  updatedAt?: string
  skills: Record<string, BuiltinSkillManifestEntry>
}

interface BuiltinSkillSyncStateEntry {
  version?: string
  source?: 'bundle' | 'remote'
  deleted?: boolean
  deletedAt?: string
  tombstoneVersion?: string
}

interface BuiltinSkillSyncState {
  updatedAt?: string
  skills: Record<string, BuiltinSkillSyncStateEntry>
}

/**
 * Copy built-in skills from app resources to the global skills storage
 * directory.
 *
 * Storage:  {userData}/Data/Skills/{folderName}/
 *
 * Per-agent sync is filesystem-only: each existing agent gets a copied
 * `{agentWorkspace}/.claude/skills/{folderName}/` directory.
 *
 * Each installed skill gets a `.version` file recording the skill version that
 * installed it. On subsequent launches the bundled version is compared with
 * the installed version — the skill files are overwritten only when the bundled
 * or remote skill ships a newer version.
 */
// TODO: v2-backup
export async function installBuiltinSkills(options?: {
  distributeToAgents?: boolean
  waitForRemoteSync?: boolean
}): Promise<void> {
  const resourceSkillsPath = path.join(getResourcePath(), 'skills')
  const globalSkillsPath = getDataPath('Skills')
  const distributeToAgents = options?.distributeToAgents ?? true
  const waitForRemoteSync = options?.waitForRemoteSync ?? false

  try {
    await fs.access(resourceSkillsPath)
  } catch {
    return
  }

  const localManifest = await loadBuiltinSkillsManifest(path.join(resourceSkillsPath, MANIFEST_FILE))
  const syncState = await loadBuiltinSkillSyncState()
  const entries = await fs.readdir(resourceSkillsPath, { withFileTypes: true })
  const dirs = entries.filter((e) => {
    if (!e.isDirectory()) return false
    const destPath = path.join(getDataPath('Skills'), e.name)
    return destPath.startsWith(globalSkillsPath + path.sep)
  })

  let installed = 0
  for (const entry of dirs) {
    if (syncState.skills[entry.name]?.deleted) {
      continue
    }

    const desiredVersion = getDesiredSkillVersion(localManifest, entry.name)
    const destPath = path.join(globalSkillsPath, entry.name)
    const installedVersion = await readInstalledVersion(destPath)

    if (!installedVersion) {
      await fs.mkdir(destPath, { recursive: true })
      await fs.cp(path.join(resourceSkillsPath, entry.name), destPath, { recursive: true })
      await fs.writeFile(path.join(destPath, VERSION_FILE), desiredVersion, 'utf-8')
      syncState.skills[entry.name] = {
        version: desiredVersion,
        source: 'bundle',
        deleted: false
      }
      installed++
    }

    // Distribute to agent workspaces on demand (e.g. post-login), not necessarily at startup.
    if (distributeToAgents) {
      await skillService.enableForAllAgents(entry.name, entry.name)
    }
  }

  await saveBuiltinSkillSyncState(syncState)

  const remoteSyncTask = syncBuiltinSkillsFromRemote({
    localManifest,
    distributeToAgents
  })

  if (waitForRemoteSync) {
    await remoteSyncTask
  } else {
    void remoteSyncTask
  }

  if (installed > 0) {
    logger.info('Built-in skills synchronized', {
      installedFromBundle: installed
    })
  }
}

async function loadBuiltinSkillsManifest(manifestPath: string): Promise<BuiltinSkillManifest> {
  try {
    const content = await fs.readFile(manifestPath, 'utf-8')
    const parsed = JSON.parse(content) as Partial<BuiltinSkillManifest>
    return {
      updatedAt: parsed.updatedAt,
      skills: parsed.skills && typeof parsed.skills === 'object' ? parsed.skills : {}
    }
  } catch (error) {
    logger.warn('Failed to load builtin skills manifest', {
      manifestPath,
      error: error instanceof Error ? error.message : String(error)
    })
    return { skills: {} }
  }
}

function getDesiredSkillVersion(manifest: BuiltinSkillManifest, skillName: string): string {
  return manifest.skills[skillName]?.version ?? app.getVersion()
}

async function syncBuiltinSkillsFromRemote(options: {
  localManifest: BuiltinSkillManifest
  distributeToAgents: boolean
}): Promise<void> {
  const remoteManifest = await fetchRemoteBuiltinSkillsManifest()
  if (!remoteManifest) return

  const syncState = await loadBuiltinSkillSyncState()
  for (const [skillName, entry] of Object.entries(remoteManifest.skills)) {
    if (entry.deleted) {
      await applyRemoteDeletion(skillName, entry, syncState)
      continue
    }

    if (!entry.version || !entry.downloadUrl) continue

    if (!isMinAppVersionSatisfied(entry.minAppVersion)) {
      continue
    }

    const destPath = path.join(getDataPath('Skills'), skillName)
    const installedVersion = await readInstalledVersion(destPath)
    if (installedVersion && compareVersions(installedVersion, entry.version) >= 0) {
      syncState.skills[skillName] = {
        version: installedVersion,
        source: syncState.skills[skillName]?.source ?? inferSkillSource(options.localManifest, skillName),
        deleted: false
      }
      continue
    }

    try {
      const folderName = await downloadAndInstallBuiltinSkill(skillName, entry)
      const isNewSkill = !installedVersion
      syncState.skills[folderName] = {
        version: entry.version,
        source: 'remote',
        deleted: false
      }

      if (isNewSkill && (entry.autoEnableExistingAgents ?? true)) {
        await skillService.enableForAllAgents(folderName, folderName)
      } else if (options.distributeToAgents) {
        await skillService.enableForAllAgents(folderName, folderName)
      }
    } catch (error) {
      logger.warn('Failed to update builtin skill from remote manifest', {
        skillName,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  syncState.updatedAt = remoteManifest.updatedAt ?? new Date().toISOString()
  await saveBuiltinSkillSyncState(syncState)
}

async function fetchRemoteBuiltinSkillsManifest(): Promise<BuiltinSkillManifest | null> {
  try {
    const response = await net.fetch(REMOTE_MANIFEST_URL, {
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache'
      }
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const parsed = (await response.json()) as Partial<BuiltinSkillManifest>
    return {
      updatedAt: parsed.updatedAt,
      skills: parsed.skills && typeof parsed.skills === 'object' ? parsed.skills : {}
    }
  } catch (error) {
    logger.warn('Failed to fetch remote builtin skills manifest', {
      url: REMOTE_MANIFEST_URL,
      error: error instanceof Error ? error.message : String(error)
    })
    return null
  }
}

async function downloadAndInstallBuiltinSkill(skillName: string, entry: BuiltinSkillManifestEntry): Promise<string> {
  const downloadUrl = entry.downloadUrl
  const version = entry.version
  if (!downloadUrl || !version) {
    throw new Error(`Remote manifest entry for ${skillName} is incomplete`)
  }

  const response = await net.fetch(downloadUrl)
  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${response.status}`)
  }

  const downloadDir = path.join(getDataPath('Skills'), '.downloads')
  const zipPath = path.join(downloadDir, `${skillName}-${Date.now()}.zip`)

  await fs.mkdir(downloadDir, { recursive: true })
  try {
    const buffer = Buffer.from(await response.arrayBuffer())
    await fs.writeFile(zipPath, buffer)

    const installed = await skillService.installFromZip({ zipFilePath: zipPath })
    const installedPath = path.join(getDataPath('Skills'), installed.folderName)
    await fs.writeFile(path.join(installedPath, VERSION_FILE), version, 'utf-8')

    return installed.folderName
  } finally {
    await fs.rm(zipPath, { force: true }).catch(() => undefined)
  }
}

async function applyRemoteDeletion(
  skillName: string,
  entry: BuiltinSkillManifestEntry,
  syncState: BuiltinSkillSyncState
): Promise<void> {
  const minAppVersion = entry.minAppVersion
  if (minAppVersion && !isMinAppVersionSatisfied(minAppVersion)) {
    return
  }

  const tombstoneVersion = entry.tombstoneVersion ?? entry.version ?? new Date().toISOString()
  const previousTombstone = syncState.skills[skillName]?.tombstoneVersion
  if (previousTombstone && compareVersions(previousTombstone, tombstoneVersion) >= 0) {
    return
  }

  await skillService.uninstallByFolderName(skillName).catch((error) => {
    logger.warn('Failed to uninstall builtin skill marked deleted in remote manifest', {
      skillName,
      error: error instanceof Error ? error.message : String(error)
    })
  })

  syncState.skills[skillName] = {
    deleted: true,
    deletedAt: new Date().toISOString(),
    tombstoneVersion,
    source: 'remote'
  }
}

async function readInstalledVersion(destPath: string): Promise<string | null> {
  try {
    return (await fs.readFile(path.join(destPath, VERSION_FILE), 'utf-8')).trim()
  } catch {
    return null
  }
}

async function loadBuiltinSkillSyncState(): Promise<BuiltinSkillSyncState> {
  try {
    const content = await fs.readFile(getBuiltinSkillSyncStatePath(), 'utf-8')
    const parsed = JSON.parse(content) as Partial<BuiltinSkillSyncState>
    return {
      updatedAt: parsed.updatedAt,
      skills: parsed.skills && typeof parsed.skills === 'object' ? parsed.skills : {}
    }
  } catch {
    return { skills: {} }
  }
}

async function saveBuiltinSkillSyncState(state: BuiltinSkillSyncState): Promise<void> {
  const statePath = getBuiltinSkillSyncStatePath()
  await fs.mkdir(path.dirname(statePath), { recursive: true })
  await fs.writeFile(
    statePath,
    JSON.stringify(
      {
        updatedAt: state.updatedAt ?? new Date().toISOString(),
        skills: state.skills
      },
      null,
      2
    ),
    'utf-8'
  )
}

function getBuiltinSkillSyncStatePath(): string {
  return path.join(getDataPath('Skills'), SYNC_STATE_FILE)
}

function inferSkillSource(localManifest: BuiltinSkillManifest, skillName: string): 'bundle' | 'remote' {
  return localManifest.skills[skillName] ? 'bundle' : 'remote'
}

function isMinAppVersionSatisfied(minAppVersion?: string): boolean {
  if (!minAppVersion) return true
  return compareVersions(app.getVersion(), minAppVersion) >= 0
}

function compareVersions(left: string, right: string): number {
  const normalizedLeft = normalizeVersion(left)
  const normalizedRight = normalizeVersion(right)

  if (!normalizedLeft && !normalizedRight) return left.localeCompare(right)
  if (!normalizedLeft) return -1
  if (!normalizedRight) return 1
  return semver.compare(normalizedLeft, normalizedRight)
}

function normalizeVersion(version: string): string | null {
  return semver.valid(version) ?? semver.coerce(version)?.version ?? null
}
