import type { Request, Response } from 'express'
import express from 'express'

import { loggerService } from '../../services/LoggerService'
import { mcpApiService } from '../services/mcp'
import { createExposedAggregateMcpServerForAgent, getExposedMcpServerForAgent, getExposedMcpServersForAgent } from '../utils/mcp'

const logger = loggerService.withContext('ApiServerMCPRoutes')

const router = express.Router()
const localOnlyRouter = express.Router()
const SINGLE_URL_AGENT_ID = 'codex_cli'

/**
 * @swagger
 * /v1/mcps:
 *   get:
 *     summary: List MCP servers
 *     description: Get a list of all configured Model Context Protocol servers
 *     tags: [MCP]
 *     responses:
 *       200:
 *         description: List of MCP servers
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/MCPServer'
 *       503:
 *         description: Service unavailable
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   $ref: '#/components/schemas/Error'
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    logger.debug('Listing MCP servers')
    const servers = await mcpApiService.getAllServers(req)
    return res.json({
      success: true,
      data: servers
    })
  } catch (error: any) {
    logger.error('Error fetching MCP servers', { error })
    return res.status(503).json({
      success: false,
      error: {
        message: `Failed to retrieve MCP servers: ${error.message}`,
        type: 'service_unavailable',
        code: 'servers_unavailable'
      }
    })
  }
})

router.get('/exposed/:agent_key/servers', async (req: Request, res: Response) => {
  const { agent_key: agentKey } = req.params
  const { servers, exposure } = await getExposedMcpServersForAgent(agentKey)
  if (!exposure?.enabled) {
    return res.status(404).json({
      success: false,
      error: {
        message: 'MCP servers not exposed to this agent',
        type: 'not_found',
        code: 'servers_not_exposed'
      }
    })
  }

  return res.json({
    success: true,
    data: {
      agentId: agentKey,
      servers: servers.map((server) => ({
        id: server.id,
        name: server.name
      }))
    }
  })
})

localOnlyRouter.all('/', async (req: Request, res: Response) => {
  return mcpApiService.handleTransportRequest(req, res, `aggregate:${SINGLE_URL_AGENT_ID}`, async () => {
    const mcpServer = await createExposedAggregateMcpServerForAgent(SINGLE_URL_AGENT_ID)
    return {
      serverId: SINGLE_URL_AGENT_ID,
      mcpServer
    }
  })
})

router.all('/exposed/:agent_key/:server_id/mcp', async (req: Request, res: Response) => {
  const { agent_key: agentKey, server_id: serverId } = req.params
  const { server } = await getExposedMcpServerForAgent(agentKey, serverId)
  if (!server) {
    logger.warn('Exposed MCP server not found or not allowed', { agentKey, serverId })
    return res.status(404).json({
      success: false,
      error: {
        message: 'MCP server not exposed to this agent',
        type: 'not_found',
        code: 'server_not_exposed'
      }
    })
  }
  return await mcpApiService.handleRequest(req, res, server)
})

/**
 * @swagger
 * /v1/mcps/{server_id}:
 *   get:
 *     summary: Get MCP server info
 *     description: Get detailed information about a specific MCP server
 *     tags: [MCP]
 *     parameters:
 *       - in: path
 *         name: server_id
 *         required: true
 *         schema:
 *           type: string
 *         description: MCP server ID
 *     responses:
 *       200:
 *         description: MCP server information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/MCPServer'
 *       404:
 *         description: MCP server not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   $ref: '#/components/schemas/Error'
 */
router.get('/:server_id', async (req: Request, res: Response) => {
  try {
    logger.debug('Get MCP server info request received', {
      serverId: req.params.server_id
    })
    const server = await mcpApiService.getServerInfo(req.params.server_id)
    if (!server) {
      logger.warn('MCP server not found', { serverId: req.params.server_id })
      return res.status(404).json({
        success: false,
        error: {
          message: 'MCP server not found',
          type: 'not_found',
          code: 'server_not_found'
        }
      })
    }
    return res.json({
      success: true,
      data: server
    })
  } catch (error: any) {
    logger.error('Error fetching MCP server info', { error, serverId: req.params.server_id })
    return res.status(503).json({
      success: false,
      error: {
        message: `Failed to retrieve MCP server info: ${error.message}`,
        type: 'service_unavailable',
        code: 'server_info_unavailable'
      }
    })
  }
})

/**
 * @swagger
 * /v1/mcps/{server_id}/mcp:
 *   post:
 *     summary: MCP protocol proxy
 *     description: Proxy endpoint for Model Context Protocol communication with a specific MCP server. Accepts all HTTP methods (GET, POST, DELETE, etc.).
 *     tags: [MCP]
 *     parameters:
 *       - in: path
 *         name: server_id
 *         required: true
 *         schema:
 *           type: string
 *         description: MCP server ID
 *     requestBody:
 *       description: MCP protocol request body (JSON-RPC format)
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: MCP protocol response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       404:
 *         description: MCP server not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   $ref: '#/components/schemas/Error'
 */
// Connect to MCP server
router.all('/:server_id/mcp', async (req: Request, res: Response) => {
  const server = await mcpApiService.getServerById(req.params.server_id)
  if (!server) {
    logger.warn('MCP server not found', { serverId: req.params.server_id })
    return res.status(404).json({
      success: false,
      error: {
        message: 'MCP server not found',
        type: 'not_found',
        code: 'server_not_found'
      }
    })
  }
  return await mcpApiService.handleRequest(req, res, server)
})

export { router as mcpRoutes }
export { localOnlyRouter as localMcpSingleUrlRoutes }
