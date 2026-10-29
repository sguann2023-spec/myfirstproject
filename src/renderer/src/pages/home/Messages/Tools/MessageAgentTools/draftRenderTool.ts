import { parseMcpToolName } from '../shared/mcpToolDisplay'

type RecordValue = Record<string, unknown>

export const DRAFT_RENDER_TOOL_NAME = 'mcp__vectcut__draft-render__render_draft'
export const LEGACY_DRAFT_RENDER_TOOL_NAME = 'mcp__draft-render__render_draft'

export const isDraftRenderToolName = (name: string, serverName?: string): boolean => {
  const parts = parseMcpToolName(name)
  return (parts.serverName ?? serverName) === 'draft-render' && parts.toolName === 'render_draft'
}

const asRecord = (value: unknown): RecordValue | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null

// Never render arbitrary payloads, paths, scripts, or remote result references.
export function sanitizeDraftRenderError(value: unknown): string | null {
  const record = asRecord(value)
  const text = typeof value === 'string' ? value : typeof record?.message === 'string' ? record.message : ''
  if (!text.trim()) return null
  if (/[{}]/.test(text)) return '预渲染失败，请检查草稿后重试。'
  return text
    .replace(/(?:https?:\/\/|file:\/\/)[^\s<>"'，。；]+/gi, '[引用已隐藏]')
    .replace(/(?:[a-zA-Z]:[\\/]|\.{1,2}[\\/]|~?\/)[^\s<>"'，。；]+/g, '[路径已隐藏]')
    .replace(/(?:[\w.-]+[\\/])+[\w./\\-]+/g, '[路径已隐藏]')
    .slice(0, 500).trim()
}

const safeIdentifier = (value: unknown): string | null =>
  typeof value === 'string' && /^[\w.-]{1,200}$/.test(value) ? value : null

export type DraftRenderSummary = {
  draftId: string | null
  taskId: string | null
  status: string | null
  totalConsumedPoints: number | null
  error: string | null
  isError: boolean
}

export function extractDraftRenderSummary(output: unknown, input?: unknown): DraftRenderSummary {
  const args = asRecord(input)
  const summary: DraftRenderSummary = {
    draftId: null, taskId: null, status: null, totalConsumedPoints: null, error: null, isError: false
  }
  const seen = new Set<object>()
  function visit(value: unknown, depth = 0): void {
    if (depth > 10 || value == null) return
    if (typeof value === 'string') {
      const jsonText = value.replace(/^\s*(?:Error|ToolError|McpError):\s*/i, '')
      try {
        visit(JSON.parse(jsonText), depth + 1)
      } catch {
        // Recover only complete allowlisted fields from a truncated JSON preview.
        if (/^\s*\{/.test(jsonText)) {
          const field = (key: string) => {
            const match = new RegExp(`"${key}"\\s*:\\s*("(?:[^"\\\\]|\\\\.)*")`).exec(value)
            try { return match ? JSON.parse(match[1]) : null } catch { return null }
          }
          const points = /"billing"\s*:\s*\{\s*"total_consumed_points"\s*:\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=\s*[,}])/.exec(value)
          visit({
            draft_id: field('draft_id'), task_id: field('task_id'), status: field('status'),
            error: field('error'), billing: points ? { total_consumed_points: Number(points[1]) } : null
          }, depth + 1)
        } else if (!summary.error) {
          summary.error = sanitizeDraftRenderError(value)
        }
      }
      return
    }
    if (Array.isArray(value)) {
      value.forEach(item => visit(item, depth + 1))
      return
    }
    const record = asRecord(value)
    if (!record || seen.has(record)) return
    seen.add(record)
    summary.isError ||= record.isError === true
    summary.draftId ??= safeIdentifier(record.draft_id)
    summary.taskId ??= safeIdentifier(record.task_id)
    summary.status ??= safeIdentifier(record.status)
    summary.error ??= sanitizeDraftRenderError(record.error)
    const points = asRecord(record.billing)?.total_consumed_points
    if (summary.totalConsumedPoints === null && typeof points === 'number' && Number.isFinite(points) && points >= 0) {
      summary.totalConsumedPoints = points
    }
    for (const key of ['responseRaw', 'structuredContent', 'details', 'response', 'content', 'output', 'result', 'data']) visit(record[key], depth + 1)
    if (record.type === 'text') visit(record.text, depth + 1)
  }
  visit(output)
  summary.draftId ??= safeIdentifier(args?.draftId) ?? safeIdentifier(args?.draft_id)
  if (summary.isError && !summary.error) summary.error = '预渲染失败，请检查草稿后重试。'
  return summary
}
