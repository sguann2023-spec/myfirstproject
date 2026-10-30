import { and, eq, inArray } from 'drizzle-orm'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'

import type * as schema from '../schema'
import { channelTaskSubscriptionsTable } from '../schema'

export async function insertMissingTaskSubscriptions(
  database: LibSQLDatabase<typeof schema>,
  taskId: string,
  channelIds: string[]
): Promise<void> {
  const uniqueIds = [...new Set(channelIds)]
  if (uniqueIds.length === 0) return
  const existing = await database.select({ channelId: channelTaskSubscriptionsTable.channelId })
    .from(channelTaskSubscriptionsTable)
    .where(and(eq(channelTaskSubscriptionsTable.taskId, taskId), inArray(channelTaskSubscriptionsTable.channelId, uniqueIds)))
  const existingIds = new Set(existing.map((row) => row.channelId))
  const missing = uniqueIds.filter((channelId) => !existingIds.has(channelId))
  if (missing.length > 0) {
    await database.insert(channelTaskSubscriptionsTable).values(missing.map((channelId) => ({ channelId, taskId })))
  }
}
