import type { Client, Config, Transaction, TransactionMode } from '@libsql/client'
import { randomUUID } from 'node:crypto'
import { Socket } from 'node:net'
import { Worker } from 'node:worker_threads'
import path from 'node:path'
import { databaseIdentity, databaseEndpoint, encodeFrame, FrameDecoder, storageConfiguration, type OverlayStorageOptions } from './brokerProtocol'
import type { StorageManifest } from './persistentRecordStore'

const STARTUP_TIMEOUT_MS = 10000
const CLOSE_TIMEOUT_MS = 5000

async function withTimeout<T>(operation: Promise<T>, message: string): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>
  try {
    return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(message)), CLOSE_TIMEOUT_MS)
    })])
  } finally { clearTimeout(timer) }
}

function reviveInteger(value: any, intMode: Config['intMode']): any {
  if (typeof value !== 'bigint') return value
  if (intMode === 'bigint') return value
  if (intMode === 'string') return value.toString()
  if (value < -9007199254740991n || value > 9007199254740991n) {
    throw new RangeError('Received integer which cannot be safely represented as a JavaScript number')
  }
  return Number(value)
}

function reviveError(data: any): Error {
  const error = new Error(data.message)
  return Object.assign(error, data, data.cause ? { cause: reviveError(data.cause) } : {})
}
function reviveResult(value: any, intMode: Config['intMode']): any {
  if (Array.isArray(value)) return value.map(result => reviveResult(result, intMode))
  if (!value?.columns || !value?.rows) return value
  value.rows = value.rows.map((cells: any[]) => {
    const row: any = {}
    Object.defineProperty(row, 'length', { value: cells.length })
    cells.forEach((rawCell, index) => {
      const cell = reviveInteger(rawCell, intMode)
      Object.defineProperty(row, index, { value: cell })
      if (!Object.prototype.hasOwnProperty.call(row, value.columns[index])) Object.defineProperty(row, value.columns[index], { value: cell, enumerable: true })
    })
    return row
  })
  value.toJSON = () => ({ columns: value.columns, columnTypes: value.columnTypes, rowsAffected: value.rowsAffected,
    lastInsertRowid: value.lastInsertRowid === undefined ? null : value.lastInsertRowid.toString(),
    rows: value.rows.map((row: any) => Array.prototype.map.call(row, (v: any) => typeof v === 'bigint' ? v.toString() : v instanceof ArrayBuffer ? Buffer.from(v).toString('base64') : v)) })
  return value
}

/** A transport only: the broker owns SQL execution, ordering and durable storage. */
export class WorkerDatabaseClient implements Client {
  readonly protocol = 'file'
  get overlayEnabled(): boolean { return this.overlayStorage !== undefined }
  closed = false
  private readonly database: string
  private readonly configuration: string
  private readonly endpoint: { host: string; port: number }
  private readonly ownerToken = randomUUID()
  private worker?: Worker
  private workerExited = false
  private terminating?: Promise<void>
  private socket?: Socket
  private owner = false
  private sequence = 0
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()
  private stopped: Promise<void> = Promise.resolve()
  private readonly ready: Promise<void>
  private failure?: Error
  private rejectFailure!: (error: Error) => void
  private readonly failed = new Promise<never>((_resolve, reject) => { this.rejectFailure = reject })
  private closing?: Promise<void>
  constructor(private config: Config, private workerPath = path.join(__dirname, 'databaseWorker.js'), private onProgress?: (phase: string, count?: number, total?: number, detail?: string) => void, private overlayStorage?: OverlayStorageOptions) {
    this.configuration = storageConfiguration(overlayStorage)
    if (overlayStorage) {
      const { legacyPaths, migrationDir } = JSON.parse(this.configuration)
      this.overlayStorage = { legacyPaths, migrationDir }
    }
    this.database = databaseIdentity(config.url, overlayStorage)
    this.endpoint = databaseEndpoint(this.database)
    this.ready = this.start().catch(error => { this.fail(error); throw error })
    // Construction starts asynchronously; callers observe startup failure through RPC.
    void this.ready.catch(() => undefined)
    void this.failed.catch(() => undefined)
  }
  private connect(): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = new Socket()
      const onError = (error: Error) => { clearTimeout(timer); socket.destroy(); reject(error) }
      const timer = setTimeout(() => socket.destroy(new Error('Database broker connection timed out')), CLOSE_TIMEOUT_MS)
      socket.once('error', onError)
      socket.connect(this.endpoint, () => {
        clearTimeout(timer)
        socket.removeListener('error', onError)
        resolve(socket)
      })
    })
  }
  private async launch(): Promise<void> {
    if (this.closed) throw this.failure
    // The token is passed only to our candidate Worker, and authenticated by hello.
    const worker = new Worker(this.workerPath, {
      workerData: { ...this.config, database: this.database, ownerToken: this.ownerToken, overlayStorage: this.overlayStorage },
      env: { ...process.env, CHATCUT_SQLITE_BUSY_TIMEOUT: '0' }
    })
    this.worker = worker
    if (this.onProgress) {
      const report = (message: any) => {
        if (message?.progress) this.onProgress?.(message.phase, message.count, message.total, message.detail)
      }
      worker.on('message', report)
      worker.once('exit', () => worker.removeListener('message', report))
    }
    this.stopped = new Promise(resolve => worker.once('exit', () => { this.workerExited = true; resolve() }))
    worker.on('error', error => this.fail(error as Error))
    worker.on('exit', code => {
      if (this.owner && !this.closed) this.fail(new Error(`Database worker exited (${code})`))
    })
    await new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>
      const finish = (error?: Error) => {
        clearTimeout(timer)
        worker.removeListener('message', onMessage)
        worker.removeListener('error', onError)
        worker.removeListener('exit', onExit)
        if (error) reject(error)
        else resolve()
      }
      const onMessage = (message: any) => {
        if (message?.error) finish(reviveError(message.error))
        else if (message?.ready === true) {
          this.owner = message.owner === true
          finish()
        } else if (message?.progress) {
          // Synchronous SQLite work may take minutes without yielding another progress message.
          // Once initialization starts, completion/error/exit decides the outcome, not a silence timer.
          clearTimeout(timer)
        }
      }
      const onError = (error: Error) => finish(error)
      // A competing candidate may exit after losing listen without opening storage.
      const onExit = (code: number) => finish(code === 0 ? undefined : new Error(`Database worker exited (${code})`))
      timer = setTimeout(() => finish(new Error('Database broker startup timed out')), STARTUP_TIMEOUT_MS)
      worker.on('message', onMessage)
      worker.once('error', onError)
      worker.once('exit', onExit)
    }).catch(async error => {
      this.fail(error)
      await this.terminateWorker()
      throw error
    })
  }
  private attach(socket: Socket): void {
    this.socket = socket
    const decoder = new FrameDecoder()
    socket.on('error', error => this.fail(error))
    socket.on('end', () => this.fail(new Error('Database broker disconnected')))
    socket.on('close', () => this.fail(new Error('Database broker connection closed')))
    socket.on('data', chunk => {
      try {
        decoder.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk), ({ id, value, error }) => {
          const pending = this.pending.get(id)
          if (!pending) throw new Error('Unexpected database broker reply')
          if (error) {
            const revived = reviveError(error)
            this.pending.delete(id)
            pending.reject(revived)
            this.fail(revived)
          } else {
            const revived = reviveResult(value, this.config.intMode)
            this.pending.delete(id)
            pending.resolve(revived)
          }
        })
      } catch (error) { this.fail(error as Error) }
    })
  }
  private async start(): Promise<void> {
    let socket: Socket
    try { socket = await this.connect() }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ECONNREFUSED') throw error
      await this.launch()
      const deadline = Date.now() + 5000
      while (true) {
        if (this.closed) throw this.failure
        try { socket = await this.connect(); break }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ECONNREFUSED' || Date.now() >= deadline) throw error
          await new Promise(resolve => setTimeout(resolve, 25))
        }
      }
    }
    if (this.closed) { socket.destroy(); throw this.failure }
    this.attach(socket)
    const hello = await this.send('hello', [this.ownerToken, this.configuration])
    this.owner = hello?.owner === true
  }
  private fail(error: Error): void {
    this.failure ??= error
    this.closed = true
    this.rejectFailure(this.failure)
    for (const entry of this.pending.values()) entry.reject(this.failure)
    this.pending.clear()
    this.socket?.destroy()
  }
  private send(method: string, args: any[] = []): Promise<any> {
    if (this.closed) return Promise.reject(this.failure)
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      try {
        this.socket!.write(encodeFrame({ id, database: this.database, method, args }), error => {
          if (error) this.fail(error)
        })
      } catch (error) { this.fail(error as Error) }
    })
  }
  private async rpc(method: string, args: any[] = []): Promise<any> {
    if (this.closed) throw this.failure
    await Promise.race([this.ready, this.failed])
    return this.send(method, args)
  }
  async waitUntilReady(): Promise<void> {
    if (this.closed) throw this.failure
    await Promise.race([this.ready, this.failed])
  }
  execute: Client['execute'] = (...args: any[]) => this.rpc('execute', args)
  batch: Client['batch'] = (...args) => this.rpc('batch', args)
  migrate: Client['migrate'] = (...args) => this.rpc('migrate', args)
  executeMultiple: Client['executeMultiple'] = (...args) => this.rpc('executeMultiple', args)
  applyMigration(version: number, tag: string, sql: string): Promise<any> {
    return this.rpc('applyMigration', [version, tag, sql])
  }
  async finalizeSchema(): Promise<void> {
    await this.rpc('finalizeSchema')
  }
  async backupDatabase(destination: string): Promise<void> {
    await this.ready
    if (!this.owner) throw new Error('Close the other database owner before exporting storage')
    await this.rpc('backup', [this.ownerToken, destination])
  }
  async backupStorage(directory: string): Promise<StorageManifest> {
    await this.waitUntilReady()
    if (!this.owner) throw new Error('Close the other database owner before exporting storage')
    return this.rpc('backupStorage', [this.ownerToken, directory])
  }
  async beginStorageMaintenance(): Promise<void> {
    await this.ready
    if (!this.owner) throw new Error('Close the other database owner before replacing storage')
    await this.rpc('beginMaintenance', [this.ownerToken])
  }
  sync: Client['sync'] = async () => { throw new Error('Append storage does not support sync') }
  async transaction(_mode?: TransactionMode): Promise<Transaction> {
    throw new Error('Append storage does not support transactions')
  }
  close(): void {
    if (this.closed) return
    this.fail(new Error('Database client closed'))
  }
  closeAsync(): Promise<void> {
    return this.closing ??= this.detachAndShutdown()
  }
  private terminateWorker(): Promise<void> {
    if (!this.worker || this.workerExited) return Promise.resolve()
    return this.terminating ??= withTimeout(
      this.worker.terminate().then(() => undefined), 'Database worker termination timed out')
  }
  private async waitForWorker(): Promise<void> {
    if (!this.worker || this.workerExited) return
    try { await withTimeout(this.stopped, 'Database worker exit timed out') }
    catch { await this.terminateWorker() }
  }
  private async detachAndShutdown(): Promise<void> {
    this.close()
    try { await withTimeout(this.ready.catch(() => undefined), 'Database client startup did not stop during close') }
    catch (error) {
      await this.terminateWorker()
      throw error
    }
    const socket = this.socket
    if (socket && !socket.closed) {
      let onClose!: () => void
      try {
        await withTimeout(new Promise<void>(resolve => { onClose = resolve; socket.once('close', onClose) }),
          'Database client detachment timed out')
      } catch (error) {
        await this.terminateWorker()
        throw error
      } finally { socket.removeListener('close', onClose) }
    }
    if (!this.owner) { await this.waitForWorker(); return }
    // A separate authenticated control connection can stop an owner after close().
    // It never resubmits business commands or restores this failed client.
    try {
      const control = await this.connect()
      try {
        await withTimeout(new Promise<void>((resolve, reject) => {
          const decoder = new FrameDecoder()
          const id = ++this.sequence
          control.on('error', reject)
          control.on('end', () => reject(new Error('Database broker disconnected during shutdown')))
          control.on('close', () => reject(new Error('Database broker connection closed during shutdown')))
          control.on('data', chunk => {
            try {
              decoder.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk), reply => {
                if (reply.id !== id) throw new Error('Unexpected database shutdown reply')
                if (reply.error) reject(reviveError(reply.error))
                else resolve()
              })
            } catch (error) { reject(error) }
          })
          control.write(encodeFrame({ id, database: this.database, method: 'shutdown', args: [this.ownerToken] }))
        }), 'Database broker shutdown timed out')
      } finally { control.destroy() }
    } catch (error) {
      await this.terminateWorker()
      if ((error as NodeJS.ErrnoException).code !== 'ECONNREFUSED') throw error
    }
    await this.waitForWorker()
  }
  reconnect(): void { throw new Error('Database reconnect is unsupported; create a new client') }
}
