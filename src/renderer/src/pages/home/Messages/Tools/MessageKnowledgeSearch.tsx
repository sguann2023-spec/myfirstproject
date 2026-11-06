import type { KnowledgeSearchToolInput, KnowledgeSearchToolOutput } from '@renderer/aiCore/tools/KnowledgeSearchTool'
import i18n from '@renderer/i18n'
import type { NormalToolResponse } from '@renderer/types'
import { Typography } from 'antd'
import { FileSearch } from 'lucide-react'
import styled from 'styled-components'

import { toolRunningShimmerCss } from './shared/toolShimmer'

const { Text } = Typography
export function MessageKnowledgeSearchToolTitle({ toolResponse }: { toolResponse: NormalToolResponse }) {
  const toolInput = toolResponse.arguments as KnowledgeSearchToolInput
  const toolOutput = toolResponse.response as KnowledgeSearchToolOutput

  return toolResponse.status !== 'done' ? (
    <PrepareToolWrapper $running>
      <FileSearch size={16} style={{ color: 'unset' }} />
      <span>{i18n.t('message.searching')}</span>
      <span>{toolInput?.additionalContext ?? ''}</span>
    </PrepareToolWrapper>
  ) : (
    <MessageWebSearchToolTitleTextWrapper type="secondary">
      <FileSearch size={16} style={{ color: 'unset' }} />
      {i18n.t('message.websearch.fetch_complete', { count: toolOutput.length ?? 0 })}
    </MessageWebSearchToolTitleTextWrapper>
  )
}

export function MessageKnowledgeSearchToolBody({ toolResponse }: { toolResponse: NormalToolResponse }) {
  const toolOutput = toolResponse.response as KnowledgeSearchToolOutput

  return toolResponse.status === 'done' ? (
    <MessageWebSearchToolBodyUlWrapper>
      {toolOutput.map((result) => (
        <li key={result.id}>
          <span>{result.id}</span>
          <span>{result.content}</span>
        </li>
      ))}
    </MessageWebSearchToolBodyUlWrapper>
  ) : null
}

const PrepareToolWrapper = styled.span<{ $running?: boolean }>`
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 14px;
  padding-left: 0;
  ${(props) => (props.$running ? toolRunningShimmerCss : '')}
`
const MessageWebSearchToolTitleTextWrapper = styled(Text)`
  display: flex;
  align-items: center;
  gap: 4px;
`

const MessageWebSearchToolBodyUlWrapper = styled.ul`
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0;
  > li {
    padding: 0;
    margin: 0;
    max-width: 70%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`
