import { loggerService } from '@logger'

import type { ActiveIntentDomain, IntentDomain, RuntimeToolLayer } from './capability-router'

const logger = loggerService.withContext('PromptBudgetProbe')
const previousFingerprintsBySession = new Map<string, RequestFingerprints>()

type Segment = {
  name: string
  chars: number
  approxTokens: number
  hash: string
}

type RequestFingerprints = {
  model: string
  system: string
  tools: string
  mcp: string
  skills: string
  messages: string
}

type PromptShapeSummary = {
  chars: number
  lines: number
  hasDataUrl: boolean
  hasBase64Marker: boolean
  headPreview: string
  tailPreview: string
}

export function logPromptBudgetProbe(args: {
  agentId: string
  sessionId: string
  traceId?: string
  segmentId?: string
  parentSegmentId?: string
  model: string
  toolLayer: RuntimeToolLayer
  activeDomains?: ActiveIntentDomain[]
  primaryDomain?: IntentDomain
  subdomains?: string[]
  companionDomains?: IntentDomain[]
  prompt: string
  systemPrompt: unknown
  builtinTools: string[]
  allowedTools: string[]
  mcpServerNames: string[]
  activeSkills: string[]
  selectedCapabilities: string[]
  promptLengths?: Record<string, number>
  systemPromptVersion?: string
  systemPromptHash?: string
  continuationSummaryChars?: number
  recentTurnsCount?: number
  referencedArtifactsCount?: number
}): void {
  const segments: Segment[] = [
    segment('userPrompt', args.prompt),
    segment('systemPrompt', args.systemPrompt),
    segment('builtinTools', args.builtinTools),
    segment('autoAllowedTools', args.allowedTools),
    segment('mcpServers', args.mcpServerNames),
    segment('activeSkills', args.activeSkills)
  ]

  if (args.promptLengths) {
    for (const [name, length] of Object.entries(args.promptLengths)) {
      segments.push({
        name: `promptLength:${name}`,
        chars: length,
        approxTokens: estimateTokensFromChars(length),
        hash: hashStable(length)
      })
    }
  }

  const fingerprints: RequestFingerprints = {
    model: hashStable(args.model),
    system: hashStable(args.systemPrompt),
    tools: hashStable(args.builtinTools),
    mcp: hashStable(args.mcpServerNames),
    skills: hashStable(args.activeSkills),
    messages: hashStable(args.prompt)
  }
  const previous = previousFingerprintsBySession.get(args.sessionId)
  previousFingerprintsBySession.set(args.sessionId, fingerprints)
  const promptShape = summarizePromptShape(args.prompt)

  const changed = previous
    ? (Object.keys(fingerprints) as Array<keyof RequestFingerprints>).filter((key) => previous[key] !== fingerprints[key])
    : []

  logger.info('[PromptBudget] request surface', {
    agentId: args.agentId,
    sessionId: args.sessionId,
    traceId: args.traceId,
    segmentId: args.segmentId,
    parentSegmentId: args.parentSegmentId,
    model: args.model,
    toolLayer: args.toolLayer,
    activeDomains: args.activeDomains ?? [],
    primaryDomain: args.primaryDomain,
    subdomains: args.subdomains ?? [],
    companionDomains: args.companionDomains ?? [],
    selectedCapabilities: args.selectedCapabilities,
    systemPromptVersion: args.systemPromptVersion,
    systemPromptHash: args.systemPromptHash,
    continuationSummaryChars: args.continuationSummaryChars ?? 0,
    recentTurnsCount: args.recentTurnsCount ?? 0,
    referencedArtifactsCount: args.referencedArtifactsCount ?? 0,
    segments,
    approxTotalTokens: segments.reduce((total, item) => total + item.approxTokens, 0),
    promptShape,
    fingerprints,
    fingerprintChanged: previous ? changed : ['first-request'],
    cacheRisk: classifyCacheRisk(changed)
  })

  logger.info('[PromptCache] fingerprint', {
    sessionId: args.sessionId,
    traceId: args.traceId,
    segmentId: args.segmentId,
    modelHash: fingerprints.model,
    systemHash: fingerprints.system,
    toolsHash: fingerprints.tools,
    messagesHash: fingerprints.messages,
    fingerprintChanged: previous ? changed : ['first-request']
  })

  if (previous && changed.some((item) => item !== 'messages')) {
    logger.warn('[PromptCache] break-detected', {
      sessionId: args.sessionId,
      traceId: args.traceId,
      segmentId: args.segmentId,
      changed,
      cacheRisk: classifyCacheRisk(changed),
      expectedInvalidation: true
    })
  }
}

function segment(name: string, value: unknown): Segment {
  const text = stringifyStable(value)
  const chars = text.length
  return {
    name,
    chars,
    approxTokens: estimateTokensFromChars(chars),
    hash: hashText(text)
  }
}

function estimateTokensFromChars(chars: number): number {
  return Math.ceil(chars / 4)
}

function classifyCacheRisk(changed: string[]): 'unknown' | 'low' | 'expected-break' {
  if (changed.length === 0) return 'low'
  if (changed.length === 1 && changed[0] === 'messages') return 'low'
  return changed.length > 0 ? 'expected-break' : 'unknown'
}

function hashStable(value: unknown): string {
  return hashText(stringifyStable(value))
}

function summarizePromptShape(prompt: string): PromptShapeSummary {
  const text = String(prompt || '')
  return {
    chars: text.length,
    lines: text ? text.split('\n').length : 0,
    hasDataUrl: /data:image\/[a-zA-Z0-9.+-]+;base64,/.test(text),
    hasBase64Marker: /base64,/i.test(text),
    headPreview: text.slice(0, 240),
    tailPreview: text.slice(Math.max(0, text.length - 240))
  }
}

function stringifyStable(value: unknown): string {
  if (value === undefined) return ''
  if (value === null) return 'null'
  if (typeof value !== 'object') return String(value)
  if (Array.isArray(value)) return `[${value.map((item) => stringifyStable(item)).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stringifyStable(record[key])}`)
    .join(',')}}`
}

function hashText(text: string): string {
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i))
    hash = (hash * prime) & 0xffffffffffffffffn
  }
  return hash.toString(16).padStart(16, '0')
}
