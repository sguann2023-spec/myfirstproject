import type { MCPServer, MCPTool } from '@types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/apiServer/utils/mcp', () => ({
  getMCPServersFromRedux: vi.fn()
}))

vi.mock('@main/services/WindowService', () => ({
  windowService: {
    getMainWindow: vi.fn(() => null)
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    }))
  }
}))

import { getMCPServersFromRedux } from '@main/apiServer/utils/mcp'
import mcpService from '../MCPService'

const baseInputSchema: { type: 'object'; properties: Record<string, unknown>; required: string[] } = {
  type: 'object',
  properties: {},
  required: []
}

const createTool = (overrides: Partial<MCPTool>): MCPTool => ({
  id: `${overrides.serverId}__${overrides.name}`,
  name: overrides.name ?? 'tool',
  description: overrides.description,
  serverId: overrides.serverId ?? 'server',
  serverName: overrides.serverName ?? 'server',
  inputSchema: baseInputSchema,
  type: 'mcp',
  ...overrides
})

describe('MCPService.listAllActiveServerTools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('filters disabled tools per server', async () => {
    const servers: MCPServer[] = [
      {
        id: 'alpha',
        name: 'Alpha',
        isActive: true,
        disabledTools: ['disabled_tool']
      },
      {
        id: 'beta',
        name: 'Beta',
        isActive: true
      }
    ]

    vi.mocked(getMCPServersFromRedux).mockResolvedValue(servers)

    const listToolsSpy = vi.spyOn(mcpService as any, 'listToolsImpl').mockImplementation(async (server: any) => {
      if (server.id === 'alpha') {
        return [
          createTool({ name: 'enabled_tool', serverId: server.id, serverName: server.name }),
          createTool({ name: 'disabled_tool', serverId: server.id, serverName: server.name })
        ]
      }
      return [createTool({ name: 'beta_tool', serverId: server.id, serverName: server.name })]
    })

    const tools = await mcpService.listAllActiveServerTools()

    expect(listToolsSpy).toHaveBeenCalledTimes(2)
    expect(tools.map((tool) => tool.name)).toEqual(['enabled_tool', 'beta_tool'])
  })
})

describe('MCPService.callTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('coerces stringified structured fields according to tool input schema before invocation', async () => {
    const server = {
      id: 'video',
      name: 'video',
      isActive: true
    } as MCPServer

    const clientCallTool = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] })
    vi.spyOn(mcpService as any, 'initClient').mockResolvedValue({
      callTool: clientCallTool
    })
    vi.spyOn(mcpService as any, 'listToolsImpl').mockResolvedValue([
      createTool({
        serverId: 'video',
        serverName: 'video',
        name: 'generate_video',
        inputSchema: {
          type: 'object',
          properties: {
            model: { type: 'string' },
            content: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string' },
                  text: { type: 'string' },
                  role: { type: 'string' },
                  image_url: {
                    type: 'object',
                    properties: {
                      url: { type: 'string' }
                    }
                  }
                }
              }
            }
          },
          required: ['content']
        }
      })
    ])

    await mcpService.callTool(null as unknown as Electron.IpcMainInvokeEvent, {
      server,
      name: 'generate_video',
      args: {
        model: 'seedance-2.5',
        content:
          '[{"type":"image_url","image_url":{"url":"file:///tmp/ref.jpg"},"role":"reference_image"},{"type":"text","text":"hello"}]'
      }
    })

    expect(clientCallTool).toHaveBeenCalledWith(
      {
        name: 'generate_video',
        arguments: {
          model: 'seedance-2.5',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: 'file:///tmp/ref.jpg'
              },
              role: 'reference_image'
            },
            {
              type: 'text',
              text: 'hello'
            }
          ]
        }
      },
      undefined,
      expect.objectContaining({
        timeout: 60000
      })
    )
  })
})
