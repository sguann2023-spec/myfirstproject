import type { CollapseProps } from 'antd'

import { extractTextPreviewFromToolResult } from '../shared/callToolResult'
import { truncateOutput } from '../shared/truncateOutput'
import { ToolHeader, TruncatedIndicator } from './GenericTools'
import { AgentToolsType, type WebFetchToolInput, type WebFetchToolOutput } from './types'

export function WebFetchTool({
  input,
  output
}: {
  input?: WebFetchToolInput
  output?: WebFetchToolOutput
}): NonNullable<CollapseProps['items']>[number] {
  const outputText = extractTextPreviewFromToolResult(output)
  const { data: truncatedOutput, isTruncated, originalLength } = truncateOutput(outputText)

  return {
    key: AgentToolsType.WebFetch,
    label: (
      <ToolHeader toolName={AgentToolsType.WebFetch} params={input?.url} variant="collapse-label" showStatus={false} />
    ),
    children: (
      <div>
        <div>{truncatedOutput}</div>
        {isTruncated && <TruncatedIndicator originalLength={originalLength} />}
      </div>
    )
  }
}
