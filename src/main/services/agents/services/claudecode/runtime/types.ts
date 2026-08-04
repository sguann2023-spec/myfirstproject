export type RuntimeSnapshot = {
  traceId: string
  agentId: string
  sessionId: string
  workspacePath: string
  accessiblePaths: string[]
  prompt: string
  images?: Array<{ data: string; mediaType: string }>
  builtinRole?: string
  autonomousEnabled: boolean
  sessionConfig: Record<string, unknown>
  model: {
    id: string
    providerId: string
    providerType: string
  }
  provider: {
    id: string
    type: string
    apiHost?: string
    anthropicApiHost?: string
    authMode: 'provider_key' | 'runtime_token' | 'session_fallback'
  }
}

export type SkillRuntimeSnapshot = {
  visibleSkills: Array<{
    name: string
    description?: string
    filePath: string
    source: 'workspace' | 'global'
  }>
  activeSkillNames: string[]
  preferredSkillName?: string
  activationMode?: 'none' | 'suggest' | 'invoke'
  sdkDiscovered: boolean
  matchedBy: string[]
  matchedEvidence: string[]
  skillInvocationContext?: {
    skillName: string
    skillFilePath: string
    triggerMode: 'explicit' | 'implicit'
    skillMarkdown: string
    injectedPrompt: string
  }
}

export type ToolRuntimeSnapshot = {
  allTools: unknown[]
  activeToolNames: string[]
  allowedTools: string[]
  autoAllowTools: string[]
  selectedCapabilities: string[]
  toolLayer: string
  mountedMcpServers: Array<{
    key: string
    name: string
    source: 'builtin' | 'runtime' | 'session'
  }>
}

export type PromptRuntimeSnapshot = {
  systemPrompt: string
  initialMessages: Array<{
    role: 'user' | 'assistant' | 'tool'
    content: string
  }>
  resources: {
    skills: Array<{
      name: string
      description: string
      content: string
      filePath: string
    }>
    promptTemplates: Array<{
      name: string
      description?: string
      content: string
    }>
  }
}

export type ProjectionContext = {
  traceId: string
  topicId: string
  turnId?: string
  segmentId?: string
  piSessionId: string
  artifactStrategy: 'none' | 'summary' | 'store_large_results'
  fileChangeTracking: boolean
}

export type ClaudeCodeInvokeContext = {
  runtime: RuntimeSnapshot
  skills: SkillRuntimeSnapshot
  tools: ToolRuntimeSnapshot
  prompt: PromptRuntimeSnapshot
  projection: ProjectionContext
}
