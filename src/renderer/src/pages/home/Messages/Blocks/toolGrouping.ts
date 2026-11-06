import { isAskUserQuestionTool } from '@shared/userInteraction'
import i18next, { type TFunction } from 'i18next'
import { getToolDisplayName } from '../Tools/shared/toolDisplay'
import { MessageBlockType, type MessageBlock, type ToolMessageBlock } from '@renderer/types/newMessage'

import { parseMcpToolName, shouldHideSearchToolDetails } from '../Tools/shared/mcpToolDisplay'
import { isDraftRenderToolName } from '../Tools/MessageAgentTools/draftRenderTool'
import { AgentToolsType } from '../Tools/MessageAgentTools/types'

export type ToolCategory = 'read' | 'execute' | 'edit' | 'search'

const NATIVE_TOOL_CATEGORIES: Record<string, ToolCategory> = {
  Bash: 'execute',
  Read: 'read',
  Edit: 'edit',
  WebSearch: 'search'
}

const MCP_TOOL_CATEGORIES: Record<string, Record<string, ToolCategory>> = {
  filesystem_server: { read: 'read', edit: 'edit' },
  functions: { bash: 'execute', read: 'read', edit: 'edit', websearch: 'search' }
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replaceAll('-', '_')
}

export function getToolCategory(block: MessageBlock): ToolCategory | undefined {
  if (block.type !== MessageBlockType.TOOL) return undefined

  // MessageTools renders nothing without this response. A stale block.toolName must
  // not produce a visible group or inflate its count for an otherwise invisible tool.
  const response = block.metadata?.rawMcpToolResponse
  const name = response?.tool?.name
  if (!response || !name?.trim()) return undefined

  const parts = parseMcpToolName(name)
  let serverName = parts.serverName || response.tool?.serverName
  let toolName = parts.toolName

  // Some filesystem histories use the dotted server.tool spelling.
  const dottedFilesystem = /^(filesystem[-_]server)\.(read|edit)$/.exec(toolName)
  if (!serverName && dottedFilesystem) {
    serverName = dottedFilesystem[1]
    toolName = dottedFilesystem[2]
  }

  if (!serverName) {
    return Object.hasOwn(NATIVE_TOOL_CATEGORIES, toolName) ? NATIVE_TOOL_CATEGORIES[toolName] : undefined
  }

  // Share the exact display policy for scrapt/search/media providers and the
  // explicitly supported stock/footage/AI-library operations, not every MCP tool.
  if (shouldHideSearchToolDetails(name, serverName)) return 'search'

  const serverKey = normalizeName(serverName)
  if (!Object.hasOwn(MCP_TOOL_CATEGORIES, serverKey)) return undefined
  const categories = MCP_TOOL_CATEGORIES[serverKey]
  const toolKey = normalizeName(toolName)
  return Object.hasOwn(categories, toolKey) ? categories[toolKey] : undefined
}

function getToolIdentity(block: MessageBlock, t: TFunction): string | undefined {
  if (block.type !== MessageBlockType.TOOL) return undefined
  const tool = block.metadata?.rawMcpToolResponse?.tool
  if (!tool?.name?.trim()) return undefined
  // Interactive cards/inline navigation must remain accessible; todos are hidden.
  if (isAskUserQuestionTool(tool.name)) return undefined
  if (['TodoWrite', 'mcp__vectcut__assistant__navigate', 'mcp__assistant__navigate'].includes(tool.name)) return undefined
  if (tool.name.startsWith('builtin_')) {
    if (!['builtin_web_search', 'builtin_web_search_preview', 'builtin_knowledge_search', 'builtin_memory_search'].includes(tool.name)) return undefined
    if (tool.type === 'provider' && ['builtin_web_search', 'builtin_web_search_preview'].includes(tool.name)) return undefined
  }
  const parts = parseMcpToolName(tool.name)
  let server = parts.serverName || tool.serverName
  const operation = parts.toolName
  const dotted = /^(filesystem[-_]server)\.(read|edit)$/.exec(operation)
  if (!server && dotted) {
    server = dotted[1]
  }
  // Match MessageTool's dispatch: unknown non-MCP names are not rendered.
  if (tool.type !== 'mcp' && !server && !tool.name.startsWith('builtin_') &&
    !Object.values(AgentToolsType).includes(tool.name as AgentToolsType)) return undefined
  return getToolDisplayName(tool, t)
}

// Mirrors the MessageTools + MessageTool dispatch exactly: a tool block whose
// renderer output is null (missing response metadata, unknown non-MCP names such
// as the nested `codemode` parent call, provider-typed builtin searches, ...)
// has no rendered footprint and must not break adjacency between visible groups.
export function isToolBlockRendered(block: MessageBlock): boolean {
  if (block.type !== MessageBlockType.TOOL) return false
  const response = block.metadata?.rawMcpToolResponse
  const name = response?.tool?.name
  if (!response || !name?.trim()) return false
  const serverName = (response.tool as { serverName?: string } | undefined)?.serverName
  if (isDraftRenderToolName(name, serverName)) return true
  if (name.startsWith('builtin_')) {
    const builtinName = name.slice('builtin_'.length)
    if (builtinName === 'knowledge_search' || builtinName === 'memory_search') return true
    if (builtinName === 'web_search' || builtinName === 'web_search_preview') return response.tool.type !== 'provider'
    return false
  }
  const toolType = (response.tool as { type?: string } | undefined)?.type
  return toolType === 'mcp'
    || name.startsWith('mcp__')
    || (Object.values(AgentToolsType) as string[]).includes(name)
}

export function groupConsecutiveTools(blocks: MessageBlock[], t: TFunction = i18next.t.bind(i18next)): (MessageBlock | ToolMessageBlock[])[] {
  const result: (MessageBlock | ToolMessageBlock[])[] = []
  for (const block of blocks) {
    // Empty text/reasoning has no rendered footprint. Re-evaluate on every
    // store update so newly streamed prose immediately becomes a boundary.
    if ((block.type === MessageBlockType.THINKING || block.type === MessageBlockType.MAIN_TEXT) &&
      !String(block.content || '').trim()) continue
    // Invisible tool blocks (render to null, e.g. nested codemode parents) must
    // stay transparent too, so two codemode runs of the same visible title merge
    // into one group instead of splitting into two adjacent groups of N.
    if (block.type === MessageBlockType.TOOL && !isToolBlockRendered(block)) continue
    const identity = getToolIdentity(block, t)
    if (!identity) {
      result.push(block)
      continue
    }

    const previous = result[result.length - 1]
    if (Array.isArray(previous) && getToolIdentity(previous[0], t) === identity) {
      previous.push(block as ToolMessageBlock)
    } else if (previous && !Array.isArray(previous) && getToolIdentity(previous, t) === identity) {
      result[result.length - 1] = [previous as ToolMessageBlock, block as ToolMessageBlock]
    } else {
      result.push(block)
    }
  }
  return result
}

export function getToolGroupSummary(
  blocks: ToolMessageBlock[],
  displayName?: string,
  t: TFunction = i18next.t.bind(i18next)
): string {
  if (!blocks.length || blocks.some(block => getToolIdentity(block, t) !== getToolIdentity(blocks[0], t))) return ''
  const categories = new Set(blocks.map(getToolCategory))
  const category = categories.size === 1 ? getToolCategory(blocks[0]) : undefined
  const count = blocks.length
  switch (category) {
    case 'read':
      return `查阅 · ${count} 文件`
    case 'execute':
      return `执行 · ${count} 次命令`
    case 'edit':
      return `编辑 · ${count} 文件`
    case 'search':
      return `联网搜索 · ${count} 次`
    default:
      return `${displayName ?? getToolIdentity(blocks[0], t)} · ${count} 次`
  }
}
