import type { WebSearchToolInput, WebSearchToolOutput } from '@renderer/aiCore/tools/WebSearchTool'
import type { NormalToolResponse } from '@renderer/types'
import { Typography } from 'antd'
import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { toolRunningShimmerCss } from './shared/toolShimmer'

const { Text } = Typography

export const MessageWebSearchToolTitle = ({ toolResponse }: { toolResponse: NormalToolResponse }) => {
  const { t } = useTranslation()
  const toolInput = toolResponse.arguments as WebSearchToolInput
  const toolOutput = toolResponse.response as WebSearchToolOutput

  return toolResponse.status !== 'done' ? (
    <PrepareToolWrapper $running>
      <Search size={16} style={{ color: 'unset' }} />
      <span>{t('message.searching')}</span>
      <span>{toolInput?.additionalContext ?? ''}</span>
    </PrepareToolWrapper>
  ) : (
    <MessageWebSearchToolTitleTextWrapper type="secondary">
      <Search size={16} style={{ color: 'unset' }} />
      {t('message.websearch.fetch_complete', {
        count: toolOutput?.results?.length ?? 0
      })}
    </MessageWebSearchToolTitleTextWrapper>
  )
}

// export const MessageWebSearchToolBody = ({ toolResponse }: { toolResponse: MCPToolResponse }) => {
//   const toolOutput = toolResponse.response as WebSearchToolOutput

//   return toolResponse.status === 'done'
//     ? toolOutput?.results?.map((result, index) => (
//         <MessageWebSearchToolBodyUlWrapper key={result?.query ?? '' + index}>
//           {result.results.map((item, index) => (
//             <li key={item.url + index}>
//               <Link href={item.url}>{item.title}</Link>
//             </li>
//           ))}
//         </MessageWebSearchToolBodyUlWrapper>
//       ))
//     : null
// }

const PrepareToolWrapper = styled.span<{ $running?: boolean }>`
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
`

// const MessageWebSearchToolBodyUlWrapper = styled.ul`
//   display: flex;
//   flex-direction: column;
//   gap: 4px;
//   padding: 0;
// `
