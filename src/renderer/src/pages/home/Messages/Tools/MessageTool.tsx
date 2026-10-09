import type { NormalToolResponse } from '@renderer/types'
import type { ToolMessageBlock } from '@renderer/types/newMessage'
import React from 'react'

import { MessageAgentTools } from './MessageAgentTools'
import { AgentToolsType } from './MessageAgentTools/types'
import { MessageKnowledgeSearchToolTitle } from './MessageKnowledgeSearch'
import { MessageMemorySearchToolTitle } from './MessageMemorySearch'
import { MessageWebSearchToolTitle } from './MessageWebSearch'

interface Props {
  block: ToolMessageBlock
}
const builtinToolsPrefix = 'builtin_'
const agentMcpToolsPrefix = 'mcp__'
const agentTools = Object.values(AgentToolsType)

const isAgentTool = (toolName: AgentToolsType) => {
  if (agentTools.includes(toolName) || toolName.startsWith(agentMcpToolsPrefix)) {
    return true
  }
  return false
}

const ChooseTool = (toolResponse: NormalToolResponse): React.ReactNode | null => {
  let toolName = toolResponse.tool.name
  const toolType = toolResponse.tool.type
  if (toolName.startsWith(builtinToolsPrefix)) {
    toolName = toolName.slice(builtinToolsPrefix.length)
    switch (toolName) {
      case 'web_search':
      case 'web_search_preview':
        return toolType === 'provider' ? null : <MessageWebSearchToolTitle toolResponse={toolResponse} />
      case 'knowledge_search':
        return <MessageKnowledgeSearchToolTitle toolResponse={toolResponse} />
      case 'memory_search':
        return <MessageMemorySearchToolTitle toolResponse={toolResponse} />
      default:
        return null
    }
  } else if (toolType === 'mcp' || isAgentTool(toolName as AgentToolsType)) {
    return <MessageAgentTools toolResponse={toolResponse} />
  }
  return null
}

export default function MessageTool({ block }: Props) {
  // FIXME: 语义错误，这里已经不是 MCP tool 了,更改rawMcpToolResponse需要改用户数据, 所以暂时保留
  const toolResponse = block.metadata?.rawMcpToolResponse as NormalToolResponse

  if (!toolResponse) {
    return null
  }

  const toolRenderer = ChooseTool(toolResponse)

  if (!toolRenderer) {
    // #region debug-point C:renderer-rejection
    void fetch('http://127.0.0.1:7777/event', { method: 'POST', body: JSON.stringify({ sessionId: 'nested-tool-card-missing', runId: 'post-fix', hypothesisId: 'C', location: 'MessageTool.tsx:MessageTool', msg: '[DEBUG] Renderer rejected tool block', data: { blockId: block.id, messageId: block.messageId, toolName: toolResponse?.tool?.name, toolType: toolResponse?.tool?.type }, ts: Date.now() }) }).catch(() => {})
    // #endregion
    return null
  }

  return toolRenderer
}

// const PrepareToolWrapper = styled.span`
//   display: flex;
//   align-items: center;
//   gap: 4px;
//   font-size: 14px;
//   padding-left: 0;
// `
