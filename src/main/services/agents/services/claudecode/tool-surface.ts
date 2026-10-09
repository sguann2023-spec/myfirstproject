import type { Options } from '@anthropic-ai/claude-agent-sdk'

export type RuntimeToolLayer = 'codemode'

export type ToolSurface = {
  builtinTools: string[]
  autoAllowedTools: Set<string>
  toolsOption: Options['tools']
  layer: 'codemode'
}

export function buildToolSurface(args: {
  sessionAllowedTools?: string[]
  isAssistant: boolean
  hasExplicitSkillInvocation?: boolean
}): ToolSurface {
  const builtinTools = args.hasExplicitSkillInvocation
    ? ['AskUserQuestion', 'Bash', 'Read']
    : ['AskUserQuestion', 'Bash']
  const autoAllowedTools = new Set<string>()

  for (const tool of args.sessionAllowedTools ?? []) {
    if (tool.startsWith('mcp__')) {
      autoAllowedTools.add(tool)
    }
  }

  return {
    builtinTools,
    autoAllowedTools,
    toolsOption: builtinTools,
    layer: 'codemode'
  }
}

export function addAutoAllowedTool(surface: ToolSurface, toolName: string): void {
  surface.autoAllowedTools.add(toolName)
}

export function addAutoAllowedTools(surface: ToolSurface, toolNames: string[]): void {
  for (const toolName of toolNames) {
    surface.autoAllowedTools.add(toolName)
  }
}
