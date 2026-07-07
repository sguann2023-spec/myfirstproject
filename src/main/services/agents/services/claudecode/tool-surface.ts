import type { Options } from '@anthropic-ai/claude-agent-sdk'

import type { RuntimeToolLayer } from './capability-router'

export const BUILTIN_TOOL_LAYERS: Record<RuntimeToolLayer, string[]> = {
  chat: [],
  'workspace-read': ['Read', 'Glob', 'Grep', 'NotebookRead'],
  'workspace-write': ['Read', 'Glob', 'Grep', 'NotebookRead', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit'],
  agentic: [
    'Read',
    'Glob',
    'Grep',
    'NotebookRead',
    'Edit',
    'MultiEdit',
    'Write',
    'NotebookEdit',
    'Bash',
    'Task',
    'TodoWrite'
  ]
}

const SAFE_AUTO_ALLOW_BUILTINS = new Set(['Read', 'Glob', 'Grep', 'NotebookRead', 'TodoWrite'])

const FILTERED_TOOLS = new Set(['WebFetch', 'mcp__exa__web_fetch_exa'])

export type ToolSurface = {
  builtinTools: string[]
  autoAllowedTools: Set<string>
  allowedToolsOption: string[]
  toolsOption: Options['tools']
  layer: RuntimeToolLayer
}

export function buildToolSurface(args: {
  layer: RuntimeToolLayer
  sessionAllowedTools?: string[]
  isAssistant: boolean
}): ToolSurface {
  const builtinTools = Array.from(new Set(BUILTIN_TOOL_LAYERS[args.layer] ?? []))
  const availableBuiltinSet = new Set(builtinTools)
  const sessionAllowedTools = (args.sessionAllowedTools ?? []).filter((tool) => !FILTERED_TOOLS.has(tool))
  const autoAllowedTools = new Set<string>()

  for (const tool of builtinTools) {
    if (SAFE_AUTO_ALLOW_BUILTINS.has(tool)) {
      autoAllowedTools.add(tool)
    }
  }

  for (const tool of sessionAllowedTools) {
    if (availableBuiltinSet.has(tool) || tool.startsWith('mcp__')) {
      autoAllowedTools.add(tool)
    }
  }

  if (args.isAssistant) {
    for (const tool of ['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Bash', 'Task']) {
      autoAllowedTools.delete(tool)
    }
  }

  return {
    builtinTools,
    autoAllowedTools,
    allowedToolsOption: Array.from(autoAllowedTools).sort(),
    toolsOption: builtinTools,
    layer: args.layer
  }
}

export function addAutoAllowedTool(surface: ToolSurface, toolName: string): void {
  surface.autoAllowedTools.add(toolName)
  surface.allowedToolsOption = Array.from(surface.autoAllowedTools).sort()
}

export function addAutoAllowedTools(surface: ToolSurface, toolNames: string[]): void {
  for (const toolName of toolNames) {
    surface.autoAllowedTools.add(toolName)
  }
  surface.allowedToolsOption = Array.from(surface.autoAllowedTools).sort()
}
