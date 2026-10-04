import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExecFile, mockNetFetch, mockStoreGet, mockStoreSet, mockUploadLocalFile } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockNetFetch: vi.fn(),
  mockStoreGet: vi.fn(),
  mockStoreSet: vi.fn(),
  mockUploadLocalFile: vi.fn()
}))

vi.mock('node:child_process', () => ({
  execFile: mockExecFile
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

vi.mock('@main/utils', () => ({
  getResourcePath: () => '/tmp/vectcut-test-resources'
}))

import VoiceConversionServer from '../voice-conversion'

type VoiceConversionServerInstance = InstanceType<typeof VoiceConversionServer>

function createServer(workspacePath?: string) {
  return new VoiceConversionServer(workspacePath)
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

function mockBinaryResponse(data: string, contentType = 'audio/mpeg', ok = true, status = 200): Response {
  const buffer = Buffer.from(data)
  return {
    ok,
    status,
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    headers: {
      get: (key: string) => (key.toLowerCase() === 'content-type' ? contentType : null)
    },
    text: async () => data
  } as Response
}

function mockFfprobeProbe(
  options: { durationSeconds: number; hasAudio?: boolean; hasVideo?: boolean },
  writeProcessOutput = false
) {
  mockExecFile.mockImplementation((_command: string, args: string[], _options: unknown, callback: Function) => {
    if (args.includes('-show_entries')) {
      callback(null, {
        stdout: JSON.stringify({
          format: { duration: String(options.durationSeconds) },
          streams: [
            ...(options.hasAudio === false ? [] : [{ codec_type: 'audio', duration: String(options.durationSeconds) }]),
            ...(options.hasVideo ? [{ codec_type: 'video', duration: String(options.durationSeconds) }] : [])
          ]
        }),
        stderr: ''
      })
      return
    }
    if (writeProcessOutput) {
      const outputPath = String(args[args.length - 1] || '')
      fs.mkdir(path.dirname(outputPath), { recursive: true })
        .then(() => fs.writeFile(outputPath, 'mock-media-output', 'utf8'))
        .then(() => callback(null, { stdout: '', stderr: '' }))
        .catch((error) => callback(error))
      return
    }
    callback(null, { stdout: '', stderr: '' })
  })
}

describe('VoiceConversionServer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStoreGet.mockImplementation((key: string) => (key === 'auth.refresh_token' ? 'refresh-token' : undefined))
    mockFfprobeProbe({ durationSeconds: 120, hasAudio: true })
  })

  it('should expose submit-and-wait tool', async () => {
    const server = createServer()
    const result = await listTools(server)

    expect(result.tools.map((tool: { name: string }) => tool.name)).toEqual(['submit_voice_conversion_task'])
  })

  it('should submit audio voice conversion tasks and wait for final result', async () => {
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
      .mockResolvedValueOnce(
        mockJsonResponse({
          audio_url: 'https://example.com/source.mp3',
          error: '',
          message: '处理完成',
          progress: 100,
          result: {
            billing: { consume: 2.5 },
            converted_url: 'https://example.com/converted.mp3'
          },
          status: 'success',
          success: true,
          task_id: 'task-123',
          video_url: '',
          voice_id: 'voice-elevenlabs-1'
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
      action: 'submit_and_wait',
      estimated_wait_time: '1-5 minutes',
      mode: 'voice_conversion',
      request: {
        audio_url: 'https://example.com/source.mp3',
        voice_id: 'voice-elevenlabs-1'
      },
      source_summary: [
        {
          original_input: 'https://example.com/source.mp3',
          submitted_field: 'audio_url',
          submitted_url: 'https://example.com/source.mp3',
          source_kind: 'remote_media'
        }
      ],
      audio_url: 'https://example.com/source.mp3',
      billing: { consume: 2.5 },
      error: '',
      message: '处理完成',
      output: {
        audio_url: 'https://example.com/converted.mp3',
        converted_url: 'https://example.com/converted.mp3',
        remote_url: 'https://example.com/converted.mp3',
        url: 'https://example.com/converted.mp3'
      },
      progress: 100,
      result: {
        billing: { consume: 2.5 },
        converted_url: 'https://example.com/converted.mp3'
      },
      status: 'success',
      success: true,
      task_id: 'task-123',
      remote_url: 'https://example.com/converted.mp3',
      url: 'https://example.com/converted.mp3',
      video_url: '',
      voice_id: 'voice-elevenlabs-1'
    })
  })

  it('should save converted audio results into the workspace', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-conversion-workspace-'))
    const expectedOutputPath = path.join(workspaceRoot, 'voice-conversion-task-workspace-audio.mp3')

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
          message_id: 'message-workspace-audio',
          queue_name: 'sts-task',
          status: 'queued',
          success: true,
          task_id: 'task-workspace-audio'
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          audio_url: 'https://example.com/source.mp3',
          error: '',
          message: '处理完成',
          progress: 100,
          result: {
            billing: { consume: 1.5 },
            converted_url: 'https://example.com/converted-workspace.mp3'
          },
          status: 'success',
          success: true,
          task_id: 'task-workspace-audio',
          video_url: '',
          voice_id: 'voice-elevenlabs-workspace'
        })
      )
      .mockResolvedValueOnce(mockBinaryResponse('converted-audio-bytes', 'audio/mpeg'))

    const server = createServer(workspaceRoot)
    const result = await callTool(server, 'submit_voice_conversion_task', {
      audio_url: 'https://example.com/source.mp3',
      voice_id: 'voice-elevenlabs-workspace'
    })
    const payload = JSON.parse(result.content[0].text)

    await expect(fs.readFile(expectedOutputPath, 'utf8')).resolves.toBe('converted-audio-bytes')
    expect(payload).toEqual(
      expect.objectContaining({
        artifact: {
          storage: 'workspace_file',
          file_path: expectedOutputPath,
          relative_path: 'voice-conversion-task-workspace-audio.mp3',
          media_kind: 'audio',
          content_type: 'audio/mpeg',
          size_bytes: 21
        },
        output: expect.objectContaining({
          audio_url: expectedOutputPath,
          remote_url: 'https://example.com/converted-workspace.mp3',
          url: expectedOutputPath
        }),
        remote_url: 'https://example.com/converted-workspace.mp3',
        url: expectedOutputPath
      })
    )

    await fs.rm(workspaceRoot, { recursive: true, force: true })
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
      .mockResolvedValueOnce(
        mockJsonResponse({
          error: '',
          progress: 100,
          result: { converted_url: 'https://example.com/converted-video.mp4' },
          status: 'success',
          success: true,
          task_id: 'task-456',
          video_url: 'https://example.com/source.mp4',
          voice_id: 'voice-elevenlabs-2'
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

  it('should save converted video results into the workspace', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-conversion-video-workspace-'))
    const expectedOutputPath = path.join(workspaceRoot, 'voice-conversion-task-workspace-video.mp4')

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
          message_id: 'message-workspace-video',
          queue_name: 'sts-task',
          status: 'queued',
          success: true,
          task_id: 'task-workspace-video'
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          error: '',
          progress: 100,
          result: { converted_url: 'https://example.com/converted-workspace-video.mp4' },
          status: 'success',
          success: true,
          task_id: 'task-workspace-video',
          video_url: 'https://example.com/source.mp4',
          voice_id: 'voice-elevenlabs-video-workspace'
        })
      )
      .mockResolvedValueOnce(mockBinaryResponse('converted-video-bytes', 'video/mp4'))

    const server = createServer(workspaceRoot)
    const result = await callTool(server, 'submit_voice_conversion_task', {
      video_url: 'https://example.com/source.mp4',
      voice_id: 'voice-elevenlabs-video-workspace'
    })
    const payload = JSON.parse(result.content[0].text)

    await expect(fs.readFile(expectedOutputPath, 'utf8')).resolves.toBe('converted-video-bytes')
    expect(payload).toEqual(
      expect.objectContaining({
        artifact: expect.objectContaining({
          storage: 'workspace_file',
          file_path: expectedOutputPath,
          relative_path: 'voice-conversion-task-workspace-video.mp4',
          media_kind: 'video',
          content_type: 'video/mp4'
        }),
        output: expect.objectContaining({
          remote_url: 'https://example.com/converted-workspace-video.mp4',
          url: expectedOutputPath,
          video_url: expectedOutputPath
        }),
        remote_url: 'https://example.com/converted-workspace-video.mp4',
        url: expectedOutputPath
      })
    )

    await fs.rm(workspaceRoot, { recursive: true, force: true })
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
      .mockResolvedValueOnce(
        mockJsonResponse({
          audio_url: 'https://oss.example.com/source.mp3?token=1',
          error: '',
          progress: 100,
          result: { converted_url: 'https://oss.example.com/converted-source.mp3' },
          status: 'success',
          success: true,
          task_id: 'task-local-1',
          video_url: '',
          voice_id: 'voice-elevenlabs-local'
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
            input_media_kind: 'audio',
            original_input: `file://${localAudioPath}`,
            submitted_field: 'audio_url',
            submitted_url: 'https://oss.example.com/source.mp3?token=1',
            source_kind: 'local_media'
          }
        ]
      })
    )

    await fs.rm(tempRoot, { recursive: true, force: true })
  })

  it('should extract local video audio before submitting and merge converted audio when complete', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-conversion-video-test-'))
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-conversion-video-workspace-'))
    const expectedOutputPath = path.join(workspaceRoot, 'voice-conversion-task-local-video.mp4')
    const localVideoPath = path.join(tempRoot, 'source.mp4')
    await fs.writeFile(localVideoPath, 'demo-video', 'utf8')
    mockFfprobeProbe({ durationSeconds: 120, hasAudio: true, hasVideo: true }, true)

    mockUploadLocalFile.mockResolvedValue({
      signedPublicUrl: 'https://oss.example.com/extracted-audio.mp3?token=1'
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
          message_id: 'message-local-video',
          queue_name: 'sts-task',
          status: 'queued',
          success: true,
          task_id: 'task-local-video'
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          audio_url: 'https://oss.example.com/extracted-audio.mp3?token=1',
          error: '',
          progress: 100,
          result: { converted_url: 'https://oss.example.com/converted-audio.mp3' },
          status: 'completed',
          success: true,
          task_id: 'task-local-video',
          video_url: '',
          voice_id: 'voice-elevenlabs-local-video'
        })
      )

    const server = createServer(workspaceRoot)
    const submitResult = await callTool(server, 'submit_voice_conversion_task', {
      video_url: localVideoPath,
      voice_id: 'voice-elevenlabs-local-video'
    })
    const payload = JSON.parse(submitResult.content[0].text)

    expect(JSON.parse(mockNetFetch.mock.calls[1][1].body as string)).toEqual({
      audio_url: 'https://oss.example.com/extracted-audio.mp3?token=1',
      voice_id: 'voice-elevenlabs-local-video'
    })
    expect(payload).toEqual(
      expect.objectContaining({
        action: 'submit_and_wait',
        local_video_merge: {
          converted_audio_url: 'https://oss.example.com/converted-audio.mp3',
          merged_video_path: expectedOutputPath,
          original_video_path: localVideoPath,
          status: 'merged',
          workspace_file_path: expectedOutputPath,
          workspace_relative_path: 'voice-conversion-task-local-video.mp4'
        },
        artifact: {
          storage: 'workspace_file',
          file_path: expectedOutputPath,
          relative_path: 'voice-conversion-task-local-video.mp4',
          media_kind: 'video',
          size_bytes: 17
        },
        output: expect.objectContaining({
          video_url: expectedOutputPath,
          url: expectedOutputPath
        }),
        source_summary: [
          expect.objectContaining({
            input_media_kind: 'video',
            preprocessing: 'extracted_audio_from_local_video',
            submitted_field: 'audio_url'
          })
        ]
      })
    )
    expect(mockExecFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['-map', '0:a:0', '-vn']),
      expect.any(Object),
      expect.any(Function)
    )
    expect(mockExecFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([localVideoPath, 'https://oss.example.com/converted-audio.mp3', '-c:v', 'copy']),
      expect.any(Object),
      expect.any(Function)
    )
    await expect(fs.readFile(expectedOutputPath, 'utf8')).resolves.toBe('mock-media-output')
    await expect(fs.stat(path.join(tempRoot, 'source_voice_converted_task-local-video.mp4'))).rejects.toThrow()

    await fs.rm(tempRoot, { recursive: true, force: true })
    await fs.rm(workspaceRoot, { recursive: true, force: true })
  })

  it('should reject local media longer than five minutes', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-conversion-long-test-'))
    const localAudioPath = path.join(tempRoot, 'long.mp3')
    await fs.writeFile(localAudioPath, 'demo-audio', 'utf8')
    mockFfprobeProbe({ durationSeconds: 301, hasAudio: true })

    const server = createServer()
    const result = await callTool(server, 'submit_voice_conversion_task', {
      audio_url: localAudioPath,
      voice_id: 'voice-elevenlabs-local'
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('duration cannot exceed 5 minutes')
    expect(mockUploadLocalFile).not.toHaveBeenCalled()
    expect(mockNetFetch).not.toHaveBeenCalled()

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
      estimated_wait_time: '1-5 minutes',
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
