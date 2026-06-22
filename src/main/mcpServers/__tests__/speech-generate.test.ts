import { beforeEach, describe, expect, it, vi } from 'vitest'

const VOICE_SELECTED_STORAGE_KEY = 'chat-panel:selected-voice-library-item'

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

import SpeechGenerateServer from '../speech-generate'

type SpeechGenerateServerInstance = InstanceType<typeof SpeechGenerateServer>

function createServer() {
  return new SpeechGenerateServer()
}

async function callTool(server: SpeechGenerateServerInstance, args: Record<string, unknown>) {
  const handlers = (server.mcpServer.server as any)._requestHandlers
  const callToolHandler = handlers?.get('tools/call')
  if (!callToolHandler) {
    throw new Error('No tools/call handler registered')
  }
  return callToolHandler({ method: 'tools/call', params: { name: 'generate_speech', arguments: args } }, {})
}

async function listTools(server: SpeechGenerateServerInstance) {
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

describe('SpeechGenerateServer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStoreGet.mockImplementation((key: string) => {
      if (key === 'auth.refresh_token') return 'refresh-token'
      return undefined
    })
  })

  it('should expose only the generate_speech tool', async () => {
    const server = createServer()
    const result = await listTools(server)

    expect(result.tools).toHaveLength(1)
    expect(result.tools[0].name).toBe('generate_speech')
  })

  it('should generate speech with default minimax provider and voice', async () => {
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
            audio_url: 'https://example.com/audio.mp3',
            draft_id: 'draft-1',
            material_id: 'material-1'
          },
          purchase_link: 'https://www.vectcut.com',
          success: true
        })
      )

    const server = createServer()
    const result = await callTool(server, {
      text: '  你好，欢迎使用语音合成  ',
      speechSpeed: 1.2,
      targetStart: 3,
      effectType: '麦霸',
      effectParams: [45, 80]
    })

    expect(mockStoreSet).toHaveBeenCalledWith('auth.refresh_token', 'refresh-token-next')
    expect(mockStoreSet).toHaveBeenCalledWith(VOICE_SELECTED_STORAGE_KEY, {
      global_voice_id: 'gv_6e52beeb34614e13ab166b64d08fe8c2',
      providers: 'minimax'
    })
    expect(mockNetFetch).toHaveBeenNthCalledWith(
      2,
      'https://open.vectcut.com/cut_jianying/generate_speech',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
          'Content-Type': 'application/json'
        }),
        body: expect.any(String)
      })
    )
    expect(JSON.parse(mockNetFetch.mock.calls[1][1].body as string)).toEqual({
      provider: 'minimax',
      text: '你好，欢迎使用语音合成',
      voice_id: 'gv_6e52beeb34614e13ab166b64d08fe8c2',
      speech_speed: 1.2,
      target_start: 3,
      effect_type: '麦霸',
      effect_params: [45, 80]
    })

    expect(JSON.parse(result.content[0].text)).toEqual({
      provider: 'vectcut',
      action: 'generate_speech',
      request: {
        provider: 'minimax',
        voice_id: 'gv_6e52beeb34614e13ab166b64d08fe8c2'
      },
      error: '',
      output: {
        audio_url: 'https://example.com/audio.mp3',
        draft_id: 'draft-1',
        material_id: 'material-1'
      },
      purchase_link: 'https://www.vectcut.com',
      success: true
    })
  })

  it('should preserve explicit provider and model', async () => {
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
            audio_url: 'https://example.com/audio.mp3'
          },
          success: true
        })
      )

    const server = createServer()
    const result = await callTool(server, {
      text: 'hello',
      provider: 'minimax',
      model: 'speech-2.6-turbo',
      voiceId: 'audiobook_male_1',
      draftId: 'draft-1',
      trackName: 'audio_speech'
    })

    expect(mockStoreSet).toHaveBeenCalledWith(VOICE_SELECTED_STORAGE_KEY, {
      global_voice_id: 'audiobook_male_1',
      providers: 'minimax'
    })
    expect(mockNetFetch).toHaveBeenNthCalledWith(
      2,
      'https://open.vectcut.com/cut_jianying/generate_speech',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
          'Content-Type': 'application/json'
        }),
        body: expect.any(String)
      })
    )
    expect(JSON.parse(mockNetFetch.mock.calls[1][1].body as string)).toEqual({
      provider: 'minimax',
      text: 'hello',
      model: 'speech-2.6-turbo',
      voice_id: 'audiobook_male_1',
      draft_id: 'draft-1',
      track_name: 'audio_speech'
    })

    expect(JSON.parse(result.content[0].text)).toEqual({
      provider: 'vectcut',
      action: 'generate_speech',
      request: {
        provider: 'minimax',
        model: 'speech-2.6-turbo',
        voice_id: 'audiobook_male_1'
      },
      error: '',
      output: {
        audio_url: 'https://example.com/audio.mp3'
      },
      success: true
    })
  })

  it('should accept snake_case fields from the public API docs', async () => {
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
            audio_url: 'https://example.com/audio.mp3',
            draft_url: 'https://www.vectcut.com/draft/downloader?draft_id=draft-2'
          },
          success: true
        })
      )

    const server = createServer()
    const result = await callTool(server, {
      text: 'snake case payload',
      provider: 'fish',
      voice_id: 'gv_snake_case',
      speech_speed: 0.9,
      target_start: 12,
      draft_id: 'draft-2',
      only_tts: true,
      track_name: 'audio_speech',
      effect_type: '麦霸',
      effect_params: [45, 80],
      fade_in_duration: 0.5,
      fade_out_duration: 0.8,
      license_key: 'deprecated-key'
    })

    expect(mockStoreSet).toHaveBeenCalledWith(VOICE_SELECTED_STORAGE_KEY, {
      global_voice_id: 'gv_snake_case',
      providers: 'fish'
    })
    expect(JSON.parse(mockNetFetch.mock.calls[1][1].body as string)).toEqual({
      provider: 'fish',
      text: 'snake case payload',
      voice_id: 'gv_snake_case',
      speech_speed: 0.9,
      target_start: 12,
      draft_id: 'draft-2',
      only_tts: true,
      track_name: 'audio_speech',
      effect_type: '麦霸',
      effect_params: [45, 80],
      fade_in_duration: 0.5,
      fade_out_duration: 0.8,
      license_key: 'deprecated-key'
    })

    expect(JSON.parse(result.content[0].text)).toEqual({
      provider: 'vectcut',
      action: 'generate_speech',
      request: {
        provider: 'fish',
        voice_id: 'gv_snake_case'
      },
      error: '',
      output: {
        audio_url: 'https://example.com/audio.mp3',
        draft_url: 'https://www.vectcut.com/draft/downloader?draft_id=draft-2'
      },
      success: true
    })
  })

  it('should use default voiceId when omitted', async () => {
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
            audio_url: 'https://example.com/audio.mp3'
          },
          success: true
        })
      )

    const server = createServer()
    const result = await callTool(server, {
      text: 'hello'
    })

    expect(result.isError).not.toBe(true)
    expect(JSON.parse(mockNetFetch.mock.calls[1][1].body as string)).toEqual({
      provider: 'minimax',
      text: 'hello',
      voice_id: 'gv_6e52beeb34614e13ab166b64d08fe8c2'
    })
  })

  it('should prefer persisted selected voice and provider when omitted', async () => {
    mockStoreGet.mockImplementation((key: string) => {
      if (key === 'auth.refresh_token') return 'refresh-token'
      if (key === VOICE_SELECTED_STORAGE_KEY) {
        return {
          global_voice_id: 'gv_cached_voice',
          providers: 'fish',
          title: '缓存音色'
        }
      }
      return undefined
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
          error: '',
          output: {
            audio_url: 'https://example.com/audio.mp3'
          },
          success: true
        })
      )

    const server = createServer()
    await callTool(server, {
      text: 'use cached voice'
    })

    expect(JSON.parse(mockNetFetch.mock.calls[1][1].body as string)).toEqual({
      provider: 'fish',
      text: 'use cached voice',
      voice_id: 'gv_cached_voice'
    })
    expect(mockStoreSet).toHaveBeenCalledWith(VOICE_SELECTED_STORAGE_KEY, {
      global_voice_id: 'gv_cached_voice',
      providers: 'fish',
      title: '缓存音色'
    })
  })
})
