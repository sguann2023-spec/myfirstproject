import type { DraftScene, DraftTrackItem } from './draftTemplate'

export interface ClipTimingAction {
  type: 'clip-timing'
  id: string
  field: 'start' | 'duration'
  mode: 'fixed' | 'auto' | 'end' | 'media'
  value?: number
}

export function setEditorClipTiming(
  item: DraftScene | DraftTrackItem,
  action: ClipTimingAction,
  time: { localStart: number; duration: number },
  previousId?: string,
  mediaDuration?: number
) {
  const range = item.target_timerange
  const storedRange = { ...range }
  const scene = 'tracks' in item
  const micros = (value: number, positive = false) => {
    const result = Math.round(value * 1_000_000)
    if (!Number.isFinite(value) || !Number.isSafeInteger(result) || (positive ? result <= 0 : result < 0)) {
      throw new Error(positive ? '时长必须大于 0' : '开始时间必须为非负数')
    }
    return result
  }
  if (!['fixed', 'auto', 'end', 'media'].includes(action.mode) || !['start', 'duration'].includes(action.field)) {
    throw new Error('不支持的时间规则')
  }
  if (action.mode === 'media' && (action.field !== 'duration' || scene || mediaDuration === undefined)) {
    throw new Error('媒体模式需要有效的视频或音频源时长')
  }
  const start = micros(time.localStart)
  const currentDuration = () => micros(time.duration, true)
  const endAligned = !!item.auto_timing?.end && !item.auto_timing?.start
  if (action.field === 'duration') {
    if (action.mode === 'media') item.duration_mode = 'media'
    else delete item.duration_mode
  }
  if (action.field === 'start') {
    if (action.mode === 'end') {
      // End alignment retains an independent duration; it cannot also fill the parent.
      range.duration = currentDuration()
      delete range.start
      delete range.end
      if (scene) item.auto_duration = false
      item.auto_timing = { end: { target: 'parent', anchor: 'end' } }
    } else {
      const autoDuration = scene ? !!item.auto_duration : range.duration === undefined || !!(item.auto_timing?.end && item.auto_timing?.start);
      if (endAligned) {
        delete item.auto_timing
        range.duration = currentDuration()
      }
      delete range.end
      if (action.mode === 'fixed') {
        range.start = micros(action.value ?? time.localStart)
        if (item.auto_timing) delete item.auto_timing.start
        // An end-only rule would be interpreted as end alignment by the timing engine.
        if (autoDuration && item.auto_timing?.end) {
          item.auto_timing.start = { target: 'parent', anchor: 'start', offset: range.start }
        }
      } else {
        delete range.start
        item.auto_timing ??= {}
        item.auto_timing.start = previousId
          ? { target: previousId, anchor: 'end' }
          : { target: 'parent', anchor: 'start' }
      }
    }
  } else {
    if (action.mode === 'end') throw new Error('时长不支持结束对齐')
    if (action.mode === 'auto' && endAligned) throw new Error('结束对齐需要固定时长')
    delete range.end
    if (action.mode === 'fixed' || action.mode === 'media') {
      range.duration = action.mode === 'media' ? mediaDuration : micros(action.value ?? time.duration, true)
      if (scene) item.auto_duration = false
      if (!endAligned && item.auto_timing) delete item.auto_timing.end
    } else {
      delete range.duration
      if (scene) {
        item.auto_duration = true
        if (item.auto_timing) delete item.auto_timing.end
      } else {
        item.auto_timing ??= {}
        item.auto_timing.start ??= { target: 'parent', anchor: 'start', offset: start }
        item.auto_timing.end = { target: 'parent', anchor: 'end' }
      }
    }
  }
  // Keep declared numeric inputs as dormant defaults when automatic rules supersede them.
  for (const field of ['start', 'duration', 'end'] as const) {
    if (item.dynamic?.includes(`target_timerange.${field}`) && range[field] === undefined) {
      range[field] = storedRange[field]
    }
  }
  if (range.end !== undefined && range.duration !== undefined) range.end = (range.start ?? 0) + range.duration
  if (item.auto_timing && !Object.keys(item.auto_timing).length) delete item.auto_timing
}
