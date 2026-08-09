import type { CollapseProps } from 'antd'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Markdown from 'react-markdown'

import { extractTextPreviewFromToolResult } from '../shared/callToolResult'
import { truncateOutput } from '../shared/truncateOutput'
import { SkeletonValue, ToolHeader, TruncatedIndicator } from './GenericTools'
import {
  AgentToolsType,
  type TaskToolInput as TaskToolInputType,
  type TaskToolOutput as TaskToolOutputType
} from './types'

export function TaskTool({
  input,
  output
}: {
  input?: TaskToolInputType
  output?: TaskToolOutputType
}): NonNullable<CollapseProps['items']>[number] {
  const { t } = useTranslation()
  const normalizedOutput = useMemo(() => extractTextPreviewFromToolResult(output), [output])
  const hasOutput = normalizedOutput.length > 0

  const { truncatedText, isTruncated, originalLength } = useMemo(() => {
    if (!hasOutput) return { truncatedText: '', isTruncated: false, originalLength: 0 }
    const result = truncateOutput(normalizedOutput)
    return { truncatedText: result.data, isTruncated: result.isTruncated, originalLength: result.originalLength }
  }, [normalizedOutput, hasOutput])

  return {
    key: AgentToolsType.Task,
    label: (
      <ToolHeader
        toolName={AgentToolsType.Task}
        params={<SkeletonValue value={input?.description} width="150px" />}
        variant="collapse-label"
        showStatus={false}
      />
    ),
    children: (
      <div className="flex flex-col gap-3">
        {/* Prompt 输入区域 */}
        {input?.prompt && (
          <div>
            <div className="mb-1 font-medium text-muted-foreground text-xs">{t('message.tools.sections.prompt')}</div>
            <div className="max-h-40 overflow-y-auto rounded-md bg-muted/50 p-2 text-sm">
              <Markdown>{input.prompt}</Markdown>
            </div>
          </div>
        )}

        {/* Output 输出区域 */}
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
