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

import DigitalHumanServer from '../digital-human'

type DigitalHumanServerInstance = InstanceType<typeof DigitalHumanServer>

function createServer() {
  return new DigitalHumanServer()
}

async function callTool(server: DigitalHumanServerInstance, toolName: string, args: Record<string, unknown>) {
  const handlers = (server.mcpServer.server as any)._requestHandlers
  const callToolHandler = handlers?.get('tools/call')
  if (!callToolHandler) {
    throw new Error('No tools/call handler registered')
  }
  return callToolHandler({ method: 'tools/call', params: { name: toolName, arguments: args } }, {})
}

async function listTools(server: DigitalHumanServerInstance) {
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

describe('DigitalHumanServer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStoreGet.mockImplementation((key: string) => (key === 'auth.refresh_token' ? 'refresh-token' : undefined))
  })

  it('should expose all digital human tools', async () => {
    const server = createServer()
    const result = await listTools(server)

    expect(result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      'create_lip_sync_digital_human',
      'get_lip_sync_digital_human_status',
      'create_image_driven_digital_human',
      'get_image_driven_digital_human_status'
    ])
  })

  it('should create a lip-sync digital human task', async () => {
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
          message: '任务创建成功',
          task_id: '5114327'
        })
      )

    const server = createServer()
    const result = await callTool(server, 'create_lip_sync_digital_human', {
      audioUrl: 'https://example.com/audio.mp3',
      videoUrl: 'https://example.com/video.mp4'
    })

    expect(mockStoreSet).toHaveBeenCalledWith('auth.refresh_token', 'refresh-token-next')
    expect(mockNetFetch).toHaveBeenNthCalledWith(
      2,
      'https://open.vectcut.com/cut_jianying/digital_human/create',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
          'Content-Type': 'application/json'
        }),
        body: JSON.stringify({
          audio_url: 'https://example.com/audio.mp3',
          video_url: 'https://example.com/video.mp4'
        })
      })
    )

    expect(JSON.parse(result.content[0].text)).toEqual({
      provider: 'vectcut',
      mode: 'lip_sync',
      action: 'submit',
      message: '任务创建成功',
      task_id: '5114327'
    })
  })

  it('should query lip-sync digital human status', async () => {
    mockNetFetch
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: 'access-token',
          expires_in: 3600
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          digital_human_url: 'https://example.com/dh.mp4',
          message: '处理完成'
        })
      )

    const server = createServer()
    const result = await callTool(server, 'get_lip_sync_digital_human_status', {
      taskId: '5114327'
    })

    expect(mockNetFetch).toHaveBeenNthCalledWith(
      2,
      'https://open.vectcut.com/cut_jianying/digital_human/task_status?task_id=5114327',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token'
        })
      })
    )

    expect(JSON.parse(result.content[0].text)).toEqual({
      provider: 'vectcut',
      mode: 'lip_sync',
      action: 'status',
      task_id: '5114327',
      digital_human_url: 'https://example.com/dh.mp4',
      message: '处理完成'
    })
  })

  it('should create an image-driven digital human task with default resolution', async () => {
    mockNetFetch
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: 'access-token',
          expires_in: 3600
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          task_id: 'omni-1',
          message: '任务创建成功'
        })
      )

    const server = createServer()
    const result = await callTool(server, 'create_image_driven_digital_human', {
      audioUrl: 'https://example.com/audio.mp3',
      imageUrl: 'https://example.com/avatar.png',
      prompt: '人物自然地进行口播'
    })

    expect(mockNetFetch).toHaveBeenNthCalledWith(
      2,
      'https://open.vectcut.com/cut_jianying/digital_human/omni/submit',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
          'Content-Type': 'application/json'
        }),
        body: JSON.stringify({
          audio_url: 'https://example.com/audio.mp3',
          image_url: 'https://example.com/avatar.png',
          prompt: '人物自然地进行口播',
          output_resolution: 1080
        })
      })
    )

    expect(JSON.parse(result.content[0].text)).toEqual({
      provider: 'vectcut',
      mode: 'image_driven',
      action: 'submit',
      output_resolution: 1080,
      task_id: 'omni-1',
      message: '任务创建成功'
    })
  })

  it('should query image-driven digital human status', async () => {
    mockNetFetch
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: 'access-token',
          expires_in: 3600
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          status: 'success',
          video_url: 'https://example.com/omni.mp4'
        })
      )

    const server = createServer()
    const result = await callTool(server, 'get_image_driven_digital_human_status', {
      taskId: 'omni-1'
    })

    expect(mockNetFetch).toHaveBeenNthCalledWith(
      2,
      'https://open.vectcut.com/cut_jianying/digital_human/omni/task_status?task_id=omni-1',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token'
        })
      })
    )

    expect(JSON.parse(result.content[0].text)).toEqual({
      provider: 'vectcut',
      mode: 'image_driven',
      action: 'status',
      task_id: 'omni-1',
      status: 'success',
      video_url: 'https://example.com/omni.mp4'
    })
  })
})
