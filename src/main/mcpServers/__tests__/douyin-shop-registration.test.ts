import { beforeAll, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ entries: vi.fn(), fetch: vi.fn() }))
vi.mock('electron', () => ({ net: { fetch: mocks.fetch } }))
vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ info() {}, warn() {}, debug() {}, error() {} }) } }))
vi.mock('@main/utils', () => ({ getDataPath: () => '/tmp/mock-data' }))
vi.mock('@main/apiServer/utils/mcp', () => ({ setAggregateServerEntries: mocks.entries }))
vi.mock('@main/services/agents/services/AgentRuntimeAuthService', () => ({
  agentRuntimeAuthService: { ensureValidAccessToken: vi.fn() }
}))

// Keep only the new server real. Constructing unrelated media servers must not
// touch Electron stores, cloud services or workspace files in these tests.
const stubbedModules = [
  "@main/mcpServers/ai-library",
  "@main/mcpServers/artifact-server",
  "@main/mcpServers/assistant",
  "@main/mcpServers/audio-understand",
  "@main/mcpServers/blender-local",
  "@main/mcpServers/browser/server",
  "@main/mcpServers/claw",
  "@main/mcpServers/color-grade",
  "@main/mcpServers/cut-workflow",
  "@main/mcpServers/digital-human",
  "@main/mcpServers/draft-download",
  "@main/mcpServers/draft-elements",
  "@main/mcpServers/draft-management",
  "@main/mcpServers/draft-render",
  "@main/mcpServers/ffmpeg-media",
  "@main/mcpServers/figure-search",
  "@main/mcpServers/file-upload",
  "@main/mcpServers/filesystem",
  "@main/mcpServers/footage-search",
  "@main/mcpServers/image-generate",
  "@main/mcpServers/image-understand",
  "@main/mcpServers/koubo-template",
  "@main/mcpServers/materials",
  "@main/mcpServers/media-search",
  "@main/mcpServers/photo-search",
  "@main/mcpServers/scrapt-tool",
  "@main/mcpServers/seed-audio",
  "@main/mcpServers/skills",
  "@main/mcpServers/social-copywriting",
  "@main/mcpServers/speech-generate",
  "@main/mcpServers/stock-search",
  "@main/mcpServers/storyboard-editor",
  "@main/mcpServers/subtitle-recognition",
  "@main/mcpServers/subtitle-template",
  "@main/mcpServers/system",
  "@main/mcpServers/user-interaction",
  "@main/mcpServers/video-generate",
  "@main/mcpServers/video-portrait-matte",
  "@main/mcpServers/video-understand",
  "@main/mcpServers/voice-conversion",
  "@main/mcpServers/voice-library",
  "@main/mcpServers/workspaceMemory",
  "@main/mcpServers/zhipu-search"
]
class StubServer {
  mcpServer = { mock: true }
  createMcpServer() { return this.mcpServer }
}
beforeAll(() => {
  for (const name of stubbedModules) vi.doMock(name, () => ({ default: StubServer }))
})

describe('Douyin shop runtime registration', () => {
  it('mounts and allows the new SDK server beside scrapt in agent sessions', async () => {
    const { mountRuntimeMcpServers } = await import('../../services/agents/services/claudecode/tools/registry')
    const options: any = {}
    const autoAllowTools = new Set<string>()
    const result = await mountRuntimeMcpServers({
      options, session: { id: 'session', agent_id: 'agent', mcps: [] } as any,
      apiConfig: { host: '127.0.0.1', port: 23333, apiKey: 'local-key' },
      cwd: '/tmp/mock-workspace', autoAllowTools, autonomousEnabled: false, isAssistant: false,
      imageGenerateServer: {} as any, videoGenerateServer: {} as any,
      getOrCreateBrowserServer: async () => new StubServer() as any,
      resolveSourceChannel: async () => undefined
    })
    expect(options.mcpServers['douyin-shop-search']).toMatchObject({ type: 'sdk', name: 'douyin-shop-search', timeout: 180 })
    expect(options.mcpServers.scrapt).toBeDefined()
    expect(options.mcpServers.blender).toBeUndefined()
    expect(options.mcpServers['blender-local']).toMatchObject({
      type: 'sdk', name: 'blender-local', longRunning: true, timeout: 3660
    })
    expect(result.mountedRuntimeMcpServers).toContain('blender-local')
    expect(autoAllowTools.has('mcp__vectcut__blender-local__blender_status')).toBe(true)
    expect(autoAllowTools.has('mcp__vectcut__blender-local__blender_render')).toBe(false)
    expect(autoAllowTools.has('mcp__vectcut__blender-local__*')).toBe(false)
    expect(result.mountedRuntimeMcpServers).not.toContain('blender')
    expect([...autoAllowTools].some((name) => name.startsWith('mcp__vectcut__blender__'))).toBe(false)
    expect(result.mountedRuntimeMcpServers).toContain('douyin-shop-search')
    expect(autoAllowTools.has('mcp__vectcut__douyin-shop-search__*')).toBe(true)
    const server = options.mcpServers['douyin-shop-search'].instance
    const tools = await server.server._requestHandlers.get('tools/list')({ method: 'tools/list' }, {})
    expect(tools.tools).toHaveLength(40)
    expect(mocks.fetch).not.toHaveBeenCalled()
    await server.close()
  })

  it('adds the same real server to the local aggregate catalog', async () => {
    const { initializeLocalAggregateMcpService } = await import('../../services/LocalAggregateMcpService')
    await initializeLocalAggregateMcpService()
    const entries = mocks.entries.mock.calls[0][0]
    const entry = entries.find((entry: any) => entry.serverId === 'douyin-shop-search')
    expect(entry.serverName).toBe('douyin-shop-search')
    expect(entries.some((item: any) => item.serverId === 'blender' || item.serverName === 'blender')).toBe(false)
    expect(entries.some((item: any) => item.serverId === 'blender-local')).toBe(false)
    expect(entries.some((entry: any) => entry.serverId === 'scrapt')).toBe(true)
    const server = entry.createInstance()
    const tools = await server.server._requestHandlers.get('tools/list')({ method: 'tools/list' }, {})
    expect(tools.tools.map((tool: any) => tool.name)).toContain('search_products')
    expect(mocks.fetch).not.toHaveBeenCalled()
    await server.close()
  })
})
