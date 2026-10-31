import { describe, expect, it, vi } from 'vitest'

const logger = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn() }))
vi.mock('@logger', () => ({ loggerService: { withContext: () => logger } }))

import { insertAgentAtFront, insertSessionAtFront, reorderAgentRows, reorderSessionRows } from '../servicePersistence'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

function databaseWithFirstWriteBlocked() {
  const gate = deferred()
  const started: unknown[] = []
  const database = {
    transaction: vi.fn(() => { throw new Error('ordering must not start a transaction') }),
    update: () => ({ set: (data: unknown) => ({ where: async () => {
      started.push(data)
      if (started.length === 1) await gate.promise
    } }) }),
    insert: () => ({ values: vi.fn().mockResolvedValue(undefined) })
  }
  return { database: database as any, started, gate }
}

describe('display order persistence queues', () => {
  it.each(['read_session_order', 'insert_session'] as const)('logs SQLite busy at %s without changing the error or exposing SQL parameters', async (stage) => {
    logger.error.mockClear()
    const cause = Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY', rawCode: 5 })
    const error = Object.assign(new Error('Failed query: private SQL parameters'), { cause })
    const readOrder = vi.fn()
    if (stage === 'read_session_order') readOrder.mockRejectedValue(error)
    else readOrder.mockResolvedValue([{ sortOrder: -2 }])
    const insert = vi.fn().mockRejectedValue(error)
    const database = {
      select: () => ({ from: () => ({ where: readOrder }) }),
      insert: () => ({ values: insert })
    } as any

    await expect(insertSessionAtFront(database, { id: 'new-session', agent_id: 'busy-agent' } as any)).rejects.toBe(error)

    expect(readOrder).toHaveBeenCalledTimes(1)
    expect(insert).toHaveBeenCalledTimes(stage === 'insert_session' ? 1 : 0)
    expect(logger.error).toHaveBeenCalledWith('Session insert at front failed', expect.objectContaining({
      agentId: 'busy-agent',
      sessionId: 'new-session',
      stage,
      queueWaitMs: expect.any(Number),
      stageElapsedMs: expect.any(Number),
      sqliteBusy: true,
      error: expect.objectContaining({
        causes: expect.arrayContaining([expect.objectContaining({ code: 'SQLITE_BUSY', rawCode: 5, category: 'busy' })])
      })
    }))
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('private SQL parameters')
  })

  it('creates a session at the front with one insert and never updates old sessions', async () => {
    const insert = vi.fn().mockResolvedValue(undefined)
    const database = {
      select: () => ({ from: () => ({ where: vi.fn().mockResolvedValue([{ sortOrder: -7 }]) }) }),
      insert: () => ({ values: insert }),
      update: vi.fn(() => { throw new Error('old sessions must not be shifted') }),
      transaction: vi.fn(() => { throw new Error('transactions are unsupported') })
    } as any
    await insertSessionAtFront(database, { id: 'new-session', agent_id: 'agent-a', sort_order: 0 } as any)
    expect(insert).toHaveBeenCalledWith({ id: 'new-session', agent_id: 'agent-a', sort_order: -8 })
    expect(database.update).not.toHaveBeenCalled()
    expect(database.transaction).not.toHaveBeenCalled()
  })

  it('serializes agent reorder requests without a SQL transaction and recovers after failure', async () => {
    const { database, started, gate } = databaseWithFirstWriteBlocked()
    const first = reorderAgentRows(database, ['a', 'b'])
    const second = reorderAgentRows(database, ['b', 'a'])
    await vi.waitFor(() => expect(started).toHaveLength(1))
    gate.resolve()
    await Promise.all([first, second])
    expect(started).toEqual([{ sort_order: 0 }, { sort_order: 1 }, { sort_order: 0 }, { sort_order: 1 }])
    expect(database.transaction).not.toHaveBeenCalled()
    const error = new Error('storage failed')
    const broken = { update: () => { throw error } } as any
    await expect(insertAgentAtFront(broken, {} as any)).rejects.toBe(error)
    await expect(reorderAgentRows(database, ['a'])).resolves.toBeUndefined()
  })

  it('does not block unrelated agents session ordering', async () => {
    const blocked = databaseWithFirstWriteBlocked()
    const independent = databaseWithFirstWriteBlocked()
    independent.gate.resolve()
    const pending = reorderSessionRows(blocked.database, 'agent-a', ['one'])
    await vi.waitFor(() => expect(blocked.started).toHaveLength(1))
    await reorderSessionRows(independent.database, 'agent-b', ['two'])
    expect(independent.started).toHaveLength(1)
    blocked.gate.resolve()
    await pending
    expect(blocked.database.transaction).not.toHaveBeenCalled()
    expect(independent.database.transaction).not.toHaveBeenCalled()
  })
})
