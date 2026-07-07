// src/main/services/agents/services/claudecode/index.ts
import { fork } from 'node:child_process'
import { EventEmitter } from 'node:events'
import * as fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type {
  CanUseTool,
  HookCallback,
  McpHttpServerConfig,
  Options,
  SDKMessage,
  SdkPluginConfig,
  SDKUserMessage,
  SpawnedProcess
} from '@anthropic-ai/claude-agent-sdk'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages/messages'
import { loggerService } from '@logger'
import { config as apiConfigService } from '@main/apiServer/config'
import { validateModelId } from '@main/apiServer/utils'
import { isWin } from '@main/constant'
import AssistantServer from '@main/mcpServers/assistant'
import BrowserServer from '@main/mcpServers/browser/server'
import ClawServer from '@main/mcpServers/claw'
import DigitalHumanServer from '@main/mcpServers/digital-human'
import DraftDownloadServer from '@main/mcpServers/draft-download'
import FileSystemServer from '@main/mcpServers/filesystem'
import ImageGenerateServer from '@main/mcpServers/image-generate'
import KouboTemplateServer from '@main/mcpServers/koubo-template'
import SocialCopywritingServer from '@main/mcpServers/social-copywriting'
import SkillsServer from '@main/mcpServers/skills'
import SpeechGenerateServer from '@main/mcpServers/speech-generate'
import ZhipuSearchServer from '@main/mcpServers/zhipu-search'
import SystemServer from '@main/mcpServers/system'
import WorkspaceMemoryServer from '@main/mcpServers/workspaceMemory'
import { configManager } from '@main/services/ConfigManager'
import { ossUploadService } from '@main/services/OssUploadService'
import {
  getNodeProxyConfigFromEnvironment,
  getProxyEnvironment,
  getProxyProtocol
} from '@main/services/proxy/nodeProxy'
import { toAsarUnpackedPath } from '@main/utils'
import { autoDiscoverGitBash, findBundledPython, getBinaryPath, prependPathEntry } from '@main/utils/process'
import getLoginShellEnvironment from '@main/utils/shell-env'
import {
  CHANNEL_SECURITY_PROMPT,
  GLOBALLY_DISALLOWED_TOOLS
} from '@shared/agents/claudecode/constants'
import { languageEnglishNameMap } from '@shared/config/languages'
import { withoutTrailingApiVersion } from '@shared/utils'
import { app } from 'electron'

import type { GetAgentSessionResponse } from '../..'
import type {
  AgentServiceInterface,
  AgentStream,
  AgentStreamEvent,
  AgentThinkingOptions
} from '../../interfaces/AgentStreamInterface'
import { skillService } from '../../skills/SkillService'
import { agentRuntimeAuthService } from '../AgentRuntimeAuthService'
import { agentService } from '../AgentService'
import { isProvisioned, provisionBuiltinAgent } from '../builtin/BuiltinAgentProvisioner'
import { channelService } from '../ChannelService'
import { PromptBuilder } from '../cherryclaw/prompt'
import { CapabilityRouter, buildToolGuidanceOptions, type RuntimeCapability } from './capability-router'
import { sessionService } from '../SessionService'
import { buildNamespacedToolCallId } from './claude-stream-state'
import { logPromptBudgetProbe } from './prompt-budget'
import { addAutoAllowedTool, buildToolSurface } from './tool-surface'
import { promptForToolApproval } from './tool-permissions'
import { ClaudeStreamState, transformSDKMessageToStreamParts } from './transform'

const require_ = require
const logger = loggerService.withContext('ClaudeCodeService')
const promptBuilder = new PromptBuilder()
const IMAGE_MAX_DIMENSION = 2000
const IMAGE_MAX_BYTES = 5 * 1024 * 1024 // 5MB API limit
const shouldAutoApproveTools = process.env.CHERRY_AUTO_ALLOW_TOOLS === '1'
const shouldMountAllRuntimeMcpTools = process.env.CHERRY_AGENT_MOUNT_ALL_MCP_TOOLS === '1'
const NO_RESUME_COMMANDS = ['/clear']

const isVectcutGatewayUrl = (value: string): boolean => {
  const raw = String(value || '').trim()
  if (!raw) return false
  try {
    return new URL(raw).hostname === 'open.vectcut.com'
  } catch {
    return raw.includes('open.vectcut.com')
  }
}

const getLanguageInstruction = () => {
  const lang = configManager.getLanguage()
  const resolvedLanguageName = languageEnglishNameMap[lang]

  logger.info('Resolved Claude output language', {
    lang,
    resolvedLanguageName
  })
  return `
  IMPORTANT: You MUST use ${resolvedLanguageName} language for ALL your outputs, including:
  (1) text responses, (2) tool call parameters like "description" fields, and (3) any user-facing content.
  ${lang === 'en-US' ? '' : 'Never use English unless the content is code, file paths, or technical identifiers.'}
  `
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

type WorkspaceSkillSurface = {
  exists: boolean
  skillDirCount: number
  skillMdCount: number
  skillMdBytes: number
  largestSkillMdBytes: number
  skillNamesPreview: string[]
  error?: string
}

const scanWorkspaceSkillSurface = async (workspacePath: string): Promise<WorkspaceSkillSurface> => {
  const skillsDir = path.join(workspacePath, '.claude', 'skills')
  try {
    const entries = await fs.promises.readdir(skillsDir, { withFileTypes: true })
    const skillDirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
    let skillMdCount = 0
    let skillMdBytes = 0
    let largestSkillMdBytes = 0

    for (const skillName of skillDirs) {
      const skillMdPath = path.join(skillsDir, skillName, 'SKILL.md')
      try {
        const stats = await fs.promises.stat(skillMdPath)
        skillMdCount++
        skillMdBytes += stats.size
        largestSkillMdBytes = Math.max(largestSkillMdBytes, stats.size)
      } catch {
        // A directory without SKILL.md is not loadable as a Claude skill.
      }
    }

    return {
      exists: true,
      skillDirCount: skillDirs.length,
      skillMdCount,
      skillMdBytes,
      largestSkillMdBytes,
      skillNamesPreview: skillDirs.slice(0, 30)
    }
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
    if (code === 'ENOENT') {
      return {
        exists: false,
        skillDirCount: 0,
        skillMdCount: 0,
        skillMdBytes: 0,
        largestSkillMdBytes: 0,
        skillNamesPreview: []
      }
    }

    return {
      exists: false,
      skillDirCount: 0,
      skillMdCount: 0,
      skillMdBytes: 0,
      largestSkillMdBytes: 0,
      skillNamesPreview: [],
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

type UserInputMessage = SDKUserMessage

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

  private getOrCreateBrowserServer(sessionId: string): BrowserServer {
    const existing = this.browserServers.get(sessionId)
    if (existing) {
      logger.debug('Reusing browser MCP server for session', { sessionId })
      return existing
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

    const configuredWorkspacePath = String(
      (session.configuration as Record<string, unknown> | undefined)?.selected_workspace_path || ''
    ).trim()
    const cwdCandidate = path.isAbsolute(configuredWorkspacePath) ? configuredWorkspacePath : session.accessible_paths[0] || ''
    const cwd = cwdCandidate ? path.normalize(path.resolve(cwdCandidate)) : ''
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
    const capabilityDecision = this.capabilityRouter.select({
      prompt,
      sessionId: session.id,
      imageCount: images?.length ?? 0,
      isAssistant,
      autonomousEnabled,
      builtinRole,
      hasCustomMcpServers: Boolean(session.mcps?.length)
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
    logger.info('[ToolRouter] active Claude skills snapshot', {
      agentId: session.agent_id,
      sessionId: session.id,
      skillWorkspace,
      reconciled: shouldReconcileSkills,
      activeSkillCount: activeClaudeSkillNames.length,
      activeSkills: activeClaudeSkillNames.slice(0, 50),
      omittedSkillCount: Math.max(0, activeClaudeSkillNames.length - 50),
      workspaceSkillSurface
    })

    logger.info('[ToolRouter] capability decision', {
      agentId: session.agent_id,
      sessionId: session.id,
      turn: capabilityDecision.turn,
      selectedCapabilities: Array.from(capabilityDecision.selected).sort(),
      reasons: capabilityDecision.reasons,
      stickyApplied: capabilityDecision.stickyApplied,
      toolLayer: capabilityDecision.toolLayer,
      toolLayerReasons: capabilityDecision.toolLayerReasons,
      promptLength: prompt.length,
      imageCount: images?.length ?? 0,
      builtinRole: builtinRole ?? '',
      isAssistant,
      autonomousEnabled,
      hasCustomMcpServers: Boolean(session.mcps?.length),
      forceMountAll: shouldMountAllRuntimeMcpTools
    })

    const runtimeModel = String(modelOverride || session.model || '').trim()

    // Validate model info
    const modelInfo = await validateModelId(runtimeModel)
    if (!modelInfo.valid) {
      aiStream.emit('data', {
        type: 'error',
        error: new Error(`Invalid model ID '${runtimeModel}': ${JSON.stringify(modelInfo.error)}`)
      })
      return aiStream
    }
    const provider = modelInfo.provider
    if (!provider) {
      aiStream.emit('data', {
        type: 'error',
        error: new Error('Provider not found for model')
      })
      return aiStream
    }

    const isAzureOpenAI = provider.type === 'azure-openai'
    const isAnthropicType = provider.type === 'anthropic'
    const sessionEnvVars = (session.configuration as Record<string, any> | undefined)?.env_vars ?? {}
    const gatewayAnthropicBaseUrl = String(
      sessionEnvVars.VECTCUT_ANTHROPIC_API_BASE_URL || sessionEnvVars.VECTCUT_API_BASE_URL || ''
    ).trim()
    const hasAnthropicHost = provider.anthropicApiHost?.trim() || provider.apiHost?.trim() || gatewayAnthropicBaseUrl

    if (!isAnthropicType && !isAzureOpenAI && !hasAnthropicHost) {
      logger.error('Anthropic provider configuration is missing', {
        modelInfo
      })

      aiStream.emit('data', {
        type: 'error',
        error: new Error(`Invalid provider type '${provider.type}'. Expected 'anthropic' provider type.`)
      })
      return aiStream
    }

    // Providers like Ollama and LM Studio don't require real API keys,
    // but the Claude Agent SDK needs a non-empty placeholder value
    if (!provider.apiKey) {
      provider.apiKey = provider.id
    }

    const apiConfig = await apiConfigService.get()
    const loginShellEnv = await getLoginShellEnvironment()

    // Auto-discover Git Bash path on Windows (already logs internally)
    const customGitBashPath = isWin ? autoDiscoverGitBash() : null
    const bundledPythonPath = isWin ? findBundledPython() : null
    const bunPath = await getBinaryPath('bun')

    // Claude Agent SDK builds the final endpoint as `${ANTHROPIC_BASE_URL}/v1/messages`.
    // To avoid malformed URLs like `/v1/v1/messages`, we normalize the provider host
    // by stripping any trailing API version (e.g. `/v1`).
    // For Azure OpenAI providers, the Anthropic endpoint lives under /anthropic.
    const resolveAnthropicBaseUrl = (): string => {
      if (isAzureOpenAI) {
        const host = withoutTrailingApiVersion(provider.apiHost).replace(/\/openai$/, '')
        return `${host}/anthropic`
      }
      return withoutTrailingApiVersion(provider.anthropicApiHost?.trim() || provider.apiHost || gatewayAnthropicBaseUrl)
    }
    const anthropicBaseUrl = resolveAnthropicBaseUrl()
    const sessionVectcutApiKey = String(sessionEnvVars.VECTCUT_API_KEY || '').trim()
    const providerApiKey = String(provider.apiKey || '').trim()
    const shouldUseRuntimeGatewayToken = isVectcutGatewayUrl(anthropicBaseUrl)
    let runtimeAuthToken = providerApiKey
    let authTokenSource: 'provider_api_key' | 'runtime_access_token' | 'session_fallback' = 'provider_api_key'

    if (shouldUseRuntimeGatewayToken) {
      try {
        runtimeAuthToken = await agentRuntimeAuthService.ensureValidAccessToken()
        authTokenSource = 'runtime_access_token'
      } catch (error) {
        if (sessionVectcutApiKey) {
          runtimeAuthToken = sessionVectcutApiKey
          authTokenSource = 'session_fallback'
          logger.warn('Falling back to session-scoped VECTCUT_API_KEY after runtime token refresh failed', {
            sessionId: session.id,
            error: error instanceof Error ? error.message : String(error)
          })
        } else {
          throw error
        }
      }
    }

    logger.info('Resolved Claude runtime auth token source', {
      sessionId: session.id,
      anthropicBaseUrl,
      usesVectcutGatewayToken: shouldUseRuntimeGatewayToken,
      authTokenSource,
      hasRuntimeAuthToken: Boolean(runtimeAuthToken)
    })

    const env: Record<string, string> = {
      ...loginShellEnv,
      ...getProxyEnvironment(process.env),
      // prevent claude agent sdk using bedrock api
      CLAUDE_CODE_USE_BEDROCK: '0',
      // TODO: fix the proxy api server
      // ANTHROPIC_API_KEY: apiConfig.apiKey,
      // ANTHROPIC_AUTH_TOKEN: apiConfig.apiKey,
      // ANTHROPIC_BASE_URL: `http://${apiConfig.host}:${apiConfig.port}/${modelInfo.provider.id}`,
      ANTHROPIC_API_KEY: runtimeAuthToken,
      ANTHROPIC_AUTH_TOKEN: runtimeAuthToken,
      ANTHROPIC_BASE_URL: anthropicBaseUrl,
      ANTHROPIC_MODEL: modelInfo.modelId,
      ANTHROPIC_DEFAULT_OPUS_MODEL: modelInfo.modelId,
      ANTHROPIC_DEFAULT_SONNET_MODEL: modelInfo.modelId,
      // TODO: support set small model in UI
      ANTHROPIC_DEFAULT_HAIKU_MODEL: modelInfo.modelId,
      ELECTRON_RUN_AS_NODE: '1',
      ELECTRON_NO_ATTACH_CONSOLE: '1',
      // Set CLAUDE_CONFIG_DIR to app's userData directory to avoid path encoding issues
      // on Windows when the username contains non-ASCII characters (e.g., Chinese characters)
      // This prevents the SDK from using the user's home directory which may have encoding problems.
      // Per-agent skills live in `<cwd>/.claude/skills/` and are picked up by the SDK's
      // project-level skill loading layer — no need to point CLAUDE_CONFIG_DIR at the workspace.
      CLAUDE_CONFIG_DIR: path.join(app.getPath('userData'), '.claude'),
      ENABLE_TOOL_SEARCH: selectedRuntimeCapabilities.has('skills') ? 'auto' : '0',
      CHERRY_STUDIO_BUN_PATH: bunPath,
      WORKSPACE_ROOT: cwd,
      ...(customGitBashPath ? { CLAUDE_CODE_GIT_BASH_PATH: customGitBashPath } : {})
    }

    if (bundledPythonPath) {
      prependPathEntry(env, path.dirname(bundledPythonPath))
      env.CHERRY_STUDIO_PYTHON_PATH = bundledPythonPath
    }

    // Merge user-defined environment variables from session configuration
    const userEnvVars = session.configuration?.env_vars
    if (userEnvVars && typeof userEnvVars === 'object') {
      const BLOCKED_ENV_KEYS = new Set([
        'ANTHROPIC_API_KEY',
        'ANTHROPIC_AUTH_TOKEN',
        'ANTHROPIC_BASE_URL',
        'ANTHROPIC_MODEL',
        'ANTHROPIC_DEFAULT_OPUS_MODEL',
        'ANTHROPIC_DEFAULT_SONNET_MODEL',
        'ANTHROPIC_DEFAULT_HAIKU_MODEL',
        'ELECTRON_RUN_AS_NODE',
        'ELECTRON_NO_ATTACH_CONSOLE',
        'CLAUDE_CONFIG_DIR',
        'CLAUDE_CODE_USE_BEDROCK',
        'CLAUDE_CODE_GIT_BASH_PATH',
        'CHERRY_STUDIO_PYTHON_PATH',
        'CHERRY_STUDIO_NODE_PROXY_RULES',
        'CHERRY_STUDIO_NODE_PROXY_BYPASS_RULES',
        'NODE_OPTIONS',
        '__PROTO__',
        'CONSTRUCTOR',
        'PROTOTYPE'
      ])
      for (const [key, value] of Object.entries(userEnvVars)) {
        const upperKey = key.toUpperCase()
        if (BLOCKED_ENV_KEYS.has(upperKey)) {
          logger.warn('Blocked user env var override for system-critical variable', { key })
        } else if (typeof value === 'string') {
          env[key] = value
        }
      }
    }

    const errorChunks: string[] = []

    const toolSurface = buildToolSurface({
      layer: capabilityDecision.toolLayer,
      sessionAllowedTools: session.allowed_tools ?? [],
      isAssistant
    })
    const sessionAllowedTools = new Set<string>(toolSurface.allowedToolsOption)
    const autoAllowTools = toolSurface.autoAllowedTools
    const readFilesInSession = new Set<string>()
    const normalizeToolName = (name: string) => (name.startsWith('builtin_') ? name.slice('builtin_'.length) : name)
    const requiresInteractiveApproval = (name: string) => normalizeToolName(name) === 'AskUserQuestion'
    const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
    const attachInternalToolContext = (
      toolName: string,
      toolInput: Record<string, unknown>,
      toolCallId: string
    ): Record<string, unknown> => {
      if (normalizeToolName(toolName) === 'mcp__copylab__derive_copy_prompt') {
        return {
          ...toolInput,
          __toolCallId: toolCallId
        }
      }
      return toolInput
    }
    const interactiveApprovalCache = new Map<
      string,
      { behavior: 'allow'; updatedInput: Record<string, unknown> } | { behavior: 'deny'; message: string }
    >()
    const resolveToolFilePath = (toolInput: unknown, defaultCwd: string) => {
      const input = isRecord(toolInput) ? toolInput : null
      if (!input) return null
      const candidateKeys = ['file_path', 'path', 'filePath', 'target_file']
      for (const key of candidateKeys) {
        const rawPath = input[key]
        if (typeof rawPath !== 'string') continue
        const trimmed = rawPath.trim()
        if (!trimmed) continue
        return path.normalize(path.isAbsolute(trimmed) ? trimmed : path.resolve(defaultCwd, trimmed))
      }
      return null
    }
    let plugins: SdkPluginConfig[] | undefined
    if (capabilityDecision.toolLayer !== 'chat') {
      try {
        const pluginsDir = path.join(cwd, '.claude', 'plugins')
        const entries = await fs.promises.readdir(pluginsDir, { withFileTypes: true }).catch(() => [])
        const pluginPaths: string[] = []
        for (const entry of entries) {
          if (!entry.isDirectory()) continue
          const manifestPath = path.join(pluginsDir, entry.name, '.claude-plugin', 'plugin.json')
          try {
            await fs.promises.access(manifestPath, fs.constants.R_OK)
            pluginPaths.push(path.join(pluginsDir, entry.name))
          } catch {
            // No manifest, skip
          }
        }
        if (pluginPaths.length > 0) {
          plugins = pluginPaths.map((pluginPath) => ({ type: 'local', path: pluginPath }))
        }
      } catch (error) {
        logger.warn('Failed to load plugin packages for Claude Code', {
          agentId: session.agent_id,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    } else {
      logger.info('[ToolRouter] skipped plugin discovery for chat layer', {
        agentId: session.agent_id,
        sessionId: session.id
      })
    }

    const canUseTool: CanUseTool = async (toolName, input, options) => {
      logger.info('Handling tool permission check', {
        toolName,
        suggestionCount: options.suggestions?.length ?? 0
      })
      const normalizedToolName = normalizeToolName(toolName)

      if (options.signal.aborted) {
        logger.debug('Permission request signal already aborted; denying tool', { toolName })
        return {
          behavior: 'deny',
          message: 'Tool request was cancelled before prompting the user'
        }
      }

      if (requiresInteractiveApproval(toolName)) {
        const namespacedToolCallId = buildNamespacedToolCallId(session.id, options.toolUseID)
        const cachedApproval = interactiveApprovalCache.get(namespacedToolCallId)
        if (cachedApproval) {
          interactiveApprovalCache.delete(namespacedToolCallId)
          logger.info('Reusing cached interactive approval for tool', {
            toolName,
            normalizedToolName,
            namespacedToolCallId,
            behavior: cachedApproval.behavior
          })
          return cachedApproval.behavior === 'allow'
            ? { behavior: 'allow', updatedInput: cachedApproval.updatedInput }
            : { behavior: 'deny', message: cachedApproval.message }
        }

        logger.debug('Forcing interactive approval for tool', {
          toolName,
          normalizedToolName,
          namespacedToolCallId
        })
        return promptForToolApproval(toolName, input, {
          ...options,
          toolCallId: namespacedToolCallId
        })
      }

      if (shouldAutoApproveTools) {
        logger.debug('Auto-approving tool due to CHERRY_AUTO_ALLOW_TOOLS flag', { toolName })
        return { behavior: 'allow', updatedInput: input }
      }

      if (autoAllowTools.has(toolName) || autoAllowTools.has(normalizedToolName)) {
        logger.debug('Auto-allowing tool from allowed list', {
          toolName,
          normalizedToolName
        })
        if (normalizedToolName === 'Bash') {
          logger.info('CURL_PROBE Bash canUseTool decision', {
            toolName,
            normalizedToolName,
            decision: 'allow:autoAllowTools'
          })
        }
        return { behavior: 'allow', updatedInput: input }
      }

      if (normalizedToolName === 'Bash') {
        logger.info('CURL_PROBE Bash canUseTool decision', {
          toolName,
          normalizedToolName,
          decision: 'promptForApproval'
        })
      }

      return promptForToolApproval(toolName, input, {
        ...options,
        toolCallId: buildNamespacedToolCallId(session.id, options.toolUseID)
      })
    }

    const preToolUseHook: HookCallback = async (input, toolUseID, options) => {
      // Type guard to ensure we're handling PreToolUse event
      if (input.hook_event_name !== 'PreToolUse') {
        return {}
      }

      const hookInput = input
      const toolName = hookInput.tool_name
      const normalizedToolName = normalizeToolName(toolName)

      logger.debug('PreToolUse hook triggered', {
        session_id: hookInput.session_id,
        tool_name: hookInput.tool_name,
        tool_use_id: toolUseID,
        tool_input: hookInput.tool_input,
        cwd: hookInput.cwd,
        permission_mode: hookInput.permission_mode,
        autoAllowTools: autoAllowTools
      })

      if (toolName === 'Bash' || toolName === 'builtin_Bash') {
        const bypassAll = input.permission_mode === 'bypassPermissions'
        const autoAllowed = autoAllowTools.has(toolName) || autoAllowTools.has(normalizedToolName)
        logger.info('CURL_PROBE Bash PreToolUse snapshot', {
          sessionId: session.id,
          toolName,
          normalizedToolName,
          permissionMode: input.permission_mode,
          bypassAll,
          autoAllowed,
          sessionAllowsBash: sessionAllowedTools.has('Bash') || sessionAllowedTools.has('builtin_Bash'),
          sessionAllowedTools: Array.from(sessionAllowedTools).sort()
        })
      }

      if (options?.signal?.aborted) {
        logger.debug('PreToolUse hook signal already aborted; skipping tool use', {
          tool_name: hookInput.tool_name
        })
        return {}
      }

      if (normalizedToolName === 'Write') {
        const targetFilePath = resolveToolFilePath(hookInput.tool_input, hookInput.cwd || cwd)
        if (targetFilePath && fs.existsSync(targetFilePath) && !readFilesInSession.has(targetFilePath)) {
          logger.warn('Blocked Write without prior Read in current invoke session', {
            sessionId: session.id,
            toolUseID: toolUseID ?? '',
            targetFilePath
          })
          return {
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: 'deny',
              permissionDecisionReason: 'Write to existing files requires Read first in the same session.',
              additionalContext: `Use Read with file_path="${targetFilePath}" first, then retry Write.`
            }
          }
        }
      }

      // handle auto approved tools since it never triggers canUseTool
      if (toolUseID) {
        const bypassAll = input.permission_mode === 'bypassPermissions'
        const autoAllowed = autoAllowTools.has(toolName) || autoAllowTools.has(normalizedToolName)
        const needsInteractiveApproval = requiresInteractiveApproval(toolName)
        const namespacedToolCallId = buildNamespacedToolCallId(session.id, toolUseID)
        if (needsInteractiveApproval && (bypassAll || autoAllowed)) {
          logger.info('Forcing interactive PreToolUse approval for tool', {
            toolName,
            normalizedToolName,
            namespacedToolCallId,
            permission_mode: input.permission_mode,
            bypassAll,
            autoAllowed
          })
          const toolInput = attachInternalToolContext(
            toolName,
            isRecord(input.tool_input) ? input.tool_input : {},
            namespacedToolCallId
          )
          const approval = await promptForToolApproval(toolName, toolInput, {
            ...options,
            toolCallId: namespacedToolCallId
          })

          if (approval.behavior === 'allow') {
            interactiveApprovalCache.set(namespacedToolCallId, {
              behavior: 'allow',
              updatedInput: isRecord(approval.updatedInput) ? approval.updatedInput : toolInput
            })
            return {
              hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'allow',
                updatedInput: isRecord(approval.updatedInput) ? approval.updatedInput : toolInput
              }
            }
          }

          interactiveApprovalCache.set(namespacedToolCallId, {
            behavior: 'deny',
            message: approval.message ?? 'User denied permission for this tool'
          })
          return {
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: 'deny',
              permissionDecisionReason: approval.message ?? 'User denied permission for this tool'
            }
          }
        }

        if (bypassAll || autoAllowed) {
          logger.debug('handling auto approved tools', {
            toolName,
            normalizedToolName,
            namespacedToolCallId,
            permission_mode: input.permission_mode,
            autoAllowTools
          })
          const toolInput = attachInternalToolContext(
            toolName,
            isRecord(input.tool_input) ? input.tool_input : {},
            namespacedToolCallId
          )

          await promptForToolApproval(toolName, toolInput, {
            ...options,
            toolCallId: namespacedToolCallId,
            autoApprove: true
          })
          return {
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: 'allow',
              updatedInput: toolInput
            }
          }
        }
      }

      // Return to proceed without modification
      return {}
    }

    const postToolUseHook: HookCallback = async (input) => {
      if (input.hook_event_name !== 'PostToolUse') {
        return {}
      }

      const normalizedToolName = normalizeToolName(input.tool_name)
      if (normalizedToolName !== 'Read') {
        return {}
      }

      const filePath = resolveToolFilePath(input.tool_input, input.cwd || cwd)
      if (!filePath) {
        return {}
      }

      readFilesInSession.add(filePath)
      logger.debug('Recorded Read tool path for Write guard', {
        sessionId: session.id,
        filePath,
        trackedReadFileCount: readFilesInSession.size
      })
      return {}
    }

    // Inject channel security policy into system prompt when session is from an external channel
    const linkedChannel = await channelService.findBySessionId(session.id)
    const isChannelSession = !!linkedChannel
    const channelSecurityBlock = isChannelSession ? CHANNEL_SECURITY_PROMPT : ''

    // Provision built-in agent workspace (copy skills/plugins to working directory)
    if (builtinRole && cwd && !isProvisioned(cwd)) {
      const agentConfig = await provisionBuiltinAgent(cwd, builtinRole)
      if (agentConfig?.instructions && !session.instructions) {
        session = { ...session, instructions: agentConfig.instructions }
      }
      logger.info('Provisioned builtin agent workspace', { builtinRole, cwd })
    }

    // Build lightweight environment snapshot for Cherry Assistant
    let assistantSystemPrompt: string | undefined
    if (isAssistant) {
      try {
        const context = await buildAssistantContext()
        assistantSystemPrompt = session.instructions ? `${session.instructions}\n\n${context}` : context
      } catch (err) {
        logger.warn('Failed to build assistant context', { error: err })
        assistantSystemPrompt = session.instructions
      }
    }

    const clawSystemPrompt = !isAssistant
      ? await promptBuilder.buildSystemPrompt(cwd, agentConfig, toolGuidanceOptions)
      : undefined
    const factsRecall =
      !isAssistant && toolGuidanceOptions.hasMemory && cwd ? await promptBuilder.buildFactsSection(cwd) : undefined

    const finalSystemPrompt: Options['systemPrompt'] = assistantSystemPrompt
      ? assistantSystemPrompt
      : [clawSystemPrompt, factsRecall, session.instructions, channelSecurityBlock, getLanguageInstruction()]
          .filter(Boolean)
          .join('\n\n')

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
          errorChunks.push(text)
        })
        return child as unknown as SpawnedProcess
      },
      systemPrompt: finalSystemPrompt,
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

    if (session.mcps && session.mcps.length > 0) {
      // mcp configs
      const mcpList: Record<string, McpHttpServerConfig> = {}
      for (const mcpId of session.mcps) {
        mcpList[mcpId] = {
          type: 'http',
          url: `http://${apiConfig.host}:${apiConfig.port}/v1/mcps/${mcpId}/mcp`,
          headers: {
            Authorization: `Bearer ${apiConfig.apiKey}`
          }
        }
      }
      options.mcpServers = mcpList
      options.strictMcpConfig = true
    }

    if (!options.mcpServers) options.mcpServers = {}
    type RuntimeMcpServerConfig = NonNullable<Options['mcpServers']>[string]
    const mountedRuntimeMcpServers: string[] = []
    const skippedRuntimeMcpServers: string[] = []
    const shouldMountCapability = (capability: RuntimeCapability) => capabilityDecision.selected.has(capability)
    const mountMcpServer = (key: string, config: RuntimeMcpServerConfig) => {
      options.mcpServers![key] = config
      mountedRuntimeMcpServers.push(key)
    }
    const markSkipped = (key: string) => {
      skippedRuntimeMcpServers.push(key)
    }
    const allowMcpPattern = (pattern: string) => {
      addAutoAllowedTool(toolSurface, pattern)
      options.allowedTools = toolSurface.allowedToolsOption
    }

    if (capabilityDecision.toolLayer !== 'chat') {
      const filesystemServer = new FileSystemServer(cwd)
      mountMcpServer('filesystem', { type: 'sdk', name: 'filesystem', instance: filesystemServer.mcpServer })
      allowMcpPattern('mcp__filesystem__*')
    } else {
      markSkipped('filesystem')
    }

    if (shouldMountCapability('browser')) {
      const browserServer = this.getOrCreateBrowserServer(session.id)
      mountMcpServer('browser', { type: 'sdk', name: '@cherry/browser', instance: browserServer.mcpServer })
      autoAllowTools.add('mcp__browser__open')
      autoAllowTools.add('mcp__browser__click')
      autoAllowTools.add('mcp__browser__type')
      autoAllowTools.add('mcp__browser__press')
      autoAllowTools.add('mcp__browser__scroll')
      autoAllowTools.add('mcp__browser__focus')
      autoAllowTools.add('mcp__browser__hover')
      autoAllowTools.add('mcp__browser__wait_for')
      autoAllowTools.add('mcp__browser__inspect')
      autoAllowTools.add('mcp__browser__execute')
      autoAllowTools.add('mcp__browser__reload')
      autoAllowTools.add('mcp__browser__screenshot')
      autoAllowTools.add('mcp__browser__snapshot')
      autoAllowTools.add('mcp__browser__list_tabs')
      autoAllowTools.add('mcp__browser__switch_tab')
      autoAllowTools.add('mcp__browser__close_tab')
      autoAllowTools.add('mcp__browser__reset')
      allowMcpPattern('mcp__browser__*')
    } else {
      markSkipped('browser')
    }

    if (shouldMountCapability('search')) {
      const zhipuSearchServer = new ZhipuSearchServer()
      mountMcpServer('search', { type: 'sdk', name: 'search', instance: zhipuSearchServer.mcpServer })
      autoAllowTools.add('mcp__search__web_search')
      allowMcpPattern('mcp__search__*')
    } else {
      markSkipped('search')
    }

    if (shouldMountCapability('image')) {
      mountMcpServer('image', { type: 'sdk', name: 'image', instance: this.imageGenerateServer.mcpServer })
      autoAllowTools.add('mcp__image__generate_or_edit_image')
      autoAllowTools.add('mcp__image__generate_image')
      allowMcpPattern('mcp__image__*')
    } else {
      markSkipped('image')
    }

    if (shouldMountCapability('speech')) {
      const speechGenerateServer = new SpeechGenerateServer()
      mountMcpServer('speech', { type: 'sdk', name: 'speech', instance: speechGenerateServer.mcpServer })
      autoAllowTools.add('mcp__speech__generate_speech')
      allowMcpPattern('mcp__speech__*')
    } else {
      markSkipped('speech')
    }

    if (shouldMountCapability('draftDownload')) {
      const draftDownloadServer = new DraftDownloadServer()
      mountMcpServer('draft-download', {
        type: 'sdk',
        name: 'draft-download',
        instance: draftDownloadServer.mcpServer
      })
      autoAllowTools.add('mcp__draft-download__download_draft')
      allowMcpPattern('mcp__draft-download__*')
    } else {
      markSkipped('draft-download')
    }

    if (shouldMountCapability('copylab')) {
      const socialCopywritingServer = new SocialCopywritingServer()
      mountMcpServer('copylab', {
        type: 'sdk',
        name: 'copylab',
        instance: socialCopywritingServer.mcpServer
      })
      autoAllowTools.add('mcp__copylab__derive_copy_prompt')
      allowMcpPattern('mcp__copylab__*')
    } else {
      markSkipped('copylab')
    }

    if (shouldMountCapability('digitalHuman')) {
      const digitalHumanServer = new DigitalHumanServer()
      mountMcpServer('digital-human', {
        type: 'sdk',
        name: 'digital-human',
        instance: digitalHumanServer.mcpServer
      })
      autoAllowTools.add('mcp__digital-human__create_lip_sync_digital_human')
      autoAllowTools.add('mcp__digital-human__get_lip_sync_digital_human_status')
      autoAllowTools.add('mcp__digital-human__create_image_driven_digital_human')
      autoAllowTools.add('mcp__digital-human__get_image_driven_digital_human_status')
      allowMcpPattern('mcp__digital-human__*')
    } else {
      markSkipped('digital-human')
    }

    if (shouldMountCapability('kouboTemplate')) {
      const kouboTemplateServer = new KouboTemplateServer()
      mountMcpServer('koubo-template', {
        type: 'sdk',
        name: 'koubo-template',
        instance: kouboTemplateServer.mcpServer
      })
      autoAllowTools.add('mcp__koubo-template__submit_koubo_template_task')
      autoAllowTools.add('mcp__koubo-template__get_koubo_template_task_status')
      allowMcpPattern('mcp__koubo-template__*')
    } else {
      markSkipped('koubo-template')
    }

    if (shouldMountCapability('system')) {
      const systemServer = new SystemServer()
      mountMcpServer('system', { type: 'sdk', name: 'system', instance: systemServer.mcpServer })
      autoAllowTools.add('mcp__system__open_deeplink')
      allowMcpPattern('mcp__system__*')
    } else {
      markSkipped('system')
    }

    if (shouldMountCapability('skills')) {
      const skillsServer = new SkillsServer(session.agent_id)
      mountMcpServer('skills', { type: 'sdk', name: 'skills', instance: skillsServer.mcpServer })
      autoAllowTools.add('mcp__skills__skills')
      allowMcpPattern('mcp__skills__*')
    } else {
      markSkipped('skills')
    }

    if (shouldMountCapability('agentMemory')) {
      const workspaceMemoryServer = new WorkspaceMemoryServer(session.agent_id)
      mountMcpServer('agent-memory', {
        type: 'sdk',
        name: 'agent-memory',
        instance: workspaceMemoryServer.mcpServer
      })
      autoAllowTools.add('mcp__agent-memory__memory')
      allowMcpPattern('mcp__agent-memory__*')
    } else {
      markSkipped('agent-memory')
    }

    if (autonomousEnabled && shouldMountCapability('claw')) {
      const sourceChannelId = await this.resolveSourceChannel(session.agent_id, session.id)
      const clawServer = new ClawServer(session.agent_id, sourceChannelId)
      mountMcpServer('claw', { type: 'sdk', name: 'claw', instance: clawServer.mcpServer })
      autoAllowTools.add('mcp__claw__cron')
      autoAllowTools.add('mcp__claw__notify')
      autoAllowTools.add('mcp__claw__config')
      allowMcpPattern('mcp__claw__*')

      logger.debug('Injected autonomous claw MCP server', {
        agentId: session.agent_id,
        totalMcpServers: Object.keys(options.mcpServers).length
      })
    } else {
      markSkipped('claw')
    }

    if (isAssistant && shouldMountCapability('assistant')) {
      const assistantServer = new AssistantServer()
      mountMcpServer('assistant', { type: 'sdk', name: 'assistant', instance: assistantServer.mcpServer })
      autoAllowTools.add('mcp__assistant__navigate')
      autoAllowTools.add('mcp__assistant__diagnose')
      if (Array.isArray(options.allowedTools) && options.allowedTools.length > 0) {
        allowMcpPattern('mcp__assistant__*')
      } else {
        options.allowedTools = ['mcp__assistant__*']
      }

      logger.debug('Cherry Assistant: injected assistant MCP server', {
        agentId: session.agent_id,
        totalMcpServers: Object.keys(options.mcpServers).length
      })
    } else {
      markSkipped('assistant')
    }

    options.allowedTools = Array.from(autoAllowTools).sort()

    logger.info('[ToolRouter] mounted MCP servers', {
      agentId: session.agent_id,
      sessionId: session.id,
      turn: capabilityDecision.turn,
      requestPromptLength: prompt.length,
      imageCount: images?.length ?? 0,
      selectedCapabilities: Array.from(capabilityDecision.selected).sort(),
      mountedRuntimeMcpServers,
      skippedRuntimeMcpServers,
      toolGuidanceOptions,
      activeClaudeSkillCount: activeClaudeSkillNames.length,
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
        sessionInstructions: session.instructions?.length ?? 0
      },
      strictMcpConfig: Boolean(options.strictMcpConfig)
    })

    logPromptBudgetProbe({
      agentId: session.agent_id,
      sessionId: session.id,
      model: modelInfo.modelId,
      toolLayer: capabilityDecision.toolLayer,
      prompt,
      systemPrompt: finalSystemPrompt,
      builtinTools: toolSurface.builtinTools,
      allowedTools: Array.isArray(options.allowedTools) ? options.allowedTools : [],
      mcpServerNames: Object.keys(options.mcpServers || {}).sort(),
      activeSkills: activeClaudeSkillNames,
      selectedCapabilities: Array.from(capabilityDecision.selected).sort(),
      promptLengths: {
        clawSystemPrompt: clawSystemPrompt?.length ?? 0,
        factsRecall: factsRecall?.length ?? 0,
        assistantSystemPrompt: assistantSystemPrompt?.length ?? 0,
        sessionInstructions: session.instructions?.length ?? 0
      }
    })

    if (lastAgentSessionId && !NO_RESUME_COMMANDS.some((cmd) => prompt.includes(cmd))) {
      options.resume = lastAgentSessionId
      // TODO: use fork session when we support branching sessions
      // options.forkSession = true
    }

    const { stream: userInputStream, enqueue: enqueueUserMessage, close: closeUserStream } = await this.createUserMessageStream(
      prompt,
      abortController.signal,
      images
    )

    // Start async processing on the next tick so listeners can subscribe first
    setImmediate(() => {
      this.processSDKQuery(
        userInputStream,
        enqueueUserMessage,
        closeUserStream,
        options,
        aiStream,
        errorChunks,
        session.agent_id,
        session.id
      ).catch((error) => {
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

  private async createUserMessageStream(
    initialPrompt: string,
    abortSignal: AbortSignal,
    images?: Array<{ data: string; media_type: string }>
  ) {
    const queue: Array<UserInputMessage | null> = []
    const waiters: Array<(value: UserInputMessage | null) => void> = []
    let closed = false

    const flushWaiters = (value: UserInputMessage | null) => {
      const resolve = waiters.shift()
      if (resolve) {
        resolve(value)
        return true
      }
      return false
    }

    const enqueue = (value: UserInputMessage | null) => {
      if (closed) return
      if (value === null) {
        closed = true
      }
      if (!flushWaiters(value)) {
        queue.push(value)
      }
    }

    const close = () => {
      if (closed) return
      enqueue(null)
    }

    const onAbort = () => {
      close()
    }

    if (abortSignal.aborted) {
      close()
    } else {
      abortSignal.addEventListener('abort', onAbort, { once: true })
    }

    const iterator = (async function* () {
      try {
        while (true) {
          let value: UserInputMessage | null
          if (queue.length > 0) {
            value = queue.shift() ?? null
          } else if (closed) {
            break
          } else {
            // Wait for next message or close signal
            value = await new Promise<UserInputMessage | null>((resolve) => {
              waiters.push(resolve)
            })
          }

          if (value === null) {
            break
          }

          yield value
        }
      } finally {
        closed = true
        abortSignal.removeEventListener('abort', onAbort)
        while (waiters.length > 0) {
          const resolve = waiters.shift()
          resolve?.(null)
        }
      }
    })()

    // Kick off image processing asynchronously; enqueue the first message once ready
    await this.buildMessageContent(initialPrompt, images).then((content) => {
      enqueue({
        type: 'user',
        parent_tool_use_id: null,
        session_id: '',
        message: {
          role: 'user',
          content
        }
      })
    })

    return {
      stream: iterator,
      enqueue,
      close
    }
  }

  private async buildMessageContent(
    prompt: string,
    images?: Array<{ data: string; media_type: string }>
  ): Promise<string | ContentBlockParam[]> {
    if (!images || images.length === 0) {
      return prompt
    }

    const blocks: ContentBlockParam[] = [{ type: 'text', text: prompt }]

    const uploadedImages = await Promise.all(
      images.map(async (img) => {
        const resized = await this.resizeImageIfNeeded(img.data, img.media_type)
        const uploaded = await ossUploadService.uploadImageBase64(resized.data, resized.media_type)
        return { ...uploaded, media_type: resized.media_type }
      })
    )

    for (const uploaded of uploadedImages) {
      blocks.push({
        type: 'image',
        source: {
          type: 'url',
          url: uploaded.publicUrl
        }
      })
    }

    return blocks
  }

  private extractImageUrlsFromToolOutput(output: unknown): string[] {
    const collected = new Set<string>()
    const imageUrlPattern = /https?:\/\/[^\s"'`]+/g

    const collectUrl = (candidate: unknown, mimeType?: unknown) => {
      const url = String(candidate || '').trim()
      if (!url || !url.startsWith('http')) {
        return
      }
      const normalizedMimeType = String(mimeType || '').trim().toLowerCase()
      if (normalizedMimeType && !normalizedMimeType.startsWith('image/')) {
        return
      }
      collected.add(url)
    }

    const collectUrlsFromText = (text: unknown) => {
      const rawText = String(text || '')
      if (!rawText) {
        return
      }
      for (const match of rawText.matchAll(imageUrlPattern)) {
        collectUrl(match[0], 'image/png')
      }
    }

    if (typeof output === 'string') {
      collectUrlsFromText(output)
      return Array.from(collected)
    }

    if (!output || typeof output !== 'object') {
      return []
    }

    const outputRecord = output as {
      content?: unknown[]
      structuredContent?: Record<string, unknown>
      publicUrl?: string
      url?: string
    }

    collectUrl(outputRecord.publicUrl, 'image/png')
    collectUrl(outputRecord.url, 'image/png')

    const structuredContent = outputRecord.structuredContent
    if (structuredContent && typeof structuredContent === 'object') {
      collectUrl(structuredContent.publicUrl, structuredContent.mimeType)
      collectUrl(structuredContent.url, structuredContent.mimeType)
      const uploadedImageUrls = Array.isArray(structuredContent.uploadedImageUrls)
        ? structuredContent.uploadedImageUrls
        : []
      for (const url of uploadedImageUrls) {
        collectUrl(url, structuredContent.mimeType)
      }
      collectUrlsFromText(structuredContent.text)
      collectUrlsFromText(structuredContent.summary)
    }

    const content = Array.isArray(outputRecord.content) ? outputRecord.content : []

    for (const item of content) {
      if (!item || typeof item !== 'object') {
        continue
      }
      const candidate = item as { type?: string; uri?: string; mimeType?: string; text?: string }
      if (candidate.type === 'resource_link') {
        collectUrl(candidate.uri, candidate.mimeType)
        continue
      }
      if (candidate.type === 'text') {
        collectUrlsFromText(candidate.text)
      }
    }

    return Array.from(collected)
  }

  private buildSyntheticToolImageMessage(imageUrls: string[]): UserInputMessage {
    const content: ContentBlockParam[] = [
      {
        type: 'text',
        text:
          'The previous browser screenshot tool returned uploaded images. Use the attached images as the visual context for the current task and continue answering based on them.'
      }
    ]

    for (const url of imageUrls) {
      content.push({
        type: 'image',
        source: {
          type: 'url',
          url
        }
      })
    }

    return {
      type: 'user',
      session_id: '',
      parent_tool_use_id: null,
      isSynthetic: true,
      message: {
        role: 'user',
        content
      }
    }
  }

  /**
   * Resize base64 image if it exceeds the Claude API's dimension limit.
   * Uses sharp which handles JPEG/PNG/WebP/GIF/AVIF/TIFF.
   */
  private async resizeImageIfNeeded(
    base64Data: string,
    mediaType: string
  ): Promise<{ data: string; media_type: string }> {
    try {
      const { default: sharp } = await import('sharp')
      let buffer: Buffer = Buffer.from(base64Data, 'base64')
      const metadata = await sharp(buffer).metadata()

      let width = metadata.width ?? 0
      let height = metadata.height ?? 0

      const needsResize = width > IMAGE_MAX_DIMENSION || height > IMAGE_MAX_DIMENSION
      const needsShrink = buffer.length > IMAGE_MAX_BYTES
      const needsConvert = mediaType !== 'image/png'

      if (!needsResize && !needsShrink && !needsConvert) {
        return { data: base64Data, media_type: mediaType }
      }

      // Step 1: Resize if dimensions exceed limit
      if (needsResize) {
        const scale = Math.min(IMAGE_MAX_DIMENSION / width, IMAGE_MAX_DIMENSION / height)
        width = Math.round(width * scale)
        height = Math.round(height * scale)
        buffer = await sharp(buffer).resize(width, height, { fit: 'inside', withoutEnlargement: true }).png().toBuffer()
        logger.info('Resized oversized image for Claude API', {
          original: `${metadata.width}x${metadata.height}`,
          resized: `${width}x${height}`
        })
      } else if (needsConvert || needsShrink) {
        // Convert to PNG first (may reduce size for some formats)
        buffer = await sharp(buffer).png().toBuffer()
      }

      // Step 2: If still over 5MB, progressively scale down
      let attempt = 0
      while (buffer.length > IMAGE_MAX_BYTES && attempt < 5) {
        attempt++
        const shrinkFactor = 0.7
        width = Math.round(width * shrinkFactor)
        height = Math.round(height * shrinkFactor)
        buffer = await sharp(buffer).resize(width, height, { fit: 'inside', withoutEnlargement: true }).png().toBuffer()
        logger.info('Shrinking image to fit 5MB API limit', {
          attempt,
          size: `${(buffer.length / 1024 / 1024).toFixed(1)}MB`,
          dimensions: `${width}x${height}`
        })
      }

      if (buffer.length > IMAGE_MAX_BYTES) {
        logger.warn('Image still exceeds 5MB after shrinking, passing through', {
          size: `${(buffer.length / 1024 / 1024).toFixed(1)}MB`
        })
      }

      return {
        data: buffer.toString('base64'),
        media_type: 'image/png'
      }
    } catch (error) {
      logger.warn('Image resize failed, passing through as-is', {
        error: error instanceof Error ? error.message : String(error)
      })
      return { data: base64Data, media_type: mediaType }
    }
  }

  /**
   * Process SDK query and emit stream events
   */
  private async processSDKQuery(
    promptStream: AsyncIterable<UserInputMessage>,
    enqueuePromptMessage: (value: UserInputMessage | null) => void,
    closePromptStream: () => void,
    options: Options,
    stream: ClaudeCodeStream,
    errorChunks: string[],
    agentId: string,
    sessionId: string
  ): Promise<void> {
    const jsonOutput: SDKMessage[] = []
    let hasCompleted = false
    const startTime = Date.now()
    const streamState = new ClaudeStreamState({ agentSessionId: sessionId })
    const bridgedScreenshotUrls = new Set<string>()
    const toolUseProbe = {
      assistantMessageCount: 0,
      assistantWithToolUseCount: 0,
      assistantToolUseBlockCount: 0,
      transformedToolCallCount: 0,
      transformedToolResultCount: 0
    }
    const thinkingProbe = {
      streamReasoningStartCount: 0,
      streamReasoningDeltaCount: 0,
      assistantReasoningBlockCount: 0,
      assistantReasoningChars: 0
    }
    let thinkingDetectionReported = false
    const streamingProbe = {
      firstChunkAtMs: null as number | null,
      firstTextDeltaAtMs: null as number | null,
      firstReasoningDeltaAtMs: null as number | null,
      firstToolCallAtMs: null as number | null,
      firstToolResultAtMs: null as number | null,
      textDeltaCount: 0,
      reasoningDeltaCount: 0,
      assistantSnapshotWithTextCount: 0,
      assistantSnapshotTextChars: 0
    }

    try {
      for await (const message of query({ prompt: promptStream, options })) {
        if (hasCompleted) break

        jsonOutput.push(message)

        const messageType = String((message as any)?.type || '')
        const systemSubtype = messageType === 'system' ? String((message as any)?.subtype || '') : ''
        const compactProbePreview = JSON.stringify(message).slice(0, 500)
        const hasCompactSignal = compactProbePreview.toLowerCase().includes('compact')

        if (messageType === 'system') {
          logger.info('[compact-probe][sdk-system]', {
            sessionId,
            subtype: systemSubtype || 'unknown',
            hasCompactSignal
          })
          if (systemSubtype === 'status' && hasCompactSignal) {
            logger.info('[compact-probe][sdk-status-compact]', {
              sessionId,
              keys: Object.keys((message as Record<string, unknown>) || {}),
              preview: compactProbePreview
            })
          }
        } else if (hasCompactSignal) {
          logger.info('[compact-probe][sdk-message]', {
            sessionId,
            type: messageType || 'unknown',
            preview: compactProbePreview
          })
        }

        if (message.type === 'stream_event') {
          const event = (message as any).event
          const eventType = String(event?.type || '')
          if (eventType === 'content_block_start') {
            const blockType = String(event?.content_block?.type || '')
            if (blockType === 'thinking' || blockType === 'redacted_thinking' || blockType === 'reasoning') {
              thinkingProbe.streamReasoningStartCount += 1
              logger.info('Detected thinking block in gateway response (stream start)', {
                sessionId,
                index: event?.index,
                blockType
              })
              if (!thinkingDetectionReported) {
                thinkingDetectionReported = true
                // #region debug-point B:thinking-response
                void fetch('http://127.0.0.1:7777/event', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    sessionId: 'claude-thinking-depth',
                    runId: 'pre-fix',
                    hypothesisId: 'B',
                    location: 'src/main/services/agents/services/claudecode/index.ts',
                    msg: '[DEBUG] ClaudeCode response emitted thinking block',
                    data: {
                      agentSessionId: sessionId,
                      eventType,
                      blockType,
                      index: event?.index,
                      streamReasoningStartCount: thinkingProbe.streamReasoningStartCount,
                      streamReasoningDeltaCount: thinkingProbe.streamReasoningDeltaCount
                    },
                    ts: Date.now()
                  })
                }).catch(() => {})
                // #endregion
              }
            }
          } else if (eventType === 'content_block_delta') {
            const deltaType = String(event?.delta?.type || '')
            if (deltaType === 'thinking_delta' || deltaType === 'reasoning_delta') {
              thinkingProbe.streamReasoningDeltaCount += 1
            }
          }
        }

        if (message.type === 'assistant' && Array.isArray((message as any).message?.content)) {
          toolUseProbe.assistantMessageCount += 1
          const blocks = (message as any).message.content as any[]
          const toolUseBlocks = blocks.filter((block) => String(block?.type || '') === 'tool_use')
          const textBlocks = blocks.filter((block) => String(block?.type || '') === 'text')
          const textChars = textBlocks.reduce((total, block) => total + String((block as any)?.text || '').length, 0)
          if (toolUseBlocks.length > 0) {
            toolUseProbe.assistantWithToolUseCount += 1
            toolUseProbe.assistantToolUseBlockCount += toolUseBlocks.length
          }
          if (textBlocks.length > 0 && textChars > 0) {
            streamingProbe.assistantSnapshotWithTextCount += 1
            streamingProbe.assistantSnapshotTextChars += textChars
          }
          for (const block of blocks) {
            const blockType = String(block?.type || '')
            if (blockType === 'thinking' || blockType === 'redacted_thinking' || blockType === 'reasoning') {
              const text = String(block?.thinking ?? block?.text ?? '')
              thinkingProbe.assistantReasoningBlockCount += 1
              thinkingProbe.assistantReasoningChars += text.length
            }
          }
          if (thinkingProbe.assistantReasoningBlockCount > 0) {
            logger.info('Detected thinking blocks in assistant snapshot response', {
              sessionId,
              blocks: thinkingProbe.assistantReasoningBlockCount,
              chars: thinkingProbe.assistantReasoningChars
            })
          }
        }

        // Handle init message - merge builtin and SDK slash_commands
        if (message.type === 'system' && message.subtype === 'init') {
          if (message.session_id) {
            stream.sdkSessionId = message.session_id
            logger.info('Captured SDK session_id from init message', {
              sdkSessionId: message.session_id,
              sessionId
            })
          }

          const sdkSlashCommands = message.slash_commands || []
          logger.info('Received init message with slash commands', {
            sessionId,
            commands: sdkSlashCommands
          })

          try {
            // Get builtin + local slash commands from BaseService
            const existingCommands = await sessionService.listSlashCommands('claude-code', agentId)

            // Convert SDK slash_commands (string[]) to SlashCommand[] format
            // Ensure all commands start with '/'
            const sdkCommands = sdkSlashCommands.map((cmd) => {
              const normalizedCmd = cmd.startsWith('/') ? cmd : `/${cmd}`
              return {
                command: normalizedCmd,
                description: undefined
              }
            })

            // Merge: existing commands (builtin + local) + SDK commands, deduplicate by command name
            const commandMap = new Map<string, { command: string; description?: string }>()

            for (const cmd of existingCommands) {
              commandMap.set(cmd.command, cmd)
            }

            for (const cmd of sdkCommands) {
              if (!commandMap.has(cmd.command)) {
                commandMap.set(cmd.command, cmd)
              }
            }

            const mergedCommands = Array.from(commandMap.values())
            const existingCommandNames = existingCommands
              .map((cmd) => String(cmd.command || ''))
              .filter(Boolean)
              .sort()
            const normalizedSdkCommandNames = sdkCommands
              .map((cmd) => String(cmd.command || ''))
              .filter(Boolean)
              .sort()
            const mergedCommandNames = mergedCommands
              .map((cmd) => String(cmd.command || ''))
              .filter(Boolean)
              .sort()

            logger.info('Slash command source breakdown', {
              sessionId,
              agentId,
              existingCount: existingCommandNames.length,
              sdkCount: normalizedSdkCommandNames.length,
              mergedCount: mergedCommandNames.length,
              existingCommands: existingCommandNames,
              sdkCommands: normalizedSdkCommandNames,
              mergedCommands: mergedCommandNames
            })

            await sessionService.updateSession(agentId, sessionId, {
              slash_commands: mergedCommands
            })

            logger.info('Updated session with merged slash commands', {
              sessionId,
              existingCount: existingCommands.length,
              sdkCount: sdkCommands.length,
              totalCount: mergedCommands.length
            })
          } catch (error) {
            logger.error('Failed to update session slash_commands', {
              sessionId,
              error: error instanceof Error ? error.message : String(error)
            })
          }
        }

        const chunks = transformSDKMessageToStreamParts(message, streamState)
        const chunkTypes = chunks.map((chunk) => chunk.type)
        const toolCallCount = chunkTypes.filter((type) => type === 'tool-call').length
        const toolResultCount = chunkTypes.filter((type) => type === 'tool-result' || type === 'tool-error').length
        toolUseProbe.transformedToolCallCount += toolCallCount
        toolUseProbe.transformedToolResultCount += toolResultCount
        if (toolCallCount > 0 || toolResultCount > 0) {
          logger.info('Transformed stream tool chunks', {
            sessionId,
            messageType: message.type,
            toolCallCount,
            toolResultCount,
            chunkTypes
          })
        }
        const summarizeChunkField = (value: unknown) => {
          if (typeof value === 'string') return value
          if (value === undefined || value === null) return ''
          try {
            return JSON.stringify(value)
          } catch {
            return String(value)
          }
        }
        for (const chunk of chunks) {
          const elapsedMs = Date.now() - startTime
          if (streamingProbe.firstChunkAtMs === null) {
            streamingProbe.firstChunkAtMs = elapsedMs
            logger.info('Streaming probe: first transformed chunk emitted', {
              sessionId,
              elapsedMs,
              chunkType: chunk.type,
              sdkMessageType: message.type
            })
          }

          if (chunk.type === 'text-delta') {
            streamingProbe.textDeltaCount += 1
            if (streamingProbe.firstTextDeltaAtMs === null) {
              streamingProbe.firstTextDeltaAtMs = elapsedMs
              logger.info('Streaming probe: first text delta emitted', {
                sessionId,
                elapsedMs,
                sdkMessageType: message.type,
                chars: String((chunk as any).text || '').length
              })
            }
          }

          if (chunk.type === 'reasoning-delta') {
            streamingProbe.reasoningDeltaCount += 1
            if (streamingProbe.firstReasoningDeltaAtMs === null) {
              streamingProbe.firstReasoningDeltaAtMs = elapsedMs
              logger.info('Streaming probe: first reasoning delta emitted', {
                sessionId,
                elapsedMs,
                sdkMessageType: message.type,
                chars: String((chunk as any).text || '').length
              })
            }
          }

          if (chunk.type === 'tool-call' && streamingProbe.firstToolCallAtMs === null) {
            streamingProbe.firstToolCallAtMs = elapsedMs
            logger.info('Streaming probe: first tool call emitted', {
              sessionId,
              elapsedMs,
              sdkMessageType: message.type,
              toolName: (chunk as any).toolName ?? ''
            })
          }

          if ((chunk.type === 'tool-result' || chunk.type === 'tool-error') && streamingProbe.firstToolResultAtMs === null) {
            streamingProbe.firstToolResultAtMs = elapsedMs
            logger.info('Streaming probe: first tool result emitted', {
              sessionId,
              elapsedMs,
              chunkType: chunk.type,
              sdkMessageType: message.type,
              toolName: (chunk as any).toolName ?? ''
            })
          }

          if (chunk.type === 'tool-error') {
            logger.warn('Tool execution failed in stream chunk', {
              sessionId,
              toolCallId: (chunk as any).toolCallId ?? '',
              toolName: (chunk as any).toolName ?? '',
              input: summarizeChunkField((chunk as any).input).slice(0, 600),
              error: summarizeChunkField((chunk as any).error).slice(0, 1200)
            })
          }

          if (chunk.type === 'tool-result' && (chunk as any).toolName === 'mcp__browser__screenshot') {
            const imageUrls = this.extractImageUrlsFromToolOutput((chunk as any).output).filter((url) => {
              if (bridgedScreenshotUrls.has(url)) {
                return false
              }
              bridgedScreenshotUrls.add(url)
              return true
            })

            if (imageUrls.length > 0) {
              logger.info('Bridging screenshot tool result back into SDK as image input', {
                sessionId,
                toolCallId: (chunk as any).toolCallId ?? '',
                imageCount: imageUrls.length,
                imageUrls
              })
              enqueuePromptMessage(this.buildSyntheticToolImageMessage(imageUrls))
            } else {
              logger.warn('Screenshot tool result did not expose any bridgeable image URL', {
                sessionId,
                toolCallId: (chunk as any).toolCallId ?? '',
                output: summarizeChunkField((chunk as any).output).slice(0, 1200)
              })
            }
          }

          stream.emit('data', {
            type: 'chunk',
            chunk
          })

          // Close prompt stream when SDK signals completion or error
          if (chunk.type === 'finish' || chunk.type === 'error') {
            logger.info('Closing prompt stream as SDK signaled completion', {
              chunkType: chunk.type,
              reason: chunk.type === 'finish' ? 'finished' : 'error_occurred'
            })
            closePromptStream()
            logger.info('Prompt stream closed successfully')
          }
        }
      }

      const duration = Date.now() - startTime

      logger.info('Streaming probe summary', {
        sessionId,
        duration,
        messageCount: jsonOutput.length,
        firstChunkAtMs: streamingProbe.firstChunkAtMs,
        firstTextDeltaAtMs: streamingProbe.firstTextDeltaAtMs,
        firstReasoningDeltaAtMs: streamingProbe.firstReasoningDeltaAtMs,
        firstToolCallAtMs: streamingProbe.firstToolCallAtMs,
        firstToolResultAtMs: streamingProbe.firstToolResultAtMs,
        textDeltaCount: streamingProbe.textDeltaCount,
        reasoningDeltaCount: streamingProbe.reasoningDeltaCount,
        assistantSnapshotWithTextCount: streamingProbe.assistantSnapshotWithTextCount,
        assistantSnapshotTextChars: streamingProbe.assistantSnapshotTextChars
      })
      if (streamingProbe.textDeltaCount === 0 && streamingProbe.assistantSnapshotWithTextCount > 0) {
        logger.warn('Streaming probe detected snapshot-only text response', {
          sessionId,
          duration,
          assistantSnapshotWithTextCount: streamingProbe.assistantSnapshotWithTextCount,
          assistantSnapshotTextChars: streamingProbe.assistantSnapshotTextChars
        })
      }

      // logger.debug('SDK query completed successfully', {
      //   duration,
      //   messageCount: jsonOutput.length
      // })
      // logger.info('Gateway thinking probe summary', {
      //   sessionId,
      //   model: options.model,
      //   streamReasoningStartCount: thinkingProbe.streamReasoningStartCount,
      //   streamReasoningDeltaCount: thinkingProbe.streamReasoningDeltaCount,
      //   assistantReasoningBlockCount: thinkingProbe.assistantReasoningBlockCount,
      //   assistantReasoningChars: thinkingProbe.assistantReasoningChars
      // })
      // logger.info('Gateway tool-use probe summary', {
      //   sessionId,
      //   model: options.model,
      //   ...toolUseProbe
      // })
      // if (toolUseProbe.assistantWithToolUseCount === 0) {
      //   logger.warn('Gateway response contains no assistant tool_use blocks', {
      //     sessionId,
      //     model: options.model
      //   })
      // }
      // if (
      //   thinkingProbe.streamReasoningStartCount === 0 &&
      //   thinkingProbe.streamReasoningDeltaCount === 0 &&
      //   thinkingProbe.assistantReasoningBlockCount === 0
      // ) {
      //   logger.warn('Gateway response contains no detectable thinking blocks/deltas', {
      //     sessionId,
      //     model: options.model
      //   })
      // }

      stream.emit('data', {
        type: 'complete'
      })
    } catch (error) {
      if (hasCompleted) return
      hasCompleted = true

      const duration = Date.now() - startTime
      const errorObj = error as any
      const isAborted =
        errorObj?.name === 'AbortError' ||
        errorObj?.message?.includes('aborted') ||
        options.abortController?.signal.aborted

      if (isAborted) {
        logger.info('SDK query aborted by client disconnect', { duration })
        stream.emit('data', {
          type: 'cancelled',
          error: new Error('Request aborted by client')
        })
        return
      }

      errorChunks.push(errorObj instanceof Error ? errorObj.message : String(errorObj))
      const errorMessage = errorChunks.join('\n\n')
      logger.error('SDK query failed', {
        duration,
        error: errorObj instanceof Error ? { name: errorObj.name, message: errorObj.message } : String(errorObj),
        stderr: errorChunks
      })

      stream.emit('data', {
        type: 'error',
        error: new Error(errorMessage)
      })
    } finally {
      closePromptStream()
    }
  }
}

/**
 * Build a lightweight environment snapshot (~200 tokens) for Cherry Assistant.
 * Injected into system prompt so the agent knows the user's setup immediately.
 */
async function buildAssistantContext(): Promise<string> {
  const appVersion = app.getVersion()
  const platform = `${os.platform()} ${os.release()}`
  const language = configManager.getLanguage()
  const theme = configManager.getTheme()
  const proxy = configManager.get<string>('proxy', '')

  // Provider summary (no apiKey exposed)
  const providers = configManager.get<Record<string, unknown>[]>('providers', [])
  const configuredProviders = providers
    .filter((p) => p.apiKey || p.enabled)
    .map((p) => `${p.name || p.id}(${(p.models as unknown[])?.length || 0} models)`)

  // MCP summary
  const mcpServers = configManager.get<Record<string, unknown>[]>('mcpServers', [])
  const activeMcp = mcpServers.filter((s) => s.isActive)

  // Network probe (parallel, 2s timeout each)
  const probeResults = await Promise.allSettled([
    probeHost('github.com'),
    probeHost('google.com'),
    probeHost('docs.cherry-ai.com')
  ])
  const networkLines = probeResults.map((r) => {
    const v = r.status === 'fulfilled' ? r.value : { host: '?', ok: false, ms: 0 }
    return `- ${v.host}: ${v.ok ? `reachable (${v.ms}ms)` : 'unreachable'}`
  })

  return [
    '## Current Environment',
    `- App: Cherry Studio v${appVersion}`,
    `- OS: ${platform}`,
    `- Language: ${language}, Theme: ${theme}`,
    proxy ? `- Proxy: ${proxy}` : '- Proxy: none',
    `- Providers (${configuredProviders.length}): ${configuredProviders.join(', ') || 'none configured'}`,
    `- MCP Servers: ${activeMcp.length} active / ${mcpServers.length} total`,
    '',
    '## Network',
    ...networkLines
  ].join('\n')
}

async function probeHost(host: string): Promise<{ host: string; ok: boolean; ms: number }> {
  const start = Date.now()
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)
    await fetch(`https://${host}`, { method: 'HEAD', signal: controller.signal })
    clearTimeout(timeout)
    return { host, ok: true, ms: Date.now() - start }
  } catch {
    return { host, ok: false, ms: Date.now() - start }
  }
}

export default ClaudeCodeService
