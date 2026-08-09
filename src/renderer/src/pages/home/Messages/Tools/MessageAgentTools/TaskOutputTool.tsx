import type { CollapseProps } from 'antd'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Markdown from 'react-markdown'

import { extractTextPreviewFromToolResult } from '../shared/callToolResult'
import { truncateOutput } from '../shared/truncateOutput'
import { SkeletonValue, ToolHeader, TruncatedIndicator } from './GenericTools'
import {
  AgentToolsType,
  type TaskOutputToolInput as TaskOutputToolInputType,
  type TaskOutputToolOutput as TaskOutputToolOutputType
} from './types'

const normalizeTaskOutput = (output?: TaskOutputToolOutputType): string => extractTextPreviewFromToolResult(output)

export function TaskOutputTool({
  input,
  output
}: {
  input?: TaskOutputToolInputType
  output?: TaskOutputToolOutputType
}): NonNullable<CollapseProps['items']>[number] {
  const { t } = useTranslation()
  const normalizedOutput = useMemo(() => normalizeTaskOutput(output), [output])
  const hasOutput = normalizedOutput.length > 0

  const { truncatedText, isTruncated, originalLength } = useMemo(() => {
    if (!hasOutput) return { truncatedText: '', isTruncated: false, originalLength: 0 }
    const result = truncateOutput(normalizedOutput)
    return { truncatedText: result.data, isTruncated: result.isTruncated, originalLength: result.originalLength }
  }, [normalizedOutput, hasOutput])

  return {
    key: AgentToolsType.TaskOutput,
    label: (
      <ToolHeader
        toolName={AgentToolsType.TaskOutput}
        params={<SkeletonValue value={input?.description} width="150px" />}
        variant="collapse-label"
        showStatus={false}
      />
    ),
    children: (
      <div className="flex flex-col gap-3">
        {input?.prompt && (
          <div>
            <div className="mb-1 font-medium text-muted-foreground text-xs">{t('message.tools.sections.prompt')}</div>
            <div className="max-h-40 overflow-y-auto rounded-md bg-muted/50 p-2 text-sm">
              <Markdown>{input.prompt}</Markdown>
            </div>
          </div>
        )}

        {hasOutput ? (
          <div>
            <div className="mb-1 font-medium text-muted-foreground text-xs">{t('message.tools.sections.output')}</div>
            <div className="rounded-md bg-muted/30 p-2">
              <Markdown>{truncatedText}</Markdown>
              {isTruncated && <TruncatedIndicator originalLength={originalLength} />}
            </div>
          </div>
        ) : (
          <SkeletonValue value={null} width="100%" fallback={null} />
        )}
      </div>
    )
  }
}
