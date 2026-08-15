import { loggerService } from '@logger'
import { MessageBlockStatus, MessageBlockType, type PlaceholderMessageBlock } from '@renderer/types/newMessage'
import React from 'react'
import { BeatLoader } from 'react-spinners'
import styled from 'styled-components'

const DEBUG_CHAT_LOADING = false && process.env.NODE_ENV !== 'production'
const logger = loggerService.withContext('ChatLoading/PlaceholderBlock')

interface PlaceholderBlockProps {
  block: PlaceholderMessageBlock
}
const PlaceholderBlock: React.FC<PlaceholderBlockProps> = ({ block }) => {
  const rootRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    if (!DEBUG_CHAT_LOADING) return
    // logger.info({
    //   id: block?.id,
    //   type: block?.type,
    //   status: block?.status
    // })
  }, [block])

  React.useEffect(() => {
    if (!DEBUG_CHAT_LOADING || !rootRef.current) return
    const el = rootRef.current
    const rect = el.getBoundingClientRect()
    const computed = window.getComputedStyle(el)
    // logger.info({
    //   id: block?.id,
    //   visibleProbe: {
    //     width: rect.width,
    //     height: rect.height,
    //     display: computed.display,
    //     visibility: computed.visibility,
    //     opacity: computed.opacity
    //   }
    // })
  }, [block])

  if (block.status === MessageBlockStatus.PROCESSING && block.type === MessageBlockType.UNKNOWN) {
    const loadingLabel = String(block.metadata?.loadingLabel || '').trim()
    return (
      <MessageContentLoading ref={rootRef}>
        <BeatLoader color="var(--color-text-1)" size={8} speedMultiplier={0.8} />
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

const MessageContentLoadingLabel = styled.span`
  font-size: 12px;
  line-height: 1.4;
  color: var(--color-text-3);
`
export default React.memo(PlaceholderBlock)
