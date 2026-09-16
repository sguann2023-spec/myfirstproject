import { loggerService } from '@logger'
import { windowService } from '@main/services/WindowService'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'

const logger = loggerService.withContext('MCPServer:DraftDownload')

const DOWNLOAD_DRAFT_TOOL: Tool = {
  name: 'download_draft',
  description:
    'Queue one or more VectCut drafts for download in the desktop app. Use this when the user asks to download drafts locally.',
  inputSchema: {
    type: 'object',
    properties: {
      draftId: {
        type: 'string',
        description: 'Single draft ID to download.'
      },
      draftName: {
        type: 'string',
        description: 'Optional draft name for a single draft.'
      },
      cover: {
        type: 'string',
        description: 'Optional cover URL for a single draft.'
      },
      drafts: {
        type: 'array',
        description: 'Optional batch of drafts to download.',
        items: {
          type: 'object',
          properties: {
            draftId: {
              type: 'string',
              description: 'Draft ID.'
            },
            draftName: {
              type: 'string',
              description: 'Optional draft name.'
            },
            cover: {
              type: 'string',
              description: 'Optional cover URL.'
            }
          },
          required: ['draftId']
        }
      }
    }
  }
}

const EXPORT_DRAFT_TOOL: Tool = {
  name: 'export_draft',
  description:
    'Queue one or more VectCut drafts for export in the desktop app. Use this when the user asks to export drafts locally.',
  inputSchema: DOWNLOAD_DRAFT_TOOL.inputSchema
}

type DraftDownloadItem = {
  draft_id: string
  draft_name?: string
  cover?: string
  createdAt: number
}

class DraftDownloadServer {
  public mcpServer: McpServer

  constructor() {
    this.mcpServer = new McpServer(
      {
        name: 'draft-download',
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
      tools: [DOWNLOAD_DRAFT_TOOL, EXPORT_DRAFT_TOOL]
    }))

    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name
      const args = request.params.arguments ?? {}

      try {
        switch (toolName) {
          case 'download_draft':
            return await this.processDraftAction('download_draft', args as Record<string, unknown>)
          case 'export_draft':
            return await this.processDraftAction('export_draft', args as Record<string, unknown>)
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

  private normalizeDraft(input: Record<string, unknown>, toolName: 'download_draft' | 'export_draft', index?: number): DraftDownloadItem {
    const draftIdRaw = typeof input.draftId === 'string' ? input.draftId : input.draft_id
    const draftNameRaw = typeof input.draftName === 'string' ? input.draftName : input.draft_name
    const coverRaw = typeof input.cover === 'string' ? input.cover : undefined
    const createdAtRaw = typeof input.createdAt === 'number' ? input.createdAt : input.created_at

    const draft_id = typeof draftIdRaw === 'string' ? draftIdRaw.trim() : ''
    if (!draft_id) {
      const suffix = typeof index === 'number' ? ` at drafts[${index}]` : ''
      throw new McpError(ErrorCode.InvalidParams, `'draftId' is required for ${toolName}${suffix}`)
    }

    const draft_name = typeof draftNameRaw === 'string' && draftNameRaw.trim() ? draftNameRaw.trim() : draft_id
    const cover = typeof coverRaw === 'string' && coverRaw.trim() ? coverRaw.trim() : undefined
    const createdAt =
      typeof createdAtRaw === 'number' && Number.isFinite(createdAtRaw) ? Math.floor(createdAtRaw) : Date.now()

    return {
      draft_id,
      draft_name,
      cover,
      createdAt
    }
  }

  private normalizeDrafts(args: Record<string, unknown>, toolName: 'download_draft' | 'export_draft'): DraftDownloadItem[] {
    if (Array.isArray(args.drafts) && args.drafts.length > 0) {
      return args.drafts.map((item, index) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          throw new McpError(ErrorCode.InvalidParams, `Each item in 'drafts' must be an object. Invalid entry at index ${index}`)
        }
        return this.normalizeDraft(item as Record<string, unknown>, toolName, index)
      })
    }

    return [this.normalizeDraft(args, toolName)]
  }

  private async processDraftAction(toolName: 'download_draft' | 'export_draft', args: Record<string, unknown>) {
    const drafts = this.normalizeDrafts(args, toolName)
    const mainWindow = windowService.getMainWindow()

    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error(`Main window is unavailable, cannot enqueue draft ${toolName === 'export_draft' ? 'export' : 'download'}`)
    }

    mainWindow.webContents.send('mcp-download-draft-enqueue', { drafts })

    logger.info('Queued drafts for local draft action via MCP tool', {
      action: toolName,
      count: drafts.length,
      draftIds: drafts.map((item) => item.draft_id)
    })

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              provider: 'vectcut',
              action: toolName,
              accepted: drafts.length,
              drafts
            },
            null,
            2
          )
        }
      ]
    }
  }
}

export default DraftDownloadServer
