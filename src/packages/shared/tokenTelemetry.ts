export type TokenCategory = 'system' | 'user' | 'skills' | 'injections' | 'toolDefinitions' | 'toolCalls' | 'toolResults' | 'assistant' | 'reasoning' | 'reply' | 'unattributed'
export type TokenBreakdown = {
  categories: Partial<Record<TokenCategory, number>>
  total: number
  status: 'estimated' | 'partial' | 'unknown'
  method: string
  unknownReasons?: string[]
}
export type TokenRequestTelemetry = {
  id: string
  revision: number
  runtimeSessionId: string
  invocationId: string
  sequence: number
  modelId: string
  providerId: string
  operation: string
  status: 'prepared' | 'completed' | 'failed' | 'aborted'
  startedAt: number
  completedAt?: number
  attempts: number
  input: TokenBreakdown
  output?: TokenBreakdown
  reported?: {
    inputTokens: number | null
    outputTokens: number | null
    totalTokens: number | null
    cacheReadTokens: number | null
    cacheWriteTokens: number | null
    reasoningTokens: number | null
  }
}
export type TokenContextTelemetry = {
  id: string
  revision: number
  runtimeSessionId: string
  modelId: string
  providerId: string
  observedAt: number
  basis: 'request' | 'post-response' | 'post-compaction' | 'invalidated'
  validity: 'valid' | 'stale' | 'unknown'
  input: TokenBreakdown
  contextWindowTokens: number | null
  reason?: string
}
export type TokenTelemetry = { version: 1; requests: TokenRequestTelemetry[]; context?: TokenContextTelemetry }

/** Authoritative session stats; revision is monotonic for this main-process lifetime. */
export type SessionTokenStatsSnapshot = {
  sessionId: string
  revision: number
  contextGeneration: number
  tokenTelemetry: TokenTelemetry
  context: TokenContextTelemetry | null
}

const categories = new Set<TokenCategory>(['system', 'user', 'skills', 'injections', 'toolDefinitions', 'toolCalls', 'toolResults', 'assistant', 'reasoning', 'reply', 'unattributed'])
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const count = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
const breakdown = (v: unknown): v is TokenBreakdown => record(v) && record(v.categories) && count(v.total) && ['estimated', 'partial', 'unknown'].includes(v.status) && typeof v.method === 'string' && Object.entries(v.categories).every(([k, n]) => categories.has(k as TokenCategory) && count(n)) && (v.unknownReasons === undefined || (Array.isArray(v.unknownReasons) && v.unknownReasons.every((s: unknown) => typeof s === 'string')))
export function isTokenTelemetry(value: unknown): value is TokenTelemetry {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.requests)) return false
  if (!value.requests.every((r: unknown) => record(r) && ['id', 'runtimeSessionId', 'invocationId', 'modelId', 'providerId', 'operation'].every(k => typeof r[k] === 'string') && count(r.revision) && count(r.sequence) && count(r.startedAt) && count(r.attempts) && ['prepared', 'completed', 'failed', 'aborted'].includes(r.status) && breakdown(r.input) && (r.output === undefined || breakdown(r.output)) && (r.completedAt === undefined || count(r.completedAt)) && (r.reported === undefined || (record(r.reported) && ['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'].every(k => r.reported[k] === null || count(r.reported[k])))))) return false
  const c = value.context
  return c === undefined || (record(c) && ['id', 'runtimeSessionId', 'modelId', 'providerId'].every(k => typeof c[k] === 'string') && count(c.revision) && count(c.observedAt) && ['request', 'post-response', 'post-compaction', 'invalidated'].includes(c.basis) && ['valid', 'stale', 'unknown'].includes(c.validity) && breakdown(c.input) && (c.contextWindowTokens === null || count(c.contextWindowTokens)) && (c.reason === undefined || typeof c.reason === 'string'))
}

/** Upsert logical requests, never add revisions/attempt token counts together. */
export function mergeTokenTelemetry(previous?: TokenTelemetry, next?: TokenTelemetry): TokenTelemetry {
  const requests = new Map<string, TokenRequestTelemetry>()
  for (const r of [...(previous?.requests || []), ...(next?.requests || [])]) {
    const key = `${r.runtimeSessionId}\0${r.id}`
    const old = requests.get(key)
    if (!old || r.revision > old.revision) requests.set(key, r)
  }
  let context = previous?.context
  const incoming = next?.context
  if (incoming && (!context || incoming.observedAt > context.observedAt || (incoming.observedAt === context.observedAt && incoming.runtimeSessionId === context.runtimeSessionId && (incoming.id !== context.id || incoming.revision > context.revision)))) context = incoming
  return { version: 1, requests: [...requests.values()], ...(context ? { context } : {}) }
}
