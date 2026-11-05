import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CallToolRequestSchema, CallToolResultSchema, ListToolsRequestSchema, type Tool } from '@modelcontextprotocol/sdk/types.js'
import { net } from 'electron'
import Store from 'electron-store'

import { agentRuntimeAuthService } from '../services/agents/services/AgentRuntimeAuthService'
import { getStoredVectcutApiKey, requestWithVectcutAuth } from './vectcut-auth'

const PROTOCOL_VERSION = '2025-03-26'
const MAX_BYTES = 4 * 1024 * 1024

export function isMediaRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function mediaReference(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 4096) return undefined
  try {
    const url = new URL(value)
    if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) return value
  } catch { /* Invalid media reference. */ }
  return undefined
}

type ParameterSchema = {
  type: string; minimum?: number; maximum?: number; minLength?: number; maxLength?: number;
  default?: unknown; enum?: unknown[]; pattern?: string; const?: unknown
}

export type MediaProxyConfig = {
  name: string
  endpoint: string
  allowedPaths: readonly string[]
  tools: Tool[]
  upstreamTools: Readonly<Record<string, string>>
  projectResult: (data: unknown, toolName: string, args: Record<string, unknown>) => Record<string, unknown>
  timeoutMs?: number
  errorMessage?: string
}

async function readMessage(response: Response): Promise<unknown> {
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json') ||
    Number(response.headers.get('content-length')) > MAX_BYTES) {
    await response.body?.cancel()
    throw new Error('Invalid media endpoint response')
  }
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Missing media endpoint response')
  const chunks: Buffer[] = []
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_BYTES) { await reader.cancel(); throw new Error('Media response exceeds size limit') }
      chunks.push(Buffer.from(value))
    }
  } finally { reader.releaseLock() }
  return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'))
}

export default class StatelessMediaProxyServer {
  public readonly mcpServer: McpServer
  private readonly endpoint: URL
  private readonly store = new Store({ name: 'vectcut' })

  constructor(private readonly config: MediaProxyConfig) {
    this.endpoint = new URL(config.endpoint)
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(this.endpoint.hostname)
    if ((!local && this.endpoint.origin !== 'https://open.vectcut.com') || !['https:', 'http:'].includes(this.endpoint.protocol) ||
      this.endpoint.username || this.endpoint.password || this.endpoint.search || this.endpoint.hash ||
      !config.allowedPaths.includes(this.endpoint.pathname)) {
      throw new Error('Media search requires a trusted endpoint or a local development endpoint')
    }
    for (const tool of config.tools) {
      if (!Object.prototype.hasOwnProperty.call(config.upstreamTools, tool.name)) throw new Error('Missing media tool mapping')
    }
    this.mcpServer = new McpServer({ name: config.name, version: '1.0.0' }, { capabilities: { tools: {} } })
    this.mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: config.tools }))
    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const tool = config.tools.find((item) => item.name === request.params.name)
      const paid = tool?.annotations?.readOnlyHint === false
      try {
        if (!tool) throw new Error('Unknown media tool')
        const args = this.validateArgs(tool, request.params.arguments ?? {})
        const signal = AbortSignal.any([extra.signal, AbortSignal.timeout(config.timeoutMs ?? 65_000)])
        // These gateways are stateless. Do not share sessions, user data or expiring media URLs.
        const initialized = await this.rpc('initialize', {
          protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: config.name, version: '1.0.0' }
        }, 1, signal)
        if (!isMediaRecord(initialized) || initialized.protocolVersion !== PROTOCOL_VERSION) throw new Error('Unsupported media protocol')
        await this.rpc('notifications/initialized', {}, undefined, signal)
        const response = CallToolResultSchema.parse(await this.rpc('tools/call', {
          name: config.upstreamTools[tool.name], arguments: args
        }, 2, signal, paid))
        if (response.isError) throw new Error('Media operation failed')
        const text = response.content.find((item) => item.type === 'text')
        const data = response.structuredContent ?? (text?.type === 'text' ? JSON.parse(text.text) : undefined)
        if (!isMediaRecord(data) || data.error || data.success === false) throw new Error('Invalid media result')
        const result = { title: tool.title, ...config.projectResult(data, tool.name, args) }
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: result }
      } catch {
        // Provider diagnostics, credentials and internal payloads must never reach the Agent.
        const message = config.errorMessage ?? 'Media search is unavailable. Check parameters, login and service deployment, or try again later.'
        return { content: [{ type: 'text' as const, text: paid
          ? `${message} This operation may consume credits and was not automatically retried. Confirm its outcome before attempting another search.`
          : message }], isError: true }
      }
    })
  }

  private validateArgs(tool: Tool, args: Record<string, unknown>): Record<string, unknown> {
    const fields = tool.inputSchema.properties as Record<string, ParameterSchema>
    const values: Record<string, unknown> = { ...args }
    for (const [key, field] of Object.entries(fields)) {
      if (values[key] === undefined && Object.prototype.hasOwnProperty.call(field, 'default')) values[key] = field.default
    }
    for (const [key, value] of Object.entries(values)) {
      if (!Object.prototype.hasOwnProperty.call(fields, key)) throw new Error('Unsupported media parameter')
      const field = fields[key]
      if (field.type === 'integer') {
        if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (field.minimum ?? Number.MIN_SAFE_INTEGER) ||
          value > (field.maximum ?? Number.MAX_SAFE_INTEGER)) throw new Error('Invalid media integer')
      } else if (field.type === 'string') {
        if (typeof value !== 'string') throw new Error('Invalid media string')
        const text = value.trim()
        const length = Array.from(text).length
        if (length < (field.minLength ?? 1) || length > (field.maxLength ?? 4096) ||
          (field.pattern && !new RegExp(field.pattern).test(text)) || (field.enum && !field.enum.includes(text))) throw new Error('Invalid media string')
        values[key] = text
      } else if (field.type === 'boolean') {
        if (typeof value !== 'boolean') throw new Error('Invalid media flag')
      } else throw new Error('Unsupported media parameter type')
      if (Object.prototype.hasOwnProperty.call(field, 'const') && values[key] !== field.const) throw new Error('Invalid media constant')
    }
    for (const key of tool.inputSchema.required ?? []) if (values[key] === undefined) throw new Error('Missing media parameter')
    return values
  }

  private async rpc(method: string, params: Record<string, unknown>, id: number | undefined, signal: AbortSignal, noRetry = false): Promise<unknown> {
    const send = (token?: string) => net.fetch(this.endpoint.href, {
      method: 'POST', redirect: 'error', signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'MCP-Protocol-Version': PROTOCOL_VERSION,
        ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', ...(id === undefined ? {} : { id }), method, params })
    })
    let response: Response
    if (this.endpoint.origin !== 'https://open.vectcut.com') response = await send()
    else if (!noRetry) response = await requestWithVectcutAuth(this.store, (force) => agentRuntimeAuthService.ensureValidAccessToken(force), send)
    else {
      let token: string
      try { token = await agentRuntimeAuthService.ensureValidAccessToken() }
      catch { token = getStoredVectcutApiKey(this.store) }
      if (!token) throw new Error('Login is required')
      // Debit-bearing calls are sent once, even on authorization or ambiguous network failures.
      response = await send(token)
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error('Media endpoint request failed') }
    if (id === undefined) {
      await response.body?.cancel()
      if (![202, 204].includes(response.status)) throw new Error('Invalid initialized notification response')
      return undefined
    }
    const message = await readMessage(response)
    if (!isMediaRecord(message) || message.jsonrpc !== '2.0' || message.id !== id || message.error || !isMediaRecord(message.result)) throw new Error('Invalid media endpoint message')
    return message.result
  }
}
