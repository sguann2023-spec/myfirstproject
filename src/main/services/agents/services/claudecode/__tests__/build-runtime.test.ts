import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ validate: vi.fn(), refresh: vi.fn() }))
vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }) } }))
vi.mock('@main/apiServer/config', () => ({ config: { get: async () => ({}) } }))
vi.mock('@main/apiServer/services/models', () => ({ modelsService: { getModels: async () => ({ data: [] }) } }))
vi.mock('@main/apiServer/utils', () => ({ validateModelId: mocks.validate }))
vi.mock('@main/constant', () => ({ isWin: false }))
vi.mock('@main/services/proxy/nodeProxy', () => ({ getProxyEnvironment: () => ({}) }))
vi.mock('@main/services/agents/services/AgentRuntimeAuthService', () => ({ agentRuntimeAuthService: { ensureValidAccessToken: mocks.refresh } }))
vi.mock('@main/utils/process', () => ({
  autoDiscoverGitBash: vi.fn(), findBundledPython: () => null, getBinaryPath: async () => '/bin/bun', prependPathEntry: vi.fn()
}))
vi.mock('@main/utils/shell-env', () => ({ default: async () => ({}) }))
vi.mock('@shared/utils', () => ({ withoutTrailingApiVersion: (value: string) => value.replace(/\/v1\/?$/, '') }))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))

import { buildClaudeRuntimeEnvironment } from '../runtime/build-runtime'

const gateway = 'https://open.vectcut.com/v1'
const custom = 'https://custom.example/v1'
const build = () => buildClaudeRuntimeEnvironment({
  session: { id: 'session', model: 'model', configuration: { env_vars: { VECTCUT_API_KEY: 'session-login-token' } } } as any,
  cwd: '/tmp', enableToolSearch: false
})

describe('runtime gateway credential scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.refresh.mockResolvedValue('fresh-runtime-token')
  })

  it.each([
    ['openai', gateway, custom, true],
    ['openai', custom, gateway, false],
    ['anthropic', custom, gateway, true],
    ['anthropic', gateway, custom, false],
    ['openai', 'https://open.vectcut.com.evil.example', gateway, false],
    ['openai', 'not-a-url/open.vectcut.com', gateway, false]
  ])('scopes %s credentials to apiHost=%s anthropicApiHost=%s', async (type, apiHost, anthropicApiHost, trusted) => {
    mocks.validate.mockResolvedValue({ valid: true, modelId: 'model', provider: { id: 'provider', type, apiHost, anthropicApiHost, apiKey: 'provider-key' } })
    const runtime = await build()
    expect(runtime.env.ANTHROPIC_API_KEY).toBe(trusted ? 'fresh-runtime-token' : 'provider-key')
    expect(mocks.refresh).toHaveBeenCalledTimes(trusted ? 1 : 0)
  })

  it('keeps cached no-key provider normalization invocation-local', async () => {
    const provider = Object.freeze({ id: 'provider', type: 'openai', apiHost: gateway })
    const validated = Object.freeze({ valid: true, modelId: 'model', provider })
    mocks.validate.mockResolvedValue(validated)
    const runtime = await build()
    expect(runtime.env.ANTHROPIC_API_KEY).toBe('fresh-runtime-token')
    expect(provider).not.toHaveProperty('apiKey')
    expect(provider).not.toHaveProperty('anthropicApiHost')
    expect(runtime.modelInfo.provider).not.toBe(provider)
  })

  it('retains the session fallback only for a trusted gateway after refresh failure', async () => {
    mocks.validate.mockResolvedValue({ valid: true, modelId: 'model', provider: { id: 'provider', type: 'openai', apiHost: gateway } })
    mocks.refresh.mockRejectedValue(new Error('refresh failed'))
    expect((await build()).env.ANTHROPIC_API_KEY).toBe('session-login-token')
  })
})
