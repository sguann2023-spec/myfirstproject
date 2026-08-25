import { loggerService } from '@logger'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import type { ProgressToken } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
import Store from 'electron-store'
import { net } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'

import { persistWorkspaceJsonArtifact } from './workspace-json-artifact'

const logger = loggerService.withContext('MCPServer:CutWorkflow')

const API_HOST = 'https://open.vectcut.com'
const CUT_WORKFLOW_EXECUTE_ENDPOINT = '/cut_jianying/execute_workflow'
const OAUTH_TOKEN_URL = 'https://mlbd8l6vgi13-demo.authing.cn/oidc/token'
const OAUTH_CLIENT_ID = '6901dd145dafc6f1f3143938'
const OAUTH_CLIENT_SECRET = '16a94e467e927cc09b3c8dc7ec92d420'
const CUT_WORKFLOW_WAIT_TIME = '15-30 minutes'

const EXECUTE_WORKFLOW_TOOL: Tool = {
  name: 'execute_workflow',
  description:
    'Execute a VectCut editing workflow in one call. Use this for cut-domain workflow JSON with top-level inputs + script, or reuse a saved workflow via workflow_id. This call can take 15-30 minutes. If the workflow references local media files, upload them first with workspace upload and use the returned remote URLs inside the workflow.',
  inputSchema: {
    type: 'object',
    properties: {
      workflowId: {
        type: 'string',
        description: 'Optional alias of workflow_id for running a saved workflow.'
      },
      workflow_id: {
        type: 'string',
        description: 'Optional saved workflow ID for running a reusable workflow.'
      },
      workflow_file: {
        type: 'string',
        description:
          'Optional path to a local JSON file inside the current workspace. Preferred for large workflow payloads; the file should contain either {workflow_id} or top-level {inputs, script}.'
      },
      inputs: {
        type: 'object',
        description: 'Optional top-level workflow inputs object.'
      },
      script: {
        type: 'array',
        description: 'Optional workflow script array. Required together with inputs when workflow_id is omitted.'
      }
    },
    additionalProperties: true
  }
}

type PendingToken = {
  accessToken: string
  expiresAt: number
}

type ToolExecutionExtra = {
  _meta?: {
    progressToken?: ProgressToken
  }
  sendNotification?: (notification: {
    method: 'notifications/progress'
    params: {
      progressToken: ProgressToken
      progress: number
      total?: number
      message?: string
    }
  }) => Promise<void>
}

type CutWorkflowResponse = {
  error?: string
  output?: Record<string, unknown> | string
  purchase_link?: string
  success?: boolean
  [key: string]: unknown
}

class CutWorkflowServer {
  public mcpServer: McpServer
  private readonly store = new Store({ name: 'vectcut' })
  private readonly workspacePath?: string
  private accessToken: PendingToken | null = null
  private refreshPromise: Promise<string> | null = null

  constructor(workspacePath?: string) {
    this.workspacePath = workspacePath
    this.mcpServer = new McpServer(
      {
        name: 'cut-workflow',
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
      tools: [EXECUTE_WORKFLOW_TOOL]
    }))

    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const toolName = request.params.name
      const args = request.params.arguments ?? {}

      try {
        switch (toolName) {
          case 'execute_workflow':
            return await this.executeWorkflow(args as Record<string, unknown>, extra as ToolExecutionExtra)
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

  private async ensureValidAccessToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.accessToken && Date.now() < this.accessToken.expiresAt - 30_000) {
      return this.accessToken.accessToken
    }

    if (!forceRefresh && this.refreshPromise) {
      return this.refreshPromise
    }

    const refreshToken = String(this.store.get('auth.refresh_token') || '').trim()
    if (!refreshToken) {
      throw new Error('No refresh token found, please sign in first')
    }

    this.refreshPromise = this.refreshAccessToken(refreshToken)

    try {
      return await this.refreshPromise
    } finally {
      this.refreshPromise = null
    }
  }

  private async refreshAccessToken(refreshToken: string): Promise<string> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: OAUTH_CLIENT_ID,
      client_secret: OAUTH_CLIENT_SECRET
    }).toString()

    const response = await net.fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`Token refresh failed (${response.status}): ${text || 'unknown error'}`)
    }

    const payload = (await response.json()) as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
    }

    const accessToken = String(payload.access_token || '').trim()
    if (!accessToken) {
      throw new Error('Token refresh returned no access token')
    }

    const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : 3600
    this.accessToken = {
      accessToken,
      expiresAt: Date.now() + expiresIn * 1000
    }

    if (typeof payload.refresh_token === 'string' && payload.refresh_token.trim()) {
      this.store.set('auth.refresh_token', payload.refresh_token.trim())
    }

    return accessToken
  }

  private async requestWithAuth(body: Record<string, unknown>): Promise<Response> {
    const token = await this.ensureValidAccessToken()

    const doFetch = async (accessToken: string): Promise<Response> =>
      net.fetch(`${API_HOST}${CUT_WORKFLOW_EXECUTE_ENDPOINT}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      })

    let response = await doFetch(token)
    if (response.status === 401) {
      const refreshedToken = await this.ensureValidAccessToken(true)
      response = await doFetch(refreshedToken)
    }

    return response
  }

  private formatJsonResult(payload: Record<string, unknown>) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(payload, null, 2)
        }
      ]
    }
  }

  private async loadWorkflowPayloadFromFile(workflowFile: string): Promise<Record<string, unknown>> {
    const workspaceRoot = String(this.workspacePath || '').trim()
    if (!workspaceRoot) {
      throw new McpError(ErrorCode.InvalidParams, "'workflow_file' requires a workspace root for path resolution")
    }

    const resolvedWorkspaceRoot = await fs.realpath(workspaceRoot)
    const requestedPath = path.isAbsolute(workflowFile)
      ? path.resolve(workflowFile)
      : path.resolve(resolvedWorkspaceRoot, workflowFile)
    const resolvedPath = await fs.realpath(requestedPath)
    const relativePath = path.relative(resolvedWorkspaceRoot, resolvedPath)

    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Access denied: Path is outside the configured workspace root: ${workflowFile}`
      )
    }

    const rawText = await fs.readFile(resolvedPath, 'utf8')

    let parsed: unknown
    try {
      parsed = JSON.parse(rawText)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new McpError(ErrorCode.InvalidParams, `'workflow_file' must contain valid JSON: ${message}`)
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "'workflow_file' must contain a JSON object with either 'workflow_id' or top-level 'inputs' and 'script'"
      )
    }

    return parsed as Record<string, unknown>
  }

  private async normalizeWorkflowPayload(args: Record<string, unknown>) {
    const payload = { ...args }
    const workflowFile = typeof payload.workflow_file === 'string' ? payload.workflow_file.trim() : ''

    if (workflowFile) {
      const filePayload = await this.loadWorkflowPayloadFromFile(workflowFile)
      delete payload.workflow_file

      if (Object.keys(payload).length > 0) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "'workflow_file' cannot be combined with other workflow parameters; put the full payload in the file"
        )
      }

      return this.normalizeWorkflowPayload(filePayload)
    }

    const workflowId =
      typeof payload.workflowId === 'string'
        ? payload.workflowId.trim()
        : typeof payload.workflow_id === 'string'
          ? payload.workflow_id.trim()
          : ''
    delete payload.workflowId

    if (workflowId) {
      payload.workflow_id = workflowId
    }

    const hasWorkflowId = typeof payload.workflow_id === 'string' && payload.workflow_id.trim().length > 0
    const hasInputs = payload.inputs !== undefined
    const hasScript = payload.script !== undefined

    if (!hasWorkflowId && !hasInputs && !hasScript) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Provide either 'workflow_file', 'workflow_id'/'workflowId', or a workflow body with top-level 'inputs' and 'script'"
      )
    }

    if (!hasWorkflowId) {
      if (!hasInputs || typeof payload.inputs !== 'object' || Array.isArray(payload.inputs) || payload.inputs === null) {
        throw new McpError(ErrorCode.InvalidParams, "'inputs' must be an object when workflow_id is omitted")
      }
      if (!hasScript || !Array.isArray(payload.script)) {
        throw new McpError(ErrorCode.InvalidParams, "'script' must be an array when workflow_id is omitted")
      }
    }

    return payload
  }

  private summarizeRequest(payload: Record<string, unknown>) {
    return {
      workflow_id: typeof payload.workflow_id === 'string' ? payload.workflow_id : undefined,
      has_inputs: Boolean(payload.inputs && typeof payload.inputs === 'object' && !Array.isArray(payload.inputs)),
      script_steps: Array.isArray(payload.script) ? payload.script.length : 0
    }
  }

  private async reportProgress(extra: ToolExecutionExtra | undefined, progress: number, message: string) {
    const progressToken = extra?._meta?.progressToken
    if (!progressToken || typeof extra?.sendNotification !== 'function') {
      return
    }

    await extra.sendNotification({
      method: 'notifications/progress',
      params: {
        progressToken,
        progress,
        total: 100,
        message
      }
    })
  }

  private async executeWorkflow(args: Record<string, unknown>, extra?: ToolExecutionExtra) {
    const payload = await this.normalizeWorkflowPayload(args)
    await this.reportProgress(extra, 5, 'VectCut 剪辑工作流已提交，等待服务端执行完成')

    const response = await this.requestWithAuth(payload)
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Cut workflow execute failed (${response.status}): ${body || 'unknown error'}`)
    }

    const result = (await response.json()) as CutWorkflowResponse

    logger.info('Cut workflow executed', {
      workflowId: payload.workflow_id,
      success: result.success
    })

    const responsePayload: Record<string, unknown> = {
      provider: 'vectcut',
      action: 'execute',
      mode: 'cut_workflow',
      estimated_wait_time: CUT_WORKFLOW_WAIT_TIME,
      request_summary: this.summarizeRequest(payload),
      ...result
    }

    const artifact = await persistWorkspaceJsonArtifact({
      toolName: 'cut-workflow',
      taskId:
        (typeof result.output === 'object' && result.output && typeof result.output.draft_id === 'string'
          ? result.output.draft_id
          : undefined) || (typeof payload.workflow_id === 'string' ? payload.workflow_id : undefined),
      payload: responsePayload,
      workspaceRoot: this.workspacePath
    })

    await this.reportProgress(extra, 100, 'VectCut 剪辑工作流执行完成')

    if (artifact) {
      return this.formatJsonResult({
        ...responsePayload,
        artifact: {
          storage: 'workspace_file',
          file_path: artifact.filePath,
          relative_path: artifact.relativePath
        }
      })
    }

    return this.formatJsonResult(responsePayload)
  }
}

export default CutWorkflowServer
