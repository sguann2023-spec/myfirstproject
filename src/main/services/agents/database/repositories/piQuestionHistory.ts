import { sql } from 'drizzle-orm'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import { parseMaybeJsonToolArguments } from '@shared/parseToolArguments'
import type * as schema from '../schema'

export interface StoredPiQuestion {
  toolCallId: string
  contentIndex: number
  input: Record<string, unknown>
}

export interface PiQuestionHistoryReader {
  getInvocationQuestions(sessionId: string, userMessageId: string): Promise<StoredPiQuestion[]>
}

const database = async () => {
  const { DatabaseManager } = await import('../DatabaseManager')
  return (await DatabaseManager.getInstance()).getDatabase()
}

export class PiQuestionHistory implements PiQuestionHistoryReader {
  constructor(private readonly getDatabase: () => Promise<LibSQLDatabase<typeof schema>> = database) {}

  async getInvocationQuestions(sessionId: string, userMessageId: string): Promise<StoredPiQuestion[]> {
    const db = await this.getDatabase()
    // Follow the persisted active branch, not timestamps or another invocation's questions.
    const rows = await db.all<{ entry: string | null; bytes: number; anchor: string }>(sql`
      WITH RECURSIVE branch(entry_id, parent_entry_id, depth) AS (
        SELECT e.entry_id, e.parent_entry_id, 0 FROM pi_session_entries e
        JOIN pi_sessions s ON s.topic_id = e.topic_id AND s.active_leaf_id = e.entry_id
        WHERE e.topic_id = ${sessionId}
        UNION ALL
        SELECT e.entry_id, e.parent_entry_id, b.depth + 1 FROM pi_session_entries e
        JOIN branch b ON e.entry_id = b.parent_entry_id
        WHERE e.topic_id = ${sessionId} AND b.depth < 1024
      )
      SELECT CASE WHEN octet_length(e.entry_json) <= 4194304 THEN e.entry_json END AS entry,
        octet_length(e.entry_json) AS bytes, claim.entry_id AS anchor
      FROM branch b JOIN pi_session_entries e ON e.topic_id = ${sessionId} AND e.entry_id = b.entry_id
      JOIN pi_invocation_entries claim ON claim.topic_id = e.topic_id
        AND claim.invocation_id = ${userMessageId} AND claim.entry_kind = 'user_message'
      ORDER BY b.depth ASC
    `)
    if (rows.length >= 1025 || rows.some(row => !row.entry) ||
        rows.reduce((total, row) => total + Number(row.bytes), 0) > 16 * 1024 * 1024) {
      throw new Error('PI question history exceeds safe reading limits')
    }

    let inInvocation = false
    const questions: StoredPiQuestion[] = []
    for (const row of rows.reverse()) {
      const entry = JSON.parse(row.entry!)
      if (entry.id === row.anchor) {
        inInvocation = true
        continue
      }
      if (!inInvocation || entry.type !== 'message') continue
      if (entry.message?.role === 'user') break
      if (entry.message?.role !== 'assistant' || !Array.isArray(entry.message.content)) continue
      entry.message.content.forEach((content: any, contentIndex: number) => {
        if (content?.type !== 'toolCall' || content.name !== 'AskUserQuestion' || typeof content.id !== 'string') return
        const input = parseMaybeJsonToolArguments(content.arguments)
        if (input) questions.push({ toolCallId: content.id, contentIndex, input })
      })
    }
    return questions
  }
}

export const piQuestionHistory = new PiQuestionHistory()
