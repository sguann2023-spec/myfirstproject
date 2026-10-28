export type ChatSessionCompletionFlags = {
  isPending?: boolean | null
  isFulfilled?: boolean | null
}

/** List-only indicator; permission submission remains waiting until the result arrives. */
export function isChatSessionAwaitingConfirmation(
  session: { runtimeSessionId?: string; isPending?: boolean },
  requests: Record<string, { toolName: string; toolCallId: string; status: string; autoApprove?: boolean }> = {}
): boolean {
  const runtimeSessionId = String(session.runtimeSessionId || '').trim()
  if (!session.isPending || !runtimeSessionId) return false
  return Object.values(requests).some((entry) =>
    entry.toolName === 'AskUserQuestion' &&
    !entry.autoApprove &&
    entry.toolCallId?.startsWith(`${runtimeSessionId}:`) &&
    ['pending', 'submitting-allow', 'submitting-deny'].includes(entry.status)
  )
}

export function isChatSessionPending(flags: ChatSessionCompletionFlags = {}): boolean {
  return Boolean(flags.isPending)
}

/**
 * 会话“已完结”的统一语义：
 * - 已收到完成信号
 * - 当前不再处于进行中
 */
export function isChatSessionCompleted(flags: ChatSessionCompletionFlags = {}): boolean {
  return Boolean(flags.isFulfilled) && !isChatSessionPending(flags)
}
