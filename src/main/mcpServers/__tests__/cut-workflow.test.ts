import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockNetFetch, mockStoreGet, mockStoreSet, storeState } = vi.hoisted(() => ({
  mockNetFetch: vi.fn(),
  mockStoreGet: vi.fn(),
  mockStoreSet: vi.fn(),
  storeState: new Map<string, unknown>()
}))

vi.mock('electron', () => ({
  net: {
    fetch: mockNetFetch
  }
}))

vi.mock('electron-store', () => ({
  default: class MockStore {
    get(key: string) {
      return mockStoreGet(key)
    }

    set(key: string, value: unknown) {
      return mockStoreSet(key, value)
    }
  }
}))

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

import CutWorkflowServer from '../cut-workflow'

type CutWorkflowServerInstance = InstanceType<typeof CutWorkflowServer>

function createServer() {
  return new CutWorkflowServer()
}

async function callTool(server: CutWorkflowServerInstance, toolName: string, args: Record<string, unknown>) {
  const handlers = (server.mcpServer.server as any)._requestHandlers
  const callToolHandler = handlers?.get('tools/call')
  if (!callToolHandler) {
    throw new Error('No tools/call handler registered')
  }
  return callToolHandler({ method: 'tools/call', params: { name: toolName, arguments: args } }, {})
}

async function listTools(server: CutWorkflowServerInstance) {
  const handlers = (server.mcpServer.server as any)._requestHandlers
  const listHandler = handlers?.get('tools/list')
  if (!listHandler) {
    throw new Error('No tools/list handler registered')
  }
  return listHandler({ method: 'tools/list', params: {} }, {})
}

function mockJsonResponse(data: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data)
  } as Response
}

describe('CutWorkflowServer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNetFetch.mockReset()
    mockStoreGet.mockReset()
    mockStoreSet.mockReset()
    storeState.clear()
    mockStoreGet.mockImplementation((key: string) => storeState.get(key))
    mockStoreSet.mockImplementation((key: string, value: unknown) => {
      storeState.set(key, value)
    })
    storeState.set('auth.refresh_token', 'refresh-token')
  })

  it('should expose execute workflow tool', async () => {
    const server = createServer()
    const result = await listTools(server)

    expect(result.tools.map((tool: { name: string }) => tool.name)).toEqual(['execute_workflow'])
  })

  it('should execute a workflow from top-level inputs and script', async () => {
    mockNetFetch
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: 'access-token',
          refresh_token: 'refresh-token-next',
          expires_in: 3600
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          success: true,
          error: '',
          output: {
            draft_id: 'dfd_workflow_1',
            draft_url: 'https://www.vectcut.com/draft/downloader?draft_id=dfd_workflow_1'
          },
          purchase_link: 'https://www.vectcut.com'
        })
      )

    const server = createServer()
    const result = await callTool(server, 'execute_workflow', {
      inputs: {
        title: '你好世界'
      },
      script: [
        {
          type: 'action',
          id: 'step_1',
          index: 0,
          action_type: 'add_text',
          params: {
            text: '${inputs.title}'
          }
        }
      ]
    })

    expect(mockStoreSet).toHaveBeenCalledWith('auth.refresh_token', 'refresh-token-next')
    expect(mockNetFetch).toHaveBeenNthCalledWith(
      2,
      'https://open.vectcut.com/cut_jianying/execute_workflow',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
          'Content-Type': 'application/json'
        })
      })
    )
    expect(JSON.parse(mockNetFetch.mock.calls[1][1].body as string)).toEqual({
      inputs: {
        title: '你好世界'
      },
      script: [
        {
          type: 'action',
          id: 'step_1',
          index: 0,
          action_type: 'add_text',
          params: {
            text: '${inputs.title}'
          }
        }
      ]
    })

    expect(JSON.parse(result.content[0].text)).toEqual({
      provider: 'vectcut',
      action: 'execute',
      mode: 'cut_workflow',
      estimated_wait_time: '15-30 minutes',
      request_summary: {
        workflow_id: undefined,
        has_inputs: true,
        script_steps: 1
      },
      success: true,
      error: '',
      output: {
        draft_id: 'dfd_workflow_1',
        draft_url: 'https://www.vectcut.com/draft/downloader?draft_id=dfd_workflow_1'
      },
      purchase_link: 'https://www.vectcut.com'
    })
  })

  it('should normalize workflowId alias', async () => {
    mockNetFetch
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: 'access-token',
          expires_in: 3600
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          success: true,
          error: '',
          output: {
            draft_id: 'dfd_workflow_alias',
            draft_url: 'https://www.vectcut.com/draft/downloader?draft_id=dfd_workflow_alias'
          }
        })
      )

    const server = createServer()
    await callTool(server, 'execute_workflow', {
      workflowId: 'workflow_saved_123'
    })

    expect(JSON.parse(mockNetFetch.mock.calls[1][1].body as string)).toEqual({
      workflow_id: 'workflow_saved_123'
    })
  })
})
