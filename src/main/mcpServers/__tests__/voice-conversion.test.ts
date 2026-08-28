import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockNetFetch, mockStoreGet, mockStoreSet, mockUploadLocalFile } = vi.hoisted(() => ({
  mockNetFetch: vi.fn(),
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

vi.mock('@main/services/OssUploadService', () => ({
  ossUploadService: {
    uploadLocalFile: mockUploadLocalFile
  }
}))

import VoiceConversionServer from '../voice-conversion'

type VoiceConversionServerInstance = InstanceType<typeof VoiceConversionServer>

function createServer() {
  return new VoiceConversionServer()
}

async function callTool(server: VoiceConversionServerInstance, toolName: string, args: Record<string, unknown>) {
  const handlers = (server.mcpServer.server as any)._requestHandlers
  const callToolHandler = handlers?.get('tools/call')
  if (!callToolHandler) {
    throw new Error('No tools/call handler registered')
  }
  return callToolHandler({ method: 'tools/call', params: { name: toolName, arguments: args } }, {})
}

async function listTools(server: VoiceConversionServerInstance) {
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

describe('VoiceConversionServer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStoreGet.mockImplementation((key: string) => (key === 'auth.refresh_token' ? 'refresh-token' : undefined))
  })

  it('should expose submit and status tools', async () => {
    const server = createServer()
    const result = await listTools(server)

    expect(result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      'submit_voice_conversion_task',
      'get_voice_conversion_task_status'
    ])
  })

  it('should submit audio voice conversion tasks', async () => {
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
          message_id: 'message-123',
          queue_name: 'sts-task',
          status: 'queued',
          success: true,
          task_id: 'task-123'
        })
      )

    const server = createServer()
    const result = await callTool(server, 'submit_voice_conversion_task', {
      audio_url: 'https://example.com/source.mp3',
      voice_id: 'voice-elevenlabs-1'
    })

    expect(mockStoreSet).toHaveBeenCalledWith('auth.refresh_token', 'refresh-token-next')
    expect(mockNetFetch).toHaveBeenNthCalledWith(
      2,
      'https://open.vectcut.com/llm/sts/submit/generate',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
          'Content-Type': 'application/json'
        }),
        body: JSON.stringify({
          audio_url: 'https://example.com/source.mp3',
          voice_id: 'voice-elevenlabs-1'
        })
      })
    )

    expect(JSON.parse(result.content[0].text)).toEqual({
      provider: 'vectcut',
      action: 'submit',
      mode: 'voice_conversion',
      request: {
        audio_url: 'https://example.com/source.mp3',
        voice_id: 'voice-elevenlabs-1'
      },
      source_summary: [
        {
          original_input: 'https://example.com/source.mp3',
          submitted_url: 'https://example.com/source.mp3',
          source_kind: 'remote_media'
        }
      ],
      error: '',
      message_id: 'message-123',
      queue_name: 'sts-task',
      status: 'queued',
      success: true,
      task_id: 'task-123'
    })
  })

  it('should submit video voice conversion tasks with camelCase aliases', async () => {
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
          message_id: 'message-456',
          queue_name: 'sts-task',
          status: 'queued',
          success: true,
          task_id: 'task-456'
        })
      )

    const server = createServer()
    await callTool(server, 'submit_voice_conversion_task', {
      videoUrl: 'https://example.com/source.mp4',
      voiceId: 'voice-elevenlabs-2'
    })

    expect(JSON.parse(mockNetFetch.mock.calls[1][1].body as string)).toEqual({
      video_url: 'https://example.com/source.mp4',
      voice_id: 'voice-elevenlabs-2'
    })
  })

  it('should upload local audio files internally before submitting', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-conversion-test-'))
    const localAudioPath = path.join(tempRoot, 'source.mp3')
    await fs.writeFile(localAudioPath, 'demo-audio', 'utf8')

    mockUploadLocalFile.mockResolvedValue({
      signedPublicUrl: 'https://oss.example.com/source.mp3?token=1'
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
          message_id: 'message-local-1',
          queue_name: 'sts-task',
          status: 'queued',
          success: true,
          task_id: 'task-local-1'
        })
      )

    const server = createServer()
    const result = await callTool(server, 'submit_voice_conversion_task', {
      audio_url: `file://${localAudioPath}`,
      voice_id: 'voice-elevenlabs-local'
    })

    expect(mockUploadLocalFile).toHaveBeenCalledWith(
      localAudioPath,
      expect.objectContaining({
        bucket: 'oss-hangzhou-mp4',
        region: 'oss-cn-hangzhou',
        folder: 'agent_tmp/{uid}',
        objectKeyPrefix: 'vectcut_voice_conversion_',
        signExpiresSeconds: 3600
      })
    )
    expect(JSON.parse(mockNetFetch.mock.calls[1][1].body as string)).toEqual({
      audio_url: 'https://oss.example.com/source.mp3?token=1',
      voice_id: 'voice-elevenlabs-local'
    })
    expect(JSON.parse(result.content[0].text)).toEqual(
      expect.objectContaining({
        request: {
          audio_url: 'https://oss.example.com/source.mp3?token=1',
          voice_id: 'voice-elevenlabs-local'
        },
        source_summary: [
          {
            original_input: `file://${localAudioPath}`,
            submitted_url: 'https://oss.example.com/source.mp3?token=1',
            source_kind: 'local_media'
          }
        ]
      })
    )

    await fs.rm(tempRoot, { recursive: true, force: true })
  })

  it('should query voice conversion task status', async () => {
    mockNetFetch
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: 'access-token',
          expires_in: 3600
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          audio_url: 'https://example.com/source.mp3',
          error: '',
          id: 'task-123',
          message: '开始执行变声',
          progress: 15,
          result: {},
          status: 'processing',
          success: true,
          task_id: 'task-123',
          video_url: '',
          voice_id: 'voice-elevenlabs-1'
        })
      )

    const server = createServer()
    const result = await callTool(server, 'get_voice_conversion_task_status', {
      task_id: 'task-123'
    })

    expect(mockNetFetch).toHaveBeenNthCalledWith(
      2,
      'https://open.vectcut.com/llm/sts/submit/task_status?task_id=task-123',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
          'Content-Type': 'application/json'
        })
      })
    )

    expect(JSON.parse(result.content[0].text)).toEqual({
      provider: 'vectcut',
      action: 'status',
      mode: 'voice_conversion',
      audio_url: 'https://example.com/source.mp3',
      error: '',
      id: 'task-123',
      message: '开始执行变声',
      progress: 15,
      result: {},
      status: 'processing',
      success: true,
      task_id: 'task-123',
      video_url: '',
      voice_id: 'voice-elevenlabs-1'
    })
  })
})
