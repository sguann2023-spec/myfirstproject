import type { CollapseProps } from 'antd'
import { Wrench } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { ToolArgsTable } from '../shared/ArgsTable'
import {
  extractImageUnderstandeBillingSummary,
  getImageUnderstandePointIconUrl,
  type ImageUnderstandeBillingSummary
} from './imageUnderstandeTool'
import { getMcpToolDisplayName, parseMcpToolName } from '../shared/mcpToolDisplay'
import './ImageUnderstandeTool.css'

type ImageUnderstandeToolProps = {
  toolName: string
  input?: unknown
  output?: unknown
  progress?: number
  progressMessage?: string
}

const normalizeArgs = (value: unknown): Record<string, unknown> | unknown[] | null => {
  if (value === undefined || value === null) return null
  if (typeof value === 'object') return value as Record<string, unknown> | unknown[]
  return { value }
}

const normalizeProgressMessage = (message: string | undefined, progress?: number): string | undefined => {
  const text = String(message || '').trim()
  if (!text) return undefined
  if (typeof progress !== 'number' || progress <= 0) return text
  return text.replace(/\s+\d+%$/, '').trim() || text
}

function renderBillingBadge(summary: ImageUnderstandeBillingSummary | null): ReactNode {
  if (!summary) return undefined

  return (
    <span className="image-understand-tool-billing-badge" title={`总消耗 ${summary.displayText}`}>
      <img className="image-understand-tool-billing-icon" src={getImageUnderstandePointIconUrl()} alt="" aria-hidden="true" />
      <span className="image-understand-tool-billing-text">{summary.displayText}</span>
    </span>
  )
}

export function ImageUnderstandeTool({
  toolName,
  input,
  output,
  progress,
  progressMessage
}: ImageUnderstandeToolProps): NonNullable<CollapseProps['items']>[number] {
  const { t } = useTranslation()

  const normalizedInput = normalizeArgs(input)
  const normalizedOutput = normalizeArgs(output)
  const normalizedProgressMessage = normalizeProgressMessage(progressMessage, progress)
  const billingSummary = extractImageUnderstandeBillingSummary(output)
  const toolDisplayName = getMcpToolDisplayName({
    ...parseMcpToolName(toolName),
    t
  })

  return {
    key: `mcp-tool-${toolName}`,
    label: (
      <div className="image-understand-tool-header">
        <div className="image-understand-tool-header-main">
          <span className="image-understand-tool-header-icon">
            <Wrench size={14} />
          </span>
          <span className="image-understand-tool-header-title">{toolDisplayName}</span>
          {renderBillingBadge(billingSummary)}
        </div>
        {normalizedProgressMessage && <span className="image-understand-tool-header-message">{normalizedProgressMessage}</span>}
      </div>
    ),
    children: (
      <div className="space-y-1">
        {normalizedInput && <ToolArgsTable args={normalizedInput} title={t('message.tools.sections.input')} />}
        {normalizedOutput && <ToolArgsTable args={normalizedOutput} title={t('message.tools.sections.output')} />}
        {!normalizedInput && !normalizedOutput ? (
          <div className="p-3 text-foreground-500 text-xs">{t('message.tools.noData')}</div>
        ) : null}
      </div>
    )
  }
}
