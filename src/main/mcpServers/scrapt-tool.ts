import { agentRuntimeAuthService } from '@main/services/agents/services/AgentRuntimeAuthService'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js'
import { net } from 'electron'

import catalog from './scrapt-catalog.json'

type Schema = Record<string, any>
type Entry = {
  tool: Tool
  platform: string
  route: {
    path: string
    method: string
    parameters: { name: string; location: string; schema: Schema; style?: string; explode?: boolean }[]
    contentType?: string
    bodySchema?: Schema
  }
}

const ENTRIES = catalog.entries as unknown as Entry[]
const TOOL_MAP = new Map(ENTRIES.map((entry) => [entry.tool.name, entry]))
const PROXY_BASE_URL = 'https://open.vectcut.com/scrapt/proxy'
const REQUEST_TIMEOUT_MS = 120_000
const validator = new AjvJsonSchemaValidator()
const validators = new Map<string, ReturnType<typeof validator.getValidator>>()
export const SCRAPT_TOOLS: Tool[] = ENTRIES.map((entry) => {
  const tool = structuredClone(entry.tool)
  // Hosted MCP schemas omit useful parameter descriptions from the REST contract.
  for (const parameter of entry.route.parameters) {
    const property = tool.inputSchema.properties?.[parameter.name]
    if (!isRecord(property)) continue
    if (parameter.schema.description) property.description = parameter.schema.description
    if (entry.tool.name === 'tiktok_web_fetch_search_video' && parameter.name === 'count') {
      property.description = '每页数量，官方建议保持默认值 20。Number per page; the provider recommends keeping the default of 20.'
    }
  }
  return tool
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validateArgs(entry: Entry, args: Record<string, unknown>) {
  const properties = entry.tool.inputSchema.properties || {}
  for (const key of Object.keys(args)) {
    if (!(key in properties)) throw new McpError(ErrorCode.InvalidParams, `Unknown parameter: ${key}`)
  }
  // Compile lazily: listing a thousand tools should not compile a thousand validators.
  let validate = validators.get(entry.tool.name)
  if (!validate) {
    validate = validator.getValidator(entry.tool.inputSchema)
    validators.set(entry.tool.name, validate)
  }
  const result = validate(args)
  if (!result.valid) throw new McpError(ErrorCode.InvalidParams, result.errorMessage || 'Invalid tool parameters')
}

export function buildScraptRequest(name: string, args: Record<string, unknown>) {
  const entry = TOOL_MAP.get(name)
  if (!entry) throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`)
  validateArgs(entry, args)
  const url = new URL(PROXY_BASE_URL + entry.route.path)
  const queryNames = new Set(entry.route.parameters.map((parameter) => parameter.name))
  for (const parameter of entry.route.parameters) {
    const value = args[parameter.name]
    if (value === undefined || value === null) continue
    if (parameter.location !== 'query') throw new Error('Unsupported catalog parameter location')
    if (Array.isArray(value)) {
      if (parameter.explode === false) {
        url.searchParams.append(parameter.name, value.join(','))
      } else {
        for (const item of value) url.searchParams.append(parameter.name, String(item))
      }
    } else if (isRecord(value)) {
      url.searchParams.append(parameter.name, JSON.stringify(value))
    } else {
      url.searchParams.append(parameter.name, String(value))
    }
  }
  const body = entry.route.bodySchema
    ? JSON.stringify(Object.fromEntries(Object.entries(args).filter(([key]) => !queryNames.has(key))))
    : undefined
  return {
    url: url.toString(), method: entry.route.method,
    body, contentType: entry.route.contentType
  }
}

class ScraptToolServer {
  public readonly mcpServer: McpServer

  constructor() {
    this.mcpServer = new McpServer({ name: 'scrapt', version: '2.0.0' }, { capabilities: { tools: {} } })
    this.mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: structuredClone(SCRAPT_TOOLS)
    }))
    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const built = buildScraptRequest(request.params.name, request.params.arguments ?? {})
      try {
        const signal = AbortSignal.any([extra.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
        if (signal.aborted) throw new Error('Request cancelled')
        const fetchWithToken = (token: string) => net.fetch(built.url, {
          method: built.method,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            'X-Client-Type': 'desktop',
            ...(built.contentType ? { 'Content-Type': built.contentType } : {})
          },
          ...(built.body !== undefined ? { body: built.body } : {}),
          signal,
          redirect: 'error'
        })
        let token = await agentRuntimeAuthService.ensureValidAccessToken()
        if (signal.aborted) throw new Error('Request cancelled')
        let response = await fetchWithToken(token)
        // Only local pre-execution auth rejection is safe to retry.
        const authError = response.status === 401
          ? await response.clone().json().catch(() => null) : null
        if (isRecord(authError) && authError.errorcode === 'UNAUTHORIZED') {
          await response.body?.cancel()
          token = await agentRuntimeAuthService.ensureValidAccessToken(true)
          if (signal.aborted) throw new Error('Request cancelled')
          response = await fetchWithToken(token)
        }
        const text = await response.text()
        let billing: Record<string, unknown> | undefined
        try {
          const metadata: unknown = JSON.parse(response.headers.get('X-VectCut-Billing') || 'null')
          if (isRecord(metadata)) billing = metadata
        } catch {
          // Older proxy deployments do not provide billing metadata.
        }
        let isError = !response.ok
        try {
          const result: unknown = JSON.parse(text)
          if (!billing && isRecord(result) && isRecord(result.billing)) {
            billing = result.billing
          }
          if (isRecord(result) && (result.success === false || ('code' in result && result.code !== 200))) {
            isError = true
          }
        } catch {
          // Non-JSON responses are returned as received.
        }
        return {
          content: [{ type: 'text' as const, text }],
          ...(billing ? { structuredContent: { billing } } : {}),
          ...(isError ? { isError: true } : {})
        }
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: extra.signal.aborted ? 'Media request cancelled' :
              error instanceof Error && error.message.startsWith('No refresh token')
                ? 'Please sign in before calling media tools'
                : 'Media request failed. Check your login and network; the request was not automatically retried.'
          }],
          isError: true
        }
      }
    })
  }
}

export default ScraptToolServer
