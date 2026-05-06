import { loggerService } from '@logger'
import type { ToolMessageBlock } from '@renderer/types/newMessage'
import React from 'react'

import MessageMcpTool from './MessageMcpTool'
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

  const tool = toolResponse.tool
  if (tool.type === 'mcp') {
    return <MessageMcpTool block={block} />
  }

  return <MessageTool block={block} />
}
