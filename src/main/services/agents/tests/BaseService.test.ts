import path from 'node:path'

import type { AgentType, Tool } from '@types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('fs', () => ({ default: { existsSync: () => true, statSync: () => ({ isFile: () => false }) } }))
vi.mock('@logger', () => ({ loggerService: { withContext: () => ({}) } }))
vi.mock('@shared/mcp', () => ({ buildFunctionCallToolName: vi.fn(), normalizeVectcutMcpToolName: (name: string) => name }))
vi.mock('@types', () => ({ objectKeys: Object.keys }))
vi.mock('../database/DatabaseManager', () => ({ DatabaseManager: {} }))
vi.mock('../services/claudecode/commands', () => ({ builtinSlashCommands: [] }))
vi.mock('../services/claudecode/tools', () => ({ builtinTools: [] }))

import type { AgentModelField } from '../errors'

vi.mock('@main/apiServer/services/mcp', () => ({
  mcpApiService: {
    getServerInfo: vi.fn()
  }
}))

vi.mock('@main/utils', () => ({
  getDataPath: () => '/mock/data'
}))

const mockValidateModelId = vi.fn()
vi.mock('@main/apiServer/utils', () => ({
  validateModelId: (...args: unknown[]) => mockValidateModelId(...args)
}))

import { BaseService } from '../BaseService'
import { AgentModelValidationError } from '../errors'

class TestBaseService extends BaseService {
  public normalize(
    allowedTools: string[] | undefined,
    tools: Tool[],
    legacyIdMap?: Map<string, string>
  ): string[] | undefined {
    return this.normalizeAllowedTools(allowedTools, tools, legacyIdMap)
  }

  public async validateModels(
    agentType: AgentType,
    models: Partial<Record<AgentModelField, string | undefined>>,
    opts: { runtimeApiKey?: string } = {}
  ): Promise<void> {
    return this.validateAgentModels(agentType, models, opts)
  }

  public resolve(paths: string[] | undefined, id: string): string[] {
    return this.resolveAccessiblePaths(paths, id)
  }
}

const buildMcpTool = (id: string): Tool => ({
  id,
  name: id,
  type: 'mcp',
  description: 'test tool',
  requirePermissions: true
})

describe('BaseService.normalizeAllowedTools', () => {
  const service = new TestBaseService()

  it('returns undefined or empty inputs unchanged', () => {
    expect(service.normalize(undefined, [])).toBeUndefined()
    expect(service.normalize([], [])).toEqual([])
  })

  it('normalizes legacy MCP tool IDs and deduplicates entries', () => {
    const tools: Tool[] = [
      buildMcpTool('mcp__server_one__tool_one'),
      buildMcpTool('mcp__server_two__tool_two'),
      { id: 'custom_tool', name: 'custom_tool', type: 'custom' }
    ]

    const legacyIdMap = new Map<string, string>([
      ['mcp__server-1__tool-one', 'mcp__server_one__tool_one'],
      ['mcp_server-1_tool-one', 'mcp__server_one__tool_one'],
      ['mcp__server-2__tool-two', 'mcp__server_two__tool_two']
    ])

    const allowedTools = [
      'mcp__server-1__tool-one',
      'mcp_server-1_tool-one',
      'mcp_server_one_tool_one',
      'mcp__server_one__tool_one',
      'custom_tool',
      'mcp__server_two__tool_two',
      'mcp_server_two_tool_two',
      'mcp__server-2__tool-two'
    ]

    expect(service.normalize(allowedTools, tools, legacyIdMap)).toEqual([
      'mcp__server_one__tool_one',
      'custom_tool',
      'mcp__server_two__tool_two'
    ])
  })

  it('keeps legacy IDs when no matching MCP tool exists', () => {
    const tools: Tool[] = [buildMcpTool('mcp__server_one__tool_one')]
    const legacyIdMap = new Map<string, string>([['mcp__server-1__tool-one', 'mcp__server_one__tool_one']])

    const allowedTools = ['mcp__unknown__tool', 'mcp__server_one__tool_one']

    expect(service.normalize(allowedTools, tools, legacyIdMap)).toEqual([
      'mcp__unknown__tool',
      'mcp__server_one__tool_one'
    ])
  })

  it('returns allowed tools unchanged when no MCP tools are available', () => {
    const allowedTools = ['custom_tool', 'builtin_tool']
    const tools: Tool[] = [{ id: 'custom_tool', name: 'custom_tool', type: 'custom' }]

    expect(service.normalize(allowedTools, tools)).toEqual(allowedTools)
  })
})

describe('BaseService.validateAgentModels', () => {
  const service = new TestBaseService()

  beforeEach(() => {
    vi.stubEnv('VECTCUT_API_KEY', '')
    vi.stubEnv('VECTCUT_APIKEY', '')
  })
  afterEach(() => vi.unstubAllEnvs())

  it.each([
    ['anthropic', 'https://custom.example', 'https://open.vectcut.com/v1', true],
    ['openai', 'https://custom.example', 'https://open.vectcut.com/anthropic', false],
    ['anthropic', 'https://open.vectcut.com', 'https://custom.example', false],
    ['openai', 'https://open.vectcut.com', 'https://custom.example', true],
    ['azure-openai', 'https://custom.example', 'https://open.vectcut.com', false],
    ['azure-openai', 'https://open.vectcut.com', 'https://custom.example', true],
    ['anthropic', 'https://open.vectcut.com/v1', '', true],
    ['openai', 'https://open.vectcut.com/v1', '   ', true],
    ['anthropic', 'http://open.vectcut.com', '', false],
    ['anthropic', 'https://open.vectcut.com.evil.test', '', false],
    ['anthropic', 'not-a-url/open.vectcut.com', '', false],
    ['anthropic', '', '', false]
  ])('scopes login auth for %s apiHost=%s anthropicApiHost=%s', async (type, apiHost, anthropicApiHost, allowed) => {
    const provider = { id: 'remote', type, apiHost, anthropicApiHost, apiKey: '' }
    mockValidateModelId.mockResolvedValue({ valid: true, provider })
    const result = service.validateModels('claude-code', { model: 'remote:model' }, { runtimeApiKey: 'session-token' })
    if (allowed) await expect(result).resolves.toBeUndefined()
    else await expect(result).rejects.toThrow(AgentModelValidationError)
    expect(provider.apiKey).toBe('')
  })

  it.each(['VECTCUT_API_KEY', 'VECTCUT_APIKEY'])('scopes process %s fallback to gateway without caching', async (key) => {
    vi.stubEnv(key, 'process-token')
    const provider = { id: 'remote', type: 'anthropic', apiHost: 'https://open.vectcut.com', apiKey: '' }
    mockValidateModelId.mockResolvedValue({ valid: true, provider })
    await expect(service.validateModels('claude-code', { model: 'remote:model' })).resolves.toBeUndefined()
    expect(provider.apiKey).toBe('')
    provider.apiHost = 'https://custom.example'
    await expect(service.validateModels('claude-code', { model: 'remote:model' })).rejects.toThrow(AgentModelValidationError)
    expect(provider.apiKey).toBe('')
  })

  it('requires credentials for gateway too', async () => {
    mockValidateModelId.mockResolvedValue({ valid: true, provider: { id: 'remote', apiHost: 'https://open.vectcut.com', apiKey: '' } })
    await expect(service.validateModels('claude-code', { model: 'remote:model' })).rejects.toThrow(AgentModelValidationError)
  })

  it('throws error when regular provider is missing API key', async () => {
    mockValidateModelId.mockResolvedValue({
      valid: true,
      provider: { id: 'openai', apiKey: '' }
    })

    await expect(service.validateModels('claude-code', { model: 'openai:gpt-4' })).rejects.toThrow(
      AgentModelValidationError
    )
  })

  it('does not throw for ollama provider without API key and sets placeholder', async () => {
    const provider = { id: 'ollama', apiKey: '' }
    mockValidateModelId.mockResolvedValue({
      valid: true,
      provider
    })

    await expect(service.validateModels('claude-code', { model: 'ollama:llama3' })).resolves.not.toThrow()
    expect(provider.apiKey).toBe('ollama')
  })

  it('does not throw for lmstudio provider without API key and sets placeholder', async () => {
    const provider = { id: 'lmstudio', apiKey: '' }
    mockValidateModelId.mockResolvedValue({
      valid: true,
      provider
    })

    await expect(service.validateModels('claude-code', { model: 'lmstudio:model' })).resolves.not.toThrow()
    expect(provider.apiKey).toBe('lmstudio')
  })

  it('does not modify API key when provider already has one', async () => {
    const provider = { id: 'openai', apiKey: 'sk-existing-key' }
    mockValidateModelId.mockResolvedValue({
      valid: true,
      provider
    })

    await expect(service.validateModels('claude-code', { model: 'openai:gpt-4' })).resolves.not.toThrow()
    expect(provider.apiKey).toBe('sk-existing-key')
  })
})

describe('BaseService.resolveAccessiblePaths', () => {
  const service = new TestBaseService()
  const testId = 'agent_1234567890_abcdefghi'
  const defaultPath = path.join('/mock/data', 'Agents', 'abcdefghi')

  it('assigns a default path when paths is undefined', () => {
    expect(service.resolve(undefined, testId)).toEqual([defaultPath])
  })

  it('assigns a default path when paths is empty array', () => {
    expect(service.resolve([], testId)).toEqual([defaultPath])
  })

  it('passes through provided paths unchanged', () => {
    // Use path.normalize to get platform-appropriate path format for comparison
    expect(service.resolve(['/some/path'], testId)).toEqual([path.normalize('/some/path')])
  })
})
