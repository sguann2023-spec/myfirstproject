import type { AgentPersistedMessage } from '@types'
import { resolveToolArguments } from '@shared/parseToolArguments'
import type { PiQuestionHistoryReader, StoredPiQuestion } from './repositories/piQuestionHistory'

const record = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}

const hasQuestions = (input: unknown): boolean => {
  const resolved = resolveToolArguments(input)
  return Array.isArray(resolved?.questions) && resolved.questions.length > 0 &&
    resolved.questions.every((question: any) => typeof question?.question === 'string' && question.question.trim())
}

function matchQuestion(sessionId: string, ids: string[], questions: StoredPiQuestion[]): StoredPiQuestion | undefined {
  const providerIds = ids.map(id => id.startsWith(`${sessionId}:`) ? id.slice(sessionId.length + 1) : id)
  const exact = questions.filter(question => providerIds.includes(question.toolCallId))
  if (exact.length) return exact.length === 1 ? exact[0] : undefined

  // Older UI records only kept the synthetic ID. Its content index is safe only
  // when exactly one question at that position exists in this persisted invocation.
  const index = ids.map(id => /^pi_tool_pi_assistant_\d+_[a-z0-9]+_(\d+)$/.exec(id)).find(Boolean)?.[1]
  if (index === undefined) return undefined
  const candidates = questions.filter(question => question.contentIndex === Number(index))
  return candidates.length === 1 ? candidates[0] : undefined
}

export async function recoverPiQuestionHistory(
  sessionId: string,
  messages: AgentPersistedMessage[],
  reader: PiQuestionHistoryReader
): Promise<AgentPersistedMessage[]> {
  const invocations = new Map<string, Promise<StoredPiQuestion[]>>()
  return Promise.all(messages.map(async (entry) => {
    const message = record(entry.message)
    if (message.role !== 'assistant' || !message.askId) return entry
    const blocks = await Promise.all(entry.blocks.map(async (block) => {
      const data = record(block)
      const raw = record(data.metadata?.rawMcpToolResponse)
      if ((raw.tool?.name ?? data.toolName) !== 'AskUserQuestion' ||
          hasQuestions(resolveToolArguments(raw.arguments, raw.partialArguments, data.arguments))) return block
      const invocationId = String(message.askId)
      let pending = invocations.get(invocationId)
      if (!pending) {
        pending = reader.getInvocationQuestions(sessionId, invocationId)
        invocations.set(invocationId, pending)
      }
      const ids = [raw.id, raw.toolCallId, data.toolId].filter((id): id is string => typeof id === 'string' && !!id)
      const question = matchQuestion(sessionId, ids, await pending)
      if (!question || !hasQuestions(question.input)) return block
      return { ...block, arguments: question.input, metadata: { ...data.metadata,
        rawMcpToolResponse: { ...raw, arguments: question.input }
      } }
    }))
    return { ...entry, blocks } as AgentPersistedMessage
  }))
}
