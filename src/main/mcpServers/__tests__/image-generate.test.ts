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

import ImageGenerateServer from '../image-generate'

type ImageGenerateServerInstance = InstanceType<typeof ImageGenerateServer>

function createServer() {
  return new ImageGenerateServer()
}

async function callTool(
  server: ImageGenerateServerInstance,
  args: Record<string, unknown>,
  toolName = 'generate_or_edit_image'
) {
  const handlers = (server.mcpServer.server as any)._requestHandlers
  const callToolHandler = handlers?.get('tools/call')
  if (!callToolHandler) {
    throw new Error('No tools/call handler registered')
  }
  return callToolHandler({ method: 'tools/call', params: { name: toolName, arguments: args } }, {})
}

async function listTools(server: ImageGenerateServerInstance) {
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

describe('ImageGenerateServer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStoreGet.mockImplementation((key: string) => (key === 'auth.refresh_token' ? 'refresh-token' : undefined))
  })

  it('should expose only the generate_or_edit_image tool', async () => {
    const server = createServer()
    const result = await listTools(server)

    expect(result.tools).toHaveLength(2)
    expect(result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      'generate_or_edit_image',
      'get_image_capabilities'
    ])
  })

  it('should return image capabilities with prices', async () => {
    mockNetFetch
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: 'access-token',
          expires_in: 3600
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          capabilities: {
            'seedream-4.5': {
              reference_supported: true,
              resolutions: {
                '1K': [
                  { ratio: '1:1', size: '1024x1024' },
                  { ratio: '16:9', size: '1280x720' }
                ]
              }
            },
            'seedream-5.0': {
              reference_supported: true,
              resolutions: {
                '2K': [{ ratio: '1:1', size: '2048x2048' }]
              }
            }
          },
          prices: {
            'seedream-4.5': {
              project_id: '26',
              resource_points_per_unit: 30
            },
            'seedream-5.0': {
              project_id: '45',
              resource_points_per_unit: 25
            }
          }
        })
      )

    const server = createServer()
    const result = await callTool(server, {
      model: 'seedream-4.5',
      ratio: '1:1'
    }, 'get_image_capabilities')

    expect(mockNetFetch).toHaveBeenNthCalledWith(
      2,
      'https://open.vectcut.com/llm/image/model_capabilities',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token'
        })
      })
    )

    expect(JSON.parse(result.content[0].text)).toEqual({
      provider: 'vectcut',
      action: 'capabilities',
      requested_model: 'seedream-4.5',
      resolved_model: 'seedream-4.5',
      models: [
        {
          model: 'seedream-4.5',
          reference_supported: true,
          resolutions: {
            '1K': [{ ratio: '1:1', size: '1024x1024' }]
          },
          price: {
            project_id: '26',
            resource_points_per_unit: 30
          }
        }
      ]
    })
  })

  it('should cache image model list loaded from capabilities', async () => {
    mockNetFetch
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: 'access-token',
          expires_in: 3600
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          capabilities: {
            'gpt-image-2-all': {
              reference_supported: true,
              resolutions: {
                '1K': [{ ratio: '1:1', size: '1024x1024' }]
              }
            },
            'seedream-4.5': {
              reference_supported: true,
              resolutions: {
                '2K': [{ ratio: '1:1', size: '2048x2048' }]
              }
            }
          },
          prices: {}
        })
      )

    const server = createServer()
    const firstResult = await server.getImageModelList()
    const secondResult = await server.getImageModelList()

    expect(firstResult).toEqual({
      models: ['gpt-image-2-all', 'seedream-4.5'],
      defaultModel: ''
    })
    expect(secondResult).toEqual(firstResult)
    expect(mockNetFetch).toHaveBeenCalledTimes(2)
  })

  it('should omit prices when includePrices is false', async () => {
    mockNetFetch
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: 'access-token',
          expires_in: 3600
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          capabilities: {
            'seedream-4.5': {
              reference_supported: true,
              resolutions: {
                '2K': [{ ratio: '1:1', size: '2048x2048' }]
              }
            }
          },
          prices: {
            'seedream-4.5': {
              project_id: '26',
              resource_points_per_unit: 30
            }
          }
        })
      )

    const server = createServer()
    const result = await callTool(server, {
      includePrices: false
    }, 'get_image_capabilities')

    expect(JSON.parse(result.content[0].text)).toEqual({
      provider: 'vectcut',
      action: 'capabilities',
      models: [
        {
          model: 'seedream-4.5',
          reference_supported: true,
          resolutions: {
            '2K': [{ ratio: '1:1', size: '2048x2048' }]
          }
        }
      ]
    })
  })

  it('should submit an async image generation task', async () => {
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
          capabilities: {
            'seedream-4.5': {
              reference_supported: true,
              resolutions: {
                '1K': [{ ratio: '1:1', size: '1024x1024' }]
              }
            }
          },
          prices: {}
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          success: true,
          task_id: 'task-123',
          message_id: 'msg-123',
          status: 'queued',
          queue_name: 'llm-image-task',
          error: ''
        })
      )

    const server = createServer()
    const result = await callTool(server, {
      prompt: '  一只站在云上的猫  ',
      model: 'seedream-4.5',
      size: '1024x1024',
      referenceImage: 'https://example.com/ref.png',
      composeDraft: false,
      draftId: 'draft-1'
    })

    expect(mockStoreSet).toHaveBeenCalledWith('auth.refresh_token', 'refresh-token-next')
    expect(mockNetFetch).toHaveBeenNthCalledWith(
      2,
      'https://open.vectcut.com/llm/image/model_capabilities',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token'
        })
      })
    )
    expect(mockNetFetch).toHaveBeenNthCalledWith(
      3,
      'https://open.vectcut.com/llm/image/submit_task/generate',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
          'Content-Type': 'application/json'
        }),
        body: JSON.stringify({
          prompt: '一只站在云上的猫',
          model: 'seedream-4.5',
          size: '1024x1024',
          reference_image: 'https://example.com/ref.png',
          compose_draft: false,
          draft_id: 'draft-1'
        })
      })
    )

    expect(result.isError).not.toBe(true)
    expect(JSON.parse(result.content[0].text)).toEqual({
      provider: 'vectcut',
      action: 'submit',
      estimated_wait_time: '3-5 minutes',
      polling_hint: 'AI image tasks are asynchronous and usually finish in 3-5 minutes. Use action="status" with taskId to query progress.',
      requested_model: 'seedream-4.5',
      resolved_model: 'seedream-4.5',
      model_match_type: 'exact',
      success: true,
      task_id: 'task-123',
      message_id: 'msg-123',
      status: 'queued',
      queue_name: 'llm-image-task',
      error: ''
    })
  })

  it('should keep supporting the legacy generate_image tool name', async () => {
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
          task_id: 'task-legacy-123',
          status: 'queued'
        })
      )

    const server = createServer()
    const result = await callTool(server, {
      prompt: '把这张图改成胶片质感',
      editImage: 'https://example.com/original.png'
    }, 'generate_image')

    expect(result.isError).not.toBe(true)
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      provider: 'vectcut',
      action: 'submit',
      task_id: 'task-legacy-123'
    })
  })

  it('should accept editing-style image aliases and map them to reference fields', async () => {
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
          task_id: 'task-edit-123',
          status: 'queued'
        })
      )

    const server = createServer()
    await callTool(server, {
      prompt: '保留人物主体，把背景改成雪山，并提升清晰度',
      editImage: 'https://example.com/original.png',
      composeDraft: false
    })

    expect(mockNetFetch).toHaveBeenNthCalledWith(
      2,
      'https://open.vectcut.com/llm/image/submit_task/generate',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          prompt: '保留人物主体，把背景改成雪山，并提升清晰度',
          reference_image: 'https://example.com/original.png',
          compose_draft: false
        })
      })
    )
  })

  it('should resolve non-standard model aliases to the closest supported model', async () => {
    mockNetFetch
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: 'access-token',
          expires_in: 3600
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          capabilities: {
            'gpt-image-2-all': {
              reference_supported: true,
              resolutions: {
                '1K': [{ ratio: '1:1', size: '1024x1024' }]
              }
            },
            'seedream-4.5': {
              reference_supported: true,
              resolutions: {
                '1K': [{ ratio: '1:1', size: '1024x1024' }]
              }
            }
          },
          prices: {}
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          success: true,
          task_id: 'task-model-123',
          status: 'queued'
        })
      )

    const server = createServer()
    const result = await callTool(server, {
      prompt: '保留主体，把图片变成电影海报风格',
      model: 'gptimage2',
      editImage: 'https://example.com/original.png'
    })

    expect(mockNetFetch).toHaveBeenNthCalledWith(
      3,
      'https://open.vectcut.com/llm/image/submit_task/generate',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          prompt: '保留主体，把图片变成电影海报风格',
          model: 'gpt-image-2-all',
          reference_image: 'https://example.com/original.png'
        })
      })
    )

    expect(JSON.parse(result.content[0].text)).toMatchObject({
      provider: 'vectcut',
      action: 'submit',
      requested_model: 'gptimage2',
      resolved_model: 'gpt-image-2-all'
    })
  })

  it('should query image generation task status', async () => {
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
          task_id: 'task-123',
          status: 'success',
          progress: 100,
          message: '处理完成',
          error: '',
          result: {
            image: 'https://example.com/result.png',
            draft_id: 'draft-1',
            reused_from_history: false
          }
        })
      )

    const server = createServer()
    const result = await callTool(server, {
      action: 'status',
      taskId: 'task-123'
    })

    expect(mockNetFetch).toHaveBeenNthCalledWith(
      2,
      'https://open.vectcut.com/llm/image/submit_task/task_status?task_id=task-123',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token'
        })
      })
    )

    expect(result.isError).not.toBe(true)
    expect(JSON.parse(result.content[0].text)).toEqual({
      provider: 'vectcut',
      action: 'status',
      success: true,
      task_id: 'task-123',
      status: 'success',
      progress: 100,
      message: '处理完成',
      error: '',
      result: {
        image: 'https://example.com/result.png',
        draft_id: 'draft-1',
        reused_from_history: false
      }
    })
  })

  it('should require prompt when submitting a task', async () => {
    const server = createServer()
    const result = await callTool(server, {
      action: 'submit'
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("'prompt' is required")
  })

  it('should reject unknown capability model filters', async () => {
    mockNetFetch
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: 'access-token',
          expires_in: 3600
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          capabilities: {
            'seedream-4.5': {
              reference_supported: true,
              resolutions: {
                '1K': [{ ratio: '1:1', size: '1024x1024' }]
              }
            }
          },
          prices: {}
        })
      )

    const server = createServer()
    const result = await callTool(server, {
      model: 'unknown-model'
    }, 'get_image_capabilities')

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Unknown image model')
  })
})
