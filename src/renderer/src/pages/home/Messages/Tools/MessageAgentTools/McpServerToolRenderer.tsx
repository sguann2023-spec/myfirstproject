import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import type { CollapseProps } from 'antd'
import { Wrench } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { ToolArgsTable } from '../shared/ArgsTable'
import { ToolHeader } from './GenericTools'
import { ImageUnderstandeTool } from './ImageUnderstandeToolRenderer'
import { VideoUnderstandeTool } from './VideoUnderstandeToolRenderer'
import { isKouboTemplateToolName, KouboTemplateToolBody } from './KouboTemplateTool'
import { extractMediaGenerationBillingSummary, getMediaGenerationPointIconUrl } from './mediaGenerationBilling'
import { isMediaGenerationToolName, MediaGenerationToolBody } from './MediaGenerationTool'
import { isSubtitleRecognitionToolName, SubtitleRecognitionToolBody } from './SubtitleRecognitionTool'
import { isSubtitleTemplateToolName, SubtitleTemplateToolBody } from './SubtitleTemplateTool'
import { isImageUnderstandeToolName } from './imageUnderstandeTool'
import { isVideoUnderstandeToolName } from './videoUnderstandeTool'

interface McpServerToolProps {
  toolName: string
  input?: unknown
  output?: unknown
  progress?: number
  progressMessage?: string
}

export function isAgentMcpToolName(name: string): boolean {
  return name.startsWith('mcp__')
}

function normalizeArgs(value: unknown): Record<string, unknown> | unknown[] | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'object') return value as Record<string, unknown> | unknown[]
  return { value }
}

function normalizeProgressMessage(message: string | undefined, progress?: number): string | undefined {
  const text = String(message || '').trim()
  if (!text) return undefined
  if (typeof progress !== 'number' || progress <= 0) return text
  return text.replace(/\s+\d+%$/, '').trim() || text
}

function extractMcpText(output: unknown): string | null {
  const result = CallToolResultSchema.safeParse(output)
  if (!result.success) return null

  const textParts: string[] = []
  for (const item of result.data.content) {
    if (item.type === 'text' && item.text) {
      textParts.push(item.text)
    }
  }
  return textParts.length > 0 ? textParts.join('\n\n') : null
}

export function McpServerToolRenderer({
  toolName = '',
  input,
  output,
  progress,
  progressMessage
}: McpServerToolProps): NonNullable<CollapseProps['items']>[number] {
  const { t } = useTranslation()

  const normalizedInput = normalizeArgs(input)
  const mcpText = extractMcpText(output)
  const normalizedOutput = mcpText !== null ? { value: mcpText } : normalizeArgs(output)
  const normalizedProgressMessage = normalizeProgressMessage(progressMessage, progress)
  const isKouboTemplate = isKouboTemplateToolName(toolName)
  const isMediaGeneration = isMediaGenerationToolName(toolName)
  const isSubtitleRecognition = isSubtitleRecognitionToolName(toolName)
  const isSubtitleTemplate = isSubtitleTemplateToolName(toolName)
  const isImageUnderstande = isImageUnderstandeToolName(toolName)
  const isVideoUnderstande = isVideoUnderstandeToolName(toolName)
  const mediaGenerationBillingSummary = isMediaGeneration ? extractMediaGenerationBillingSummary(output) : null

  if (isMediaGeneration) {
    // #region debug-point B:mcp-server-tool-renderer-billing
    fetch('http://127.0.0.1:7777/event', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: 'media-billing-missing',
        runId: 'pre-fix',
        hypothesisId: 'B',
        location: 'McpServerToolRenderer.tsx:billingSummary',
        msg: '[DEBUG] media generation billing summary computed',
        data: {
          toolName,
          progress,
          progressMessage: normalizedProgressMessage,
          outputType: Array.isArray(output) ? 'array' : typeof output,
          outputKeys: output && typeof output === 'object' && !Array.isArray(output) ? Object.keys(output as Record<string, unknown>).slice(0, 8) : [],
          hasBillingSummary: Boolean(mediaGenerationBillingSummary),
          billingDisplayText: mediaGenerationBillingSummary?.displayText ?? null,
          outputPreview: (() => {
            try {
              return JSON.stringify(output).slice(0, 320)
            } catch {
              return String(output).slice(0, 320)
            }
          })()
        },
        ts: Date.now()
      })
    }).catch(() => {})
    // #endregion
  }

  const mediaGenerationHeaderStatsStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    whiteSpace: 'nowrap' as const,
    lineHeight: 1
  }

  const mediaGenerationHeaderBillingBadgeStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 2,
    paddingLeft: 4,
    paddingRight: 4,
    color: '#000000',
    fontSize: 14,
    fontWeight: 'normal',
    flex: '0 0 auto',
    whiteSpace: 'nowrap' as const,
    lineHeight: 1,
    transform: 'translateY(2px)'
  }

  const mediaGenerationHeaderBillingIconStyle = {
    width: 14,
    height: 14,
    display: 'block',
    flexShrink: 0,
    transform: 'translateY(0.5px)'
  }

  const mediaGenerationHeaderBillingTextStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    fontSize: 12,
    fontWeight: 'normal',
    lineHeight: 1,
    transform: 'translateY(0.5px)'
  }
  const headerStats =
    mediaGenerationBillingSummary || (typeof progress === 'number' && progress > 0)
      ? (
          <span style={mediaGenerationHeaderStatsStyle}>
            {mediaGenerationBillingSummary ? (
              <span style={mediaGenerationHeaderBillingBadgeStyle} title={`总消耗 ${mediaGenerationBillingSummary.displayText}`}>
                <img src={getMediaGenerationPointIconUrl()} style={mediaGenerationHeaderBillingIconStyle} alt="" aria-hidden="true" />
                <span style={mediaGenerationHeaderBillingTextStyle}>{mediaGenerationBillingSummary.displayText}</span>
              </span>
            ) : null}
            {typeof progress === 'number' && progress > 0 ? <span>{Math.round(progress * 100)}%</span> : null}
          </span>
        )
      : undefined

  if (isImageUnderstande) {
    return ImageUnderstandeTool({
      toolName,
      input,
      output,
      progress,
      progressMessage
    })
  }

  if (isVideoUnderstande) {
    return VideoUnderstandeTool({
      toolName,
      input,
      output,
      progress,
      progressMessage
    })
  }

  return {
    key: `mcp-tool-${toolName}`,
    label: (
      <ToolHeader
        toolName={toolName}
        icon={<Wrench size={14} />}
        params={normalizedProgressMessage || t('message.tools.labels.mcpServerTool')}
        stats={headerStats}
        variant="collapse-label"
        showStatus={false}
      />
    ),
    children: (
      <div className="space-y-1">
        {isKouboTemplate ? (
          <KouboTemplateToolBody
            input={input}
            output={output}
            progress={progress}
            progressMessage={normalizedProgressMessage}
            isRunning={typeof progress === 'number' && progress < 1}
          />
        ) : null}
        {isMediaGeneration ? (
          <MediaGenerationToolBody
            toolName={toolName}
            input={input}
            output={output}
            progress={progress}
            progressMessage={normalizedProgressMessage}
            isRunning={typeof progress === 'number' && progress < 1}
          />
        ) : null}
        {isSubtitleRecognition ? (
          <SubtitleRecognitionToolBody
            input={input}
            output={output}
            progress={progress}
            progressMessage={normalizedProgressMessage}
            isRunning={typeof progress === 'number' && progress < 1}
          />
        ) : null}
        {isSubtitleTemplate ? (
          <SubtitleTemplateToolBody
            input={input}
            output={output}
            progress={progress}
            progressMessage={normalizedProgressMessage}
            isRunning={typeof progress === 'number' && progress < 1}
          />
        ) : null}
        {!isKouboTemplate && !isMediaGeneration && !isSubtitleRecognition && !isSubtitleTemplate && normalizedInput && (
          <ToolArgsTable args={normalizedInput} title={t('message.tools.sections.input')} />
        )}
        {!isKouboTemplate && !isMediaGeneration && !isSubtitleRecognition && !isSubtitleTemplate && normalizedOutput && (
          <ToolArgsTable args={normalizedOutput} title={t('message.tools.sections.output')} />
        )}
        {!isKouboTemplate &&
        !isMediaGeneration &&
        !isSubtitleRecognition &&
        !isSubtitleTemplate &&
        !normalizedInput &&
        !normalizedOutput ? (
          <div className="p-3 text-foreground-500 text-xs">{t('message.tools.noData')}</div>
        ) : null}
      </div>
    )
  }
}
