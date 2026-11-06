import type { TFunction } from 'i18next'
import { AgentToolsType } from '../MessageAgentTools/types'
import { isDraftRenderToolName } from '../MessageAgentTools/draftRenderTool'
import { getMcpToolDisplayName, parseMcpToolName } from './mcpToolDisplay'

export const getAgentToolLabel = (toolName: string, t: TFunction): string => {
  if (toolName.startsWith('mcp__')) {
    const parts = parseMcpToolName(toolName)
    return getMcpToolDisplayName({ ...parts, t })
  }

  switch (toolName) {
    case AgentToolsType.Read:
      return t('message.tools.labels.readFile')
    case AgentToolsType.Task:
      return t('message.tools.labels.task')
    case AgentToolsType.TaskOutput: {
      const translated = t('message.tools.labels.taskOutput')
      return translated === 'message.tools.labels.taskOutput' ? 'Task Output' : translated
    }
    case AgentToolsType.Bash:
      return t('message.tools.labels.bash')
    case AgentToolsType.BashOutput:
      return t('message.tools.labels.bashOutput')
    case AgentToolsType.Search:
      return t('message.tools.labels.search')
    case AgentToolsType.Glob:
      return t('message.tools.labels.glob')
    case AgentToolsType.Grep:
      return t('message.tools.labels.grep')
    case AgentToolsType.InspectImage:
      return '图片理解'
    case AgentToolsType.Write:
      return t('message.tools.labels.write')
    case AgentToolsType.Edit:
      return t('message.tools.labels.edit')
    case AgentToolsType.MultiEdit:
      return t('message.tools.labels.multiEdit')
    case AgentToolsType.WebSearch:
      return t('message.tools.labels.webSearch')
    case AgentToolsType.WebFetch:
      return t('message.tools.labels.webFetch')
    case AgentToolsType.NotebookEdit:
      return t('message.tools.labels.notebookEdit')
    case AgentToolsType.TodoWrite:
      return t('message.tools.labels.todoWrite')
    case AgentToolsType.ExitPlanMode:
      return t('message.tools.labels.exitPlanMode')
    case AgentToolsType.Skill:
      return t('message.tools.labels.skill')
    default:
      return toolName
  }
}


export function getToolDisplayName(tool: { name: string; type?: string; serverName?: string }, t: TFunction): string {
  const parts = parseMcpToolName(tool.name)
  if (tool.type === 'mcp' || parts.serverName || tool.serverName) {
    const draftRender = isDraftRenderToolName(tool.name, tool.serverName)
    return getMcpToolDisplayName({
      serverName: draftRender ? 'draft-render' : parts.serverName || tool.serverName,
      toolName: draftRender ? 'render_draft' : parts.toolName,
      t
    })
  }
  return getAgentToolLabel(tool.name, t)
}
