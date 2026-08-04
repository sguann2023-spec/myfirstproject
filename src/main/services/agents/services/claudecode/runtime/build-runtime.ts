import path from 'node:path'

import { loggerService } from '@logger'
import { config as apiConfigService } from '@main/apiServer/config'
import { validateModelId } from '@main/apiServer/utils'
import { isWin } from '@main/constant'
import { getProxyEnvironment } from '@main/services/proxy/nodeProxy'
import { agentRuntimeAuthService } from '@main/services/agents/services/AgentRuntimeAuthService'
import { autoDiscoverGitBash, findBundledPython, getBinaryPath, prependPathEntry } from '@main/utils/process'
import getLoginShellEnvironment from '@main/utils/shell-env'
import { withoutTrailingApiVersion } from '@shared/utils'
import { app } from 'electron'

import type { GetAgentSessionResponse } from '../..'

const logger = loggerService.withContext('ClaudeCodeRuntime')

type ValidatedModelInfo = Awaited<ReturnType<typeof validateModelId>>
type RuntimeApiConfig = Awaited<ReturnType<typeof apiConfigService.get>>

export type ClaudeRuntimeEnvironment = {
  cwd: string
  modelInfo: ValidatedModelInfo
  apiConfig: RuntimeApiConfig
  env: Record<string, string>
}

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

const isVectcutGatewayUrl = (value: string): boolean => {
  const raw = String(value || '').trim()
  if (!raw) return false
  try {
    return new URL(raw).hostname === 'open.vectcut.com'
  } catch {
    return raw.includes('open.vectcut.com')
  }
}

const describeApiKey = (value?: string | null) => {
  const normalized = String(value || '').trim()
  if (!normalized) {
    return {
      exists: false,
      length: 0,
      prefix: '',
      suffix: ''
    }
  }

  return {
    exists: true,
    length: normalized.length,
    prefix: normalized.slice(0, 6),
    suffix: normalized.slice(-6)
  }
}

export function resolveWorkspaceCwd(session: GetAgentSessionResponse): string {
  const configuredWorkspacePath = String(
    (session.configuration as Record<string, unknown> | undefined)?.selected_workspace_path || ''
  ).trim()
  const cwdCandidate = path.isAbsolute(configuredWorkspacePath) ? configuredWorkspacePath : session.accessible_paths[0] || ''
  return cwdCandidate ? path.normalize(path.resolve(cwdCandidate)) : ''
}

export async function buildClaudeRuntimeEnvironment(input: {
  session: GetAgentSessionResponse
  modelOverride?: string
  cwd: string
  enableToolSearch: boolean
}): Promise<ClaudeRuntimeEnvironment> {
  const { session, modelOverride, cwd, enableToolSearch } = input

  const runtimeModel = String(modelOverride || session.model || '').trim()
  const modelInfo = await validateModelId(runtimeModel)
  if (!modelInfo.valid) {
    throw new Error(`Invalid model ID '${runtimeModel}': ${JSON.stringify(modelInfo.error)}`)
  }

  const provider = modelInfo.provider
  if (!provider) {
    throw new Error('Provider not found for model')
  }

  const isAzureOpenAI = provider.type === 'azure-openai'
  const isAnthropicType = provider.type === 'anthropic'
  const sessionEnvVars = (session.configuration as Record<string, unknown> | undefined)?.env_vars as
    | Record<string, unknown>
    | undefined
  const gatewayAnthropicBaseUrl = String(
    sessionEnvVars?.VECTCUT_ANTHROPIC_API_BASE_URL || sessionEnvVars?.VECTCUT_API_BASE_URL || ''
  ).trim()

  if (!provider.apiHost?.trim() && gatewayAnthropicBaseUrl) {
    provider.apiHost = gatewayAnthropicBaseUrl
    logger.info('Hydrated provider apiHost from session gateway env', {
      sessionId: session.id,
      providerId: provider.id,
      providerType: provider.type,
      apiHost: provider.apiHost
    })
  }

  if (!provider.anthropicApiHost?.trim() && gatewayAnthropicBaseUrl) {
    provider.anthropicApiHost = gatewayAnthropicBaseUrl
    logger.info('Hydrated provider anthropicApiHost from session gateway env', {
      sessionId: session.id,
      providerId: provider.id,
      providerType: provider.type,
      anthropicApiHost: provider.anthropicApiHost
    })
  }

  const hasAnthropicHost = provider.anthropicApiHost?.trim() || provider.apiHost?.trim() || gatewayAnthropicBaseUrl

  if (!isAnthropicType && !isAzureOpenAI && !hasAnthropicHost) {
    logger.error('Anthropic provider configuration is missing', {
      modelInfo
    })
    throw new Error(`Invalid provider type '${provider.type}'. Expected 'anthropic' provider type.`)
  }

  if (!provider.apiKey) {
    provider.apiKey = provider.id
  }

  const apiConfig = await apiConfigService.get()
  logger.info('Resolved API server config in ClaudeCodeService', {
    host: apiConfig.host,
    port: apiConfig.port,
    apiKey: describeApiKey(apiConfig.apiKey)
  })

  const loginShellEnv = await getLoginShellEnvironment()
  const customGitBashPath = isWin ? autoDiscoverGitBash() : null
  const bundledPythonPath = isWin ? findBundledPython() : null
  const bunPath = await getBinaryPath('bun')

  const resolveAnthropicBaseUrl = (): string => {
    if (isAzureOpenAI) {
      const host = withoutTrailingApiVersion(provider.apiHost).replace(/\/openai$/, '')
      return `${host}/anthropic`
    }
    return withoutTrailingApiVersion(provider.anthropicApiHost?.trim() || provider.apiHost || gatewayAnthropicBaseUrl)
  }

  const anthropicBaseUrl = resolveAnthropicBaseUrl()
  const sessionVectcutApiKey = String(sessionEnvVars?.VECTCUT_API_KEY || '').trim()
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
    CLAUDE_CODE_USE_BEDROCK: '0',
    ANTHROPIC_API_KEY: runtimeAuthToken,
    ANTHROPIC_AUTH_TOKEN: runtimeAuthToken,
    ANTHROPIC_BASE_URL: anthropicBaseUrl,
    ANTHROPIC_MODEL: modelInfo.modelId,
    ANTHROPIC_DEFAULT_OPUS_MODEL: modelInfo.modelId,
    ANTHROPIC_DEFAULT_SONNET_MODEL: modelInfo.modelId,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: modelInfo.modelId,
    ELECTRON_RUN_AS_NODE: '1',
    ELECTRON_NO_ATTACH_CONSOLE: '1',
    CLAUDE_CONFIG_DIR: path.join(app.getPath('userData'), '.claude'),
    ENABLE_TOOL_SEARCH: enableToolSearch ? 'auto' : '0',
    CHERRY_STUDIO_BUN_PATH: bunPath,
    WORKSPACE_ROOT: cwd,
    ...(customGitBashPath ? { CLAUDE_CODE_GIT_BASH_PATH: customGitBashPath } : {})
  }

  if (customGitBashPath) {
    logger.info('Prepared Claude Git Bash env', {
      sessionId: session.id,
      cwd,
      resourcesPath: process.resourcesPath,
      gitBashPath: customGitBashPath,
      gitBashDir: path.dirname(customGitBashPath)
    })
  }

  if (bundledPythonPath) {
    prependPathEntry(env, path.dirname(bundledPythonPath))
    env.CHERRY_STUDIO_PYTHON_PATH = bundledPythonPath
  }

  if (sessionEnvVars && typeof sessionEnvVars === 'object') {
    for (const [key, value] of Object.entries(sessionEnvVars)) {
      const upperKey = key.toUpperCase()
      if (BLOCKED_ENV_KEYS.has(upperKey)) {
        logger.warn('Blocked user env var override for system-critical variable', { key })
      } else if (typeof value === 'string') {
        env[key] = value
      }
    }
  }

  return {
    cwd,
    modelInfo,
    apiConfig,
    env
  }
}
