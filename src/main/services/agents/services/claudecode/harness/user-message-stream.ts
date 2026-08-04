import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'

export async function createUserMessageStream(input: {
  abortSignal: AbortSignal
  buildInitialMessage: () => Promise<SDKUserMessage>
}): Promise<{
  stream: AsyncIterable<SDKUserMessage>
  enqueue: (value: SDKUserMessage | null) => void
  close: () => void
}> {
  const { abortSignal, buildInitialMessage } = input
  const queue: Array<SDKUserMessage | null> = []
  const waiters: Array<(value: SDKUserMessage | null) => void> = []
  let closed = false

  const flushWaiters = (value: SDKUserMessage | null) => {
    const resolve = waiters.shift()
    if (resolve) {
      resolve(value)
      return true
    }
    return false
  }

  const enqueue = (value: SDKUserMessage | null) => {
    if (closed) return
    if (value === null) {
      closed = true
    }
    if (!flushWaiters(value)) {
      queue.push(value)
    }
  }

  const close = () => {
    if (closed) return
    enqueue(null)
  }

  const onAbort = () => {
    close()
  }

  if (abortSignal.aborted) {
    close()
  } else {
    abortSignal.addEventListener('abort', onAbort, { once: true })
  }

  const iterator = (async function* () {
    try {
      while (true) {
        let value: SDKUserMessage | null
        if (queue.length > 0) {
          value = queue.shift() ?? null
        } else if (closed) {
          break
        } else {
          value = await new Promise<SDKUserMessage | null>((resolve) => {
            waiters.push(resolve)
          })
        }

        if (value === null) {
          break
        }

        yield value
      }
    } finally {
      closed = true
      abortSignal.removeEventListener('abort', onAbort)
      while (waiters.length > 0) {
        const resolve = waiters.shift()
        resolve?.(null)
      }
    }
  })()

  enqueue(await buildInitialMessage())

  return {
    stream: iterator,
    enqueue,
    close
  }
}
