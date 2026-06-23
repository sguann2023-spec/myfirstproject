// import { useRuntime } from '@renderer/hooks/useRuntime'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { Message } from '@renderer/types/newMessage'
import { Popover } from 'antd'
import { t } from 'i18next'
import styled from 'styled-components'

interface MessageTokensProps {
  message: Message
  isLastMessage?: boolean
}

const MessageTokens: React.FC<MessageTokensProps> = ({ message }) => {
  // const { generating } = useRuntime()
  const locateMessage = () => {
    void EventEmitter.emit(EVENT_NAMES.LOCATE_MESSAGE + ':' + message.id, false)
  }

  const getPrice = () => {
    const inputTokens = message?.usage?.prompt_tokens ?? 0
    const outputTokens = message?.usage?.completion_tokens ?? 0
    const model = message.model
    const pricing = model?.pricing
    const inputPointPerThousand =
      Number(pricing?.input_resource_points_per_unit ?? pricing?.input_per_million_tokens ?? 0) || 0
    const outputPointPerThousand =
      Number(pricing?.output_resource_points_per_unit ?? pricing?.output_per_million_tokens ?? 0) || 0
    const inputUnits = inputTokens > 0 ? Math.ceil(inputTokens / 1000) : 0
    const outputUnits = outputTokens > 0 ? Math.ceil(outputTokens / 1000) : 0

    return inputUnits * inputPointPerThousand + outputUnits * outputPointPerThousand
  }

  const getPriceString = () => {
    const price = getPrice()
    return `| ${t('settings.messages.estimated_price')}: ${price.toFixed(2)}点`
  }

  if (!message.usage) {
    return null
  }

  if (message.role === 'user') {
    return (
      <MessageMetadata className="message-tokens" onClick={locateMessage}>
        {`Tokens: ${message?.usage?.total_tokens}`}
      </MessageMetadata>
    )
  }

  if (message.role === 'assistant') {
    let metricsText = ''
    let hasMetrics = false
    if (message?.metrics?.completion_tokens && message?.metrics?.time_completion_millsec) {
      hasMetrics = true
      metricsText = t('settings.messages.metrics', {
        time_first_token_millsec: message?.metrics?.time_first_token_millsec,
        token_speed: (message?.metrics?.completion_tokens / (message?.metrics?.time_completion_millsec / 1000)).toFixed(
          0
        )
      })
    }

    const tokensInfo = (
      <span className="tokens">
        Tokens:
        <span>{message?.usage?.total_tokens}</span>
        <span>↑{message?.usage?.prompt_tokens}</span>
        <span>↓{message?.usage?.completion_tokens}</span>
        <span>{getPriceString()}</span>
      </span>
    )

    return (
      <MessageMetadata className="message-tokens" onClick={locateMessage}>
        {hasMetrics ? (
          <Popover
            content={metricsText}
            placement="top"
            trigger="hover"
            mouseEnterDelay={0}
            mouseLeaveDelay={0}
            styles={{ root: { fontSize: 11 } }}>
            {tokensInfo}
          </Popover>
        ) : (
          tokensInfo
        )}
      </MessageMetadata>
    )
  }

  return null
}

const MessageMetadata = styled.div`
  font-size: 10px;
  color: var(--color-text-3);
  user-select: text;
  cursor: pointer;
  text-align: right;

  .tokens span {
    padding: 0 2px;
  }
`

export default MessageTokens
