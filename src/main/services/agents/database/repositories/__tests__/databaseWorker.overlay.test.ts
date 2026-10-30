import { beforeEach, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { encodeFrame, FrameDecoder, storageConfiguration } from '../../brokerProtocol'

const core = vi.hoisted(() => ({ open: vi.fn(), openOverlay: vi.fn() }))
const transport = vi.hoisted(() => ({ createServer: vi.fn(), postMessage: vi.fn(), data: {} as any }))
vi.mock('../../persistentRecordStore', () => ({ PersistentRecordStore: core }))
vi.mock('node:worker_threads', () => ({ workerData: transport.data, parentPort: { postMessage: transport.postMessage, close: vi.fn() } }))
vi.mock('node:net', () => ({ createServer: transport.createServer }))

let accept: (socket: any) => void
let listen: () => Promise<void>
let server: EventEmitter
let store: { execute: ReturnType<typeof vi.fn>; backupStorage: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; startup: {} }

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  Object.assign(transport.data, { database: '/data/records.db', ownerToken: 'owner', overlayStorage: { legacyPaths: ['/data/agents.db.v2.db', '/data/agents.db'], migrationDir: '/resources/database/drizzle' } })
  store = { execute: vi.fn(() => 'result'), backupStorage: vi.fn(async () => undefined), close: vi.fn(), startup: {} }
  core.open.mockResolvedValue(store)
  core.openOverlay.mockResolvedValue(store)
  server = Object.assign(new EventEmitter(), { listen: vi.fn((_endpoint, callback) => { listen = callback }), close: vi.fn() })
  transport.createServer.mockImplementation(callback => { accept = callback; return server })
})

function connection(configure = true) {
  const replies: any[] = []
  const decoder = new FrameDecoder()
  const socket = Object.assign(new EventEmitter(), {
    destroyed: false, write: vi.fn(frame => decoder.push(frame, value => replies.push(value))), end: vi.fn(), destroy: vi.fn()
  })
  accept(socket)
  if (configure) socket.emit('data', encodeFrame({ id: 0, database: transport.data.database, method: 'hello', args: ['owner', storageConfiguration(transport.data.overlayStorage)] }))
  replies.length = 0
  return { replies, request(method: string, args: any[] = [], id = 1) {
    socket.emit('data', encodeFrame({ id, database: transport.data.database, method, args }))
  } }
}

it('opens the overlay with bigint and the unchanged core options, forwarding startup progress', async () => {
  core.openOverlay.mockImplementation(async (_database, _intMode, progress) => { progress('legacy', 2, 3, 'readonly'); return store })
  await import('../../databaseWorker')
  await listen()
  expect(core.openOverlay).toHaveBeenCalledWith('/data/records.db', 'bigint', expect.any(Function), transport.data.overlayStorage)
  expect(core.open).not.toHaveBeenCalled()
  expect(transport.postMessage).toHaveBeenCalledWith({ progress: true, phase: 'legacy', count: 2, total: 3, detail: 'readonly' })
  expect(transport.postMessage).toHaveBeenCalledWith({ ready: true, owner: true })
})

it('keeps the old core open path when no fourth client argument is supplied', async () => {
  delete transport.data.overlayStorage
  await import('../../databaseWorker')
  await listen()
  expect(core.open).toHaveBeenCalledWith('/data/records.db', 'bigint', expect.any(Function))
  expect(core.openOverlay).not.toHaveBeenCalled()
})

it('rejects non-owner storage backup before calling the core', async () => {
  await import('../../databaseWorker')
  await listen()
  const peer = connection()
  peer.request('backupStorage', ['other', '/backup'])
  expect(store.backupStorage).not.toHaveBeenCalled()
  expect(peer.replies[0].error.message).toContain('Only the broker owner')
})

it('holds FIFO ordering until directory backup completes', async () => {
  let release!: () => void
  store.backupStorage.mockImplementation(() => new Promise<void>(resolve => { release = resolve }))
  await import('../../databaseWorker')
  await listen()
  const owner = connection()
  owner.request('backupStorage', ['owner', '/backup'], 1)
  owner.request('execute', ['SELECT 1'], 2)
  expect(store.backupStorage).toHaveBeenCalledWith('/backup')
  expect(store.execute).not.toHaveBeenCalled()
  expect(owner.replies).toEqual([])
  release()
  await vi.waitFor(() => expect(owner.replies.map(reply => reply.id)).toEqual([1, 2]))
  expect(owner.replies[1].value).toBe('result')
})

it('returns the storage manifest without dropping it at the broker boundary', async () => {
  const manifest = { format: 'record-overlay-v1', database: 'records.db', legacyPaths: ['legacy/0.db'], sources: [{ originalPath: '/data/agents.db', snapshot: 'legacy/0.db' }] }
  store.backupStorage.mockResolvedValueOnce(manifest)
  await import('../../databaseWorker')
  await listen()
  const owner = connection()
  owner.request('backupStorage', ['owner', '/backup'])
  await vi.waitFor(() => expect(owner.replies[0]?.value).toEqual(manifest))
})

it('rejects a different source configuration on the same broker', async () => {
  await import('../../databaseWorker')
  await listen()
  const peer = connection(false)
  peer.request('hello', ['other', storageConfiguration({ ...transport.data.overlayStorage, legacyPaths: [] })])
  expect(peer.replies[0].error.message).toContain('configuration mismatch')
  peer.request('execute', ['INSERT forbidden'], 2)
  expect(peer.replies[1].error.message).toContain('requires a configuration hello')
  expect(store.execute).not.toHaveBeenCalled()
})

it('requires configuration hello before accepting direct business RPCs', async () => {
  await import('../../databaseWorker')
  await listen()
  const peer = connection(false)
  peer.request('execute', ['INSERT forbidden'])
  expect(peer.replies[0].error.message).toContain('requires a configuration hello')
  expect(store.execute).not.toHaveBeenCalled()
})

it('reports overlay core failure without falling back to destructive legacy initialization', async () => {
  core.openOverlay.mockRejectedValueOnce(new Error('legacy unavailable'))
  await import('../../databaseWorker')
  await listen()
  expect(core.open).not.toHaveBeenCalled()
  expect(transport.postMessage).toHaveBeenCalledWith({ error: expect.objectContaining({ message: 'legacy unavailable' }) })
  expect(transport.postMessage).not.toHaveBeenCalledWith({ ready: true, owner: true })
})
