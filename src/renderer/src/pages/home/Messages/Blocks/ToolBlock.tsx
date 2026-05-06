import type { ToolMessageBlock } from '@renderer/types/newMessage'
import React from 'react'
import { loggerService } from '@logger'

import MessageTools from '../Tools/MessageTools'

interface Props {
  block: ToolMessageBlock
}

const logger = loggerService.withContext('NewBlocks/ToolBlock')

const ToolBlock: React.FC<Props> = ({ block }) => {
  React.useEffect(() => {
    // logger.info({
    //   blockId: block?.id,
    //   messageId: block?.messageId,
    //   toolName: block?.toolName,
    //   hasRawMcpToolResponse: Boolean(block?.metadata?.rawMcpToolResponse)
    // })
  }, [block])

  return <MessageTools block={block} />
}

export default React.memo(ToolBlock)
