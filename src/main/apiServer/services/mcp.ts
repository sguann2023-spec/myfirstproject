import mcpService from '@main/services/MCPService'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import type { JSONRPCMessage, MessageExtraInfo } from '@modelcontextprotocol/sdk/types.js'
import { JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js'
import type { MCPServer } from '@types'
import { randomUUID } from 'crypto'
import { EventEmitter } from 'events'
import type { Request, Response } from 'express'
import type { IncomingMessage, ServerResponse } from 'http'

import { loggerService } from '../../services/LoggerService'
import { createMcpServerForTransport, getMCPServersFromRedux } from '../utils/mcp'

const logger = loggerService.withContext('MCPApiService')
const transports: Record<string, StreamableHTTPServerTransport> = {}

interface McpServerDTO {
  id: MCPServer['id']
  name: MCPServer['name']
  type: MCPServer['type']
  description: MCPServer['description']
  url: string
}

interface McpServersResp {
  servers: Record<string, McpServerDTO>
}

/**
 * MCPApiService - API layer for MCP server management
 *
 * This service provides a REST API interface for MCP servers while integrating
 * with the existing application architecture:
 *
 * 1. Uses ReduxService to access the renderer's Redux store directly
 * 2. Syncs changes back to the renderer via Redux actions
 * 3. Leverages existing MCPService for actual server connections
 * 4. Provides session management for API clients
 */
class MCPApiService extends EventEmitter {
  private transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID()
  })

  constructor() {
    super()
    this.initMcpServer()
    logger.debug('MCPApiService initialized')
  }

  private initMcpServer() {
    this.transport.onmessage = this.onMessage
  }

  // get all activated servers
  async getAllServers(req: Request): Promise<McpServersResp> {
    try {
      const servers = await getMCPServersFromRedux()
      logger.debug('Returning servers from Redux', { count: servers.length })
      const resp: McpServersResp = {
        servers: {}
      }
      for (const server of servers) {
        if (server.isActive) {
          resp.servers[server.id] = {
            id: server.id,
            name: server.name,
            type: 'streamableHttp',
            description: server.description,
            url: `${req.protocol}://${req.host}/v1/mcps/${server.id}/mcp`
          }
        }
      }
      return resp
    } catch (error: any) {
      logger.error('Failed to get all servers', { error })
      throw new Error('Failed to retrieve servers')
    }
  }

  // get server by id
  async getServerById(id: string): Promise<MCPServer | null> {
    try {
      logger.debug('getServerById called', { id })
      const servers = await getMCPServersFromRedux()
      const server = servers.find((s) => s.id === id)
      if (!server) {
        logger.warn('Server not found', { id })
        return null
      }
      logger.debug('Returning server', { id })
      return server
    } catch (error: any) {
      logger.error('Failed to get server', { id, error })
      throw new Error('Failed to retrieve server')
    }
  }

  async getServerInfo(id: string): Promise<any> {
    try {
      const server = await this.getServerById(id)
      if (!server) {
        logger.warn('Server not found while fetching info', { id })
        return null
      }

      const client = await mcpService.initClient(server)
      const tools = await client.listTools()
      return {
        id: server.id,
        name: server.name,
        type: server.type,
        description: server.description,
        tools: tools.tools
      }
    } catch (error: any) {
      logger.error('Failed to get server info', { id, error })
      throw new Error('Failed to retrieve server info')
    }
  }

  async handleRequest(req: Request, res: Response, server: MCPServer) {
    return this.handleTransportRequest(req, res, `server:${server.id}`, async () => {
      const mcpServer = await createMcpServerForTransport(server.id)
      return {
        serverId: server.id,
        mcpServer
      }
    }, (messages) => {
      for (const message of messages) {
        if (message && typeof message === 'object' && 'method' in message && 'params' in message) {
          const requestMessage = message as any
          if (!requestMessage.params) {
            requestMessage.params = {}
          }
          if (!requestMessage.params._meta) {
            requestMessage.params._meta = {}
          }
          requestMessage.params._meta.serverId = server.id
        }
      }
    })
  }

  async handleTransportRequest(
    req: Request,
    res: Response,
    transportKeyPrefix: string,
    createServer: () => Promise<{ serverId: string; mcpServer: Server }>,
    decorateMessages?: (messages: JSONRPCMessage[]) => void
  ) {
    const sessionId = req.headers['mcp-session-id'] as string | undefined
    logger.debug('Handling MCP request', { sessionId, transportKeyPrefix })
    let transport: StreamableHTTPServerTransport
    const transportKey = sessionId ? `${transportKeyPrefix}:${sessionId}` : ''
    if (transportKey && transports[transportKey]) {
      transport = transports[transportKey]
    } else {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId) => {
          transports[`${transportKeyPrefix}:${newSessionId}`] = transport
        }
      })

      transport.onclose = () => {
        logger.info('Transport closed', { sessionId, transportKeyPrefix })
        if (transport.sessionId) {
          delete transports[`${transportKeyPrefix}:${transport.sessionId}`]
        }
      }
      const { mcpServer, serverId } = await createServer()
      await mcpServer.connect(transport)
      logger.debug('Connected MCP transport', { transportKeyPrefix, serverId, sessionId: transport.sessionId })
    }

    if (req.method === 'POST') {
      const jsonpayload = req.body
      const messages: JSONRPCMessage[] = []

      if (Array.isArray(jsonpayload)) {
        for (const payload of jsonpayload) {
          const message = JSONRPCMessageSchema.parse(payload)
          messages.push(message)
        }
      } else {
        const message = JSONRPCMessageSchema.parse(jsonpayload)
        messages.push(message)
      }

      decorateMessages?.(messages)

      logger.debug('Dispatching MCP POST request', {
        sessionId: transport.sessionId ?? sessionId,
        messageCount: messages.length
      })
      await transport.handleRequest(req as IncomingMessage, res as ServerResponse, messages)
      return
    }

    logger.debug('Dispatching MCP request without JSON body', {
      method: req.method,
      sessionId: transport.sessionId ?? sessionId,
      transportKeyPrefix
    })
    await transport.handleRequest(req as IncomingMessage, res as ServerResponse)
  }

  private onMessage(message: JSONRPCMessage, extra?: MessageExtraInfo) {
    logger.debug('Received MCP message', { message, extra })
    // Handle message here
  }
}

export const mcpApiService = new MCPApiService()
