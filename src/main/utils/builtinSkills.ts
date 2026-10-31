import fs from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'
import { app, net } from 'electron'
import StreamZip from 'node-stream-zip'
import semver from 'semver'
import Store from 'electron-store'
import { getStoredVectcutApiKey } from '../mcpServers/vectcut-auth'
import { isSafeSkillFolder, isQuickSkillCompatible, parseQuickSkillsResponse, type QuickSkillEntry as QuickSkillManifestEntry, type QuickSkillsManifest } from '../../shared/quickSkillManifest'
import { getActiveQuickSkills, getQuickSkillsRoot } from './quickSkillStorage'
import { isHomepageOperationsMockEnabled, readHomepageOperationsMockResponse, extractHomepageMockPackage } from './homepageOperationsMock'

import { getGlobalSkillsRoot } from '../services/agents/skills/paths'
import { skillService } from '../services/agents/skills/SkillService'
import { HIDDEN_SKILL_MARKER_FILE, isHiddenBuiltinSkillFolder } from '../services/agents/skills/hiddenBuiltinSkills'
import { getResourcePath } from '.'

const logger = loggerService.withContext('builtinSkills')

const VERSION_FILE = '.version'
const MANIFEST_FILE = 'manifest.json'
const SYNC_STATE_FILE = '.builtin-sync-state.json'
const REMOTE_MANIFEST_URL = 'https://player.install-ai-guider.top/skills/manifest.json'
const REMOTE_QUICK_SKILLS_MANIFEST_URL = 'https://open.vectcut.com/client_operations/homepage/skill_templates'
let quickSkillsActivated = false
let quickSkillsSyncTask: Promise<void> | undefined
const QUICK_SKILLS_STORAGE_SUBDIR = 'skills'
const QUICK_SKILLS_DOWNLOADS_SUBDIR = '.downloads'
const QUICK_SKILLS_EXTRACT_PREFIX = '.extract-'
const MAX_QUICK_SKILL_EXTRACTED_SIZE = 100 * 1024 * 1024
const MAX_QUICK_SKILL_FILES_COUNT = 1000

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

/** Activate staged operations before creating a renderer; no network work here. */
export async function prepareHomepageSkills(): Promise<void> {
  if (!quickSkillsActivated) {
    quickSkillsActivated = true
    if (isHomepageOperationsMockEnabled()) {
      // Seed the isolated developer cache immediately so the first dev launch is reviewable.
      const manifest = parseQuickSkillsResponse(await readHomepageOperationsMockResponse())
      const materialized = await materializeQuickSkillsManifest(manifest)
      const cachePath = getQuickSkillsManifestCachePath()
      await fs.mkdir(path.dirname(cachePath), { recursive: true })
      await fs.writeFile(`${cachePath}.tmp`, JSON.stringify(materialized, null, 2), 'utf-8')
      await fs.rename(`${cachePath}.tmp`, cachePath)
      await getActiveQuickSkills()
      logger.info('Homepage operations mock enabled (development only)', { cachePath })
      return
    }
    const activePath = getQuickSkillsManifestCachePath()
    const pendingPath = path.join(getQuickSkillsRoot(), 'pending-manifest.json')
    let activated = false
    try {
      const pending = JSON.parse(await fs.readFile(pendingPath, 'utf-8')) as QuickSkillsManifest
      if (!pending?.skills || typeof pending.skills !== 'object' || Array.isArray(pending.skills)) throw new Error('Invalid pending snapshot')
      for (const entry of Object.values(pending.skills)) {
        const folder = String(entry.folderName || '')
        if (!isSafeSkillFolder(folder) || !semver.valid(entry.version || '')
          || entry.storageRelativePath !== `${folder}/${entry.version}`) throw new Error('Invalid pending skill path')
        const directory = getQuickSkillDirectory(entry.storageRelativePath)
        if (await readInstalledVersion(directory) !== entry.version) throw new Error('Pending skill version mismatch')
        await fs.access(path.join(directory, 'SKILL.md'))
      }
      await fs.rename(pendingPath, activePath)
      activated = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') logger.warn('Could not activate homepage snapshot', { error: String(error) })
    }
    const active = await getActiveQuickSkills()
    if (activated) {
      await removeStaleCachedQuickSkills(Object.values(active.manifest.skills).map((entry) => String(entry.folderName || '')))
      // The old process has exited, so retired package versions can now be removed.
      for (const entry of Object.values(active.manifest.skills)) {
        const folder = String(entry.folderName || '')
        if (!isSafeSkillFolder(folder)) continue
        const folderPath = getQuickSkillDirectory(folder)
        const versions = await fs.readdir(folderPath, { withFileTypes: true }).catch(() => [])
        for (const version of versions) {
          if (version.name !== entry.version) {
            await fs.rm(path.join(folderPath, version.name), { recursive: true, force: true }).catch(() => undefined)
          }
        }
      }
    }
  }
}

/**
 * Copy built-in skills from app resources to the global skills storage
 * directory.
 *
 * Storage:  {userData}/Data/GlobalSkills/{folderName}/
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
  await prepareHomepageSkills()
  const resourceSkillsPath = path.join(getResourcePath(), 'skills')
  const globalSkillsPath = getGlobalSkillsRoot()
  const distributeToAgents = options?.distributeToAgents ?? true
  const waitForRemoteSync = options?.waitForRemoteSync ?? false

  logger.info('Starting builtin skill sync', {
    resourceSkillsPath,
    globalSkillsPath,
    distributeToAgents,
    waitForRemoteSync
  })

  try {
    await fs.access(resourceSkillsPath)
  } catch {
    logger.warn('Builtin skill resources path does not exist, skipping sync', { resourceSkillsPath })
    return
  }

  const localManifest = await loadBuiltinSkillsManifest(path.join(resourceSkillsPath, MANIFEST_FILE))
  const syncState = await loadBuiltinSkillSyncState()
  const entries = await fs.readdir(resourceSkillsPath, { withFileTypes: true })
  const dirs = entries.filter((e) => {
    if (!e.isDirectory()) return false
    const destPath = path.join(getGlobalSkillsRoot(), e.name)
    return destPath.startsWith(globalSkillsPath + path.sep)
  })

  let installed = 0
  for (const entry of dirs) {
    if (syncState.skills[entry.name]?.deleted) {
      logger.info('Skipping bundled builtin skill because it is tombstoned', {
        skillName: entry.name,
        tombstoneVersion: syncState.skills[entry.name]?.tombstoneVersion
      })
      continue
    }

    const desiredVersion = getDesiredSkillVersion(localManifest, entry.name)
    const destPath = skillService.getSkillDirectory(entry.name)
    const installedVersion = await readInstalledVersion(destPath)

    if (!installedVersion) {
      logger.info('Installing bundled builtin skill because it is missing from global storage', {
        skillName: entry.name,
        desiredVersion,
        destPath
      })
      await fs.mkdir(destPath, { recursive: true })
      await fs.cp(path.join(resourceSkillsPath, entry.name), destPath, { recursive: true })
      await fs.writeFile(path.join(destPath, VERSION_FILE), desiredVersion, 'utf-8')
      if (isHiddenBuiltinSkillFolder(entry.name)) {
        await fs.writeFile(path.join(destPath, HIDDEN_SKILL_MARKER_FILE), 'hidden\n', 'utf-8')
      }
      syncState.skills[entry.name] = {
        version: desiredVersion,
        source: 'bundle',
        deleted: false
      }
      installed++
    } else {
      logger.debug('Skipping bundled builtin skill because a global version is already installed', {
        skillName: entry.name,
        installedVersion,
        bundledVersion: desiredVersion
      })
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
    await syncQuickSkillsManifestFromRemote()
  } else {
    void remoteSyncTask
    void syncQuickSkillsManifestFromRemote()
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
  logger.info('Starting remote builtin skill sync', {
    manifestUrl: REMOTE_MANIFEST_URL,
    distributeToAgents: options.distributeToAgents
  })
  const remoteManifest = await fetchRemoteBuiltinSkillsManifest()
  if (!remoteManifest) return

  const syncState = await loadBuiltinSkillSyncState()
  let updatedCount = 0
  let deletedCount = 0
  let skippedCount = 0
  for (const [skillName, entry] of Object.entries(remoteManifest.skills)) {
    if (entry.deleted) {
      await applyRemoteDeletion(skillName, entry, syncState)
      deletedCount++
      continue
    }

    if (!entry.version || !entry.downloadUrl) {
      logger.warn('Skipping remote builtin skill because manifest entry is incomplete', {
        skillName,
        hasVersion: Boolean(entry.version),
        hasDownloadUrl: Boolean(entry.downloadUrl)
      })
      skippedCount++
      continue
    }

    if (!isMinAppVersionSatisfied(entry.minAppVersion)) {
      logger.info('Skipping remote builtin skill because minAppVersion is not satisfied', {
        skillName,
        currentAppVersion: app.getVersion(),
        minAppVersion: entry.minAppVersion
      })
      skippedCount++
      continue
    }

    const destPath = skillService.getSkillDirectory(skillName)
    const installedVersion = await readInstalledVersion(destPath)
    if (installedVersion && compareVersions(installedVersion, entry.version) >= 0) {
      logger.debug('Skipping remote builtin skill because installed version is already up to date', {
        skillName,
        installedVersion,
        remoteVersion: entry.version
      })
      syncState.skills[skillName] = {
        version: installedVersion,
        source: syncState.skills[skillName]?.source ?? inferSkillSource(options.localManifest, skillName),
        deleted: false
      }
      skippedCount++
      continue
    }

    try {
      logger.info('Remote builtin skill update available', {
        skillName,
        installedVersion: installedVersion ?? null,
        remoteVersion: entry.version,
        downloadUrl: entry.downloadUrl
      })
      const folderName = await downloadAndInstallBuiltinSkill(skillName, entry)
      const isNewSkill = !installedVersion
      syncState.skills[folderName] = {
        version: entry.version,
        source: 'remote',
        deleted: false
      }
      updatedCount++

      logger.info('Remote builtin skill installed successfully', {
        skillName,
        folderName,
        installedVersion: entry.version,
        isNewSkill
      })

      if (isNewSkill && (entry.autoEnableExistingAgents ?? true)) {
        logger.info('Auto-enabling remotely added builtin skill for existing agents', {
          skillName: folderName,
          version: entry.version
        })
        await skillService.enableForAllAgents(folderName, folderName)
      } else if (options.distributeToAgents) {
        logger.info('Distributing remotely updated builtin skill to existing agents', {
          skillName: folderName,
          version: entry.version
        })
        await skillService.enableForAllAgents(folderName, folderName)
      }
    } catch (error) {
      logger.error('Failed to update builtin skill from remote manifest', {
        skillName,
        installedVersion: installedVersion ?? null,
        remoteVersion: entry.version,
        downloadUrl: entry.downloadUrl,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  syncState.updatedAt = remoteManifest.updatedAt ?? new Date().toISOString()
  await saveBuiltinSkillSyncState(syncState)
  logger.info('Completed remote builtin skill sync', {
    updatedAt: syncState.updatedAt,
    updatedCount,
    deletedCount,
    skippedCount
  })
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
    const skillCount = parsed.skills && typeof parsed.skills === 'object' ? Object.keys(parsed.skills).length : 0
    logger.info('Fetched remote builtin skills manifest successfully', {
      url: REMOTE_MANIFEST_URL,
      updatedAt: parsed.updatedAt ?? null,
      skillCount
    })
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

async function syncQuickSkillsManifestFromRemote(): Promise<void> {
  if (!quickSkillsSyncTask) quickSkillsSyncTask = runQuickSkillsManifestSync().finally(() => { quickSkillsSyncTask = undefined })
  return quickSkillsSyncTask
}

async function runQuickSkillsManifestSync(): Promise<void> {
  logger.info('Starting remote quick skill manifest sync', {
    manifestUrl: REMOTE_QUICK_SKILLS_MANIFEST_URL
  })

  try {
    const manifest = await fetchRemoteQuickSkillsManifest()
    if (!manifest) return

    const materializedManifest = await materializeQuickSkillsManifest(manifest)
    const cachePath = path.join(getQuickSkillsRoot(), 'pending-manifest.json')
    await fs.mkdir(path.dirname(cachePath), { recursive: true })
    await fs.writeFile(`${cachePath}.tmp`, JSON.stringify(materializedManifest, null, 2), 'utf-8')
    await fs.rename(`${cachePath}.tmp`, cachePath)

    logger.info('Cached remote quick skill manifest successfully', {
      cachePath,
      updatedAt: materializedManifest.updatedAt ?? null,
      skillCount: Object.keys(materializedManifest.skills).length
    })
  } catch (error) {
    logger.warn('Failed to sync remote quick skill manifest', {
      url: REMOTE_QUICK_SKILLS_MANIFEST_URL,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

async function fetchRemoteQuickSkillsManifest(): Promise<QuickSkillsManifest | null> {
  try {
    if (isHomepageOperationsMockEnabled()) return parseQuickSkillsResponse(await readHomepageOperationsMockResponse())
    const apiKey = getStoredVectcutApiKey(new Store({ name: 'vectcut' }))
    if (!apiKey) return null
    const requestUrl = new URL(REMOTE_QUICK_SKILLS_MANIFEST_URL)
    requestUrl.searchParams.set('version', app.getVersion())
    const response = await net.fetch(requestUrl.toString(), {
      signal: AbortSignal.timeout(15000),
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'Cache-Control': 'no-cache'
      }
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const manifest = parseQuickSkillsResponse(await response.json())
    logger.info('Fetched remote quick skill manifest successfully', {
      url: REMOTE_QUICK_SKILLS_MANIFEST_URL,
      updatedAt: manifest.updatedAt ?? null,
      skillCount: Object.keys(manifest.skills).length
    })
    return manifest
  } catch (error) {
    logger.warn('Failed to fetch remote quick skill manifest', {
      url: REMOTE_QUICK_SKILLS_MANIFEST_URL,
      error: error instanceof Error ? error.message : String(error)
    })
    return null
  }
}

async function materializeQuickSkillsManifest(remoteManifest: QuickSkillsManifest): Promise<QuickSkillsManifest> {
  const materializedSkills: Record<string, QuickSkillManifestEntry> = {}
  let updatedCount = 0
  let deletedCount = 0

  for (const [skillName, entry] of Object.entries(remoteManifest.skills)) {
    const folderName = String(entry.folderName || skillName).trim() || skillName
    if (entry.deleted) {
      deletedCount++
      continue
    }

    if (!isQuickSkillCompatible(entry, app.getVersion())) {
      logger.info('Skipping remote quick skill because minAppVersion is not satisfied', {
        skillName,
        currentAppVersion: app.getVersion(),
        minAppVersion: entry.minAppVersion
      })
      continue
    }

    if (!entry.version || !entry.downloadUrl) {
      throw new Error(`Remote quick skill entry for ${skillName} is incomplete`)
    }

    const quickSkillDir = getQuickSkillDirectory(path.join(folderName, entry.version))
    const installedVersion = await readInstalledVersion(quickSkillDir)
    if (installedVersion !== entry.version) {
      await downloadAndCacheQuickSkill(skillName, entry)
      updatedCount++
    }

    materializedSkills[skillName] = {
      ...entry,
      folderName,
      storageRelativePath: `${folderName}/${entry.version}`
    }
  }

  // Keep the active snapshot's immutable packages until the next process.
  logger.info('Completed remote quick skill sync', {
    updatedAt: remoteManifest.updatedAt ?? null,
    updatedCount,
    deletedCount,
    skillCount: Object.keys(materializedSkills).length
  })

  return {
    updatedAt: remoteManifest.updatedAt ?? new Date().toISOString(),
    skills: materializedSkills
  }
}

async function downloadAndInstallBuiltinSkill(skillName: string, entry: BuiltinSkillManifestEntry): Promise<string> {
  const downloadUrl = entry.downloadUrl
  const version = entry.version
  if (!downloadUrl || !version) {
    throw new Error(`Remote manifest entry for ${skillName} is incomplete`)
  }

  logger.info('Downloading remote builtin skill zip', {
    skillName,
    version,
    downloadUrl
  })
  const response = await net.fetch(downloadUrl)
  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${response.status}`)
  }

  const downloadDir = path.join(getGlobalSkillsRoot(), '.downloads')
  const zipPath = path.join(downloadDir, `${skillName}-${Date.now()}.zip`)

  await fs.mkdir(downloadDir, { recursive: true })
  try {
    const buffer = Buffer.from(await response.arrayBuffer())
    logger.info('Downloaded remote builtin skill zip successfully', {
      skillName,
      version,
      bytes: buffer.byteLength,
      zipPath
    })
    await fs.writeFile(zipPath, buffer)

    const installed = await skillService.installFromZip({ zipFilePath: zipPath })
    const installedPath = skillService.getSkillDirectory(installed.folderName)
    await fs.writeFile(path.join(installedPath, VERSION_FILE), version, 'utf-8')
    logger.info('Persisted remote builtin skill version marker', {
      skillName,
      folderName: installed.folderName,
      version,
      installedPath
    })

    return installed.folderName
  } finally {
    await fs.rm(zipPath, { force: true }).catch(() => undefined)
  }
}

async function downloadAndCacheQuickSkill(skillName: string, entry: QuickSkillManifestEntry): Promise<void> {
  const downloadUrl = entry.downloadUrl
  const version = entry.version
  const folderName = String(entry.folderName || skillName).trim() || skillName
  if (!downloadUrl || !version) {
    throw new Error(`Remote quick skill entry for ${skillName} is incomplete`)
  }

  logger.info('Downloading remote quick skill zip', {
    skillName,
    version,
    downloadUrl
  })
  const mockPackage = isHomepageOperationsMockEnabled()
  const response = mockPackage ? null : await net.fetch(downloadUrl)
  if (response && !response.ok) {
    throw new Error(`Download failed: HTTP ${response.status}`)
  }

  const quickSkillsRoot = getQuickSkillsRoot()
  const downloadDir = path.join(quickSkillsRoot, QUICK_SKILLS_DOWNLOADS_SUBDIR)
  const extractDir = path.join(quickSkillsRoot, `${QUICK_SKILLS_EXTRACT_PREFIX}${folderName}-${Date.now()}`)
  const zipPath = path.join(downloadDir, `${folderName}-${Date.now()}.zip`)
  const destPath = getQuickSkillDirectory(path.join(folderName, version))

  await fs.mkdir(downloadDir, { recursive: true })
  await fs.mkdir(extractDir, { recursive: true })

  try {
    if (mockPackage) {
      await extractHomepageMockPackage(folderName, downloadUrl, extractDir)
    } else {
      const buffer = Buffer.from(await response!.arrayBuffer())
      await fs.writeFile(zipPath, buffer)
      await extractQuickSkillZip(zipPath, extractDir)
    }

    const extractedSkillPath = path.join(extractDir, folderName)
    await fs.mkdir(path.dirname(destPath), { recursive: true })
    await fs.access(path.join(extractedSkillPath, 'SKILL.md'))
    if (entry.title) {
      const example = JSON.parse(await fs.readFile(path.join(extractedSkillPath, 'example.json'), 'utf-8'))
      if (!String(example?.inputs?.prompt || example?.parameters?.prompt?.default || '').trim()) throw new Error('Template example has no prompt')
    }
    await fs.writeFile(path.join(extractedSkillPath, VERSION_FILE), version, 'utf-8')
    await fs.rm(destPath, { recursive: true, force: true })
    await fs.rename(extractedSkillPath, destPath)

    logger.info('Cached remote quick skill successfully', {
      skillName,
      folderName,
      version,
      destPath
    })
  } finally {
    await fs.rm(zipPath, { force: true }).catch(() => undefined)
    await fs.rm(extractDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function extractQuickSkillZip(zipFilePath: string, destDir: string): Promise<void> {
  const zip = new StreamZip.async({ file: zipFilePath })

  try {
    const entries = await zip.entries()
    let totalSize = 0
    let fileCount = 0

    for (const entry of Object.values(entries)) {
      totalSize += entry.size
      fileCount++
      if (totalSize > MAX_QUICK_SKILL_EXTRACTED_SIZE) {
        throw new Error(`ZIP too large: ${totalSize} bytes exceeds ${MAX_QUICK_SKILL_EXTRACTED_SIZE}`)
      }
      if (fileCount > MAX_QUICK_SKILL_FILES_COUNT) {
        throw new Error(`ZIP has too many files: ${fileCount} exceeds ${MAX_QUICK_SKILL_FILES_COUNT}`)
      }
    }

    await zip.extract(null, destDir)
  } finally {
    await zip.close()
  }
}

async function removeStaleCachedQuickSkills(activeSkillNames: string[]): Promise<void> {
  const storageRoot = getQuickSkillsStorageRoot()
  try {
    const entries = await fs.readdir(storageRoot, { withFileTypes: true })
    const activeSet = new Set(activeSkillNames)
    await Promise.all(entries.map(async (entry) => {
      if (!entry.isDirectory()) return
      if (activeSet.has(entry.name)) return
      await fs.rm(path.join(storageRoot, entry.name), { recursive: true, force: true }).catch(() => undefined)
    }))
  } catch {
    // Ignore cache cleanup failures.
  }
}

async function applyRemoteDeletion(
  skillName: string,
  entry: BuiltinSkillManifestEntry,
  syncState: BuiltinSkillSyncState
): Promise<void> {
  const minAppVersion = entry.minAppVersion
  if (minAppVersion && !isMinAppVersionSatisfied(minAppVersion)) {
    logger.info('Skipping remote builtin skill deletion because minAppVersion is not satisfied', {
      skillName,
      currentAppVersion: app.getVersion(),
      minAppVersion
    })
    return
  }

  const tombstoneVersion = entry.tombstoneVersion ?? entry.version ?? new Date().toISOString()
  const previousTombstone = syncState.skills[skillName]?.tombstoneVersion
  if (previousTombstone && compareVersions(previousTombstone, tombstoneVersion) >= 0) {
    logger.debug('Skipping remote builtin skill deletion because tombstone is already applied', {
      skillName,
      previousTombstone,
      tombstoneVersion
    })
    return
  }

  logger.info('Applying remote builtin skill deletion', {
    skillName,
    tombstoneVersion
  })
  await skillService.uninstallByFolderName(skillName).catch((error) => {
    logger.error('Failed to uninstall builtin skill marked deleted in remote manifest', {
      skillName,
      tombstoneVersion,
      error: error instanceof Error ? error.message : String(error)
    })
  })

  syncState.skills[skillName] = {
    deleted: true,
    deletedAt: new Date().toISOString(),
    tombstoneVersion,
    source: 'remote'
  }
  logger.info('Applied remote builtin skill deletion successfully', {
    skillName,
    tombstoneVersion
  })
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
  return path.join(getGlobalSkillsRoot(), SYNC_STATE_FILE)
}

function getQuickSkillsManifestCachePath(): string {
  return path.join(getQuickSkillsRoot(), MANIFEST_FILE)
}

function getQuickSkillsStorageRoot(): string {
  return path.join(getQuickSkillsRoot(), QUICK_SKILLS_STORAGE_SUBDIR)
}

function getQuickSkillDirectory(skillName: string): string {
  return path.join(getQuickSkillsStorageRoot(), skillName)
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
