export const MAX_MEDIA_LOOP_ACTIONS = 10_000

export function mediaLoopSlices(
  start: number, end: number, nominalStart: number, sourceStart: number, sourceDuration: number
) {
  const [first, last, origin, source, cycle] = [start, end, nominalStart, sourceStart, sourceDuration]
    .map(value => Math.round(value * 1_000_000))
  if (![first, last, origin, source, cycle].every(Number.isSafeInteger) || cycle <= 0) {
    throw new Error('媒体循环需要有效的源时长')
  }
  const slices: Array<{ target_start: number; start: number; end: number; duration: number }> = []
  let cursor = first
  let phase = ((first - origin) % cycle + cycle) % cycle
  while (cursor < last) {
    if (slices.length === MAX_MEDIA_LOOP_ACTIONS) throw new Error('媒体循环次数超过 10000，请延长源区间或缩短目标时长')
    const duration = Math.min(last - cursor, cycle - phase)
    slices.push({
      target_start: cursor / 1_000_000, start: (source + phase) / 1_000_000,
      end: (source + phase + duration) / 1_000_000, duration: duration / 1_000_000
    })
    cursor += duration
    phase = 0
  }
  return slices
}
