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

import KouboTemplateServer from '../koubo-template'

type KouboTemplateServerInstance = InstanceType<typeof KouboTemplateServer>

function createServer() {
  return new KouboTemplateServer()
}

async function callTool(server: KouboTemplateServerInstance, toolName: string, args: Record<string, unknown>) {
  const handlers = (server.mcpServer.server as any)._requestHandlers
  const callToolHandler = handlers?.get('tools/call')
  if (!callToolHandler) {
    throw new Error('No tools/call handler registered')
  }
  return callToolHandler({ method: 'tools/call', params: { name: toolName, arguments: args } }, {})
}

async function listTools(server: KouboTemplateServerInstance) {
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

describe('KouboTemplateServer', () => {
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

  it('should expose submit and status tools', async () => {
    const server = createServer()
    const result = await listTools(server)

    expect(result.tools.map((tool: { name: string }) => tool.name)).toEqual(['submit_koubo_template_task'])
  })

  it('should submit a built-in template task with remote video input', async () => {
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
          task_id: '924E4C927BEE000216155282E20BFF11'
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          error: '',
          message: 'success',
          output: {
            draft_id: 'draft-1',
            draft_url: 'https://www.vectcut.com/draft/downloader?draft_id=draft-1',
            video_url: 'https://example.com/result.mp4'
          },
          purchase_link: 'https://www.vectcut.com',
          status: 'success',
          success: true,
          task_id: '924E4C927BEE000216155282E20BFF11'
        })
      )

    const server = createServer()
    const result = await callTool(server, 'submit_koubo_template_task', {
      template: 'knowledge_pip',
      videoUrl: 'https://example.com/source.mp4',
      title: '标题',
      textContent: '正确文案',
      cover: 'https://example.com/cover.webp'
    })

    expect(mockStoreSet).toHaveBeenCalledWith('auth.refresh_token', 'refresh-token-next')
    expect(mockNetFetch).toHaveBeenNthCalledWith(
      2,
      'https://open.vectcut.com/cut_jianying/agent/submit_agent_task',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
          'Content-Type': 'application/json'
        })
      })
    )
    expect(JSON.parse(mockNetFetch.mock.calls[1][1].body as string)).toEqual({
      agent_id: 'koubo_8f4e3d2a91c74b76a85d2c4e7f8a9b1c',
      params: {
        cover: ['https://example.com/cover.webp'],
        text_content: '正确文案',
        title: '标题',
        video_url: ['https://example.com/source.mp4']
      }
    })

    expect(JSON.parse(result.content[0].text)).toEqual({
      provider: 'vectcut',
      action: 'submit_and_wait',
      mode: 'koubo_template',
      estimated_wait_time: '5-15 minutes',
      template: 'knowledge_pip',
      agent_id: 'koubo_8f4e3d2a91c74b76a85d2c4e7f8a9b1c',
      source_summary: [
        {
          original_input: 'https://example.com/source.mp4',
          submitted_url: 'https://example.com/source.mp4',
          source_kind: 'remote_video',
          file_size_bytes: undefined
        }
      ],
      error: '',
      message: 'success',
      output: {
        draft_id: 'draft-1',
        draft_url: 'https://www.vectcut.com/draft/downloader?draft_id=draft-1',
        video_url: 'https://example.com/result.mp4'
      },
      purchase_link: 'https://www.vectcut.com',
      status: 'success',
      success: true
    })
  })

  it('should support custom agentId with raw params merge', async () => {
    mockNetFetch
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: 'access-token',
          expires_in: 3600
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          task_id: 'task-custom'
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          status: 'success',
          success: true,
          output: {
            draft_id: 'draft-custom',
            draft_url: 'https://www.vectcut.com/draft/downloader?draft_id=draft-custom',
            video_url: 'https://example.com/custom.mp4'
          }
        })
      )

    const server = createServer()
    await callTool(server, 'submit_koubo_template_task', {
      agentId: 'koubo_custom_agent',
      videoUrls: ['https://example.com/source.mp4'],
      params: {
        custom_flag: true
      },
      name: '测试草稿'
    })

    expect(JSON.parse(mockNetFetch.mock.calls[1][1].body as string)).toEqual({
      agent_id: 'koubo_custom_agent',
      params: {
        custom_flag: true,
        video_url: ['https://example.com/source.mp4'],
        name: '测试草稿'
      }
    })
  })

  it('should reject local video paths and require workspace upload first', async () => {
    mockNetFetch
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: 'access-token',
          expires_in: 3600
        })
      )

    const server = createServer()
    const result = await callTool(server, 'submit_koubo_template_task', {
      agentId: 'koubo_custom_agent',
      videoUrl: '/tmp/source.mp4'
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('must be a remotely accessible URL')
  })

  it('should reject audio input', async () => {
    const server = createServer()
    const result = await callTool(server, 'submit_koubo_template_task', {
      agentId: 'koubo_custom_agent',
      audioUrl: 'https://example.com/source.mp3'
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("'audioUrl'/'audioUrls' are not supported")
  })

  it('should require kongjingUrls for classic_detail_yellow', async () => {
    mockNetFetch
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: 'access-token',
          expires_in: 3600
        })
      )

    const server = createServer()
    const result = await callTool(server, 'submit_koubo_template_task', {
      template: 'classic_detail_yellow',
      videoUrl: 'https://example.com/source.mp4'
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("'classic_detail_yellow' requires 'kongjingUrls'")
  })

  it('should reject submit when no video source is provided', async () => {
    const server = createServer()
    const result = await callTool(server, 'submit_koubo_template_task', {
      agentId: 'koubo_custom_agent'
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("'videoUrl' or 'videoUrls' is required")
  })

})
