import { and, eq, inArray, max } from 'drizzle-orm'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'

import { readMessageProjection } from '../messageEventStore'
import { DatabaseManager } from '../DatabaseManager'
import { withoutTransaction } from '../withoutTransaction'
import { OrderedTaskQueue } from '../orderedTaskQueue'
import {
  agentMessagePartsTable,
  agentMessagesTable,
  type AgentMessagePartRow,
  type AgentMessageRow
} from '../schema'
import type * as schema from '../schema'
import type {
  AgentMessage,
  AgentMessagePart,
  AgentMessageWithParts,
  UpsertAgentMessageInput,
  UpsertAgentMessagePartInput
} from './agentTranscript.types'

type AgentDatabase = LibSQLDatabase<typeof schema>
type DatabaseExecutor = AgentDatabase

const transcriptQueues = new WeakMap<AgentDatabase, OrderedTaskQueue>()
function transcriptWrites(database: AgentDatabase): OrderedTaskQueue {
  let queue = transcriptQueues.get(database)
  if (!queue) {
    queue = new OrderedTaskQueue()
    transcriptQueues.set(database, queue)
  }
  return queue
}

const STATUS_RANK: Record<AgentMessage['status'], number> = {
  pending: 0,
  streaming: 1,
  completed: 2,
  cancelled: 2,
  failed: 2,
  interrupted: 2
}

const defined = <T>(incoming: T | undefined, existing: T | null | undefined): T | null | undefined =>
  incoming === undefined ? existing : incoming

const mergeRecord = <T extends Record<string, unknown>>(
  existing: T | null | undefined,
  incoming: T | undefined
): T | null | undefined => {
  if (incoming === undefined) return existing
  const definedIncoming = Object.fromEntries(Object.entries(incoming).filter(([, value]) => value !== undefined))
  return { ...(existing ?? {}), ...definedIncoming } as T
}

const monotonicStatus = (existing: AgentMessage['status'] | undefined, incoming: AgentMessage['status']): AgentMessage['status'] => {
  if (!existing) return incoming
  const existingRank = STATUS_RANK[existing]
  const incomingRank = STATUS_RANK[incoming]
  return incomingRank <= existingRank ? existing : incoming
}

const PART_STATUS_RANK: Record<string, number> = {
  pending: 0,
  running: 1,
  streaming: 1,
  completed: 2,
  complete: 2,
  success: 2,
  cancelled: 2,
  failed: 2,
  error: 2,
  interrupted: 2
}

const mergePartData = (
  existing: Record<string, unknown> | null | undefined,
  incoming: Record<string, unknown>
): Record<string, unknown> => {
  const merged = mergeRecord(existing, incoming) ?? {}
  const existingStatus = typeof existing?.status === 'string' ? existing.status.toLowerCase() : undefined
  const incomingStatus = typeof incoming.status === 'string' ? incoming.status.toLowerCase() : undefined
  if (existingStatus && incomingStatus && (PART_STATUS_RANK[incomingStatus] ?? 0) <= (PART_STATUS_RANK[existingStatus] ?? 0)) {
    merged.status = existing?.status
  }
  return merged
}

export interface IAgentTranscriptRepository {
  upsertMessage(input: UpsertAgentMessageInput): Promise<AgentMessage>
  upsertMessages(inputs: UpsertAgentMessageInput[]): Promise<AgentMessage[]>
  getMessage(sessionId: string, messageId: string): Promise<AgentMessage | null>
  getMessagesByIds(sessionId: string, messageIds: string[]): Promise<AgentMessage[]>
  listMessages(sessionId: string): Promise<AgentMessage[]>
  upsertPart(input: UpsertAgentMessagePartInput): Promise<AgentMessagePart>
  upsertParts(inputs: UpsertAgentMessagePartInput[]): Promise<AgentMessagePart[]>
  getPartsByMessageIds(sessionId: string, messageIds: string[]): Promise<AgentMessagePart[]>
  listMessageParts(sessionId: string, messageId: string): Promise<AgentMessagePart[]>
  listTranscript(sessionId: string): Promise<AgentMessageWithParts[]>
  tombstoneMessage(sessionId: string, messageId: string): Promise<boolean>
}

export class AgentTranscriptRepository implements IAgentTranscriptRepository {
  constructor(private readonly injectedDatabase?: AgentDatabase) {}

  private async database(): Promise<AgentDatabase> {
    if (this.injectedDatabase) return this.injectedDatabase
    return (await DatabaseManager.getInstance()).getDatabase()
  }

  private deserializeMessage(row: AgentMessageRow): AgentMessage {
    return {
      id: row.id,
      sessionId: row.session_id,
      sequence: row.sequence,
      turnId: row.turn_id ?? undefined,
      parentMessageId: row.parent_message_id ?? undefined,
      role: row.role as AgentMessage['role'],
      status: row.status as AgentMessage['status'],
      semantics: row.semantics_json ?? undefined,
      provider: row.provider_json ?? undefined,
      usage: row.usage_json ?? undefined,
      error: row.error_json ?? undefined,
      finish: row.finish_json ?? undefined,
      createdAt: row.created_at,
      completedAt: row.completed_at ?? undefined,
      updatedAt: row.updated_at
    }
  }

  private deserializePart(row: AgentMessagePartRow): AgentMessagePart {
    return {
      id: row.id,
      sessionId: row.session_id,
      messageId: row.message_id,
      sequence: row.sequence,
      type: row.type,
      data: row.data_json,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  private async upsertMessageWith(
    tx: DatabaseExecutor,
    input: UpsertAgentMessageInput
  ): Promise<AgentMessage> {
    const existing = await tx.select().from(agentMessagesTable).where(eq(agentMessagesTable.id, input.id)).limit(1)
    if (existing[0] && existing[0].session_id !== input.sessionId) {
      throw new Error(`Agent message ${input.id} already belongs to session ${existing[0].session_id}`)
    }

    const now = input.updatedAt ?? new Date().toISOString()
    let sequence = existing[0]?.sequence
    if (sequence === undefined) {
      const [result] = await tx
        .select({ value: max(agentMessagesTable.sequence) })
        .from(agentMessagesTable)
        .where(eq(agentMessagesTable.session_id, input.sessionId))
      sequence = (result?.value ?? -1) + 1
    }

    const previous = existing[0]
    const mergedStatus = monotonicStatus(previous?.status as AgentMessage['status'] | undefined, input.status)
    const merged = {
      turnId: defined(input.turnId, previous?.turn_id),
      parentMessageId: defined(input.parentMessageId, previous?.parent_message_id),
      semantics: mergeRecord(previous?.semantics_json, input.semantics),
      provider: mergeRecord(previous?.provider_json, input.provider),
      usage: mergeRecord(previous?.usage_json, input.usage),
      error: mergeRecord(previous?.error_json, input.error),
      finish: mergeRecord(previous?.finish_json, input.finish),
      completedAt: defined(input.completedAt, previous?.completed_at)
    }
    const values = {
      id: input.id, session_id: input.sessionId, sequence,
      turn_id: merged.turnId, parent_message_id: merged.parentMessageId,
      role: input.role, status: mergedStatus, semantics_json: merged.semantics,
      provider_json: merged.provider, usage_json: merged.usage, error_json: merged.error,
      finish_json: merged.finish, created_at: input.createdAt ?? previous?.created_at ?? now,
      completed_at: merged.completedAt, updated_at: now
    }
    if (previous) await tx.update(agentMessagesTable).set(values).where(eq(agentMessagesTable.id, input.id))
    else await tx.insert(agentMessagesTable).values(values)
    const [saved] = await tx.select().from(agentMessagesTable).where(eq(agentMessagesTable.id, input.id))

    return this.deserializeMessage(saved)
  }

  private async withOrderedWrite<T>(operation: (database: AgentDatabase) => Promise<T>): Promise<T> {
    const database = await this.database()
    return transcriptWrites(database).run(() => operation(database))
  }

  // Bulk writes are ordered independent statements; a failure leaves the completed prefix.
  private persistBatchSequentially<T>(
    database: AgentDatabase,
    operation: (executor: AgentDatabase) => Promise<T>
  ): Promise<T> {
    return withoutTransaction(database, operation)
  }

  async upsertMessage(input: UpsertAgentMessageInput): Promise<AgentMessage> {
    return this.withOrderedWrite((database) =>
      this.upsertMessageWith(database, input)
    )
  }

  async upsertMessages(inputs: UpsertAgentMessageInput[]): Promise<AgentMessage[]> {
    if (inputs.length === 0) return []
    return this.withOrderedWrite((database) => this.persistBatchSequentially(database, async (executor) => {
      const messages: AgentMessage[] = []
      for (const input of inputs) messages.push(await this.upsertMessageWith(executor, input))
      return messages
    }))
  }

  async getMessage(sessionId: string, messageId: string): Promise<AgentMessage | null> {
    const [row] = await (await this.database()).select().from(agentMessagesTable)
      .where(and(eq(agentMessagesTable.session_id, sessionId), eq(agentMessagesTable.id, messageId))).limit(1)
    return row ? this.deserializeMessage(row) : null
  }

  async getMessagesByIds(sessionId: string, messageIds: string[]): Promise<AgentMessage[]> {
    if (!messageIds.length) return []
    const rows = await (await this.database()).select().from(agentMessagesTable)
      .where(and(eq(agentMessagesTable.session_id, sessionId), inArray(agentMessagesTable.id, messageIds)))
    return rows.sort((a, b) => a.sequence - b.sequence).map(row => this.deserializeMessage(row))
  }

  async listMessages(sessionId: string): Promise<AgentMessage[]> {
    const rows = await readMessageProjection<AgentMessageRow>(await this.database(), 'agent_messages', sessionId)
    return rows.sort((a, b) => a.sequence - b.sequence).map(row => this.deserializeMessage(row))
  }

  private async upsertPartWith(
    tx: DatabaseExecutor,
    input: UpsertAgentMessagePartInput
  ): Promise<AgentMessagePart> {
    const [message] = await tx
      .select({ id: agentMessagesTable.id })
      .from(agentMessagesTable)
      .where(and(eq(agentMessagesTable.session_id, input.sessionId), eq(agentMessagesTable.id, input.messageId)))
      .limit(1)
    if (!message) throw new Error(`Agent message ${input.messageId} does not exist in session ${input.sessionId}`)

    const existing = await tx
      .select()
      .from(agentMessagePartsTable)
      .where(eq(agentMessagePartsTable.id, input.id))
      .limit(1)
    if (
      existing[0] &&
      (existing[0].session_id !== input.sessionId || existing[0].message_id !== input.messageId)
    ) {
      throw new Error(`Agent message part ${input.id} already belongs to another message`)
    }

    const now = input.updatedAt ?? new Date().toISOString()
    let sequence = existing[0]?.sequence
    if (sequence === undefined) {
      const [result] = await tx
        .select({ value: max(agentMessagePartsTable.sequence) })
        .from(agentMessagePartsTable)
        .where(eq(agentMessagePartsTable.message_id, input.messageId))
      sequence = (result?.value ?? -1) + 1
    }

    const mergedData = mergePartData(existing[0]?.data_json, input.data)
    const values = {
      id: input.id, session_id: input.sessionId, message_id: input.messageId, sequence,
      type: input.type, data_json: mergedData,
      created_at: input.createdAt ?? existing[0]?.created_at ?? now, updated_at: now
    }
    if (existing[0]) await tx.update(agentMessagePartsTable).set(values).where(eq(agentMessagePartsTable.id, input.id))
    else await tx.insert(agentMessagePartsTable).values(values)
    const [saved] = await tx.select().from(agentMessagePartsTable).where(eq(agentMessagePartsTable.id, input.id))

    return this.deserializePart(saved)
  }

  async upsertPart(input: UpsertAgentMessagePartInput): Promise<AgentMessagePart> {
    return this.withOrderedWrite((database) =>
      this.upsertPartWith(database, input)
    )
  }

  async upsertParts(inputs: UpsertAgentMessagePartInput[]): Promise<AgentMessagePart[]> {
    if (inputs.length === 0) return []
    return this.withOrderedWrite((database) => this.persistBatchSequentially(database, async (executor) => {
      const parts: AgentMessagePart[] = []
      for (const input of inputs) parts.push(await this.upsertPartWith(executor, input))
      return parts
    }))
  }

  async getPartsByMessageIds(sessionId: string, messageIds: string[]): Promise<AgentMessagePart[]> {
    if (!messageIds.length) return []
    const rows = await (await this.database()).select().from(agentMessagePartsTable)
      .where(and(eq(agentMessagePartsTable.session_id, sessionId), inArray(agentMessagePartsTable.message_id, messageIds)))
    return rows.sort((a, b) => a.sequence - b.sequence).map(row => this.deserializePart(row))
  }

  async listMessageParts(sessionId: string, messageId: string): Promise<AgentMessagePart[]> {
    return this.getPartsByMessageIds(sessionId, [messageId])
  }

  async tombstoneMessage(sessionId: string, messageId: string): Promise<boolean> {
    const database = await this.database()
    return transcriptWrites(database).run(async () => {
      const tx = database
      const [existing] = await tx
        .select()
        .from(agentMessagesTable)
        .where(and(eq(agentMessagesTable.session_id, sessionId), eq(agentMessagesTable.id, messageId)))
        .limit(1)
      if (!existing) return false
      const now = new Date().toISOString()
      await tx
        .update(agentMessagesTable)
        .set({
          semantics_json: {
            ...(existing.semantics_json ?? {}),
            uiVisibility: 'hidden',
            providerVisibility: 'hidden',
            transcriptVisibility: 'hidden',
            deletedAt: now,
            tombstone: true
          },
          updated_at: now
        })
        .where(and(eq(agentMessagesTable.session_id, sessionId), eq(agentMessagesTable.id, messageId)))
      return true
    })
  }

  async listTranscript(sessionId: string): Promise<AgentMessageWithParts[]> {
    const database = await this.database()
    const messageRows = await readMessageProjection<AgentMessageRow>(database, 'agent_messages', sessionId)
    const partRows = await readMessageProjection<AgentMessagePartRow>(database, 'agent_message_parts', sessionId)
    const messages = messageRows.sort((a, b) => a.sequence - b.sequence).map(row => this.deserializeMessage(row))
    const parts = partRows.sort((a, b) => a.sequence - b.sequence).map(row => this.deserializePart(row))
    const partsByMessage = new Map<string, AgentMessagePart[]>()
    for (const part of parts) {
      const messageParts = partsByMessage.get(part.messageId) ?? []
      messageParts.push(part)
      partsByMessage.set(part.messageId, messageParts)
    }
    return messages.map((message) => ({ message, parts: partsByMessage.get(message.id) ?? [] }))
  }
}

export const agentTranscriptRepository = new AgentTranscriptRepository()
