import type { ErrorMessageBlock, Message } from '@renderer/types/newMessage'
import { classifyError } from '@renderer/utils/errorClassifier'
import React from 'react'

import ErrorRecoveryBlock from './ErrorRecoveryBlock'

interface Props {
  block: ErrorMessageBlock
  message: Message
}

/**
 * All chat failures use one presentation component. The provider's raw payload
 * remains on block.error for logs and diagnostics, but is never rendered as a
 * second, provider-specific error card in the conversation.
 */
const ErrorBlock: React.FC<Props> = ({ block, message }) => {
  const classification = classifyError(block.error, message.model?.provider)
  return <ErrorRecoveryBlock block={block} message={message} classification={classification} />
}

export default React.memo(ErrorBlock)
