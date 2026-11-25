import { isTokenTelemetry, type TokenCategory, type TokenTelemetry, type TokenRequestTelemetry, type TokenContextTelemetry } from '@shared/tokenTelemetry'
import {
  aggregateSessionTokenUsage, mergeLiveTokenMessage, getInternalToolUsage,
  getDisplayUsage, getMessageConversationPoints, getMessageConversationSavingPoints, isThirdPartyBillingModel,
  resolveTokenUsageBlock, extractBillingPointsFromToolResponse,
  type TokenUsageMessage, type TokenUsageBlocksById, type SessionTokenUsageSummary
} from '@renderer/pages/home/Messages/tokenUsage'

export const TOKEN_CATEGORY_COLORS: Record<TokenCategory, string> = {
  system: '#6857ff', user: '#00c853', skills: '#ff6d00', reasoning: '#944dff',
  toolDefinitions: '#ff9800', injections: '#b743f5', toolCalls: '#00b7a5',
  toolResults: '#00b7a5', assistant: '#3383ff', reply: '#ef3299', unattributed: '#9ba3af'
}
export const TOKEN_CATEGORY_ORDER: TokenCategory[] = ['system', 'toolDefinitions', 'user', 'injections', 'skills', 'toolCalls', 'reasoning', 'reply', 'toolResults', 'assistant', 'unattributed']

export type StatsMessage = TokenUsageMessage & {
  tokenTelemetry?: TokenTelemetry
  runtimeSessionId?: string
  topicId?: string
  invocationId?: string
  traceId?: string
  provider?: { requestId?: string }
}
type LiveMessages = Readonly<Record<string, StatsMessage | undefined>>
const id = (value?: string | null) => typeof value === 'string' ? value.trim() : ''
const requestKey = (request: TokenRequestTelemetry) => JSON.stringify([request.runtimeSessionId, request.id])
const invocationKey = (runtime: string, invocation: string) => JSON.stringify([runtime, invocation])
const consumed = (request: TokenRequestTelemetry) => request.status !== 'prepared' || request.attempts > 0

// A tombstone is a context observation too. In particular, never search backwards for a valid one.
function newerContext(old: TokenContextTelemetry | undefined, next: TokenContextTelemetry) {
  if (!old) return next
  const sameContext = next.runtimeSessionId === old.runtimeSessionId && next.id === old.id
  // Revisions are local to a context/invocation, never a clock across invocations.
  const order = sameContext ? next.revision - old.revision : next.observedAt - old.observedAt
  if (order > 0) return next
  if (order === 0 && (next.observedAt > old.observedAt || (
    next.observedAt === old.observedAt && next.basis === 'invalidated'
  ))) return next
  return old
}
function mergeTelemetry(candidates: unknown[], runtime = ''): TokenTelemetry {
  const requests = new Map<string, TokenRequestTelemetry>()
  let context: TokenContextTelemetry | undefined
  for (const candidate of candidates) {
    if (!isTokenTelemetry(candidate)) continue
    for (const request of candidate.requests) {
      if (runtime && request.runtimeSessionId !== runtime) continue
      const key = requestKey(request)
      const old = requests.get(key)
      if (!old || request.revision > old.revision) requests.set(key, request)
    }
    if (candidate.context && (!runtime || candidate.context.runtimeSessionId === runtime)) {
      context = newerContext(context, candidate.context)
    }
  }
  return { version: 1, requests: [...requests.values()], ...(context ? { context } : {}) }
}
function inRuntime(message: StatsMessage, runtime: string) {
  if (!runtime) return true
  if (message.runtimeSessionId) return message.runtimeSessionId === runtime
  if (message.topicId?.startsWith('agent-session:')) return message.topicId === `agent-session:${runtime}`
  const telemetry = message.tokenTelemetry
  if (!isTokenTelemetry(telemetry)) return true // Legacy session entries have no runtime tag.
  const owners = [...telemetry.requests.map(request => request.runtimeSessionId), ...(telemetry.context ? [telemetry.context.runtimeSessionId] : [])]
  return !owners.length || owners.includes(runtime)
}

/** Union both aliases, including bridges that arrive after either snapshot. */
function messageGroups(messages: readonly StatsMessage[], live: LiveMessages = {}, runtime = ''): StatsMessage[][] {
  const entries = messages.filter(message => message && inRuntime(message, runtime))
  const referenced = new Set(entries.flatMap(message => [id(message.id), id(message.storeAssistantMessageId)]).filter(Boolean))
  const liveEntries = new Set<StatsMessage>()
  // Follow aliases transitively, but never append unrelated Redux messages.
  for (const alias of referenced) {
    const message = live[alias]
    if (!message || !inRuntime(message, runtime) || liveEntries.has(message)) continue
    const owner = entries.find(item => id(item.id) === alias || id(item.storeAssistantMessageId) === alias)
    const role = message.role || owner?.role
    if (owner?.role && role !== owner.role) continue
    liveEntries.add(message)
    if (id(message.id)) referenced.add(id(message.id))
    if (id(message.storeAssistantMessageId)) referenced.add(id(message.storeAssistantMessageId))
    // The lookup key is itself an alias, even if Redux's value has a different ID.
    entries.push({ id: alias, storeAssistantMessageId: message.id || message.storeAssistantMessageId, role })
    entries.push({ ...message, role, id: message.id || alias })
  }
  const parents = entries.map((_, index) => index)
  const root = (index: number): number => {
    while (parents[index] !== index) { parents[index] = parents[parents[index]]; index = parents[index] }
    return index
  }
  const aliases = new Map<string, number>()
  entries.forEach((message, index) => {
    for (const alias of [id(message.id), id(message.storeAssistantMessageId)]) {
      if (!alias) continue
      // Role is part of identity: a malformed user alias cannot erase assistant accounting.
      const key = JSON.stringify([message.role, alias])
      const previous = aliases.get(key)
      if (previous !== undefined) parents[root(index)] = root(previous)
      aliases.set(key, index)
    }
  })
  const groups = new Map<number, StatsMessage[]>()
  entries.forEach((message, index) => {
    const key = root(index)
    const group = groups.get(key) || []
    group.push(message)
    groups.set(key, group)
  })
  return [...groups.values()]
}
function mergeGroup(group: StatsMessage[]): StatsMessage {
  const message = group.reduce((previous, next) => mergeLiveTokenMessage(previous, next))
  const candidates = group.map(item => item.tokenTelemetry)
  return candidates.some(isTokenTelemetry) ? { ...message, tokenTelemetry: mergeTelemetry(candidates) } : message
}

export function mergeStatsMessages(history: readonly StatsMessage[] = [], messages: readonly StatsMessage[] = []) {
  return messageGroups([...history, ...messages]).map(mergeGroup)
}

/** Cost uses full session messages, not the content-free authoritative token projection. */
export function buildSessionCostModel(messages: readonly StatsMessage[], live: LiveMessages = {}, blocks: TokenUsageBlocksById = {}, runtime = '') {
  let conversationPoints = 0
  let toolPoints = 0
  let savingPoints = 0
  let incomplete = false
  let conversationIncomplete = false
  let toolsIncomplete = false
  let hasKnownCost = false
  let hasExternalBilling = false
  const toolTotals = new Map<string, number>()
  const groups = messageGroups(messages.filter(message => message?.role === 'assistant'), live, runtime)
  const seenBlocks = new Set<string>()
  for (const group of groups) {
    const message = mergeGroup(group)
    const external = isThirdPartyBillingModel(message.model)
    const usage = getDisplayUsage(message)
    hasExternalBilling ||= external
    const pricingKnown = Boolean(message.model?.pricing && Object.values(message.model.pricing).some(value => typeof value === 'number' && Number.isFinite(value) && value >= 0))
    if (external || (usage && pricingKnown)) {
      conversationPoints += Math.max(0, getMessageConversationPoints(message))
      savingPoints += Math.max(0, getMessageConversationSavingPoints(message))
      hasKnownCost = true
    } else { incomplete = true; conversationIncomplete = true }
    incomplete ||= Boolean(message.error) || message.status === 'error' || Boolean(message.aborted)
    if (!Array.isArray(message.blocks)) { incomplete = true; toolsIncomplete = true }
    for (const ref of message.blocks || []) {
      const block = resolveTokenUsageBlock(ref, blocks)
      if (!block) { incomplete = true; toolsIncomplete = true; continue }
      if (block.id && seenBlocks.has(block.id)) continue
      if (block.id) seenBlocks.add(block.id)
      if (block.type !== 'tool') continue
      const response = block.metadata?.rawMcpToolResponse
      const name = (block.toolName || response?.tool?.name || response?.toolName || '').trim()
      // Execution containers may echo the inner tool's billing payload.
      if (name.toLowerCase() === 'codemode') continue
      const points = extractBillingPointsFromToolResponse(response)
      if (Number.isFinite(points) && points > 0) {
        toolPoints += points
        hasKnownCost = true
        toolTotals.set(name, (toolTotals.get(name) || 0) + points)
      }
    }
    const missingToolBilling = getInternalToolUsage(message, blocks).missingBilling
    toolsIncomplete ||= missingToolBilling
    incomplete ||= missingToolBilling
  }
  const toolDetails = Array.from(toolTotals, ([label, value]) => ({ label, value }))
  return { conversationPoints, toolPoints, totalPoints: conversationPoints + toolPoints, savingPoints, toolDetails,
    messageCount: groups.length, hasKnownCost, incomplete, conversationIncomplete, toolsIncomplete, hasExternalBilling }
}
function collect(messages: readonly StatsMessage[], live: LiveMessages, runtime: string, persisted?: TokenTelemetry) {
  const groups = messageGroups(messages.filter(message => message?.role === 'assistant'), live, runtime)
  const telemetry = mergeTelemetry([...groups.flatMap(group => group.map(message => message.tokenTelemetry)), persisted], runtime)
  return { groups, telemetry }
}

export function buildTokenStatsModel(messages: readonly StatsMessage[] = [], liveMessages: LiveMessages = {}, runtimeSessionId = '', persisted?: TokenTelemetry) {
  const { groups, telemetry } = collect(messages, liveMessages, runtimeSessionId, persisted)
  const invocations = new Set(telemetry.requests.map(request => invocationKey(request.runtimeSessionId, request.invocationId)))
  const missingHistory = groups.some(group => !group.some(message => {
    const data = mergeTelemetry([message.tokenTelemetry], runtimeSessionId)
    return data.requests.length || messageInvocations(message, runtimeSessionId, telemetry.requests).some(key => invocations.has(key))
  }))
  const categories: Partial<Record<TokenCategory, number>> = {}
  let estimateTotal = 0, partial = false, hasEstimatedUsage = false, requestCount = 0
  for (const request of telemetry.requests) {
    if (!consumed(request)) continue
    requestCount++
    if (request.status !== 'completed') partial = true
    for (const breakdown of [request.input, request.output]) {
      if (!breakdown) { partial = true; continue }
      if (breakdown.status !== 'estimated') partial = true
      hasEstimatedUsage ||= breakdown.status !== 'unknown'
      // Input and output are disjoint payloads. Sum their exclusive categories, never add
      // breakdown.total, provider totals, cache or reasoning detail on top of them.
      let subtotal = 0
      for (const key of TOKEN_CATEGORY_ORDER) {
        const value = breakdown.categories[key]
        if (value === undefined) continue
        hasEstimatedUsage = true
        categories[key] = (categories[key] || 0) + value
        subtotal += value
      }
      estimateTotal += subtotal
      if (subtotal !== breakdown.total) partial = true
    }
  }
  const segments = TOKEN_CATEGORY_ORDER.filter(key => categories[key] !== undefined).map(key => ({ key, value: categories[key]!, color: TOKEN_CATEGORY_COLORS[key] }))
  return { telemetry, context: telemetry.context, segments, estimateTotal, hasEstimatedUsage, partial, missingHistory, requestCount }
}

function messageInvocations(message: StatsMessage, runtime: string, requests: readonly TokenRequestTelemetry[]): string[] {
  const direct = [message.invocationId, message.traceId, message.provider?.requestId].filter((value): value is string => !!value)
  const data = mergeTelemetry([message.tokenTelemetry], runtime)
  const owner = runtime || message.runtimeSessionId || (message.topicId?.startsWith('agent-session:') ? message.topicId.slice(14) : '')
  const keys = data.requests.map(request => invocationKey(request.runtimeSessionId, request.invocationId))
  for (const value of direct) {
    if (owner) { keys.push(invocationKey(owner, value)); continue }
    // Legacy entries often expose only traceId. Infer the owner only when unambiguous;
    // never link an invocation string shared by multiple runtime sessions.
    const owners = new Set(requests.filter(request => request.invocationId === value).map(request => request.runtimeSessionId))
    if (owners.size === 1) keys.push(invocationKey([...owners][0], value))
  }
  return keys
}

/**
 * Provider-reported known subtotals, with exactly the aggregateSessionTokenUsage shape.
 * A ledger owns the entire invocation (including compaction and missing reports), replacing
 * usage/usageSteps/metrics, not supplementing them. Legacy messages retain the original fallback.
 * Tool-internal accounting remains delegated to the existing aggregator. Persisted-only
 * invocations count as one synthetic assistant entry; revisions/requests never inflate it.
 */
export function buildReportedTokenSummary(
  messages: readonly StatsMessage[] = [], liveMessages: LiveMessages = {}, blocks: TokenUsageBlocksById = {},
  runtimeSessionId = '', persisted?: TokenTelemetry
): SessionTokenUsageSummary {
  const { groups, telemetry } = collect(messages, liveMessages, runtimeSessionId, persisted)
  const byInvocation = new Map<string, TokenRequestTelemetry[]>()
  for (const request of telemetry.requests) {
    const key = invocationKey(request.runtimeSessionId, request.invocationId)
    const requests = byInvocation.get(key) || []
    requests.push(request)
    byInvocation.set(key, requests)
  }
  const summary = aggregateSessionTokenUsage([])
  const seen = new Set<string>()
  const claimed = new Set<string>()
  const add = (part: SessionTokenUsageSummary) => {
    for (const key of ['promptTokens', 'completionTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'messageCount', 'reportedMessageCount', 'unknownMessageCount'] as const) summary[key] += part[key]
    summary.hasReportedUsage ||= part.hasReportedUsage
    summary.incomplete ||= part.incomplete
  }
  const ledgerSummary = (message: StatsMessage, requests: TokenRequestTelemetry[]) => {
    const unique = requests.filter(request => {
      const key = requestKey(request)
      if (seen.has(key)) return false
      seen.add(key)
      return consumed(request)
    })
    const tools = getInternalToolUsage(message, blocks)
    // Explicit main zero lets the existing helper account only for tools, without marking
    // their absent outer usage unknown. Ledger completeness is applied below instead.
    const part = aggregateSessionTokenUsage([{ ...message, role: 'assistant', usageSteps: [], metrics: null,
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }], {}, blocks)
    if (!unique.length && !tools.hasReportedUsage && !tools.incomplete) return
    let known = tools.hasReportedUsage
    for (const request of unique) {
      const report = request.reported
      const input = report?.inputTokens ?? null, output = report?.outputTokens ?? null
      const total = report?.totalTokens ?? (input !== null && output !== null ? input + output : null)
      known ||= input !== null || output !== null || total !== null
      part.promptTokens += input ?? 0
      part.completionTokens += output ?? 0
      part.totalTokens += total ?? 0
      part.cacheReadTokens += report?.cacheReadTokens ?? 0
      part.cacheWriteTokens += report?.cacheWriteTokens ?? 0
      part.incomplete ||= request.status !== 'completed' || input === null || output === null || total === null
    }
    part.hasReportedUsage = known
    part.reportedMessageCount = Number(known)
    part.unknownMessageCount = Number(!known)
    add(part)
  }
  for (const group of groups) {
    const message = mergeGroup(group)
    const keys = new Set(group.flatMap(item => messageInvocations(item, runtimeSessionId, telemetry.requests)).filter(key => byInvocation.has(key)))
    if (!keys.size) { add(aggregateSessionTokenUsage([message], {}, blocks)); continue }
    const requests = [...keys].flatMap(key => { claimed.add(key); return byInvocation.get(key)! })
    ledgerSummary(message, requests)
  }
  for (const [key, requests] of byInvocation) {
    if (!claimed.has(key)) ledgerSummary({ role: 'assistant' }, requests)
  }
  return summary
}
