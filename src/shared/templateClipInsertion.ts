export interface ClipInterval { id: string; start: number; end: number }

// The renderer preview and committed edit must choose the same insertion point.
export function clipInsertion(start: number, duration: number, clips: ClipInterval[], autoFill = false) {
  const ordered = [...clips].sort((a, b) => a.start - b.start)
  const hit = ordered.find(clip => start >= clip.start && start < clip.end)
  if (hit) start = start < (hit.start + hit.end) / 2 ? hit.start : hit.end
  const following = ordered.filter(clip => clip.start >= start)
  if (autoFill && following[0]?.start > start) duration = Math.min(duration, following[0].start - start)
  let end = start + duration
  const shifts: { id: string; start: number; duration: number }[] = []
  for (const clip of following) {
    const next = Math.max(end, clip.start)
    if (next > clip.start + 0.000001) shifts.push({ id: clip.id, start: next, duration: clip.end - clip.start })
    end = next + clip.end - clip.start
  }
  return { start, duration, shifts }
}
