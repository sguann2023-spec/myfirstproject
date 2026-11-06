import { beforeEach, describe, expect, it, vi } from 'vitest'

const VOICE_SELECTED_STORAGE_KEY = 'chat-panel:selected-voice-library-item'

const { mockNetFetch, mockStoreGet, mockStoreSet, mockSend, mockGetMainWindow } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockGetMainWindow: vi.fn(),
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

vi.mock('@main/services/WindowService', () => ({
  windowService: { getMainWindow: mockGetMainWindow }
}))

import SpeechGenerateServer, { generateSpeechAudio } from '../speech-generate'

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
    mockSend.mockReset()
    mockGetMainWindow.mockReset().mockReturnValue({
      isDestroyed: () => false,
      webContents: { send: mockSend }
    })
    mockStoreGet.mockImplementation((key: string) => {
      if (key === 'auth.refresh_token') return 'refresh-token'
      return undefined
    })
  })

  const queueSpeechResult = (result: unknown) => {
    mockNetFetch
      .mockResolvedValueOnce(mockJsonResponse({ access_token: 'access-token', expires_in: 3600 }))
      .mockResolvedValueOnce(mockJsonResponse(result))
  }

  it('emits a compact session-scoped completed event without changing the MCP response', async () => {
    const apiResult = {
      success: true,
      error: '',
      output: { audio_url: ' https://example.com/audio.mp3 ', duration: '12.5' },
      billing: { consume: '2.75', secret: 'not forwarded' },
      text: 'long private text'
    }
    queueSpeechResult(apiResult)
    const before = Date.now()
    const result = await callTool(new SpeechGenerateServer('session-1'), { text: '  实际用于生成的配音文案  ' })
    expect(mockSend).toHaveBeenCalledTimes(1)
    expect(mockSend).toHaveBeenCalledWith('app:audio-generated', {
      id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      runtimeSessionId: 'session-1',
      audioUrl: 'https://example.com/audio.mp3',
      text: '实际用于生成的配音文案',
      createdAt: expect.any(Number),
      status: 'completed',
      durationSeconds: 12.5,
      billing: { total_consumed_points: 2.75 }
    })
    expect(mockSend.mock.calls[0][1].createdAt).toBeGreaterThanOrEqual(before)
    expect(JSON.parse(result.content[0].text)).toMatchObject(apiResult)
  })

  it.each(['total_consumed_points', 'points_consumed', 'deduct_points', 'consume'])(
    'normalizes existing billing field %s including zero', async (field) => {
      queueSpeechResult({ success: true, output: { audio_url: 'https://example.com/a.mp3' }, billing: { [field]: '0' } })
      await callTool(new SpeechGenerateServer('session-1'), { text: 'hello' })
      expect(mockSend.mock.calls[0][1].billing).toEqual({ total_consumed_points: 0 })
    }
  )

  it.each([
    { total_consumed_points: '4', points_consumed: 9 },
    { output: { audio_url: 'https://example.com/a.mp3', points_consumed: '4' } }
  ])('normalizes top-level and output billing fields with existing precedence', async (fields) => {
    queueSpeechResult({ success: true, output: { audio_url: 'https://example.com/a.mp3' }, ...fields })
    await callTool(new SpeechGenerateServer('session-1'), { text: 'hello' })
    expect(mockSend.mock.calls[0][1].billing).toEqual({ total_consumed_points: 4 })
  })

  it('supports output billing and omits invalid optional metadata', async () => {
    queueSpeechResult({ success: true, output: { audio_url: 'https://example.com/a.mp3', duration: -1, billing: { deduct_points: 3 } } })
    await callTool(new SpeechGenerateServer('session-1'), { text: 'hello' })
    expect(mockSend.mock.calls[0][1].billing).toEqual({ total_consumed_points: 3 })
    expect(mockSend.mock.calls[0][1]).not.toHaveProperty('durationSeconds')
  })

  it.each([
    { success: false, output: { audio_url: 'https://example.com/a.mp3' } },
    { output: { audio_url: 'https://example.com/a.mp3' } },
    { success: true, error: 'failed', output: { audio_url: 'https://example.com/a.mp3' } },
    { success: true, error_code: 'failed', output: { audio_url: 'https://example.com/a.mp3' } },
    { success: true, output: {} },
    ...['', 'not a url', 'file:///tmp/a.mp3', 'javascript:alert(1)', 123].map(audio_url => ({ success: true, output: { audio_url } }))
  ])('does not notify for failed business results or invalid URLs: %j', async (apiResult) => {
    queueSpeechResult(apiResult)
    const result = await callTool(new SpeechGenerateServer('session-1'), { text: 'hello' })
    expect(result.isError).not.toBe(true)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it.each([undefined, '', '  '])('does not notify without a session (%s)', async (sessionId) => {
    queueSpeechResult({ success: true, output: { audio_url: 'https://example.com/a.mp3' } })
    await callTool(new SpeechGenerateServer(sessionId), { text: 'hello' })
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('notification errors cannot turn successful speech into an MCP error', async () => {
    queueSpeechResult({ success: true, output: { audio_url: 'https://example.com/a.mp3', duration: 'invalid' }, billing: { consume: 'NaN' } })
    mockSend.mockImplementation(() => { throw new Error('window closed') })
    const result = await callTool(new SpeechGenerateServer('session-1'), { text: 'hello' })
    expect(result.isError).not.toBe(true)
    expect(JSON.parse(result.content[0].text).success).toBe(true)
    expect(mockSend.mock.calls[0][1]).not.toHaveProperty('billing')
    expect(mockSend.mock.calls[0][1]).not.toHaveProperty('durationSeconds')
  })

  it.each([null, { isDestroyed: () => true }])('ignores unavailable windows', async (window) => {
    mockGetMainWindow.mockReturnValue(window)
    queueSpeechResult({ success: true, output: { audio_url: 'https://example.com/a.mp3' } })
    const result = await callTool(new SpeechGenerateServer('session-1'), { text: 'hello' })
    expect(result.isError).not.toBe(true)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('does not notify on transport failure', async () => {
    mockNetFetch
      .mockResolvedValueOnce(mockJsonResponse({ access_token: 'token' }))
      .mockResolvedValueOnce(mockJsonResponse({ error: 'failed' }, false, 500))
    const result = await callTool(new SpeechGenerateServer('session-1'), { text: 'hello' })
    expect(result.isError).toBe(true)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('keeps the shared generateSpeechAudio helper free of notification side effects', async () => {
    const apiResult = { success: true, output: { audio_url: 'https://example.com/a.mp3' } }
    const result = await generateSpeechAudio({ text: 'hello' }, {
      store: { get: mockStoreGet, set: mockStoreSet },
      request: async () => mockJsonResponse(apiResult)
    })
    expect(result.result).toEqual(apiResult)
    expect(mockGetMainWindow).not.toHaveBeenCalled()
    expect(mockSend).not.toHaveBeenCalled()
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

  it('should not pair an explicit voice ID with a persisted provider', async () => {
    mockStoreGet.mockImplementation((key: string) => {
      if (key === 'auth.refresh_token') return 'refresh-token'
      if (key === VOICE_SELECTED_STORAGE_KEY) {
        return {
          global_voice_id: 'gv_cached_voice',
          providers: 'volc'
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
      text: 'use explicit voice without provider',
      voice_id: 'pfetRIoSD753RDghCo31',
      only_tts: true
    })

    expect(JSON.parse(mockNetFetch.mock.calls[1][1].body as string)).toEqual({
      text: 'use explicit voice without provider',
      voice_id: 'pfetRIoSD753RDghCo31',
      only_tts: true
    })
    expect(mockStoreSet).not.toHaveBeenCalledWith(
      VOICE_SELECTED_STORAGE_KEY,
      expect.anything()
    )
  })
})
