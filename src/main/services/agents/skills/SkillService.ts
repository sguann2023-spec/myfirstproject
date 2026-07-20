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
  SkillInstallFromZipOptions,
  SkillInstallOptions,
  SkillToggleOptions
} from '@types'
import { eq } from 'drizzle-orm'
import { app, net } from 'electron'
import StreamZip from 'node-stream-zip'

import { BaseService } from '../BaseService'
import { agentsTable } from '../database/schema'
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
 * - Global library: `{dataPath}/Skills/{folderName}/`
 * - Agent runtime: `{agentWorkspace}/.claude/skills/{folderName}/`
 *
 * We no longer rely on skills/agent_skills tables for runtime listing/toggle.
 */
export class SkillService extends BaseService {
  private static instance: SkillService | null = null

  private readonly installer: SkillInstaller

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

  async list(agentId?: string): Promise<InstalledSkill[]> {
    const skills = await this.listGlobalSkills()
    if (!agentId) {
      return skills.map((s) => ({ ...s, isEnabled: false }))
    }

    const workspace = await this.getAgentWorkspace(agentId)
    if (!workspace) return skills.map((s) => ({ ...s, isEnabled: false }))

    const localSkills = await this.listLocal(workspace)
    const enabledFolders = new Set(localSkills.map((s) => this.sanitizeFolderName(s.filename)))
    return skills.map((s) => ({ ...s, isEnabled: enabledFolders.has(s.folderName) }))
  }

  async listActive(agentId: string): Promise<InstalledSkill[]> {
    const workspace = await this.getAgentWorkspace(agentId)
    if (!workspace) return []

    await this.reconcileAgentSkills(agentId, workspace)
    return this.listInstalledSkillsInDirectory(path.join(workspace, '.claude', 'skills'), {
      source: 'agent',
      isEnabled: true
    })
  }

  async listActiveInWorkspace(workspace: string): Promise<InstalledSkill[]> {
    if (!workspace) return []

    await this.reconcileAgentSkills('workspace', workspace)
    return this.listInstalledSkillsInDirectory(path.join(workspace, '.claude', 'skills'), {
      source: 'agent',
      isEnabled: true
    })
  }

  async toggle(options: SkillToggleOptions): Promise<InstalledSkill | null> {
    const folderName = this.sanitizeFolderName(options.skillId)
    const workspace = await this.getAgentWorkspace(options.agentId)
    if (!workspace) return null

    const sourcePath = this.getSkillStoragePath(folderName)
    if (!(await directoryExists(sourcePath))) return null

    if (options.isEnabled) {
      await this.linkSkill(folderName, workspace)
    } else {
      await this.unlinkSkill(folderName, workspace)
    }

    const base = (await this.list()).find((s) => s.folderName === folderName || s.id === folderName)
    return base ? { ...base, isEnabled: options.isEnabled } : null
  }

  async initSkillsForAgent(agentId: string, workspace: string | undefined): Promise<void> {
    if (!workspace) return
    const skills = await this.listGlobalSkills()
    for (const skill of skills) {
      try {
        await this.linkSkill(skill.folderName, workspace)
      } catch (error) {
        logger.warn('Failed to copy skill for new agent', {
          agentId,
          skillId: skill.id,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
    logger.info('Seeded workspace skills for agent', { agentId, count: skills.length })
  }

  async enableForAllAgents(skillId: string, folderName: string): Promise<void> {
    const database = await this.getDatabase()
    const agents = await database
      .select({ id: agentsTable.id, accessible_paths: agentsTable.accessible_paths })
      .from(agentsTable)

    for (const agent of agents) {
      const workspace = this.parseFirstAccessiblePath(agent.accessible_paths)
      if (!workspace || !(await directoryExists(workspace))) continue
      try {
        await this.linkSkill(folderName, workspace)
      } catch (error) {
        logger.warn('Failed to copy skill for agent', {
          agentId: agent.id,
          skillId,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
    logger.info('Enabled skill for all agents (filesystem only)', { skillId, folderName, agentCount: agents.length })
  }

  async reconcileAgentSkills(_agentId: string, workspace: string): Promise<void> {
    if (!workspace) return
    const skillsDir = path.join(workspace, '.claude', 'skills')
    await fs.promises.mkdir(skillsDir, { recursive: true })

    let entries: fs.Dirent[] = []
    try {
      entries = await fs.promises.readdir(skillsDir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const folderName = this.sanitizeFolderName(entry.name)
      const sourcePath = this.getSkillStoragePath(folderName)
      if (!(await directoryExists(sourcePath))) continue

      try {
        await this.linkSkill(folderName, workspace)
      } catch (error) {
        logger.warn('Failed to reconcile workspace skill copy', {
          folderName,
          workspace,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
  }

  async seedWorkspaceSkillsFromGlobal(workspace: string): Promise<void> {
    if (!workspace) return
    const skills = await this.listGlobalSkills()
    for (const skill of skills) {
      try {
        await this.linkSkill(skill.folderName, workspace)
      } catch (error) {
        logger.warn('Failed to seed workspace skill from global cache', {
          workspace,
          skillId: skill.id,
          folderName: skill.folderName,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
    logger.info('Seeded workspace skills from global cache', { workspace, count: skills.length })
  }

  async readFile(skillId: string, filename: string): Promise<string | null> {
    const folderName = this.sanitizeFolderName(skillId)
    const skillRoot = this.getSkillStoragePath(folderName)
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
    const folderName = this.sanitizeFolderName(skillId)
    const skillRoot = this.getSkillStoragePath(folderName)
    if (!(await directoryExists(skillRoot))) return []
    try {
      return await this.buildFileTree(skillRoot, skillRoot)
    } catch {
      return []
    }
  }

  async uninstallByFolderName(folderName: string): Promise<void> {
    await this.uninstall(this.sanitizeFolderName(folderName))
  }

  async getByFolderName(name: string): Promise<InstalledSkill | null> {
    const folderName = this.sanitizeFolderName(name)
    const skills = await this.listGlobalSkills()
    return skills.find((s) => s.folderName === folderName) ?? null
  }

  /**
   * Resolve the absolute path a skill with the given name would live at under
   * the global Skills storage root. The name is sanitized using the same rules
   * as installSkillDir, so callers can pre-create the directory and then pass
   * the path to installFromDirectory for in-place registration.
   */
  getSkillDirectory(name: string): string {
    return this.getSkillStoragePath(this.sanitizeFolderName(name))
  }

  getSkillFolderName(name: string): string {
    return this.sanitizeFolderName(name)
  }

  async getAgentSkillDirectory(agentId: string, name: string): Promise<string> {
    const root = await this.getAgentSkillsRoot(agentId)
    return path.join(root, this.sanitizeFolderName(name))
  }

  getSkillDirectoryInWorkspace(workspace: string, name: string): string {
    return path.join(workspace, '.claude', 'skills', this.sanitizeFolderName(name))
  }

  async getAgentSkillsRoot(agentId: string): Promise<string> {
    const workspace = await this.getAgentWorkspace(agentId)
    if (!workspace) {
      throw new Error(`Agent workspace not found for "${agentId}"`)
    }
    return path.join(workspace, '.claude', 'skills')
  }

  async getActiveSkillByFolderName(agentId: string, name: string): Promise<InstalledSkill | null> {
    const folderName = this.sanitizeFolderName(name)
    const skills = await this.listActive(agentId)
    return skills.find((skill) => skill.folderName === folderName || skill.id === folderName) ?? null
  }

  async getActiveSkillByFolderNameInWorkspace(workspace: string, name: string): Promise<InstalledSkill | null> {
    const folderName = this.sanitizeFolderName(name)
    const skills = await this.listActiveInWorkspace(workspace)
    return skills.find((skill) => skill.folderName === folderName || skill.id === folderName) ?? null
  }

  async removeAgentLocalSkill(agentId: string, name: string): Promise<void> {
    const workspace = await this.getAgentWorkspace(agentId)
    if (!workspace) {
      throw new Error(`Agent workspace not found for "${agentId}"`)
    }
    await this.unlinkSkill(this.sanitizeFolderName(name), workspace)
  }

  async removeLocalSkillFromWorkspace(workspace: string, name: string): Promise<void> {
    await this.unlinkSkill(this.sanitizeFolderName(name), workspace)
  }

  async enableSkillInWorkspace(skillId: string, workspace: string): Promise<InstalledSkill | null> {
    const folderName = this.sanitizeFolderName(skillId)
    const sourcePath = this.getSkillStoragePath(folderName)
    if (!(await directoryExists(sourcePath))) return null

    await this.linkSkill(folderName, workspace)

    const base = (await this.list()).find((s) => s.folderName === folderName || s.id === folderName)
    return base ? { ...base, isEnabled: true } : null
  }

  async uninstall(skillId: string): Promise<void> {
    const folderName = this.sanitizeFolderName(skillId)
    const database = await this.getDatabase()
    const agents = await database
      .select({ id: agentsTable.id, accessible_paths: agentsTable.accessible_paths })
      .from(agentsTable)
    for (const agent of agents) {
      const workspace = this.parseFirstAccessiblePath(agent.accessible_paths)
      if (!workspace || !(await directoryExists(workspace))) continue
      await this.unlinkSkill(folderName, workspace).catch(() => undefined)
    }

    const skillPath = this.getSkillStoragePath(folderName)
    await this.installer.uninstall(skillPath)
    logger.info('Skill uninstalled (filesystem only)', { skillId, folderName })
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

  async installFromDirectory(options: SkillInstallFromDirectoryOptions): Promise<InstalledSkill> {
    const { directoryPath } = options
    logger.info('Installing skill from directory', { directoryPath })

    if (!(await directoryExists(directoryPath))) {
      throw new Error(`Directory not found: ${directoryPath}`)
    }

    return this.installSkillDir(directoryPath, 'local', null)
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

    const targetPath = path.join(workspace, '.claude', 'skills', folderName)
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true })
    await fs.promises.rm(targetPath, { recursive: true, force: true })
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
   * List local skills from an agent workdir's .claude/skills/ directory.
   */
  async listLocal(workdir: string): Promise<Array<{ name: string; description?: string; filename: string }>> {
    const results: Array<{ name: string; description?: string; filename: string }> = []
    const skillsDir = path.join(workdir, '.claude', 'skills')

    try {
      const entries = await fs.promises.readdir(skillsDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue
        try {
          const skillPath = path.join(skillsDir, entry.name)
          const metadata = await parseSkillMetadata(skillPath, entry.name, 'skills')
          results.push({ name: metadata.name, description: metadata.description, filename: entry.name })
        } catch {
          // No SKILL.md or parse error, skip
        }
      }
    } catch {
      // .claude/skills/ doesn't exist
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
    const target = this.getSkillStoragePath(folderName)
    const linkPath = this.getSkillLinkPath(folderName, workspace)

    try {
      // Idempotent fast-path: if copied skill already exists and version is unchanged, skip rm+cp.
      if ((await directoryExists(linkPath)) && (await this.isSkillCopyUpToDate(target, linkPath))) {
        logger.info('Skill copy skipped (up-to-date)', { folderName, target, linkPath })
        return
      }

      await fs.promises.mkdir(path.dirname(linkPath), { recursive: true })
      await fs.promises.rm(linkPath, { recursive: true, force: true })
      await fs.promises.cp(target, linkPath, { recursive: true })
      logger.info('Skill copied to workspace', { folderName, target, linkPath })
    } catch (error) {
      logger.error('Failed to copy skill to workspace', {
        folderName,
        linkPath,
        error: error instanceof Error ? error.message : String(error)
      })
      throw error
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
    try {
      await fs.promises.rm(linkPath, { recursive: true, force: true })
      logger.info('Skill removed from workspace', { folderName, linkPath })
    } catch (error) {
      logger.error('Failed to remove workspace skill', {
        folderName,
        linkPath,
        error: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
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

  private async installSkillDir(skillDir: string, source: string, sourceUrl: string | null): Promise<InstalledSkill> {
    const metadata = await parseSkillMetadata(skillDir, path.basename(skillDir), 'skills')
    const skillsRoot = path.resolve(getDataPath('Skills'))
    const isInPlace = path.resolve(path.dirname(skillDir)) === skillsRoot
    const folderName = isInPlace ? path.basename(skillDir) : this.sanitizeFolderName(metadata.filename)
    const destPath = this.getSkillStoragePath(folderName)

    await fs.promises.mkdir(path.dirname(destPath), { recursive: true })
    await this.installer.install(skillDir, destPath)
    const stat = await fs.promises.stat(destPath)
    const contentHash = await this.installer.computeContentHash(destPath).catch(() => '')
    const now = Date.now()
    const skill: InstalledSkill = {
      id: folderName,
      name: metadata.name,
      description: metadata.description ?? null,
      folderName,
      source,
      sourceUrl,
      namespace: null,
      author: metadata.author ?? null,
      tags: metadata.tags ?? [],
      contentHash,
      isEnabled: false,
      createdAt: Number.isFinite(stat.birthtimeMs) ? Math.floor(stat.birthtimeMs) : now,
      updatedAt: Number.isFinite(stat.mtimeMs) ? Math.floor(stat.mtimeMs) : now
    }

    if (source === 'builtin') {
      await this.enableForAllAgents(skill.id, folderName)
    }

    logger.info('Skill installed (filesystem only)', { id: skill.id, name: metadata.name, folderName, source })
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

  private async listGlobalSkills(): Promise<InstalledSkill[]> {
    return this.listInstalledSkillsInDirectory(getDataPath('Skills'), { source: 'local', isEnabled: false })
  }

  private async listInstalledSkillsInDirectory(
    root: string,
    options: { source: string; isEnabled: boolean }
  ): Promise<InstalledSkill[]> {
    await fs.promises.mkdir(root, { recursive: true })
    const entries = await fs.promises.readdir(root, { withFileTypes: true })
    const dirs = entries.filter(
      (entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== '__pycache__'
    )

    const results = await Promise.all(
      dirs.map(async (entry) => {
        const folderName = this.sanitizeFolderName(entry.name)
        const skillPath = path.join(root, entry.name)
        try {
          const stat = await fs.promises.stat(skillPath)
          const metadata = await parseSkillMetadata(skillPath, folderName, 'skills')
          const contentHash = await this.installer.computeContentHash(skillPath).catch(() => '')
          return {
            id: folderName,
            name: metadata.name,
            description: metadata.description ?? null,
            folderName,
            source: options.source,
            sourceUrl: null,
            namespace: null,
            author: metadata.author ?? null,
            tags: metadata.tags ?? [],
            contentHash,
            isEnabled: options.isEnabled,
            createdAt: Number.isFinite(stat.birthtimeMs) ? Math.floor(stat.birthtimeMs) : Date.now(),
            updatedAt: Number.isFinite(stat.mtimeMs) ? Math.floor(stat.mtimeMs) : Date.now()
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

    return results.filter((item): item is InstalledSkill => Boolean(item))
  }

  /** Full path to a skill in global storage */
  private getSkillStoragePath(folderName: string): string {
    return path.join(getDataPath('Skills'), folderName)
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
