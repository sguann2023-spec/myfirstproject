// src/main/services/agents/services/claudecode/index.ts
import { fork } from 'node:child_process'
import { EventEmitter } from 'node:events'
import * as fs from 'node:fs'
import path from 'node:path'

import type {
  Options,
  SpawnedProcess
} from '@anthropic-ai/claude-agent-sdk'
import { loggerService } from '@logger'
import BrowserServer from '@main/mcpServers/browser/server'
import ImageGenerateServer from '@main/mcpServers/image-generate'
import {
  getNodeProxyConfigFromEnvironment,
  getProxyProtocol
} from '@main/services/proxy/nodeProxy'
import { toAsarUnpackedPath } from '@main/utils'
import { GLOBALLY_DISALLOWED_TOOLS } from '@shared/agents/claudecode/constants'
import { app } from 'electron'

import type { GetAgentSessionResponse } from '../..'
import type {
  AgentServiceInterface,
  AgentStream,
  AgentStreamEvent,
  AgentThinkingOptions
} from '../../interfaces/AgentStreamInterface'
import { buildWorkspaceSkillMountPacket } from '../../skill-mounting/SkillMountPacketBuilder'
import { buildHostSkillInvocationPrompt } from '../../skill-mounting/SkillPromptBridge'
import { resolveWorkspaceSkillInvocation } from '../../skill-mounting/SkillInvokeService'
import type { SkillMountPacket } from '../../skill-mounting/types'
import { skillService } from '../../skills/SkillService'
import { agentMessageRepository } from '../../database/sessionMessageRepository'
import { agentService } from '../AgentService'
import { isProvisioned, provisionBuiltinAgent } from '../builtin/BuiltinAgentProvisioner'
import {
  CapabilityRouter,
  buildToolGuidanceOptions,
  type RuntimeToolLayer
} from './capability-router'
import { logPromptBudgetProbe } from './prompt-budget'
import { buildInlineToolResultText, stringifyToolResult } from './tool-result-text'
import { buildToolSurface } from './tool-surface'
import { createClaudeCodeHarness } from './harness/create-harness'
import { processPiHarnessQuery } from './harness/pi-query-stream'
import { buildInvocationPromptState } from './runtime/build-invocation-prompt'
import { buildClaudeCodeInvokeContext } from './runtime/build-invoke-context'
import {
  buildClaudeRuntimeEnvironment,
  type ClaudeRuntimeEnvironment,
  resolveWorkspaceCwd
} from './runtime/build-runtime'
import { scanWorkspaceSkillSurface } from './skills/runtime-skills'
import { createToolPermissionHandlers } from './tools/permission-hooks'
import {
  attachInternalToolContext,
  capturePendingFileChanges,
  isRecord,
  normalizeToolName,
  requiresInteractiveApproval,
  resolveToolFilePath,
  type ApprovalCacheValue,
  type PendingFileChangeSnapshot
} from './tools/runtime-file-helpers'
import { discoverClaudeCodePlugins } from './tools/runtime-plugins'
import { mountRuntimeMcpServers } from './tools/registry'

const require_ = require
const logger = loggerService.withContext('ClaudeCodeService')
const shouldMountAllRuntimeMcpTools = process.env.CHERRY_AGENT_MOUNT_ALL_MCP_TOOLS === '1'
const NO_RESUME_COMMANDS = ['/clear']
const ROUTING_CONTEXT_MAX_TURNS = 10
const ROUTING_CONTEXT_MAX_MESSAGES = ROUTING_CONTEXT_MAX_TURNS * 2
const ROUTING_CONTEXT_MAX_CHARS = 6000
const ROUTING_CONTEXT_MAX_MESSAGE_CHARS = 500
const GIT_BASH_PATH_ERROR_SIGNATURE = 'CLAUDE_CODE_GIT_BASH_PATH path'

const summarizePathSnapshot = (targetPath?: string | null) => {
  const resolvedPath = String(targetPath || '').trim()
  if (!resolvedPath) {
    return {
      path: '',
      exists: false,
      parentPath: '',
      parentExists: false,
      isFile: false,
      size: null,
      parentEntriesPreview: []
    }
  }

  const parentPath = path.dirname(resolvedPath)
  const exists = fs.existsSync(resolvedPath)
  const parentExists = fs.existsSync(parentPath)
  let isFile = false
  let size: number | null = null
  let parentEntriesPreview: string[] = []

  try {
    if (exists) {
      const stat = fs.statSync(resolvedPath)
      isFile = stat.isFile()
      size = stat.size
    }
  } catch {
    // best-effort logging only
  }

  try {
    if (parentExists) {
      parentEntriesPreview = fs.readdirSync(parentPath).slice(0, 8)
    }
  } catch {
    // best-effort logging only
  }

  return {
    path: resolvedPath,
    exists,
    parentPath,
    parentExists,
    isFile,
    size,
    parentEntriesPreview
  }
}

const extractMainTextFromPersistedMessage = (message: unknown): string => {
  const blocks = Array.isArray((message as { blocks?: unknown[] } | null)?.blocks)
    ? ((message as { blocks: unknown[] }).blocks ?? [])
    : []
  const parts: string[] = []

  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue
    const candidate = block as {
      type?: unknown
      content?: unknown
      toolName?: unknown
      metadata?: {
        rawMcpToolResponse?: {
          responseRaw?: unknown
          response?: unknown
          tool?: { name?: unknown }
        }
      }
    }

    if (candidate.type === 'main_text') {
      if (typeof candidate.content === 'string' && candidate.content.trim()) {
        parts.push(candidate.content.trim())
      }
      continue
    }

    if (candidate.type !== 'tool') {
      continue
    }

    const rawToolResponse = candidate.metadata?.rawMcpToolResponse
    const toolName = String(rawToolResponse?.tool?.name || candidate.toolName || 'tool').trim()
    const toolOutput = rawToolResponse?.responseRaw ?? rawToolResponse?.response ?? candidate.content
    const serializedToolOutput = stringifyToolResult(toolOutput).trim()
    if (!serializedToolOutput) {
      continue
    }
    parts.push(`[工具 ${toolName} 输出]\n${buildInlineToolResultText(serializedToolOutput, `${toolName} 回包`)}`)
  }

  return parts.join('\n\n').trim()
}

const normalizeRoutingText = (value: string): string => String(value || '').replace(/\s+/g, ' ').trim()

const truncateRoutingText = (value: string, maxChars: number): string => {
  if (value.length <= maxChars) return value
  return `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}...`
}

const resolveCapabilityRoutingPrompt = async (sessionId: string, prompt: string): Promise<string | undefined> => {
  const currentPrompt = normalizeRoutingText(prompt)
  if (!currentPrompt) {
    return undefined
  }

  try {
    const history = await agentMessageRepository.getSessionHistory(sessionId)
    const recentMessages = history
      .map((item) => {
        const role = (item as { message?: { role?: unknown } } | null)?.message?.role
        if (role !== 'user' && role !== 'assistant') return null

        const text = normalizeRoutingText(extractMainTextFromPersistedMessage(item))
        if (!text) return null

        return {
          role,
          text: truncateRoutingText(text, ROUTING_CONTEXT_MAX_MESSAGE_CHARS)
        }
      })
      .filter((item): item is { role: 'user' | 'assistant'; text: string } => item !== null)

    const dedupedRecentMessages =
      recentMessages.length > 0 &&
      recentMessages[recentMessages.length - 1]?.role === 'user' &&
      recentMessages[recentMessages.length - 1]?.text === currentPrompt
        ? recentMessages.slice(0, -1)
        : recentMessages

    const boundedMessages = dedupedRecentMessages.slice(-ROUTING_CONTEXT_MAX_MESSAGES)
    const selectedParts: string[] = []
    let totalChars = currentPrompt.length

    for (let index = boundedMessages.length - 1; index >= 0; index -= 1) {
      const item = boundedMessages[index]
      const line = `${item.role === 'user' ? '用户' : 'AI'}: ${item.text}`
      if (selectedParts.length > 0 && totalChars + line.length + 1 > ROUTING_CONTEXT_MAX_CHARS) {
        break
      }

      selectedParts.unshift(line)
      totalChars += line.length + 1
    }

    selectedParts.push(`用户: ${currentPrompt}`)
    return selectedParts.join('\n')
  } catch (error) {
    logger.warn('Failed to resolve conversation context for capability routing', {
      sessionId,
      error: error instanceof Error ? error.message : String(error)
    })
  }

  return undefined
}

const getArgValue = (args: string[], flag: string): string | undefined => {
  const index = args.indexOf(flag)
  if (index < 0 || index + 1 >= args.length) return undefined
  return args[index + 1]
}

const countArg = (args: string[], flag: string): number => args.filter((arg) => arg === flag).length

const hasWorkspaceAccess = (layer: RuntimeToolLayer): boolean =>
  layer === 'workspace-read' || layer === 'workspace-write' || layer === 'agentic'

const splitArgList = (value: string | undefined): string[] =>
  value === undefined || value === '' ? [] : value.split(',').map((item) => item.trim()).filter(Boolean)

const getMcpServerNamesFromArg = (value: string | undefined): string[] => {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as { mcpServers?: Record<string, unknown> }
    return Object.keys(parsed.mcpServers ?? {}).sort()
  } catch {
    return ['<unparseable>']
  }
}

const summarizeClaudeSpawnArgs = (args: string[], cwd: string) => {
  const toolsArg = getArgValue(args, '--tools')
  const settingSourcesArg = getArgValue(args, '--setting-sources')
  const allowedTools = splitArgList(getArgValue(args, '--allowedTools'))
  const disallowedTools = splitArgList(getArgValue(args, '--disallowedTools'))
  const mcpServerNames = getMcpServerNamesFromArg(getArgValue(args, '--mcp-config'))

  return {
    cwd,
    executable: path.basename(args[0] ?? ''),
    argCount: args.length,
    model: getArgValue(args, '--model') ?? null,
    toolsArg: toolsArg ?? null,
    toolsDisabled: toolsArg === '',
    settingSourcesArg: settingSourcesArg ?? null,
    settingSourcesDisabled: settingSourcesArg === '',
    allowedToolCount: allowedTools.length,
    allowedToolsPreview: allowedTools.slice(0, 30),
    disallowedToolCount: disallowedTools.length,
    mcpServerCount: mcpServerNames.length,
    mcpServerNames,
    pluginDirCount: countArg(args, '--plugin-dir'),
    additionalDirectoryCount: countArg(args, '--add-dir'),
    strictMcpConfig: args.includes('--strict-mcp-config'),
    permissionMode: getArgValue(args, '--permission-mode') ?? null,
    hasResume: args.includes('--resume'),
    maxTurns: getArgValue(args, '--max-turns') ?? null
  }
}

class ClaudeCodeStream extends EventEmitter implements AgentStream {
  declare emit: (event: 'data', data: AgentStreamEvent) => boolean
  declare on: (event: 'data', listener: (data: AgentStreamEvent) => void) => this
  declare once: (event: 'data', listener: (data: AgentStreamEvent) => void) => this
  /** SDK session_id captured from the init message, used for resume. */
  sdkSessionId?: string
}

class ClaudeCodeService implements AgentServiceInterface {
  private claudeExecutablePath: string
  private claudeProxyBootstrapPath: string
  private browserServers = new Map<string, BrowserServer>()
  private readonly imageGenerateServer: ImageGenerateServer
  private readonly capabilityRouter = new CapabilityRouter({
    forceMountAllRuntimeMcpTools: shouldMountAllRuntimeMcpTools
  })

  constructor() {
    // Resolve Claude Code CLI robustly (works in dev and in asar)
    this.claudeExecutablePath = toAsarUnpackedPath(
      path.join(path.dirname(require_.resolve('@anthropic-ai/claude-agent-sdk')), 'cli.js')
    )
    this.claudeProxyBootstrapPath = toAsarUnpackedPath(path.join(app.getAppPath(), 'out', 'proxy', 'index.js'))
    this.imageGenerateServer = new ImageGenerateServer()

    void app.whenReady().then(async () => {
      try {
        const payload = await this.imageGenerateServer.getImageModelList()
        logger.info('Preloaded image model list', {
          count: payload.models.length
        })
      } catch (error) {
        logger.warn('Failed to preload image model list', {
          error: error instanceof Error ? error.message : String(error)
        })
      }
    })
  }

  private async getOrCreateBrowserServer(sessionId: string): Promise<BrowserServer> {
    const existing = this.browserServers.get(sessionId)
    if (existing) {
      logger.info('Resetting browser MCP server before session reuse', { sessionId })
      this.browserServers.delete(sessionId)
      await existing.close().catch((error: unknown) => {
        logger.warn('Failed to close browser MCP server before session reuse', {
          sessionId,
          error: error instanceof Error ? error.message : String(error)
        })
      })
    }

    const browserServer = new BrowserServer()
    this.browserServers.set(sessionId, browserServer)
    logger.info('Created browser MCP server for session', {
      sessionId,
      cachedSessionCount: this.browserServers.size
    })
    return browserServer
  }

  async invoke(
    prompt: string,
    session: GetAgentSessionResponse,
    abortController: AbortController,
    lastAgentSessionId?: string,
    thinkingOptions?: AgentThinkingOptions,
    modelOverride?: string,
    images?: Array<{ data: string; media_type: string }>
  ): Promise<AgentStream> {
    const aiStream = new ClaudeCodeStream()

    const cwd = resolveWorkspaceCwd(session)
    if (!cwd) {
      aiStream.emit('data', {
        type: 'error',
        error: new Error('No accessible paths defined for the agent session')
      })
      return aiStream
    }

    const agent = await agentService.getAgent(session.agent_id)
    const agentConfig = agent?.configuration
    const autonomousEnabled = agentConfig?.soul_enabled === true || agentConfig?.scheduler_enabled === true
    const builtinRole = (session.configuration as Record<string, unknown> | undefined)?.builtin_role as
      | string
      | undefined
    const isAssistant = builtinRole === 'assistant'
    let workspaceSkills: Array<{
      name: string
      description?: string
      filename: string
      skillMdPath?: string
      source?: 'workspace' | 'global'
    }> = []
    if (cwd) {
      try {
        const [localWorkspaceSkills, hiddenBuiltinSkills] = await Promise.all([
          skillService.listLocal(cwd),
          skillService.listHiddenBuiltinSkills()
        ])
        workspaceSkills = [...localWorkspaceSkills, ...hiddenBuiltinSkills]
      } catch (error) {
        logger.warn('Failed to scan workspace skills before capability routing', {
          sessionId: session.id,
          cwd,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
    const intentPrompt = await resolveCapabilityRoutingPrompt(session.id, prompt)
    const capabilityDecision = this.capabilityRouter.select({
      prompt,
      intentPrompt,
      sessionId: session.id,
      imageCount: images?.length ?? 0,
      isAssistant,
      autonomousEnabled,
      builtinRole,
      hasCustomMcpServers: Boolean(session.mcps?.length),
      workspaceSkills
    })
    const selectedRuntimeCapabilities = capabilityDecision.selected
    const toolGuidanceOptions = buildToolGuidanceOptions({
      decision: capabilityDecision,
      autonomousEnabled
    })

    const skillWorkspace = cwd
    const shouldReconcileSkills =
      selectedRuntimeCapabilities.has('skills') || process.env.CHERRY_AGENT_RECONCILE_SKILLS === '1'

    // Refresh active `.claude/skills` only when this turn actually needs skill
    // management. The SDK auto-discovers project skills, so idle reconciliation
    // is a token-budget footgun.
    let activeClaudeSkillNames: string[] = []
    if (shouldReconcileSkills) {
      try {
        await skillService.reconcileAgentSkills(session.agent_id, skillWorkspace)
        const activeClaudeSkills = await skillService.listLocal(skillWorkspace)
        activeClaudeSkillNames = activeClaudeSkills.map((skill) => skill.filename).filter(Boolean).sort()
      } catch (error) {
        logger.warn('Failed to reconcile agent skills before session start', {
          agentId: session.agent_id,
          skillWorkspace,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
    const workspaceSkillSurface = await scanWorkspaceSkillSurface(skillWorkspace)
    let skillMountPacket: SkillMountPacket | undefined
    let preferredWorkspaceSkill = capabilityDecision.preferredLocalSkillFilename
      ? workspaceSkills.find((skill) => skill.filename === capabilityDecision.preferredLocalSkillFilename)
      : undefined
    let preferredLocalSkillSdkDiscovered = capabilityDecision.preferredLocalSkillFilename
      ? activeClaudeSkillNames.includes(capabilityDecision.preferredLocalSkillFilename)
      : false

    if (
      skillWorkspace &&
      capabilityDecision.preferredLocalSkillFilename &&
      capabilityDecision.preferredLocalSkillTriggerMode &&
      !preferredLocalSkillSdkDiscovered
    ) {
      try {
        await skillService.reconcileAgentSkills(session.agent_id, skillWorkspace)
        const [localWorkspaceSkills, hiddenBuiltinSkills] = await Promise.all([
          skillService.listLocal(skillWorkspace),
          skillService.listHiddenBuiltinSkills()
        ])
        workspaceSkills = [...localWorkspaceSkills, ...hiddenBuiltinSkills]
        preferredWorkspaceSkill = workspaceSkills.find(
          (skill) => skill.filename === capabilityDecision.preferredLocalSkillFilename
        )
        activeClaudeSkillNames = workspaceSkills.map((skill) => skill.filename).filter(Boolean).sort()
        preferredLocalSkillSdkDiscovered = activeClaudeSkillNames.includes(capabilityDecision.preferredLocalSkillFilename)
      } catch (error) {
        logger.warn('Failed to force skill reconcile for SDK auto-discovery', {
          agentId: session.agent_id,
          sessionId: session.id,
          skillWorkspace,
          preferredLocalSkillFilename: capabilityDecision.preferredLocalSkillFilename,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    if (preferredWorkspaceSkill && capabilityDecision.preferredLocalSkillTriggerMode) {
      toolGuidanceOptions.preferredLocalSkillSdkDiscovered = preferredLocalSkillSdkDiscovered
      skillMountPacket = await buildWorkspaceSkillMountPacket({
        workspaceId: cwd,
        sessionId: session.id,
        turn: capabilityDecision.turn,
        workspacePath: cwd,
        skill: preferredWorkspaceSkill,
        mountMode: 'invoke',
        triggerMode: capabilityDecision.preferredLocalSkillTriggerMode,
        matchedBy: capabilityDecision.preferredLocalSkillMatchedBy ?? [],
        matchedEvidence: capabilityDecision.preferredLocalSkillMatchedEvidence ?? [],
        routeReason: capabilityDecision.domainReasons,
        promptHintLevel: 'hard',
        sdkDiscovered: preferredLocalSkillSdkDiscovered
      })
    } else if (capabilityDecision.preferredLocalSkillFilename) {
      toolGuidanceOptions.preferredLocalSkillSdkDiscovered = preferredLocalSkillSdkDiscovered
    }
    logger.info('[ToolRouter] active Claude skills snapshot', {
      agentId: session.agent_id,
      sessionId: session.id,
      skillWorkspace,
      reconciled: shouldReconcileSkills,
      activeSkillCount: activeClaudeSkillNames.length,
      activeSkills: activeClaudeSkillNames.slice(0, 50),
      omittedSkillCount: Math.max(0, activeClaudeSkillNames.length - 50),
      preferredLocalSkillFilename: capabilityDecision.preferredLocalSkillFilename,
      preferredLocalSkillSdkDiscovered,
      workspaceSkillSurface
    })

    let sdkPrompt = prompt
    let skillMdLoaded = false
    let skillInvocationContext:
      | {
          skillName: string
          skillMdPath: string
          skillMarkdown: string
          injectedPrompt: string
          triggerMode: 'explicit' | 'implicit'
        }
      | undefined
    if (preferredWorkspaceSkill && capabilityDecision.preferredLocalSkillTriggerMode) {
      try {
        const resolvedSkillInvocation = await resolveWorkspaceSkillInvocation({
          workspacePath: skillWorkspace,
          skillName: preferredWorkspaceSkill.filename,
          skillMdPath: preferredWorkspaceSkill.skillMdPath,
          triggerMode: capabilityDecision.preferredLocalSkillTriggerMode
        })
        sdkPrompt = buildHostSkillInvocationPrompt({
          prompt,
          skillName: resolvedSkillInvocation.skillName,
          skillMdPath: resolvedSkillInvocation.skillMdPath,
          skillMarkdown: resolvedSkillInvocation.skillMarkdown,
          triggerMode: resolvedSkillInvocation.triggerMode
        })
        skillInvocationContext = {
          skillName: resolvedSkillInvocation.skillName,
          skillMdPath: resolvedSkillInvocation.skillMdPath,
          skillMarkdown: resolvedSkillInvocation.skillMarkdown,
          injectedPrompt: sdkPrompt,
          triggerMode: resolvedSkillInvocation.triggerMode
        }
        skillMdLoaded = true
        logger.info('[ToolRouter] resolved local skill invocation context', {
          agentId: session.agent_id,
          sessionId: session.id,
          preferredLocalSkillFilename: preferredWorkspaceSkill.filename,
          triggerMode: capabilityDecision.preferredLocalSkillTriggerMode,
          skillMdPath: resolvedSkillInvocation.skillMdPath,
          skillMdChars: resolvedSkillInvocation.skillMarkdown.length,
          originalPromptLength: prompt.length,
          sdkPromptLength: sdkPrompt.length,
          sdkPromptPreview: sdkPrompt.slice(0, 240)
        })
      } catch (error) {
        logger.warn('[ToolRouter] failed to resolve local skill invocation context', {
          agentId: session.agent_id,
          sessionId: session.id,
          preferredLocalSkillFilename: preferredWorkspaceSkill.filename,
          triggerMode: capabilityDecision.preferredLocalSkillTriggerMode,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    logger.info('[ToolRouter] capability decision', {
      agentId: session.agent_id,
      sessionId: session.id,
      turn: capabilityDecision.turn,
      activeDomains: capabilityDecision.activeDomains,
      primaryDomain: capabilityDecision.primaryDomain,
      subdomains: capabilityDecision.subdomains,
      companionDomains: capabilityDecision.companionDomains,
      domainReasons: capabilityDecision.domainReasons,
      selectedCapabilities: Array.from(capabilityDecision.selected).sort(),
      reasons: capabilityDecision.reasons,
      stickyApplied: capabilityDecision.stickyApplied,
      toolLayer: capabilityDecision.toolLayer,
      toolLayerReasons: capabilityDecision.toolLayerReasons,
      preferredLocalSkillFilename: capabilityDecision.preferredLocalSkillFilename,
      preferredLocalSkillTriggerMode: capabilityDecision.preferredLocalSkillTriggerMode,
      preferredLocalSkillMatchedBy: capabilityDecision.preferredLocalSkillMatchedBy,
      preferredLocalSkillMatchedEvidence: capabilityDecision.preferredLocalSkillMatchedEvidence,
      preferredLocalSkillSdkDiscovered,
      skillMdLoaded,
      promptLength: prompt.length,
      sdkPromptLength: sdkPrompt.length,
      routingPromptLength: intentPrompt?.length ?? prompt.length,
      routingContextUsed: Boolean(intentPrompt && intentPrompt !== prompt),
      imageCount: images?.length ?? 0,
      builtinRole: builtinRole ?? '',
      isAssistant,
      autonomousEnabled,
      hasCustomMcpServers: Boolean(session.mcps?.length),
      forceMountAll: shouldMountAllRuntimeMcpTools
    })
    if (skillMountPacket) {
      logger.info('[ToolRouter] skill mount packet', {
        agentId: session.agent_id,
        sessionId: session.id,
        packet: skillMountPacket
      })
    }

    let runtimeEnvironment: ClaudeRuntimeEnvironment
    try {
      runtimeEnvironment = await buildClaudeRuntimeEnvironment({
        session,
        modelOverride,
        cwd,
        enableToolSearch: selectedRuntimeCapabilities.has('skills')
      })
    } catch (error) {
      aiStream.emit('data', {
        type: 'error',
        error: error instanceof Error ? error : new Error(String(error))
      })
      return aiStream
    }
    const { modelInfo, apiConfig, env } = runtimeEnvironment

    const errorChunks: string[] = []

    const toolSurface = buildToolSurface({
      decision: capabilityDecision,
      sessionAllowedTools: session.allowed_tools ?? [],
      isAssistant
    })
    const sessionAllowedTools = new Set<string>(toolSurface.allowedToolsOption)
    const autoAllowTools = toolSurface.autoAllowedTools
    const readFilesInSession = new Set<string>()
    const pendingFileChanges = new Map<string, PendingFileChangeSnapshot[]>()
    const interactiveApprovalCache = new Map<string, ApprovalCacheValue>()
    const capturePendingFileChangeSnapshots = (toolName: string, toolInput: unknown, toolCallId: string) =>
      capturePendingFileChanges({
        toolName,
        toolInput,
        toolCallId,
        cwd,
        pendingFileChanges
      })
    const plugins = await discoverClaudeCodePlugins({
      cwd,
      enabled: hasWorkspaceAccess(capabilityDecision.toolLayer),
      agentId: session.agent_id,
      sessionId: session.id
    })

    const { canUseTool, preToolUseHook, postToolUseHook } = createToolPermissionHandlers({
      sessionId: session.id,
      cwd,
      autoAllowTools,
      sessionAllowedTools,
      readFilesInSession,
      interactiveApprovalCache,
      capturePendingFileChanges: capturePendingFileChangeSnapshots,
      normalizeToolName,
      requiresInteractiveApproval,
      isRecord,
      attachInternalToolContext,
      resolveToolFilePath
    })

    // Provision built-in agent workspace (copy skills/plugins to working directory)
    if (builtinRole && cwd && !isProvisioned(cwd)) {
      const agentConfig = await provisionBuiltinAgent(cwd, builtinRole)
      if (agentConfig?.instructions && !session.instructions) {
        session = { ...session, instructions: agentConfig.instructions }
      }
      logger.info('Provisioned builtin agent workspace', { builtinRole, cwd })
    }

    const {
      traceId,
      activeSegment,
      currentTurn,
      promptEnvelope,
      composedPrompt,
      clawSystemPrompt,
      factsRecall,
      assistantSystemPrompt
    } = await buildInvocationPromptState({
      session,
      cwd,
      sdkPrompt,
      requestPrompt: prompt,
      modelId: modelInfo.modelId,
      toolSurface,
      toolGuidanceOptions,
      isAssistant,
      agentConfig,
      activeClaudeSkillNames,
      lastAgentSessionId
    })

    logger.info('[SegmentCompose] start', {
      topicId: session.id,
      traceId,
      activeSegmentId: activeSegment?.id ?? '',
      sdkSessionId: activeSegment ? activeSegment.sdkSessionId : lastAgentSessionId ?? '',
      hasContinuationSummary: Boolean(activeSegment?.continuationSummary),
      hasPriorArtifacts: false,
      artifactSourceSegmentId: ''
    })

    logger.info('[SegmentCompose] prompt-envelope', {
      topicId: session.id,
      traceId,
      segmentId: activeSegment?.id ?? '',
      systemPromptHash: promptEnvelope.systemPromptHash,
      systemPromptVersion: promptEnvelope.systemPromptVersion,
      stableBasePromptChars: (assistantSystemPrompt ? String(assistantSystemPrompt) : String(clawSystemPrompt || '')).length,
      dynamicContextPromptChars: promptEnvelope.systemPrompt.length,
      systemPromptChars: promptEnvelope.systemPrompt.length,
      continuationSummaryChars: promptEnvelope.promptView.continuationSummary?.length ?? 0,
      recentTurnsCount: promptEnvelope.promptView.recentTurns.length,
      referencedArtifactsCount: promptEnvelope.promptView.referencedArtifacts?.length ?? 0
    })
    // Build SDK options from session configuration.
    // If thinking is not explicitly configured, leave it unset so the runtime
    // does not force adaptive thinking by default.
    const resolvedThinkingConfig = thinkingOptions?.thinking
    const options: Options = {
      abortController,
      cwd,
      env,
      model: modelInfo.modelId,
      pathToClaudeCodeExecutable: this.claudeExecutablePath,
      spawnClaudeCodeProcess: (spawnOptions) => {
        const childEnv = { ...spawnOptions.env } as NodeJS.ProcessEnv

        // Ensure the child process can resolve native modules (e.g. @img/sharp)
        // that live in asar.unpacked alongside the SDK
        childEnv.NODE_PATH = toAsarUnpackedPath(path.join(app.getAppPath(), 'node_modules'))

        let execArgv = process.execArgv

        const activeProxyConfig = getNodeProxyConfigFromEnvironment(childEnv)
        if (activeProxyConfig) {
          const proxyProtocol = getProxyProtocol(activeProxyConfig.proxyRules)

          logger.info('Injecting proxy into Claude Code child process', {
            proxyProtocol,
            proxyRules: activeProxyConfig.proxyRules,
            proxyBypassRules: activeProxyConfig.proxyBypassRules,
            proxyBootstrapPath: this.claudeProxyBootstrapPath
          })

          execArgv = [...process.execArgv, '--disable-warning=UNDICI-EHPA', '--require', this.claudeProxyBootstrapPath]
        }

        logger.info('[PromptBudget] Claude SDK spawn args', summarizeClaudeSpawnArgs(spawnOptions.args, spawnOptions.cwd))
        if (childEnv.CLAUDE_CODE_GIT_BASH_PATH) {
          logger.info('Spawning Claude Code with Git Bash env', {
            cwd: spawnOptions.cwd,
            resourcesPath: process.resourcesPath,
            gitBashPath: childEnv.CLAUDE_CODE_GIT_BASH_PATH,
            gitBashDir: path.dirname(childEnv.CLAUDE_CODE_GIT_BASH_PATH)
          })
        }

        const child = fork(spawnOptions.args[0], spawnOptions.args.slice(1), {
          cwd: spawnOptions.cwd,
          env: childEnv,
          execArgv,
          stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
          signal: spawnOptions.signal
        })
        child.stderr?.on('data', (data: Buffer) => {
          const text = data.toString()
          logger.warn('claude stderr', { chunk: text })
          if (text.includes(GIT_BASH_PATH_ERROR_SIGNATURE)) {
            logger.warn('Claude Git Bash path failure snapshot', {
              cwd: spawnOptions.cwd,
              resourcesPath: process.resourcesPath,
              gitBash: summarizePathSnapshot(childEnv.CLAUDE_CODE_GIT_BASH_PATH)
            })
          }
          errorChunks.push(text)
        })
        return child as unknown as SpawnedProcess
      },
      systemPrompt: promptEnvelope.systemPrompt,
      // Claw-style prompt assembly loads capped workspace instructions itself.
      // Keep SDK project/local settings out of the prompt unless explicitly requested.
      settingSources: process.env.CHERRY_AGENT_USE_SDK_SETTINGS === '1' ? ['project', 'local'] : [],
      includePartialMessages: true,
      permissionMode: session.configuration?.permission_mode,
      maxTurns: session.configuration?.max_turns,
      allowedTools: toolSurface.allowedToolsOption,
      tools: toolSurface.toolsOption,
      plugins,
      canUseTool,
      hooks: {
        PreToolUse: [
          {
            hooks: [preToolUseHook]
          }
        ],
        PostToolUse: [
          {
            hooks: [postToolUseHook]
          }
        ]
      },
      disallowedTools: [
        ...GLOBALLY_DISALLOWED_TOOLS,
        // Cherry Assistant is a read-only guide; it should not ask users questions via tool
        ...(isAssistant ? ['AskUserQuestion'] : [])
      ],
      ...(thinkingOptions?.effort ? { effort: thinkingOptions.effort } : {}),
      ...(resolvedThinkingConfig ? { thinking: resolvedThinkingConfig } : {})
    }
    // Claude Agent SDK 0.2.81 的运行时代码读取 `thinkingConfig`，而公开类型声明使用 `thinking`。
    // 仅在显式配置 thinking 时同步两个字段，避免默认触发 adaptive thinking。
    if (resolvedThinkingConfig) {
      ;(options as Options & { thinkingConfig?: typeof resolvedThinkingConfig }).thinkingConfig = resolvedThinkingConfig
    }

    const additionalDirectories = Array.from(
      new Set(
        session.accessible_paths
          .filter(Boolean)
          .map((p) => path.normalize(path.resolve(p)))
          .filter((p) => p !== cwd)
      )
    )
    if (additionalDirectories.length > 0) {
      options.additionalDirectories = additionalDirectories
    }

    const { mountedRuntimeMcpServers, skippedRuntimeMcpServers } = await mountRuntimeMcpServers({
      options,
      session,
      apiConfig,
      cwd,
      capabilityDecision,
      toolSurface,
      autoAllowTools,
      autonomousEnabled,
      isAssistant,
      imageGenerateServer: new ImageGenerateServer(),
      getOrCreateBrowserServer: (sessionId) => this.getOrCreateBrowserServer(sessionId),
      resolveSourceChannel: (agentId, sessionId) => this.resolveSourceChannel(agentId, sessionId)
    })

    logger.info('[ToolRouter] mounted MCP servers', {
      agentId: session.agent_id,
      sessionId: session.id,
      turn: capabilityDecision.turn,
      requestPromptLength: prompt.length,
      sdkPromptLength: sdkPrompt.length,
      routingPromptLength: intentPrompt?.length ?? prompt.length,
      routingContextUsed: Boolean(intentPrompt && intentPrompt !== prompt),
      imageCount: images?.length ?? 0,
      activeDomains: capabilityDecision.activeDomains,
      primaryDomain: capabilityDecision.primaryDomain,
      subdomains: capabilityDecision.subdomains,
      companionDomains: capabilityDecision.companionDomains,
      selectedCapabilities: Array.from(capabilityDecision.selected).sort(),
      mountedRuntimeMcpServers,
      skippedRuntimeMcpServers,
      toolGuidanceOptions,
      activeClaudeSkillCount: activeClaudeSkillNames.length,
      preferredLocalSkillSdkDiscovered,
      customMcpServerCount: session.mcps?.length ?? 0,
      finalMcpServerNames: Object.keys(options.mcpServers || {}).sort(),
      builtinToolLayer: capabilityDecision.toolLayer,
      builtinTools: toolSurface.builtinTools,
      allowedToolCount: Array.isArray(options.allowedTools) ? options.allowedTools.length : 0,
      autoAllowToolCount: autoAllowTools.size,
      promptLengths: {
        clawSystemPrompt: clawSystemPrompt?.length ?? 0,
        factsRecall: factsRecall?.length ?? 0,
        assistantSystemPrompt: assistantSystemPrompt?.length ?? 0,
        sessionInstructions: session.instructions?.length ?? 0,
        routingPrompt: intentPrompt?.length ?? prompt.length
      },
      strictMcpConfig: Boolean(options.strictMcpConfig)
    })

    logPromptBudgetProbe({
      agentId: session.agent_id,
      sessionId: session.id,
      model: modelInfo.modelId,
      toolLayer: capabilityDecision.toolLayer,
      activeDomains: capabilityDecision.activeDomains,
      primaryDomain: capabilityDecision.primaryDomain,
      subdomains: capabilityDecision.subdomains,
      companionDomains: capabilityDecision.companionDomains,
      traceId,
      segmentId: activeSegment?.id,
      parentSegmentId: activeSegment?.parentSegmentId,
      prompt: composedPrompt,
      systemPrompt: promptEnvelope.systemPrompt,
      builtinTools: toolSurface.builtinTools,
      allowedTools: Array.isArray(options.allowedTools) ? options.allowedTools : [],
      mcpServerNames: Object.keys(options.mcpServers || {}).sort(),
      activeSkills: activeClaudeSkillNames,
      selectedCapabilities: Array.from(capabilityDecision.selected).sort(),
      promptLengths: {
        clawSystemPrompt: clawSystemPrompt?.length ?? 0,
        factsRecall: factsRecall?.length ?? 0,
        assistantSystemPrompt: assistantSystemPrompt?.length ?? 0,
        sessionInstructions: session.instructions?.length ?? 0,
        routingPrompt: intentPrompt?.length ?? prompt.length
      },
      systemPromptVersion: promptEnvelope.systemPromptVersion,
      systemPromptHash: promptEnvelope.systemPromptHash,
      continuationSummaryChars: promptEnvelope.promptView.continuationSummary?.length ?? 0,
      recentTurnsCount: promptEnvelope.promptView.recentTurns.length,
      referencedArtifactsCount: promptEnvelope.promptView.referencedArtifacts?.length ?? 0
    })

    const invokeContext = await buildClaudeCodeInvokeContext({
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
      workspaceSkillSurface,
      activeClaudeSkillNames,
      preferredLocalSkillFilename: capabilityDecision.preferredLocalSkillFilename,
      preferredLocalSkillSdkDiscovered,
      preferredLocalSkillMatchedBy: capabilityDecision.preferredLocalSkillMatchedBy,
      preferredLocalSkillMatchedEvidence: capabilityDecision.preferredLocalSkillMatchedEvidence,
      preferredLocalSkillTriggerMode: capabilityDecision.preferredLocalSkillTriggerMode,
      skillInvocationContext,
      toolSurface,
      selectedCapabilities: Array.from(capabilityDecision.selected).sort(),
      mountedRuntimeMcpServers,
      promptSnapshot: {
        systemPrompt: promptEnvelope.systemPrompt,
        currentUserPrompt: composedPrompt,
        activeSegmentId: activeSegment?.id,
        currentTurnId: currentTurn?.id,
        piSessionId: activeSegment?.sdkSessionId || lastAgentSessionId || session.id,
        assistantSystemPrompt,
        clawSystemPrompt,
        factsRecall
      }
    })

    logger.info('[AgentCore] built invoke context snapshot', {
      agentId: session.agent_id,
      sessionId: session.id,
      traceId: invokeContext.runtime.traceId,
      visibleSkillCount: invokeContext.skills.visibleSkills.length,
      activeSkillCount: invokeContext.skills.activeSkillNames.length,
      activeToolCount: invokeContext.tools.activeToolNames.length,
      mountedMcpServerCount: invokeContext.tools.mountedMcpServers.length,
      promptTemplateCount: invokeContext.prompt.resources.promptTemplates.length,
      hasSkillInvocationContext: Boolean(invokeContext.skills.skillInvocationContext),
      projection: invokeContext.projection
    })

    const piHarness = await createClaudeCodeHarness({
      invokeContext,
      runtimeEnvironment,
      options,
      canUseTool,
      pendingFileChanges
    })

    const shouldResumeExistingSession = !NO_RESUME_COMMANDS.some((cmd) => composedPrompt.includes(cmd))
    if (activeSegment && !activeSegment.sdkSessionId && shouldResumeExistingSession) {
      logger.info('[ForkContinuation] start-child-with-fresh-session', {
        topicId: session.id,
        traceId,
        segmentId: activeSegment.id,
        parentSegmentId: activeSegment.parentSegmentId ?? '',
        forkFromSdkSessionId: activeSegment.forkFromSdkSessionId ?? ''
      })
    }

    // Start async processing on the next tick so listeners can subscribe first
    setImmediate(() => {
      const architectureContext = {
        traceId,
        topicId: session.id,
        currentPrompt: prompt,
        activeSegment,
        currentTurn,
        promptEnvelope,
        pendingFileChanges
      }

      logger.info('[AgentCore] dispatching mandatory pi query path', {
        traceId,
        topicId: session.id,
        piSessionId: invokeContext.projection.piSessionId,
        importStrategy: piHarness.importStrategy,
        mode: piHarness.mode,
        hasRuntimeBridge: Boolean(piHarness.runtimeBridge)
      })

      const queryPromise = processPiHarnessQuery({
        stream: aiStream,
        sessionId: session.id,
        agentId: session.agent_id,
        architectureContext,
        harness: piHarness,
        prompt: composedPrompt,
        images,
        abortSignal: abortController.signal
      })

      queryPromise.catch((error) => {
        logger.error('Unhandled Claude Code stream error', {
          error: error instanceof Error ? { name: error.name, message: error.message } : String(error)
        })
        aiStream.emit('data', {
          type: 'error',
          error: error instanceof Error ? error : new Error(String(error))
        })
      })
    })

    return aiStream
  }

  private async resolveSourceChannel(agentId: string, sessionId: string): Promise<string | undefined> {
    try {
      const { channelService } = await import('../ChannelService')
      const channels = await channelService.listChannels({ agentId })
      return channels.find((ch) => ch.sessionId === sessionId)?.id
    } catch {
      return undefined
    }
  }

}

export default ClaudeCodeService
