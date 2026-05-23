import { beforeEach, describe, expect, it, vi } from 'vitest'
import { shell } from 'electron'
import SystemServer from '../system'

type SystemServerInstance = InstanceType<typeof SystemServer>

function createServer() {
  return new SystemServer()
}

async function callTool(server: SystemServerInstance, args: Record<string, unknown>) {
  const handlers = (server.mcpServer.server as any)._requestHandlers
  const callToolHandler = handlers?.get('tools/call')
  if (!callToolHandler) {
    throw new Error('No tools/call handler registered')
  }
  return callToolHandler({ method: 'tools/call', params: { name: 'open_deeplink', arguments: args } }, {})
}

async function listTools(server: SystemServerInstance) {
  const handlers = (server.mcpServer.server as any)._requestHandlers
  const listHandler = handlers?.get('tools/list')
  if (!listHandler) {
    throw new Error('No tools/list handler registered')
  }
  return listHandler({ method: 'tools/list', params: {} }, {})
}

describe('SystemServer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(shell.openExternal).mockResolvedValue(undefined)
  })

  it('should expose only the open_deeplink tool', async () => {
    const server = createServer()
    const result = await listTools(server)

    expect(result.tools).toHaveLength(1)
    expect(result.tools[0].name).toBe('open_deeplink')
  })

  it('should open a trusted vectcut download deeplink', async () => {
    const server = createServer()
    const deeplink = 'vectcut://download?draft_id=dfd_cat_123'
    const result = await callTool(server, { url: deeplink })

    expect(shell.openExternal).toHaveBeenCalledWith(deeplink)
    expect(result.isError).not.toBe(true)
    expect(result.content[0].text).toContain('VectCut deeplink opened')
  })

  it('should block untrusted deeplink routes', async () => {
    const server = createServer()
    const result = await callTool(server, { url: 'vectcut://providers?foo=bar' })

    expect(shell.openExternal).not.toHaveBeenCalled()
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Blocked untrusted deeplink')
  })
})
