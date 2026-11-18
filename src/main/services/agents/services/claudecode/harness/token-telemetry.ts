import type { TokenBreakdown, TokenCategory, TokenContextTelemetry, TokenRequestTelemetry, TokenTelemetry } from '@shared/tokenTelemetry'

export type TokenProvenance = { text: string; category: TokenCategory; role?: 'system' | 'user' }
const object = (v: any) => v && typeof v === 'object' && !Array.isArray(v)
function estimate(text: string): number {
  let ascii = 0, other = 0
  for (const c of text) c.codePointAt(0)! < 128 ? ascii++ : other++
  return Math.ceil(ascii / 4 + other)
}
/** Content only; never estimate image/base64, credentials, or transport settings. */
export function estimateTokenPayload(payload: any, provenance: TokenProvenance[] = [], output = false): TokenBreakdown {
  const categories: TokenBreakdown['categories'] = {}
  const reasons = new Set<string>(['provider-framing-overhead-not-estimated'])
  const add = (category: TokenCategory, value: unknown) => {
    if (value === undefined || value === null || value === '') return
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    const n = estimate(text)
    categories[category] = (categories[category] || 0) + n
    if (category === 'unattributed') reasons.add('content-provenance-unavailable')
  }
  const text = (value: unknown, fallback: TokenCategory, role: string) => {
    if (typeof value !== 'string') return
    // Match only producer supplied sidecar segments in the matching role, never
    // parse labels in user content. Unmatched bytes stay explicitly unattributed.
    let remaining = value
    const sources = provenance.filter(p => !p.role || p.role === role).sort((a, b) => b.text.length - a.text.length)
    for (const source of sources) {
      if (!source.text) continue
      const index = remaining.indexOf(source.text)
      if (index < 0) continue
      add(source.category, source.text)
      remaining = remaining.slice(0, index) + remaining.slice(index + source.text.length)
    }
    if (remaining.trim()) add(fallback, remaining)
  }
  const content = (value: any, role: string) => {
    const fallback: TokenCategory = role === 'tool' || role === 'toolResult' ? 'toolResults' : role === 'assistant' ? (output ? 'reply' : 'assistant') : 'unattributed'
    if (typeof value === 'string') return text(value, fallback, role)
    if (!Array.isArray(value)) { if (value != null) reasons.add('unsupported-content-shape'); return }
    for (const part of value) {
      if (!object(part)) { reasons.add('unsupported-content-shape'); continue }
      if (part.type === 'text' || part.type === 'input_text' || part.type === 'output_text') text(part.text, fallback, role)
      else if (part.type === 'thinking' || part.type === 'reasoning') add('reasoning', part.thinking ?? part.text)
      else if (part.type === 'tool_use' || part.type === 'toolCall') add('toolCalls', { name: part.name, input: part.input ?? part.arguments })
      else if (part.type === 'tool_result') content(part.content, 'tool')
      else reasons.add('non-text-or-unsupported-content')
    }
  }
  if (!object(payload)) reasons.add('payload-unavailable')
  else {
    if (payload.system !== undefined) content(payload.system, 'system')
    if (Array.isArray(payload.tools)) for (const tool of payload.tools) add('toolDefinitions', tool)
    if (Array.isArray(payload.messages)) for (const message of payload.messages) {
      content(message.content, message.role)
      if (message.tool_calls?.length) add('toolCalls', message.tool_calls)
      if (message.reasoning_content) add('reasoning', message.reasoning_content)
    }
    if (payload.content !== undefined) content(payload.content, payload.role || 'assistant')
  }
  const total = Object.values(categories).reduce((a, b) => a + (b || 0), 0)
  return { categories, total, status: reasons.size ? (total ? 'partial' : 'unknown') : 'estimated', method: 'content-ascii/4-unicode-codepoints-v1', ...(reasons.size ? { unknownReasons: [...reasons] } : {}) }
}

export function createTokenTelemetryCollector(input: {
  runtimeSessionId: string; invocationId: string; modelId: string; providerId: string
  contextWindowTokens?: number; provenance?: TokenProvenance[]
}) {
  const requests = new Map<string, TokenRequestTelemetry>()
  const listeners = new Set<(data: TokenTelemetry) => void>()
  let sequence = 0, contextRevision = 0
  let context: TokenContextTelemetry | undefined
  let closed = false
  const publish = (request?: TokenRequestTelemetry) => {
    if (closed) return
    const data: TokenTelemetry = { version: 1, requests: request ? [request] : [], ...(context ? { context } : {}) }
    for (const listener of listeners) { try { listener(data) } catch { /* telemetry cannot fail a model call */ } }
  }
  const observeContext = (payload: unknown, basis: TokenContextTelemetry['basis'], modelId = input.modelId, providerId = input.providerId, reason?: string) => {
    context = { id: `${input.runtimeSessionId}:${input.invocationId}:context`, revision: ++contextRevision, runtimeSessionId: input.runtimeSessionId, modelId, providerId, observedAt: Date.now(), basis, validity: basis === 'invalidated' ? 'stale' : 'valid', input: estimateTokenPayload(payload, input.provenance), contextWindowTokens: Number.isFinite(input.contextWindowTokens) && input.contextWindowTokens! > 0 && modelId === input.modelId && providerId === input.providerId ? input.contextWindowTokens! : null, ...(reason ? { reason } : {}) }
    publish()
  }
  return {
    observeContext,
    subscribe(listener: (data: TokenTelemetry) => void) {
      listeners.add(listener)
      if (requests.size || context) listener({ version: 1, requests: [...requests.values()], ...(context ? { context } : {}) })
      return () => { listeners.delete(listener) }
    },
    begin(model: any, operation: string) {
      let finished = false
      const modelId = typeof model?.id === 'string' ? model.id : input.modelId
      // Use the configured provider identity, not the synthetic pi adapter ID.
      const providerId = input.providerId
      let request: TokenRequestTelemetry = {
        id: `${input.invocationId}:request:${++sequence}`, revision: 1, runtimeSessionId: input.runtimeSessionId, invocationId: input.invocationId, sequence, modelId, providerId, operation, status: 'prepared', startedAt: Date.now(), attempts: 1, input: estimateTokenPayload(undefined)
      }
      requests.set(request.id, request)
      publish(request)
      return {
        prepared(payload: unknown) {
          if (finished || closed) return
          request = { ...request, revision: request.revision + 1, input: estimateTokenPayload(payload, input.provenance) }
          requests.set(request.id, request)
          if (operation !== 'compaction') observeContext(payload, 'request', modelId, providerId, 'normalized-provider-request-content')
          publish(request)
        },
        attempt() {
          if (!request || finished || closed) return
          request = { ...request, revision: request.revision + 1, attempts: request.attempts + 1 }
          requests.set(request.id, request); publish(request)
        },
        finish(result?: any, error?: unknown) {
          if (finished || closed) return
          finished = true
          if (!request) return
          const stop = result?.stopReason
          const status = stop === 'aborted' || (error as any)?.name === 'AbortError' ? 'aborted' : error || stop === 'error' ? 'failed' : 'completed'
          const n = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null
          const u = result?.usage
          // Pi's input excludes both cache buckets. Missing counts are unknown,
          // never silently coerced to zero; total is derivable only when complete.
          const rawInput = n(u?.input), cacheRead = n(u?.cacheRead), cacheWrite = n(u?.cacheWrite), output = n(u?.output)
          const inputTokens = rawInput !== null && cacheRead !== null && cacheWrite !== null ? rawInput + cacheRead + cacheWrite : null
          const totalTokens = n(u?.totalTokens) ?? (inputTokens !== null && output !== null ? inputTokens + output : null)
          request = { ...request, revision: request.revision + 1, status, completedAt: Date.now(), ...(result ? { output: estimateTokenPayload(result, [], true) } : {}), ...(u ? { reported: { inputTokens, outputTokens: output, totalTokens, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite, reasoningTokens: n(u.reasoning) } } : {}) }
          requests.set(request.id, request)
          publish(request)
        }
      }
    },
    flush(status: 'failed' | 'aborted' = 'failed') {
      for (const request of requests.values()) if (request.status === 'prepared') {
        const terminal = { ...request, revision: request.revision + 1, status, completedAt: Date.now() }
        requests.set(request.id, terminal); publish(terminal)
      }
      if (!closed) publish()
    },
    close() { closed = true; listeners.clear() }
  }
}
export type TokenTelemetryCollector = ReturnType<typeof createTokenTelemetryCollector>
