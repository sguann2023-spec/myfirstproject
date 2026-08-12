import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockNetFetch, mockStat, mockStoreGet, mockStoreSet, mockUploadLocalFile } = vi.hoisted(() => ({
  mockNetFetch: vi.fn(),
  mockStat: vi.fn(),
  mockStoreGet: vi.fn(),
  mockStoreSet: vi.fn(),
  mockUploadLocalFile: vi.fn()
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

vi.mock('node:fs/promises', () => ({
  stat: mockStat
}))

vi.mock('@main/services/OssUploadService', () => ({
  ossUploadService: {
    uploadLocalFile: mockUploadLocalFile
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

import VideoGenerateServer from '../video-generate'

type VideoGenerateServerInstance = InstanceType<typeof VideoGenerateServer>

function createServer() {
  return new VideoGenerateServer()
}

async function callTool(server: VideoGenerateServerInstance, args: Record<string, unknown>, toolName = 'generate_video') {
  const handlers = (server.mcpServer.server as any)._requestHandlers
  const callToolHandler = handlers?.get('tools/call')
  if (!callToolHandler) {
    throw new Error('No tools/call handler registered')
  }
  return callToolHandler({ method: 'tools/call', params: { name: toolName, arguments: args } }, {})
}

async function listTools(server: VideoGenerateServerInstance) {
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

describe('VideoGenerateServer', () => {
  beforeEach(() => {
    mockNetFetch.mockReset()
    mockStat.mockReset()
    mockStoreGet.mockReset()
    mockStoreSet.mockReset()
    mockUploadLocalFile.mockReset()
    mockStoreGet.mockImplementation((key: string) => (key === 'auth.refresh_token' ? 'refresh-token' : undefined))
    mockStat.mockResolvedValue({
      isFile: () => true
    })
  })

  it('should expose generate_video and get_video_capabilities tools', async () => {
    const server = createServer()
    const result = await listTools(server)

    expect(result.tools).toHaveLength(2)
    expect(result.tools.map((tool: { name: string }) => tool.name)).toEqual(['generate_video', 'get_video_capabilities'])
  })

  it('should return filtered video capabilities', async () => {
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
            'seedance-2.0': {
              display_name: 'Seedance 2.0',
              description: '高质量视频生成',
              reference_supported: true,
              first_frame_extend_supported: true,
              first_last_frame_supported: true,
              multi_image_reference_supported: true,
              generate_audio_supported: true,
              seedance_offline_supported: false,
              super_resolve_supported: true,
              gen_durations: [4, 5, 6],
              resolutions: {
                '720p': [
                  { ratio: '16:9', size: '1280x720' },
                  { ratio: '9:16', size: '720x1280' }
                ],
                '1080p': [{ ratio: '16:9', size: '1920x1080' }]
              }
            }
          },
          prices: {
            'seedance-2.0': {
              standard: {
                '720p': {
                  project_id: '88',
                  resource_points_per_unit: 12
                }
              }
            }
          }
        })
      )

    const server = createServer()
    const result = await callTool(
      server,
      {
        model: 'seedance-2.0',
        ratio: '9:16'
      },
      'get_video_capabilities'
    )

    expect(mockNetFetch).toHaveBeenNthCalledWith(
      2,
      'https://open.vectcut.com/llm/video/model_capabilities',
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
      requested_model: 'seedance-2.0',
      resolved_model: 'seedance-2.0',
      models: [
        {
          model: 'seedance-2.0',
          display_name: 'Seedance 2.0',
          description: '高质量视频生成',
          reference_supported: true,
          first_frame_extend_supported: true,
          first_last_frame_supported: true,
          multi_image_reference_supported: true,
          generate_audio_supported: true,
          seedance_offline_supported: false,
          super_resolve_supported: true,
          gen_durations: [4, 5, 6],
          resolutions: {
            '720p': [{ ratio: '9:16', size: '720x1280' }]
          },
          price: {
            standard: {
              '720p': {
                project_id: '88',
                resource_points_per_unit: 12
              }
            }
          }
        }
      ]
    })
  })

  it('should cache video model list from capabilities', async () => {
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
            'seedance-1.5-pro': {
              resolutions: {
                '720p': [{ ratio: '16:9', size: '1280x720' }]
              }
            },
            'seedance-2.0-fast': {
              resolutions: {
                '480p': [{ ratio: '16:9', size: '864x496' }]
              }
            }
          },
          prices: {}
        })
      )

    const server = createServer()
    const first = await server.getVideoModelList()
    const second = await server.getVideoModelList()

    expect(first).toEqual({
      models: ['seedance-1.5-pro', 'seedance-2.0-fast'],
      defaultModel: ''
    })
    expect(second).toEqual(first)
    expect(mockNetFetch).toHaveBeenCalledTimes(2)
  })

  it('should submit a basic video generation task', async () => {
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
            'seedance-1.5-pro': {
              resolutions: {
                '1080p': [{ ratio: '9:16', size: '1080x1920' }]
              }
            }
          },
          prices: {}
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          status: 'ok',
          task_id: 'video-task-123'
        })
      )

    const server = createServer()
    const result = await callTool(server, {
      prompt: '猫咪开车疾驰，开出跑道',
      model: 'seedance-1.5-pro',
      resolution: '1080x1920',
      genDuration: 10
    })

    expect(mockNetFetch).toHaveBeenNthCalledWith(
      3,
      'https://open.vectcut.com/cut_jianying/generate_ai_video',
      expect.objectContaining({
        method: 'POST'
      })
    )
    expect(JSON.parse(String(mockNetFetch.mock.calls[2]?.[1]?.body))).toEqual({
      prompt: '猫咪开车疾驰，开出跑道',
      model: 'seedance-1.5-pro',
      resolution: '1080x1920',
      gen_duration: 10
    })

    expect(JSON.parse(result.content[0].text)).toMatchObject({
      provider: 'vectcut',
      action: 'submit',
      task_id: 'video-task-123'
    })
  })

  it('should resolve video model aliases before submission', async () => {
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
            'seedance-2.0': {
              resolutions: {
                '720p': [{ ratio: '16:9', size: '1280x720' }]
              }
            }
          },
          prices: {}
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          status: 'ok',
          task_id: 'video-task-456'
        })
      )

    const server = createServer()
    const result = await callTool(server, {
      prompt: '一位女孩在海边奔跑',
      model: 'doubao-seedance-2-0'
    })

    expect(JSON.parse(String(mockNetFetch.mock.calls[2]?.[1]?.body))).toEqual({
      prompt: '一位女孩在海边奔跑',
      model: 'seedance-2.0'
    })
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      requested_model: 'doubao-seedance-2-0',
      resolved_model: 'seedance-2.0'
    })
  })

  it('should upload local multimodal references inside content before submission', async () => {
    mockUploadLocalFile
      .mockResolvedValueOnce({
        signedPublicUrl: 'https://oss.example.com/reference/start.png?token=1'
      })
      .mockResolvedValueOnce({
        signedPublicUrl: 'https://oss.example.com/reference/music.mp3?token=1'
      })

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
            'seedance-2.0': {
              resolutions: {
                '720p': [{ ratio: '16:9', size: '1280x720' }]
              }
            }
          },
          prices: {}
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          status: 'ok',
          task_id: 'video-task-local-ref'
        })
      )

    const server = createServer()
    const result = await callTool(server, {
      model: 'seedance-2.0',
      content: [
        {
          type: 'text',
          text: '生成一条 9:16 的广告视频'
        },
        {
          type: 'image_url',
          image_url: {
            url: '/tmp/start.png'
          },
          role: 'reference_image'
        },
        {
          type: 'audio_url',
          audio_url: {
            url: 'file:///tmp/music.mp3'
          },
          role: 'reference_audio'
        }
      ],
      duration: 8,
      generateAudio: true
    })

    expect(mockUploadLocalFile).toHaveBeenNthCalledWith(
      1,
      '/tmp/start.png',
      expect.objectContaining({
        objectKeyPrefix: 'vectcut_ai_video_reference_'
      })
    )
    expect(mockUploadLocalFile).toHaveBeenNthCalledWith(
      2,
      '/tmp/music.mp3',
      expect.objectContaining({
        objectKeyPrefix: 'vectcut_ai_video_reference_'
      })
    )
    expect(JSON.parse(String(mockNetFetch.mock.calls[2]?.[1]?.body))).toEqual({
      model: 'seedance-2.0',
      content: [
        {
          type: 'text',
          text: '生成一条 9:16 的广告视频'
        },
        {
          type: 'image_url',
          image_url: {
            url: 'https://oss.example.com/reference/start.png?token=1'
          },
          role: 'reference_image'
        },
        {
          type: 'audio_url',
          audio_url: {
            url: 'https://oss.example.com/reference/music.mp3?token=1'
          },
          role: 'reference_audio'
        }
      ],
      duration: 8,
      generate_audio: true
    })
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      prepared_references: [
        expect.objectContaining({
          mediaType: 'image',
          sourceKind: 'local_file'
        }),
        expect.objectContaining({
          mediaType: 'audio',
          sourceKind: 'local_file'
        })
      ]
    })
  })

  it('should append convenience reference arrays into content', async () => {
    mockNetFetch
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: 'access-token',
          expires_in: 3600
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          status: 'ok',
          task_id: 'video-task-content-alias'
        })
      )

    const server = createServer()
    await callTool(server, {
      prompt: '做一个产品宣传视频',
      referenceImages: ['https://example.com/ref-1.png'],
      referenceVideos: ['https://example.com/ref-2.mp4'],
      referenceAudios: ['https://example.com/ref-3.mp3']
    })

    expect(JSON.parse(String(mockNetFetch.mock.calls[1]?.[1]?.body))).toEqual({
      prompt: '做一个产品宣传视频',
      content: [
        {
          type: 'image_url',
          image_url: {
            url: 'https://example.com/ref-1.png'
          },
          role: 'reference_image'
        },
        {
          type: 'video_url',
          video_url: {
            url: 'https://example.com/ref-2.mp4'
          },
          role: 'reference_video'
        },
        {
          type: 'audio_url',
          audio_url: {
            url: 'https://example.com/ref-3.mp3'
          },
          role: 'reference_audio'
        }
      ]
    })
  })

  it('should query video generation task status', async () => {
    mockNetFetch
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: 'access-token',
          expires_in: 3600
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          draft_id: 'dfd_test_1',
          draft_url: 'https://www.vectcut.com/draft/downloader?draft_id=dfd_test_1',
          id: 'video-task-789',
          progress: 100,
          status: 'succeeded',
          video_url: 'https://example.com/result.mp4'
        })
      )

    const server = createServer()
    const result = await callTool(server, {
      action: 'status',
      taskId: 'video-task-789'
    })

    expect(mockNetFetch).toHaveBeenNthCalledWith(
      2,
      'https://open.vectcut.com/cut_jianying/aivideo/task_status?task_id=video-task-789',
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
      draft_id: 'dfd_test_1',
      draft_url: 'https://www.vectcut.com/draft/downloader?draft_id=dfd_test_1',
      id: 'video-task-789',
      progress: 100,
      status: 'succeeded',
      video_url: 'https://example.com/result.mp4',
      task_id: 'video-task-789'
    })
  })

  it('should require prompt or content when submitting a task', async () => {
    const server = createServer()
    const result = await callTool(server, {
      action: 'submit'
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("Either 'prompt' or 'content' is required")
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
            'seedance-2.0': {
              resolutions: {
                '720p': [{ ratio: '16:9', size: '1280x720' }]
              }
            }
          },
          prices: {}
        })
      )

    const server = createServer()
    const result = await callTool(
      server,
      {
        model: 'unknown-model'
      },
      'get_video_capabilities'
    )

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Unknown video model')
  })
})
