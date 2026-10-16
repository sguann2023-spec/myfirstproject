export interface MediaTimingSource {
  source_timerange?: { start?: number; end?: number; duration?: number } | null
}

// Draft media metadata and ranges both use integer microseconds, never timeline seconds.
export function mediaDurationMicros(item: MediaTimingSource, material?: { duration?: unknown }): number | undefined {
  const range = item.source_timerange
  const start = range?.start ?? 0
  if (!Number.isSafeInteger(start) || start < 0) return undefined
  const duration = range?.duration ?? (range?.end !== undefined ? range.end - start
    : typeof material?.duration === 'number' ? material.duration - start : undefined)
  return duration !== undefined && Number.isSafeInteger(duration) && duration > 0 ? duration : undefined
}
