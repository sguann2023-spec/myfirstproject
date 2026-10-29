import { and, asc, eq, inArray, max } from 'drizzle-orm'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'

import { DatabaseManager } from '../DatabaseManager'
import { withDbWriteLock } from '../dbWriteQueue'
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
type AgentTransaction = Parameters<Parameters<AgentDatabase['transaction']>[0]>[0]
type DatabaseExecutor = AgentDatabase | AgentTransaction

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

const isRetryableSequenceConflict = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error)
  return /SQLITE_BUSY|database is locked|SQLITE_CONSTRAINT.*(?:agent_messages|agent_message_parts)|unique constraint failed: (?:agent_messages\.session_id, agent_messages\.sequence|agent_message_parts\.message_id, agent_message_parts\.sequence)/i.test(message)
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

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

  private async upsertMessageInTransaction(
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
    const savedRows = (await tx
      .insert(agentMessagesTable)
      .values({
        id: input.id,
        session_id: input.sessionId,
        sequence,
        turn_id: merged.turnId,
        parent_message_id: merged.parentMessageId,
        role: input.role,
        status: mergedStatus,
        semantics_json: merged.semantics,
        provider_json: merged.provider,
        usage_json: merged.usage,
        error_json: merged.error,
        finish_json: merged.finish,
        created_at: input.createdAt ?? previous?.created_at ?? now,
        completed_at: merged.completedAt,
        updated_at: now
      })
      .onConflictDoUpdate({
        target: agentMessagesTable.id,
        set: {
          turn_id: merged.turnId,
          parent_message_id: merged.parentMessageId,
          role: input.role,
          status: mergedStatus,
          semantics_json: merged.semantics,
          provider_json: merged.provider,
          usage_json: merged.usage,
          error_json: merged.error,
          finish_json: merged.finish,
          completed_at: merged.completedAt,
          updated_at: now
        }
      })
      .returning()) as AgentMessageRow[]
    const saved = savedRows[0]
    if (!saved) throw new Error(`Failed to upsert agent message ${input.id}`)

    return this.deserializeMessage(saved)
  }

  private async withSequenceRetry<T>(operation: (database: AgentDatabase) => Promise<T>): Promise<T> {
    const database = await this.database()
    // The global write lock prevents concurrent transactions from interleaving
    // statements on the single libsql connection (SQLITE_BUSY / "statements in
    // progress"); the retry below only covers residual cross-process contention.
    return withDbWriteLock(async () => {
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await operation(database)
        } catch (error) {
          if (attempt >= 4 || !isRetryableSequenceConflict(error)) throw error
          await wait(5 * (attempt + 1))
        }
      }
    })
  }

  async upsertMessage(input: UpsertAgentMessageInput): Promise<AgentMessage> {
    return this.withSequenceRetry((database) =>
      database.transaction((tx) => this.upsertMessageInTransaction(tx, input))
    )
  }

  async upsertMessages(inputs: UpsertAgentMessageInput[]): Promise<AgentMessage[]> {
    if (inputs.length === 0) return []
    return this.withSequenceRetry((database) => database.transaction(async (tx) => {
      const messages: AgentMessage[] = []
      for (const input of inputs) messages.push(await this.upsertMessageInTransaction(tx, input))
      return messages
    }))
  }

  async getMessage(sessionId: string, messageId: string): Promise<AgentMessage | null> {
    const database = await this.database()
    const [row] = await database
      .select()
      .from(agentMessagesTable)
      .where(and(eq(agentMessagesTable.session_id, sessionId), eq(agentMessagesTable.id, messageId)))
      .limit(1)
    return row ? this.deserializeMessage(row) : null
  }

  async getMessagesByIds(sessionId: string, messageIds: string[]): Promise<AgentMessage[]> {
    if (messageIds.length === 0) return []
    const database = await this.database()
    const rows = await database
      .select()
      .from(agentMessagesTable)
      .where(and(eq(agentMessagesTable.session_id, sessionId), inArray(agentMessagesTable.id, messageIds)))
      .orderBy(asc(agentMessagesTable.sequence))
    return rows.map((row) => this.deserializeMessage(row))
  }

  async listMessages(sessionId: string): Promise<AgentMessage[]> {
    const database = await this.database()
    const rows = await database
      .select()
      .from(agentMessagesTable)
      .where(eq(agentMessagesTable.session_id, sessionId))
      .orderBy(asc(agentMessagesTable.sequence))
    return rows.map((row) => this.deserializeMessage(row))
  }

  private async upsertPartInTransaction(
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
    const [saved] = await tx
      .insert(agentMessagePartsTable)
      .values({
        id: input.id,
        session_id: input.sessionId,
        message_id: input.messageId,
        sequence,
        type: input.type,
        data_json: mergedData,
        created_at: input.createdAt ?? existing[0]?.created_at ?? now,
        updated_at: now
      })
      .onConflictDoUpdate({
        target: agentMessagePartsTable.id,
        set: {
          type: input.type,
          data_json: mergedData,
          updated_at: now
        }
      })
      .returning()

    return this.deserializePart(saved)
  }

  async upsertPart(input: UpsertAgentMessagePartInput): Promise<AgentMessagePart> {
    return this.withSequenceRetry((database) =>
      database.transaction((tx) => this.upsertPartInTransaction(tx, input))
    )
  }

  async upsertParts(inputs: UpsertAgentMessagePartInput[]): Promise<AgentMessagePart[]> {
    if (inputs.length === 0) return []
    return this.withSequenceRetry((database) => database.transaction(async (tx) => {
      const parts: AgentMessagePart[] = []
      for (const input of inputs) parts.push(await this.upsertPartInTransaction(tx, input))
      return parts
    }))
  }

  async getPartsByMessageIds(sessionId: string, messageIds: string[]): Promise<AgentMessagePart[]> {
    if (messageIds.length === 0) return []
    const database = await this.database()
    const rows = await database
      .select({ part: agentMessagePartsTable })
      .from(agentMessagePartsTable)
      .innerJoin(
        agentMessagesTable,
        and(
          eq(agentMessagesTable.session_id, agentMessagePartsTable.session_id),
          eq(agentMessagesTable.id, agentMessagePartsTable.message_id)
        )
      )
      .where(
        and(eq(agentMessagePartsTable.session_id, sessionId), inArray(agentMessagePartsTable.message_id, messageIds))
      )
      .orderBy(asc(agentMessagesTable.sequence), asc(agentMessagePartsTable.sequence))
    return rows.map(({ part }) => this.deserializePart(part))
  }

  async listMessageParts(sessionId: string, messageId: string): Promise<AgentMessagePart[]> {
    const database = await this.database()
    const rows = await database
      .select()
      .from(agentMessagePartsTable)
      .where(
        and(eq(agentMessagePartsTable.session_id, sessionId), eq(agentMessagePartsTable.message_id, messageId))
      )
      .orderBy(asc(agentMessagePartsTable.sequence))
    return rows.map((row) => this.deserializePart(row))
  }

  async tombstoneMessage(sessionId: string, messageId: string): Promise<boolean> {
    const database = await this.database()
    return withDbWriteLock(() =>
      database.transaction(async (tx) => {
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
    )
  }

  async listTranscript(sessionId: string): Promise<AgentMessageWithParts[]> {
    const messages = await this.listMessages(sessionId)
    const parts = await this.getPartsByMessageIds(
      sessionId,
      messages.map((message) => message.id)
    )
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
