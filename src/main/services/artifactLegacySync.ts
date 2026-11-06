import { artifactTypes, listArtifacts, registerArtifact } from './artifactIndex'

// Called only by the trusted main-window IPC after resolving the exact session.
export function syncLegacyArtifacts(sessionId: string, items: unknown) {
  for (const item of Array.isArray(items) ? items.slice(0, 1000) : []) {
    if (!item || item.runtimeSessionId !== sessionId || !artifactTypes.includes(item.type) || item.type === 'document') continue
    const fields: any = { runtimeSessionId: sessionId, type: item.type }
    for (const key of ['id', 'draftId', 'taskId', 'source', 'name']) if (typeof item[key] === 'string') fields[key] = item[key].slice(0, 4096)
    if (typeof item.url === 'string') {
      try { const url = new URL(item.url); if (!['https:', 'http:'].includes(url.protocol)) continue; fields.url = url.href } catch { continue }
    }
    if (fields.draftId || fields.url) registerArtifact(fields)
  }
  return listArtifacts(sessionId)
}
