import type { MemorySearchToolInput, MemorySearchToolOutput } from '@renderer/aiCore/tools/MemorySearchTool'
import type { NormalToolResponse } from '@renderer/types'
import { Typography } from 'antd'
import { ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { toolRunningShimmerCss } from './shared/toolShimmer'

const { Text } = Typography

export const MessageMemorySearchToolTitle = ({ toolResponse }: { toolResponse: NormalToolResponse }) => {
  const { t } = useTranslation()
  const toolInput = toolResponse.arguments as MemorySearchToolInput
  const toolOutput = toolResponse.response as MemorySearchToolOutput

  return toolResponse.status !== 'done' ? (
    <MemorySearchRunningWrapper $running>
      <span>{t('memory.search_placeholder')}</span>
      <span>{toolInput?.query ?? ''}</span>
    </MemorySearchRunningWrapper>
  ) : toolOutput?.length ? (
    <MessageWebSearchToolTitleTextWrapper type="secondary">
      <ChevronRight size={16} style={{ color: 'unset' }} />
      {/* <Search size={16} style={{ color: 'unset' }} /> */}
      <span>{toolOutput?.length ?? 0}</span>
      {t('memory.memory')}
    </MessageWebSearchToolTitleTextWrapper>
  ) : null
}

const MemorySearchRunningWrapper = styled.span<{ $running?: boolean }>`
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 14px;
  padding: 5px;
  padding-left: 0;
  ${(props) => (props.$running ? toolRunningShimmerCss : '')}
`

const MessageWebSearchToolTitleTextWrapper = styled(Text)`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px;
  padding-left: 0;
`
