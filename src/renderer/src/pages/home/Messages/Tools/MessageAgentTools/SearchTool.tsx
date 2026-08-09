import type { CollapseProps } from 'antd'
import { useTranslation } from 'react-i18next'

import { countLines, truncateOutput } from '../shared/truncateOutput'
import { extractTextPreviewFromToolResult } from '../shared/callToolResult'
import { StringInputTool, StringOutputTool, ToolHeader, TruncatedIndicator } from './GenericTools'
import {
  AgentToolsType,
  type SearchToolInput as SearchToolInputType,
  type SearchToolOutput as SearchToolOutputType
} from './types'

export function SearchTool({
  input,
  output
}: {
  input?: SearchToolInputType
  output?: SearchToolOutputType
}): NonNullable<CollapseProps['items']>[number] {
  const { t } = useTranslation()
  const outputText = extractTextPreviewFromToolResult(output)
  // 如果有输出，计算结果数量
  const resultCount = countLines(outputText)
  const { data: truncatedOutput, isTruncated, originalLength } = truncateOutput(outputText)

  return {
    key: AgentToolsType.Search,
    label: (
      <ToolHeader
        toolName={AgentToolsType.Search}
        params={input ? `"${input}"` : undefined}
        stats={outputText ? t('message.tools.units.result', { count: resultCount }) : undefined}
        variant="collapse-label"
        showStatus={false}
      />
    ),
    children: (
      <div>
        {input && <StringInputTool input={input} label={t('message.tools.sections.searchQuery')} />}
        {truncatedOutput && (
          <div>
            <StringOutputTool
              output={truncatedOutput}
              label={t('message.tools.sections.searchResults')}
              textColor="text-yellow-600 dark:text-yellow-400"
            />
            {isTruncated && <TruncatedIndicator originalLength={originalLength} />}
          </div>
        )}
      </div>
    )
  }
}
