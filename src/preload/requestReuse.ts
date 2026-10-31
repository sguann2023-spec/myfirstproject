export function createSuccessfulRequestCache<T>(
  request: () => Promise<T>,
  isCacheable: (value: T) => boolean
) {
  let cached: { value: T } | undefined
  let pending: Promise<T> | undefined
  let generation = 0

  return {
    get(): Promise<T> {
      if (cached) return Promise.resolve(cached.value)
      if (pending) return pending
      const version = generation
      const task = Promise.resolve().then(request).then((value) => {
        if (version === generation && isCacheable(value)) cached = { value }
        return value
      })
      pending = task
      const clear = () => { if (pending === task) pending = undefined }
      void task.then(clear, clear)
      return task
    },
    invalidate(): void {
      generation += 1
      cached = undefined
      pending = undefined
    }
  }
}

type Operation = 'subscribe' | 'unsubscribe'
interface SubscriptionResult {
  success: boolean
  error?: string
}

export function createSubscriptionRequests(
  request: (operation: Operation, sessionId: string) => Promise<SubscriptionResult>
) {
  interface State {
    active?: SubscriptionResult
    tail?: Promise<SubscriptionResult>
    lastOperation?: Operation
  }
  const sessions = new Map<string, State>()

  const enqueue = (operation: Operation, sessionId: string): Promise<SubscriptionResult> => {
    let state = sessions.get(sessionId)
    if (!state) {
      state = {}
      sessions.set(sessionId, state)
    }
    const entry = state
    if (entry.tail && entry.lastOperation === operation) return entry.tail
    if (!entry.tail && operation === 'subscribe' && entry.active) return Promise.resolve(entry.active)

    // Preserve subscribe -> unsubscribe -> subscribe ordering across asynchronous IPC.
    const task = (entry.tail ?? Promise.resolve()).catch(() => undefined).then(async () => {
      if (operation === 'subscribe' && entry.active) return entry.active
      entry.active = undefined
      const result = await request(operation, sessionId)
      if (operation === 'subscribe' && result?.success === true) entry.active = result
      return result
    })
    entry.tail = task
    entry.lastOperation = operation
    const clear = () => {
      if (entry.tail !== task) return
      entry.tail = undefined
      entry.lastOperation = undefined
      if (!entry.active) sessions.delete(sessionId)
    }
    void task.then(clear, clear)
    return task
  }

  return {
    subscribe: (sessionId: string) => enqueue('subscribe', sessionId),
    unsubscribe: (sessionId: string) => enqueue('unsubscribe', sessionId)
  }
}
