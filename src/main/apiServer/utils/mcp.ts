import { CacheService } from '@main/services/CacheService'
import mcpService from '@main/services/MCPService'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import type { ListToolsResult } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
import { buildMcpToolName } from '@shared/mcp'
import {
  DEFAULT_LOCAL_MCP_EXPOSURE_CONFIG,
  LOCAL_MCP_EXTERNAL_AGENT_IDS,
  type LocalMcpExposureConfig,
  type LocalMcpExternalAgentId,
  type MCPServer
} from '@types'

import { loggerService } from '../../services/LoggerService'
import { reduxService } from '../../services/ReduxService'

const logger = loggerService.withContext('MCPApiService')
const VECTCUT_EXTERNAL_MCP_PREFIX = 'mcp__vectcut__'

// Cache configuration
const MCP_SERVERS_CACHE_KEY = 'api-server:mcp-servers'
const MCP_SERVERS_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

type AggregateSdkBridge = {
  serverId: string
  client: Client
  close: () => Promise<void>
}

export type AggregateServerInstance = {
  connect: (transport: unknown) => Promise<void>
  close?: () => Promise<void>
}

export type AggregateServerEntry = {
  serverId: string
  serverName: string
  createInstance: () => AggregateServerInstance | Promise<AggregateServerInstance>
}
const aggregateServerEntries = new Map<string, AggregateServerEntry>()

export function setAggregateServerEntries(entries: AggregateServerEntry[]): void {
  aggregateServerEntries.clear()
  for (const entry of entries) {
    aggregateServerEntries.set(entry.serverId, entry)
  }
}

export function getAggregateServerEntries(): AggregateServerEntry[] {
  return Array.from(aggregateServerEntries.values())
}

async function createAggregateSdkBridge(entry: AggregateServerEntry): Promise<AggregateSdkBridge> {
  const client = new Client({ name: 'vectcut', version: 'aggregate-bridge' }, { capabilities: {} })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const serverInstance = await entry.createInstance()
  await serverInstance.connect(serverTransport)
  await client.connect(clientTransport)

  return {
    serverId: entry.serverId,
    client,
    async close() {
      await Promise.allSettled([
        client.close(),
        clientTransport.close(),
        serverTransport.close(),
        typeof serverInstance.close === 'function' ? serverInstance.close() : Promise.resolve()
      ])
    }
  }
}

async function handleListToolsRequest(request: any, extra: any): Promise<ListToolsResult> {
  logger.debug('Handling list tools request', { request: request, extra: extra })
  const serverId: string = request.params._meta.serverId
  const serverConfig = await getMcpServerConfigById(serverId)
  if (!serverConfig) {
    throw new Error(`Server not found: ${serverId}`)
  }
  const client = await mcpService.initClient(serverConfig)
  return client.listTools()
}

async function handleCallToolRequest(request: any, extra: any): Promise<any> {
  logger.debug('Handling call tool request', { request: request, extra: extra })
  const serverId: string = request.params._meta.serverId
  const serverConfig = await getMcpServerConfigById(serverId)
  if (!serverConfig) {
    throw new Error(`Server not found: ${serverId}`)
  }
  const client = await mcpService.initClient(serverConfig)
  return client.callTool(request.params)
}

async function getMcpServerConfigById(id: string): Promise<MCPServer | undefined> {
  const servers = await getMCPServersFromRedux()
  return servers.find((s) => s.id === id || s.name === id)
}

function normalizeLocalMcpExposureConfig(value: unknown): LocalMcpExposureConfig {
  const source =
    value && typeof value === 'object' && value !== null && 'agents' in value
      ? (value as LocalMcpExposureConfig)
      : DEFAULT_LOCAL_MCP_EXPOSURE_CONFIG

  const agents = LOCAL_MCP_EXTERNAL_AGENT_IDS.reduce(
    (acc, agentId) => {
      const rawAgent = source.agents?.[agentId]
      acc[agentId] = {
        enabled: Boolean(rawAgent?.enabled),
        serverIds: Array.from(new Set(Array.isArray(rawAgent?.serverIds) ? rawAgent.serverIds.filter(Boolean) : []))
      }
      return acc
    },
    {} as LocalMcpExposureConfig['agents']
  )

  return { agents }
}

/**
 * Get servers directly from Redux store
 */
export async function getMCPServersFromRedux(): Promise<MCPServer[]> {
  try {
    logger.debug('Getting servers from Redux store')

    // Try to get from cache first (faster)
    const cachedServers = CacheService.get<MCPServer[]>(MCP_SERVERS_CACHE_KEY)
    if (cachedServers) {
      logger.debug('MCP servers resolved from cache', { count: cachedServers.length })
      return cachedServers
    }

    // If cache is not available, get fresh data from Redux
    const servers = await reduxService.select<MCPServer[]>('state.mcp.servers')
    const serverList = servers || []

    // Cache the results
    CacheService.set(MCP_SERVERS_CACHE_KEY, serverList, MCP_SERVERS_CACHE_TTL)

    logger.debug('Fetched servers from Redux store', { count: serverList.length })
    return serverList
  } catch (error: any) {
    logger.error('Failed to get servers from Redux', { error })
    return []
  }
}

export async function getLocalMcpExposureConfigFromRedux(): Promise<LocalMcpExposureConfig> {
  try {
    logger.debug('Getting local MCP exposure config from Redux store')
    const settings = await reduxService.select<any>('state.settings')
    return normalizeLocalMcpExposureConfig(settings?.localMcpExposure)
  } catch (error: any) {
    logger.error('Failed to get local MCP exposure config from Redux', { error })
    return DEFAULT_LOCAL_MCP_EXPOSURE_CONFIG
  }
}

export async function getExposedMcpServerForAgent(
  agentId: string,
  serverId: string
): Promise<{ server: MCPServer | null; exposure: LocalMcpExposureConfig['agents'][LocalMcpExternalAgentId] | null }> {
  const exposureConfig = await getLocalMcpExposureConfigFromRedux()
  if (!LOCAL_MCP_EXTERNAL_AGENT_IDS.includes(agentId as LocalMcpExternalAgentId)) {
    return { server: null, exposure: null }
  }

  const exposure = exposureConfig.agents[agentId as LocalMcpExternalAgentId]
  if (!exposure?.enabled || !exposure.serverIds.includes(serverId)) {
    return { server: null, exposure }
  }

  const servers = await getMCPServersFromRedux()
  const server = servers.find((s) => s.id === serverId && s.isActive)
  return { server: server ?? null, exposure }
}

export async function getExposedMcpServersForAgent(
  agentId: string
): Promise<{ servers: MCPServer[]; exposure: LocalMcpExposureConfig['agents'][LocalMcpExternalAgentId] | null }> {
  const exposureConfig = await getLocalMcpExposureConfigFromRedux()
  if (!LOCAL_MCP_EXTERNAL_AGENT_IDS.includes(agentId as LocalMcpExternalAgentId)) {
    return { servers: [], exposure: null }
  }

  const exposure = exposureConfig.agents[agentId as LocalMcpExternalAgentId]
  if (!exposure?.enabled || !Array.isArray(exposure.serverIds) || exposure.serverIds.length === 0) {
    return { servers: [], exposure }
  }

  const servers = await getMCPServersFromRedux()
  const exposedServers = servers.filter((server) => server.isActive && exposure.serverIds.includes(server.id))
  return { servers: exposedServers, exposure }
}

export async function createExposedAggregateMcpServerForAgent(_agentId: LocalMcpExternalAgentId): Promise<Server> {
  const server = new Server({ name: 'vectcut', version: '0.1.0' }, { capabilities: { tools: {} } })
  const toolMappings = new Map<string, { serverId: string; toolName: string; bridge: AggregateSdkBridge }>()
  const existingBridgedNames = new Set<string>()
  let bridges: AggregateSdkBridge[] = []

  const listExposedTools = async () => {
    await Promise.allSettled(bridges.map((bridge) => bridge.close()))
    bridges = []

    const entries = getAggregateServerEntries()
    if (entries.length === 0) {
      logger.warn('Aggregate MCP server entries are not initialized yet')
    }
    const tools: ListToolsResult['tools'] = []
    toolMappings.clear()
    existingBridgedNames.clear()

    for (const entry of entries) {
      try {
        const bridge = await createAggregateSdkBridge(entry)
        bridges.push(bridge)
        const result = await bridge.client.listTools()
        for (const tool of Array.isArray(result?.tools) ? result.tools : []) {
          const bridgedName = buildMcpToolName('vectcut', `${entry.serverId}__${tool.name}`, {
            prefix: 'mcp__',
            delimiter: '__',
            maxLength: 128,
            existingNames: existingBridgedNames
          })
          toolMappings.set(bridgedName, {
            serverId: entry.serverId,
            toolName: tool.name,
            bridge
          })
          tools.push({
            ...tool,
            name: bridgedName,
            description: tool.description
              ? `[${VECTCUT_EXTERNAL_MCP_PREFIX}${entry.serverId}__${tool.name}] [${entry.serverName}] ${tool.description}`
              : `[${VECTCUT_EXTERNAL_MCP_PREFIX}${entry.serverId}__${tool.name}] [${entry.serverName}]`
          })
        }
      } catch (error) {
        logger.warn('Failed to mount aggregate MCP server entry', {
          serverId: entry.serverId,
          serverName: entry.serverName,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    return tools
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: await listExposedTools()
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const requestedToolName = String(request.params?.name || '').trim()
    if (!requestedToolName) {
      throw new McpError(ErrorCode.InvalidRequest, 'Missing tool name')
    }

    let target = toolMappings.get(requestedToolName)
    if (!target) {
      await listExposedTools()
      target = toolMappings.get(requestedToolName)
    }

    if (!target) {
      throw new McpError(ErrorCode.MethodNotFound, `Tool not found: ${requestedToolName}`)
    }

    return target.bridge.client.callTool({
      ...request.params,
      name: target.toolName
    })
  })

  return server
}

/**
 * Creates a fresh MCP Server instance for a given server ID.
 *
 * A new Server is created for each transport session because the MCP SDK's
 * Protocol.connect() throws "Already connected" if the Server is already
 * bound to a transport. Since the Claude Agent SDK spawns a new CLI process
 * per query (including resumes), each process establishes a new HTTP
 * transport, so the proxy must provide a fresh Server instance every time.
 */
export async function createMcpServerForTransport(id: string): Promise<Server> {
  const servers = await getMCPServersFromRedux()
  const mcpServer = servers.find((s) => s.id === id || s.name === id)
  if (!mcpServer) {
    throw new Error(`Server not found: ${id}`)
  }

  const server = new Server({ name: mcpServer.name, version: '0.1.0' }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, handleListToolsRequest)
  server.setRequestHandler(CallToolRequestSchema, handleCallToolRequest)
  return server
}
