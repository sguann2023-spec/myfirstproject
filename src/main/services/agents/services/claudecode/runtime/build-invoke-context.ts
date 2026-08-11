import path from 'node:path'

import { getGlobalSkillsRoot } from '@main/services/agents/skills/paths'

import type { GetAgentSessionResponse } from '../..'
import type { ToolSurface } from '../tool-surface'
import type { WorkspaceSkillSurface } from '../skills/runtime-skills'
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
  workspaceSkillSurface: WorkspaceSkillSurface
  activeClaudeSkillNames: string[]
  preferredLocalSkillFilename?: string
  preferredLocalSkillSdkDiscovered: boolean
  preferredLocalSkillMatchedBy?: string[]
  preferredLocalSkillMatchedEvidence?: string[]
  preferredLocalSkillTriggerMode?: 'explicit' | 'implicit'
  skillInvocationContext?: SkillInvocationContextInput
  toolSurface: ToolSurface
  selectedCapabilities: string[]
  mountedRuntimeMcpServers: string[]
  promptSnapshot: {
    systemPrompt: string
    currentUserPrompt: string
    activeSegmentId?: string
    currentTurnId?: string
    piSessionId?: string
    assistantSystemPrompt?: string
    clawSystemPrompt?: string
    factsRecall?: string
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
    selectedCapabilities,
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
    cwd,
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
    selectedCapabilities,
    mountedRuntimeMcpServers
  })
  const promptRuntime = buildPromptRuntimeSnapshot({
    sdkPrompt,
    systemPrompt: promptSnapshot.systemPrompt,
    skillInvocationContext,
    assistantSystemPrompt: promptSnapshot.assistantSystemPrompt,
    clawSystemPrompt: promptSnapshot.clawSystemPrompt,
    factsRecall: promptSnapshot.factsRecall
  })
  const projection = buildProjectionContext({
    traceId,
    topicId: session.id,
    turnId: promptSnapshot.currentTurnId,
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
      providerType: provider?.type ?? ''
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
  cwd: string
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
    cwd,
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
  selectedCapabilities: string[]
  mountedRuntimeMcpServers: string[]
}): ToolRuntimeSnapshot {
  const { toolSurface, selectedCapabilities, mountedRuntimeMcpServers } = input
  return {
    allTools: [...toolSurface.builtinTools],
    activeToolNames: [...toolSurface.builtinTools],
    allowedTools: [...toolSurface.allowedToolsOption],
    autoAllowTools: Array.from(toolSurface.autoAllowedTools).sort(),
    selectedCapabilities,
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
  factsRecall?: string
}): PromptRuntimeSnapshot {
  const { sdkPrompt, systemPrompt, skillInvocationContext, assistantSystemPrompt, clawSystemPrompt, factsRecall } = input

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
          : []),
        ...(factsRecall
          ? [
              {
                name: 'facts-recall',
                description: 'Resolved facts recall snapshot',
                content: factsRecall
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
  segmentId?: string
  piSessionId: string
}): ProjectionContext {
  const { traceId, topicId, turnId, segmentId, piSessionId } = input
  return {
    traceId,
    topicId,
    turnId,
    segmentId,
    piSessionId,
    artifactStrategy: 'store_large_results',
    fileChangeTracking: true
  }
}
