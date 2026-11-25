import { formatElapsedSince } from '@shared/processedDuration'
import React from 'react'
import styled from 'styled-components'

interface ProcessingStatusBlockProps {
  processingStartedAt?: string
  loadingLabel?: string
}

const ProcessingStatusBlock: React.FC<ProcessingStatusBlockProps> = ({ processingStartedAt = '', loadingLabel = '' }) => {
  const [, setElapsedTick] = React.useState(0)

  React.useEffect(() => {
    if (!processingStartedAt) return undefined
    const timer = window.setInterval(() => setElapsedTick((tick) => tick + 1), 1000)
    return () => window.clearInterval(timer)
  }, [processingStartedAt])

  const elapsedText = processingStartedAt ? formatElapsedSince(processingStartedAt) : ''
  if (!elapsedText && !loadingLabel) return null

  return (
    <StatusRow className="message-processing-status">
      {elapsedText ? <span>已处理 {elapsedText}</span> : null}
      {loadingLabel ? <span>{loadingLabel}</span> : null}
    </StatusRow>
  )
}

const StatusRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
  font-size: 14px;
  line-height: 1.5;
  color: #8c8c8c;
`

export default React.memo(ProcessingStatusBlock)
