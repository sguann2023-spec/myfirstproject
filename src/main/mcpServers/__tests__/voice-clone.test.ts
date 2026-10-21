import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetch, mockRefresh, mockUpload, mockStoreSet } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockRefresh: vi.fn(),
  mockUpload: vi.fn(),
  mockStoreSet: vi.fn()
}))
vi.mock('@main/services/agents/services/AgentRuntimeAuthService', () => ({
  agentRuntimeAuthService: { ensureValidAccessToken: mockRefresh }
}))
vi.mock('@main/services/network/MainHttpClient', () => ({
  mainHttpClient: { fetch: mockFetch }
}))
vi.mock('@main/services/OssUploadService', () => ({
  ossUploadService: { uploadLocalFile: mockUpload }
}))
vi.mock('electron-store', () => ({
  default: class {
    get() { return undefined }
    set = mockStoreSet
  }
}))
vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ error: vi.fn() }) }
}))

import VoiceLibraryServer from '../voice-library'

async function clone(args: Record<string, unknown>) {
  const server = new VoiceLibraryServer()
  const handlers = (server.mcpServer.server as any)._requestHandlers
  return handlers.get('tools/call')({ method: 'tools/call', params: { name: 'clone_voice', arguments: args } }, {})
}

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const sample = 'https://example.com/sample.mp3'

describe('Voice cloning MCP', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockRefresh.mockResolvedValue('access-token')
    mockFetch.mockImplementation(async () => response({ success: true, voice_id: 'cloned-voice' }))
    mockUpload.mockResolvedValue({ signedPublicUrl: 'https://example.com/uploaded.wav' })
  })

  it.each(['minimax', 'fish', 'elevenlabs'])('routes %s to its own backend and returns the voice ID', async (provider) => {
    const result = await clone({ provider, file_url: sample, title: ' My Voice ' })
    expect(mockFetch).toHaveBeenCalledWith(`https://open.vectcut.com/llm/tts/${provider}/clone_voice`, {
      method: 'POST',
      headers: { Authorization: 'Bearer access-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'My Voice', [provider === 'elevenlabs' ? 'file_urls' : 'file_url']: provider === 'elevenlabs' ? [sample] : sample })
    })
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      action: 'clone_voice', request: { provider }, voice_id: 'cloned-voice', success: true
    })
    expect(result.isError).not.toBe(true)
    expect(mockUpload).not.toHaveBeenCalled()
    expect(mockStoreSet).not.toHaveBeenCalled()
  })

  it('defaults to minimax', async () => {
    await clone({ file_url: sample })
    expect(mockFetch.mock.calls[0][0]).toContain('/minimax/clone_voice')
  })

  it('uploads an absolute local path without transcoding', async () => {
    await clone({ file_url: '/tmp/voice-sample.flac', provider: 'fish' })
    expect(mockUpload).toHaveBeenCalledWith('/tmp/voice-sample.flac', expect.objectContaining({
      folder: 'agent_tmp/{uid}', signExpiresSeconds: 3600
    }))
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ file_url: 'https://example.com/uploaded.wav' })
  })

  it('accepts file URLs and uploads repeated local samples only once', async () => {
    await clone({
      provider: 'elevenlabs',
      file_urls: ['file:///tmp/my%20voice.wav', '/tmp/my voice.wav', sample],
      file_url: sample,
      description: ' Narrator ',
      labels: { accent: 'Chinese', gender: 'female' },
      remove_background_noise: false
    })
    expect(mockUpload).toHaveBeenCalledExactlyOnceWith('/tmp/my voice.wav', expect.any(Object))
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
      description: 'Narrator',
      labels: { accent: 'Chinese', gender: 'female' },
      remove_background_noise: false,
      file_urls: ['https://example.com/uploaded.wav', sample]
    })
  })

  it('passes ElevenLabs noise removal explicitly', async () => {
    await clone({ provider: 'elevenlabs', file_urls: [sample], remove_background_noise: true })
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).remove_background_noise).toBe(true)
  })

  it.each([
    {},
    { provider: 'azure', file_url: sample },
    { provider: null, file_url: sample },
    { file_url: '' },
    { file_url: 'voice.wav' },
    { file_url: 'ftp://example.com/voice.wav' },
    { file_url: 'https://[' },
    { file_url: 'file://remote-host/voice.wav' },
    { file_url: 123 },
    { file_url: sample, title: null },
    { file_url: sample, file_urls: [sample] },
    { file_url: sample, description: 'unsupported' },
    { provider: 'fish', file_url: sample, remove_background_noise: false },
    { provider: 'elevenlabs', file_urls: [] },
    { provider: 'elevenlabs', file_urls: sample },
    { provider: 'elevenlabs', file_urls: [sample, null] },
    { provider: 'elevenlabs', file_urls: [sample], labels: [] },
    { provider: 'elevenlabs', file_urls: [sample], labels: { accent: 1 } },
    { provider: 'elevenlabs', file_urls: [sample], remove_background_noise: 'false' },
    { file_url: sample, endpoint: '/other' }
  ])('rejects invalid input before upload or backend calls: %j', async (args) => {
    const result = await clone(args)
    expect(result.isError).toBe(true)
    expect(mockUpload).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('validates all samples before uploading the first local file', async () => {
    const result = await clone({ provider: 'elevenlabs', file_urls: ['/tmp/valid.wav', 'relative.wav'] })
    expect(result.isError).toBe(true)
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('does not clone when uploading fails', async () => {
    mockUpload.mockRejectedValueOnce(new Error('FILE_TOO_LARGE'))
    const result = await clone({ file_url: '/tmp/too-large.wav' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('FILE_TOO_LARGE')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('preserves backend membership and slot rejection details', async () => {
    const body = { success: false, error: 'Clone slots full', slot_limit: 3, used_slots: 3, cleanup: { removed: [] } }
    mockFetch.mockResolvedValueOnce(response(body, 403))
    const result = await clone({ provider: 'elevenlabs', file_url: sample })
    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0].text)).toMatchObject({ ...body, http_status: 403 })
    expect(mockFetch).toHaveBeenCalledOnce()
  })

  it('marks business failure on HTTP 200 as an error and preserves billing details', async () => {
    mockFetch.mockResolvedValueOnce(response({ success: false, error: 'Not enough points', purchase_link: 'https://example.com/buy' }))
    const result = await clone({ file_url: sample })
    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0].text).purchase_link).toBe('https://example.com/buy')
    expect(mockFetch).toHaveBeenCalledOnce()
  })

  it('preserves successful ElevenLabs metadata and voice profile', async () => {
    const body = {
      success: true, voice_id: 'eleven-voice', requires_verification: true,
      slot_limit: 3, used_slots: 1, item: { provider: 'elevenlabs', title: 'My Voice' },
      voice: { name: 'My Voice' }
    }
    mockFetch.mockResolvedValueOnce(response(body))
    const result = await clone({ provider: 'elevenlabs', file_url: sample })
    expect(JSON.parse(result.content[0].text)).toMatchObject(body)
  })

  it('refreshes a rejected token without uploading samples twice', async () => {
    mockRefresh.mockResolvedValueOnce('old-token').mockResolvedValueOnce('new-token')
    mockFetch.mockResolvedValueOnce(response({}, 401)).mockResolvedValueOnce(response({ success: true, voice_id: 'new-voice' }))
    const result = await clone({ file_url: '/tmp/sample.wav' })
    expect(result.isError).not.toBe(true)
    expect(mockUpload).toHaveBeenCalledOnce()
    expect(mockFetch.mock.calls[0][1].body).toBe(mockFetch.mock.calls[1][1].body)
    expect(mockRefresh).toHaveBeenLastCalledWith(true)
  })

  it('does not retry an ambiguous network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection interrupted'))
    const result = await clone({ file_url: sample })
    expect(result.isError).toBe(true)
    expect(mockFetch).toHaveBeenCalledOnce()
  })

  it.each([
    new Response('gateway error', { status: 502 }),
    response({ success: true }),
    response(null),
    response([])
  ])('rejects malformed or incomplete backend responses', async (reply) => {
    mockFetch.mockResolvedValueOnce(reply)
    const result = await clone({ file_url: sample })
    expect(result.isError).toBe(true)
  })
})
