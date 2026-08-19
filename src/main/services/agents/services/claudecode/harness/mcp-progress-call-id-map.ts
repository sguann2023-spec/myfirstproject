const providerToEmittedCallIdMap = new Map<string, string>()

export function registerMcpProgressCallId(providerToolCallId: string, emittedToolCallId: string): void {
  const providerId = String(providerToolCallId || '').trim()
  const emittedId = String(emittedToolCallId || '').trim()
  if (!providerId || !emittedId) return
  providerToEmittedCallIdMap.set(providerId, emittedId)
}

export function resolveMcpProgressCallIds(providerToolCallId: string): string[] {
  const providerId = String(providerToolCallId || '').trim()
  if (!providerId) return []

  const emittedId = providerToEmittedCallIdMap.get(providerId)
  if (!emittedId || emittedId === providerId) {
    return [providerId]
  }

  return [providerId, emittedId]
}

export function unregisterMcpProgressCallId(providerToolCallId: string, emittedToolCallId?: string): void {
  const providerId = String(providerToolCallId || '').trim()
  const emittedId = String(emittedToolCallId || '').trim()

  if (providerId) {
    providerToEmittedCallIdMap.delete(providerId)
  }

  if (!emittedId) return

  for (const [providerKey, mappedEmittedId] of providerToEmittedCallIdMap.entries()) {
    if (mappedEmittedId === emittedId) {
      providerToEmittedCallIdMap.delete(providerKey)
    }
  }
}
