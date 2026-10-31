import { loggerService } from '@logger'

const logger = loggerService.withContext('PromptBudgetProbe')
const previousFingerprintsBySession = new Map<string, RequestFingerprints>()

type RequestFingerprints = {
  model: string
  system: string
  tools: string
  mcp: string
  skills: string
  messages: string
}

export function logPromptBudgetProbe(args: {
  agentId: string
  sessionId: string
  traceId?: string
  segmentId?: string
  parentSegmentId?: string
  model: string
  prompt: string
  systemPrompt: unknown
  builtinTools: string[]
  autoAllowedTools: string[]
  mcpServerNames: string[]
  activeSkills: string[]
  promptLengths?: Record<string, number>
  systemPromptVersion?: string
  systemPromptHash?: string
  continuationSummaryChars?: number
  recentTurnsCount?: number
  referencedArtifactsCount?: number
}): void {

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

  const changed = previous
    ? (Object.keys(fingerprints) as Array<keyof RequestFingerprints>).filter((key) => previous[key] !== fingerprints[key])
    : []

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

function classifyCacheRisk(changed: string[]): 'unknown' | 'low' | 'expected-break' {
  if (changed.length === 0) return 'low'
  if (changed.length === 1 && changed[0] === 'messages') return 'low'
  return changed.length > 0 ? 'expected-break' : 'unknown'
}

function hashStable(value: unknown): string {
  return hashText(stringifyStable(value))
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
