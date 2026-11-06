import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  validate: vi.fn(),
  serialize: vi.fn((value) => value),
  where: vi.fn(),
  set: vi.fn(),
  update: vi.fn()
}))

vi.mock('../BaseService', () => ({
  BaseService: class {
    validateAgentModels = mocks.validate
    serializeJsonFields = mocks.serialize
    getDatabase = async () => ({ update: mocks.update })
  }
}))
vi.mock('@logger', () => ({ loggerService: { withContext: () => ({}) } }))
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
    expect(mocks.serialize).toHaveBeenCalledWith({ [field]: 'provider:model' })
    expect(mocks.set).toHaveBeenCalledWith(expect.not.objectContaining({ configuration: expect.anything() }))
  })

  it('uses replacement auth from the merged configuration and preserves other env vars', async () => {
    await service.updateSession('agent-1', 'session-1', {
      model: 'provider:model', configuration: { env_vars: { VECTCUT_API_KEY: ' new-token ', OTHER: 'new' } }
    } as unknown as UpdateSessionRequest)
    expect(mocks.validate).toHaveBeenCalledWith('claude-code', { model: 'provider:model' }, { runtimeApiKey: 'new-token' })
    expect(mocks.serialize).toHaveBeenCalledWith(expect.objectContaining({
      configuration: { selected_workspace_path: '/workspace', env_vars: { VECTCUT_API_KEY: ' new-token ', KEEP: 'kept', OTHER: 'new' } }
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
