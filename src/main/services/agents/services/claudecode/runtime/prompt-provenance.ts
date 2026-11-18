import { createHash } from 'node:crypto'
import type { TokenCategory } from '@shared/tokenTelemetry'

export type PromptTokenSource = { text: string; category: TokenCategory; role: 'system' | 'user' }
// Invocation-local prompt snapshots can be assembled in several layers. This
// bounded, in-memory sidecar preserves producer attribution without prompt tags.
const sidecars = new Map<string, PromptTokenSource[]>()
const key = (text: string) => createHash('sha256').update(text).digest('hex')
export function registerPromptTokenSources(text: string, sources: PromptTokenSource[]): string {
  sidecars.set(key(text), sources)
  if (sidecars.size > 128) sidecars.delete(sidecars.keys().next().value!)
  return text
}
export function getPromptTokenSources(text: string | undefined): PromptTokenSource[] {
  return typeof text === 'string' ? sidecars.get(key(text)) || [] : []
}
