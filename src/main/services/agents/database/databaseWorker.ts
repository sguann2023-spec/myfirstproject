import { parentPort, workerData } from 'node:worker_threads'
import { createServer, type Socket } from 'node:net'
import { PersistentRecordStore } from './persistentRecordStore'
import { databaseEndpoint, encodeFrame, FrameDecoder, storageConfiguration } from './brokerProtocol'

const database: string = workerData.database
const ownerToken: string = workerData.ownerToken
const configuration = storageConfiguration(workerData.overlayStorage)
const sockets = new Set<Socket>()
const configuredSockets = new WeakSet<Socket>()
let store: PersistentRecordStore | undefined
let startupFailure: Error | undefined
let stopping = false
let maintenance = false
const queue: Array<{ socket: Socket; request: any }> = []
let draining = false

function errorData(error: any): any {
  return error && { name: error.name, message: error.message ?? String(error), stack: error.stack, code: error.code, rawCode: error.rawCode, cause: error.cause ? errorData(error.cause) : undefined }
}

function reply(socket: Socket, id: number, value?: unknown, error?: unknown): void {
  if (!socket.destroyed) socket.write(encodeFrame({ id, value, error: errorData(error) }))
}

function stopBroker(): void {
  stopping = true
  store?.close()
  for (const socket of sockets) {
    socket.end()
    const timer = setTimeout(() => socket.destroy(), 1000)
    timer.unref()
    socket.once('close', () => clearTimeout(timer))
  }
  server.close(() => parentPort?.close())
}

// Queue ownership spans one statement only. No BEGIN, mutex or transaction handle.
async function drain(): Promise<void> {
  if (draining || (!store && !startupFailure)) return
  draining = true
  try {
    while (queue.length) {
      const { socket, request } = queue.shift()!
      const { id, method, args = [] } = request
      try {
        if (request.database !== database) throw new Error('Database broker endpoint identity mismatch')
        if (startupFailure) throw startupFailure
        if (stopping) throw new Error('Database broker is shutting down')
        if (maintenance && method !== 'shutdown' && method !== 'beginMaintenance') throw new Error('Database broker is offline for storage replacement')
        if (method !== 'hello' && method !== 'shutdown' && !configuredSockets.has(socket)) throw new Error('Database broker requires a configuration hello')
        let value: unknown
        switch (method) {
          case 'hello':
            if (args[1] !== configuration) {
              configuredSockets.delete(socket)
              throw new Error('Database broker storage configuration mismatch')
            }
            configuredSockets.add(socket)
            value = { owner: args[0] === ownerToken }
            break
          case 'execute': value = store!.execute(args[0], args[1]); break
          case 'executeMultiple': store!.executeMultiple(args[0]); break
          case 'batch': case 'migrate': value = store!.batch(args[0]); break
          case 'applyMigration': store!.applyMigration(args[0], args[1], args[2]); break
          case 'finalizeSchema': store!.finalizeSchema(); break
          case 'backup':
            if (args[0] !== ownerToken) throw new Error('Only the broker owner can export storage')
            await store!.backup(args[1])
            break
          case 'backupStorage':
            if (args[0] !== ownerToken) throw new Error('Only the broker owner can export storage')
            value = await store!.backupStorage(args[1])
            break
          case 'beginMaintenance':
            if (args[0] !== ownerToken) throw new Error('Only the broker owner can replace storage')
            store!.close()
            maintenance = true
            break
          case 'shutdown':
            if (args[0] !== ownerToken) throw new Error('Only the broker owner can shut it down')
            reply(socket, id)
            stopBroker()
            continue
          default: throw new Error(`Unsupported append broker method: ${method}`)
        }
        reply(socket, id, value)
      } catch (error) {
        reply(socket, id, undefined, error)
      }
    }
  } finally {
    draining = false
  }
}

const server = createServer(socket => {
  sockets.add(socket)
  const decoder = new FrameDecoder()
  socket.on('error', () => socket.destroy())
  socket.on('close', () => sockets.delete(socket))
  socket.on('data', chunk => {
    try {
      decoder.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk), request => {
        queue.push({ socket, request })
        drain()
      })
    } catch { socket.destroy() }
  })
})

server.on('error', error => {
  if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE' && !store) {
    // Losing candidates never open the writable append file.
    parentPort?.postMessage({ ready: true, owner: false })
    parentPort?.close()
  } else {
    parentPort?.postMessage({ error: errorData(error) })
    store?.close()
    for (const socket of sockets) socket.destroy()
    server.close(() => parentPort?.close())
  }
})

server.listen(databaseEndpoint(database), async () => {
  try {
    // Result representation belongs to each client, never to durable recovery.
    parentPort?.postMessage({ progress: true, phase: 'opening' })
    const progress = (phase: string, count?: number, total?: number, detail?: string) => parentPort?.postMessage({ progress: true, phase, count, total, detail })
    store = workerData.overlayStorage
      ? await PersistentRecordStore.openOverlay(database, 'bigint', progress, workerData.overlayStorage)
      : await PersistentRecordStore.open(database, 'bigint', progress)
    console.info('[PersistentRecordStore] Database ready', store.startup)
    parentPort?.postMessage({ ready: true, owner: true })
    drain()
  } catch (error) {
    startupFailure = error instanceof Error ? error : new Error(String(error))
    parentPort?.postMessage({ error: errorData(error) })
    drain()
    stopBroker()
  }
})
