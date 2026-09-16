import type { CollapseProps } from 'antd'
import { Wrench } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { ClickableFilePath } from './ClickableFilePath'
import { getMcpToolDisplayName, parseMcpToolName } from '../shared/mcpToolDisplay'
import {
  extractVideoUnderstandeBillingSummary,
  extractVideoUnderstandeOutputSummary,
  getVideoUnderstandePointIconUrl,
  type VideoUnderstandeBillingSummary
} from './videoUnderstandeTool'
import './VideoUnderstandeTool.css'

type VideoUnderstandeToolProps = {
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
  if (typeof progress === 'number' && progress > 0 && progress < 1) {
    return `进度 ${Math.round(progress * 100)}%`
  }

  const text = String(message || '').trim()
  return text || undefined
}

const formatDuration = (seconds: number | null): string => {
  if (seconds === null || !Number.isFinite(seconds)) return '-'
  if (seconds < 60) return `${seconds.toFixed(1).replace(/\.0$/, '')} 秒`

  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds - minutes * 60
  if (remainingSeconds < 0.05) return `${minutes} 分钟`
  return `${minutes} 分 ${remainingSeconds.toFixed(1).replace(/\.0$/, '')} 秒`
}

function renderBillingBadge(summary: VideoUnderstandeBillingSummary | null): ReactNode {
  if (!summary) return undefined

  return (
    <span className="video-understand-tool-billing-badge" title={`总消耗 ${summary.displayText}`}>
      <img className="video-understand-tool-billing-icon" src={getVideoUnderstandePointIconUrl()} alt="" aria-hidden="true" />
      <span className="video-understand-tool-billing-text">{summary.displayText}</span>
    </span>
  )
}

const getResultFileLabel = (kind: string) => {
  if (kind === 'result_index') return '结果索引'
  if (kind === 'aggregate_result') return '聚合结果'
  if (kind === 'video_result') return '单视频结果'
  if (kind === 'artifact') return '调试产物'
  return '结果文件'
}

export function VideoUnderstandeTool({
  toolName,
  input,
  output,
  progress,
  progressMessage
}: VideoUnderstandeToolProps): NonNullable<CollapseProps['items']>[number] {
  const { t } = useTranslation()

  const normalizedInput = normalizeArgs(input)
  const normalizedOutput = normalizeArgs(output)
  const normalizedProgressMessage = normalizeProgressMessage(progressMessage, progress)
  const billingSummary = extractVideoUnderstandeBillingSummary(output)
  const outputSummary = extractVideoUnderstandeOutputSummary(output)
  const toolDisplayName = getMcpToolDisplayName({
    ...parseMcpToolName(toolName),
    t
  })

  return {
    key: `mcp-tool-${toolName}`,
    label: (
      <div className="video-understand-tool-header">
        <div className="video-understand-tool-header-main">
          <span className="video-understand-tool-header-icon">
            <Wrench size={14} />
          </span>
          <span className="video-understand-tool-header-title">{toolDisplayName}</span>
          {renderBillingBadge(billingSummary)}
        </div>
        {normalizedProgressMessage && <span className="video-understand-tool-header-message">{normalizedProgressMessage}</span>}
      </div>
    ),
    children: (
      <div className="video-understand-tool-body">
        {outputSummary ? (
          <>
            <div className="video-understand-tool-summary-grid">
              <div className="video-understand-tool-summary-card">
                <div className="video-understand-tool-summary-label">视频数量</div>
                <div className="video-understand-tool-summary-value">{outputSummary.totalVideoCount ?? '-'}</div>
              </div>
              <div className="video-understand-tool-summary-card">
                <div className="video-understand-tool-summary-label">抽帧帧率</div>
                <div className="video-understand-tool-summary-value">
                  {outputSummary.defaultFps !== null ? `${outputSummary.defaultFps} fps` : '-'}
                </div>
              </div>
              <div className="video-understand-tool-summary-card">
                <div className="video-understand-tool-summary-label">处理时长</div>
                <div className="video-understand-tool-summary-value">{formatDuration(outputSummary.totalDurationSeconds)}</div>
              </div>
            </div>

            {outputSummary.resultFiles.length > 0 && (
              <div className="video-understand-tool-section">
                <div className="video-understand-tool-section-title">结果文件</div>
                <div className="video-understand-tool-file-list">
                  {outputSummary.resultFiles.map((file) => (
                    <div
                      key={`${file.kind}-${file.filePath}`}
                      className="video-understand-tool-file-item">
                      <div className="video-understand-tool-file-meta">
                        <span className="video-understand-tool-file-kind">{getResultFileLabel(file.kind)}</span>
                        {typeof file.videoIndex === 'number' && (
                          <span className="video-understand-tool-file-extra">视频 {file.videoIndex}</span>
                        )}
                      </div>
                      <ClickableFilePath
                        path={file.filePath}
                        displayName={file.relativePath.split('/').pop() || file.relativePath}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {outputSummary.artifactFile && (
              <div className="video-understand-tool-section">
                <div className="video-understand-tool-section-title">调试产物</div>
                <ClickableFilePath
                  path={outputSummary.artifactFile.filePath}
                  displayName={outputSummary.artifactFile.relativePath.split('/').pop() || outputSummary.artifactFile.relativePath}
                />
              </div>
            )}
          </>
        ) : null}

        {!outputSummary && normalizedInput && (
          <div className="video-understand-tool-section">
            <div className="video-understand-tool-section-title">{t('message.tools.sections.input')}</div>
            <pre className="video-understand-tool-json-preview">{JSON.stringify(normalizedInput, null, 2)}</pre>
          </div>
        )}

        {!outputSummary && normalizedOutput && (
          <div className="video-understand-tool-section">
            <div className="video-understand-tool-section-title">{t('message.tools.sections.output')}</div>
            <pre className="video-understand-tool-json-preview">{JSON.stringify(normalizedOutput, null, 2)}</pre>
          </div>
        )}

        {!normalizedInput && !normalizedOutput && !outputSummary ? (
          <div className="p-3 text-foreground-500 text-xs">{t('message.tools.noData')}</div>
        ) : null}
      </div>
    )
  }
}
