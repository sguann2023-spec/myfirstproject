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

  it.each(['openai', 'anthropic'])('preserves custom %s URL and key despite session gateway configuration', async (type) => {
    mocks.validate.mockResolvedValue({ valid: true, modelId: 'model', provider: { id: 'custom-123', type, apiHost: custom, apiKey: 'custom-key', models: [{ id: 'model' }] } })
    const runtime = await buildClaudeRuntimeEnvironment({
      session: { id: 'session', model: 'model', configuration: { env_vars: { VECTCUT_API_KEY: 'login-key', VECTCUT_API_BASE_URL: gateway } } } as any,
      cwd: '/tmp', enableToolSearch: false
    })
    expect(runtime.modelInfo.provider?.anthropicApiHost).toBe(custom)
    expect(runtime.env.ANTHROPIC_API_KEY).toBe('custom-key')
    expect(runtime.modelInfo.provider?.apiHost).toBe(custom)
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it.each([
    { type: 'other', apiHost: custom, apiKey: 'key' },
    { type: 'openai', apiHost: 'file:///tmp/key', apiKey: 'key' },
    { type: 'anthropic', apiHost: custom, apiKey: '' }
  ])('rejects invalid custom runtime configuration %#', async (provider) => {
    mocks.validate.mockResolvedValue({ valid: true, modelId: 'model', provider: { id: 'custom-123', ...provider } })
    await expect(build()).rejects.toThrow()
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('uses the explicit custom key even for a gateway URL', async () => {
    mocks.validate.mockResolvedValue({ valid: true, modelId: 'model', provider: { id: 'custom-123', type: 'openai', apiHost: gateway, apiKey: 'custom-key' } })
    expect((await build()).env.ANTHROPIC_API_KEY).toBe('custom-key')
    expect(mocks.refresh).not.toHaveBeenCalled()
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
