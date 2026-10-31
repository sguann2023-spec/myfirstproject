import type { AgentPersistedMessage } from '@types'

const timestamp = (value: unknown): number => {
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) {
    const number = Number(value)
    return Number.isFinite(number) ? number : Number.MAX_SAFE_INTEGER
  }
  const parsed = Date.parse(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER
}

/** Legacy row order is authoritative; logical message IDs are never tie breakers. */
export function mergeLegacyHistory(
  canonical: AgentPersistedMessage[],
  legacy: AgentPersistedMessage[]
): AgentPersistedMessage[] {
  const canonicalById = new Map(canonical.map(item => [item.message.id, item]))
  const items = new Map<string, AgentPersistedMessage>()
  for (const item of legacy) {
    if (item.message.id) items.set(item.message.id, canonicalById.get(item.message.id) ?? item)
  }
  const legacyIds = [...items.keys()]
  for (const item of canonical) items.set(item.message.id, item)
  const edges = new Map([...items.keys()].map(id => [id, new Set<string>()]))
  const degree = new Map([...items.keys()].map(id => [id, 0]))
  const connect = (before: string, after: string) => {
    if (before === after || !items.has(before) || !items.has(after) || edges.get(before)!.has(after)) return
    edges.get(before)!.add(after)
    degree.set(after, degree.get(after)! + 1)
  }
  const reaches = (from: string, target: string): boolean => {
    const pending = [from]
    const visited = new Set<string>()
    while (pending.length) {
      const id = pending.pop()!
      if (id === target) return true
      if (visited.has(id)) continue
      visited.add(id)
      pending.push(...(edges.get(id) ?? []))
    }
    return false
  }
  // Explicit parents outrank accidental first-write sequence order.
  for (const [id, item] of items) {
    const parent = (item.message as typeof item.message & { askId?: string }).askId
    if (parent && !reaches(id, parent)) connect(parent, id)
  }
  for (let index = 1; index < legacyIds.length; index++) {
    if (!reaches(legacyIds[index], legacyIds[index - 1])) connect(legacyIds[index - 1], legacyIds[index])
  }
  const legacySet = new Set(legacyIds)
  const legacyOrdinal = new Map(legacyIds.map((id, index) => [id, index]))
  const anchors = canonical.filter(item => legacySet.has(item.message.id)).map(item => legacyOrdinal.get(item.message.id)!)
  const reversedAnchors = anchors.some((ordinal, index) => index > 0 && ordinal < anchors[index - 1])
  const canonicalSpine = reversedAnchors ? canonical.filter(item => !legacySet.has(item.message.id)) : canonical
  for (let index = 1; index < canonicalSpine.length; index++) {
    const before = canonicalSpine[index - 1].message.id
    const after = canonicalSpine[index].message.id
    if (!reaches(after, before)) connect(before, after)
  }
  const ordinal = new Map([...items.keys()].map((id, index) => [id, index]))
  const ready = [...items.keys()].filter(id => degree.get(id) === 0)
  const result: AgentPersistedMessage[] = []
  while (ready.length) {
    ready.sort((a, b) => timestamp(items.get(a)!.message.createdAt) - timestamp(items.get(b)!.message.createdAt) || ordinal.get(a)! - ordinal.get(b)!)
    const id = ready.shift()!
    result.push(items.get(id)!)
    for (const next of edges.get(id)!) {
      degree.set(next, degree.get(next)! - 1)
      if (degree.get(next) === 0) ready.push(next)
    }
  }
  if (result.length !== items.size) throw new Error('Legacy history contains conflicting message order or parent relationships')
  return result
}
