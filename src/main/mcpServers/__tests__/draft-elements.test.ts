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
type ListedTool = {
  name: string
  inputSchema: {
    properties: Record<string, unknown>
    required?: string[]
  }
}

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
      'add_preset',
      'add_batch_preset',
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

  it('should expose official VectCut params and required fields for representative tools', async () => {
    const server = createServer()
    const result = await listTools(server)
    const toolsByName = new Map<string, ListedTool>(result.tools.map((tool: ListedTool) => [tool.name, tool]))

    expect(Object.keys(toolsByName.get('add_text').inputSchema.properties)).toEqual(
      expect.arrayContaining([
        'font',
        'font_color',
        'font_size',
        'background_color',
        'shadow_enabled',
        'loop_animation',
        'transform_x_px',
        'bold'
      ])
    )
    expect(Object.keys(toolsByName.get('modify_text').inputSchema.properties)).toEqual(
      expect.arrayContaining(['start', 'end', 'align', 'rotation', 'bubble_effect_id', 'text_styles'])
    )
    expect(Object.keys(toolsByName.get('add_subtitle').inputSchema.properties)).toEqual(
      expect.arrayContaining(['font', 'bold', 'font_color', 'background_color', 'transform_x_px'])
    )
    expect(Object.keys(toolsByName.get('add_batch_text').inputSchema.properties)).toEqual(
      expect.arrayContaining(['end', 'ends', 'font', 'background_color', 'shadow_enabled', 'text_styles'])
    )
    expect(Object.keys(toolsByName.get('add_image').inputSchema.properties)).toEqual(
      expect.arrayContaining(['transition', 'mask_type', 'background_blur', 'mix_type'])
    )
    expect(Object.keys(toolsByName.get('add_batch_image').inputSchema.properties)).toEqual(
      expect.arrayContaining(['width', 'transition', 'mask_type', 'background_blur', 'mix_type'])
    )
    expect(toolsByName.get('add_preset').inputSchema.required).toEqual(['preset_id'])
    expect(Object.keys(toolsByName.get('add_preset').inputSchema.properties)).toEqual(
      expect.arrayContaining(['preset_id', 'replacements', 'target_start', 'track_name', 'rotation'])
    )
    expect(toolsByName.get('add_batch_preset').inputSchema.required).toEqual(['preset_ids', 'starts', 'ends'])
    expect(Object.keys(toolsByName.get('add_batch_preset').inputSchema.properties)).toEqual(
      expect.arrayContaining(['preset_ids', 'replacements', 'starts', 'ends', 'target_starts', 'target_ends'])
    )
    expect(Object.keys(toolsByName.get('modify_image').inputSchema.properties)).toEqual(
      expect.arrayContaining(['transition', 'mask_type', 'background_blur', 'mix_type'])
    )
    expect(Object.keys(toolsByName.get('add_video').inputSchema.properties)).toEqual(
      expect.arrayContaining(['speed', 'duration', 'transition', 'volume', 'mask_type'])
    )
    expect(Object.keys(toolsByName.get('add_batch_video').inputSchema.properties)).toEqual(
      expect.arrayContaining(['durations', 'speed', 'transition', 'volume', 'mask_type'])
    )
    expect(Object.keys(toolsByName.get('modify_video').inputSchema.properties)).toEqual(
      expect.arrayContaining(['target_start', 'speed', 'duration', 'transition', 'rotation'])
    )
    expect(Object.keys(toolsByName.get('add_audio').inputSchema.properties)).toEqual(
      expect.arrayContaining(['speed', 'duration', 'effect_type', 'effect_params', 'fade_out_duratioin'])
    )
    expect(Object.keys(toolsByName.get('add_batch_audio').inputSchema.properties)).toEqual(
      expect.arrayContaining(['durations', 'speed', 'effect_type', 'effect_params', 'fade_out_duratioin'])
    )
    expect(Object.keys(toolsByName.get('modify_audio').inputSchema.properties)).toEqual(
      expect.arrayContaining(['speed', 'duration', 'effect_type', 'effect_params', 'fade_out_duratioin'])
    )
    expect(toolsByName.get('add_effect').inputSchema.required).toEqual(['effect_type', 'effect_category'])
    expect(Object.keys(toolsByName.get('add_effect').inputSchema.properties)).toEqual(
      expect.arrayContaining(['start', 'end', 'track_name', 'params', 'width', 'height'])
    )
    expect(toolsByName.get('add_filter').inputSchema.required).toEqual(['filter_type', 'start', 'end'])
    expect(Object.keys(toolsByName.get('add_filter').inputSchema.properties)).toEqual(
      expect.arrayContaining(['track_name', 'relative_index', 'intensity', 'width', 'height'])
    )
    expect(toolsByName.get('modify_filter').inputSchema.required).toEqual(['material_id'])
  })

  it('should normalize add_batch_text official end param into runtime ends', async () => {
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
            draft_id: 'dfd_batch_text_1',
            draft_url: 'https://www.vectcut.com/draft/downloader?draft_id=dfd_batch_text_1'
          },
          success: true
        })
      )

    const server = createServer()
    await callTool(server, 'add_batch_text', {
      texts: ['第一段', '第二段'],
      starts: [0, 2],
      end: [1, 3],
      draftId: 'dfd_batch_text_1',
      font: '系统'
    })

    expect(mockNetFetch).toHaveBeenNthCalledWith(
      2,
      'https://open.vectcut.com/cut_jianying/add_batch_text',
      expect.objectContaining({ method: 'POST' })
    )
    const requestInit = mockNetFetch.mock.calls[1][1] as { body: string }
    expect(JSON.parse(requestInit.body)).toEqual({
      texts: ['第一段', '第二段'],
      starts: [0, 2],
      end: [1, 3],
      ends: [1, 3],
      draft_id: 'dfd_batch_text_1',
      font: '系统'
    })
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

  it('should add preset with camelCase aliases normalized to snake_case', async () => {
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
            draft_id: 'dfd_preset_1',
            draft_url: 'https://www.vectcut.com/draft/downloader?draft_id=dfd_preset_1'
          },
          success: true
        })
      )

    const server = createServer()
    const result = await callTool(server, 'add_preset', {
      presetId: 'preset_123',
      draftId: 'dfd_preset_1',
      targetStart: 2,
      trackName: 'my_preset_track',
      replacements: [{ text1: '流光剪辑' }]
    })

    expect(mockNetFetch).toHaveBeenNthCalledWith(
      2,
      'https://open.vectcut.com/cut_jianying/add_preset',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          preset_id: 'preset_123',
          draft_id: 'dfd_preset_1',
          target_start: 2,
          track_name: 'my_preset_track',
          replacements: [{ text1: '流光剪辑' }]
        })
      })
    )
    expect(JSON.parse(result.content[0].text)).toEqual({
      provider: 'vectcut',
      action: 'add_preset',
      success: true,
      error: '',
      output: {
        draft_id: 'dfd_preset_1',
        draft_url: 'https://www.vectcut.com/draft/downloader?draft_id=dfd_preset_1'
      }
    })
  })

  it('should add batch preset with camelCase aliases normalized to snake_case', async () => {
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
            draft_id: 'dfd_batch_preset_1',
            draft_url: 'https://www.vectcut.com/draft/downloader?draft_id=dfd_batch_preset_1'
          },
          success: true
        })
      )

    const server = createServer()
    const result = await callTool(server, 'add_batch_preset', {
      presetIds: ['preset_a', 'preset_b'],
      starts: [0, 0],
      ends: [5, 3],
      targetStarts: [2, 7],
      targetEnds: [7, 10],
      replacements: [[{ text1: '第一段预设' }], [{ text1: '第二段预设' }]]
    })

    expect(mockNetFetch).toHaveBeenNthCalledWith(
      2,
      'https://open.vectcut.com/cut_jianying/add_batch_preset',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          preset_ids: ['preset_a', 'preset_b'],
          starts: [0, 0],
          ends: [5, 3],
          target_starts: [2, 7],
          target_ends: [7, 10],
          replacements: [[{ text1: '第一段预设' }], [{ text1: '第二段预设' }]]
        })
      })
    )
    expect(JSON.parse(result.content[0].text)).toEqual({
      provider: 'vectcut',
      action: 'add_batch_preset',
      success: true,
      error: '',
      output: {
        draft_id: 'dfd_batch_preset_1',
        draft_url: 'https://www.vectcut.com/draft/downloader?draft_id=dfd_batch_preset_1'
      }
    })
  })

  it('should keep local file paths in image_url before add_image', async () => {
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
            draft_id: 'dfd_image_local',
            material_id: 'image_mat_local'
          },
          success: true
        })
      )

    const server = createServer()
    await callTool(server, 'add_image', {
      imageUrl: '/tmp/demo.png',
      end: 8
    })

    expect(JSON.parse(mockNetFetch.mock.calls[1][1].body as string)).toEqual({
      image_url: '/tmp/demo.png',
      end: 8
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

  it('should keep local file URLs in video_url before add_video', async () => {
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
            draft_id: 'dfd_video_local',
            material_id: 'video_mat_local'
          },
          success: true
        })
      )

    const server = createServer()
    await callTool(server, 'add_video', {
      videoUrl: 'file:///tmp/demo.mp4',
      targetStart: 3
    })

    expect(JSON.parse(mockNetFetch.mock.calls[1][1].body as string)).toEqual({
      video_url: 'file:///tmp/demo.mp4',
      target_start: 3
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

  it('should keep local file paths in audio_url before add_audio', async () => {
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
            draft_id: 'dfd_audio_local',
            material_id: 'audio_mat_local'
          },
          success: true
        })
      )

    const server = createServer()
    await callTool(server, 'add_audio', {
      audioUrl: '/tmp/demo.mp3',
      effectType: '回音'
    })

    expect(JSON.parse(mockNetFetch.mock.calls[1][1].body as string)).toEqual({
      audio_url: '/tmp/demo.mp3',
      effect_type: '回音'
    })
  })
})
