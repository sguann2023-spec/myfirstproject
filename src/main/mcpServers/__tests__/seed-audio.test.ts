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

import SeedAudioServer from '../seed-audio'

type SeedAudioServerInstance = InstanceType<typeof SeedAudioServer>

function createServer() {
  return new SeedAudioServer()
}

async function callTool(server: SeedAudioServerInstance, args: Record<string, unknown>) {
  const handlers = (server.mcpServer.server as any)._requestHandlers
  const callToolHandler = handlers?.get('tools/call')
  if (!callToolHandler) {
    throw new Error('No tools/call handler registered')
  }
  return callToolHandler({ method: 'tools/call', params: { name: 'generate_seed_audio', arguments: args } }, {})
}

async function listTools(server: SeedAudioServerInstance) {
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

describe('SeedAudioServer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStoreGet.mockImplementation((key: string) => (key === 'auth.refresh_token' ? 'refresh-token' : undefined))
  })

  it('should expose only the generate_seed_audio tool', async () => {
    const server = createServer()
    const result = await listTools(server)

    expect(result.tools).toHaveLength(1)
    expect(result.tools[0].name).toBe('generate_seed_audio')
  })

  it('should generate seed audio with default model', async () => {
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
          success: true,
          provider: 'volc',
          model: 'seed-audio-1.0',
          url: 'https://example.com/seed-audio.wav',
          text_prompt: '多人对话，带背景音乐和音效',
          voice_id: null,
          duration_seconds: 18.2,
          resource_amount: 1,
          project_id: 105
        })
      )

    const server = createServer()
    const result = await callTool(server, {
      textPrompt: '  多人对话，带背景音乐和音效  ',
      speaker: 'female_1',
      audioUrl: 'https://example.com/ref.mp3',
      imageUrl: 'https://example.com/ref.png',
      audioConfig: {
        format: 'wav',
        sample_rate: 44100
      }
    })

    expect(mockStoreSet).toHaveBeenCalledWith('auth.refresh_token', 'refresh-token-next')
    expect(mockNetFetch).toHaveBeenNthCalledWith(
      2,
      'https://open.vectcut.com/llm/tts/seed_audio/generate',
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
      text_prompt: '多人对话，带背景音乐和音效',
      model: 'seed-audio-1.0',
      speaker: 'female_1',
      audio_url: 'https://example.com/ref.mp3',
      image_url: 'https://example.com/ref.png',
      audio_config: {
        format: 'wav',
        sample_rate: 44100
      }
    })

    expect(JSON.parse(result.content[0].text)).toEqual({
      provider: 'volc',
      action: 'generate_seed_audio',
      request: {
        model: 'seed-audio-1.0',
        text_prompt: '多人对话，带背景音乐和音效',
        voice_id: undefined,
        speaker: 'female_1'
      },
      success: true,
      model: 'seed-audio-1.0',
      url: 'https://example.com/seed-audio.wav',
      text_prompt: '多人对话，带背景音乐和音效',
      voice_id: null,
      duration_seconds: 18.2,
      resource_amount: 1,
      project_id: 105
    })
  })

  it('should accept snake_case payload fields', async () => {
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
          provider: 'volc',
          model: 'seed-audio-1.0',
          url: 'https://example.com/seed-audio-2.wav',
          text_prompt: '老年女声回忆往事',
          voice_id: 'speaker_ref_1',
          duration_seconds: 38.6,
          resource_amount: 1,
          project_id: 105
        })
      )

    const server = createServer()
    await callTool(server, {
      text_prompt: '老年女声回忆往事',
      voice_id: 'speaker_ref_1',
      references: [{ audio_url: 'https://example.com/sample.mp3' }],
      model: 'seed-audio-1.0'
    })

    expect(JSON.parse(mockNetFetch.mock.calls[1][1].body as string)).toEqual({
      text_prompt: '老年女声回忆往事',
      voice_id: 'speaker_ref_1',
      references: [{ audio_url: 'https://example.com/sample.mp3' }],
      model: 'seed-audio-1.0'
    })
  })
})
