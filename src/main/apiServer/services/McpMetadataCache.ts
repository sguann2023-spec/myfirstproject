import { createHash } from 'crypto'
import { EventEmitter } from 'events'

export const mcpMetadataEvents = new EventEmitter()

/** Response-only metadata: never used for execution or permission decisions. */
export class McpMetadataCache<C, T> {
  private entries = new Map<string, { identity?: string; value?: T; pending?: Promise<void>; error: boolean; retryAt: number; expiresAt: number }>()

  constructor(
    private readonly configuration: (id: string) => Promise<C | null>,
    private readonly load: (config: C) => Promise<T>,
    private readonly ttl = 60_000,
    private readonly backoff = 10_000
  ) {}

  invalidate(id: string) {
    this.entries.delete(id)
  }

  snapshot(id: string): { value?: T; loading: boolean; error: boolean } {
    let entry = this.entries.get(id)
    if (!entry) {
      entry = { error: false, retryAt: 0, expiresAt: 0 }
      this.entries.set(id, entry)
    }
    if (!entry.pending && Date.now() >= entry.retryAt) {
      const current = entry
      current.error = false
      let expired = false
      let timer: ReturnType<typeof setTimeout>
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          expired = true
          reject(new Error('MCP metadata refresh timed out'))
        }, 15_000)
        timer.unref?.()
      })
      const work = Promise.resolve().then(async () => {
        const config = await this.configuration(id)
        if (expired || this.entries.get(id) !== current) return
        // Hash the entire configuration, including name, headers, endpoint, args and env.
        const identity = createHash('sha256').update(JSON.stringify(config)).digest('hex')
        if (identity !== current.identity) {
          current.value = undefined
          current.expiresAt = 0
          current.identity = identity
        }
        if (!config) throw new Error('MCP server unavailable')
        if (current.value !== undefined && Date.now() < current.expiresAt) return
        const value = await this.load(config)
        // Configuration can change while discovery is in flight. Never publish
        // tools from a previous endpoint/credential/name generation.
        const latest = await this.configuration(id)
        if (expired || this.entries.get(id) !== current) return
        if (createHash('sha256').update(JSON.stringify(latest)).digest('hex') !== identity) {
          this.invalidate(id)
          return
        }
        current.value = value
        current.error = false
        current.expiresAt = Date.now() + this.ttl
      })
      current.pending = Promise.race([work, timeout]).catch(() => {
        if (this.entries.get(id) !== current) return
        current.error = true
        current.retryAt = Date.now() + this.backoff
      }).finally(() => {
        clearTimeout(timer!)
        if (this.entries.get(id) === current) current.pending = undefined
      })
    }
    return { value: entry.value, loading: !!entry.pending && (entry.value === undefined || Date.now() >= entry.expiresAt), error: entry.error }
  }
}
