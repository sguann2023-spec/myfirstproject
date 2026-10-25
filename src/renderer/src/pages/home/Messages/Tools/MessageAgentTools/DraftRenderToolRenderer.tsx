import type { CollapseProps } from 'antd'
import { Wrench } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { getMcpToolDisplayName, parseMcpToolName } from '../shared/mcpToolDisplay'

import { extractDraftRenderSummary } from './draftRenderTool'
import point2IconUrl from '../../../../../../../../public/point2.svg?url'
import './VideoUnderstandeTool.css'

type DraftRenderToolProps = {
  toolName: string
  input?: unknown
  output?: unknown
  progress?: number
  isRunning?: boolean
}

// Shared by dedicated cards and generic/group headers so collapsed tools retain billing.
export function DraftRenderBillingBadge({ output }: { output?: unknown }) {
  const points = extractDraftRenderSummary(output).totalConsumedPoints
  if (points === null) return null
  const display = points.toFixed(2)
  return (
    <span className="video-understand-tool-billing-badge" title={`本次渲染消耗 ${display} 点`}>
      <img className="video-understand-tool-billing-icon" src={point2IconUrl} alt="" aria-hidden="true" />
      <span className="video-understand-tool-billing-text">{display}</span>
    </span>
  )
}

export function DraftRenderToolRenderer({
  toolName, input, output, progress, isRunning = false
}: DraftRenderToolProps): NonNullable<CollapseProps['items']>[number] {
  const { t } = useTranslation()
  const toolDisplayName = getMcpToolDisplayName({ ...parseMcpToolName(toolName), t })
  const summary = extractDraftRenderSummary(output, input)
  const points = summary.totalConsumedPoints === null ? null : summary.totalConsumedPoints.toFixed(2)
  const status = summary.status ?? (summary.isError || summary.error ? '失败' : isRunning ? '渲染中' : '未知')
  const fields = [
    ['草稿 ID', summary.draftId ?? '-'],
    ['任务 ID', summary.taskId ?? '-'],
    ['渲染状态', status],
    ['积分消耗', points === null ? '未知' : `${points} 点`]
  ]
  return {
    key: `mcp-tool-${toolName}`,
    label: (
      <div className="video-understand-tool-header">
        <div className="video-understand-tool-header-main">
          <span className="video-understand-tool-header-icon"><Wrench size={14} /></span>
          <span className="video-understand-tool-header-title">{toolDisplayName}</span>
          <DraftRenderBillingBadge output={output} />
        </div>
        {isRunning && typeof progress === 'number' && Number.isFinite(progress) && progress > 0 && (
          <span className="video-understand-tool-header-message">进度 {Math.round(Math.min(progress, 1) * 100)}%</span>
        )}
      </div>
    ),
    children: (
      <div className="video-understand-tool-body">
        <div className="video-understand-tool-summary-grid">
          {fields.map(([label, value]) => (
            <div className="video-understand-tool-summary-card" key={label}>
              <div className="video-understand-tool-summary-label">{label}</div>
              <div className="video-understand-tool-summary-value">{value}</div>
            </div>
          ))}
        </div>
        {summary.error && <div className="video-understand-tool-section" role="alert">{summary.error}</div>}
      </div>
    )
  }
}
