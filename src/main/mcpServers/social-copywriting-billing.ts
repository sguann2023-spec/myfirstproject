type RecordValue = Record<string, unknown>
type Stage = 'parse_share_link' | 'asr' | 'analyze_prompt'
const STAGES: Stage[] = ['parse_share_link', 'asr', 'analyze_prompt']
const POINT_KEYS = ['total_consumed_points', 'points_consumed', 'consume']
const TOKEN_KEYS = ['prompt_tokens', 'completion_tokens', 'total_tokens', 'input_tokens', 'output_tokens']

const asRecord = (value: unknown): RecordValue | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null

const asNumber = (value: unknown): number | undefined => {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return undefined
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : undefined
}

function findRecord<T>(value: unknown, read: (record: RecordValue) => T | undefined, depth = 0): T | undefined {
  if (depth > 6) return undefined
  const record = asRecord(value)
  if (!record) return undefined
  const found = read(record)
  if (found !== undefined) return found
  for (const key of ['result', 'response', 'data', 'output']) {
    const nested = findRecord(record[key], read, depth + 1)
    if (nested !== undefined) return nested
  }
  return undefined
}

type StageCharge = {
  stage: Stage
  task_id?: string
  points_consumed?: number
  usage?: Record<string, number>
}

// One snapshot per stage/task: submit and repeated status responses are not separate charges.
export class SocialCopywritingBilling {
  private stages = new Map<Stage, StageCharge>()

  record(stage: Stage, payload: unknown) {
    const points = findRecord(payload, (record) => {
      for (const source of [asRecord(record.billing), record]) {
        for (const key of POINT_KEYS) {
          const value = asNumber(source?.[key])
          if (value !== undefined) return value
        }
      }
      return undefined
    })
    const usage = findRecord(payload, (record) => {
      const value = asRecord(record.usage)
      if (!value) return undefined
      const tokens = Object.fromEntries(TOKEN_KEYS.flatMap((key) => {
        const number = asNumber(value[key])
        return number === undefined ? [] : [[key, number]]
      }))
      return Object.keys(tokens).length ? tokens : undefined
    })
    const taskId = asRecord(payload)?.task_id
    const previous = this.stages.get(stage)
    this.stages.set(stage, {
      ...previous,
      stage,
      ...(typeof taskId === 'string' ? { task_id: taskId } : {}),
      ...(points !== undefined ? { points_consumed: points } : {}),
      ...(usage ? { usage } : {})
    })
  }

  snapshot() {
    const stages = STAGES.map((stage) => this.stages.get(stage) || { stage })
    const known = stages.filter((stage) => stage.points_consumed !== undefined)
    const missing = stages.filter((stage) => stage.points_consumed === undefined).map((stage) => stage.stage)
    const usage: Record<string, number> = {}
    for (const stage of stages) {
      const prompt = stage.usage?.prompt_tokens ?? stage.usage?.input_tokens
      const completion = stage.usage?.completion_tokens ?? stage.usage?.output_tokens
      const total = stage.usage?.total_tokens ?? (
        prompt !== undefined && completion !== undefined ? prompt + completion : undefined
      )
      for (const [key, value] of Object.entries({ prompt_tokens: prompt, completion_tokens: completion, total_tokens: total })) {
        if (value !== undefined) usage[key] = (usage[key] || 0) + value
      }
    }
    return {
      billing: {
        ...(known.length ? {
          total_consumed_points: Number(known.reduce((sum, stage) => sum + stage.points_consumed!, 0).toFixed(10))
        } : {}),
        complete: missing.length === 0,
        missing_stages: missing,
        stages
      },
      ...(Object.keys(usage).length ? { usage } : {})
    }
  }
}
