import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import type { CollapseProps } from 'antd'
import { Wrench } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { ToolArgsTable } from '../shared/ArgsTable'
import { ToolHeader } from './GenericTools'
import { isKouboTemplateToolName, KouboTemplateToolBody } from './KouboTemplateTool'
import { isMediaGenerationToolName, MediaGenerationToolBody } from './MediaGenerationTool'
import { isSubtitleRecognitionToolName, SubtitleRecognitionToolBody } from './SubtitleRecognitionTool'
import { isSubtitleTemplateToolName, SubtitleTemplateToolBody } from './SubtitleTemplateTool'

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

  return {
    key: `mcp-tool-${toolName}`,
    label: (
      <ToolHeader
        toolName={toolName}
        icon={<Wrench size={14} />}
        params={normalizedProgressMessage || t('message.tools.labels.mcpServerTool')}
        stats={typeof progress === 'number' && progress > 0 ? `${Math.round(progress * 100)}%` : undefined}
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
