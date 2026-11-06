/**
 * 「已处理」时长文案：
 * - 少于 1 分钟只显示秒（如「45秒」）
 * - 少于 1 小时显示 xx分xx秒
 * - 超过 1 小时显示 xx小时xx分xx秒
 */
const toEpochMs = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return Number.NaN
    if (/^\d+$/.test(trimmed)) {
      const numeric = Number(trimmed)
      return Number.isFinite(numeric) ? numeric : Number.NaN
    }
    const parsed = Date.parse(trimmed)
    return Number.isFinite(parsed) ? parsed : Number.NaN
  }
  return Number.NaN
}

const formatDurationText = (totalSeconds: number): string => {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}小时${minutes}分${seconds}秒`
  if (minutes > 0) return `${minutes}分${seconds}秒`
  return `${seconds}秒`
}

/** 终态（取消/中断）展示：开始与结束时间都有效才返回文案，历史消息缺时间戳时不显示。 */
export const formatProcessedDuration = (startedAt: unknown, endedAt: unknown): string => {
  const start = toEpochMs(startedAt)
  const end = toEpochMs(endedAt)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return ''
  return formatDurationText(Math.max(0, Math.floor((end - start) / 1000)))
}

/** 进行中展示：从开始时间计时到当前刷新时刻。 */
export const formatElapsedSince = (startedAt: unknown, nowMs: number = Date.now()): string => {
  const start = toEpochMs(startedAt)
  if (!Number.isFinite(start)) return ''
  const end = Number.isFinite(nowMs) ? nowMs : Date.now()
  return formatDurationText(Math.max(0, Math.floor((end - start) / 1000)))
}
