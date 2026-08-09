import type { CollapseProps } from 'antd'
import { useTranslation } from 'react-i18next'

import { countLines, truncateOutput } from '../shared/truncateOutput'
import { extractTextPreviewFromToolResult } from '../shared/callToolResult'
import { ToolHeader, TruncatedIndicator } from './GenericTools'
import { AgentToolsType, type WebSearchToolInput, type WebSearchToolOutput } from './types'

export function WebSearchTool({
  input,
  output
}: {
  input?: WebSearchToolInput
  output?: WebSearchToolOutput
}): NonNullable<CollapseProps['items']>[number] {
  const { t } = useTranslation()
  const outputText = extractTextPreviewFromToolResult(output)
  // 如果有输出，计算结果数量
  const resultCount = countLines(outputText)
  const { data: truncatedOutput, isTruncated, originalLength } = truncateOutput(outputText)

  return {
    key: AgentToolsType.WebSearch,
    label: (
      <ToolHeader
        toolName={AgentToolsType.WebSearch}
        params={input?.query}
        stats={outputText ? t('message.tools.units.result', { count: resultCount }) : undefined}
        variant="collapse-label"
        showStatus={false}
      />
    ),
    children: (
      <div>
        <div>{truncatedOutput}</div>
        {isTruncated && <TruncatedIndicator originalLength={originalLength} />}
      </div>
    )
  }
}
