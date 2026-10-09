import type { ToolMessageBlock } from '@renderer/types/newMessage'
import React from 'react'

import MessageTools from '../Tools/MessageTools'

interface Props {
  block: ToolMessageBlock
}

const ToolBlock: React.FC<Props> = ({ block }) => {
  React.useEffect(() => {
    const toolResponse = block.metadata?.rawMcpToolResponse

    // #region debug-point F:tool-render
    void fetch('http://127.0.0.1:7777/event', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: 'nested-tool-card-missing',
        runId: 'post-fix-render',
        hypothesisId: 'F',
        location: 'ToolBlock.tsx:ToolBlock',
        msg: '[DEBUG] Tool block rendered',
        data: {
          blockId: block.id,
          messageId: block.messageId,
          toolName: toolResponse?.tool?.name ?? block.toolName,
          toolType: toolResponse?.tool?.type,
          status: toolResponse?.status,
          hasRawMcpToolResponse: Boolean(toolResponse)
        },
        ts: Date.now()
      })
    }).catch(() => {})
    // #endregion
  }, [block])

  return <MessageTools block={block} />
}

export default React.memo(ToolBlock)
