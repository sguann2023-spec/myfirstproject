import { loggerService } from '@logger'
import type { ToolMessageBlock } from '@renderer/types/newMessage'
import React from 'react'

import MessageTool from './MessageTool'

interface Props {
  block: ToolMessageBlock
}

const logger = loggerService.withContext('MessageTools')

export default function MessageTools({ block }: Props) {
  const toolResponse = block.metadata?.rawMcpToolResponse
  if (!toolResponse) {
    logger.warn('Skip tool block render: rawMcpToolResponse missing', {
      blockId: block.id,
      messageId: block.messageId,
      toolName: block.toolName
    })
    return null
  }

  return <MessageTool block={block} />
}
