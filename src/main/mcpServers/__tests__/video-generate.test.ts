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

async function listToolsFromMcpServer(mcpServer: VideoGenerateServerInstance['mcpServer']) {
  const handlers = (mcpServer.server as any)._requestHandlers
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

  it('describes local references as tool-internal uploads instead of pre-upload requirements', async () => {
    const server = createServer()
    const result = await listTools(server)
    const generateVideoTool = result.tools.find((tool: { name: string }) => tool.name === 'generate_video')

    expect(generateVideoTool).toBeTruthy()
    expect(generateVideoTool.description).toContain('uploaded internally before submission')
    expect(generateVideoTool.description).toContain('Use workspace upload only when')
    expect(generateVideoTool.description).not.toContain('Prefer remotely accessible URLs produced by workspace upload')

    const properties = generateVideoTool.inputSchema?.properties ?? {}
    expect(properties.content.description).toContain('uploaded internally before submission')
    expect(properties.prompt).toBeUndefined()
    expect(properties.images).toBeUndefined()
    expect(properties.referenceImages).toBeUndefined()
    expect(properties.referenceVideos).toBeUndefined()
    expect(properties.referenceAudios).toBeUndefined()
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
              badges: ['限时优惠'],
              icon: 'https://example.com/seedance.svg',
              reference_supported: true,
              first_frame_extend_supported: true,
              first_last_frame_supported: true,
              multi_image_reference_supported: true,
              generate_audio_supported: true,
              seedance_offline_supported: false,
              super_resolve_supported: true,
              gen_durations: [4, 5, 6],
              generation_modes: [
                {
                  value: 'text_to_video',
                  label: '文生视频',
                  price_group: 'standard',
                  offline_price_group: ''
                },
                {
                  value: 'first_frame',
                  label: '首帧生成',
                  price_group: 'standard',
                  offline_price_group: ''
                },
                {
                  value: 'first_last_frame',
                  label: '首尾帧',
                  price_group: 'standard',
                  offline_price_group: ''
                },
                {
                  value: 'reference',
                  label: '参考生成',
                  price_group: 'reference_video',
                  offline_price_group: ''
                }
              ],
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
          Authorization: 'Bearer access-token',
          'X-Client-Type': 'pc'
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
          badges: ['限时优惠'],
          icon: 'https://example.com/seedance.svg',
          reference_supported: true,
          first_frame_extend_supported: true,
          first_last_frame_supported: true,
          multi_image_reference_supported: true,
          generate_audio_supported: true,
          seedance_offline_supported: false,
          super_resolve_supported: true,
          gen_durations: [4, 5, 6],
          generation_modes: [
            {
              value: 'text_to_video',
              label: '文生视频',
              price_group: 'standard',
              offline_price_group: ''
            },
            {
              value: 'first_frame',
              label: '首帧生成',
              price_group: 'standard',
              offline_price_group: ''
            },
            {
              value: 'first_last_frame',
              label: '首尾帧',
              price_group: 'standard',
              offline_price_group: ''
            },
            {
              value: 'reference',
              label: '参考生成',
              price_group: 'reference_video',
              offline_price_group: ''
            }
          ],
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

  it('should create a fresh MCP server instance for each bridge session', async () => {
    const server = createServer()

    const freshMcpServer = server.createMcpServer()
    const originalTools = await listTools(server)
    const freshTools = await listToolsFromMcpServer(freshMcpServer)

    expect(freshMcpServer).not.toBe(server.mcpServer)
    expect(freshTools.tools).toEqual(originalTools.tools)
  })

  it('should submit and wait for a basic video generation task by default', async () => {
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
      .mockResolvedValueOnce(
        mockJsonResponse({
          draft_id: 'dfd_video_123',
          draft_url: 'https://www.vectcut.com/draft/downloader?draft_id=dfd_video_123',
          id: 'video-task-123',
          progress: 100,
          status: 'succeeded',
          video_url: 'https://example.com/result.mp4'
        })
      )

    const server = createServer()
    const result = await callTool(server, {
      content: [
        {
          type: 'text',
          text: '猫咪开车疾驰，开出跑道'
        }
      ],
      model: 'seedance-1.5-pro',
      resolution: '1080x1920',
      gen_duration: 10
    })

    expect(mockNetFetch).toHaveBeenNthCalledWith(
      3,
      'https://open.vectcut.com/cut_jianying/generate_ai_video',
      expect.objectContaining({
        method: 'POST'
      })
    )
    expect(mockNetFetch).toHaveBeenNthCalledWith(
      4,
      'https://open.vectcut.com/cut_jianying/aivideo/task_status?task_id=video-task-123',
      expect.objectContaining({
        method: 'GET'
      })
    )
    expect(JSON.parse(String(mockNetFetch.mock.calls[2]?.[1]?.body))).toEqual({
      content: [
        {
          type: 'text',
          text: '猫咪开车疾驰，开出跑道'
        }
      ],
      model: 'seedance-1.5-pro',
      resolution: '1080x1920',
      gen_duration: 10
    })

    expect(JSON.parse(result.content[0].text)).toMatchObject({
      provider: 'vectcut',
      action: 'submit_and_wait',
      task_id: 'video-task-123',
      status: 'succeeded',
      output: {
        draft_id: 'dfd_video_123',
        draft_url: 'https://www.vectcut.com/draft/downloader?draft_id=dfd_video_123',
        video_url: 'https://example.com/result.mp4'
      }
    })
  })

  it.each(['insufficient_balance', 'backend_timeout; task_id=video-task-failed'])(
    'preserves raw failed-task diagnostics for %s',
    async (error) => {
      mockNetFetch
        .mockResolvedValueOnce(mockJsonResponse({ access_token: 'access-token', expires_in: 3600 }))
        .mockResolvedValueOnce(mockJsonResponse({
          capabilities: { 'seedance-2.0': { resolutions: {} } },
          prices: {}
        }))
        .mockResolvedValueOnce(mockJsonResponse({ status: 'ok', task_id: 'video-task-failed' }))
        .mockResolvedValueOnce(mockJsonResponse({ status: 'failed', error }))

      const result = await callTool(createServer(), {
        model: 'seedance-2.0',
        content: [{ type: 'text', text: 'A cat driving' }]
      })

      expect(result).toEqual({
        content: [{ type: 'text', text: `Error: Video generation task failed: ${error}` }],
        isError: true
      })
    }
  )

  it('should keep super_resolve in submission payload', async () => {
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
            'minimax-h3-max': {
              super_resolve_supported: true,
              resolutions: {
                '480p': [{ ratio: '16:9', size: '864x496' }]
              }
            }
          },
          prices: {}
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          status: 'ok',
          task_id: 'video-task-super-resolve'
        })
      )

    const server = createServer()
    await callTool(server, {
      action: 'submit',
      content: [
        {
          type: 'text',
          text: '月球上一个人类基地内的日常生活'
        }
      ],
      model: 'minimax-h3-max',
      resolution: '864x496',
      gen_duration: 5,
      super_resolve: true
    })

    expect(JSON.parse(String(mockNetFetch.mock.calls[2]?.[1]?.body))).toEqual({
      content: [
        {
          type: 'text',
          text: '月球上一个人类基地内的日常生活'
        }
      ],
      model: 'minimax-h3-max',
      resolution: '864x496',
      gen_duration: 5,
      super_resolve: true
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
      action: 'submit',
      content: [
        {
          type: 'text',
          text: '一位女孩在海边奔跑'
        }
      ],
      model: 'doubao-seedance-2-0'
    })

    expect(JSON.parse(String(mockNetFetch.mock.calls[2]?.[1]?.body))).toEqual({
      content: [
        {
          type: 'text',
          text: '一位女孩在海边奔跑'
        }
      ],
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
      action: 'submit',
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
      gen_duration: 8,
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
      gen_duration: 8,
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

  it('should preserve structured content instead of reshaping it into classic image arrays', async () => {
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
                '720p': [{ ratio: '9:16', size: '720x1280' }]
              }
            }
          },
          prices: {}
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          status: 'ok',
          task_id: 'video-task-seedance15'
        })
      )

    const server = createServer()
    await callTool(server, {
      action: 'submit',
      model: 'seedance-1.5-pro',
      content: [
        {
          type: 'text',
          text: '生成一个女生在海边慢慢回头的镜头'
        },
        {
          type: 'image_url',
          image_url: {
            url: 'https://example.com/first-frame.png'
          },
          role: 'reference_image'
        }
      ],
      resolution: '720x1280',
      gen_duration: 5,
      generateAudio: true
    })

    expect(JSON.parse(String(mockNetFetch.mock.calls[2]?.[1]?.body))).toEqual({
      model: 'seedance-1.5-pro',
      content: [
        {
          type: 'text',
          text: '生成一个女生在海边慢慢回头的镜头'
        },
        {
          type: 'image_url',
          image_url: {
            url: 'https://example.com/first-frame.png'
          },
          role: 'reference_image'
        }
      ],
      resolution: '720x1280',
      gen_duration: 5,
      generate_audio: true
    })
  })

  it('should preserve structured reference images when no explicit semantic mode is provided', async () => {
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
          task_id: 'video-task-seedance20'
        })
      )

    const server = createServer()
    await callTool(server, {
      action: 'submit',
      model: 'seedance-2.0',
      content: [
        {
          type: 'text',
          text: '做一个镜头平稳推进的产品视频'
        },
        {
          type: 'image_url',
          image_url: {
            url: 'https://example.com/reference-1.png'
          },
          role: 'reference_image'
        },
        {
          type: 'image_url',
          image_url: {
            url: 'https://example.com/reference-2.png'
          },
          role: 'reference_image'
        }
      ],
      gen_duration: 8,
      generateAudio: false,
      resolution: '1280x720'
    })

    expect(JSON.parse(String(mockNetFetch.mock.calls[2]?.[1]?.body))).toEqual({
      model: 'seedance-2.0',
      content: [
        {
          type: 'text',
          text: '做一个镜头平稳推进的产品视频'
        },
        {
          type: 'image_url',
          image_url: {
            url: 'https://example.com/reference-1.png'
          },
          role: 'reference_image'
        },
        {
          type: 'image_url',
          image_url: {
            url: 'https://example.com/reference-2.png'
          },
          role: 'reference_image'
        }
      ],
      gen_duration: 8,
      generate_audio: false,
      resolution: '1280x720'
    })
  })

  it('should map Seedance 2.0 first and last frame images into explicit content roles', async () => {
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
          task_id: 'video-task-seedance20-first-last'
        })
      )

    const server = createServer()
    await callTool(server, {
      action: 'submit',
      model: 'seedance-2.0',
      generationMode: 'first_last_frame',
      content: [
        {
          type: 'text',
          text: '表情自然的转场。'
        },
        {
          type: 'image_url',
          image_url: {
            url: 'https://example.com/first.jpg'
          },
          role: 'first_frame'
        },
        {
          type: 'image_url',
          image_url: {
            url: 'https://example.com/last.jpg'
          },
          role: 'last_frame'
        }
      ],
      gen_duration: 5,
      resolution: '720p',
      ratio: '16:9',
      generateAudio: true
    })

    expect(JSON.parse(String(mockNetFetch.mock.calls[2]?.[1]?.body))).toEqual({
      model: 'seedance-2.0',
      content: [
        {
          type: 'text',
          text: '表情自然的转场。'
        },
        {
          type: 'image_url',
          image_url: {
            url: 'https://example.com/first.jpg'
          },
          role: 'first_frame'
        },
        {
          type: 'image_url',
          image_url: {
            url: 'https://example.com/last.jpg'
          },
          role: 'last_frame'
        }
      ],
      gen_duration: 5,
      resolution: '720p',
      ratio: '16:9',
      generate_audio: true
    })
  })

  it('should preserve explicit first and last frame roles in structured content', async () => {
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
            }
          },
          prices: {}
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          status: 'ok',
          task_id: 'video-task-seedance15-first-last'
        })
      )

    const server = createServer()
    await callTool(server, {
      action: 'submit',
      model: 'seedance-1.5-pro',
      content: [
        {
          type: 'text',
          text: '猫咪开车疾驰，开出跑道'
        },
        {
          type: 'image_url',
          image_url: {
            url: 'https://example.com/car1.png'
          },
          role: 'first_frame'
        },
        {
          type: 'image_url',
          image_url: {
            url: 'https://example.com/car2.png'
          },
          role: 'last_frame'
        }
      ],
      resolution: '1280x720',
      gen_duration: 4
    })

    expect(JSON.parse(String(mockNetFetch.mock.calls[2]?.[1]?.body))).toEqual({
      model: 'seedance-1.5-pro',
      content: [
        {
          type: 'text',
          text: '猫咪开车疾驰，开出跑道'
        },
        {
          type: 'image_url',
          image_url: {
            url: 'https://example.com/car1.png'
          },
          role: 'first_frame'
        },
        {
          type: 'image_url',
          image_url: {
            url: 'https://example.com/car2.png'
          },
          role: 'last_frame'
        }
      ],
      resolution: '1280x720',
      gen_duration: 4
    })
  })

  it('should reject duration aliases and require gen_duration', async () => {
    const server = createServer()

    const durationResult = await callTool(server, {
      model: 'seedance-2.0',
      content: [
        {
          type: 'text',
          text: '生成一个产品视频'
        }
      ],
      duration: 5
    })
    expect(durationResult.isError).toBe(true)
    expect(durationResult.content[0].text).toContain("only accepts 'gen_duration'")

    const genDurationResult = await callTool(server, {
      model: 'seedance-2.0',
      content: [
        {
          type: 'text',
          text: '生成一个产品视频'
        }
      ],
      genDuration: 5
    })
    expect(genDurationResult.isError).toBe(true)
    expect(genDurationResult.content[0].text).toContain("only accepts 'gen_duration'")
  })

  it('should submit video references for non-Seedance 2.0 models without local support checks', async () => {
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
                '720p': [{ ratio: '9:16', size: '720x1280' }]
              }
            }
          },
          prices: {}
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          status: 'ok',
          task_id: 'video-task-non-seedance-reference'
        })
      )

    const server = createServer()
    await callTool(server, {
      action: 'submit',
      model: 'seedance-1.5-pro',
      content: [
        {
          type: 'text',
          text: '生成一个镜头平稳推进的视频'
        },
        {
          type: 'video_url',
          video_url: {
            url: 'https://example.com/reference-video.mp4'
          },
          role: 'reference_video'
        }
      ]
    })

    expect(JSON.parse(String(mockNetFetch.mock.calls[2]?.[1]?.body))).toEqual({
      model: 'seedance-1.5-pro',
      content: [
        {
          type: 'text',
          text: '生成一个镜头平稳推进的视频'
        },
        {
          type: 'video_url',
          video_url: {
            url: 'https://example.com/reference-video.mp4'
          },
          role: 'reference_video'
        }
      ]
    })
  })

  it('should reject legacy prompt and convenience media fields', async () => {
    const server = createServer()
    const result = await callTool(server, {
      action: 'submit',
      prompt: '做一个产品宣传视频',
      referenceImages: ['https://example.com/ref-1.png'],
      referenceVideos: ['https://example.com/ref-2.mp4'],
      referenceAudios: ['https://example.com/ref-3.mp3']
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Legacy video submission fields are no longer supported')
    expect(result.content[0].text).toContain('prompt')
    expect(result.content[0].text).toContain('referenceImages')
  })

  it('should preserve reference image semantics whenever reference mode is explicit', async () => {
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
            'minimax-h3': {
              reference_supported: true,
              first_frame_extend_supported: true,
              first_last_frame_supported: true,
              multi_image_reference_supported: true,
              resolutions: {
                '720p': [{ ratio: '9:16', size: '720x1280' }]
              }
            }
          },
          prices: {}
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          status: 'ok',
          task_id: 'video-task-minimax-reference'
        })
      )

    const server = createServer()
    await callTool(server, {
      action: 'submit',
      model: 'minimax-h3',
      generation_mode: 'reference',
      content: [
        {
          type: 'text',
          text: '生成一个产品参考视频'
        },
        {
          type: 'image_url',
          image_url: {
            url: 'https://example.com/reference.png'
          },
          role: 'reference_image'
        }
      ],
      resolution: '720x1280',
      gen_duration: 15
    })

    expect(JSON.parse(String(mockNetFetch.mock.calls[2]?.[1]?.body))).toEqual({
      model: 'minimax-h3',
      content: [
        {
          type: 'text',
          text: '生成一个产品参考视频'
        },
        {
          type: 'image_url',
          image_url: {
            url: 'https://example.com/reference.png'
          },
          role: 'reference_image'
        }
      ],
      resolution: '720x1280',
      gen_duration: 15
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
    expect(result.content[0].text).toContain("'content' is required")
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

  describe('external tools', () => {
    beforeEach(() => { vi.restoreAllMocks(); vi.clearAllMocks() })
    const invoke = (server: any, name: string, args: Record<string, unknown>) => callTool(server, args, name)
    it('only lists async tools and rejects hidden legacy tools', async () => {
      const server = new VideoGenerateServer({ external: true })
      expect((await listTools(server)).tools.map((tool: any) => tool.name)).toEqual(['submit', 'task_status', 'get_video_capabilities'])
      expect((await invoke(server, 'generate_video', {})).isError).toBe(true)
      expect(mockNetFetch).not.toHaveBeenCalled()
    })
    it.each(['/tmp/ref.png', 'file:///tmp/ref.png', 'data:image/png;base64,AA', 'http://localhost/a', 'http://127.0.0.1/a', 'http://10.0.0.1/a', 'http://[::1]/a', 'https://user:pass@example.com/a'])('rejects unsafe media %s before submission', async (url) => {
      const server = new VideoGenerateServer({ external: true })
      const result = await invoke(server, 'submit', { content: [{ type: 'image_url', image_url: { url } }] })
      expect(result.isError).toBe(true)
      expect(mockNetFetch).not.toHaveBeenCalled()
      expect(mockUploadLocalFile).not.toHaveBeenCalled()
    })
    it('submits exactly once and never polls or uploads', async () => {
      const server = new VideoGenerateServer({ external: true })
      const request = vi.spyOn(server as any, 'requestWithAuth').mockResolvedValue(mockJsonResponse({ task_id: 'backend-id', status: 'queued', billing: { points: 2 } }))
      const result = await invoke(server, 'submit', { content: [{ type: 'image_url', image_url: { url: 'https://example.com/a.png' } }], generateAudio: false })
      expect(JSON.parse(result.content[0].text)).toMatchObject({ task_id: 'backend-id', billing: { points: 2 } })
      expect(request).toHaveBeenCalledTimes(1)
      expect(request.mock.calls[0][0]).toBe('/cut_jianying/generate_ai_video')
      expect(mockUploadLocalFile).not.toHaveBeenCalled()
    })
    it.each(['running', 'succeeded', 'failed'])('queries status once preserving %s and billing', async (status) => {
      const server = new VideoGenerateServer({ external: true })
      const payload = { task_id: 'backend-id', status, error: 'failure detail', result: { video_url: 'https://example.com/out.mp4', billing: { points: 3 } }, billing: { points: 2 } }
      const request = vi.spyOn(server as any, 'requestWithAuth').mockResolvedValue(mockJsonResponse(payload))
      const result = await invoke(server, 'task_status', { task_id: 'backend-id', mode: 'omni' })
      expect(JSON.parse(result.content[0].text)).toMatchObject(payload)
      expect(request).toHaveBeenCalledTimes(1)
    })
  })

  describe('external video references', () => {
    beforeEach(() => { vi.restoreAllMocks(); vi.clearAllMocks() })
    it.each(['image_url', 'video_url', 'audio_url'])('checks direct and nested %s references', async (field) => {
      const server = new VideoGenerateServer({ external: true })
      for (const reference of ['/tmp/private', { url: 'data:audio/mp3;base64,AA' }]) {
        const result = await callTool(server, { content: [{ type: field, [field]: reference }] }, 'submit')
        expect(result.isError).toBe(true)
      }
      expect(mockNetFetch).not.toHaveBeenCalled()
      expect(mockUploadLocalFile).not.toHaveBeenCalled()
    })
    it('does not let legacy reference aliases bypass validation', async () => {
      const server = new VideoGenerateServer({ external: true })
      const result = await callTool(server, { content: [{ type: 'text', text: 'test' }], reference_images: ['/tmp/private'] }, 'submit')
      expect(result.isError).toBe(true)
      expect(mockNetFetch).not.toHaveBeenCalled()
    })
  })

 describe('external failure semantics', () => {
   beforeEach(() => { vi.restoreAllMocks(); vi.clearAllMocks() })
   const invoke = (server: any, name: string, args: Record<string, unknown>) => callTool(server, args, name)
   const submitArgs = { content: [{ type: 'text', text: 'test' }] }
   it.each([
     { success: false, task_id: 'task', error: 'Insufficient remaining points', message: 'original', billing: { points: 2 } },
     { success: false, message: 'upstream rejected', billing: { points: 2 } },
     { success: true, status: 'queued' },
     { task_id: '   ' },
     { task_id: 'task', status: 'failed', error: 'backend failure' }
   ])('marks unsuccessful submission as an MCP error: %j', async (payload) => {
     const server = new VideoGenerateServer({ external: true })
     const request = vi.spyOn(server as any, 'requestWithAuth').mockResolvedValue(mockJsonResponse(payload))
     const result = await invoke(server, 'submit', submitArgs)
     const parsed = JSON.parse(result.content[0].text)
     expect(result.isError).toBe(true)
     expect(parsed).toMatchObject({ ...payload, success: false })
     expect(parsed.error).toEqual(payload.error || ('message' in payload && payload.message) || expect.stringContaining('task_id'))
     expect(request).toHaveBeenCalledTimes(1)
   })
   it.each([
     { status: 'failed', error: 'original error', message: 'original message' },
     { status: 'error', message: 'upstream rejected' },
     { status: 'cancelled' },
     { status: 'not_found' },
     { success: false, status: 'running', message: 'backend rejected query' }
   ])('marks explicit backend failure as an MCP error without dropping details: %j', async (payload) => {
     const server = new VideoGenerateServer({ external: true })
     const original = { ...payload, billing: { points: 3 }, result: { billing: { points: 1 }, detail: 'original' } }
     const request = vi.spyOn(server as any, 'requestWithAuth').mockResolvedValue(mockJsonResponse(original))
     const result = await invoke(server, 'task_status', { mode: 'omni', task_id: 'task' })
     expect(result.isError).toBe(true)
     expect(JSON.parse(result.content[0].text)).toMatchObject({ ...original, success: false, error: payload.error || payload.message || expect.any(String) })
     expect(request).toHaveBeenCalledTimes(1)
   })
   it.each(['running', 'succeeded'])('does not mark %s as an error', async (status) => {
     const server = new VideoGenerateServer({ external: true })
     vi.spyOn(server as any, 'requestWithAuth').mockResolvedValue(mockJsonResponse({ status }))
     const result = await invoke(server, 'task_status', { mode: 'omni', task_id: 'task' })
     expect(result.isError).not.toBe(true)
   })
   it.each(['network', 'http'])('reports %s status transport failure as unknown, not failed', async (failure) => {
     const server = new VideoGenerateServer({ external: true })
     const request = vi.spyOn(server as any, 'requestWithAuth')
     if (failure === 'network') request.mockRejectedValue(new Error('network timeout'))
     else request.mockResolvedValue(mockJsonResponse({ error: 'upstream unavailable' }, false, 503))
     const result = await invoke(server, 'task_status', { mode: 'omni', task_id: 'task' })
     expect(result.isError).toBe(true)
     expect(JSON.parse(result.content[0].text)).toMatchObject({ task_id: 'task', status: 'unknown', success: false, error: expect.stringContaining(failure === 'network' ? 'network timeout' : 'upstream unavailable') })
     expect(request).toHaveBeenCalledTimes(1)
   })
 })
