export type ChatSessionCompletionFlags = {
  isPending?: boolean | null
  isFulfilled?: boolean | null
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
