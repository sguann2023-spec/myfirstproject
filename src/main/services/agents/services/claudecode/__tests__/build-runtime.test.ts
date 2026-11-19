import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  validate: vi.fn(), refresh: vi.fn(), listCustom: vi.fn<() => any[]>(() => []),
  getModels: vi.fn<() => Promise<{ data: any[] }>>()
}))
vi.mock('@main/services/CustomChatModelsService', () => ({ CustomChatModelsService: class { list = mocks.listCustom } }))
vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }) } }))
vi.mock('@main/apiServer/config', () => ({ config: { get: async () => ({}) } }))
vi.mock('@main/apiServer/services/models', () => ({ modelsService: { getModels: mocks.getModels } }))
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
import { resolveModelConfig } from '../../../../../../components/ModelSettings/modelCatalog.js'

const legacyMap = resolveModelConfig('unknown-model', 'openai-chat-completions')!.reasoning_level_map

const gateway = 'https://open.vectcut.com/v1'
const custom = 'https://custom.example/v1'
const build = () => buildClaudeRuntimeEnvironment({
  session: { id: 'session', model: 'custom-123:model', configuration: { env_vars: { VECTCUT_API_KEY: 'session-login-token' } } } as any,
  cwd: '/tmp', enableToolSearch: false
})

describe('runtime gateway credential scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getModels.mockReset().mockResolvedValue({ data: [] })
    mocks.refresh.mockResolvedValue('fresh-runtime-token')
    mocks.listCustom.mockReturnValue([{ id: 'custom-123', modelId: 'model', baseUrl: custom }])
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
      session: { id: 'session', model: 'custom-123:model', configuration: { env_vars: { VECTCUT_API_KEY: 'login-key', VECTCUT_API_BASE_URL: gateway } } } as any,
      cwd: '/tmp', enableToolSearch: false
    })
    expect(runtime.modelInfo.provider?.anthropicApiHost).toBe(custom)
    expect(runtime.env.ANTHROPIC_API_KEY).toBe('custom-key')
    expect(runtime.modelInfo.provider?.apiHost).toBe(custom)
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it.each([
    ['anthropic', 'https://api.deepseek.com/anthropic', 'https://api.deepseek.com/anthropic/v1'],
    ['openai', 'https://custom.example/prefix', 'https://custom.example/prefix/v1'],
    ['openai', custom, custom]
  ])('restores the persisted %s endpoint %s after provider formatting', async (type, baseUrl, apiHost) => {
    mocks.listCustom.mockReturnValue([{ id: 'custom-123', modelId: 'model', baseUrl }])
    const provider = Object.freeze({ id: 'custom-123', type, apiHost, apiKey: 'custom-key' })
    mocks.validate.mockResolvedValue({ valid: true, modelId: 'model', provider })
    const runtime = await build()
    expect(runtime.modelInfo.provider?.apiHost).toBe(baseUrl)
    expect(runtime.modelInfo.provider?.anthropicApiHost).toBe(baseUrl)
    if (type === 'anthropic') {
      expect(`${runtime.modelInfo.provider?.apiHost}/v1/messages`).toBe('https://api.deepseek.com/anthropic/v1/messages')
    }
    expect(provider.apiHost).toBe(apiHost)
    expect(provider).not.toHaveProperty('anthropicApiHost')
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it.each(['file:///tmp/key', 'https://user:password@custom.example', 'https://custom.example/#fragment', 'not-a-url'])('rejects invalid persisted custom URL %s even when the formatted URL is valid', async (baseUrl) => {
    mocks.listCustom.mockReturnValue([{ id: 'custom-123', modelId: 'model', baseUrl }])
    mocks.validate.mockResolvedValue({ valid: true, modelId: 'model', provider: { id: 'custom-123', type: 'anthropic', apiHost: custom, apiKey: 'key' } })
    await expect(build()).rejects.toThrow('Invalid custom provider URL')
  })

  it.each([
    { type: 'other', apiHost: custom, apiKey: 'key' },
    { type: 'openai-responses', apiHost: custom, apiKey: 'key' },
    { type: 'openai', apiHost: 'file:///tmp/key', apiKey: 'key' },
    { type: 'anthropic', apiHost: custom, apiKey: '' }
  ])('rejects invalid custom runtime configuration %#', async (provider) => {
    mocks.listCustom.mockReturnValue([{ id: 'custom-123', modelId: 'model', baseUrl: provider.apiHost }])
    mocks.validate.mockResolvedValue({ valid: true, modelId: 'model', provider: { id: 'custom-123', ...provider } })
    await expect(build()).rejects.toThrow()
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('uses the explicit custom key even for a gateway URL', async () => {
    mocks.listCustom.mockReturnValue([{ id: 'custom-123', modelId: 'model', baseUrl: gateway }])
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

  const buildCustom = (thinkingLevel?: string, modelOverride = 'custom-exact:model:version') => buildClaudeRuntimeEnvironment({
    session: { id: 'session', model: 'custom-other:model:version', configuration: {} } as any,
    modelOverride, thinkingLevel, cwd: '/tmp', enableToolSearch: false
  })
  const configureReasoning = (overrides = {}) => {
    mocks.validate.mockResolvedValue({ valid: true, modelId: 'model:version', provider: { id: 'custom-exact', type: 'openai', apiHost: custom, apiKey: 'custom-key' } })
    const model = { id: 'custom-exact', modelId: 'model:version', baseUrl: custom, reasoning_levels: ['Low', 'HIGH'], reasoning_level_map: '{"reasoning_effort": reasoningLevel}', ...overrides }
    mocks.listCustom.mockReturnValue([{ ...model, id: 'custom-other', reasoning_level_map: '{"reasoning_effort":"wrong"}' }, model])
    return model
  }

  it.each(['openai', 'anthropic'])('uses exact persisted custom %s token limits instead of remote or sibling metadata', async (type) => {
    const model = configureReasoning({ context_window_tokens: 262144, max_output_tokens: 32768 })
    mocks.validate.mockResolvedValue({ valid: true, modelId: model.modelId, provider: { id: model.id, type, apiHost: custom, apiKey: 'custom-key' } })
    mocks.listCustom.mockReturnValue([
      { ...model, id: 'custom-other', context_window_tokens: 64000, max_output_tokens: 4096 },
      { ...model, modelId: 'other-model', context_window_tokens: 96000, max_output_tokens: 8192 },
      model
    ])
    mocks.getModels.mockResolvedValue({ data: [{
      id: 'custom-exact:model:version', provider: 'custom-exact', provider_model_id: model.modelId,
      context_window_tokens: 128000, max_input_tokens: 120000, max_output_tokens: 8000,
      compaction_trigger_tokens: 100000
    }] })

    const runtime = await buildCustom()

    expect(runtime.modelTokenLimits).toEqual({ contextWindowTokens: 262144, maxOutputTokens: 32768 })
    expect(runtime.modelTokenLimits?.maxInputTokens).toBeUndefined()
    expect(runtime.modelTokenLimits?.compactionTriggerTokens).toBeUndefined()
    expect(mocks.listCustom).toHaveBeenCalledTimes(1)
    expect(mocks.getModels).not.toHaveBeenCalled()
  })

  it.each([
    { context_window_tokens: 262144, max_output_tokens: 32768 },
    { context_window_tokens: 262144, max_output_tokens: undefined },
    { context_window_tokens: undefined, max_output_tokens: 32768 },
    { context_window_tokens: undefined, max_output_tokens: undefined }
  ])('keeps custom optional token limits local when remote metadata is unavailable %#', async (metadata) => {
    configureReasoning(metadata)
    mocks.getModels.mockRejectedValue(new Error('remote metadata unavailable'))

    const runtime = await buildCustom()

    expect(runtime.modelTokenLimits?.contextWindowTokens).toBe(metadata.context_window_tokens)
    expect(runtime.modelTokenLimits?.maxOutputTokens).toBe(metadata.max_output_tokens)
    expect(runtime.modelTokenLimits?.maxInputTokens).toBeUndefined()
    expect(runtime.modelTokenLimits?.compactionTriggerTokens).toBeUndefined()
    expect(mocks.getModels).not.toHaveBeenCalled()
  })

  it.each(['composite ID', 'provider model ID'])('preserves all noncustom remote token limits matched by %s', async (match) => {
    mocks.validate.mockResolvedValue({ valid: true, modelId: 'model', provider: { id: 'official', type: 'openai', apiHost: custom, apiKey: 'provider-key' } })
    mocks.getModels.mockResolvedValue({ data: [{
      id: match === 'composite ID' ? 'official:model' : 'remote-model',
      provider: match === 'composite ID' ? 'remote-provider' : 'official', provider_model_id: 'model',
      context_window_tokens: 200000, max_input_tokens: 180000, max_output_tokens: 16000,
      compaction_trigger_tokens: 150000
    }] })

    const runtime = await buildClaudeRuntimeEnvironment({
      session: { id: 'session', model: 'official:model' } as any,
      cwd: '/tmp', enableToolSearch: false
    })

    expect(runtime.modelTokenLimits).toEqual({
      contextWindowTokens: 200000, maxInputTokens: 180000, maxOutputTokens: 16000,
      compactionTriggerTokens: 150000
    })
    expect(mocks.getModels).toHaveBeenCalledTimes(1)
    expect(mocks.listCustom).not.toHaveBeenCalled()
  })

  it('retains default token limits for noncustom providers when the remote lookup fails', async () => {
    mocks.validate.mockResolvedValue({ valid: true, modelId: 'model', provider: { id: 'official', type: 'openai', apiHost: custom, apiKey: 'provider-key' } })
    mocks.getModels.mockRejectedValue(new Error('remote metadata unavailable'))

    expect((await build()).modelTokenLimits).toBeUndefined()
    expect(mocks.listCustom).not.toHaveBeenCalled()
  })

  it('resolves the exact composite override once, preserves case, and defaults to the first level', async () => {
    configureReasoning()
    expect((await buildCustom()).customReasoning).toEqual({ level: 'Low', patch: { reasoning_effort: 'Low' } })
    expect(mocks.listCustom).toHaveBeenCalledTimes(1)
    expect((await buildCustom('HIGH')).customReasoning).toEqual({ level: 'HIGH', patch: { reasoning_effort: 'HIGH' } })
    await expect(buildCustom('high')).rejects.toThrow(/reasoning_levels.*Low, HIGH/)
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it.each(['gpt-5.6-sol', 'gpt-6-astra', 'o3-mini'])('repairs persisted old defaults for %s without rewriting settings', async (modelId) => {
    const model = Object.freeze(configureReasoning({ modelId, protocol: 'openai', reasoning_levels: ['none', 'low', 'high'], reasoning_level_map: legacyMap }))
    mocks.listCustom.mockReturnValue([model])
    mocks.validate.mockResolvedValue({ valid: true, modelId, provider: { id: model.id, type: 'openai', apiHost: custom, apiKey: 'custom-key' } })
    for (const level of ['none', 'low', 'high']) {
      const runtime = await buildCustom(level, `${model.id}:${modelId}`)
      expect(runtime.customReasoning).toEqual({ level, patch: { reasoning_effort: level } })
    }
    expect(model.reasoning_level_map).toBe(legacyMap)
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it.each([
    ['openai', 'gpt-6-astra', '{"thinking":{"type":"enabled"}}', { thinking: { type: 'enabled' } }],
    ['openai', 'deepseek-chat', legacyMap, { thinking: { type: 'enabled' }, enable_thinking: true, reasoning_effort: 'high', reasoning: { effort: 'high' } }],
    ['anthropic', 'gpt-6-astra', legacyMap, { thinking: { type: 'enabled' }, enable_thinking: true, reasoning_effort: 'high', reasoning: { effort: 'high' } }]
  ])('preserves %s %s nondefault or other-protocol mappings', async (protocol, modelId, source, patch) => {
    const model = configureReasoning({ modelId, protocol, reasoning_levels: ['high'], reasoning_level_map: source })
    mocks.validate.mockResolvedValue({ valid: true, modelId, provider: { id: model.id, type: protocol, apiHost: custom, apiKey: 'custom-key' } })
    expect((await buildCustom('high', `${model.id}:${modelId}`)).customReasoning).toEqual({ level: 'high', patch })
    expect(model.reasoning_level_map).toBe(source)
  })

  it('snapshots evaluation per invocation without retaining mutable settings', async () => {
    const model = configureReasoning()
    const first = await buildCustom('HIGH')
    model.reasoning_level_map = '{"enable_thinking":false}'
    const second = await buildCustom('Low')
    expect(first.customReasoning?.patch).toEqual({ reasoning_effort: 'HIGH' })
    expect(second.customReasoning?.patch).toEqual({ enable_thinking: false })
    expect(mocks.listCustom).toHaveBeenCalledTimes(2)
  })

  it('does not borrow configuration from a matching bare model ID', async () => {
    configureReasoning()
    await expect(buildCustom('HIGH', 'custom-unmatched:model:version')).rejects.toThrow(/missing, disabled, or incomplete.*Model Settings/)
  })

  it('keeps unconfigured and empty-map models without overrides', async () => {
    configureReasoning({ reasoning_levels: undefined, reasoning_level_map: undefined })
    expect((await buildCustom('legacy-selection')).customReasoning).toBeUndefined()
    configureReasoning({ reasoning_level_map: '  ' })
    expect((await buildCustom()).customReasoning?.patch).toEqual({})
  })

  it('fails invalid maps and maps without configured levels with actionable errors', async () => {
    configureReasoning({ reasoning_level_map: 'invalid(' })
    await expect(buildCustom()).rejects.toThrow(/reasoning_level_map.*Model Settings/)
    configureReasoning({ reasoning_levels: [] })
    await expect(buildCustom()).rejects.toThrow(/configure levels in Model Settings/)
  })

  it('does not read custom storage for official providers', async () => {
    mocks.validate.mockResolvedValue({ valid: true, modelId: 'model', provider: { id: 'official', type: 'openai', apiHost: gateway } })
    await build()
    expect(mocks.listCustom).not.toHaveBeenCalled()
  })

  it('retains the session fallback only for a trusted gateway after refresh failure', async () => {
    mocks.validate.mockResolvedValue({ valid: true, modelId: 'model', provider: { id: 'provider', type: 'openai', apiHost: gateway } })
    mocks.refresh.mockRejectedValue(new Error('refresh failed'))
    expect((await build()).env.ANTHROPIC_API_KEY).toBe('session-login-token')
  })
})
