/**
 * @deprecated Scheduled for removal in v2.0.0
 * --------------------------------------------------------------------------
 * ⚠️ NOTICE: V2 DATA&UI REFACTORING (by 0xfullex)
 * --------------------------------------------------------------------------
 * STOP: Feature PRs affecting this file are currently BLOCKED.
 * Only critical bug fixes are accepted during this migration phase.
 *
 * This file is being refactored to v2 standards.
 * Any non-critical changes will conflict with the ongoing work.
 *
 * 🔗 Context & Status:
 * - Contribution Hold: https://github.com/CherryHQ/cherry-studio/issues/10954
 * - v2 Refactor PR   : https://github.com/CherryHQ/cherry-studio/pull/10162
 * --------------------------------------------------------------------------
 */
import { type Client } from '@libsql/client'
import { WorkerDatabaseClient } from './workerClient'
import { loggerService } from '@logger'
import { getResourcePath } from '@main/utils'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import { drizzle } from 'drizzle-orm/libsql'
import { app } from 'electron'
import fs from 'fs'
import path from 'path'

import * as schema from './schema'
import type { OverlayOptions, StorageManifest } from './persistentRecordStore'

interface DatabaseInitializationProgress {
  status: 'idle' | 'initializing' | 'initialized' | 'failed'
  phase: string
  startedAt?: number
  count?: number
  total?: number
  detail?: string
}

/** Restored suites are self-contained. Never use originalPath to reopen live sources. */
export function resolveStorageConfiguration(userData: string, migrationDir: string): { database: string; overlayStorage: OverlayOptions } {
  const data = path.join(userData, 'Data')
  const suite = path.join(data, 'record-storage')
  let directory: fs.Stats | undefined
  try { directory = fs.lstatSync(suite) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (directory) {
    const reject = (): never => { throw new Error('Invalid record storage manifest or unsafe suite path') }
    if (!directory.isDirectory() || directory.isSymbolicLink()) reject()
    const suiteRoot = fs.realpathSync(suite)
    const dataRoot = fs.realpathSync(data)
    if (path.dirname(suiteRoot) !== dataRoot) reject()
    const file = (relative: unknown): string => {
      if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes('\0') || path.posix.isAbsolute(relative) || path.win32.isAbsolute(relative)) return reject()
      const parts = relative.split('/')
      if (parts.some(part => !part || part === '.' || part === '..' || part.includes(':'))) return reject()
      let candidate = suite
      for (const [index, part] of parts.entries()) {
        candidate = path.join(candidate, part)
        const stat = fs.lstatSync(candidate)
        if (stat.isSymbolicLink() || (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())) return reject()
      }
      const resolved = fs.realpathSync(candidate)
      if (!resolved.startsWith(suiteRoot + path.sep)) return reject()
      return resolved
    }
    const manifestFile = file('manifest.json')
    if (fs.statSync(manifestFile).size > 1024 * 1024) reject()
    const manifest: StorageManifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
    if (!manifest || manifest.format !== 'record-overlay-v1' || manifest.database !== 'records.db' || !Array.isArray(manifest.legacyPaths) || !Array.isArray(manifest.sources) || manifest.sources.length !== manifest.legacyPaths.length) reject()
    const seen = new Set<string>()
    const database = file(manifest.database)
    const databaseStat = fs.statSync(database)
    const identities = new Set([`${databaseStat.dev}:${databaseStat.ino}`])
    const legacyPaths = manifest.legacyPaths.map((relative, index) => {
      if (typeof relative !== 'string' || !/^legacy\/[^/]+\.db$/.test(relative) || seen.has(relative) || manifest.sources[index]?.snapshot !== relative || typeof manifest.sources[index]?.originalPath !== 'string') reject()
      seen.add(relative)
      const filename = file(relative)
      const stat = fs.statSync(filename)
      const identity = `${stat.dev}:${stat.ino}`
      if (identities.has(identity)) reject()
      identities.add(identity)
      return filename
    })
    return { database, overlayStorage: { legacyPaths, migrationDir } }
  }
  const legacyPaths = [
    path.join(data, 'agents.db.v2.db'), path.join(data, 'agents.db'),
    path.join(userData, 'agents.db.v2.db'), path.join(userData, 'agents.db')
  ].filter(filename => fs.existsSync(filename))
  return { database: path.join(data, 'records.db'), overlayStorage: { legacyPaths, migrationDir } }
}

const logger = loggerService.withContext('DatabaseManager')

/**
 * Database initialization state
 */
enum InitState {
  INITIALIZING = 'initializing',
  INITIALIZED = 'initialized',
  FAILED = 'failed'
}

/**
 * DatabaseManager - Singleton class for managing libsql database connections
 *
 * Responsibilities:
 * - Single source of truth for database connection
 * - Thread-safe initialization with state management
 * - Automatic migration handling
 * - Safe connection cleanup
 * - Error recovery and retry logic
 * - Windows platform compatibility fixes
 */
export class DatabaseManager {
  private static instance: DatabaseManager | null = null
  private static initializing: Promise<DatabaseManager> | null = null
  private static closing: Promise<void> | null = null
  private static progress: DatabaseInitializationProgress = { status: 'idle', phase: 'opening' }

  public static getInitializationProgress(): DatabaseInitializationProgress {
    return { ...DatabaseManager.progress }
  }

  private static reportProgress(phase: string, count?: number, total?: number, detail?: string): void {
    if (phase === 'overlay-warning') logger.warn('Legacy database unavailable; new conversations remain available', { detail })
    DatabaseManager.progress = { status: 'initializing', startedAt: DatabaseManager.progress.startedAt, phase, count, total, detail }
  }

  private client: WorkerDatabaseClient | null = null
  private db: LibSQLDatabase<typeof schema> | null = null
  private state: InitState = InitState.INITIALIZING

  /**
   * Get the singleton instance (database initialization starts automatically)
   */
  public static async getInstance(): Promise<DatabaseManager> {
    if (DatabaseManager.closing) await DatabaseManager.closing
    if (DatabaseManager.shuttingDown) throw new Error('Database is shutting down')
    if (DatabaseManager.instance) {
      return DatabaseManager.instance
    }

    if (!DatabaseManager.initializing) {
      const instance = new DatabaseManager()
      DatabaseManager.initializing = instance.initialize().then(() => {
        DatabaseManager.instance = instance
        return instance
      }).finally(() => {
        DatabaseManager.initializing = null
      })
    }
    return DatabaseManager.initializing
  }

  /**
   * Perform the actual initialization
   */
  public async initialize(): Promise<void> {
    if (this.state === InitState.INITIALIZED) {
      return
    }

    try {
      DatabaseManager.progress = { status: 'initializing', phase: 'opening', startedAt: Date.now() }
      const { database: dbPath, overlayStorage } = resolveStorageConfiguration(app.getPath('userData'), path.join(getResourcePath(), 'database', 'drizzle'))
      logger.info(`Initializing database at: ${dbPath}`)

      // Ensure database directory exists
      const dbDir = path.dirname(dbPath)
      if (!fs.existsSync(dbDir)) {
        logger.info(`Creating database directory: ${dbDir}`)
        fs.mkdirSync(dbDir, { recursive: true })
      }

      this.client = new WorkerDatabaseClient({
        url: `file:${dbPath}`,
        // intMode: 'number' helps avoid some Windows compatibility issues
        intMode: 'number'
      }, undefined, DatabaseManager.reportProgress, overlayStorage)

      // Create drizzle instance
      this.db = drizzle(this.client, { schema })

      // The worker owns overlay/schema initialization; never migrate legacy sources here.
      await this.client.waitUntilReady()

      this.state = InitState.INITIALIZED
      DatabaseManager.progress = { ...DatabaseManager.progress, status: 'initialized' }
      logger.info('Database initialized successfully')

      // Restart reads committed records. It must not resume unfinished
      // backfills or append crash-repair business records automatically.
    } catch (error) {
      DatabaseManager.progress = { ...DatabaseManager.progress, status: 'failed' }
      const err = error as Error
      logger.error('Database initialization failed:', {
        error: err.message,
        stack: err.stack
      })

      // Clean up failed initialization
      await this.cleanupFailedInit()

      // Set failed state
      this.state = InitState.FAILED
      throw new Error(`Database initialization failed: ${err.message || 'Unknown error'}`)
    }
  }

  /**
   * Clean up after failed initialization
   */
  private async cleanupFailedInit(): Promise<void> {
    if (this.client) {
      try {
        // On Windows, closing a partially initialized client can crash
        // Wrap in try-catch and ignore errors during cleanup
        await this.client.closeAsync()
      } catch (error) {
        logger.warn('Failed to close client during cleanup:', error as Error)
      }
    }
    this.client = null
    this.db = null
  }

  /**
   * Get the database instance
   * Automatically waits for initialization to complete
   * @throws Error if database initialization failed
   */
  public getDatabase(): LibSQLDatabase<typeof schema> {
    return this.db!
  }

  /**
   * Get the raw client (for advanced operations)
   * Automatically waits for initialization to complete
   * @throws Error if database initialization failed
   */
  public async getClient(): Promise<Client> {
    return this.client!
  }

  public backupDatabase(destination: string): Promise<void> {
    return this.client!.backupDatabase(destination)
  }

  public backupStorage(directory: string): Promise<StorageManifest> {
    return this.client!.backupStorage(directory)
  }

  public static async beginStorageMaintenance(): Promise<void> {
    const manager = await DatabaseManager.getInstance()
    // Keep the broker endpoint reserved while files are replaced. Other clients
    // fail closed instead of spawning a writer against partially restored files.
    await manager.client!.beginStorageMaintenance()
  }

  /**
   * Check if database is initialized
   */
  public isInitialized(): boolean {
    return this.state === InitState.INITIALIZED
  }

  /**
   * Close the database connection and reset the singleton.
   * Must be called before replacing storage (e.g. during backup restore).
   * After calling this, getInstance() will re-initialize a fresh connection.
   */
  private static shuttingDown = false

  public static async shutdown(): Promise<void> {
    DatabaseManager.shuttingDown = true
    await DatabaseManager.close()
  }

  public static async close(): Promise<void> {
    if (!DatabaseManager.closing) {
      DatabaseManager.closing = (async () => {
        if (DatabaseManager.initializing) await DatabaseManager.initializing.catch(() => undefined)
        const instance = DatabaseManager.instance
        if (!instance) return
        await instance.client?.closeAsync()
        DatabaseManager.instance = null
        logger.info('Database connection closed')
      })().finally(() => { DatabaseManager.closing = null })
    }
    await DatabaseManager.closing
  }
}
