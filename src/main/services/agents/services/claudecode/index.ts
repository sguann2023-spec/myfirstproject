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
import VideoGenerateServer from '@main/mcpServers/video-generate'
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
import { resolveExplicitSkillMention } from '../../skill-mounting/ExplicitSkillMention'
import { resolveWorkspaceSkillInvocation } from '../../skill-mounting/SkillInvokeService'
import { skillService } from '../../skills/SkillService'
import { agentService } from '../AgentService'
import { isProvisioned, provisionBuiltinAgent } from '../builtin/BuiltinAgentProvisioner'
import { logPromptBudgetProbe } from './prompt-budget'
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
const NO_RESUME_COMMANDS = ['/clear']
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

const getArgValue = (args: string[], flag: string): string | undefined => {
  const index = args.indexOf(flag)
  if (index < 0 || index + 1 >= args.length) return undefined
  return args[index + 1]
}

const countArg = (args: string[], flag: string): number => args.filter((arg) => arg === flag).length

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
  private readonly videoGenerateServer: VideoGenerateServer

  constructor() {
    // Resolve Claude Code CLI robustly (works in dev and in asar)
    this.claudeExecutablePath = toAsarUnpackedPath(
      path.join(path.dirname(require_.resolve('@anthropic-ai/claude-agent-sdk')), 'cli.js')
    )
    this.claudeProxyBootstrapPath = toAsarUnpackedPath(path.join(app.getAppPath(), 'out', 'proxy', 'index.js'))
    this.imageGenerateServer = new ImageGenerateServer()
    this.videoGenerateServer = new VideoGenerateServer()

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

      try {
        const payload = await this.videoGenerateServer.getVideoModelList()
        logger.info('Preloaded video model list', {
          count: payload.models.length
        })
      } catch (error) {
        logger.warn('Failed to preload video model list', {
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
    let activeClaudeSkillNames: string[] = []
    let skillInvocationContext:
      | {
          skillName: string
          skillMdPath: string
          skillMarkdown: string
          injectedPrompt: string
          triggerMode: 'explicit'
        }
      | undefined

    if (prompt.includes('@')) {
      try {
        const enabledSkills = await skillService.listLocal(cwd)
        const mention = resolveExplicitSkillMention(prompt, enabledSkills)
        if (mention) {
          const resolvedSkill = await resolveWorkspaceSkillInvocation({
            workspacePath: cwd,
            skillName: mention.skill.filename,
            skillMdPath: mention.skill.path
              ? path.join(mention.skill.path, 'SKILL.md')
              : mention.skill.skillMdPath,
            triggerMode: 'explicit'
          })
          workspaceSkills = [
            {
              name: mention.skill.name,
              description: mention.skill.description,
              filename: mention.skill.filename,
              skillMdPath: resolvedSkill.skillMdPath,
              source: mention.skill.source
            }
          ]
          activeClaudeSkillNames = [mention.skill.filename]
          skillInvocationContext = {
            skillName: resolvedSkill.skillName,
            skillMdPath: resolvedSkill.skillMdPath,
            skillMarkdown: resolvedSkill.skillMarkdown,
            injectedPrompt: prompt,
            triggerMode: 'explicit'
          }
          logger.info('[PiSkill] resolved explicit skill mention', {
            agentId: session.agent_id,
            sessionId: session.id,
            matchedLabel: mention.matchedLabel,
            skillName: resolvedSkill.skillName,
            skillMdPath: resolvedSkill.skillMdPath,
            skillMdChars: resolvedSkill.skillMarkdown.length
          })
        }
      } catch (error) {
        logger.warn('[PiSkill] failed to resolve explicit skill mention', {
          agentId: session.agent_id,
          sessionId: session.id,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    const sdkPrompt = prompt
    const toolGuidanceOptions = {}

    logger.info('[Codemode] fixed tool surface', {
      agentId: session.agent_id,
      sessionId: session.id,
      promptLength: prompt.length,
      imageCount: images?.length ?? 0,
      builtinRole: builtinRole ?? '',
      isAssistant,
      autonomousEnabled,
      hasCustomMcpServers: Boolean(session.mcps?.length)
    })

    let runtimeEnvironment: ClaudeRuntimeEnvironment
    try {
      runtimeEnvironment = await buildClaudeRuntimeEnvironment({
        session,
        modelOverride,
        cwd,
        enableToolSearch: false
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
      sessionAllowedTools: session.allowed_tools ?? [],
      isAssistant,
      hasExplicitSkillInvocation: Boolean(skillInvocationContext)
    })
    if (skillInvocationContext) {
      logger.info('[PiSkill] activated temporary native tools', {
        sessionId: session.id,
        skillName: skillInvocationContext.skillName,
        builtinTools: toolSurface.builtinTools
      })
    }
    const sessionAllowedTools = new Set<string>(session.allowed_tools ?? [])
    const autoAllowTools = toolSurface.autoAllowedTools
    autoAllowTools.add('codemode')
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
      enabled: false,
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

    const { mountedRuntimeMcpServers } = await mountRuntimeMcpServers({
      options,
      session,
      apiConfig,
      cwd,
      autoAllowTools,
      autonomousEnabled,
      isAssistant,
      imageGenerateServer: this.imageGenerateServer,
      videoGenerateServer: this.videoGenerateServer,
      getOrCreateBrowserServer: (sessionId) => this.getOrCreateBrowserServer(sessionId),
      resolveSourceChannel: (agentId, sessionId) => this.resolveSourceChannel(agentId, sessionId)
    })

    logger.info('[Codemode] mounted MCP servers', {
      agentId: session.agent_id,
      sessionId: session.id,
      requestPromptLength: prompt.length,
      sdkPromptLength: sdkPrompt.length,
      imageCount: images?.length ?? 0,
      mountedRuntimeMcpServers,
      toolGuidanceOptions,
      activeClaudeSkillCount: activeClaudeSkillNames.length,
      customMcpServerCount: session.mcps?.length ?? 0,
      finalMcpServerNames: Object.keys(options.mcpServers || {}).sort(),
      builtinToolLayer: toolSurface.layer,
      builtinTools: toolSurface.builtinTools,
      autoAllowToolCount: autoAllowTools.size,
      promptLengths: {
        clawSystemPrompt: clawSystemPrompt?.length ?? 0,
        assistantSystemPrompt: assistantSystemPrompt?.length ?? 0,
        sessionInstructions: session.instructions?.length ?? 0
      },
      strictMcpConfig: Boolean(options.strictMcpConfig)
    })

    logPromptBudgetProbe({
      agentId: session.agent_id,
      sessionId: session.id,
      model: modelInfo.modelId,
      traceId,
      segmentId: activeSegment?.id,
      parentSegmentId: activeSegment?.parentSegmentId,
      prompt: composedPrompt,
      systemPrompt: promptEnvelope.systemPrompt,
      builtinTools: toolSurface.builtinTools,
      autoAllowedTools: Array.from(autoAllowTools).sort(),
      mcpServerNames: Object.keys(options.mcpServers || {}).sort(),
      activeSkills: activeClaudeSkillNames,
      promptLengths: {
        clawSystemPrompt: clawSystemPrompt?.length ?? 0,
        assistantSystemPrompt: assistantSystemPrompt?.length ?? 0,
        sessionInstructions: session.instructions?.length ?? 0
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
      activeClaudeSkillNames,
      preferredLocalSkillSdkDiscovered: false,
      skillInvocationContext,
      toolSurface,
      mountedRuntimeMcpServers,
      promptSnapshot: {
        systemPrompt: promptEnvelope.systemPrompt,
        currentUserPrompt: composedPrompt,
        activeSegmentId: activeSegment?.id,
        currentTurnId: currentTurn?.id,
        piSessionId: activeSegment?.sdkSessionId || lastAgentSessionId || session.id,
        assistantSystemPrompt,
        clawSystemPrompt
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
        const rawMessage = error instanceof Error ? error.message : String(error)
        const normalizedMessage = rawMessage.toLowerCase()
        let userMessage = rawMessage
        let errorCode = 'AGENT_STREAM_ERROR'

        if (normalizedMessage.includes('insufficient remaining points') || normalizedMessage.includes('剩余点数不足')) {
          userMessage = '当前账号剩余点数不足，请充值后重试。'
          errorCode = 'INSUFFICIENT_POINTS'
        } else if (
          normalizedMessage.includes('input tokens exceed') ||
          normalizedMessage.includes('context limit') ||
          normalizedMessage.includes('输入 token 数超出')
        ) {
          userMessage = '当前会话内容过长，已超过模型上下文限制。请新建会话或减少历史内容后重试。'
          errorCode = 'CONTEXT_LIMIT_EXCEEDED'
        }

        logger.error('Unhandled Claude Code stream error', {
          error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error),
          errorCode,
          traceId,
          topicId: session.id,
          model: piHarness.runtimeBridge?.model?.id,
          provider: piHarness.runtimeBridge?.model?.provider
        })
        aiStream.emit('data', {
          type: 'error',
          error: Object.assign(new Error(userMessage), {
            name: errorCode,
            code: errorCode,
            originalMessage: rawMessage
          })
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
