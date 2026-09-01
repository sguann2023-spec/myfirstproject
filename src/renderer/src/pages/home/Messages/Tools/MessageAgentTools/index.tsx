import { useAppSelector } from '@renderer/store'
import { selectPendingPermission } from '@renderer/store/toolPermissions'
import type { NormalToolResponse } from '@renderer/types'
import type { MCPProgressEvent } from '@shared/config/types'
import { IpcChannel } from '@shared/IpcChannel'
import { loggerService } from '@logger'
import type { CollapseProps } from 'antd'
import { Collapse } from 'antd'
import { parse as parsePartialJson } from 'partial-json'
import React from 'react'
import { useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'

// 导出所有类型
export * from './types'

// 导入所有渲染器
import { AskUserQuestionCard } from '../AskUserQuestionCard'
import ToolPermissionRequestCard from '../ToolPermissionRequestCard'
import { BashOutputTool } from './BashOutputTool'
import { BashTool } from './BashTool'
import { EditTool } from './EditTool'
import { ExitPlanModeTool } from './ExitPlanModeTool'
import { getEffectiveStatus, StreamingContext, type ToolStatus, ToolStatusIndicator } from './GenericTools'
import { GlobTool } from './GlobTool'
import { GrepTool } from './GrepTool'
import { InspectImageTool } from './InspectImageTool'
import { MultiEditTool } from './MultiEditTool'
import { NavigateToolInline } from './NavigateTool'
import { NotebookEditTool } from './NotebookEditTool'
import { ReadTool } from './ReadTool'
import { SearchTool } from './SearchTool'
import { SkillTool } from './SkillTool'
import { TaskTool } from './TaskTool'
import { TaskOutputTool } from './TaskOutputTool'
import { TodoWriteTool } from './TodoWriteTool'
import { ToolSearchTool } from './ToolSearchTool'
import { isAgentMcpToolName, McpServerToolRenderer } from './McpServerToolRenderer'
import { isVideoUnderstandeToolName } from './videoUnderstandeTool'
import type { ToolInput, ToolOutput } from './types'
import { AgentToolsType } from './types'
import { UnknownToolRenderer } from './UnknownToolRenderer'
import { WebFetchTool } from './WebFetchTool'
import { WebSearchTool } from './WebSearchTool'
import { WriteTool } from './WriteTool'
import { getDisplayToolHasError, getDisplayToolStatus } from '../shared/toolDisplayState'

type ToolRenderer = (props: {
  input?: any
  output?: any
}) => NonNullable<CollapseProps['items']>[number]

// 创建工具渲染器映射
export const toolRenderers = {
  [AgentToolsType.Read]: ReadTool,
  [AgentToolsType.Task]: TaskTool,
  [AgentToolsType.TaskOutput]: TaskOutputTool,
  [AgentToolsType.Bash]: BashTool,
  [AgentToolsType.Search]: SearchTool,
  [AgentToolsType.Glob]: GlobTool,
  [AgentToolsType.WebSearch]: WebSearchTool,
  [AgentToolsType.Grep]: GrepTool,
  [AgentToolsType.InspectImage]: InspectImageTool,
  [AgentToolsType.Write]: WriteTool,
  [AgentToolsType.WebFetch]: WebFetchTool,
  [AgentToolsType.Edit]: EditTool,
  [AgentToolsType.MultiEdit]: MultiEditTool,
  [AgentToolsType.BashOutput]: BashOutputTool,
  [AgentToolsType.NotebookEdit]: NotebookEditTool,
  [AgentToolsType.ExitPlanMode]: ExitPlanModeTool,
  [AgentToolsType.Skill]: SkillTool,
  [AgentToolsType.TodoWrite]: TodoWriteTool,
  [AgentToolsType.ToolSearch]: ToolSearchTool
} satisfies Partial<Record<AgentToolsType, ToolRenderer>>

const logger = loggerService.withContext('MessageAgentTools')

const TransparentCollapse = styled(Collapse)`
  background: transparent !important;

  &.ant-collapse,
  > .ant-collapse-item,
  > .ant-collapse-item.ant-collapse-item-active,
  > .ant-collapse-item > .ant-collapse-header,
  > .ant-collapse-item.ant-collapse-item-active > .ant-collapse-header,
  > .ant-collapse-item > .ant-collapse-content,
  > .ant-collapse-item.ant-collapse-item-active > .ant-collapse-content,
  > .ant-collapse-item > .ant-collapse-content > .ant-collapse-content-box {
    background: transparent !important;
  }
`

/**
 * Type-safe tool renderer invocation function.
 * Use this function to call a tool renderer with proper type checking,
 * avoiding the need for `as any` type assertions at call sites.
 *
 * @param toolName - The name of the tool (must be a valid AgentToolsType)
 * @param input - The input for the tool (accepts various input formats)
 * @param output - Optional output from the tool
 * @returns The rendered collapse item
 */
export function renderTool(
  toolName: AgentToolsType,
  input: ToolInput | Record<string, unknown> | string | undefined,
  output?: ToolOutput | unknown
): NonNullable<CollapseProps['items']>[number] {
  const renderer = toolRenderers[toolName as keyof typeof toolRenderers] as ToolRenderer | undefined
  if (!renderer) {
    return UnknownToolRenderer({ toolName, input, output })
  }
  return renderer({ input, output })
}

// 类型守卫函数
export function isValidAgentToolsType(toolName: unknown): toolName is AgentToolsType {
  return typeof toolName === 'string' && Object.values(AgentToolsType).includes(toolName as AgentToolsType)
}

function ToolContent({
  toolName,
  input,
  output,
  isStreaming = false,
  status,
  hasError = false,
  progress,
  progressMessage
}: {
  toolName?: string
  input?: ToolInput | Record<string, unknown>
  output?: ToolOutput | unknown
  isStreaming?: boolean
  status?: ToolStatus
  hasError?: boolean
  progress?: number
  progressMessage?: string
}) {
  const renderedItem = isValidAgentToolsType(toolName)
    ? renderTool(toolName, (input ?? {}) as Record<string, unknown>, output)
    : isAgentMcpToolName(toolName ?? '')
      ? McpServerToolRenderer({ toolName: toolName ?? 'Tool', input, output, progress, progressMessage })
      : UnknownToolRenderer({ toolName: toolName ?? 'Tool', input, output })

  const toolContentItem: NonNullable<CollapseProps['items']>[number] = {
    ...renderedItem,
    label: (
      <div className="flex w-full items-start justify-between gap-2">
        <div className="min-w-0">{renderedItem.label}</div>
        {status && (
          <div className="shrink-0">
            <ToolStatusIndicator status={status} hasError={hasError} />
          </div>
        )}
      </div>
    ),
    classNames: {
      body: 'bg-transparent p-2 text-foreground-900 max-h-96 overflow-scroll'
    }
  }

  return (
    <StreamingContext value={isStreaming}>
      <TransparentCollapse
        className="w-max max-w-full has-[.ant-collapse-item-active]:w-full"
        expandIconPosition="end"
        size="small"
        defaultActiveKey={toolName === AgentToolsType.TodoWrite ? [AgentToolsType.TodoWrite] : []}
        items={[toolContentItem]}
      />
    </StreamingContext>
  )
}

// 统一的组件渲染入口
export function MessageAgentTools({ toolResponse }: { toolResponse: NormalToolResponse }) {
  const { arguments: args, response, responseRaw, tool, status, partialArguments } = toolResponse
  const [progress, setProgress] = useState(0)
  const [progressMessage, setProgressMessage] = useState('')

  const pendingPermission = useAppSelector((state) =>
    selectPendingPermission(state.toolPermissions, toolResponse.toolCallId)
  )

  const parsedPartialArgs = useMemo(() => {
    if (!partialArguments) return undefined
    try {
      return parsePartialJson(partialArguments)
    } catch {
      return undefined
    }
  }, [partialArguments])

  useEffect(() => {
    if (!isAgentMcpToolName(tool?.name || '') || !toolResponse.toolCallId) {
      setProgress(0)
      setProgressMessage('')
      return
    }

    const removeListener = window.electron.ipcRenderer.on(
      IpcChannel.Mcp_Progress,
      (_event: Electron.IpcRendererEvent, data: MCPProgressEvent) => {
        if (data.callId === toolResponse.toolCallId) {
          setProgress(data.progress)
          setProgressMessage(data.message || '')
        }
      }
    )

    return () => {
      setProgress(0)
      setProgressMessage('')
      removeListener()
    }
  }, [tool?.name, toolResponse.toolCallId])

  React.useEffect(() => {
    const toolName = String(tool?.name || '')
    if (!toolName) return
    if (toolName !== AgentToolsType.Skill && toolName !== 'find-skills') return
    // logger.info({
    //   stage: 'render',
    //   toolName,
    //   status: status || '',
    //   toolCallId: toolResponse?.toolCallId || '',
    //   argsSummary: summarizeValue(args),
    //   partialArgsSummary: summarizeValue(partialArguments),
    //   responseSummary: summarizeValue(response)
    // })
  }, [tool?.name, status, toolResponse?.toolCallId, args, partialArguments, response])

  // Navigate tool renders as a simple inline button, not a tool card
  if (tool?.name === 'mcp__assistant__navigate') {
    return <NavigateToolInline input={args ?? parsedPartialArgs} output={response} />
  }

  // AskUserQuestion uses a unified card for both pending and completed states
  if (tool?.name === AgentToolsType.AskUserQuestion) {
    const isLoading = status === 'streaming' || status === 'invoking'
    return (
      <StreamingContext value={isLoading}>
        <AskUserQuestionCard toolResponse={toolResponse} />
      </StreamingContext>
    )
  }

  // TodoWrite is rendered by the pinned panel above the composer, not in the message flow.
  if (tool?.name === AgentToolsType.TodoWrite) {
    return null
  }

  const displayStatus = getDisplayToolStatus(toolResponse, status)
  const effectiveStatus = getEffectiveStatus(displayStatus, !!pendingPermission)
  const hasDisplayError = getDisplayToolHasError(toolResponse, status === 'error')

  if (effectiveStatus === 'waiting') {
    return <ToolPermissionRequestCard toolResponse={toolResponse} />
  }

  const isLoading = effectiveStatus === 'streaming' || effectiveStatus === 'invoking'
  const toolName = tool?.name || ''
  const resolvedOutput = (() => {
    if (isLoading) return undefined

    // video-understand responses are frequently offloaded and their `responseRaw`
    // string gets truncated for inline storage. Passing both shapes lets the helper
    // prefer the intact `response` while keeping `responseRaw` as a fallback.
    if (isVideoUnderstandeToolName(toolName) && response !== undefined && responseRaw !== undefined) {
      return {
        response,
        responseRaw
      }
    }

    return isAgentMcpToolName(toolName) ? (responseRaw ?? response) : response
  })()

  return (
    <ToolContent
      toolName={toolName}
      input={args ?? parsedPartialArgs}
      output={resolvedOutput}
      isStreaming={isLoading}
      status={effectiveStatus}
      hasError={hasDisplayError}
      progress={progress}
      progressMessage={progressMessage}
    />
  )
}
