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

import DraftElementsServer from '../draft-elements'

type DraftElementsServerInstance = InstanceType<typeof DraftElementsServer>

function createServer() {
  return new DraftElementsServer()
}

async function callTool(server: DraftElementsServerInstance, toolName: string, args: Record<string, unknown>) {
  const handlers = (server.mcpServer.server as any)._requestHandlers
  const callToolHandler = handlers?.get('tools/call')
  if (!callToolHandler) {
    throw new Error('No tools/call handler registered')
  }
  return callToolHandler({ method: 'tools/call', params: { name: toolName, arguments: args } }, {})
}

async function listTools(server: DraftElementsServerInstance) {
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

describe('DraftElementsServer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStoreGet.mockImplementation((key: string) => (key === 'auth.refresh_token' ? 'refresh-token' : undefined))
  })

  it('should expose text, subtitle, media, audio, effect, filter, and animation tools', async () => {
    const server = createServer()
    const result = await listTools(server)

    expect(result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      'add_text',
      'add_batch_text',
      'remove_text',
      'modify_text',
      'add_subtitle',
      'get_text_intro_types',
      'get_text_outro_types',
      'get_text_loop_anim_types',
      'get_font_types',
      'add_image',
      'add_batch_image',
      'modify_image',
      'remove_image',
      'add_video',
      'add_batch_video',
      'modify_video',
      'remove_video',
      'get_transition_types',
      'add_audio',
      'add_batch_audio',
      'modify_audio',
      'remove_audio',
      'get_audio_effect_types',
      'add_video_keyframe',
      'add_effect',
      'modify_effect',
      'remove_effect',
      'get_video_character_effect_types',
      'get_video_scene_effect_types',
      'add_filter',
      'modify_filter',
      'remove_filter',
      'get_filter_types',
      'get_intro_animation_types',
      'get_outro_animation_types',
      'get_combo_animation_types'
    ])
  })

  it('should add text with camelCase aliases normalized to snake_case', async () => {
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
          error: '',
          output: {
            draft_id: 'dfd_text_1',
            draft_url: 'https://www.vectcut.com/draft/downloader?draft_id=dfd_text_1',
            material_id: 'text_mat_1'
          },
          success: true
        })
      )

    const server = createServer()
    const result = await callTool(server, 'add_text', {
      text: '你好',
      start: 0,
      end: 5,
      draftId: 'dfd_text_1',
      trackName: 'text_main',
      introAnimation: '向下飞入'
    })

    expect(mockStoreSet).toHaveBeenCalledWith('auth.refresh_token', 'refresh-token-next')
    expect(mockNetFetch).toHaveBeenNthCalledWith(
      2,
      'https://open.vectcut.com/cut_jianying/add_text',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          text: '你好',
          start: 0,
          end: 5,
          draft_id: 'dfd_text_1',
          track_name: 'text_main',
          intro_animation: '向下飞入'
        })
      })
    )
    expect(JSON.parse(result.content[0].text)).toEqual({
      provider: 'vectcut',
      action: 'add_text',
      success: true,
      error: '',
      output: {
        draft_id: 'dfd_text_1',
        draft_url: 'https://www.vectcut.com/draft/downloader?draft_id=dfd_text_1',
        material_id: 'text_mat_1'
      }
    })
  })

  it('should list fonts through the readonly GET endpoint', async () => {
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
          output: [
            { name: '系统', cloud_render_supported: true },
            { name: '挥墨体', cloud_render_supported: false }
          ],
          success: true
        })
      )

    const server = createServer()
    const result = await callTool(server, 'get_font_types', {})

    expect(mockNetFetch).toHaveBeenNthCalledWith(
      2,
      'https://open.vectcut.com/cut_jianying/get_font_types',
      expect.objectContaining({
        method: 'GET',
        body: undefined
      })
    )
    expect(JSON.parse(result.content[0].text)).toEqual({
      provider: 'vectcut',
      action: 'get_font_types',
      success: true,
      error: '',
      output: [
        { name: '系统', cloud_render_supported: true },
        { name: '挥墨体', cloud_render_supported: false }
      ],
      count: 2
    })
  })

  it('should add image and normalize marterial_id into material_id', async () => {
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
          output: {
            draft_id: 'dfd_image_1',
            draft_url: 'https://www.vectcut.com/draft/downloader?draft_id=dfd_image_1',
            marterial_id: 'image_mat_1'
          },
          success: true
        })
      )

    const server = createServer()
    const result = await callTool(server, 'add_image', {
      imageUrl: 'https://example.com/demo.png',
      end: 8,
      draftId: 'dfd_image_1',
      introAnimationDuration: 0.5
    })

    expect(mockNetFetch).toHaveBeenNthCalledWith(
      2,
      'https://open.vectcut.com/cut_jianying/add_image',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          image_url: 'https://example.com/demo.png',
          end: 8,
          draft_id: 'dfd_image_1',
          intro_animation_duration: 0.5
        })
      })
    )
    expect(JSON.parse(result.content[0].text)).toEqual({
      provider: 'vectcut',
      action: 'add_image',
      success: true,
      error: '',
      output: {
        draft_id: 'dfd_image_1',
        draft_url: 'https://www.vectcut.com/draft/downloader?draft_id=dfd_image_1',
        marterial_id: 'image_mat_1',
        material_id: 'image_mat_1'
      }
    })
  })

  it('should add video with camelCase aliases normalized to snake_case', async () => {
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
          output: {
            draft_id: 'dfd_video_1',
            draft_url: 'https://www.vectcut.com/draft/downloader?draft_id=dfd_video_1',
            material_id: 'video_mat_1'
          },
          success: true
        })
      )

    const server = createServer()
    const result = await callTool(server, 'add_video', {
      videoUrl: 'https://example.com/demo.mp4',
      draftId: 'dfd_video_1',
      targetStart: 3,
      introAnimationDuration: 0.5
    })

    expect(mockNetFetch).toHaveBeenNthCalledWith(
      2,
      'https://open.vectcut.com/cut_jianying/add_video',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          video_url: 'https://example.com/demo.mp4',
          draft_id: 'dfd_video_1',
          target_start: 3,
          intro_animation_duration: 0.5
        })
      })
    )
    expect(JSON.parse(result.content[0].text)).toEqual({
      provider: 'vectcut',
      action: 'add_video',
      success: true,
      error: '',
      output: {
        draft_id: 'dfd_video_1',
        draft_url: 'https://www.vectcut.com/draft/downloader?draft_id=dfd_video_1',
        material_id: 'video_mat_1'
      }
    })
  })

  it('should add audio with camelCase aliases normalized to snake_case', async () => {
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
          output: {
            draft_id: 'dfd_audio_1',
            draft_url: 'https://www.vectcut.com/draft/downloader?draft_id=dfd_audio_1',
            material_id: 'audio_mat_1'
          },
          success: true
        })
      )

    const server = createServer()
    const result = await callTool(server, 'add_audio', {
      audioUrl: 'https://example.com/demo.mp3',
      draftId: 'dfd_audio_1',
      targetStart: 4,
      effectType: '回音'
    })

    expect(mockNetFetch).toHaveBeenNthCalledWith(
      2,
      'https://open.vectcut.com/cut_jianying/add_audio',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          audio_url: 'https://example.com/demo.mp3',
          draft_id: 'dfd_audio_1',
          target_start: 4,
          effect_type: '回音'
        })
      })
    )
    expect(JSON.parse(result.content[0].text)).toEqual({
      provider: 'vectcut',
      action: 'add_audio',
      success: true,
      error: '',
      output: {
        draft_id: 'dfd_audio_1',
        draft_url: 'https://www.vectcut.com/draft/downloader?draft_id=dfd_audio_1',
        material_id: 'audio_mat_1'
      }
    })
  })
})
