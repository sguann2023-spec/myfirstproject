import type { MCPTool, MCPToolResponse, NormalToolResponse } from '@renderer/types'
import type { ToolMessageBlock } from '@renderer/types/newMessage'
import { isToolAutoApproved } from '@renderer/utils/mcp-tools'
import { Flex, Tooltip } from 'antd'
import { parse as parsePartialJson } from 'partial-json'
import {
  Bot,
  DoorOpen,
  FileEdit,
  FileSearch,
  FileText,
  FolderSearch,
  Globe,
  ListTodo,
  NotebookPen,
  ScanSearch,
  PencilRuler,
  Search,
  ShieldCheck,
  Terminal,
  Wrench
} from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { DraftRenderBillingBadge } from './MessageAgentTools/DraftRenderToolRenderer'
import { isDraftRenderToolName } from './MessageAgentTools/draftRenderTool'
import { renderToolChangeStats } from './MessageAgentTools/changeStats'
import { type ToolStatus } from './MessageAgentTools/GenericTools'
import { AgentToolsType } from './MessageAgentTools/types'
import { getToolDisplayName } from './shared/toolDisplay'
export { getAgentToolLabel } from './shared/toolDisplay'

export interface ToolHeaderProps {
  block?: ToolMessageBlock

  toolName?: string
  icon?: ReactNode
  params?: ReactNode
  stats?: ReactNode

  // Common config
  // @deprecated 不再展示“执行中/已完成/错误”等状态提示，仅保留类型兼容
  status?: ToolStatus
  hasError?: boolean
  showStatus?: boolean

  // Style variant
  variant?: 'standalone' | 'collapse-label'
}

export const getAgentToolIcon = (toolName: string): ReactNode => {
  switch (toolName) {
    case AgentToolsType.Read:
      return <FileText size={14} />
    case AgentToolsType.Task:
    case AgentToolsType.TaskOutput:
      return <Bot size={14} />
    case AgentToolsType.Bash:
    case AgentToolsType.BashOutput:
      return <Terminal size={14} />
    case AgentToolsType.Search:
      return <Search size={14} />
    case AgentToolsType.Glob:
      return <FolderSearch size={14} />
    case AgentToolsType.Grep:
      return <FileSearch size={14} />
    case AgentToolsType.InspectImage:
      return <ScanSearch size={14} />
    case AgentToolsType.Write:
      return <FileText size={14} />
    case AgentToolsType.Edit:
      return <FileEdit size={14} />
    case AgentToolsType.MultiEdit:
      return <FileText size={14} />
    case AgentToolsType.WebSearch:
    case AgentToolsType.WebFetch:
      return <Globe size={14} />
    case AgentToolsType.NotebookEdit:
      return <NotebookPen size={14} />
    case AgentToolsType.TodoWrite:
      return <ListTodo size={14} />
    case AgentToolsType.ExitPlanMode:
      return <DoorOpen size={14} />
    case AgentToolsType.Skill:
      return <PencilRuler size={14} />
    default:
      return <Wrench size={14} />
  }
}


const getToolDescription = (toolResponse?: MCPToolResponse | NormalToolResponse): string | undefined => {
  if (!toolResponse) return undefined
  const args = toolResponse.arguments
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined

  // Common description fields
  return (args.description || args.file_path || args.pattern || args.query || args.command || args.url)?.toString()
}

// ============ Styled Components ============

const HeaderContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  line-height: 20px;
  padding: 4px 0;
  background: transparent;
  border: none;
  border-radius: 0.5rem;
  min-width: 0;
`

// Label variant: no border/padding, for use inside Collapse header
const LabelContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  line-height: 20px;
  font-size: 14px;
  min-width: 0;
`

const ToolName = styled(Flex)`
  font-weight: 500;
  color: var(--color-text);
  flex-shrink: 0;
  align-items: center;

  .tool-icon {
    color: var(--color-primary);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 14px;
    width: 14px;
    height: 14px;
    line-height: 0;
  }

  .tool-icon svg {
    display: block;
  }

  .name {
    white-space: nowrap;
  }
`

const Description = styled.span`
  color: var(--color-text-2);
  font-weight: 400;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  max-width: 300px;
  display: inline-flex;
  align-items: center;
`

const Stats = styled.span`
  color: var(--color-text-2);
  font-weight: 400;
  font-size: 14px;
  white-space: nowrap;
  flex-shrink: 0;
`

// ============ Main Component ============

const ToolHeader: FC<ToolHeaderProps> = ({
  block,
  toolName: propToolName,
  icon: propIcon,
  params,
  stats,
  variant = 'standalone'
}) => {
  const { t } = useTranslation()

  const toolResponse = block?.metadata?.rawMcpToolResponse
  const tool = toolResponse?.tool

  const toolName = propToolName || tool?.name || 'Tool'

  const description = params ?? getToolDescription(toolResponse)
  const parsedPartialArgs = useMemo(() => {
    const partialArguments = toolResponse?.partialArguments
    if (!partialArguments) return undefined

    try {
      return parsePartialJson(partialArguments)
    } catch {
      return undefined
    }
  }, [toolResponse?.partialArguments])
  const derivedStats = useMemo(() => {
    if (stats !== undefined) return stats

    const toolInput = toolResponse?.arguments ?? parsedPartialArgs
    return renderToolChangeStats(toolName, toolInput)
  }, [stats, toolName, toolResponse?.arguments, parsedPartialArgs])

  const billingBadge = isDraftRenderToolName(toolName, tool?.type === 'mcp' ? (tool as MCPTool).serverName : undefined)
    ? <DraftRenderBillingBadge output={{ response: toolResponse?.response, responseRaw: toolResponse?.responseRaw }} />
    : null
  const Container = variant === 'standalone' ? HeaderContainer : LabelContainer

  if (block && tool?.type === 'mcp') {
    const mcpTool = tool as MCPTool
    const displayName = getToolDisplayName(mcpTool, t)
    return (
      <Container>
        <ToolName align="center" gap={6}>
          <span className="tool-icon"><Wrench size={14} /></span>
          <span className="name">{displayName}</span>
          {isToolAutoApproved(mcpTool) && (
            <Tooltip title={t('message.tools.autoApproveEnabled')} mouseLeaveDelay={0}>
              <ShieldCheck size={14} color="var(--color-primary)" />
            </Tooltip>
          )}
        </ToolName>
        {derivedStats && <Stats>{derivedStats}</Stats>}
        {description && <Description>{description}</Description>}
        {billingBadge}
      </Container>
    )
  }

  return (
    <Container>
      <ToolName align="center" gap={6}>
        <span className="tool-icon">{propIcon || getAgentToolIcon(toolName)}</span>
        <span className="name">{getToolDisplayName({ ...tool, name: toolName }, t)}</span>
      </ToolName>
      {derivedStats && <Stats>{derivedStats}</Stats>}
      {description && <Description>{description}</Description>}
      {billingBadge}
    </Container>
  )
}

export default memo(ToolHeader)
