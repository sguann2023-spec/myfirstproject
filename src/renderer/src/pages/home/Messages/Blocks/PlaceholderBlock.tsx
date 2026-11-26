import { MessageBlockStatus, MessageBlockType, type PlaceholderMessageBlock } from '@renderer/types/newMessage'
import React from 'react'
import { BeatLoader } from 'react-spinners'
import styled from 'styled-components'
import LoadingTip from './LoadingTip'
import ProcessingStatusBlock from './ProcessingStatusBlock'

interface PlaceholderBlockProps {
  block: PlaceholderMessageBlock
  showTips?: boolean
}
const PlaceholderBlock: React.FC<PlaceholderBlockProps> = ({ block, showTips = false }) => {
  const processing = block.status === MessageBlockStatus.PROCESSING && block.type === MessageBlockType.UNKNOWN
  const processingStartedAt = String(block.metadata?.processingStartedAt || '').trim()

  if (processing) {
    const loadingLabel = String(block.metadata?.loadingLabel || '').trim()
    return (
      <MessageContentLoading>
        <BeatLoader color="var(--color-text-1)" size={8} speedMultiplier={0.8} />
        <ProcessingStatusBlock processingStartedAt={processingStartedAt} loadingLabel={loadingLabel} />
        {showTips && (
          <>
            <TipSeparator aria-hidden="true">|</TipSeparator>
            <LoadingTip />
          </>
        )}
      </MessageContentLoading>
    )
  }
  return null
}
const MessageContentLoading = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  min-height: 32px;
  margin-top: -5px;
  margin-bottom: 5px;

  > :first-child {
    flex-shrink: 0;
  }
`

const TipSeparator = styled.span`
  flex-shrink: 0;
  font-size: 12px;
  line-height: 1.5;
  color: #8c8c8c;
`

export default React.memo(PlaceholderBlock)
