import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  validate: vi.fn(),
  serialize: vi.fn((value) => value),
  where: vi.fn(),
  set: vi.fn(),
  update: vi.fn(),
  getHistory: vi.fn()
}))
vi.mock('../database/agentHistoryService', () => ({ agentHistoryService: { getHistory: mocks.getHistory } }))

vi.mock('../BaseService', () => ({
  BaseService: class {
    validateAgentModels = mocks.validate
    serializeJsonFields = mocks.serialize
    deserializeJsonFields = (value: unknown) => value
    getDatabase = async () => ({ update: mocks.update })
  }
}))
vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ warn: vi.fn() }) } }))
vi.mock('@main/utils', () => ({ getDataPath: vi.fn() }))
vi.mock('@main/utils/markdownParser', () => ({ parsePluginMetadata: vi.fn() }))
vi.mock('@types', () => ({
  AgentBaseSchema: { shape: { model: {}, plan_model: {}, small_model: {}, configuration: {}, name: {} } }
}))
vi.mock('../database/schema', () => ({ agentsTable: {}, sessionsTable: { id: 'id' } }))
vi.mock('../database/repositories/servicePersistence', () => ({
  insertSessionAtFront: vi.fn(), persistWorkspaceSessionPaths: vi.fn(), reorderSessionRows: vi.fn()
}))
vi.mock('../services/claudecode/commands', () => ({ builtinSlashCommands: [] }))

import { SessionService } from '../services/SessionService'
import type { GetAgentSessionResponse, UpdateSessionRequest } from '@types'

const context = (revision = 1, observedAt = revision) => ({
  id: 'context', revision, observedAt, runtimeSessionId: 'session', modelId: 'model', providerId: 'provider',
  basis: 'request' as const, validity: 'valid' as const,
  input: { categories: { user: 1 }, total: 1, status: 'estimated' as const, method: 'test' }, contextWindowTokens: 100
})

describe('SessionService token statistics', () => {
  let service: SessionService
  let existing: any
  beforeEach(() => {
    vi.clearAllMocks()
    existing = { id: 'session', agent_id: 'agent', model: 'model', configuration: {
      selected_workspace_path: '/workspace', env_vars: { KEEP: 'yes' }
    } }
    service = new SessionService()
    vi.spyOn(service, 'getSession').mockImplementation(async () => structuredClone(existing))
    mocks.validate.mockResolvedValue(undefined)
    mocks.where.mockImplementation(async () => {
      const data = mocks.set.mock.calls[mocks.set.mock.calls.length - 1][0]
      Object.assign(existing, data)
    })
    mocks.set.mockReturnValue({ where: mocks.where })
    mocks.update.mockReturnValue({ set: mocks.set })
  })

  const request = (revision = 1, id = 'request', runtimeSessionId = 'runtime') => ({
    id, revision, runtimeSessionId, invocationId: 'invocation', sequence: 1, modelId: 'model', providerId: 'provider',
    operation: 'chat', status: 'completed' as const, startedAt: 1, attempts: 1, input: context().input
  })

  it('exposes unpersisted ledger via API and shares the accepted snapshot/revision with notifications', async () => {
    mocks.getHistory.mockResolvedValue({ messages: [], hasMore: false })
    const notify = vi.fn()
    service.onTokenStatsChanged(notify)
    const telemetry = { version: 1 as const, requests: [request()], context: context() }
    const accepted = await service.ingestTokenTelemetry('agent', 'session', telemetry, 0)
    expect(accepted).toMatchObject({ contextGeneration: 0, context: context(), tokenTelemetry: telemetry })
    expect(notify).toHaveBeenCalledExactlyOnceWith('agent', accepted)
    const bootstrap = await service.getTokenStats('agent', 'session')
    expect(bootstrap).toMatchObject({ ...accepted, historyComplete: true, usageMessages: [] })
    expect(notify).toHaveBeenCalledTimes(1)
    expect(await service.ingestTokenTelemetry('agent', 'session', structuredClone(telemetry), 0)).toBeNull()
    expect(notify).toHaveBeenCalledTimes(1)
    const updated = await service.ingestTokenTelemetry('agent', 'session', { ...telemetry, requests: [request(2)] }, 0)
    expect(updated!.revision).toBeGreaterThan(accepted!.revision)
    expect(updated!.context!.revision).toBe(1)
    expect(notify).toHaveBeenCalledTimes(2)
  })

  it('accumulates old-generation consumed ledger after clear without reviving context', async () => {
    mocks.getHistory.mockResolvedValue({ messages: [], hasMore: false })
    const notify = vi.fn()
    service.onTokenStatsChanged(notify)
    await service.invalidateTokenContext('agent', 'session')
    expect(notify.mock.calls[0][1]).toMatchObject({ context: null, contextGeneration: 1 })
    const accepted = await service.ingestTokenTelemetry('agent', 'session', {
      version: 1, requests: [request()], context: context(999, Date.now() + 100000)
    }, 0)
    expect(accepted).toMatchObject({ context: null, contextGeneration: 1, tokenTelemetry: { requests: [request()] } })
    expect(accepted!.tokenTelemetry.context).toBeUndefined()
    expect(notify).toHaveBeenCalledTimes(2)
    expect(await service.getTokenStats('agent', 'session')).toMatchObject(accepted!)
  })

  it('merges runtime+id revisions and retains the full overlay across independent streams', async () => {
    await service.ingestTokenTelemetry('agent', 'session', { version: 1, requests: [request(2)] }, 0)
    const accepted = await service.ingestTokenTelemetry('agent', 'session', {
      version: 1, requests: [request(1), request(1, 'request', 'other-runtime')]
    }, 0)
    expect(accepted!.tokenTelemetry.requests).toEqual([request(2), request(1, 'request', 'other-runtime')])
  })

  it('captures API snapshot after pagination and cannot roll back an in-flight update', async () => {
    let finish!: (value: any) => void
    mocks.getHistory.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const api = service.getTokenStats('agent', 'session')
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    const accepted = await service.ingestTokenTelemetry('agent', 'session', { version: 1, requests: [request(3)], context: context(3) }, 0)
    finish({ messages: [{ message: { id: 'old', role: 'assistant', tokenTelemetry: { version: 1, requests: [request(1)], context: context(99) } } }], hasMore: false })
    const result = await api
    expect(result).toMatchObject({ ...accepted, historyComplete: true })
    expect(result.ok && result.revision).toBe(accepted!.revision)
  })

  it('does not let an older paginated API replace a newer bootstrap ledger', async () => {
    let finish!: (value: any) => void
    mocks.getHistory.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const older = service.getTokenStats('agent', 'session')
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    mocks.getHistory.mockResolvedValueOnce({ messages: [{ message: { id: 'new', role: 'assistant', tokenTelemetry: { version: 1, requests: [request(5)] } } }], hasMore: false })
    const newer = await service.getTokenStats('agent', 'session')
    finish({ messages: [], hasMore: false })
    const result = await older
    expect(result).toMatchObject({ ok: true, tokenTelemetry: { requests: [request(5)] } })
    expect(result.ok && result.revision).toBe(newer.ok && newer.revision)
  })

  it('notifies model invalidation even without any cached context', async () => {
    const notify = vi.fn()
    service.onTokenStatsChanged(notify)
    await service.updateSession('agent', 'session', { model: 'other' })
    expect(notify).toHaveBeenCalledWith('agent', expect.objectContaining({ context: null, contextGeneration: 1 }))
  })

  it('serializes configuration edits and context writes without losing workspace/env', async () => {
    await Promise.all([
      service.updateSession('agent', 'session', { configuration: { env_vars: { NEW: 'new' }, selected_workspace_path: '/new' } } as any),
      service.updateTokenContext('agent', 'session', context(3), 0),
      service.updateTokenContext('agent', 'session', context(2, 99), 0)
    ])
    expect(existing.configuration).toMatchObject({ selected_workspace_path: '/new', env_vars: { KEEP: 'yes', NEW: 'new' }, token_context_telemetry: { revision: 3 } })
  })

  it('accepts a new invocation snapshot with reset revision but rejects another session', async () => {
    await service.updateTokenContext('agent', 'session', context(99, 1), 0)
    expect(await service.updateTokenContext('agent', 'session', { ...context(1, 2), id: 'next-invocation' }, 0)).toBe(true)
    expect(await service.updateTokenContext('agent', 'session', { ...context(2, 3), runtimeSessionId: 'other-session' }, 0)).toBe(false)
    expect(existing.configuration.token_context_telemetry).toMatchObject({ id: 'next-invocation', revision: 1 })
  })

  it('ignores invalid contexts and stale external cache replacements', async () => {
    await service.updateTokenContext('agent', 'session', context(2), 0)
    await service.updateTokenContext('agent', 'session', { revision: 3 }, 0)
    await service.updateSession('agent', 'session', { configuration: { token_context_telemetry: context(1) } } as any)
    expect(existing.configuration.token_context_telemetry.revision).toBe(2)
  })

  it('invalidates on model/clear and rejects delayed observations', async () => {
    await service.updateTokenContext('agent', 'session', context(2), 0)
    await service.updateSession('agent', 'session', { model: 'other' })
    expect(existing.configuration.token_context_telemetry).toMatchObject({ basis: 'invalidated', validity: 'stale' })
    expect(await service.updateTokenContext('agent', 'session', context(3, 10), 0)).toBe(false)
    await service.invalidateTokenContext('agent', 'session')
    expect(existing.configuration.token_context_telemetry.basis).toBe('invalidated')
  })

  it.each(['clear', 'model', 'provider'] as const)('rejects deferred old-generation context after %s even with later time/revision', async change => {
    existing.model = 'provider:model'
    const generation = await service.getTokenContextGeneration('agent', 'session')
    let release!: () => void
    const delayed = new Promise<void>(resolve => { release = resolve })
    const oldWrite = delayed.then(() => service.updateTokenContext('agent', 'session', {
      ...context(999, Date.now() + 100_000), providerId: 'provider'
    }, generation!))
    // No cached context exists yet: invalidation must still persist a barrier.
    if (change === 'clear') await service.invalidateTokenContext('agent', 'session')
    else await service.updateSession('agent', 'session', { model: change === 'model' ? 'provider:other' : 'other-provider:model' })
    expect(await service.getTokenContextGeneration('agent', 'session')).toBe(1)
    release()
    expect(await oldWrite).toBe(false)
    expect(existing.configuration.token_context_telemetry).toBeUndefined()
    const providerId = change === 'provider' ? 'other-provider' : 'provider'
    const modelId = change === 'model' ? 'other' : 'model'
    expect(await service.updateTokenContext('agent', 'session', { ...context(1, Date.now() + 200_000), providerId, modelId }, 1)).toBe(true)
    await service.updateSession('agent', 'session', { configuration: { token_context_generation: 0 } } as any)
    expect(await service.getTokenContextGeneration('agent', 'session')).toBe(1)
    expect(await service.updateTokenContext('agent', 'session', { ...context(1000, Date.now() + 300_000), providerId: 'wrong', modelId }, 1)).toBe(false)
    expect(await service.updateTokenContext('agent', 'session', { ...context(1000, Date.now() + 300_000), providerId, modelId: 'wrong' }, 1)).toBe(false)
  })

  it('reads beyond 500, uses real cursors, deduplicates and returns metadata only', async () => {
    const first = Array.from({ length: 500 }, (_, index) => ({ message: {
      id: `m-${index}`, role: 'assistant', usage: { total_tokens: index, content: 'secret' }, blocks: ['secret'], content: 'secret'
    } }))
    mocks.getHistory.mockResolvedValueOnce({ messages: first, hasMore: true, nextAfterSequence: 999 })
      .mockResolvedValueOnce({ messages: [{ message: { id: 'm-499', role: 'assistant', usage: { total_tokens: 499 } } },
        { message: { id: 'm-500', role: 'assistant', traceId: 'trace', invocationId: 'invocation', provider: { requestId: 'provider-request', secret: 'secret' }, usageSteps: [{ total_tokens: 2 }], tokenTelemetry: { version: 1, requests: [], context: context(4) } } }], hasMore: false })
    const result = await service.getTokenStats('agent', 'session')
    expect(mocks.getHistory).toHaveBeenNthCalledWith(2, 'session', { afterSequence: 999, limit: 500, readOnly: true })
    expect(result).toMatchObject({ ok: true, historyComplete: true, context: null, contextGeneration: 0, revision: expect.any(Number), tokenTelemetry: { requests: [] } })
    expect(result.ok && result.tokenTelemetry.context).toBeUndefined()
    if (result.ok === false) throw new Error(result.error)
    expect(result.usageMessages).toHaveLength(501)
    expect(JSON.stringify(result)).not.toContain('secret')
    const lastMessage = result.usageMessages[result.usageMessages.length - 1]
    expect(lastMessage?.usageSteps).toEqual([{ total_tokens: 2 }])
    expect(lastMessage).toMatchObject({ traceId: 'trace', invocationId: 'invocation', provider: { requestId: 'provider-request' } })
  })

  it.each(['error', 'stalled'])('reports incomplete history on %s', async mode => {
    mocks.getHistory.mockResolvedValueOnce({ messages: [], hasMore: true, nextAfterSequence: 5 })
    if (mode === 'error') mocks.getHistory.mockRejectedValueOnce(new Error('read failed'))
    else mocks.getHistory.mockResolvedValueOnce({ messages: [], hasMore: true, nextAfterSequence: 5 })
    expect(await service.getTokenStats('agent', 'session')).toMatchObject({ ok: true, historyComplete: false })
  })

  it('preserves incomplete source status even when all pages were read', async () => {
    mocks.getHistory.mockResolvedValueOnce({ messages: [], hasMore: true, nextAfterSequence: 1, historyComplete: false })
      .mockResolvedValueOnce({ messages: [], hasMore: false })
    expect(await service.getTokenStats('agent', 'session')).toMatchObject({ ok: true, historyComplete: false })
  })

  it('prefers invalidated session context over valid historical contexts', async () => {
    await service.updateTokenContext('agent', 'session', context(), 0)
    await service.invalidateTokenContext('agent', 'session')
    mocks.getHistory.mockResolvedValue({ messages: [{ message: { id: 'm', role: 'assistant', tokenTelemetry: { version: 1, requests: [], context: context(99) } } }], hasMore: false })
    expect(await service.getTokenStats('agent', 'session')).toMatchObject({ context: { validity: 'stale', basis: 'invalidated' } })
  })
})

describe('SessionService.listSessions metadata', () => {
  it('preserves persisted tools and approvals without discovery', async () => {
    const service = new SessionService()
    const row = { id: 'session', tools: [{ id: 'saved' }], allowed_tools: ['mcp_legacy_tool'] }
    const query = { orderBy: vi.fn().mockResolvedValue([row]) }
    const select = vi.fn()
      .mockReturnValueOnce({ from: () => ({ where: async () => [{ count: 1 }] }) })
      .mockReturnValueOnce({ from: () => ({ where: () => query }) })
    vi.spyOn(service, 'getDatabase').mockResolvedValue({ select } as never)
    const result = await service.listSessions()
    expect(result).toEqual({ sessions: [row], total: 1 })
  })
})

describe('SessionService.updateSession auth validation', () => {
  let service: SessionService
  let existing: GetAgentSessionResponse

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.validate.mockResolvedValue(undefined)
    mocks.where.mockResolvedValue(undefined)
    mocks.set.mockReturnValue({ where: mocks.where })
    mocks.update.mockReturnValue({ set: mocks.set })
    existing = {
      id: 'session-1', agent_id: 'agent-1', agent_type: 'claude-code',
      configuration: { env_vars: { VECTCUT_API_KEY: ' existing-token ', KEEP: 'kept' }, selected_workspace_path: '/workspace' }
    } as unknown as GetAgentSessionResponse
    service = new SessionService()
    vi.spyOn(service, 'getSession').mockResolvedValue(existing)
  })

  it.each(['model', 'plan_model', 'small_model'] as const)('uses existing auth for a %s-only update', async (field) => {
    await service.updateSession('agent-1', 'session-1', { [field]: 'provider:model' })
    expect(mocks.validate).toHaveBeenCalledWith('claude-code', { [field]: 'provider:model' }, { runtimeApiKey: 'existing-token' })
    expect(mocks.serialize).toHaveBeenCalledWith(expect.objectContaining({
      [field]: 'provider:model', configuration: expect.objectContaining({ token_context_generation: 1 })
    }))
  })

  it('uses replacement auth from the merged configuration and preserves other env vars', async () => {
    await service.updateSession('agent-1', 'session-1', {
      model: 'provider:model', configuration: { env_vars: { VECTCUT_API_KEY: ' new-token ', OTHER: 'new' } }
    } as unknown as UpdateSessionRequest)
    expect(mocks.validate).toHaveBeenCalledWith('claude-code', { model: 'provider:model' }, { runtimeApiKey: 'new-token' })
    expect(mocks.serialize).toHaveBeenCalledWith(expect.objectContaining({
      configuration: { token_context_generation: 1, selected_workspace_path: '/workspace', env_vars: { VECTCUT_API_KEY: ' new-token ', KEEP: 'kept', OTHER: 'new' } }
    }))
  })

  it('retains auth when an incoming config only changes other env vars', async () => {
    await service.updateSession('agent-1', 'session-1', {
      model: 'provider:model', configuration: { env_vars: { OTHER: 'new' } }
    } as unknown as UpdateSessionRequest)
    expect(mocks.validate).toHaveBeenCalledWith('claude-code', { model: 'provider:model' }, { runtimeApiKey: 'existing-token' })
  })

  it.each(['', '   '])('does not resurrect the old token when explicitly cleared to %j', async (token) => {
    await service.updateSession('agent-1', 'session-1', {
      model: 'provider:model', configuration: { env_vars: { VECTCUT_API_KEY: token } }
    } as unknown as UpdateSessionRequest)
    expect(mocks.validate).toHaveBeenCalledWith('claude-code', { model: 'provider:model' }, { runtimeApiKey: '' })
  })

  it('passes empty auth when no configuration exists', async () => {
    delete existing.configuration
    await service.updateSession('agent-1', 'session-1', { model: 'provider:model' })
    expect(mocks.validate).toHaveBeenCalledWith('claude-code', { model: 'provider:model' }, { runtimeApiKey: '' })
  })

  it('does not validate models on configuration-only updates', async () => {
    await service.updateSession('agent-1', 'session-1', {
      configuration: { env_vars: { VECTCUT_API_KEY: 'new-token' } }
    } as unknown as UpdateSessionRequest)
    expect(mocks.validate).not.toHaveBeenCalled()
    expect(mocks.update).toHaveBeenCalledOnce()
  })

  it('does not persist when validation fails', async () => {
    mocks.validate.mockRejectedValueOnce(new Error('invalid model'))
    await expect(service.updateSession('agent-1', 'session-1', { model: 'invalid' })).rejects.toThrow('invalid model')
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('returns null without validation or persistence for a missing session', async () => {
    vi.mocked(service.getSession).mockResolvedValue(null)
    await expect(service.updateSession('agent-1', 'missing', { model: 'provider:model' })).resolves.toBeNull()
    expect(mocks.validate).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })
})
