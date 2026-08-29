import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { loggerService } from '@logger'
import { getDataPath } from '@main/utils'
import { directoryExists } from '@main/utils/file'
import { deleteDirectoryRecursive } from '@main/utils/fileOperations'
import { findAllSkillDirectories, findSkillMdPath, parseSkillMetadata } from '@main/utils/markdownParser'
import { executeCommand, findExecutableInEnv } from '@main/utils/process'
import type {
  InstalledSkill,
  SkillFileNode,
  SkillInstallFromDirectoryOptions,
  SkillInstallFromRemotePackageOptions,
  SkillInstallFromZipOptions,
  SkillInstallOptions,
  SkillToggleOptions
} from '@types'
import { eq, or } from 'drizzle-orm'
import { app, net } from 'electron'
import StreamZip from 'node-stream-zip'

import { BaseService } from '../BaseService'
import { DatabaseManager } from '../database/DatabaseManager'
import { agentsTable, skillsTable, type SkillRow } from '../database/schema'
import {
  getHiddenBuiltinSkillMdPath,
  getHiddenBuiltinSkillPath,
  HIDDEN_SKILL_MARKER_FILE,
  HIDDEN_BUILTIN_SKILL_FOLDERS,
  isHiddenBuiltinSkillFolder
} from './hiddenBuiltinSkills'
import { getGlobalSkillsRoot } from './paths'
import { SkillInstaller } from './SkillInstaller'

const logger = loggerService.withContext('SkillService')

// API base URLs for the 3 search sources
const CLAUDE_PLUGINS_API = 'https://api.claude-plugins.dev'

// ZIP extraction limits
const MAX_EXTRACTED_SIZE = 100 * 1024 * 1024 // 100MB
const MAX_FILES_COUNT = 1000
const MAX_FOLDER_NAME_LENGTH = 80

/**
 * Skill management service.
 *
 * Runtime behavior is filesystem-first:
 * - Global library: `{userData}/Data/GlobalSkills/{folderName}/`
 *
 * We no longer rely on per-workspace skill copies for runtime listing/toggle.
 */
export class SkillService extends BaseService {
  private static instance: SkillService | null = null

  private readonly installer: SkillInstaller
  private registryInitialized = false
  private registryInitializationPromise: Promise<void> | null = null

  private constructor() {
    super()
    this.installer = new SkillInstaller()
    logger.info('SkillService initialized')
  }

  static getInstance(): SkillService {
    if (!SkillService.instance) {
      SkillService.instance = new SkillService()
    }
    return SkillService.instance
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  async initializeRegistry(): Promise<void> {
    await this.ensureSkillRegistryInitialized()
  }

  async registerExistingSkill(folderName: string, source = 'local'): Promise<InstalledSkill | null> {
    await this.ensureSkillRegistryInitialized()
    const skillPath = await this.resolveExistingSkillStoragePath(folderName)
    if (!skillPath) return null
    const metadata = await parseSkillMetadata(skillPath, folderName, 'skills')
    const stat = await fs.promises.stat(skillPath)
    const contentHash = await this.installer.computeContentHash(skillPath).catch(() => '')
    const now = Date.now()
    const localId = await this.upsertSkillRegistryRecord({
      id: null,
      remoteId: null,
      name: metadata.name,
      description: metadata.description ?? null,
      iconUrl: null,
      folderName,
      source,
      sourceUrl: null,
      namespace: null,
      author: metadata.author ?? null,
      tags: metadata.tags ?? [],
      previewVideoUrl: null,
      contentHash,
      isEnabled: true,
      createdAt: Number.isFinite(stat.birthtimeMs) ? Math.floor(stat.birthtimeMs) : now,
      updatedAt: now
    })
    const registered = (await this.list()).find((skill) => skill.id === localId)
    return registered ?? null
  }

  async list(agentId?: string): Promise<InstalledSkill[]> {
    void agentId
    await this.ensureSkillRegistryInitialized()
    return this.listGlobalSkills()
  }

  async listActive(agentId: string): Promise<InstalledSkill[]> {
    void agentId
    await this.ensureSkillRegistryInitialized()
    return this.listGlobalSkills({ isEnabled: true })
  }

  async listActiveInWorkspace(workspace: string): Promise<InstalledSkill[]> {
    void workspace
    await this.ensureSkillRegistryInitialized()
    return this.listGlobalSkills({ isEnabled: true })
  }

  async toggle(options: SkillToggleOptions): Promise<InstalledSkill | null> {
    await this.ensureSkillRegistryInitialized()
    const resolved = await this.resolveExistingSkillStoragePathForName(options.skillId)
    if (!resolved || !(await directoryExists(resolved.skillPath))) return null

    const candidateNames = new Set(this.getCandidateFolderNames(options.skillId))
    candidateNames.add(resolved.folderName)
    const base = (await this.list()).find((s) => (
      candidateNames.has(String(s.folderName || '').trim()) ||
      candidateNames.has(String(s.id || '').trim())
    ))
    if (!base) return null
    await this.writeSkillEnabledState(resolved.folderName, options.isEnabled)
    await this.updateSkillEnabledState(resolved.folderName, options.isEnabled)
    return { ...base, isEnabled: options.isEnabled }
  }

  async initSkillsForAgent(agentId: string, workspace: string | undefined): Promise<void> {
    void workspace
    await this.ensureSkillRegistryInitialized()
    logger.info('Agent skill initialization uses shared global skills only', { agentId })
  }

  async enableForAllAgents(skillId: string, folderName: string): Promise<void> {
    logger.info('Skill is globally visible to all agents', { skillId, folderName })
  }

  async reconcileAgentSkills(_agentId: string, workspace: string): Promise<void> {
    void workspace
  }

  async seedWorkspaceSkillsFromGlobal(workspace: string): Promise<void> {
    logger.info('Workspace skill seeding skipped because skills are shared globally', { workspace })
  }

  async readFile(skillId: string, filename: string): Promise<string | null> {
    const resolved = await this.resolveExistingSkillStoragePathForName(skillId)
    const skillRoot = resolved?.skillPath ?? this.getSkillStoragePath(this.preserveFolderName(skillId))
    const filePath = path.resolve(skillRoot, filename)

    // Prevent path traversal
    if (!filePath.startsWith(skillRoot + path.sep) && filePath !== skillRoot) return null

    try {
      return await fs.promises.readFile(filePath, 'utf-8')
    } catch {
      return null
    }
  }

  async listFiles(skillId: string): Promise<SkillFileNode[]> {
    const resolved = await this.resolveExistingSkillStoragePathForName(skillId)
    const skillRoot = resolved?.skillPath ?? this.getSkillStoragePath(this.preserveFolderName(skillId))
    if (!(await directoryExists(skillRoot))) return []
    try {
      return await this.buildFileTree(skillRoot, skillRoot)
    } catch {
      return []
    }
  }

  async uninstallByFolderName(folderName: string): Promise<void> {
    await this.uninstall(folderName)
  }

  async getByFolderName(name: string): Promise<InstalledSkill | null> {
    await this.ensureSkillRegistryInitialized()
    const candidateNames = new Set(this.getCandidateFolderNames(name))
    const skills = await this.listGlobalSkills()
    return skills.find((s) => candidateNames.has(String(s.folderName || '').trim())) ?? null
  }

  /**
   * Resolve the absolute path a skill with the given name would live at under
   * the global Skills storage root. The name is sanitized using the same rules
   * as installSkillDir, so callers can pre-create the directory and then pass
   * the path to installFromDirectory for in-place registration.
   */
  getSkillDirectory(name: string): string {
    return this.getSkillStoragePath(this.preserveFolderName(name))
  }

  getSkillFolderName(name: string): string {
    return this.preserveFolderName(name)
  }

  async getAgentSkillDirectory(agentId: string, name: string): Promise<string> {
    void agentId
    return this.getSkillDirectory(name)
  }

  async listHiddenBuiltinSkills(): Promise<Array<{
    name: string
    description?: string
    filename: string
    skillMdPath: string
    source: 'global'
  }>> {
    const results: Array<{
      name: string
      description?: string
      filename: string
      skillMdPath: string
      source: 'global'
    }> = []

    for (const folderName of HIDDEN_BUILTIN_SKILL_FOLDERS) {
      const skillPath = getHiddenBuiltinSkillPath(folderName)
      if (!(await directoryExists(skillPath))) continue
      try {
        const metadata = await parseSkillMetadata(skillPath, folderName, 'skills')
        results.push({
          name: metadata.name,
          description: metadata.description,
          filename: folderName,
          skillMdPath: getHiddenBuiltinSkillMdPath(folderName),
          source: 'global'
        })
      } catch {
        // Skip invalid hidden builtin skills.
      }
    }

    return results
  }

  getSkillDirectoryInWorkspace(workspace: string, name: string): string {
    void workspace
    return this.getSkillDirectory(name)
  }

  async getAgentSkillsRoot(agentId: string): Promise<string> {
    void agentId
    return getGlobalSkillsRoot()
  }

  async getActiveSkillByFolderName(agentId: string, name: string): Promise<InstalledSkill | null> {
    const candidateNames = new Set(this.getCandidateFolderNames(name))
    const skills = await this.listActive(agentId)
    return skills.find((skill) => (
      candidateNames.has(String(skill.folderName || '').trim()) ||
      candidateNames.has(String(skill.id || '').trim())
    )) ?? null
  }

  async getActiveSkillByFolderNameInWorkspace(workspace: string, name: string): Promise<InstalledSkill | null> {
    const candidateNames = new Set(this.getCandidateFolderNames(name))
    const skills = await this.listActiveInWorkspace(workspace)
    return skills.find((skill) => (
      candidateNames.has(String(skill.folderName || '').trim()) ||
      candidateNames.has(String(skill.id || '').trim())
    )) ?? null
  }

  async removeAgentLocalSkill(agentId: string, name: string): Promise<void> {
    void agentId
    await this.uninstall(name)
  }

  async removeLocalSkillFromWorkspace(workspace: string, name: string): Promise<void> {
    void workspace
    await this.uninstall(name)
  }

  async enableSkillInWorkspace(skillId: string, workspace: string): Promise<InstalledSkill | null> {
    const resolved = await this.resolveExistingSkillStoragePathForName(skillId)
    const folderName = resolved?.folderName ?? this.preserveFolderName(skillId)
    const sourcePath = resolved?.skillPath ?? this.getSkillStoragePath(folderName)
    if (!(await directoryExists(sourcePath))) return null
    void workspace

    const candidateNames = new Set(this.getCandidateFolderNames(skillId))
    candidateNames.add(folderName)
    const base = (await this.list()).find((s) => (
      candidateNames.has(String(s.folderName || '').trim()) ||
      candidateNames.has(String(s.id || '').trim())
    ))
    return base ? { ...base, isEnabled: true } : null
  }

  async uninstall(skillId: string): Promise<void> {
    await this.ensureSkillRegistryInitialized()
    const registryRow = await this.findSkillRegistryRow(skillId)
    const candidateNames = this.getCandidateFolderNames(skillId)
    if (registryRow?.folder_name) candidateNames.push(registryRow.folder_name)
    for (const folderName of candidateNames) {
      for (const skillPath of this.getSkillStoragePaths(folderName)) {
        await this.installer.uninstall(skillPath).catch(() => undefined)
      }
    }
    const states = await this.readSkillEnabledStates()
    candidateNames.forEach((folderName) => delete states[folderName])
    await this.writeSkillEnabledStates(states)
    const database = await this.getDatabase()
    if (registryRow) {
      await database.delete(skillsTable).where(eq(skillsTable.id, registryRow.id))
    } else {
      for (const folderName of candidateNames) {
        await database.delete(skillsTable).where(eq(skillsTable.folder_name, folderName))
      }
    }
    logger.info('Skill uninstalled (filesystem only)', { skillId, folderNames: candidateNames })
  }

  /**
   * Install from a marketplace installSource handle.
   * Format: "claude-plugins:{owner}/{repo}/{skillName}" or "skills.sh:{owner}/{repo}" or "clawhub:{slug}"
   */
  async install(options: SkillInstallOptions): Promise<InstalledSkill> {
    const { installSource } = options
    const [source, ...rest] = installSource.split(':')
    const identifier = rest.join(':')

    switch (source) {
      case 'claude-plugins':
        return this.installFromClaudePlugins(identifier)
      case 'skills.sh':
        return this.installFromSkillsSh(identifier)
      case 'clawhub':
        return this.installFromClawhub(identifier)
      default:
        throw new Error(`Unknown install source: ${source}`)
    }
  }

  async installFromZip(options: SkillInstallFromZipOptions): Promise<InstalledSkill> {
    const { zipFilePath } = options
    logger.info('Installing skill from ZIP', { zipFilePath })

    await this.validateZipFile(zipFilePath)
    const tempDir = await this.createTempDir('zip-install')

    try {
      await this.extractZip(zipFilePath, tempDir)
      const skillDir = await this.locateSkillDir(tempDir)
      return await this.installSkillDir(skillDir, 'zip', null)
    } finally {
      await this.safeRemoveDirectory(tempDir)
    }
  }

  async installFromRemotePackage(options: SkillInstallFromRemotePackageOptions): Promise<InstalledSkill> {
    const packageUrl = String(options.packageUrl || '').trim()
    if (!packageUrl) throw new Error('Skill package URL is required')
    if (!/^https?:\/\//i.test(packageUrl)) throw new Error('Skill package URL must use HTTP or HTTPS')

    const response = await net.fetch(packageUrl)
    if (!response.ok) {
      throw new Error(`Skill package download failed: HTTP ${response.status}`)
    }

    const tempDir = await this.createTempDir('remote-skill-install')
    const zipPath = path.join(tempDir, 'skill.zip')
    try {
      await fs.promises.writeFile(zipPath, Buffer.from(await response.arrayBuffer()))
      await this.validateZipFile(zipPath)
      const extractDir = path.join(tempDir, 'extracted')
      await fs.promises.mkdir(extractDir, { recursive: true })
      await this.extractZip(zipPath, extractDir)
      const skillDir = await this.locateSkillDir(extractDir)
      return await this.installSkillDir(
        skillDir,
        'marketplace',
        options.sourceUrl ?? packageUrl,
        options.remoteId,
        options.iconUrl ?? null,
        options.previewVideoUrl ?? null
      )
    } finally {
      await this.safeRemoveDirectory(tempDir)
    }
  }

  async updateMetadata(options: { skillId: string; remoteId?: string | null; iconUrl?: string | null }): Promise<InstalledSkill | null> {
    await this.ensureSkillRegistryInitialized()
    const row = await this.findSkillRegistryRow(options.skillId)
    if (!row) return null
    const database = await this.getDatabase()
    await database.update(skillsTable).set({
      remote_id: options.remoteId ?? row.remote_id ?? null,
      icon_url: options.iconUrl ?? row.icon_url ?? null,
      updated_at: Date.now()
    }).where(eq(skillsTable.id, row.id))
    return (await this.list()).find((skill) => skill.id === row.id) ?? null
  }

  async installFromDirectory(options: SkillInstallFromDirectoryOptions): Promise<InstalledSkill> {
    const {
      directoryPath,
      remoteId = null,
      source = 'local',
      sourceUrl = null,
      iconUrl = null,
      previewVideoUrl = null
    } = options
    logger.info('Installing skill from directory', { directoryPath })

    if (!(await directoryExists(directoryPath))) {
      throw new Error(`Directory not found: ${directoryPath}`)
    }

    return this.installSkillDir(directoryPath, source, sourceUrl, remoteId, iconUrl, previewVideoUrl)
  }

  async copyDirectoryToWorkspace(
    directoryPath: string,
    workspace: string,
    options: { sourceSubdir?: string; targetRelativePath?: string; excludeSubdirs?: string[] } = {}
  ): Promise<{
    folderName: string
    targetPath: string
  }> {
    logger.info('Copying skill directory to workspace', { directoryPath, workspace, options })

    if (!(await directoryExists(directoryPath))) {
      throw new Error(`Directory not found: ${directoryPath}`)
    }
    if (!workspace || typeof workspace !== 'string') {
      throw new Error('Invalid workspace')
    }

    const sourceFolderName = path.basename(path.resolve(directoryPath))
    const folderName = sourceFolderName
      .replace(/[/\\]/g, '_')
      .replace(new RegExp(String.fromCharCode(0), 'g'), '')
      .trim()
    if (!folderName) {
      throw new Error('Invalid skill folder name')
    }

    const normalizedSourceSubdir = typeof options.sourceSubdir === 'string' ? options.sourceSubdir.trim() : ''
    const normalizedTargetRelativePath = typeof options.targetRelativePath === 'string' ? options.targetRelativePath.trim() : ''
    const normalizedExcludeSubdirs = Array.isArray(options.excludeSubdirs)
      ? options.excludeSubdirs.map((item) => String(item || '').trim()).filter(Boolean)
      : []

    if (normalizedSourceSubdir) {
      const sourcePath = path.join(directoryPath, normalizedSourceSubdir)
      if (!(await directoryExists(sourcePath))) {
        throw new Error(`Directory not found: ${sourcePath}`)
      }

      const targetPath = normalizedTargetRelativePath
        ? path.join(workspace, normalizedTargetRelativePath)
        : workspace
      await fs.promises.mkdir(targetPath, { recursive: true })

      const entries = await fs.promises.readdir(sourcePath, { withFileTypes: true })
      for (const entry of entries) {
        const sourceEntryPath = path.join(sourcePath, entry.name)
        const targetEntryPath = path.join(targetPath, entry.name)
        await fs.promises.rm(targetEntryPath, { recursive: true, force: true })
        await fs.promises.cp(sourceEntryPath, targetEntryPath, { recursive: true })
      }

      logger.info('Copied skill subdirectory contents to workspace', {
        directoryPath,
        workspace,
        sourcePath,
        targetPath
      })
      return { folderName, targetPath }
    }

    const targetPath = this.getSkillStoragePath(folderName)
    const legacySanitizedTargetPath = this.getSkillStoragePath(this.sanitizeFolderName(folderName))
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true })
    await fs.promises.rm(targetPath, { recursive: true, force: true })
    if (legacySanitizedTargetPath !== targetPath) {
      await fs.promises.rm(legacySanitizedTargetPath, { recursive: true, force: true })
    }
    await fs.promises.cp(directoryPath, targetPath, { recursive: true })

    for (const excludedSubdir of normalizedExcludeSubdirs) {
      await fs.promises.rm(path.join(targetPath, excludedSubdir), { recursive: true, force: true })
    }

    logger.info('Copied skill directory to workspace', {
      directoryPath,
      workspace,
      folderName,
      targetPath,
      excludeSubdirs: normalizedExcludeSubdirs
    })
    return { folderName, targetPath }
  }

  /**
   * List globally shared skills visible to any session.
   */
  async listLocal(
    workdir: string,
    options: { includeHidden?: boolean } = {}
  ): Promise<Array<{ name: string; description?: string; filename: string; path: string; source: 'global' }>> {
    void workdir
    await this.ensureSkillRegistryInitialized()
    const results: Array<{ name: string; description?: string; filename: string; path: string; source: 'global' }> = []
    const skillsDir = getGlobalSkillsRoot()
    const includeHidden = options.includeHidden === true

    try {
      const entries = await fs.promises.readdir(skillsDir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        try {
          const skillPath = path.join(skillsDir, entry.name)
          const stats = await fs.promises.stat(skillPath)
          if (!stats.isDirectory()) continue
          if (!includeHidden && (await this.isSkillHiddenAtPath(skillPath, entry.name))) {
            continue
          }
          const metadata = await parseSkillMetadata(skillPath, entry.name, 'skills')
          results.push({
            name: metadata.name,
            description: metadata.description,
            filename: entry.name,
            path: skillPath,
            source: 'global'
          })
        } catch {
          // No SKILL.md or parse error, skip
        }
      }
    } catch {
      // Data/GlobalSkills doesn't exist
    }

    return results
  }

  // ===========================================================================
  // Symlink management
  // ===========================================================================

  /**
   * Copy a skill directory into `{workspace}/.claude/skills/{folderName}`.
   */
  async linkSkill(folderName: string, workspace: string): Promise<void> {
    void workspace
    const target = (await this.resolveExistingSkillStoragePath(folderName)) ?? this.getSkillStoragePath(folderName)
    if (!(await directoryExists(target))) {
      throw new Error(`Skill not found: ${folderName}`)
    }
  }

  private async isSkillCopyUpToDate(sourcePath: string, destPath: string): Promise<boolean> {
    try {
      const versionFile = '.version'
      const [sourceVersion, destVersion] = await Promise.all([
        fs.promises.readFile(path.join(sourcePath, versionFile), 'utf-8'),
        fs.promises.readFile(path.join(destPath, versionFile), 'utf-8')
      ])

      const source = sourceVersion.trim()
      const dest = destVersion.trim()
      return Boolean(source) && source === dest
    } catch {
      return false
    }
  }

  /**
   * Remove copied skill directory from `{workspace}/.claude/skills/{folderName}`.
   */
  async unlinkSkill(folderName: string, workspace: string): Promise<void> {
    const linkPath = this.getSkillLinkPath(folderName, workspace)
    await fs.promises.rm(linkPath, { recursive: true, force: true }).catch(() => undefined)
  }

  // ===========================================================================
  // Source-specific install flows
  // ===========================================================================

  private async installFromClaudePlugins(identifier: string): Promise<InstalledSkill> {
    // identifier: "owner/repo/directoryPath" e.g. "vercel-labs/agent-skills/skills/react-best-practices"
    const parts = identifier.split('/')
    if (parts.length < 3) {
      throw new Error(`Invalid claude-plugins identifier: ${identifier}`)
    }

    const [owner, repo, ...rest] = parts
    const directoryPath = rest.join('/')
    const repoUrl = `https://github.com/${owner}/${repo}`
    const sourceUrl = `${repoUrl}/tree/main/${directoryPath}`
    const tempDir = await this.createTempDir('claude-plugins')

    try {
      await this.cloneRepository(repoUrl, tempDir)
      const skillName = parts[parts.length - 1]
      const skillDir = await this.resolveSkillDirectory(tempDir, skillName, directoryPath)
      const installed = await this.installSkillDir(skillDir, 'marketplace', sourceUrl)

      // Fire-and-forget install telemetry
      this.reportInstall(owner, repo, skillName).catch((err) => {
        logger.warn('Failed to report install', { error: err instanceof Error ? err.message : String(err) })
      })

      return installed
    } finally {
      await this.safeRemoveDirectory(tempDir)
    }
  }

  private async installFromSkillsSh(identifier: string): Promise<InstalledSkill> {
    // identifier: "owner/repo" or "owner/repo/skill-name"
    const parts = identifier.split('/')
    if (parts.length < 2) {
      throw new Error(`Invalid skills.sh identifier: ${identifier}`)
    }
    logger.info('Installing from skills.sh', { identifier })

    const owner = parts[0]
    const repo = parts[1]
    const skillName = parts.length > 2 ? parts.slice(2).join('/') : null
    const repoUrl = `https://github.com/${owner}/${repo}`
    const tempDir = await this.createTempDir('skills-sh')

    try {
      await this.cloneRepository(repoUrl, tempDir)
      const skillDir = await this.resolveSkillDirectory(tempDir, skillName, null)
      return await this.installSkillDir(skillDir, 'marketplace', repoUrl)
    } finally {
      await this.safeRemoveDirectory(tempDir)
    }
  }

  private async installFromClawhub(slug: string): Promise<InstalledSkill> {
    // Fetch skill detail to get download URL
    const detailUrl = `https://api.clawhub.ai/api/v1/skills/${slug}`
    const detailResp = await net.fetch(detailUrl, {
      headers: { 'User-Agent': 'CherryStudio' }
    })

    if (!detailResp.ok) {
      throw new Error(`clawhub detail failed: HTTP ${detailResp.status}`)
    }

    // Download the skill zip
    const downloadUrl = `https://api.clawhub.ai/api/v1/skills/${slug}/download`
    const downloadResp = await net.fetch(downloadUrl, {
      headers: { 'User-Agent': 'CherryStudio' }
    })

    if (!downloadResp.ok) {
      throw new Error(`clawhub download failed: HTTP ${downloadResp.status}`)
    }

    const tempDir = await this.createTempDir('clawhub')
    const zipPath = path.join(tempDir, 'skill.zip')

    try {
      const buffer = Buffer.from(await downloadResp.arrayBuffer())
      await fs.promises.writeFile(zipPath, buffer)
      const extractDir = path.join(tempDir, 'extracted')
      await fs.promises.mkdir(extractDir, { recursive: true })
      await this.extractZip(zipPath, extractDir)
      const skillDir = await this.locateSkillDir(extractDir)
      return await this.installSkillDir(skillDir, 'marketplace', `https://clawhub.ai/skills/${slug}`)
    } finally {
      await this.safeRemoveDirectory(tempDir)
    }
  }

  // ===========================================================================
  // Core install logic
  // ===========================================================================

  private async installSkillDir(
    skillDir: string,
    source: string,
    sourceUrl: string | null,
    remoteId: string | null = null,
    iconUrl: string | null = null,
    previewVideoUrl: string | null = null
  ): Promise<InstalledSkill> {
    const metadata = await parseSkillMetadata(skillDir, path.basename(skillDir), 'skills')
    const skillsRoot = path.resolve(getGlobalSkillsRoot())
    const isInPlace = path.resolve(path.dirname(skillDir)) === skillsRoot
    const folderName = isInPlace ? path.basename(skillDir) : this.preserveFolderName(metadata.filename)
    const destPath = this.getSkillStoragePath(folderName)
    const legacySanitizedDestPath = this.getSkillStoragePath(this.sanitizeFolderName(folderName))

    await fs.promises.mkdir(path.dirname(destPath), { recursive: true })
    if (legacySanitizedDestPath !== destPath) {
      await fs.promises.rm(legacySanitizedDestPath, { recursive: true, force: true })
    }
    await this.installer.install(skillDir, destPath)
    await this.writeHiddenSkillMarkerIfNeeded(destPath, folderName)
    const stat = await fs.promises.stat(destPath)
    const contentHash = await this.installer.computeContentHash(destPath).catch(() => '')
    const now = Date.now()
    const localId = await this.upsertSkillRegistryRecord({
      id: null,
      remoteId,
      name: metadata.name,
      description: metadata.description ?? null,
      iconUrl,
      previewVideoUrl,
      folderName,
      source,
      sourceUrl,
      namespace: null,
      author: metadata.author ?? null,
      tags: metadata.tags ?? [],
      contentHash,
      isEnabled: true,
      createdAt: Number.isFinite(stat.birthtimeMs) ? Math.floor(stat.birthtimeMs) : now,
      updatedAt: Number.isFinite(stat.mtimeMs) ? Math.floor(stat.mtimeMs) : now
    })
    const skill: InstalledSkill = {
      id: localId,
      remoteId,
      name: metadata.name,
      description: metadata.description ?? null,
      iconUrl,
      previewVideoUrl,
      folderName,
      source,
      sourceUrl,
      namespace: null,
      author: metadata.author ?? null,
      tags: metadata.tags ?? [],
      contentHash,
      isEnabled: true,
      createdAt: Number.isFinite(stat.birthtimeMs) ? Math.floor(stat.birthtimeMs) : now,
      updatedAt: Number.isFinite(stat.mtimeMs) ? Math.floor(stat.mtimeMs) : now
    }

    if (source === 'builtin') {
      await this.enableForAllAgents(skill.id, folderName)
    }

    await this.writeSkillEnabledState(folderName, true)

    logger.info('Skill installed and registered', { id: skill.id, remoteId, name: metadata.name, folderName, source })
    return skill
  }

  // ===========================================================================
  // Git operations
  // ===========================================================================

  private async cloneRepository(repoUrl: string, destDir: string): Promise<void> {
    const gitCommand = (await findExecutableInEnv('git')) ?? 'git'

    const branch = await this.resolveDefaultBranch(gitCommand, repoUrl)
    if (branch) {
      await executeCommand(gitCommand, ['clone', '--depth', '1', '--branch', branch, '--', repoUrl, destDir])
      return
    }

    try {
      await executeCommand(gitCommand, ['clone', '--depth', '1', '--', repoUrl, destDir])
    } catch {
      await executeCommand(gitCommand, ['clone', '--depth', '1', '--branch', 'master', '--', repoUrl, destDir])
    }
  }

  private async resolveDefaultBranch(command: string, repoUrl: string): Promise<string | null> {
    try {
      const output = await executeCommand(command, ['ls-remote', '--symref', '--', repoUrl, 'HEAD'], { capture: true })
      const match = output.match(/ref: refs\/heads\/([^\s]+)/)
      return match?.[1] ?? null
    } catch {
      return null
    }
  }

  // ===========================================================================
  // ZIP operations
  // ===========================================================================

  private async validateZipFile(zipFilePath: string): Promise<void> {
    const stats = await fs.promises.stat(zipFilePath)
    if (!stats.isFile()) {
      throw new Error(`Not a file: ${zipFilePath}`)
    }
    if (!zipFilePath.toLowerCase().endsWith('.zip')) {
      throw new Error(`Not a ZIP file: ${zipFilePath}`)
    }
  }

  private async extractZip(zipFilePath: string, destDir: string): Promise<void> {
    const zip = new StreamZip.async({ file: zipFilePath })

    try {
      const entries = await zip.entries()
      let totalSize = 0
      let fileCount = 0

      for (const entry of Object.values(entries)) {
        totalSize += entry.size
        fileCount++

        if (totalSize > MAX_EXTRACTED_SIZE) {
          throw new Error(`ZIP too large: ${totalSize} bytes exceeds ${MAX_EXTRACTED_SIZE}`)
        }
        if (fileCount > MAX_FILES_COUNT) {
          throw new Error(`ZIP has too many files: ${fileCount} exceeds ${MAX_FILES_COUNT}`)
        }
      }

      await zip.extract(null, destDir)
    } finally {
      await zip.close()
    }
  }

  // ===========================================================================
  // Directory resolution
  // ===========================================================================

  private async locateSkillDir(extractedDir: string): Promise<string> {
    return this.resolveSkillDirectory(extractedDir, null, null)
  }

  private async resolveSkillDirectory(
    repoDir: string,
    skillName: string | null,
    directoryPath: string | null
  ): Promise<string> {
    // 1. Check explicit directory path
    if (directoryPath) {
      const resolved = path.resolve(repoDir, directoryPath)
      const skillMdPath = await findSkillMdPath(resolved)
      if (skillMdPath) return resolved

      // directoryPath didn't resolve — fall through to search.
      // This handles cases where the identifier is a skill name rather than a repo path
      // (e.g. "react-best-practices" vs "skills/react-best-practices").
      logger.debug('SKILL.md not found at directoryPath, falling through to search', { directoryPath })
    }

    // 2. Search for skill directories (only when no explicit path given)
    const candidates = await findAllSkillDirectories(repoDir, repoDir, 8)

    if (skillName) {
      const matched = candidates.find((c) => path.basename(c.folderPath) === skillName)
      if (matched) return matched.folderPath
    }

    if (candidates.length === 1) {
      return candidates[0].folderPath
    }

    if (candidates.length > 1 && skillName) {
      // Bidirectional fuzzy match: registry name may contain or be contained by folder name
      // e.g. skillName="vercel-react-best-practices" vs folder="react-best-practices"
      const lowerName = skillName.toLowerCase()
      const fuzzy = candidates.find((c) => {
        const base = path.basename(c.folderPath).toLowerCase()
        return base.includes(lowerName) || lowerName.includes(base)
      })
      if (fuzzy) return fuzzy.folderPath
    }

    if (candidates.length > 0) {
      logger.warn('resolveSkillDirectory: fallback to first candidate', {
        directoryPath,
        skillName,
        candidateCount: candidates.length,
        selected: candidates[0].folderPath
      })
      return candidates[0].folderPath
    }

    // 3. Check if the directory itself has SKILL.md
    const rootSkill = await findSkillMdPath(repoDir)
    if (rootSkill) return repoDir

    throw new Error(`No skill directory found in ${repoDir}`)
  }

  // ===========================================================================
  // Path helpers
  // ===========================================================================

  private async listGlobalSkills(options: { isEnabled?: boolean } = {}): Promise<InstalledSkill[]> {
    return this.listInstalledSkillsInDirectory(getGlobalSkillsRoot(), {
      source: 'global',
      isEnabled: options.isEnabled
    })
  }

  private async listInstalledSkillsInDirectory(
    root: string,
    options: { source: string; isEnabled?: boolean }
  ): Promise<InstalledSkill[]> {
    await fs.promises.mkdir(root, { recursive: true })
    const enabledStates = await this.readSkillEnabledStates()
    const database = await this.getDatabase()
    const registryRows = await database.select().from(skillsTable)
    const registryByFolder = new Map(registryRows.map((row) => [row.folder_name, row]))
    const entries = await fs.promises.readdir(root, { withFileTypes: true })
    const dirs = entries.filter(
      (entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== '__pycache__'
    )

    const results = await Promise.all(
      dirs.map(async (entry) => {
        const folderName = entry.name
        const skillPath = path.join(root, entry.name)
        try {
          if (await this.isSkillHiddenAtPath(skillPath, folderName)) {
            return null
          }
          const stat = await fs.promises.stat(skillPath)
          const metadata = await parseSkillMetadata(skillPath, folderName, 'skills')
          const contentHash = await this.installer.computeContentHash(skillPath).catch(() => '')
          const registry = registryByFolder.get(folderName)
          return {
            id: registry?.id ?? this.generateLocalSkillId(metadata.name, folderName, new Set(registryRows.map((row) => row.id))),
            remoteId: registry?.remote_id ?? null,
            name: metadata.name,
            description: metadata.description ?? null,
            iconUrl: registry?.icon_url ?? null,
            previewVideoUrl: registry?.preview_video_url ?? null,
            folderName,
            source: registry?.source ?? options.source,
            sourceUrl: registry?.source_url ?? null,
            namespace: registry?.namespace ?? null,
            author: registry?.author ?? metadata.author ?? null,
            tags: this.parseRegistryTags(registry?.tags, metadata.tags ?? []),
            contentHash,
            path: skillPath,
            isEnabled: registry?.is_enabled ?? enabledStates[folderName] ?? options.isEnabled ?? true,
            createdAt: registry?.created_at ?? (Number.isFinite(stat.birthtimeMs) ? Math.floor(stat.birthtimeMs) : Date.now()),
            updatedAt: registry?.updated_at ?? (Number.isFinite(stat.mtimeMs) ? Math.floor(stat.mtimeMs) : Date.now())
          } as InstalledSkill
        } catch (error) {
          logger.warn('Skipping invalid skill directory while listing skills', {
            root,
            folderName: entry.name,
            error: error instanceof Error ? error.message : String(error)
          })
          return null
        }
      })
    )

    return results.filter((item): item is InstalledSkill => (
      Boolean(item) && (options.isEnabled === undefined || item.isEnabled === options.isEnabled)
    ))
  }

  private getSkillEnabledStatePath(): string {
    return path.join(getGlobalSkillsRoot(), '.skill-states.json')
  }

  private async readSkillEnabledStates(): Promise<Record<string, boolean>> {
    try {
      const raw = await fs.promises.readFile(this.getSkillEnabledStatePath(), 'utf-8')
      const parsed = JSON.parse(raw) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
      return Object.fromEntries(
        Object.entries(parsed).filter(([, value]) => typeof value === 'boolean')
      )
    } catch {
      return {}
    }
  }

  private async writeSkillEnabledStates(states: Record<string, boolean>): Promise<void> {
    const statePath = this.getSkillEnabledStatePath()
    await fs.promises.mkdir(path.dirname(statePath), { recursive: true })
    await fs.promises.writeFile(statePath, JSON.stringify(states, null, 2), 'utf-8')
  }

  private async writeSkillEnabledState(folderName: string, isEnabled: boolean): Promise<void> {
    const states = await this.readSkillEnabledStates()
    states[folderName] = isEnabled
    await this.writeSkillEnabledStates(states)
  }

  /**
   * Initialize the local skill registry from the existing GlobalSkills tree.
   * This is deliberately idempotent so it can run on every application start.
   */
  private async ensureSkillRegistryInitialized(): Promise<void> {
    if (this.registryInitialized) return
    if (!this.registryInitializationPromise) {
      this.registryInitializationPromise = this.initializeSkillRegistry()
    }
    try {
      await this.registryInitializationPromise
      this.registryInitialized = true
    } finally {
      this.registryInitializationPromise = null
    }
  }

  private async initializeSkillRegistry(): Promise<void> {
    // Older packaged clients may not contain the latest Drizzle migration
    // resources. Keep the registry self-healing so the new local icon field is
    // available before Drizzle queries the table.
    await this.ensureIconUrlColumn()
    await this.ensurePreviewVideoUrlColumn()
    const database = await this.getDatabase()
    const root = getGlobalSkillsRoot()
    await fs.promises.mkdir(root, { recursive: true })
    const enabledStates = await this.readSkillEnabledStates()
    const existingRows = await database.select().from(skillsTable)
    const rowsByFolder = new Map(existingRows.map((row) => [row.folder_name, row]))
    const usedIds = new Set(existingRows.map((row) => row.id))
    const entries = await fs.promises.readdir(root, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === '__pycache__') continue
      const skillPath = path.join(root, entry.name)
      if (await this.isSkillHiddenAtPath(skillPath, entry.name)) continue

      try {
        const metadata = await parseSkillMetadata(skillPath, entry.name, 'skills')
        const stat = await fs.promises.stat(skillPath)
        const contentHash = await this.installer.computeContentHash(skillPath).catch(() => '')
        const existing = rowsByFolder.get(entry.name)
        const now = Date.now()
        const id = existing?.id ?? this.generateLocalSkillId(metadata.name, entry.name, usedIds)
        usedIds.add(id)
        const values = {
          id,
          remote_id: existing?.remote_id ?? null,
          name: metadata.name,
          description: metadata.description ?? null,
          icon_url: existing?.icon_url ?? null,
          preview_video_url: existing?.preview_video_url ?? null,
          folder_name: entry.name,
          source: existing?.source ?? 'local',
          source_url: existing?.source_url ?? null,
          namespace: existing?.namespace ?? null,
          author: metadata.author ?? existing?.author ?? null,
          tags: JSON.stringify(metadata.tags ?? []),
          content_hash: contentHash,
          is_enabled: existing?.is_enabled ?? enabledStates[entry.name] ?? true,
          created_at: existing?.created_at ?? (Number.isFinite(stat.birthtimeMs) ? Math.floor(stat.birthtimeMs) : now),
          updated_at: now
        }

        if (existing) {
          await database.update(skillsTable).set(values).where(eq(skillsTable.id, existing.id))
        } else {
          await database.insert(skillsTable).values(values)
        }
      } catch (error) {
        logger.warn('Failed to initialize skill registry entry', {
          folderName: entry.name,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    logger.info('Skill registry initialized from GlobalSkills', {
      root,
      registeredCount: Math.max(0, (await database.select().from(skillsTable)).length - existingRows.length)
    })
  }

  private async ensureIconUrlColumn(): Promise<void> {
    const databaseManager = await DatabaseManager.getInstance()
    const client = await databaseManager.getClient()
    const columns = await client.execute("PRAGMA table_info('skills')")
    const hasIconUrl = columns.rows.some((row) => {
      const column = row as Record<string, unknown>
      return String(column.name ?? column[1] ?? '') === 'icon_url'
    })
    if (!hasIconUrl) {
      await client.execute('ALTER TABLE `skills` ADD COLUMN `icon_url` text')
      logger.info('Added missing skills.icon_url column for local registry compatibility')
    }
  }

  private async ensurePreviewVideoUrlColumn(): Promise<void> {
    const databaseManager = await DatabaseManager.getInstance()
    const client = await databaseManager.getClient()
    const columns = await client.execute("PRAGMA table_info('skills')")
    const hasPreviewVideoUrl = columns.rows.some((row) => {
      const column = row as Record<string, unknown>
      return String(column.name ?? column[1] ?? '') === 'preview_video_url'
    })
    if (!hasPreviewVideoUrl) {
      await client.execute('ALTER TABLE `skills` ADD COLUMN `preview_video_url` text')
      logger.info('Added missing skills.preview_video_url column for local registry compatibility')
    }
  }

  private generateLocalSkillId(name: string, folderName: string, usedIds: Set<string>): string {
    const normalizedName = String(name || folderName).trim().normalize('NFKC').toLowerCase()
    let salt = ''
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const candidate = createHash('sha256')
        .update(`${normalizedName}\u0000${salt}`)
        .digest('hex')
        .slice(0, 16)
        .toUpperCase()
      if (!usedIds.has(candidate)) return candidate
      salt = `${folderName}:${attempt + 1}`
    }
    throw new Error(`Unable to generate a unique local skill id for ${name}`)
  }

  private async findSkillRegistryRow(identifier: string): Promise<SkillRow | null> {
    const value = String(identifier || '').trim()
    if (!value) return null
    const database = await this.getDatabase()
    const result = await database
      .select()
      .from(skillsTable)
      .where(or(eq(skillsTable.id, value), eq(skillsTable.remote_id, value), eq(skillsTable.folder_name, value), eq(skillsTable.name, value)))
      .limit(1)
    return result[0] ?? null
  }

  private async upsertSkillRegistryRecord(input: {
    id: string | null
    remoteId: string | null
    name: string
    description: string | null
    iconUrl: string | null
    previewVideoUrl: string | null
    folderName: string
    source: string
    sourceUrl: string | null
    namespace: string | null
    author: string | null
    tags: string[]
    contentHash: string
    isEnabled: boolean
    createdAt: number
    updatedAt: number
  }): Promise<string> {
    const database = await this.getDatabase()
    const existing = await database.select().from(skillsTable).where(eq(skillsTable.folder_name, input.folderName)).limit(1)
    const usedIds = new Set((await database.select({ id: skillsTable.id }).from(skillsTable)).map((row) => row.id))
    const id = existing[0]?.id ?? input.id ?? this.generateLocalSkillId(input.name, input.folderName, usedIds)
    const values = {
      id,
      remote_id: input.remoteId ?? existing[0]?.remote_id ?? null,
      name: input.name,
      description: input.description,
      icon_url: input.iconUrl ?? existing[0]?.icon_url ?? null,
      preview_video_url: input.previewVideoUrl ?? existing[0]?.preview_video_url ?? null,
      folder_name: input.folderName,
      source: input.source,
      source_url: input.sourceUrl,
      namespace: input.namespace,
      author: input.author,
      tags: JSON.stringify(input.tags),
      content_hash: input.contentHash,
      is_enabled: input.isEnabled,
      created_at: existing[0]?.created_at ?? input.createdAt,
      updated_at: input.updatedAt
    }
    if (existing[0]) {
      await database.update(skillsTable).set(values).where(eq(skillsTable.id, existing[0].id))
    } else {
      await database.insert(skillsTable).values(values)
    }
    return id
  }

  private async updateSkillEnabledState(folderName: string, isEnabled: boolean): Promise<void> {
    const database = await this.getDatabase()
    await database.update(skillsTable).set({ is_enabled: isEnabled, updated_at: Date.now() }).where(eq(skillsTable.folder_name, folderName))
  }

  private parseRegistryTags(value: string | null | undefined, fallback: string[]): string[] {
    if (!value) return fallback
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : fallback
    } catch {
      return fallback
    }
  }

  /** Full path to a skill in global storage */
  private getSkillStoragePath(folderName: string): string {
    return this.getSkillStoragePaths(folderName)[0]
  }

  private getSkillStoragePaths(folderName: string): string[] {
    if (isHiddenBuiltinSkillFolder(folderName)) {
      return [getHiddenBuiltinSkillPath(folderName), path.join(getGlobalSkillsRoot(), folderName)]
    }
    return [path.join(getGlobalSkillsRoot(), folderName)]
  }

  private async resolveExistingSkillStoragePathForName(name: string): Promise<{
    folderName: string
    skillPath: string
  } | null> {
    const registryRow = await this.findSkillRegistryRow(name)
    if (registryRow) {
      const registryPath = await this.resolveExistingSkillStoragePath(registryRow.folder_name)
      if (registryPath) {
        return { folderName: registryRow.folder_name, skillPath: registryPath }
      }
    }
    for (const folderName of this.getCandidateFolderNames(name)) {
      const skillPath = await this.resolveExistingSkillStoragePath(folderName)
      if (skillPath) {
        return { folderName, skillPath }
      }
    }
    return null
  }

  private getCandidateFolderNames(name: string): string[] {
    const preserved = this.preserveFolderName(name)
    const sanitized = this.sanitizeFolderName(name)
    return Array.from(new Set([preserved, sanitized].filter(Boolean)))
  }

  private preserveFolderName(folderName: string): string {
    let preserved = folderName.replace(/[/\\]/g, '_')
    preserved = preserved.replace(new RegExp(String.fromCharCode(0), 'g'), '')
    preserved = preserved.trim()

    if (preserved.length > MAX_FOLDER_NAME_LENGTH) {
      preserved = preserved.slice(0, MAX_FOLDER_NAME_LENGTH)
    }

    return preserved
  }

  private async resolveExistingSkillStoragePath(folderName: string): Promise<string | null> {
    for (const candidatePath of this.getSkillStoragePaths(folderName)) {
      if (await directoryExists(candidatePath)) {
        return candidatePath
      }
    }
    return null
  }

  private async isSkillHiddenAtPath(skillPath: string, folderName: string): Promise<boolean> {
    if (isHiddenBuiltinSkillFolder(folderName)) {
      return true
    }
    try {
      await fs.promises.access(path.join(skillPath, HIDDEN_SKILL_MARKER_FILE))
      return true
    } catch {
      return false
    }
  }

  private async writeHiddenSkillMarkerIfNeeded(skillPath: string, folderName: string): Promise<void> {
    if (!isHiddenBuiltinSkillFolder(folderName)) {
      return
    }
    await fs.promises.writeFile(path.join(skillPath, HIDDEN_SKILL_MARKER_FILE), 'hidden\n', 'utf-8')
  }

  /** Symlink location for a given agent workspace: `{workspace}/.claude/skills/{folderName}` */
  private getSkillLinkPath(folderName: string, workspace: string): string {
    return path.join(workspace, '.claude', 'skills', folderName)
  }

  /**
   * Resolve an agent's primary workspace (`accessible_paths[0]`) for symlink
   * operations. Returns `undefined` when the agent has no usable workspace
   * — callers should skip filesystem work in that case.
   */
  private async getAgentWorkspace(agentId: string): Promise<string | undefined> {
    const database = await this.getDatabase()
    const rows = await database
      .select({ accessible_paths: agentsTable.accessible_paths })
      .from(agentsTable)
      .where(eq(agentsTable.id, agentId))
      .limit(1)
    const workspace = this.parseFirstAccessiblePath(rows[0]?.accessible_paths)
    if (!workspace) return undefined
    // Workspace may reference a path from a different machine (e.g. restored backup).
    // Skip if it doesn't exist locally to avoid EACCES on mkdir.
    if (!(await directoryExists(workspace))) return undefined
    return workspace
  }

  private parseFirstAccessiblePath(serialized: string | null | undefined): string | undefined {
    if (!serialized) return undefined
    try {
      const paths = JSON.parse(serialized) as unknown
      if (Array.isArray(paths) && paths.length > 0 && typeof paths[0] === 'string') {
        return paths[0]
      }
    } catch {
      // Fall through
    }
    return undefined
  }

  private sanitizeFolderName(folderName: string): string {
    let sanitized = folderName.replace(/[/\\]/g, '_')
    sanitized = sanitized.replace(new RegExp(String.fromCharCode(0), 'g'), '')
    sanitized = sanitized.replace(/[^a-zA-Z0-9_-]/g, '_')

    if (sanitized.length > MAX_FOLDER_NAME_LENGTH) {
      sanitized = sanitized.slice(0, MAX_FOLDER_NAME_LENGTH)
    }

    return sanitized
  }

  private async createTempDir(prefix: string): Promise<string> {
    const tempDir = path.join(app.getPath('temp'), 'cherry-studio', 'skill-install', `${prefix}-${Date.now()}`)
    await fs.promises.mkdir(tempDir, { recursive: true })
    return tempDir
  }

  private async safeRemoveDirectory(dirPath: string): Promise<void> {
    try {
      await deleteDirectoryRecursive(dirPath)
    } catch (error) {
      logger.warn('Failed to clean up temp directory', {
        dirPath,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  private async buildFileTree(dir: string, root: string): Promise<SkillFileNode[]> {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true })
    const nodes: SkillFileNode[] = []

    // Sort: directories first, then files, alphabetically
    const sorted = entries
      .filter((e) => !e.name.startsWith('.') && e.name !== 'node_modules')
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
        return a.name.localeCompare(b.name)
      })

    for (const entry of sorted) {
      const fullPath = path.join(dir, entry.name)
      const relativePath = path.relative(root, fullPath)

      if (entry.isDirectory()) {
        const children = await this.buildFileTree(fullPath, root)
        nodes.push({ name: entry.name, path: relativePath, type: 'directory', children })
      } else {
        nodes.push({ name: entry.name, path: relativePath, type: 'file' })
      }
    }

    return nodes
  }

  private async reportInstall(owner: string, repo: string, skillName: string): Promise<void> {
    const url = `${CLAUDE_PLUGINS_API}/api/skills/${owner}/${repo}/${skillName}/install`
    await net.fetch(url, { method: 'POST' })
  }
}

export const skillService = SkillService.getInstance()
