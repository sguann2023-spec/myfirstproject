import type { CompactMessageBlock } from '@renderer/types/newMessage'
import { MessageBlockStatus } from '@renderer/types/newMessage'
import type { CollapseProps } from 'antd'
import { Collapse } from 'antd'
import { ChevronDown } from 'lucide-react'
import React from 'react'
import { BeatLoader } from 'react-spinners'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import Markdown from '../../Markdown/Markdown'

interface Props {
  block: CompactMessageBlock
}

const CompactBlock: React.FC<Props> = ({ block }) => {
  const { t } = useTranslation()
  const isProcessing = block.status === MessageBlockStatus.PROCESSING
  const processingDeadlineRef = React.useRef(0)
  const [showProcessing, setShowProcessing] = React.useState(isProcessing)

  React.useEffect(() => {
    if (isProcessing) {
      processingDeadlineRef.current = Date.now() + 800
      setShowProcessing(true)
      return
    }

    const remainingMs = processingDeadlineRef.current - Date.now()
    if (remainingMs > 0) {
      const timer = window.setTimeout(() => setShowProcessing(false), remainingMs)
      return () => window.clearTimeout(timer)
    }

    setShowProcessing(false)
  }, [isProcessing])

  const items: CollapseProps['items'] = [
    {
      key: 'summary',
      label: (
        <TitleWrapper>
          <TitleIcon>📦</TitleIcon>
          <TitleText>{t('message.message.compact.title')}</TitleText>
          {showProcessing && (
            <HeaderLoading>
              <BeatLoader color="var(--color-text-3)" size={5} speedMultiplier={0.8} />
              <LoadingText>{t('message.message.compact.processing')}</LoadingText>
            </HeaderLoading>
          )}
        </TitleWrapper>
      ),
      children: (
        <SummaryContent>
          {block.content ? <Markdown block={block} /> : <LoadingText>{t('message.message.compact.processing')}</LoadingText>}
        </SummaryContent>
      )
    }
  ]

  return (
    <Container>
      <StyledCollapse items={items} expandIcon={() => <ChevronDown size={16} />} />

      {block.compactedContent && !showProcessing && (
        <CompactedContentWrapper>
          <CompactedText>{block.compactedContent}</CompactedText>
        </CompactedContentWrapper>
      )}
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 8px 0;
`

const StyledCollapse = styled(Collapse)`
  border-radius: 8px;

  > .ant-collapse-item {
    > .ant-collapse-header {
      padding: 10px 12px !important;
      display: flex;
      align-items: center !important;
      min-height: 44px;

      .ant-collapse-expand-icon {
        padding: 0 !important;
        margin-inline-end: 10px !important;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: 20px;
      }

      .ant-collapse-header-text {
        display: flex;
        align-items: center;
        min-height: 20px;
      }
    }

    > .ant-collapse-content > .ant-collapse-content-box {
      padding: 8px 12px 12px !important;
    }
  }
`

const TitleWrapper = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const TitleIcon = styled.span`
  font-size: 18px;
`

const TitleText = styled.span`
  font-weight: 500;
  font-size: 14px;
  color: var(--color-text-1);
`

const HeaderLoading = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: 8px;
`

const SummaryContent = styled.div`
  padding: 8px 0;
  color: var(--color-text-2);
  font-size: 14px;
  line-height: 1.6;
`

const LoadingText = styled.div`
  font-size: 13px;
  color: var(--color-text-3);
`

const CompactedContentWrapper = styled.div`
  margin-top: 8px;
`

const CompactedText = styled.div`
  font-size: 14px;
  color: var(--color-text-2);
  white-space: pre-wrap;
  line-height: 1.6;
`

export default React.memo(CompactBlock)
