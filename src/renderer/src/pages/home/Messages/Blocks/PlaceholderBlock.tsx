import { formatElapsedSince } from '@shared/processedDuration'
import { MessageBlockStatus, MessageBlockType, type PlaceholderMessageBlock } from '@renderer/types/newMessage'
import React from 'react'
import { BeatLoader } from 'react-spinners'
import styled from 'styled-components'

interface PlaceholderBlockProps {
  block: PlaceholderMessageBlock
}
const PlaceholderBlock: React.FC<PlaceholderBlockProps> = ({ block }) => {
  const processing = block.status === MessageBlockStatus.PROCESSING && block.type === MessageBlockType.UNKNOWN
  const processingStartedAt = String(block.metadata?.processingStartedAt || '').trim()
  const [, setElapsedTick] = React.useState(0)

  // 「已处理」文案按秒推进；仅在提供了开始时间时才启动定时器
  React.useEffect(() => {
    if (!processing || !processingStartedAt) return undefined
    const timer = window.setInterval(() => setElapsedTick((tick) => tick + 1), 1000)
    return () => window.clearInterval(timer)
  }, [processing, processingStartedAt])

  if (processing) {
    const loadingLabel = String(block.metadata?.loadingLabel || '').trim()
    const elapsedText = processingStartedAt ? formatElapsedSince(processingStartedAt) : ''
    return (
      <MessageContentLoading>
        <BeatLoader color="var(--color-text-1)" size={8} speedMultiplier={0.8} />
        {elapsedText ? <MessageContentElapsedLabel>已处理 {elapsedText}</MessageContentElapsedLabel> : null}
        {loadingLabel ? <MessageContentLoadingLabel>{loadingLabel}</MessageContentLoadingLabel> : null}
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
  height: 32px;
  margin-top: -5px;
  margin-bottom: 5px;
`

// 与 ChatShell 的「用户已取消」提示（.chat-message-interrupted）保持同样的字号与颜色，
// 「已处理 xx」与「第 xx 次重试」共用同一套样式
const MessageContentLoadingLabel = styled.span`
  font-size: 12px;
  line-height: 1.5;
  color: #8c8c8c;
`

const MessageContentElapsedLabel = MessageContentLoadingLabel
export default React.memo(PlaceholderBlock)
