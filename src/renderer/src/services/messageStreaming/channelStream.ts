import type { TextStreamPart } from 'ai'

export function createChannelEventStream() {
  type Part = TextStreamPart<Record<string, any>>
  let controller: ReadableStreamDefaultController<Part>
  let closed = false
  const stream = new ReadableStream<Part>({
    start(value) { controller = value }
  })
  return {
    stream,
    pushChunk(chunk: Part) {
      if (!closed) controller.enqueue(chunk)
    },
    complete() {
      if (closed) return
      closed = true
      controller.close()
    },
    error(error: Error) {
      if (closed) return
      closed = true
      // ReadableStream.error() discards queued usage/tool results. A terminal
      // event preserves FIFO delivery and invokes the adapter's error cleanup.
      controller.enqueue({ type: 'error', error })
      controller.close()
    }
  }
}
