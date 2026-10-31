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
      prompt: '  多人对话，带背景音乐和音效  ',
      speaker: 'female_1',
      audioUrl: 'https://example.com/ref.mp3',
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
      references: [
        { audio_url: 'https://example.com/ref.mp3' },
        { voice_id: 'female_1' }
      ],
      audio_config: {
        format: 'wav',
        sample_rate: 44100
      }
    })

    expect(JSON.parse(result.content[0].text)).toMatchObject({
      action: 'generate_seed_audio',
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
      references: [
        { audio_url: 'https://example.com/sample.mp3' },
        { voice_id: 'speaker_ref_1' }
      ],
      model: 'seed-audio-1.0'
    })
  })

  it('should still accept legacy textPrompt alias', async () => {
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
          url: 'https://example.com/seed-audio-legacy.wav',
          text_prompt: '科幻感女声，带轻微电子氛围',
          voice_id: null
        })
      )

    const server = createServer()
    await callTool(server, {
      textPrompt: '  科幻感女声，带轻微电子氛围  '
    })

    expect(JSON.parse(mockNetFetch.mock.calls[1][1].body as string)).toEqual({
      text_prompt: '科幻感女声，带轻微电子氛围',
      model: 'seed-audio-1.0'
    })
  })

  it('accepts three audio references and one voice ID', async () => {
    const server = createServer()
    const result = await (server as any).buildSeedAudioPayload({
      prompt: '@音频1 @音频2 @音频3',
      references: [
        { voice_id: 'gv_1' },
        { audio_url: 'https://example.com/1.mp3' },
        { audio_url: 'https://example.com/2.mp3' },
        { audio_url: 'https://example.com/3.mp3' }
      ]
    })
    expect(result.payload.references).toEqual([
      { audio_url: 'https://example.com/1.mp3' },
      { audio_url: 'https://example.com/2.mp3' },
      { audio_url: 'https://example.com/3.mp3' },
      { voice_id: 'gv_1' }
    ])
  })

  it('rejects more than one voice ID before uploading', async () => {
    await expect((createServer() as any).buildSeedAudioPayload({
      prompt: 'test', voice_ids: ['gv_1', 'gv_2']
    })).rejects.toThrow('At most 1 voice ID')
    expect(mockNetFetch).not.toHaveBeenCalled()
  })

  it('rejects a reference image combined with a voice ID', async () => {
    await expect((createServer() as any).buildSeedAudioPayload({
      prompt: 'test',
      references: [{ voice_id: 'gv_1' }, { image_url: 'https://example.com/image.png' }]
    })).rejects.toThrow('Reference image cannot be used together with speaker')
  })
})


describe('SeedAudioServer external', () => {
  const invoke = (server: SeedAudioServerInstance, name: string, args: Record<string, unknown>) =>
    (server.mcpServer.server as any)._requestHandlers.get('tools/call')({ method: 'tools/call', params: { name, arguments: args } }, {})
  beforeEach(() => vi.resetAllMocks())
  it('hides and rejects the legacy tool', async () => {
    const server = new SeedAudioServer({ external: true })
    expect((await listTools(server)).tools.map((t: any) => t.name)).toEqual(['submit', 'task_status'])
    expect((await invoke(server, 'generate_seed_audio', { prompt: 'test' })).isError).toBe(true)
    expect(mockNetFetch).not.toHaveBeenCalled()
  })
  it.each([
    { audioUrl: '/tmp/local.mp3' }, { audio_url: 'http://127.1/a' },
    { audioData: 'base64' }, { references: [{ audio_url: 'file:///tmp/a' }] },
    { referenceAudios: ['https://user:pass@example.com/a'] },
    { referenceImage: 'http://[::1]/a' }, { audioUrl: 'https://example.com/a', audio_url: '/hidden' },
    { audioConfig: { source: 'http://192.168.1.1/a' } }
  ])('rejects unsafe aliases before I/O: %j', async args => {
    const result = await invoke(new SeedAudioServer({ external: true }), 'submit', { prompt: 'test', ...args })
    expect(result.isError).toBe(true)
    expect(mockNetFetch).not.toHaveBeenCalled()
  })
  it('returns before generation resolves and retains billed failure', async () => {
    const server = new SeedAudioServer({ external: true })
    let finish!: (r: Response) => void
    ;(server as any).requestWithAuth = vi.fn(() => new Promise<Response>(resolve => { finish = resolve }))
    const submitted = JSON.parse((await invoke(server, 'submit', { prompt: 'test', audioUrl: 'https://example.com/a.mp3' })).content[0].text)
    expect(submitted.tracking).toBe('process_local')
    expect(JSON.parse((await invoke(server, 'task_status', { task_id: submitted.task_id })).content[0].text).status).toBe('running')
    finish(mockJsonResponse({ success: false, error: 'provider failure', billing: { amount: 2 } }))
    await new Promise(resolve => setImmediate(resolve))
    const failed = await invoke(server, 'task_status', { task_id: submitted.task_id })
    expect(failed.isError).toBe(true)
    expect(JSON.parse(failed.content[0].text)).toMatchObject({ status: 'failed', billing: { amount: 2 }, error: 'provider failure' })
    expect((server as any).requestWithAuth).toHaveBeenCalledTimes(1)
    expect((await invoke(new SeedAudioServer({ external: true }), 'task_status', { task_id: submitted.task_id })).isError).toBe(true)
  })
  it('shares running and completed tasks across independent transport servers', async () => {
    const owner = new SeedAudioServer({ external: true })
    const first = owner.createMcpServer()
    const second = owner.createMcpServer()
    expect(first).not.toBe(second)
    expect(first).not.toBe(owner.mcpServer)
    const call = (transport: typeof first, name: string, args: Record<string, unknown>) =>
      (transport.server as any)._requestHandlers.get('tools/call')({ method: 'tools/call', params: { name, arguments: args } }, {})
    let finish!: (response: Response) => void
    ;(owner as any).requestWithAuth = vi.fn(() => new Promise<Response>(resolve => { finish = resolve }))
    const submitted = JSON.parse((await call(first, 'submit', { prompt: 'test' })).content[0].text)
    await first.close()
    expect(JSON.parse((await call(second, 'task_status', { task_id: submitted.task_id })).content[0].text).status).toBe('running')
    finish(mockJsonResponse({ success: true, url: 'https://example.com/generated.mp3', billing: { amount: 1 } }))
    await new Promise(resolve => setImmediate(resolve))
    const third = owner.createMcpServer()
    expect(JSON.parse((await call(third, 'task_status', { task_id: submitted.task_id })).content[0].text)).toMatchObject({ status: 'completed', billing: { amount: 1 }, url: 'https://example.com/generated.mp3' })
    expect((owner as any).requestWithAuth).toHaveBeenCalledTimes(1)
    await second.close()
    await third.close()
    await owner.mcpServer.close()
  })
  it('times out a stalled response body and does not overwrite timeout after late parsing', async () => {
    vi.useFakeTimers()
    try {
      const server = new SeedAudioServer({ external: true })
      let finishBody!: (body: unknown) => void
      const json = vi.fn(() => new Promise(resolve => { finishBody = resolve }))
      ;(server as any).requestWithAuth = vi.fn().mockResolvedValue({ ok: true, json })
      const submitted = JSON.parse((await invoke(server, 'submit', { prompt: 'test' })).content[0].text)
      expect(json).toHaveBeenCalledTimes(1)
      expect(JSON.parse((await invoke(server, 'task_status', { task_id: submitted.task_id })).content[0].text).status).toBe('running')
      await vi.advanceTimersByTimeAsync(35 * 60 * 1000)
      const failed = await invoke(server, 'task_status', { task_id: submitted.task_id })
      expect(failed.isError).toBe(true)
      expect(JSON.parse(failed.content[0].text)).toMatchObject({ status: 'failed', error: expect.stringContaining('timed out') })
      finishBody({ success: true, url: 'https://example.com/late.mp3' })
      await vi.advanceTimersByTimeAsync(0)
      expect(await invoke(server, 'task_status', { task_id: submitted.task_id })).toEqual(failed)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
  it('bounds retained tasks and rejects expired or missing task ids', async () => {
    const server = new SeedAudioServer({ external: true })
    const tasks = (server as any).tasks
    for (let i = 0; i < 100; i++) tasks.set(String(i), { status: 'running', updatedAt: Date.now() })
    expect((await invoke(server, 'submit', { prompt: 'test' })).isError).toBe(true)
    tasks.set('expired', { status: 'completed', updatedAt: Date.now() - 3600_001 })
    expect((await invoke(server, 'task_status', { task_id: 'expired' })).isError).toBe(true)
    expect((await invoke(server, 'task_status', {})).isError).toBe(true)
    expect(mockNetFetch).not.toHaveBeenCalled()
  })

})
