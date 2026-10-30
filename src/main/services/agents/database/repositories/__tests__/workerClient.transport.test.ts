import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { createServer, Socket, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { databaseEndpoint, databaseIdentity, encodeFrame, FrameDecoder, storageConfiguration } from '../../brokerProtocol'
import { WorkerDatabaseClient } from '../../workerClient'
import type { Config } from '@libsql/client'

const startup = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:worker_threads', () => ({
  Worker: vi.fn(function (filename: string, options: any) { return startup.spawn(filename, options) })
}))

type Request = { id: number; database: string; method: string; args: any[] }
type Handler = (request: Request, socket: Socket) => void
const clients: WorkerDatabaseClient[] = []
const brokers: Broker[] = []
const result = {
  columns: ['id', 'data', 'length'], columnTypes: ['INTEGER', 'BLOB', 'TEXT'],
  rows: [[9223372036854775806n, new Uint8Array([1, 2]).buffer, 'column']],
  rowsAffected: 1, lastInsertRowid: 9223372036854775806n
}

function candidate(): EventEmitter & { terminate: ReturnType<typeof vi.fn> } {
  const worker = Object.assign(new EventEmitter(), { terminate: vi.fn() })
  worker.terminate.mockImplementation(async () => { worker.emit('exit', 1); return 1 })
  return worker
}

class Broker {
  readonly server: Server
  readonly sockets = new Set<Socket>()
  readonly requests: Request[] = []
  connections = 0
  worker?: EventEmitter
  handler?: Handler
  shutdownHandler?: Handler
  constructor(readonly database: string, readonly token?: string) {
    this.server = createServer(socket => {
      this.connections++
      this.sockets.add(socket)
      socket.on('error', () => undefined)
      socket.on('close', () => this.sockets.delete(socket))
      const decoder = new FrameDecoder()
      socket.on('data', chunk => decoder.push(Buffer.from(chunk), request => {
        this.requests.push(request)
        if (request.database !== this.database) {
          this.reply(socket, request, undefined, { message: 'Database identity mismatch' })
        } else if (request.method === 'hello') {
          this.reply(socket, request, { owner: !!this.token && request.args[0] === this.token })
        } else if (request.method === 'shutdown') {
          if (request.args[0] !== this.token) {
            this.reply(socket, request, undefined, { message: 'Shutdown is owner-only' })
            return
          }
          if (this.shutdownHandler) { this.shutdownHandler(request, socket); return }
          this.reply(socket, request)
          socket.end()
          for (const peer of this.sockets) if (peer !== socket) peer.end()
          this.server.close(() => this.worker?.emit('exit', 0))
        } else if (this.handler) this.handler(request, socket)
        else this.reply(socket, request, request.method === 'batch' || request.method === 'migrate' ? [result] : result)
      }))
    })
    brokers.push(this)
  }
  listen(endpoint = databaseEndpoint(this.database)): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(endpoint, () => { this.server.removeListener('error', reject); resolve() })
    })
  }
  reply(socket: Socket, request: Request, value?: any, error?: any): void {
    socket.write(encodeFrame({ id: request.id, value, error }))
  }
  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.destroy()
    if (this.server.listening) await new Promise<void>(resolve => this.server.close(() => resolve()))
  }
}

const usedPorts = new Set<number>()
function url(): string {
  // Avoid the OS ephemeral range used by this suite's outbound TCP sockets.
  while (true) {
    const value = `file:${path.join(tmpdir(), `transport-${randomUUID()}.db`)}`
    const { port } = databaseEndpoint(databaseIdentity(value))
    if (port >= 20000 && port < 30000 && !usedPorts.has(port)) {
      usedPorts.add(port)
      return value
    }
  }
}
function open(databaseUrl: string, intMode: Config['intMode'] = 'bigint'): WorkerDatabaseClient {
  const client = new WorkerDatabaseClient({ url: databaseUrl, intMode }, '/test/databaseWorker.js')
  clients.push(client)
  return client
}
async function listening(databaseUrl = url()): Promise<{ broker: Broker; client: WorkerDatabaseClient }> {
  const broker = new Broker(databaseIdentity(databaseUrl))
  await broker.listen()
  return { broker, client: open(databaseUrl) }
}
beforeEach(() => {
  startup.spawn.mockReset()
  startup.spawn.mockImplementation((_filename, { workerData }) => {
    const worker = candidate()
    const broker = new Broker(workerData.database, workerData.ownerToken)
    broker.worker = worker
    void broker.listen().then(() => worker.emit('message', { ready: true, owner: true }), error => {
      if (error.code === 'EADDRINUSE') worker.emit('exit', 0)
      else worker.emit('error', error)
    })
    return worker
  })
})
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(clients.splice(0).map(client => client.closeAsync().catch(() => undefined)))
  await Promise.all(brokers.splice(0).map(broker => broker.stop()))
})

it('shares an existing canonical-path broker without starting a Worker', async () => {
  const databaseUrl = url()
  const { broker, client } = await listening(databaseUrl)
  const other = open(`file:${path.dirname(databaseUrl.slice(5))}/./${path.basename(databaseUrl)}`)
  await Promise.all([client.execute('SELECT 1'), other.execute('SELECT 2')])
  expect(startup.spawn).not.toHaveBeenCalled()
  expect(broker.connections).toBe(2)
  expect(broker.requests.map(request => request.database)).toEqual(Array(4).fill(broker.database))
  await client.closeAsync()
  expect(broker.requests.some(request => request.method === 'shutdown')).toBe(false)
  await expect(other.execute('SELECT 3')).resolves.toMatchObject({ rowsAffected: 1 })
})

it('starts only after connection refusal, waits for ready, and authenticates owner shutdown', async () => {
  const client = open(url())
  await client.execute('SELECT 1')
  expect(startup.spawn).toHaveBeenCalledTimes(1)
  const broker = brokers[0]
  expect(broker.requests[0]).toMatchObject({ method: 'hello', args: [broker.token, storageConfiguration()] })
  client.close()
  expect(broker.requests.some(request => request.method === 'shutdown')).toBe(false)
  await client.closeAsync()
  expect(broker.requests[broker.requests.length - 1]).toMatchObject({ method: 'shutdown', args: [broker.token], database: broker.database })
  expect(broker.server.listening).toBe(false)
  expect(client.closeAsync()).toBe(client.closeAsync())
})

it('passes overlay storage to the Worker and authenticates directory backup RPC', async () => {
  const overlayStorage = { legacyPaths: ['/data/agents.db.v2.db', '/data/agents.db'], migrationDir: '/resources/database/drizzle' }
  const client = new WorkerDatabaseClient({ url: url(), intMode: 'number' }, '/test/databaseWorker.js', undefined, overlayStorage)
  clients.push(client)
  await client.waitUntilReady()
  expect(startup.spawn.mock.calls[0][1].workerData.overlayStorage).toEqual(overlayStorage)
  expect(brokers[0].requests.map(request => request.method)).toEqual(['hello'])
  const manifest = { format: 'record-overlay-v1', database: 'records.db', legacyPaths: [], sources: [] }
  brokers[0].handler = (request, socket) => brokers[0].reply(socket, request, manifest)
  expect(await client.backupStorage('/backup')).toEqual(manifest)
  expect(brokers[0].requests[0].args[1]).toBe(storageConfiguration(overlayStorage))
  expect(brokers[0].requests[1]).toMatchObject({ method: 'backupStorage', args: [brokers[0].token, '/backup'] })
})

it('keeps the default Worker storage mode for legacy callers', async () => {
  const client = open(url())
  await client.waitUntilReady()
  expect(startup.spawn.mock.calls[0][1].workerData.overlayStorage).toBeUndefined()
})

it('rejects directory backups from non-owners without sending backup RPC', async () => {
  const { broker, client } = await listening()
  await expect(client.backupStorage('/backup')).rejects.toThrow('other database owner')
  expect(broker.requests.map(request => request.method)).toEqual(['hello'])
})

it('concurrent startup candidates share the listen winner, not independent writers', async () => {
  const databaseUrl = url()
  const first = open(databaseUrl)
  const second = open(databaseUrl)
  await Promise.all([first.execute('SELECT 1'), second.execute('SELECT 2')])
  const active = brokers.filter(broker => broker.server.listening)
  expect(active).toHaveLength(1)
  expect(active[0].requests.filter(request => request.method === 'execute')).toHaveLength(2)
  const winner = active[0].token
  const nonOwner = (first as any).ownerToken === winner ? second : first
  await nonOwner.closeAsync()
  expect(active[0].server.listening).toBe(true)
})

it('waits for Worker ready before submitting any business request', async () => {
  let worker!: EventEmitter
  let broker!: Broker
  startup.spawn.mockImplementation((_filename, { workerData }) => {
    worker = candidate()
    broker = new Broker(workerData.database, workerData.ownerToken)
    broker.worker = worker
    return worker
  })
  const client = open(url())
  const pending = client.execute('INSERT once')
  await vi.waitFor(() => expect(startup.spawn).toHaveBeenCalledTimes(1))
  expect(broker.requests).toEqual([])
  await broker.listen()
  worker.emit('message', { ready: true, owner: true })
  await pending
  expect(broker.requests.map(request => request.method)).toEqual(['hello', 'execute'])
})

it('uses unique identities for separate in-memory clients', async () => {
  const first = open(':memory:')
  const second = open(':memory:')
  await Promise.all([first.execute('SELECT 1'), second.execute('SELECT 1')])
  expect(brokers).toHaveLength(2)
  expect(brokers[0].database).not.toBe(brokers[1].database)
})

it('round trips fragmented frames, bigint, blobs, named/indexed rows and JSON', async () => {
  const { broker, client } = await listening()
  broker.handler = (request, socket) => {
    const frame = encodeFrame({ id: request.id, value: result })
    socket.write(frame.subarray(0, 2))
    setTimeout(() => socket.write(frame.subarray(2)), 1)
  }
  const rs = await client.execute({ sql: 'SELECT ?', args: [42n] })
  expect(rs.rows[0][0]).toBe(9223372036854775806n)
  expect(rs.rows[0].id).toBe(rs.rows[0][0])
  expect(rs.rows[0].length).toBe(3)
  expect(new Uint8Array(rs.rows[0].data as ArrayBuffer)).toEqual(new Uint8Array([1, 2]))
  expect(JSON.parse(JSON.stringify(rs))).toMatchObject({ lastInsertRowid: '9223372036854775806', rows: [['9223372036854775806', 'AQI=', 'column']] })
  expect(broker.requests[broker.requests.length - 1]?.args).toEqual([{ sql: 'SELECT ?', args: [42n] }])
})

it('correlates coalesced replies by id, even when replies arrive out of order', async () => {
  const { broker, client } = await listening()
  const waiting: Request[] = []
  broker.handler = (request, socket) => {
    waiting.push(request)
    if (waiting.length === 2) socket.write(Buffer.concat([...waiting].reverse().map(entry => encodeFrame({ id: entry.id, value: entry.args[0] }))))
  }
  expect(await Promise.all([client.execute('first'), client.execute('second')])).toEqual(['first', 'second'])
})

it('forwards batch, migrate and administrative SQL exactly once without transaction wrapping', async () => {
  const { broker, client } = await listening()
  const statements = ['INSERT first', 'INSERT second']
  expect((await client.batch(statements))[0].rows[0].id).toBe(9223372036854775806n)
  await client.migrate(['CREATE TABLE test(id)'])
  await client.executeMultiple('CREATE INDEX test_id ON test(id);')
  await client.applyMigration(12, 'test-tag', 'ALTER TABLE test ADD data;')
  expect(broker.requests.slice(1).map(({ method, args }) => ({ method, args }))).toEqual([
    { method: 'batch', args: [statements] },
    { method: 'migrate', args: [['CREATE TABLE test(id)']] },
    { method: 'executeMultiple', args: ['CREATE INDEX test_id ON test(id);'] },
    { method: 'applyMigration', args: [12, 'test-tag', 'ALTER TABLE test ADD data;'] }
  ])
})

it('rejects transactions, sync and explicit reconnect without sending those methods', async () => {
  const { broker, client } = await listening()
  await client.execute('SELECT 1')
  await expect(client.transaction('write')).rejects.toThrow('does not support transactions')
  await expect(client.sync()).rejects.toThrow('does not support sync')
  expect(() => client.reconnect()).toThrow('create a new client')
  await client.execute('SELECT 2')
  expect(broker.requests.map(request => request.method)).toEqual(['hello', 'execute', 'execute'])
})

it('stops on broker execution failure, revives nested causes, and rejects other pending/future calls', async () => {
  const { broker, client } = await listening()
  broker.handler = (request, socket) => {
    if (request.args[0] === 'fail') broker.reply(socket, request, undefined, {
      name: 'LibsqlError', message: 'persist failed', code: 'SQLITE_IOERR', cause: { message: 'disk full', cause: { message: 'native error' } }
    })
  }
  const first = client.execute('fail')
  const pending = client.execute('pending')
  const checks = [expect(first).rejects.toMatchObject({ code: 'SQLITE_IOERR', cause: expect.any(Error) }), expect(pending).rejects.toThrow('persist failed')]
  await Promise.all(checks)
  await expect(client.execute('future')).rejects.toMatchObject({ cause: { cause: { message: 'native error' } } })
  expect(client.closed).toBe(true)
  expect(broker.requests.filter(request => request.args[0] === 'future')).toEqual([])
})

it('never replays submitted writes or reconnects when a reply is lost', async () => {
  const { broker, client } = await listening()
  broker.handler = (_request, socket) => socket.destroy()
  await expect(client.execute('INSERT committed-but-unacknowledged')).rejects.toThrow(/broker/)
  await expect(client.execute('INSERT future')).rejects.toThrow(/broker/)
  expect(() => client.reconnect()).toThrow('unsupported')
  await new Promise(resolve => setTimeout(resolve, 60))
  expect(broker.connections).toBe(1)
  expect(broker.requests.filter(request => request.method === 'execute')).toHaveLength(1)
  expect(startup.spawn).not.toHaveBeenCalled()
})

it('rejects endpoint collisions after hello rather than starting an independent writer', async () => {
  const databaseUrl = url()
  const broker = new Broker('different-canonical-path')
  await broker.listen(databaseEndpoint(databaseIdentity(databaseUrl)))
  const client = open(databaseUrl)
  await expect(client.execute('INSERT forbidden')).rejects.toThrow('identity mismatch')
  expect(broker.requests.map(request => request.method)).toEqual(['hello'])
  expect(startup.spawn).not.toHaveBeenCalled()
})

it('stops on malformed broker frames', async () => {
  const { broker, client } = await listening()
  broker.handler = (_request, socket) => socket.write(Buffer.from([255, 255, 255, 255]))
  await expect(client.execute('SELECT 1')).rejects.toThrow('frame exceeds size limit')
  await expect(client.execute('SELECT 2')).rejects.toThrow('frame exceeds size limit')
  expect(broker.requests.filter(request => request.method === 'execute')).toHaveLength(1)
})

it('close aborts pending callers and closeAsync waits for non-owner detachment', async () => {
  const { broker, client } = await listening()
  broker.handler = () => undefined
  const pending = client.execute('pending')
  const rejected = expect(pending).rejects.toThrow('closed')
  await vi.waitFor(() => expect(broker.requests[broker.requests.length - 1]?.method).toBe('execute'))
  await client.closeAsync()
  await rejected
  await expect(client.execute('future')).rejects.toThrow('closed')
  expect((client as any).socket.closed).toBe(true)
  expect(broker.requests.some(request => request.method === 'shutdown')).toBe(false)
})

it('startup Worker errors stop pending and future requests without another launch', async () => {
  startup.spawn.mockImplementation(() => {
    const worker = candidate()
    setTimeout(() => { worker.emit('error', new Error('native startup failed')); worker.emit('exit', 1) }, 1)
    return worker
  })
  const client = open(url())
  await expect(client.execute('INSERT never-sent')).rejects.toThrow('native startup failed')
  await expect(client.execute('future')).rejects.toThrow('native startup failed')
  expect(startup.spawn).toHaveBeenCalledTimes(1)
})

it('rejects the original pending call if result revival fails', async () => {
  const { broker, client } = await listening()
  broker.handler = (request, socket) => broker.reply(socket, request, { columns: ['id'], rows: [null] })
  await expect(client.execute('SELECT malformed')).rejects.toThrow()
  expect(client.closed).toBe(true)
  await expect(client.execute('future')).rejects.toThrow()
})

it('serialization failure stops the client without submitting or retrying the request', async () => {
  const { broker, client } = await listening()
  await client.execute('SELECT ready')
  await expect(client.execute({ sql: 'INSERT invalid', args: [(() => undefined) as any] })).rejects.toThrow(/could not be cloned/)
  await expect(client.execute('future')).rejects.toThrow(/could not be cloned/)
  expect(broker.requests.filter(request => request.method === 'execute')).toHaveLength(1)
})

it('owner Worker exit stops in-flight calls and requires a new client', async () => {
  const client = open(url())
  await client.execute('SELECT ready')
  const broker = brokers[0]
  broker.handler = () => undefined
  const pending = client.execute('INSERT pending')
  const rejected = expect(pending).rejects.toThrow('worker exited (1)')
  await vi.waitFor(() => expect(broker.requests.filter(request => request.method === 'execute')).toHaveLength(2))
  broker.worker!.emit('exit', 1)
  await rejected
  await expect(client.execute('future')).rejects.toThrow('worker exited (1)')
  expect(() => client.reconnect()).toThrow('create a new client')
  await broker.stop()
  expect(startup.spawn).toHaveBeenCalledTimes(1)
})

it('close rejects callers immediately even while waiting for Worker ready', async () => {
  let worker!: EventEmitter
  let broker!: Broker
  startup.spawn.mockImplementation((_filename, { workerData }) => {
    worker = candidate()
    broker = new Broker(workerData.database, workerData.ownerToken)
    broker.worker = worker
    return worker
  })
  const client = open(url())
  const pending = client.execute('INSERT never-submitted')
  const rejected = expect(pending).rejects.toThrow('closed')
  await vi.waitFor(() => expect(startup.spawn).toHaveBeenCalledTimes(1))
  client.close()
  await rejected
  await broker.listen()
  worker.emit('message', { ready: true, owner: true })
  await client.closeAsync()
  expect(broker.requests.map(request => request.method)).toEqual(['shutdown'])
})

it('does not launch a Worker for a connection error other than ECONNREFUSED', async () => {
  const error = Object.assign(new Error('connection forbidden'), { code: 'EACCES' })
  const connect = vi.spyOn(Socket.prototype, 'connect').mockImplementationOnce(function (this: Socket) {
    setTimeout(() => this.emit('error', error), 1)
    return this
  })
  try {
    const client = open(url())
    await expect(client.execute('INSERT forbidden')).rejects.toMatchObject({ code: 'EACCES' })
    await expect(client.execute('future')).rejects.toThrow('connection forbidden')
    expect(startup.spawn).not.toHaveBeenCalled()
  } finally { connect.mockRestore() }
})

it('retries startup connection refusal only, without resubmitting business commands', async () => {
  startup.spawn.mockImplementation((_filename, { workerData }) => {
    const worker = candidate()
    const broker = new Broker(workerData.database, workerData.ownerToken)
    broker.worker = worker
    setTimeout(() => worker.emit('message', { ready: true, owner: true }), 1)
    setTimeout(() => { void broker.listen() }, 40)
    return worker
  })
  const client = open(url())
  await client.execute('INSERT once')
  expect(startup.spawn).toHaveBeenCalledTimes(1)
  expect(brokers[0].requests.map(request => request.method)).toEqual(['hello', 'execute'])
  expect(brokers[0].connections).toBe(1)
})

it('converts shared broker integer cells per client without changing bindings or lastInsertRowid', async () => {
  const databaseUrl = url()
  const broker = new Broker(databaseIdentity(databaseUrl))
  await broker.listen()
  const number = open(databaseUrl, 'number')
  const string = open(databaseUrl, 'string')
  const bigint = open(databaseUrl, 'bigint')
  const defaultMode = new WorkerDatabaseClient({ url: databaseUrl }, '/test/databaseWorker.js')
  clients.push(defaultMode)
  const cells = [9007199254740991n, -9007199254740991n, 0n, 1.5, null, new Uint8Array([3]).buffer]
  broker.handler = (request, socket) => {
    const rs = { columns: ['max', 'min', 'zero', 'real', 'nil', 'blob'], rows: [cells], rowsAffected: 1, lastInsertRowid: 9223372036854775806n }
    broker.reply(socket, request, request.method === 'execute' ? rs : [rs])
  }
  for (const [client, expected] of [
    [number, [9007199254740991, -9007199254740991, 0]],
    [defaultMode, [9007199254740991, -9007199254740991, 0]],
    [string, ['9007199254740991', '-9007199254740991', '0']],
    [bigint, [9007199254740991n, -9007199254740991n, 0n]]
  ] as const) {
    const rs = await client.execute({ sql: 'SELECT ?', args: [42n] })
    expect([rs.rows[0][0], rs.rows[0].min, rs.rows[0].zero]).toEqual(expected)
    expect(rs.rows[0].real).toBe(1.5)
    expect(rs.rows[0].nil).toBeNull()
    expect(new Uint8Array(rs.rows[0].blob as ArrayBuffer)).toEqual(new Uint8Array([3]))
    expect(rs.lastInsertRowid).toBe(9223372036854775806n)
    for (const results of [await client.batch(['SELECT 1']), await client.migrate(['CREATE TABLE t(id)'])]) {
      expect(results[0].rows[0].max).toBe(expected[0])
      expect(results[0].lastInsertRowid).toBe(9223372036854775806n)
    }
    expect(JSON.parse(JSON.stringify(rs)).lastInsertRowid).toBe('9223372036854775806')
  }
  expect(broker.requests.filter(request => request.method === 'execute').map(request => request.args[0].args)).toEqual(Array(4).fill([42n]))
  expect(startup.spawn).not.toHaveBeenCalled()
})

it.each([9007199254740992n, -9007199254740992n])('rejects unsafe number conversion for %s without rounding or replay', async value => {
  const databaseUrl = url()
  const { broker, client: unaffected } = await listening(databaseUrl)
  const client = open(databaseUrl, 'number')
  broker.handler = (request, socket) => broker.reply(socket, request, { columns: ['id'], rows: [[value]] })
  await expect(client.execute('SELECT unsafe')).rejects.toBeInstanceOf(RangeError)
  await expect(client.execute('future')).rejects.toThrow('cannot be safely represented')
  expect((await unaffected.execute('SELECT exact')).rows[0].id).toBe(value)
  expect(broker.requests.filter(request => request.method === 'execute')).toHaveLength(2)
})

it('migration progress disables the startup deadline without submitting SQL before ready', async () => {
  let worker!: ReturnType<typeof candidate>
  let broker!: Broker
  startup.spawn.mockImplementation((_filename, { workerData }) => {
    worker = candidate()
    broker = new Broker(workerData.database, workerData.ownerToken)
    broker.worker = worker
    return worker
  })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const client = open(url())
  const pending = client.execute('INSERT once')
  await vi.waitFor(() => expect(startup.spawn).toHaveBeenCalledTimes(1))
  await vi.advanceTimersByTimeAsync(9000)
  worker.emit('message', { progress: 'baseline' })
  await vi.advanceTimersByTimeAsync(9000)
  worker.emit('message', { progress: { records: 1000 } })
  await vi.advanceTimersByTimeAsync(300000)
  expect(client.closed).toBe(false)
  expect(broker.requests).toEqual([])
  await broker.listen()
  worker.emit('message', { ready: true, owner: true })
  vi.useRealTimers()
  await pending
  expect(broker.requests.map(request => request.method)).toEqual(['hello', 'execute'])
  expect(worker.listenerCount('message')).toBe(0)
})

it('waits for long synchronous migration work and still propagates real Worker errors', async () => {
  const worker = candidate()
  startup.spawn.mockReturnValue(worker)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const client = open(url())
  const pending = client.execute('INSERT never-sent')
  const rejected = expect(pending).rejects.toThrow('migration failed')
  await vi.waitFor(() => expect(startup.spawn).toHaveBeenCalledTimes(1))
  await vi.advanceTimersByTimeAsync(9000)
  worker.emit('message', { progress: true })
  await vi.advanceTimersByTimeAsync(300000)
  expect(worker.terminate).not.toHaveBeenCalled()
  expect(client.closed).toBe(false)
  worker.emit('error', new Error('migration failed'))
  await rejected
  await vi.waitFor(() => expect(worker.terminate).toHaveBeenCalledTimes(1))
  expect(worker.listenerCount('message')).toBe(0)
  await expect(client.execute('future')).rejects.toThrow('migration failed')
})

it('unrelated messages do not renew startup timeout', async () => {
  const worker = candidate()
  startup.spawn.mockReturnValue(worker)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const client = open(url())
  const rejected = expect(client.execute('never-sent')).rejects.toThrow('startup timed out')
  await vi.waitFor(() => expect(startup.spawn).toHaveBeenCalledTimes(1))
  await vi.advanceTimersByTimeAsync(9000)
  worker.emit('message', { diagnostic: 'not progress' })
  await vi.advanceTimersByTimeAsync(1000)
  await rejected
  expect(worker.terminate).toHaveBeenCalledTimes(1)
})

it('shutdown response timeout destroys control socket and terminates only its own Worker', async () => {
  const client = open(url())
  await client.execute('SELECT ready')
  const broker = brokers[0]
  const worker = broker.worker as ReturnType<typeof candidate>
  broker.shutdownHandler = () => undefined
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const closing = client.closeAsync()
  const rejected = expect(closing).rejects.toThrow('shutdown timed out')
  await vi.waitFor(() => expect(broker.requests.some(request => request.method === 'shutdown')).toBe(true))
  await vi.advanceTimersByTimeAsync(5000)
  await rejected
  expect(worker.terminate).toHaveBeenCalledTimes(1)
  expect(broker.requests.filter(request => request.method === 'shutdown')).toHaveLength(1)
  expect(broker.requests.filter(request => request.method === 'execute')).toHaveLength(1)
  vi.useRealTimers()
  await vi.waitFor(() => expect(broker.sockets.size).toBe(0))
})

it('shutdown acknowledgement without Worker exit falls back to bounded termination', async () => {
  const client = open(url())
  await client.execute('SELECT ready')
  const broker = brokers[0]
  const worker = broker.worker as ReturnType<typeof candidate>
  broker.shutdownHandler = (request, socket) => { broker.reply(socket, request); socket.end() }
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const closing = client.closeAsync()
  await vi.waitFor(() => expect(broker.requests.some(request => request.method === 'shutdown')).toBe(true))
  // Allow the real TCP acknowledgement to arrive and start the exit deadline.
  await vi.waitFor(() => expect(broker.sockets.size).toBe(0))
  await vi.advanceTimersByTimeAsync(5000)
  await closing
  expect(worker.terminate).toHaveBeenCalledTimes(1)
  expect(client.closeAsync()).toBe(closing)
})

it('termination itself cannot leave closeAsync pending indefinitely', async () => {
  const client = open(url())
  await client.execute('SELECT ready')
  const broker = brokers[0]
  const worker = broker.worker as ReturnType<typeof candidate>
  worker.terminate.mockImplementation(() => new Promise(() => undefined))
  broker.shutdownHandler = () => undefined
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const closing = client.closeAsync()
  const rejected = expect(closing).rejects.toThrow('termination timed out')
  await vi.waitFor(() => expect(broker.requests.some(request => request.method === 'shutdown')).toBe(true))
  await vi.advanceTimersByTimeAsync(10000)
  await rejected
  expect(worker.terminate).toHaveBeenCalledTimes(1)
})

it('close while progress continues has its own deadline and terminates the startup candidate', async () => {
  const worker = candidate()
  startup.spawn.mockReturnValue(worker)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const client = open(url())
  const rejectedCall = expect(client.execute('never-sent')).rejects.toThrow('closed')
  await vi.waitFor(() => expect(startup.spawn).toHaveBeenCalledTimes(1))
  const rejectedClose = expect(client.closeAsync()).rejects.toThrow('startup did not stop during close')
  await rejectedCall
  await vi.advanceTimersByTimeAsync(4000)
  worker.emit('message', { progress: true })
  await vi.advanceTimersByTimeAsync(1000)
  await rejectedClose
  expect(worker.terminate).toHaveBeenCalledTimes(1)
  expect(startup.spawn).toHaveBeenCalledTimes(1)
})

it('shutdown control connection has an absolute deadline and cleans up its Worker on failure', async () => {
  const client = open(url())
  await client.execute('SELECT ready')
  const broker = brokers[0]
  const worker = broker.worker as ReturnType<typeof candidate>
  let control!: Socket
  const connect = vi.spyOn(Socket.prototype, 'connect').mockImplementationOnce(function (this: Socket) {
    control = this
    return this
  })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    const rejected = expect(client.closeAsync()).rejects.toThrow('connection timed out')
    await vi.waitFor(() => expect(control).toBeDefined())
    await vi.advanceTimersByTimeAsync(5000)
    await rejected
    expect(control.destroyed).toBe(true)
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    expect(broker.requests.filter(request => request.method === 'shutdown')).toHaveLength(0)
  } finally { connect.mockRestore() }
})

it('shutdown error remains observable after bounded Worker cleanup, without retry', async () => {
  const client = open(url())
  await client.execute('SELECT ready')
  const broker = brokers[0]
  const worker = broker.worker as ReturnType<typeof candidate>
  broker.shutdownHandler = (request, socket) => broker.reply(socket, request, undefined, { message: 'shutdown failed' })
  await expect(client.closeAsync()).rejects.toThrow('shutdown failed')
  expect(worker.terminate).toHaveBeenCalledTimes(1)
  expect(broker.requests.filter(request => request.method === 'shutdown')).toHaveLength(1)
})
