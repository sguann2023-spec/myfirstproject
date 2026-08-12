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

import VideoGenerateServer from '../video-generate'

function createServer() {
  return new VideoGenerateServer()
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
    mockStoreGet.mockReset()
    mockStoreSet.mockReset()
    mockStoreGet.mockImplementation((key: string) => (key === 'auth.refresh_token' ? 'refresh-token' : undefined))
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
                '1080p': [
                  { ratio: '16:9', size: '1920x1080' }
                ]
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
    const result = await server.listVideoCapabilities({
      model: 'seedance-2.0',
      ratio: '9:16'
    })

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

    expect(result).toEqual({
      requestedModel: 'seedance-2.0',
      resolvedModel: 'seedance-2.0',
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
})
