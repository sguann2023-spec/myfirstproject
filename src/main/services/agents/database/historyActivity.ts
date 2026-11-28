// Speculative history recovery must not adopt a snapshot taken between the
// statements of a canonical exchange or migration. This is admission tracking,
// not a database lock; normal writers never wait for background preparation.
const active = new Map<string, number>()
const observers = new Map<string, Set<{ current: boolean }>>()

export function beginHistoryActivity(topicId: string): () => void {
  active.set(topicId, (active.get(topicId) ?? 0) + 1)
  for (const observer of observers.get(topicId) ?? []) observer.current = false
  observers.delete(topicId)
  let released = false
  return () => {
    if (released) return
    released = true
    const remaining = (active.get(topicId) ?? 1) - 1
    if (remaining) active.set(topicId, remaining)
    else active.delete(topicId)
  }
}

export async function withHistoryActivity<T>(topicId: string, operation: () => Promise<T>): Promise<T> {
  const release = beginHistoryActivity(topicId)
  try { return await operation() } finally { release() }
}

export function observeIdleHistory(topicId: string): { isCurrent: () => boolean; release: () => void } | undefined {
  if (active.has(topicId)) return undefined
  const observer = { current: true }
  const pending = observers.get(topicId) ?? new Set<{ current: boolean }>()
  observers.set(topicId, pending)
  pending.add(observer)
  return {
    isCurrent: () => observer.current && !active.has(topicId),
    release: () => {
      observer.current = false
      pending.delete(observer)
      if (!pending.size && observers.get(topicId) === pending) observers.delete(topicId)
    }
  }
}
