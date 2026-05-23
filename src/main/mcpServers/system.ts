import { loggerService } from '@logger'
import { isSafeVectcutDeepLink } from '@main/services/security'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
import { shell } from 'electron'

const logger = loggerService.withContext('MCPServer:System')

const OPEN_DEEPLINK_TOOL: Tool = {
  name: 'open_deeplink',
  description:
    'Open a trusted VectCut deeplink at the host OS level. Only use this for vetted app deeplinks such as vectcut://download?... after you have already generated the URL.',
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'Trusted VectCut deeplink to open, e.g. vectcut://download?draft_id=dfd_cat_123'
      }
    },
    required: ['url']
  }
}

class SystemServer {
  public mcpServer: McpServer

  constructor() {
    this.mcpServer = new McpServer(
      {
        name: 'system',
        version: '1.0.0'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    )
    this.setupHandlers()
  }

  private setupHandlers() {
    this.mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [OPEN_DEEPLINK_TOOL]
    }))

    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name
      const args = request.params.arguments ?? {}

      try {
        switch (toolName) {
          case 'open_deeplink':
            return await this.openDeeplink(args as Record<string, unknown>)
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error(`Tool error: ${toolName}`, { error: message })
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          isError: true
        }
      }
    })
  }

  private async openDeeplink(args: Record<string, unknown>) {
    const url = typeof args.url === 'string' ? args.url.trim() : ''
    if (!url) {
      throw new McpError(ErrorCode.InvalidParams, "'url' is required for open_deeplink")
    }
    if (!isSafeVectcutDeepLink(url)) {
      throw new McpError(ErrorCode.InvalidParams, `Blocked untrusted deeplink: ${url}`)
    }

    await shell.openExternal(url)
    logger.info('Opened trusted VectCut deeplink via MCP tool', { url })

    return {
      content: [{ type: 'text' as const, text: `VectCut deeplink opened: ${url}` }]
    }
  }
}

export default SystemServer
