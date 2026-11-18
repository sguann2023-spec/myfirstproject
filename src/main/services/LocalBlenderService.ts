import { execFile } from 'node:child_process'
import { constants, promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

import { findExecutableInEnv } from '@main/utils/process'
import { BLENDER_INSTALL_URL } from '@shared/blender'
import type { BlenderPathInfo, BlenderPathInfoOptions } from '@shared/blender'

import { ConfigKeys, configManager } from './ConfigManager'

const VERSION_TIMEOUT_MS = 8000
const SUCCESS_CACHE_MS = 15_000
const NEGATIVE_CACHE_MS = 1000
const MAX_DIRECTORY_ENTRIES = 128
const MAX_VERSIONED_INSTALLS = 12
const MAX_PROBES = 16

interface PathStat {
  isFile(): boolean
  isDirectory(): boolean
}

export interface BlenderVersionProbeOptions {
  shell: false
  windowsHide: true
  timeout: number
  maxBuffer: number
  encoding: 'utf8'
}

export interface LocalBlenderDependencies {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  homeDir: string
  getConfiguredPath(): string | null
  setConfiguredPath(value: string | null): void
  findExecutable(name: string): Promise<string | null>
  stat(value: string): Promise<PathStat>
  access(value: string, mode: number): Promise<void>
  /** A bounded, non-recursive directory listing. */
  readDirectory(value: string, limit: number): Promise<string[]>
  probe(value: string, args: string[], options: BlenderVersionProbeOptions): Promise<{ stdout: string; stderr: string }>
  now(): number
}

async function readDirectory(value: string, limit: number): Promise<string[]> {
  const directory = await fs.opendir(value)
  const entries: string[] = []
  // Breaking the async iterator also closes the directory handle.
  for await (const entry of directory) {
    entries.push(entry.name)
    if (entries.length >= limit) break
  }
  return entries
}

const defaultDependencies: LocalBlenderDependencies = {
  platform: process.platform,
  env: process.env,
  homeDir: homedir(),
  getConfiguredPath: () => configManager.get<string | null>(ConfigKeys.BlenderPath, null),
  setConfiguredPath: (value) => configManager.set(ConfigKeys.BlenderPath, value),
  findExecutable: findExecutableInEnv,
  stat: fs.stat,
  access: fs.access,
  readDirectory,
  probe: (value, args, options) => new Promise((resolve, reject) => {
    execFile(value, args, options, (error, stdout, stderr) => {
      if (error) reject(error)
      else resolve({ stdout, stderr })
    })
  }),
  now: Date.now
}

export class LocalBlenderUnavailableError extends Error {
  readonly status: BlenderPathInfo['status']

  constructor(readonly info: BlenderPathInfo) {
    super(`${info.error || 'Local Blender is unavailable.'} Select a valid Blender executable in Settings, or install Blender from ${info.installUrl}.`)
    this.name = 'LocalBlenderUnavailableError'
    this.status = info.status
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isMissing(error: unknown): boolean {
  return ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException)?.code || '')
}

/** Local-only discovery and validation. Auto-discovered paths are never persisted. */
export class LocalBlenderService {
  private readonly deps: LocalBlenderDependencies
  private readonly paths: typeof path.posix
  private revision = 0
  private settingsRevision = 0
  private observedPath: string | null | undefined
  private cache?: { info: BlenderPathInfo; expires: number; revision: number }
  private pending?: { revision: number; promise: Promise<BlenderPathInfo> }

  constructor(dependencies: Partial<LocalBlenderDependencies> = {}) {
    this.deps = { ...defaultDependencies, ...dependencies }
    this.paths = this.deps.platform === 'win32' ? path.win32 : path.posix
  }

  private invalidate(): void {
    this.revision++
    this.cache = undefined
    this.pending = undefined
  }

  private configuredPath(): string | null {
    const configured = this.deps.getConfiguredPath() ?? null
    if (configured !== this.observedPath) {
      this.observedPath = configured
      this.settingsRevision++
      this.invalidate()
    }
    return configured
  }

  private remember(info: BlenderPathInfo, revision: number): void {
    if (revision !== this.revision) return
    this.cache = {
      info: { ...info },
      revision,
      expires: this.deps.now() + (info.status === 'ready' ? SUCCESS_CACHE_MS : NEGATIVE_CACHE_MS)
    }
  }

  async getPathInfo(options: BlenderPathInfoOptions = {}): Promise<BlenderPathInfo> {
    const configured = this.configuredPath()
    if (options?.force) this.invalidate()
    const revision = this.revision
    if (this.cache?.revision === revision && this.cache.expires > this.deps.now()) return { ...this.cache.info }
    if (this.pending?.revision === revision) return { ...await this.pending.promise }

    const promise = this.detect(configured).then(async (info) => {
      // A slow earlier probe must not replace a newer setting or forced recheck.
      this.configuredPath()
      if (revision !== this.revision) return this.getPathInfo()
      this.remember(info, revision)
      return info
    }).finally(() => {
      if (this.pending?.revision === revision) this.pending = undefined
    })
    this.pending = { revision, promise }
    return { ...await promise }
  }

  /** Returns validation info on failure, preserving the previous saved setting. Null resets to auto detection. */
  async setPath(value: string | null): Promise<BlenderPathInfo> {
    this.configuredPath()
    const settingsRevision = ++this.settingsRevision
    this.invalidate()
    if (value === null) {
      this.deps.setConfiguredPath(null)
      this.observedPath = null
      return this.getPathInfo({ force: true })
    }
    if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
      return this.info(typeof value === 'string' ? value : null, null, 'manual', 'invalid', 'Choose a non-empty absolute Blender executable, application, or installation directory.')
    }
    const configured = value.trim()
    const info = await this.validate(configured, configured, 'manual')
    this.configuredPath()
    if (settingsRevision !== this.settingsRevision) return this.getPathInfo()
    if (info.status !== 'ready') return info
    // Persist only after both filesystem validation and a successful Blender --version probe.
    this.deps.setConfiguredPath(configured)
    this.observedPath = configured
    this.invalidate()
    this.remember(info, this.revision)
    return { ...info }
  }

  async requireExecutable(): Promise<BlenderPathInfo & { path: string; version: string }> {
    // Revalidate at execution time, even when the settings display has a cached success.
    const info = await this.getPathInfo({ force: true })
    if (info.status !== 'ready' || !info.path || !info.version) throw new LocalBlenderUnavailableError(info)
    return { ...info, path: info.path, version: info.version }
  }

  private info(
    configuredPath: string | null,
    executable: string | null,
    source: BlenderPathInfo['source'],
    status: BlenderPathInfo['status'],
    error?: string,
    version: string | null = null
  ): BlenderPathInfo {
    return { configuredPath, path: executable, source, status, version, ...(error ? { error } : {}), installUrl: BLENDER_INSTALL_URL }
  }

  private async normalize(value: string): Promise<string> {
    if (!this.paths.isAbsolute(value) || value.includes('\0')) throw new Error('Blender path must be an absolute local path.')
    const normalizedPath = this.paths.normalize(value)
    const normalized = normalizedPath.length > this.paths.parse(normalizedPath).root.length
      ? normalizedPath.replace(this.deps.platform === 'win32' ? /[\\/]+$/ : /\/+$/, '')
      : normalizedPath
    if (this.deps.platform === 'darwin' && /\.app$/i.test(normalized)) {
      return this.paths.join(normalized, 'Contents', 'MacOS', 'Blender')
    }
    const stat = await this.deps.stat(normalized)
    if (stat.isDirectory()) {
      if (this.deps.platform === 'darwin') {
        for (const executable of [this.paths.join(normalized, 'Blender'), this.paths.join(normalized, 'blender')]) {
          try {
            if ((await this.deps.stat(executable)).isFile()) return executable
          } catch (error) {
            if (!isMissing(error)) throw error
          }
        }
        return this.paths.join(normalized, 'Blender.app', 'Contents', 'MacOS', 'Blender')
      }
      return this.paths.join(normalized, this.deps.platform === 'win32' ? 'blender.exe' : 'blender')
    }
    return normalized
  }

  private async validate(value: string, configured: string | null, source: 'manual' | 'auto'): Promise<BlenderPathInfo> {
    let executable: string | null = null
    try {
      executable = await this.normalize(value)
      const stat = await this.deps.stat(executable)
      if (!stat.isFile()) return this.info(configured, executable, source, 'invalid', 'Blender path is not a regular executable file.')
      if (this.deps.platform === 'win32' && !/\.exe$/i.test(executable)) {
        return this.info(configured, executable, source, 'invalid', 'Select Blender.exe, not a script, shortcut, or command wrapper.')
      }
      await this.deps.access(executable, this.deps.platform === 'win32' ? constants.F_OK : constants.X_OK)
    } catch (error) {
      return this.info(configured, executable, source, 'invalid', `Cannot use Blender path "${value}": ${errorMessage(error)}`)
    }
    try {
      const output = await this.deps.probe(executable, ['--version'], {
        shell: false,
        windowsHide: true,
        timeout: VERSION_TIMEOUT_MS,
        maxBuffer: 256 * 1024,
        encoding: 'utf8'
      })
      const match = `${output.stdout}\n${output.stderr}`.match(/^Blender\s+(\d+\.\d+(?:\.\d+)?(?:[-+][\w.-]+)?)\b/im)
      if (!match) return this.info(configured, executable, source, 'invalid', 'The selected executable did not report a valid Blender version.')
      return this.info(configured, executable, source, 'ready', undefined, match[1])
    } catch (error) {
      return this.info(configured, executable, source, 'error', `Blender --version failed (timeout ${VERSION_TIMEOUT_MS / 1000}s): ${errorMessage(error)}`)
    }
  }

  private async versionedDirectories(root: string, pattern: RegExp): Promise<string[]> {
    try {
      const names = await this.deps.readDirectory(root, MAX_DIRECTORY_ENTRIES)
      return names.slice(0, MAX_DIRECTORY_ENTRIES)
        .filter((name) => pattern.test(name) && name === this.paths.basename(name))
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
        .slice(0, MAX_VERSIONED_INSTALLS)
        .map((name) => this.paths.join(root, name))
    } catch (error) {
      if (isMissing(error)) return []
      throw error
    }
  }

  private async conventionalPaths(onError: (error: unknown) => void): Promise<string[]> {
    const versioned = async (root: string, pattern: RegExp): Promise<string[]> => {
      try {
        return await this.versionedDirectories(root, pattern)
      } catch (error) {
        onError(error)
        return []
      }
    }
    const join = this.paths.join
    const home = this.deps.homeDir
    if (this.deps.platform === 'darwin') {
      const roots = ['/Applications', join(home, 'Applications')]
      const candidates = roots.map((root) => join(root, 'Blender.app'))
      for (const root of roots) {
        const versions = await versioned(root, /^Blender(?:[\s-].*)?\.app$/i)
        candidates.push(...versions)
        const installs = await versioned(root, /^Blender[\s-]+\d[\w. -]*$/i)
        candidates.push(...installs.map((install) => join(install, 'Blender.app')))
      }
      return [...candidates, '/opt/homebrew/bin/blender', '/usr/local/bin/blender']
    }
    if (this.deps.platform === 'win32') {
      const env = this.deps.env
      const roots = [...new Set([
        env.ProgramW6432,
        env.ProgramFiles || 'C:\\Program Files',
        env['ProgramFiles(x86)'],
        env.LOCALAPPDATA || join(home, 'AppData', 'Local'),
        join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'Programs')
      ].filter((root): root is string => Boolean(root)))]
      const candidates: string[] = []
      for (const root of roots) {
        const foundation = join(root, 'Blender Foundation')
        candidates.push(join(foundation, 'Blender', 'blender.exe'))
        const versions = await versioned(foundation, /^Blender[\s-]+\d[\w. -]*$/i)
        candidates.push(...versions.map((install) => join(install, 'blender.exe')))
      }
      return candidates
    }
    if (this.deps.platform === 'linux') {
      return [
        '/usr/bin/blender', '/usr/local/bin/blender', '/snap/bin/blender',
        '/opt/blender/blender', join(home, '.local', 'bin', 'blender'),
        ...await versioned('/opt', /^blender[-\s]+\d[\w.-]*$/i)
          .then((installs) => installs.map((install) => join(install, 'blender')))
      ]
    }
    return []
  }

  private async detect(configured: string | null): Promise<BlenderPathInfo> {
    if (configured !== null) return this.validate(configured, configured, 'manual')
    let failure: BlenderPathInfo | undefined
    const seen = new Set<string>()
    let probes = 0
    const check = async (candidate: string): Promise<BlenderPathInfo | undefined> => {
      const key = this.deps.platform === 'win32' ? candidate.toLowerCase() : candidate
      if (seen.has(key) || probes >= MAX_PROBES) return undefined
      seen.add(key)
      try {
        await this.deps.stat(candidate)
      } catch (error) {
        if (isMissing(error)) return undefined
        failure ??= this.info(null, candidate, 'auto', 'error', `Cannot inspect Blender path: ${errorMessage(error)}`)
        return undefined
      }
      probes++
      const info = await this.validate(candidate, null, 'auto')
      if (info.status === 'ready') return info
      failure ??= info
      return undefined
    }
    try {
      const fromEnv = await this.deps.findExecutable('blender')
      if (fromEnv) {
        const info = await check(fromEnv)
        if (info) return info
      }
    } catch (error) {
      failure = this.info(null, null, null, 'error', `Cannot search PATH for Blender: ${errorMessage(error)}`)
    }
    try {
      const candidates = await this.conventionalPaths((error) => {
        failure ??= this.info(null, null, null, 'error', `Cannot inspect Blender installations: ${errorMessage(error)}`)
      })
      for (const candidate of candidates) {
        const info = await check(candidate)
        if (info) return info
      }
    } catch (error) {
      failure ??= this.info(null, null, null, 'error', `Cannot inspect Blender installations: ${errorMessage(error)}`)
    }
    return failure ?? this.info(null, null, null, 'not-found', 'Local Blender was not found. Install Blender or choose its executable in Settings.')
  }
}

export const localBlenderService = new LocalBlenderService()
