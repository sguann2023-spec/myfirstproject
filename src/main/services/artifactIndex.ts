import Store from 'electron-store'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export const artifactTypes = ['draft', 'video', 'image', 'audio', 'document'] as const
export type ArtifactType = typeof artifactTypes[number]
export type Artifact = {
  id: string; type: ArtifactType; runtimeSessionId: string; createdAt: number
  url?: string; filePath?: string; draftId?: string; taskId?: string; source?: string; name?: string
}
let store: Store | undefined
function storage() { return store ??= new Store({ name: 'session-artifacts' }) }
function key(session: string) { return `sessions.${Buffer.from(session).toString('hex')}` }
function location(item: Partial<Artifact>) {
  if (item.filePath) return path.normalize(item.filePath)
  if (item.url) { const url = new URL(item.url); url.hash = ''; return url.href }
  return undefined
}
export function listArtifacts(runtimeSessionId: string, type?: ArtifactType): Artifact[] {
  if (!runtimeSessionId?.trim()) throw new Error('A reliable runtime session is required')
  const stored = storage().get(key(runtimeSessionId), [])
  const items = Array.isArray(stored) ? stored as Artifact[] : []
  // Legacy entries may hold "pending:" placeholder draft IDs from the pre-registration event flow.
  return items.filter(item => (!type || item.type === type)
    && !(item.type === 'draft' && item.draftId?.startsWith('pending:')))
}
export function registerArtifact(input: Omit<Artifact, 'id' | 'createdAt'> & Partial<Pick<Artifact, 'id' | 'createdAt'>>): Artifact {
  if (!artifactTypes.includes(input.type)) throw new Error('Unsupported artifact type')
  const items = listArtifacts(input.runtimeSessionId)
  const target = location(input)
  if (!input.draftId && !target) throw new Error('An artifact location is required')
  const existing = items.find(item => item.type === input.type && (
    (input.id && item.id === input.id && item.source === input.source) ||
    (input.draftId && item.draftId === input.draftId) ||
    (input.taskId && input.source && item.taskId === input.taskId && item.source === input.source) ||
    (target && location(item) === target)))
  if (existing) return existing
  const item: Artifact = { ...input, id: input.id || randomUUID(), createdAt: input.createdAt ?? Date.now() }
  storage().set(key(input.runtimeSessionId), [...items, item])
  return item
}
