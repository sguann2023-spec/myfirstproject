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
import SkillsServer from '@main/mcpServers/skills'
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
  GLOBALLY_DISALLOWED_TOOLS,
  SOUL_MODE_DISALLOWED_TOOLS
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
import { agentService } from '../AgentService'
import { isProvisioned, provisionBuiltinAgent } from '../builtin/BuiltinAgentProvisioner'
import { channelService } from '../ChannelService'
import { PromptBuilder } from '../cherryclaw/prompt'
import { sessionService } from '../SessionService'
import { buildNamespacedToolCallId } from './claude-stream-state'
import { promptForToolApproval } from './tool-permissions'
import { ClaudeStreamState, transformSDKMessageToStreamParts } from './transform'

const require_ = require
const logger = loggerService.withContext('ClaudeCodeService')
const promptBuilder = new PromptBuilder()
const DEFAULT_ALLOWED_TOOLS = [
  'NotebookRead',
  'Task',
  'TodoWrite',
  'Read',
  'Glob',
  'Grep',
  'Bash',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'Write'
] as const
const DEFAULT_AUTO_ALLOW_TOOLS = new Set<string>(DEFAULT_ALLOWED_TOOLS)
const IMAGE_MAX_DIMENSION = 2000
const IMAGE_MAX_BYTES = 5 * 1024 * 1024 // 5MB API limit
const shouldAutoApproveTools = process.env.CHERRY_AUTO_ALLOW_TOOLS === '1'
const NO_RESUME_COMMANDS = ['/clear']

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

  constructor() {
    // Resolve Claude Code CLI robustly (works in dev and in asar)
    this.claudeExecutablePath = toAsarUnpackedPath(
      path.join(path.dirname(require_.resolve('@anthropic-ai/claude-agent-sdk')), 'cli.js')
    )
    this.claudeProxyBootstrapPath = toAsarUnpackedPath(path.join(app.getAppPath(), 'out', 'proxy', 'index.js'))
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

    // Validate session accessible paths and make sure it exists as a directory
    const cwd = session.accessible_paths[0]
    if (!cwd) {
      aiStream.emit('data', {
        type: 'error',
        error: new Error('No accessible paths defined for the agent session')
      })
      return aiStream
    }

    const skillWorkspace = session.accessible_paths[1] || cwd

    // Sync the shared agent-level `.claude/skills` directory before we spin
    // up the SDK. Session workspaces link their `.claude/skills` entry to the
    // agent workspace, so reconciling the agent workspace keeps one shared
    // skills directory aligned with the enabled-skill state.
    try {
      await skillService.reconcileAgentSkills(session.agent_id, skillWorkspace)
    } catch (error) {
      logger.warn('Failed to reconcile agent skills before session start', {
        agentId: session.agent_id,
        skillWorkspace,
        error: error instanceof Error ? error.message : String(error)
      })
    }

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
    const vectcutApiKey = String(sessionEnvVars.VECTCUT_API_KEY || '').trim()
    const runtimeAuthToken = vectcutApiKey || String(provider.apiKey || '').trim()

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
      ENABLE_TOOL_SEARCH: 'auto',
      CHERRY_STUDIO_BUN_PATH: bunPath,
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

    const resolvedAllowedTools = Array.from(new Set([...(session.allowed_tools ?? []), ...DEFAULT_ALLOWED_TOOLS])).filter(
      (tool) => !['WebFetch', 'mcp__exa__web_fetch_exa'].includes(tool)
    )
    const sessionAllowedTools = new Set<string>(resolvedAllowedTools ?? [])
    const autoAllowTools = new Set<string>([...DEFAULT_AUTO_ALLOW_TOOLS, ...sessionAllowedTools])
    const readFilesInSession = new Set<string>()
    const summarizeToolList = (tools?: string[]) => {
      const list = Array.isArray(tools) ? tools.filter(Boolean) : []
      const unique = Array.from(new Set(list))
      return {
        count: unique.length,
        tools: unique.sort()
      }
    }
    const summarizePromptSource = (
      promptSource: Options['systemPrompt']
    ): {
      mode: 'assistant' | 'soul' | 'preset' | 'custom'
      preset: string | null
      length: number
      appendLength: number | null
    } => {
      if (typeof promptSource === 'string') {
        return {
          mode: assistantSystemPrompt ? 'assistant' : soulSystemPrompt ? 'soul' : 'custom',
          preset: null,
          length: promptSource.length,
          appendLength: null
        }
      }

      if (promptSource && typeof promptSource === 'object' && 'type' in promptSource && promptSource.type === 'preset') {
        const append = typeof promptSource.append === 'string' ? promptSource.append : ''
        return {
          mode: 'preset',
          preset: promptSource.preset,
          length: append.length,
          appendLength: append.length
        }
      }

      return {
        mode: 'custom',
        preset: null,
        length: 0,
        appendLength: null
      }
    }
    const normalizeToolName = (name: string) => (name.startsWith('builtin_') ? name.slice('builtin_'.length) : name)
    const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
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
    const allowsToolByPattern = (patterns: string[] | undefined, tool: string) => {
      if (!Array.isArray(patterns) || patterns.length === 0) return false
      const normalizedTool = normalizeToolName(tool)
      return patterns.some((pattern) => {
        if (!pattern) return false
        if (pattern === tool || pattern === normalizedTool) return true
        if (pattern.includes('*')) {
          const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*')
          const re = new RegExp(`^${escaped}$`)
          return re.test(tool) || re.test(normalizedTool)
        }
        return false
      })
    }

    let plugins: SdkPluginConfig[] | undefined
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

    const canUseTool: CanUseTool = async (toolName, input, options) => {
      logger.info('Handling tool permission check', {
        toolName,
        suggestionCount: options.suggestions?.length ?? 0
      })
      const normalizedToolName = normalizeToolName(toolName)

      if (shouldAutoApproveTools) {
        logger.debug('Auto-approving tool due to CHERRY_AUTO_ALLOW_TOOLS flag', { toolName })
        return { behavior: 'allow', updatedInput: input }
      }

      if (options.signal.aborted) {
        logger.debug('Permission request signal already aborted; denying tool', { toolName })
        return {
          behavior: 'deny',
          message: 'Tool request was cancelled before prompting the user'
        }
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
        if (bypassAll || autoAllowed) {
          const namespacedToolCallId = buildNamespacedToolCallId(session.id, toolUseID)
          logger.debug('handling auto approved tools', {
            toolName,
            normalizedToolName,
            namespacedToolCallId,
            permission_mode: input.permission_mode,
            autoAllowTools
          })
          const toolInput = isRecord(input.tool_input) ? input.tool_input : {}

          await promptForToolApproval(toolName, toolInput, {
            ...options,
            toolCallId: namespacedToolCallId,
            autoApprove: true
          })
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

    // Soul Mode: read soul_enabled from agent-level configuration (not session)
    const agent = await agentService.getAgent(session.agent_id)
    const agentConfig = agent?.configuration
    const soulEnabled = agentConfig?.soul_enabled !== false
    let soulSystemPrompt: string | undefined

    if (soulEnabled && cwd) {
      soulSystemPrompt = await promptBuilder.buildSystemPrompt(cwd, agentConfig)
      logger.info('Built Soul Mode system prompt', { cwd, promptLength: soulSystemPrompt.length })
    }

    // Inject channel security policy into system prompt when session is from an external channel
    const linkedChannel = await channelService.findBySessionId(session.id)
    const isChannelSession = !!linkedChannel
    const channelSecurityBlock = isChannelSession ? `\n\n${CHANNEL_SECURITY_PROMPT}` : ''

    // Built-in agent mode: check builtin_role in configuration
    const builtinRole = (session.configuration as Record<string, unknown> | undefined)?.builtin_role as
      | string
      | undefined
    const isAssistant = builtinRole === 'assistant'

    // For non-Soul, non-Assistant agents we still want the model to know how
    // to use the skills + memory MCP servers we inject for everyone, plus the
    // shared web tool strategy. This is a lightweight strategy suffix that
    // sits on top of the SDK's `claude_code` preset rather than replacing it.
    // Soul agents already get the full guidance via `soulSystemPrompt`, and
    // Cherry Assistant has its own specialized prompt path.
    const nonSoulToolGuidance = !soulEnabled && !isAssistant ? promptBuilder.buildToolGuidance() : ''

    // Recall side of the cross-session learning loop for non-Soul agents:
    // load `memory/FACT.md` (written via the memory tool in previous sessions)
    // back into the system prompt so the agent remembers what it learned.
    // Soul agents already get this via `soulSystemPrompt`'s memories section.
    const nonSoulFactsRecall =
      !soulEnabled && !isAssistant && cwd ? await promptBuilder.buildFactsSection(cwd) : undefined

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

    const finalSystemPrompt: Options['systemPrompt'] = assistantSystemPrompt
      ? assistantSystemPrompt
      : soulSystemPrompt
        ? `${soulSystemPrompt}${session.instructions ? `\n\n${session.instructions}` : ''}${channelSecurityBlock}\n\n${getLanguageInstruction()}`
        : {
            type: 'preset',
            preset: 'claude_code',
            append:
              [nonSoulToolGuidance, nonSoulFactsRecall, session.instructions].filter(Boolean).join('\n\n') +
              `${channelSecurityBlock}\n\n${getLanguageInstruction()}`
          }

    // Build SDK options from session configuration
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
      // Built-in agents skip CLAUDE.md loading to save tokens
      settingSources: builtinRole ? [] : ['project', 'local'],
      includePartialMessages: true,
      permissionMode: session.configuration?.permission_mode,
      maxTurns: session.configuration?.max_turns,
      allowedTools: resolvedAllowedTools,
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
        ...(soulEnabled ? SOUL_MODE_DISALLOWED_TOOLS : []),
        // Cherry Assistant is a read-only guide; it should not ask users questions via tool
        ...(isAssistant ? ['AskUserQuestion'] : [])
      ],
      ...(thinkingOptions?.effort ? { effort: thinkingOptions.effort } : {}),
      ...(thinkingOptions?.thinking ? { thinking: thinkingOptions.thinking } : {})
    }
    const promptSourceSummary = summarizePromptSource(options.systemPrompt)

    if (session.accessible_paths.length > 1) {
      options.additionalDirectories = session.accessible_paths.slice(1)
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

    // Inject @cherry/browser MCP for all agents to handle interactive browsing.
    if (!options.mcpServers) options.mcpServers = {}
    const browserServer = this.getOrCreateBrowserServer(session.id)
    options.mcpServers.browser = { type: 'sdk', name: '@cherry/browser', instance: browserServer.mcpServer }
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
    if (Array.isArray(options.allowedTools) && options.allowedTools.length > 0) {
      if (!options.allowedTools.includes('mcp__browser__*')) {
        options.allowedTools = [...options.allowedTools, 'mcp__browser__*']
      }
    }

    const zhipuSearchServer = new ZhipuSearchServer()
    options.mcpServers.search = { type: 'sdk', name: 'search', instance: zhipuSearchServer.mcpServer }
    autoAllowTools.add('mcp__search__web_search')
    if (Array.isArray(options.allowedTools) && options.allowedTools.length > 0) {
      if (!options.allowedTools.includes('mcp__search__*')) {
        options.allowedTools = [...options.allowedTools, 'mcp__search__*']
      }
    }

    // Inject a host-level system MCP for trusted desktop actions that should
    // not be attempted via sandboxed Bash (for example, opening a vetted
    // vectcut:// deeplink on the user's OS).
    const systemServer = new SystemServer()
    options.mcpServers.system = { type: 'sdk', name: 'system', instance: systemServer.mcpServer }
    autoAllowTools.add('mcp__system__open_deeplink')
    if (Array.isArray(options.allowedTools) && options.allowedTools.length > 0) {
      if (!options.allowedTools.includes('mcp__system__*')) {
        options.allowedTools = [...options.allowedTools, 'mcp__system__*']
      }
    }

    // Inject skills MCP for all agents — managing Claude skills (search / install
    // / list / remove / init / register) is a generally useful capability and is
    // not coupled to Soul Mode's autonomous-agent semantics.
    const skillsServer = new SkillsServer(session.agent_id)
    options.mcpServers.skills = { type: 'sdk', name: 'skills', instance: skillsServer.mcpServer }
    // Auto-approve via Cherry Studio's own permission gate. The SDK whitelist
    // (`options.allowedTools`) takes glob patterns, but `canUseTool` checks
    // `autoAllowTools` with exact string matching, so we have to add the full
    // tool names there too — otherwise non-Soul agents (which do not run in
    // bypassPermissions mode) get an approval prompt for every call.
    autoAllowTools.add('mcp__skills__skills')
    if (Array.isArray(options.allowedTools) && options.allowedTools.length > 0) {
      if (!options.allowedTools.includes('mcp__skills__*')) {
        options.allowedTools = [...options.allowedTools, 'mcp__skills__*']
      }
    }

    // Inject agent workspace memory MCP for all agents — cross-session FACT.md /
    // JOURNAL.jsonl in the agent's workspace. Distinct from the user-opt-in
    // built-in `memory-server` (knowledge graph). Any agent with a stable
    // workspace benefits from this.
    const workspaceMemoryServer = new WorkspaceMemoryServer(session.agent_id)
    options.mcpServers['agent-memory'] = {
      type: 'sdk',
      name: 'agent-memory',
      instance: workspaceMemoryServer.mcpServer
    }
    autoAllowTools.add('mcp__agent-memory__memory')
    if (Array.isArray(options.allowedTools) && options.allowedTools.length > 0) {
      if (!options.allowedTools.includes('mcp__agent-memory__*')) {
        options.allowedTools = [...options.allowedTools, 'mcp__agent-memory__*']
      }
    }

    if (soulEnabled) {
      // Find the channel that owns this session (if any) for context-aware cron defaults
      const sourceChannelId = await this.resolveSourceChannel(session.agent_id, session.id)
      const clawServer = new ClawServer(session.agent_id, sourceChannelId)
      options.mcpServers.claw = { type: 'sdk', name: 'claw', instance: clawServer.mcpServer }

      // Auto-approve claw MCP tools at both layers (see skills/memory above
      // for the SDK-glob vs canUseTool-exact-match rationale). Soul agents
      // typically run in bypassPermissions, so this is defense in depth, but
      // it lets claw also work for any future non-bypass Soul session.
      autoAllowTools.add('mcp__claw__cron')
      autoAllowTools.add('mcp__claw__notify')
      autoAllowTools.add('mcp__claw__config')
      if (Array.isArray(options.allowedTools) && options.allowedTools.length > 0) {
        if (!options.allowedTools.includes('mcp__claw__*')) {
          options.allowedTools = [...options.allowedTools, 'mcp__claw__*']
        }
      }

      logger.debug('Soul Mode: injected claw MCP server', {
        agentId: session.agent_id,
        totalMcpServers: Object.keys(options.mcpServers).length
      })
    }

    // Cherry Assistant: inject navigate + diagnose MCP server
    if (isAssistant) {
      const assistantServer = new AssistantServer()
      options.mcpServers.assistant = { type: 'sdk', name: 'assistant', instance: assistantServer.mcpServer }

      // Auto-approve assistant MCP tools at both layers (see skills/memory
      // above for the SDK-glob vs canUseTool-exact-match rationale).
      autoAllowTools.add('mcp__assistant__navigate')
      autoAllowTools.add('mcp__assistant__diagnose')
      if (Array.isArray(options.allowedTools) && options.allowedTools.length > 0) {
        if (!options.allowedTools.includes('mcp__assistant__*')) {
          options.allowedTools = [...options.allowedTools, 'mcp__assistant__*']
        }
      } else {
        // When allowed_tools is empty/undefined, set it so assistant MCP tools are auto-approved
        options.allowedTools = ['mcp__assistant__*']
      }

      logger.debug('Cherry Assistant: injected assistant MCP server', {
        agentId: session.agent_id,
        totalMcpServers: Object.keys(options.mcpServers).length
      })
    }

    if (lastAgentSessionId && !NO_RESUME_COMMANDS.some((cmd) => prompt.includes(cmd))) {
      options.resume = lastAgentSessionId
      // TODO: use fork session when we support branching sessions
      // options.forkSession = true
    }

    // // Final safeguard: MCP is not supported for Claude Code SDK requests in this app.
    // // Even if MCP servers/tools were injected earlier, strip them right before query.
    // const isMcpToolPattern = (tool: string) => tool.trim().toLowerCase().startsWith('mcp__')
    // const mcpServerNamesBeforeStrip = Object.keys(options.mcpServers || {})
    // const allowedToolsBeforeStrip = Array.isArray(options.allowedTools) ? [...options.allowedTools] : undefined
    // const autoAllowToolsBeforeStrip = Array.from(autoAllowTools)

    // if (Array.isArray(options.allowedTools)) {
    //   options.allowedTools = options.allowedTools.filter((tool) => !isMcpToolPattern(tool))
    // }

    // for (const toolName of Array.from(autoAllowTools)) {
    //   if (isMcpToolPattern(toolName)) {
    //     autoAllowTools.delete(toolName)
    //   }
    // }

    // if (options.mcpServers && Object.keys(options.mcpServers).length > 0) {
    //   delete (options as { mcpServers?: unknown }).mcpServers
    //   delete (options as { strictMcpConfig?: unknown }).strictMcpConfig
    // }

    // const strippedMcpAllowedTools = (allowedToolsBeforeStrip || []).filter((tool) => isMcpToolPattern(tool))
    // const strippedMcpAutoAllowTools = autoAllowToolsBeforeStrip.filter((tool) => isMcpToolPattern(tool))
    // if (
    //   mcpServerNamesBeforeStrip.length > 0 ||
    //   strippedMcpAllowedTools.length > 0 ||
    //   strippedMcpAutoAllowTools.length > 0
    // ) {
    //   logger.info('MCP tools are stripped before SDK query', {
    //     sessionId: session.id,
    //     removedMcpServers: mcpServerNamesBeforeStrip,
    //     removedAllowedTools: strippedMcpAllowedTools,
    //     removedAutoAllowTools: strippedMcpAutoAllowTools
    //   })
    // }
    logger.info('MCP configuration retained for SDK query', {
      sessionId: session.id,
      mcpServerNames: Object.keys(options.mcpServers || {}),
      mcpAllowedTools: (Array.isArray(options.allowedTools) ? options.allowedTools : []).filter((tool) =>
        tool.trim().toLowerCase().startsWith('mcp__')
      ),
      mcpAutoAllowTools: Array.from(autoAllowTools).filter((tool) => tool.trim().toLowerCase().startsWith('mcp__'))
    })

    logger.info('Claude session visibility probe', {
      sessionId: session.id,
      agentId: session.agent_id,
      modelId: modelInfo.modelId,
      builtinRole: builtinRole ?? null,
      isAssistant,
      soulEnabled,
      isChannelSession,
      linkedChannelId: linkedChannel?.id ?? null,
      permissionMode: session.configuration?.permission_mode ?? null,
      maxTurns: session.configuration?.max_turns ?? null,
      rawAllowedToolsState:
        session.allowed_tools === undefined
          ? 'undefined'
          : Array.isArray(session.allowed_tools) && session.allowed_tools.length === 0
            ? 'empty-array'
            : 'non-empty-array',
      rawAllowedTools: summarizeToolList(session.allowed_tools),
      defaultAllowedTools: summarizeToolList(Array.from(DEFAULT_ALLOWED_TOOLS)),
      resolvedAllowedToolsState:
        resolvedAllowedTools === undefined
          ? 'undefined'
          : Array.isArray(resolvedAllowedTools) && resolvedAllowedTools.length === 0
            ? 'empty-array'
            : 'non-empty-array',
      resolvedAllowedTools: summarizeToolList(resolvedAllowedTools),
      finalAllowedToolsState:
        options.allowedTools === undefined
          ? 'undefined'
          : Array.isArray(options.allowedTools) && options.allowedTools.length === 0
            ? 'empty-array'
            : 'non-empty-array',
      finalAllowedTools: summarizeToolList(options.allowedTools),
      todoProbe: {
        rawHasTodoWrite: Array.isArray(session.allowed_tools) ? session.allowed_tools.includes('TodoWrite') : null,
        resolvedHasTodoWrite: Array.isArray(resolvedAllowedTools) ? resolvedAllowedTools.includes('TodoWrite') : null,
        finalCoversTodoWrite: allowsToolByPattern(options.allowedTools, 'TodoWrite'),
        autoAllowHasTodoWrite: autoAllowTools.has('TodoWrite') || autoAllowTools.has('builtin_TodoWrite'),
        disallowedHasTodoWrite: options.disallowedTools?.includes('TodoWrite') ?? false
      },
      taskProbe: {
        rawHasTask: Array.isArray(session.allowed_tools) ? session.allowed_tools.includes('Task') : null,
        resolvedHasTask: Array.isArray(resolvedAllowedTools) ? resolvedAllowedTools.includes('Task') : null,
        finalCoversTask: allowsToolByPattern(options.allowedTools, 'Task'),
        autoAllowHasTask: autoAllowTools.has('Task') || autoAllowTools.has('builtin_Task'),
        disallowedHasTask: options.disallowedTools?.includes('Task') ?? false
      },
      promptSource: {
        ...promptSourceSummary,
        sessionInstructionsLength: session.instructions?.length ?? 0,
        nonSoulToolGuidanceLength: nonSoulToolGuidance.length,
        nonSoulFactsRecallLength: nonSoulFactsRecall?.length ?? 0,
        soulSystemPromptLength: soulSystemPrompt?.length ?? 0,
        assistantSystemPromptLength: assistantSystemPrompt?.length ?? 0,
        channelSecurityEnabled: Boolean(channelSecurityBlock),
        settingSources: options.settingSources ?? []
      }
    })

    logger.info('AllowedTools probe', {
      sessionId: session.id,
      modelId: modelInfo.modelId,
      finalAllowedToolsState:
        options.allowedTools === undefined
          ? 'undefined'
          : Array.isArray(options.allowedTools) && options.allowedTools.length === 0
            ? 'empty-array'
            : 'non-empty-array',
      sessionAllowedTools: summarizeToolList(resolvedAllowedTools),
      autoAllowTools: summarizeToolList(Array.from(autoAllowTools)),
      finalAllowedTools: summarizeToolList(options.allowedTools),
      mcpServerNames: Object.keys(options.mcpServers || {}),
      curlProbe: {
        runtimeModel: runtimeModel || null,
        providerType: provider.type,
        builtinRole: builtinRole ?? null,
        soulEnabled,
        permissionMode: session.configuration?.permission_mode ?? null,
        sessionAllowsBash: sessionAllowedTools.has('Bash') || sessionAllowedTools.has('builtin_Bash'),
        autoAllowHasBash: autoAllowTools.has('Bash') || autoAllowTools.has('builtin_Bash'),
        finalAllowedCoversBash: allowsToolByPattern(options.allowedTools, 'Bash')
      }
    })

    logger.info('Resolved SDK thinking options before query', {
      sessionId: session.id,
      modelId: modelInfo.modelId,
      anthropicBaseUrl,
      hasEffort: Boolean(thinkingOptions?.effort),
      effort: thinkingOptions?.effort ?? null,
      hasThinking: Boolean(thinkingOptions?.thinking),
      thinkingType: (thinkingOptions?.thinking as any)?.type ?? null,
      thinkingBudgetTokens: (thinkingOptions?.thinking as any)?.budgetTokens ?? null
    })

    logger.info('Starting Claude Code SDK query', {
      prompt,
      cwd: options.cwd,
      model: options.model ?? null,
      anthropicModel: env.ANTHROPIC_MODEL ?? null,
      effort: (options as any).effort ?? null,
      thinking: (options as any).thinking ?? null,
      permissionMode: options.permissionMode,
      maxTurns: options.maxTurns,
      allowedTools: options.allowedTools,
      resume: options.resume
    })

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
            }
          } else if (eventType === 'content_block_delta') {
            const deltaType = String(event?.delta?.type || '')
            if (deltaType === 'thinking_delta' || deltaType === 'reasoning_delta') {
              const text = String(event?.delta?.thinking ?? event?.delta?.reasoning ?? event?.delta?.text ?? '')
              thinkingProbe.streamReasoningDeltaCount += 1
              logger.info('Detected thinking delta in gateway response', {
                sessionId,
                index: event?.index,
                deltaType,
                chars: text.length
              })
            }
          }
        }

        if (message.type === 'assistant' && Array.isArray((message as any).message?.content)) {
          toolUseProbe.assistantMessageCount += 1
          const blocks = (message as any).message.content as any[]
          const blockTypes = blocks.map((block) => String(block?.type || 'unknown'))
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
          logger.info('Assistant snapshot probe', {
            sessionId,
            assistantMessageIndex: toolUseProbe.assistantMessageCount,
            blockTypes,
            toolUseBlockCount: toolUseBlocks.length,
            toolUseNames: toolUseBlocks.map((block) => String((block as any)?.name || 'unknown')),
            textBlockCount: textBlocks.length,
            textChars
          })
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

            // Update session in database
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
