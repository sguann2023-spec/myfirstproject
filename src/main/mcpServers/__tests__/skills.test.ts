import { beforeEach, describe, expect, it, vi } from 'vitest'
import { net } from 'electron'
import SkillsServer from '../skills'

// Mocks must be declared before importing SkillsServer
const mockSkillInstall = vi.fn()
const mockSkillUninstallByFolderName = vi.fn()
const mockSkillList = vi.fn()
const mockSkillListActive = vi.fn()
const mockSkillToggle = vi.fn()
const mockSkillGetSkillDirectory = vi.fn()
const mockSkillGetAgentSkillDirectory = vi.fn()
const mockSkillGetSkillFolderName = vi.fn()
const mockSkillGetByFolderName = vi.fn()
const mockSkillGetActiveSkillByFolderName = vi.fn()
const mockSkillRemoveAgentLocalSkill = vi.fn()
const mockNetFetch = vi.fn()
const mockMkdir = vi.fn()
const mockReaddir = vi.fn()

vi.mock('node:fs/promises', () => ({
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  readdir: (...args: unknown[]) => mockReaddir(...args)
}))

vi.mock('@main/services/agents/skills', () => ({
  skillService: {
    install: mockSkillInstall,
    uninstallByFolderName: mockSkillUninstallByFolderName,
    list: mockSkillList,
    listActive: mockSkillListActive,
    toggle: mockSkillToggle,
    getSkillDirectory: mockSkillGetSkillDirectory,
    getAgentSkillDirectory: mockSkillGetAgentSkillDirectory,
    getSkillFolderName: mockSkillGetSkillFolderName,
    getByFolderName: mockSkillGetByFolderName,
    getActiveSkillByFolderName: mockSkillGetActiveSkillByFolderName,
    removeAgentLocalSkill: mockSkillRemoveAgentLocalSkill
  }
}))

// Override net.fetch with our local mock — electron is mocked globally in main.setup.ts
vi.mocked(net.fetch).mockImplementation(mockNetFetch)
type SkillsServerInstance = InstanceType<typeof SkillsServer>

function createServer(agentId = 'agent_test') {
  return new SkillsServer(agentId)
}

async function callTool(server: SkillsServerInstance, args: Record<string, unknown>) {
  const handlers = (server.mcpServer.server as any)._requestHandlers
  const callToolHandler = handlers?.get('tools/call')
  if (!callToolHandler) {
    throw new Error('No tools/call handler registered')
  }
  return callToolHandler({ method: 'tools/call', params: { name: 'skills', arguments: args } }, {})
}

async function listTools(server: SkillsServerInstance) {
  const handlers = (server.mcpServer.server as any)._requestHandlers
  const listHandler = handlers?.get('tools/list')
  if (!listHandler) {
    throw new Error('No tools/list handler registered')
  }
  return listHandler({ method: 'tools/list', params: {} }, {})
}

describe('SkillsServer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSkillToggle.mockResolvedValue({ id: 'skill-1', isEnabled: true })
    mockSkillList.mockResolvedValue([])
    mockSkillListActive.mockResolvedValue([])
    mockSkillGetSkillFolderName.mockImplementation((name: string) => name)
    mockSkillGetByFolderName.mockResolvedValue(null)
    mockSkillGetActiveSkillByFolderName.mockResolvedValue(null)
  })

  it('should expose only the skills tool', async () => {
    const server = createServer()
    const result = await listTools(server)
    expect(result.tools).toHaveLength(1)
    expect(result.tools[0].name).toBe('skills')
  })

  describe('search action', () => {
    it('should search marketplace skills', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          skills: [
            {
              name: 'gh-create-pr',
              description: 'Create GitHub PRs',
              author: 'test-author',
              namespace: '@test-owner/test-repo',
              installs: 42,
              metadata: { repoOwner: 'test-owner', repoName: 'test-repo' }
            }
          ],
          total: 1
        })
      }
      mockNetFetch.mockResolvedValue(mockResponse)

      const server = createServer('agent_1')
      const result = await callTool(server, { action: 'search', query: 'github pr' })

      expect(mockNetFetch).toHaveBeenCalledWith(expect.stringContaining('/api/skills'), { method: 'GET' })
      expect(result.content[0].text).toContain('gh-create-pr')
      expect(result.content[0].text).toContain('test-owner/test-repo/gh-create-pr')
    })

    it('should handle empty search results', async () => {
      mockNetFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ skills: [], total: 0 })
      })

      const server = createServer()
      const result = await callTool(server, { action: 'search', query: 'nonexistent' })

      expect(result.content[0].text).toContain('No skills found')
    })

    it('should error when query is missing', async () => {
      const server = createServer()
      const result = await callTool(server, { action: 'search' })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("'query' is required")
    })
  })

  describe('install action', () => {
    it('should install and auto-enable a marketplace skill', async () => {
      mockSkillInstall.mockResolvedValue({
        id: 'skill-1',
        name: 'gh-create-pr',
        description: 'Create PRs',
        folderName: 'gh-create-pr',
        isEnabled: false
      })

      const server = createServer('agent_1')
      const result = await callTool(server, { action: 'install', identifier: 'owner/repo/gh-create-pr' })

      expect(mockSkillInstall).toHaveBeenCalledWith({
        installSource: 'claude-plugins:owner/repo/gh-create-pr'
      })
      expect(mockSkillToggle).toHaveBeenCalledWith({
        skillId: 'skill-1',
        agentId: 'agent_1',
        isEnabled: true
      })
      expect(result.content[0].text).toContain('Skill installed and enabled for this agent')
      expect(result.content[0].text).toContain('gh-create-pr')
    })

    it('should warn when toggle fails after install', async () => {
      mockSkillInstall.mockResolvedValue({
        id: 'skill-1',
        name: 'gh-create-pr',
        description: 'Create PRs',
        folderName: 'gh-create-pr',
        isEnabled: false
      })
      mockSkillToggle.mockResolvedValue(null)

      const server = createServer('agent_1')
      const result = await callTool(server, { action: 'install', identifier: 'owner/repo/gh-create-pr' })

      expect(result.content[0].text).toContain('warning: failed to enable')
      expect(result.content[0].text).toContain('Enabled: false')
    })

    it('should error when identifier is missing', async () => {
      const server = createServer()
      const result = await callTool(server, { action: 'install' })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("'identifier' is required")
    })
  })

  describe('remove action', () => {
    it('should remove an installed skill', async () => {
      mockSkillGetActiveSkillByFolderName.mockResolvedValue(null)
      mockSkillGetByFolderName.mockResolvedValue({ folderName: 'gh-create-pr' })
      mockSkillUninstallByFolderName.mockResolvedValue(undefined)

      const server = createServer('agent_1')
      const result = await callTool(server, { action: 'remove', name: 'gh-create-pr' })

      expect(mockSkillUninstallByFolderName).toHaveBeenCalledWith('gh-create-pr')
      expect(result.content[0].text).toContain('removed')
    })

    it('should remove an agent-local skill without touching global registry', async () => {
      mockSkillGetActiveSkillByFolderName.mockResolvedValue({ folderName: 'my-agent-skill' })
      mockSkillGetByFolderName.mockResolvedValue(null)
      mockSkillRemoveAgentLocalSkill.mockResolvedValue(undefined)

      const server = createServer('agent_1')
      const result = await callTool(server, { action: 'remove', name: 'my-agent-skill' })

      expect(mockSkillRemoveAgentLocalSkill).toHaveBeenCalledWith('agent_1', 'my-agent-skill')
      expect(mockSkillUninstallByFolderName).not.toHaveBeenCalled()
      expect(result.content[0].text).toContain('Agent-local skill')
    })

    it('should error when name is missing', async () => {
      const server = createServer()
      const result = await callTool(server, { action: 'remove' })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("'name' is required")
    })
  })

  describe('list action', () => {
    it('should list installed skills with absolute on-disk paths', async () => {
      mockSkillList.mockResolvedValue([
        { id: '1', name: 'gh-create-pr', description: 'Create PRs', folderName: 'gh-create-pr', isEnabled: true }
      ])
      mockSkillListActive.mockResolvedValue([
        { id: '1', name: 'gh-create-pr', description: 'Create PRs', folderName: 'gh-create-pr', isEnabled: true, source: 'agent' },
        { id: '2', name: 'code-review', description: 'Review code', folderName: 'code-review', isEnabled: true, source: 'agent' }
      ])
      mockSkillGetSkillDirectory.mockImplementation((folder: string) => `/global-skills/${folder}`)
      mockSkillGetAgentSkillDirectory.mockImplementation(
        async (_agentId: string, folder: string) => `/agents/agent_1/.claude/skills/${folder}`
      )

      const server = createServer('agent_1')
      const result = await callTool(server, { action: 'list' })

      // list is scoped to the current agent so enablement reflects
      // the per-agent state, not a shared global flag.
      expect(mockSkillList).toHaveBeenCalledWith('agent_1')
      const parsed = JSON.parse(result.content[0].text)
      expect(parsed).toHaveLength(2)
      // Each entry must include the absolute path so the model can patch the
      // skill in place via Read / Edit on the symlinked files.
      expect(parsed[0]).toMatchObject({
        name: 'gh-create-pr',
        folder: 'gh-create-pr',
        path: '/agents/agent_1/.claude/skills/gh-create-pr',
        enabled: true
      })
      expect(parsed[1]).toMatchObject({
        name: 'code-review',
        folder: 'code-review',
        path: '/agents/agent_1/.claude/skills/code-review',
        enabled: true
      })
      expect(mockSkillGetAgentSkillDirectory).toHaveBeenCalledWith('agent_1', 'gh-create-pr')
      expect(mockSkillGetAgentSkillDirectory).toHaveBeenCalledWith('agent_1', 'code-review')
    })

    it('should handle empty list', async () => {
      mockSkillList.mockResolvedValue([])

      const server = createServer()
      const result = await callTool(server, { action: 'list' })

      expect(result.content[0].text).toBe('No skills installed.')
    })
  })

  describe('init action', () => {
    it('should create the skill directory and return its path', async () => {
      mockSkillGetAgentSkillDirectory.mockResolvedValue('/agents/agent_1/.claude/skills/my-skill')
      mockReaddir.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
      mockMkdir.mockResolvedValue(undefined)

      const server = createServer('agent_1')
      const result = await callTool(server, { action: 'init', name: 'my-skill' })

      expect(mockSkillGetAgentSkillDirectory).toHaveBeenCalledWith('agent_1', 'my-skill')
      expect(mockMkdir).toHaveBeenCalledWith('/agents/agent_1/.claude/skills/my-skill', { recursive: true })
      expect(result.content[0].text).toContain('/agents/agent_1/.claude/skills/my-skill')
      expect(result.content[0].text).toContain('register')
    })

    it('should reject when a skill with the same folder name already exists in DB', async () => {
      mockSkillGetByFolderName.mockResolvedValue({
        id: 'existing-id',
        name: 'My Existing Skill',
        folderName: 'my-skill'
      })

      const server = createServer()
      const result = await callTool(server, { action: 'init', name: 'my-skill' })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('already exists')
      expect(result.content[0].text).toContain('My Existing Skill')
      expect(result.content[0].text).toContain('action="remove"')
      expect(mockMkdir).not.toHaveBeenCalled()
    })

    it('should reject when directory exists and is non-empty but not tracked in DB', async () => {
      mockSkillGetAgentSkillDirectory.mockResolvedValue('/agents/agent_1/.claude/skills/my-skill')
      mockReaddir.mockResolvedValue(['SKILL.md', 'scripts'])

      const server = createServer()
      const result = await callTool(server, { action: 'init', name: 'my-skill' })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('already exists and is non-empty')
      expect(mockMkdir).not.toHaveBeenCalled()
    })

    it('should allow init when directory exists but is empty', async () => {
      mockSkillGetAgentSkillDirectory.mockResolvedValue('/agents/agent_1/.claude/skills/my-skill')
      mockReaddir.mockResolvedValue([])
      mockMkdir.mockResolvedValue(undefined)

      const server = createServer()
      const result = await callTool(server, { action: 'init', name: 'my-skill' })

      expect(result.content[0].text).toContain('Skill directory ready at:')
      expect(mockMkdir).toHaveBeenCalled()
    })

    it('should reject when readdir fails with non-ENOENT error (e.g. EACCES)', async () => {
      mockSkillGetAgentSkillDirectory.mockResolvedValue('/agents/agent_1/.claude/skills/my-skill')
      mockReaddir.mockRejectedValue(Object.assign(new Error('Permission denied'), { code: 'EACCES' }))

      const server = createServer()
      const result = await callTool(server, { action: 'init', name: 'my-skill' })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Cannot read skill directory')
      expect(mockMkdir).not.toHaveBeenCalled()
    })

    it('should error when name is missing', async () => {
      const server = createServer()
      const result = await callTool(server, { action: 'init' })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("'name' is required")
    })
  })

  describe('register action', () => {
    it('should register an agent-local skill in place', async () => {
      mockSkillGetAgentSkillDirectory.mockResolvedValue('/agents/agent_1/.claude/skills/my-skill')
      mockReaddir.mockResolvedValue(['SKILL.md', 'scripts'])

      const server = createServer('agent_1')
      const result = await callTool(server, { action: 'register', name: 'my-skill' })

      expect(mockSkillGetAgentSkillDirectory).toHaveBeenCalledWith('agent_1', 'my-skill')
      expect(mockSkillToggle).not.toHaveBeenCalled()
      expect(result.content[0].text).toContain('registered for this agent')
      expect(result.content[0].text).toContain('Scope: agent-local')
    })

    it('should error when SKILL.md is missing from directory', async () => {
      mockSkillGetAgentSkillDirectory.mockResolvedValue('/agents/agent_1/.claude/skills/my-skill')
      mockReaddir.mockResolvedValue(['scripts', 'README.md'])

      const server = createServer()
      const result = await callTool(server, { action: 'register', name: 'my-skill' })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('No SKILL.md found')
    })

    it('should error when directory does not exist', async () => {
      mockSkillGetAgentSkillDirectory.mockResolvedValue('/agents/agent_1/.claude/skills/my-skill')
      mockReaddir.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

      const server = createServer()
      const result = await callTool(server, { action: 'register', name: 'my-skill' })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('does not exist')
      expect(result.content[0].text).toContain('Did you call action="init" first')
    })

    it('should error with InternalError when readdir fails with EACCES', async () => {
      mockSkillGetAgentSkillDirectory.mockResolvedValue('/agents/agent_1/.claude/skills/my-skill')
      mockReaddir.mockRejectedValue(Object.assign(new Error('Permission denied'), { code: 'EACCES' }))

      const server = createServer()
      const result = await callTool(server, { action: 'register', name: 'my-skill' })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Cannot read skill directory')
      expect(result.content[0].text).not.toContain('Did you call action="init" first')
    })

    it('should error when name is missing', async () => {
      const server = createServer()
      const result = await callTool(server, { action: 'register' })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("'name' is required")
    })
  })

  it('should handle unknown action', async () => {
    const server = createServer()
    const result = await callTool(server, { action: 'unknown' })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Unknown action')
  })
})
