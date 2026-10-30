import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import { and, eq, min, sql } from 'drizzle-orm'
import { loggerService } from '@logger'

import { OrderedTaskQueue } from '../orderedTaskQueue'
import * as schema from '../schema'
import { agentsTable, channelsTable, scheduledTasksTable, sessionsTable } from '../schema'
import { isSqliteBusy, sqliteErrorDiagnostics } from '../sqliteRetry'
import { withoutTransaction } from '../withoutTransaction'

type Database = LibSQLDatabase<typeof schema>
const logger = loggerService.withContext('ServicePersistence')

// Queue scopes are independent: agent display order never blocks session order.
const agentOrderQueue = new OrderedTaskQueue()
const sessionOrderQueues = new Map<string, { queue: OrderedTaskQueue; pending: number }>()
async function runSessionOrder<T>(agentId: string, task: () => Promise<T>): Promise<T> {
  let scope = sessionOrderQueues.get(agentId)
  if (!scope) {
    scope = { queue: new OrderedTaskQueue(), pending: 0 }
    sessionOrderQueues.set(agentId, scope)
  }
  scope.pending++
  try {
    return await scope.queue.run(task)
  } finally {
    if (--scope.pending === 0) sessionOrderQueues.delete(agentId)
  }
}

export async function insertAgentAtFront(database: Database, data: typeof agentsTable.$inferInsert): Promise<void> {
  await agentOrderQueue.run(async () => {
    await database.update(agentsTable).set({ sort_order: sql`${agentsTable.sort_order} + 1` })
    await database.insert(agentsTable).values(data)
  })
}

export async function insertSessionAtFront(database: Database, data: typeof sessionsTable.$inferInsert): Promise<void> {
  const context = { agentId: data.agent_id, sessionId: data.id }
  const queuedAt = performance.now()
  logger.info('Session insert at front queued', {
    ...context,
    pendingSessionOrderTasks: sessionOrderQueues.get(data.agent_id)?.pending ?? 0
  })
  await runSessionOrder(data.agent_id, async () => {
    const startedAt = performance.now()
    const queueWaitMs = Math.round(startedAt - queuedAt)
    let stage: 'read_session_order' | 'insert_session' = 'read_session_order'
    let stageStartedAt = startedAt
    logger.info('Session insert at front started', { ...context, queueWaitMs, stage })
    try {
      const [first] = await database.select({ sortOrder: min(sessionsTable.sort_order) }).from(sessionsTable)
        .where(eq(sessionsTable.agent_id, data.agent_id))
      stage = 'insert_session'
      stageStartedAt = performance.now()
      await database.insert(sessionsTable).values({ ...data, sort_order: first?.sortOrder == null ? 0 : first.sortOrder - 1 })
      logger.info('Session insert at front completed', {
        ...context,
        queueWaitMs,
        insertElapsedMs: Math.round(performance.now() - stageStartedAt),
        elapsedMs: Math.round(performance.now() - startedAt)
      })
    } catch (error) {
      logger.error('Session insert at front failed', {
        ...context,
        stage,
        queueWaitMs,
        stageElapsedMs: Math.round(performance.now() - stageStartedAt),
        elapsedMs: Math.round(performance.now() - startedAt),
        pendingSessionOrderTasks: sessionOrderQueues.get(data.agent_id)?.pending ?? 0,
        sqliteBusy: isSqliteBusy(error),
        error: sqliteErrorDiagnostics(error)
      })
      throw error
    }
  })
}

export async function reorderAgentRows(database: Database, orderedIds: string[]): Promise<void> {
  await agentOrderQueue.run(async () => {
    for (const [sort_order, id] of orderedIds.entries()) {
      await database.update(agentsTable).set({ sort_order }).where(eq(agentsTable.id, id))
    }
  })
}

export async function reorderSessionRows(database: Database, agentId: string, orderedIds: string[]): Promise<void> {
  await runSessionOrder(agentId, async () => {
    for (const [sort_order, id] of orderedIds.entries()) {
      await database.update(sessionsTable).set({ sort_order })
        .where(and(eq(sessionsTable.id, id), eq(sessionsTable.agent_id, agentId)))
    }
  })
}

export async function softDeleteBuiltinAgent(database: Database, id: string, now: string): Promise<void> {
  await withoutTransaction(database, async (tx) => {
    await tx.delete(scheduledTasksTable).where(eq(scheduledTasksTable.agent_id, id))
    await tx.delete(sessionsTable).where(eq(sessionsTable.agent_id, id))
    await tx.update(channelsTable).set({ agentId: null }).where(eq(channelsTable.agentId, id))
    await tx.update(agentsTable).set({ deleted_at: now, updated_at: now }).where(eq(agentsTable.id, id))
  })
}

export async function persistInheritedSessionSettings(
  database: Database,
  updates: Array<{ id: string; data: Partial<typeof sessionsTable.$inferInsert> }>
): Promise<void> {
  await withoutTransaction(database, async (tx) => {
    for (const { id, data } of updates) {
      await tx.update(sessionsTable).set(data).where(eq(sessionsTable.id, id))
    }
  })
}

export async function persistWorkspaceSessionPaths(
  database: Database,
  updates: Array<{ id: string; accessible_paths: string | null; configuration: string | null }>
): Promise<void> {
  await withoutTransaction(database, async (tx) => {
    for (const { id, ...data } of updates) {
      await tx.update(sessionsTable).set(data).where(eq(sessionsTable.id, id))
    }
  })
}
