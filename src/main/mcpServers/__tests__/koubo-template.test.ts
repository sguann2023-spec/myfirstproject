import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockNetFetch, mockStoreGet, mockStoreSet } = vi.hoisted(() => ({
  mockNetFetch: vi.fn(),
  mockStoreGet: vi.fn(),
  mockStoreSet: vi.fn()
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
    mockStoreGet.mockImplementation((key: string) => (key === 'auth.refresh_token' ? 'refresh-token' : undefined))
  })

  it('should expose submit and status tools', async () => {
    const server = createServer()
    const result = await listTools(server)

    expect(result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      'submit_koubo_template_task',
      'get_koubo_template_task_status'
    ])
  })

  it('should submit a built-in template task', async () => {
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
        }),
        body: JSON.stringify({
          agent_id: 'koubo_8f4e3d2a91c74b76a85d2c4e7f8a9b1c',
          params: {
            video_url: ['https://example.com/source.mp4'],
            cover: ['https://example.com/cover.webp'],
            text_content: '正确文案',
            title: '标题'
          }
        })
      })
    )

    expect(JSON.parse(result.content[0].text)).toEqual({
      provider: 'vectcut',
      action: 'submit',
      mode: 'koubo_template',
      template: 'knowledge_pip',
      agent_id: 'koubo_8f4e3d2a91c74b76a85d2c4e7f8a9b1c',
      task_id: '924E4C927BEE000216155282E20BFF11'
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

  it('should accept audioUrls as source media', async () => {
    mockNetFetch
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: 'access-token',
          expires_in: 3600
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          task_id: 'task-audio'
        })
      )

    const server = createServer()
    await callTool(server, 'submit_koubo_template_task', {
      agentId: 'koubo_custom_agent',
      audioUrls: ['https://example.com/source.mp3'],
      params: {
        custom_flag: true
      }
    })

    expect(JSON.parse(mockNetFetch.mock.calls[1][1].body as string)).toEqual({
      agent_id: 'koubo_custom_agent',
      params: {
        custom_flag: true,
        audio_urls: ['https://example.com/source.mp3']
      }
    })
  })

  it('should require kongjingUrls for classic_detail_yellow', async () => {
    const server = createServer()
    const result = await callTool(server, 'submit_koubo_template_task', {
      template: 'classic_detail_yellow',
      videoUrl: 'https://example.com/source.mp4'
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("'classic_detail_yellow' requires 'kongjingUrls'")
  })

  it('should reject submit when neither video nor audio sources are provided', async () => {
    const server = createServer()
    const result = await callTool(server, 'submit_koubo_template_task', {
      agentId: 'koubo_custom_agent'
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("'videoUrl', 'videoUrls', 'audioUrl', or 'audioUrls' is required")
  })

  it('should query koubo template task status', async () => {
    mockNetFetch
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: 'access-token',
          expires_in: 3600
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          error: '',
          message: 'AI正在准备配图',
          output: {
            draft_id: 'dfd_cat_1773972702_ed2dc1d7',
            draft_url: 'https://www.vectcut.com/draft/downloader?draft_id=dfd_cat_1773972702_ed2dc1d7&is_capcut=0',
            video_url: ''
          },
          purchase_link: 'https://www.vectcut.com',
          status: 'processing',
          success: false,
          task_id: '924E4C927BEE7FA7160F6408D51E34E3'
        })
      )

    const server = createServer()
    const result = await callTool(server, 'get_koubo_template_task_status', {
      taskId: '924E4C927BEE7FA7160F6408D51E34E3'
    })

    expect(mockNetFetch).toHaveBeenNthCalledWith(
      2,
      'https://open.vectcut.com/cut_jianying/agent/task_status?task_id=924E4C927BEE7FA7160F6408D51E34E3',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token'
        })
      })
    )

    expect(JSON.parse(result.content[0].text)).toEqual({
      provider: 'vectcut',
      action: 'status',
      mode: 'koubo_template',
      error: '',
      message: 'AI正在准备配图',
      output: {
        draft_id: 'dfd_cat_1773972702_ed2dc1d7',
        draft_url: 'https://www.vectcut.com/draft/downloader?draft_id=dfd_cat_1773972702_ed2dc1d7&is_capcut=0',
        video_url: ''
      },
      purchase_link: 'https://www.vectcut.com',
      status: 'processing',
      success: false,
      task_id: '924E4C927BEE7FA7160F6408D51E34E3'
    })
  })
})
