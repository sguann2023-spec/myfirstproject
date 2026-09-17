import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockWebContentsSend = vi.fn()

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }))
  }
}))

vi.mock('@main/services/WindowService', () => ({
  windowService: {
    getMainWindow: vi.fn(() => ({
      isDestroyed: () => false,
      webContents: {
        send: mockWebContentsSend
      }
    }))
  }
}))

import DraftDownloadServer from '../draft-download'

type DraftDownloadServerInstance = InstanceType<typeof DraftDownloadServer>

function createServer() {
  return new DraftDownloadServer()
}

async function callTool(server: DraftDownloadServerInstance, toolName: string, args: Record<string, unknown>) {
  const handlers = (server.mcpServer.server as any)._requestHandlers
  const callToolHandler = handlers?.get('tools/call')
  if (!callToolHandler) {
    throw new Error('No tools/call handler registered')
  }
  return callToolHandler({ method: 'tools/call', params: { name: toolName, arguments: args } }, {})
}

async function listTools(server: DraftDownloadServerInstance) {
  const handlers = (server.mcpServer.server as any)._requestHandlers
  const listHandler = handlers?.get('tools/list')
  if (!listHandler) {
    throw new Error('No tools/list handler registered')
  }
  return listHandler({ method: 'tools/list', params: {} }, {})
}

describe('DraftDownloadServer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should expose download and export tools', async () => {
    const server = createServer()
    const result = await listTools(server)

    expect(result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      'download_draft',
      'export_draft'
    ])
  })

  it('should accept snake_case draft_id for download', async () => {
    const server = createServer()
    const result = await callTool(server, 'download_draft', {
      draft_id: 'dfd_test_1'
    })

    expect(mockWebContentsSend).toHaveBeenCalledWith('mcp-download-draft-enqueue', {
      drafts: [
        {
          draft_id: 'dfd_test_1',
          draft_name: 'dfd_test_1',
          cover: undefined,
          createdAt: expect.any(Number)
        }
      ]
    })

    expect(JSON.parse(result.content[0].text)).toEqual({
      provider: 'vectcut',
      action: 'download_draft',
      accepted: 1,
      drafts: [
        {
          draft_id: 'dfd_test_1',
          draft_name: 'dfd_test_1',
          createdAt: expect.any(Number)
        }
      ]
    })
  })

  it('should keep draft name as display metadata instead of identifier', async () => {
    const server = createServer()
    const result = await callTool(server, 'download_draft', {
      draftId: 'dfd_test_2',
      draftName: '展示名称'
    })

    expect(mockWebContentsSend).toHaveBeenCalledWith('mcp-download-draft-enqueue', {
      drafts: [
        {
          draft_id: 'dfd_test_2',
          draft_name: '展示名称',
          cover: undefined,
          createdAt: expect.any(Number)
        }
      ]
    })

    expect(JSON.parse(result.content[0].text)).toEqual({
      provider: 'vectcut',
      action: 'download_draft',
      accepted: 1,
      drafts: [
        {
          draft_id: 'dfd_test_2',
          draft_name: '展示名称',
          createdAt: expect.any(Number)
        }
      ]
    })
  })
})
