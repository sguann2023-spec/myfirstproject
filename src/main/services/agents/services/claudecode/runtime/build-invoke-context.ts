import path from 'node:path'

import { getGlobalSkillsRoot } from '@main/services/agents/skills/paths'

import type { GetAgentSessionResponse } from '../..'
import type { ToolSurface } from '../tool-surface'
import type { ClaudeRuntimeEnvironment } from './build-runtime'
import type {
  ClaudeCodeInvokeContext,
  PromptRuntimeSnapshot,
  ProjectionContext,
  RuntimeSnapshot,
  SkillRuntimeSnapshot,
  ToolRuntimeSnapshot
} from './types'

type WorkspaceSkillEntry = {
  name: string
  description?: string
  filename: string
  skillMdPath?: string
  source?: 'workspace' | 'global'
}

type SkillInvocationContextInput = {
  skillName: string
  skillMdPath: string
  skillMarkdown: string
  injectedPrompt: string
  triggerMode: 'explicit' | 'implicit'
}

const VISION_ALLOWED_MODEL_PATTERNS = [
  'llava',
  'moondream',
  'minicpm',
  'gemini-1\\.5',
  'gemini-2\\.0',
  'gemini-2\\.5',
  'gemini-3(?:\\.\\d)?-(?:flash|pro)(?:-preview)?',
  'gemini-(flash|pro|flash-lite)-latest',
  'gemini-exp',
  'claude-3',
  'claude-haiku-4',
  'claude-sonnet-4',
  'claude-opus-4',
  'vision',
  'glm-4(?:\\.\\d+)?v(?:-[\\w-]+)?',
  'qwen-vl',
  'qwen2-vl',
  'qwen2.5-vl',
  'qwen3-vl',
  'qwen3\\.[5-9](?:-[\\w-]+)?',
  'qwen2.5-omni',
  'qwen3-omni(?:-[\\w-]+)?',
  'qvq',
  'internvl2',
  'grok-vision-beta',
  'grok-4(?:-[\\w-]+)?',
  'pixtral',
  'gpt-4(?:-[\\w-]+)',
  'gpt-4.1(?:-[\\w-]+)?',
  'gpt-4o(?:-[\\w-]+)?',
  'gpt-4.5(?:-[\\w-]+)',
  'gpt-5(?:-[\\w-]+)?',
  'chatgpt-4o(?:-[\\w-]+)?',
  'o1(?:-[\\w-]+)?',
  'o3(?:-[\\w-]+)?',
  'o4(?:-[\\w-]+)?',
  'deepseek-vl(?:[\\w-]+)?',
  'kimi-k2.5',
  'kimi-latest',
  'gemma-?[3-4](?:[-.\\w]+)?',
  'doubao-seed-1[.-][68](?:-[\\w-]+)?',
  'doubao-seed-2[.-]0(?:-[\\w-]+)?',
  'doubao-seed-code(?:-[\\w-]+)?',
  'kimi-thinking-preview',
  'gemma3(?:[-:\\w]+)?',
  'kimi-vl-a3b-thinking(?:-[\\w-]+)?',
  'llama-guard-4(?:-[\\w-]+)?',
  'llama-4(?:-[\\w-]+)?',
  'step-1o(?:.*vision)?',
  'step-1v(?:-[\\w-]+)?',
  'qwen-omni(?:-[\\w-]+)?',
  'mistral-large-(2512|latest)',
  'mistral-medium-(2508|latest)',
  'mistral-small-(2506|latest)',
  'mimo-v2-omni(?:-[\\w-]+)?',
  'glm-5v-turbo'
]

const VISION_EXCLUDED_MODEL_PATTERNS = [
  'gpt-4-\\d+-preview',
  'gpt-4-turbo-preview',
  'gpt-4-32k',
  'gpt-4-\\d+',
  'o1-mini',
  'o3-mini',
  'o1-preview',
  'AIDC-AI/Marco-o1'
]

const VISION_MODEL_REGEX = new RegExp(
  `\\b(?!(?:${VISION_EXCLUDED_MODEL_PATTERNS.join('|')})\\b)(${VISION_ALLOWED_MODEL_PATTERNS.join('|')})\\b`,
  'i'
)

function getUserSelectedVisionCapability(model: Record<string, unknown> | undefined): boolean | undefined {
  const capabilities = Array.isArray(model?.capabilities) ? model.capabilities : []
  for (const capability of capabilities) {
    if (!capability || typeof capability !== 'object') continue
    const record = capability as Record<string, unknown>
    if (record.type === 'vision') {
      return typeof record.isUserSelected === 'boolean' ? record.isUserSelected : undefined
    }
  }
  return undefined
}

export function modelSupportsImageInput(runtimeEnvironment: ClaudeRuntimeEnvironment): boolean {
  const provider = runtimeEnvironment.modelInfo.provider
  const modelId = String(runtimeEnvironment.modelInfo.modelId || '').trim()
  const providerModels = Array.isArray(provider?.models) ? provider.models : []
  const configuredModel = providerModels.find((model) => model?.id === modelId) as Record<string, unknown> | undefined

  const explicitVision = getUserSelectedVisionCapability(configuredModel)
  if (explicitVision !== undefined) return explicitVision

  const candidates = [
    modelId,
    typeof configuredModel?.name === 'string' ? configuredModel.name : '',
    typeof configuredModel?.id === 'string' ? configuredModel.id : ''
  ]

  return candidates.some((candidate) => VISION_MODEL_REGEX.test(candidate))
}

export async function buildClaudeCodeInvokeContext(input: {
  traceId: string
  prompt: string
  sdkPrompt: string
  session: GetAgentSessionResponse
  cwd: string
  images?: Array<{ data: string; media_type: string }>
  builtinRole?: string
  autonomousEnabled: boolean
  runtimeEnvironment: ClaudeRuntimeEnvironment
  workspaceSkills: WorkspaceSkillEntry[]
  activeClaudeSkillNames: string[]
  preferredLocalSkillFilename?: string
  preferredLocalSkillSdkDiscovered: boolean
  preferredLocalSkillMatchedBy?: string[]
  preferredLocalSkillMatchedEvidence?: string[]
  preferredLocalSkillTriggerMode?: 'explicit' | 'implicit'
  skillInvocationContext?: SkillInvocationContextInput
  toolSurface: ToolSurface
  mountedRuntimeMcpServers: string[]
  promptSnapshot: {
    systemPrompt: string
    currentUserPrompt: string
    activeSegmentId?: string
    currentTurnId?: string
    userMessageId?: string
    assistantMessageId?: string
    piSessionId?: string
    assistantSystemPrompt?: string
    clawSystemPrompt?: string
  }
}): Promise<ClaudeCodeInvokeContext> {
  const {
    traceId,
    prompt,
    sdkPrompt,
    session,
    cwd,
    images,
    builtinRole,
    autonomousEnabled,
    runtimeEnvironment,
    workspaceSkills,
    activeClaudeSkillNames,
    preferredLocalSkillFilename,
    preferredLocalSkillSdkDiscovered,
    preferredLocalSkillMatchedBy,
    preferredLocalSkillMatchedEvidence,
    preferredLocalSkillTriggerMode,
    skillInvocationContext,
    toolSurface,
    mountedRuntimeMcpServers,
    promptSnapshot
  } = input

  const runtime = buildRuntimeSnapshot({
    traceId,
    prompt,
    session,
    cwd,
    images,
    builtinRole,
    autonomousEnabled,
    runtimeEnvironment
  })
  const skills = buildSkillRuntimeSnapshot({
    workspaceSkills,
    activeClaudeSkillNames,
    preferredLocalSkillFilename,
    preferredLocalSkillSdkDiscovered,
    preferredLocalSkillMatchedBy,
    preferredLocalSkillMatchedEvidence,
    preferredLocalSkillTriggerMode,
    skillInvocationContext
  })
  const tools = buildToolRuntimeSnapshot({
    toolSurface,
    mountedRuntimeMcpServers
  })
  const promptRuntime = buildPromptRuntimeSnapshot({
    sdkPrompt,
    systemPrompt: promptSnapshot.systemPrompt,
    skillInvocationContext,
    assistantSystemPrompt: promptSnapshot.assistantSystemPrompt,
    clawSystemPrompt: promptSnapshot.clawSystemPrompt
  })
  const projection = buildProjectionContext({
    traceId,
    topicId: session.id,
    turnId: promptSnapshot.currentTurnId,
    userMessageId: promptSnapshot.userMessageId,
    assistantMessageId: promptSnapshot.assistantMessageId,
    segmentId: promptSnapshot.activeSegmentId,
    piSessionId: promptSnapshot.piSessionId || session.id
  })

  return {
    runtime,
    skills,
    tools,
    prompt: promptRuntime,
    projection
  }
}

function buildRuntimeSnapshot(input: {
  traceId: string
  prompt: string
  session: GetAgentSessionResponse
  cwd: string
  images?: Array<{ data: string; media_type: string }>
  builtinRole?: string
  autonomousEnabled: boolean
  runtimeEnvironment: ClaudeRuntimeEnvironment
}): RuntimeSnapshot {
  const { traceId, prompt, session, cwd, images, builtinRole, autonomousEnabled, runtimeEnvironment } = input
  const provider = runtimeEnvironment.modelInfo.provider
  const sessionEnvVars = (session.configuration as Record<string, unknown> | undefined)?.env_vars as
    | Record<string, unknown>
    | undefined
  const gatewayApiKey = String(sessionEnvVars?.VECTCUT_API_KEY || '').trim()
  const authMode =
    gatewayApiKey && provider?.apiKey === gatewayApiKey
      ? 'session_fallback'
      : provider?.apiKey
        ? 'provider_key'
        : 'runtime_token'

  return {
    traceId,
    agentId: session.agent_id,
    sessionId: session.id,
    workspacePath: cwd,
    accessiblePaths: session.accessible_paths ?? [],
    prompt,
    images: images?.map((image) => ({
      data: image.data,
      mediaType: image.media_type
    })),
    builtinRole,
    autonomousEnabled,
    sessionConfig: (session.configuration as Record<string, unknown> | undefined) ?? {},
    model: {
      id: runtimeEnvironment.modelInfo.modelId,
      providerId: provider?.id ?? '',
      providerType: provider?.type ?? '',
      supportsImageInput: modelSupportsImageInput(runtimeEnvironment),
      contextWindowTokens: runtimeEnvironment.modelTokenLimits?.contextWindowTokens,
      maxInputTokens: runtimeEnvironment.modelTokenLimits?.maxInputTokens,
      maxOutputTokens: runtimeEnvironment.modelTokenLimits?.maxOutputTokens,
      compactionTriggerTokens: runtimeEnvironment.modelTokenLimits?.compactionTriggerTokens
    },
    provider: {
      id: provider?.id ?? '',
      type: provider?.type ?? '',
      apiHost: provider?.apiHost,
      anthropicApiHost: provider?.anthropicApiHost,
      authMode
    }
  }
}

function buildSkillRuntimeSnapshot(input: {
  workspaceSkills: WorkspaceSkillEntry[]
  activeClaudeSkillNames: string[]
  preferredLocalSkillFilename?: string
  preferredLocalSkillSdkDiscovered: boolean
  preferredLocalSkillMatchedBy?: string[]
  preferredLocalSkillMatchedEvidence?: string[]
  preferredLocalSkillTriggerMode?: 'explicit' | 'implicit'
  skillInvocationContext?: SkillInvocationContextInput
}): SkillRuntimeSnapshot {
  const {
    workspaceSkills,
    activeClaudeSkillNames,
    preferredLocalSkillFilename,
    preferredLocalSkillSdkDiscovered,
    preferredLocalSkillMatchedBy,
    preferredLocalSkillMatchedEvidence,
    preferredLocalSkillTriggerMode,
    skillInvocationContext
  } = input

  return {
    visibleSkills: workspaceSkills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      filePath: skill.skillMdPath ?? path.join(getGlobalSkillsRoot(), skill.filename, 'SKILL.md'),
      source: skill.source ?? ('workspace' as const)
    })),
    activeSkillNames: [...activeClaudeSkillNames],
    preferredSkillName: preferredLocalSkillFilename,
    activationMode: preferredLocalSkillTriggerMode
      ? preferredLocalSkillTriggerMode === 'explicit'
        ? 'invoke'
        : 'suggest'
      : 'none',
    sdkDiscovered: preferredLocalSkillSdkDiscovered,
    matchedBy: preferredLocalSkillMatchedBy ?? [],
    matchedEvidence: preferredLocalSkillMatchedEvidence ?? [],
    skillInvocationContext: skillInvocationContext
      ? {
          skillName: skillInvocationContext.skillName,
          skillFilePath: skillInvocationContext.skillMdPath,
          triggerMode: skillInvocationContext.triggerMode,
          skillMarkdown: skillInvocationContext.skillMarkdown,
          injectedPrompt: skillInvocationContext.injectedPrompt
        }
      : undefined
  }
}

function buildToolRuntimeSnapshot(input: {
  toolSurface: ToolSurface
  mountedRuntimeMcpServers: string[]
}): ToolRuntimeSnapshot {
  const { toolSurface, mountedRuntimeMcpServers } = input
  return {
    allTools: [...toolSurface.builtinTools],
    activeToolNames: [...toolSurface.builtinTools],
    autoAllowTools: Array.from(toolSurface.autoAllowedTools).sort(),
    toolLayer: toolSurface.layer,
    mountedMcpServers: mountedRuntimeMcpServers.map((serverName) => ({
      key: serverName,
      name: serverName,
      source: 'runtime' as const
    }))
  }
}

function buildPromptRuntimeSnapshot(input: {
  sdkPrompt: string
  systemPrompt: string
  skillInvocationContext?: SkillInvocationContextInput
  assistantSystemPrompt?: string
  clawSystemPrompt?: string
}): PromptRuntimeSnapshot {
  const { sdkPrompt, systemPrompt, skillInvocationContext, assistantSystemPrompt, clawSystemPrompt } = input

  const resourcesSkills = skillInvocationContext
    ? [
        {
          name: skillInvocationContext.skillName,
          description: skillInvocationContext.triggerMode === 'explicit' ? 'Explicitly invoked skill' : 'Suggested skill',
          content: skillInvocationContext.skillMarkdown,
          filePath: skillInvocationContext.skillMdPath
        }
      ]
    : []

  return {
    systemPrompt,
    initialMessages: [
      {
        role: 'user',
        content: sdkPrompt
      }
    ],
    resources: {
      skills: resourcesSkills,
      promptTemplates: [
        ...(assistantSystemPrompt
          ? [
              {
                name: 'assistant-system-prompt',
                description: 'Resolved assistant system prompt snapshot',
                content: assistantSystemPrompt
              }
            ]
          : []),
        ...(clawSystemPrompt
          ? [
              {
                name: 'claw-system-prompt',
                description: 'Resolved claw system prompt snapshot',
                content: clawSystemPrompt
              }
            ]
          : [])
      ]
    }
  }
}

function buildProjectionContext(input: {
  traceId: string
  topicId: string
  turnId?: string
  userMessageId?: string
  assistantMessageId?: string
  segmentId?: string
  piSessionId: string
}): ProjectionContext {
  const { traceId, topicId, turnId, userMessageId, assistantMessageId, segmentId, piSessionId } = input
  return {
    traceId,
    topicId,
    turnId,
    userMessageId,
    assistantMessageId,
    segmentId,
    piSessionId,
    artifactStrategy: 'store_large_results',
    fileChangeTracking: true
  }
}
