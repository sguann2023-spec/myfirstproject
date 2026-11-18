import type { CompactMessageBlock } from '@renderer/types/newMessage'
import { MessageBlockStatus } from '@renderer/types/newMessage'
import type { CollapseProps } from 'antd'
import { Collapse } from 'antd'
import { Archive } from 'lucide-react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import Markdown from '../../Markdown/Markdown'
import { toolCompletedDimCss, toolHeaderCursorDefaultCss, toolRunningShimmerCss } from '../Tools/shared/toolShimmer'

interface Props {
  block: CompactMessageBlock
}

const CompactBlock: React.FC<Props> = ({ block }) => {
  const { t } = useTranslation()
  const compaction = block.metadata?.contextCompaction
  const isError = block.status === MessageBlockStatus.ERROR || compaction?.phase === 'error'
  const isCancelled = block.status === MessageBlockStatus.PAUSED || compaction?.phase === 'cancelled'
  const isProcessing = !isError && !isCancelled && compaction?.phase !== 'complete' && (
    block.status === MessageBlockStatus.PENDING || block.status === MessageBlockStatus.PROCESSING ||
    block.status === MessageBlockStatus.STREAMING
  )
  const statusKey = isError ? 'failed' : isCancelled ? 'cancelled' : isProcessing ? 'processing' : 'title'
  const statusText = t(`message.message.compact.${statusKey}`)

  const items: CollapseProps['items'] = [
    {
      key: 'summary',
      showArrow: false,
      label: (
        <TitleWrapper $running={isProcessing} $completed={!isProcessing && !isError && !isCancelled} data-running={isProcessing}>
          <Archive size={14} aria-hidden="true" />
          <TitleText>{statusText}</TitleText>
        </TitleWrapper>
      ),
      children: (
        <SummaryContent>
          {block.content ? <Markdown block={block} /> : <LoadingText>{statusText}</LoadingText>}
          {isError && compaction?.error && <ErrorText role="alert">{compaction.error}</ErrorText>}
          {compaction?.chunk !== undefined && (
            <LoadingText>{t('message.message.compact.chunk', { count: compaction.chunk })}</LoadingText>
          )}
          {compaction?.tokensBefore !== undefined && (
            <LoadingText>{t('message.message.compact.tokens_before', { count: compaction.tokensBefore })}</LoadingText>
          )}
          {compaction?.tokensAfter !== undefined && (
            <LoadingText>{t('message.message.compact.tokens_after', { count: compaction.tokensAfter })}</LoadingText>
          )}
        </SummaryContent>
      )
    }
  ]

  return (
    <Container>
      <StyledCollapse items={items} ghost bordered={false} />

      {block.compactedContent && !isProcessing && (
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
  background: transparent !important;
  border: none !important;

  &.ant-collapse,
  > .ant-collapse-item,
  > .ant-collapse-item.ant-collapse-item-active,
  > .ant-collapse-item > .ant-collapse-header,
  > .ant-collapse-item.ant-collapse-item-active > .ant-collapse-header,
  > .ant-collapse-item > .ant-collapse-content,
  > .ant-collapse-item.ant-collapse-item-active > .ant-collapse-content,
  > .ant-collapse-item > .ant-collapse-content > .ant-collapse-content-box {
    background: transparent !important;
    border: none !important;
  }

  > .ant-collapse-item > .ant-collapse-header {
    padding: 4px 0 !important;
    align-items: center !important;
    ${toolHeaderCursorDefaultCss}

    .ant-collapse-expand-icon {
      display: none !important;
    }
  }

  > .ant-collapse-item > .ant-collapse-content > .ant-collapse-content-box {
    padding: 8px 0 !important;
  }
`

const TitleWrapper = styled.div<{ $running: boolean; $completed: boolean }>`
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-1);

  svg {
    flex-shrink: 0;
  }

  ${(props) => props.$running && toolRunningShimmerCss}
  ${(props) => props.$completed && toolCompletedDimCss}
`

const TitleText = styled.span`
  font-weight: 400;
  font-size: 14px;
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

const ErrorText = styled.div`
  color: var(--color-error);
  white-space: pre-wrap;
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
