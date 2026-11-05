import type { CollapseProps } from 'antd'
import { useTranslation } from 'react-i18next'

import { countLines } from '../shared/truncateOutput'
import { extractTextPreviewFromToolResult } from '../shared/callToolResult'
import { ToolHeader } from './GenericTools'
import { AgentToolsType, type WebSearchToolInput, type WebSearchToolOutput } from './types'

export function WebSearchTool({
  output
}: {
  input?: WebSearchToolInput
  output?: WebSearchToolOutput
}): NonNullable<CollapseProps['items']>[number] {
  const { t } = useTranslation()
  const outputText = extractTextPreviewFromToolResult(output)
  // 如果有输出，计算结果数量
  const resultCount = countLines(outputText)

  return {
    key: AgentToolsType.WebSearch,
    label: (
      <ToolHeader
        toolName={AgentToolsType.WebSearch}
        stats={outputText ? t('message.tools.units.result', { count: resultCount }) : undefined}
        variant="collapse-label"
        showStatus={false}
      />
    )
  }
}
