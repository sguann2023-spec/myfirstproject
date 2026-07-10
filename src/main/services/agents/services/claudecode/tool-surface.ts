import type { Options } from '@anthropic-ai/claude-agent-sdk'

import type { CapabilityDecision, IntentDomain, RuntimeToolLayer } from './capability-router'

export const BUILTIN_TOOL_LAYERS: Record<RuntimeToolLayer, string[]> = {
  chat: [],
  web: [],
  'workspace-read': ['Read', 'Glob', 'Grep', 'NotebookRead'],
  'workspace-write': ['Read', 'Glob', 'Grep', 'NotebookRead', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Bash'],
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

const DOMAIN_SUBDOMAIN_BUILTINS: Partial<Record<IntentDomain, Record<string, string[]>>> = {
  workspace: {
    read: ['Read', 'Glob', 'Grep'],
    write: ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'MultiEdit'],
    execute: ['Read', 'Glob', 'Grep', 'Bash'],
    find: ['Glob', 'Grep'],
    notebook: ['NotebookRead', 'NotebookEdit'],
    task: ['Task', 'TodoWrite']
  },
  web: {
    search: ['WebSearch'],
    fetch: ['WebFetch']
  }
}

const collectDomainBuiltinTools = (decision: CapabilityDecision): string[] => {
  const tools = new Set<string>()
  const applyDomain = (domain: IntentDomain, subdomains: string[]) => {
    const domainMap = DOMAIN_SUBDOMAIN_BUILTINS[domain]
    if (!domainMap) return
    for (const subdomain of subdomains) {
      for (const tool of domainMap[subdomain] ?? []) {
        tools.add(tool)
      }
    }
  }

  for (const activeDomain of decision.activeDomains) {
    applyDomain(activeDomain.domain, activeDomain.subdomains)
  }

  return Array.from(tools)
}

export function buildToolSurface(args: {
  decision: CapabilityDecision
  sessionAllowedTools?: string[]
  isAssistant: boolean
}): ToolSurface {
  const domainBuiltinTools = collectDomainBuiltinTools(args.decision)
  const fallbackLayerTools = BUILTIN_TOOL_LAYERS[args.decision.toolLayer] ?? []
  const shouldUseFallbackLayerTools =
    domainBuiltinTools.length === 0 &&
    (args.decision.activeDomains.length === 0 ||
      args.decision.activeDomains.every((domainEntry) => ['chat', 'workspace', 'web'].includes(domainEntry.domain)))
  const builtinTools = Array.from(new Set(shouldUseFallbackLayerTools ? fallbackLayerTools : domainBuiltinTools))
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
    layer: args.decision.toolLayer
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
