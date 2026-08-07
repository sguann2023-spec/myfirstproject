import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockExecFile,
  mockExistsSync,
  mockMkdtemp,
  mockNetFetch,
  mockStat,
  mockStoreGet,
  mockStoreSet,
  mockUnlink,
  mockUploadLocalFile
} = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockExistsSync: vi.fn(),
  mockMkdtemp: vi.fn(),
  mockNetFetch: vi.fn(),
  mockStat: vi.fn(),
  mockStoreGet: vi.fn(),
  mockStoreSet: vi.fn(),
  mockUnlink: vi.fn(),
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

vi.mock('node:child_process', () => ({
  execFile: mockExecFile
}))

vi.mock('node:util', async () => {
  const actual = await vi.importActual<typeof import('node:util')>('node:util')
  return {
    ...actual,
    promisify: (_fn: unknown) => {
      return (...args: unknown[]) =>
        new Promise((resolve, reject) => {
          mockExecFile(...args, (error: unknown, stdout = '', stderr = '') => {
            if (error) {
              reject(error)
              return
            }
            resolve({ stdout, stderr })
          })
        })
    }
  }
})

vi.mock('node:fs', () => ({
  default: {
    existsSync: mockExistsSync
  }
}))

vi.mock('node:fs/promises', () => ({
  default: {
    stat: mockStat,
    mkdtemp: mockMkdtemp,
    unlink: mockUnlink
  }
}))

vi.mock('node:os', () => ({
  default: {
    tmpdir: () => '/tmp'
  }
}))

vi.mock('ffprobe-static', () => ({
  path: '/mock/ffprobe'
}))

vi.mock('@main/utils', () => ({
  getResourcePath: vi.fn(() => '/mock/resources')
}))

vi.mock('@main/services/OssUploadService', () => ({
  ossUploadService: {
    uploadLocalFile: mockUploadLocalFile
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

import SubtitleTemplateServer from '../subtitle-template'

type SubtitleTemplateServerInstance = InstanceType<typeof SubtitleTemplateServer>

function createServer() {
  return new SubtitleTemplateServer()
}

async function callTool(server: SubtitleTemplateServerInstance, toolName: string, args: Record<string, unknown>) {
  const handlers = (server.mcpServer.server as any)._requestHandlers
  const callToolHandler = handlers?.get('tools/call')
  if (!callToolHandler) {
    throw new Error('No tools/call handler registered')
  }
  return callToolHandler({ method: 'tools/call', params: { name: toolName, arguments: args } }, {})
}

async function listTools(server: SubtitleTemplateServerInstance) {
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

describe('SubtitleTemplateServer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStoreGet.mockImplementation((key: string) => (key === 'auth.refresh_token' ? 'refresh-token' : undefined))
    mockExistsSync.mockReturnValue(false)
    mockStat.mockResolvedValue({
      isFile: () => true
    })
    mockMkdtemp.mockResolvedValue('/tmp/subtitle-template')
    mockUnlink.mockResolvedValue(undefined)
  })

  it('should expose generate and status tools', async () => {
    const server = createServer()
    const result = await listTools(server)

    expect(result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      'generate_smart_subtitle',
      'get_smart_subtitle_task_status'
    ])
  })

  it('should submit subtitle template task with default template', async () => {
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
          task_id: '924E4C927BEE000216140F22DDDA345F'
        })
      )

    const server = createServer()
    const result = await callTool(server, 'generate_smart_subtitle', {
      url: 'https://example.com/source.mp4',
      textContent: '校对字幕文案'
    })

    expect(mockStoreSet).toHaveBeenCalledWith('auth.refresh_token', 'refresh-token-next')
    expect(mockNetFetch).toHaveBeenNthCalledWith(
      2,
      'https://open.vectcut.com/cut_jianying/generate_smart_subtitle',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
          'Content-Type': 'application/json'
        }),
        body: JSON.stringify({
          agent_id: 'asr_42da310c1e4347ddb2c96dd2a5d055c2',
          url: 'https://example.com/source.mp4',
          text_content: '校对字幕文案'
        })
      })
    )

    expect(JSON.parse(result.content[0].text)).toEqual({
      provider: 'vectcut',
      action: 'submit',
      mode: 'subtitle_template',
      template: 'luxury_black_shadow',
      agent_id: 'asr_42da310c1e4347ddb2c96dd2a5d055c2',
      source_kind: 'remote_url',
      source_url: 'https://example.com/source.mp4',
      original_input: 'https://example.com/source.mp4',
      extracted_audio: false,
      duration_seconds: undefined,
      draft_id: undefined,
      task_id: '924E4C927BEE000216140F22DDDA345F'
    })
  })

  it('should support explicit template alias and draft continuation', async () => {
    mockNetFetch
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: 'access-token',
          expires_in: 3600
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          task_id: 'task-subtitle-custom'
        })
      )

    const server = createServer()
    await callTool(server, 'generate_smart_subtitle', {
      template: 'new_youth_double',
      url: 'https://example.com/source.mp3',
      draftId: 'dfd_existing_123',
      addMedia: false
    })

    expect(JSON.parse(mockNetFetch.mock.calls[1][1].body as string)).toEqual({
      agent_id: 'asr_21d0bfcb2fe943d5adcd56bdc26d7c9a',
      url: 'https://example.com/source.mp3',
      draft_id: 'dfd_existing_123',
      add_media: false
    })
  })

  it('should upload a local audio file before submitting subtitle template generation', async () => {
    mockExecFile.mockImplementation(
      (_command: unknown, _args: unknown, _options: unknown, callback: (error: unknown, stdout?: string, stderr?: string) => void) => {
        callback(
          null,
          JSON.stringify({
            format: { duration: 12.34 },
            streams: [{ codec_type: 'audio', duration: 12.34 }]
          }),
          ''
        )
      }
    )
    mockUploadLocalFile.mockResolvedValue({
      signedPublicUrl: 'https://oss-cn-hangzhou.aliyuncs.com/agent_tmp/demo/source.mp3?token=1'
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
          task_id: 'task-local-audio'
        })
      )

    const server = createServer()
    const result = await callTool(server, 'generate_smart_subtitle', {
      url: '/tmp/source.mp3'
    })

    expect(mockUploadLocalFile).toHaveBeenCalledWith('/tmp/source.mp3', {
      bucket: 'oss-hangzhou-mp4',
      region: 'oss-cn-hangzhou',
      folder: 'agent_tmp/{uid}',
      contentType: undefined,
      objectKeyPrefix: 'vectcut_subtitle_template_',
      signExpiresSeconds: 3600
    })
    expect(JSON.parse(mockNetFetch.mock.calls[1][1].body as string)).toEqual({
      agent_id: 'asr_42da310c1e4347ddb2c96dd2a5d055c2',
      url: 'https://oss-cn-hangzhou.aliyuncs.com/agent_tmp/demo/source.mp3?token=1'
    })
    expect(JSON.parse(result.content[0].text)).toEqual({
      provider: 'vectcut',
      action: 'submit',
      mode: 'subtitle_template',
      template: 'luxury_black_shadow',
      agent_id: 'asr_42da310c1e4347ddb2c96dd2a5d055c2',
      source_kind: 'local_audio',
      source_url: 'https://oss-cn-hangzhou.aliyuncs.com/agent_tmp/demo/source.mp3?token=1',
      original_input: '/tmp/source.mp3',
      extracted_audio: false,
      duration_seconds: 12.34,
      draft_id: undefined,
      task_id: 'task-local-audio'
    })
  })

  it('should extract audio from a long local video before upload and submission', async () => {
    mockExecFile.mockImplementation(
      (
        _command: unknown,
        args: unknown,
        _options: unknown,
        callback: (error: unknown, stdout?: string, stderr?: string) => void
      ) => {
        if (Array.isArray(args) && args.includes('-show_entries')) {
          callback(
            null,
            JSON.stringify({
              format: { duration: 601 },
              streams: [
                { codec_type: 'video', duration: 601 },
                { codec_type: 'audio', duration: 601 }
              ]
            }),
            ''
          )
          return
        }

        callback(null, '', '')
      }
    )
    mockUploadLocalFile.mockResolvedValue({
      signedPublicUrl: 'https://oss-cn-hangzhou.aliyuncs.com/agent_tmp/demo/video_audio.mp3?token=1'
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
          task_id: 'task-long-video'
        })
      )

    const server = createServer()
    const result = await callTool(server, 'generate_smart_subtitle', {
      url: '/tmp/video.mp4'
    })

    expect(mockUploadLocalFile).toHaveBeenCalledWith('/tmp/subtitle-template/video_audio.mp3', {
      bucket: 'oss-hangzhou-mp4',
      region: 'oss-cn-hangzhou',
      folder: 'agent_tmp/{uid}',
      contentType: 'audio/mpeg',
      objectKeyPrefix: 'vectcut_subtitle_template_',
      signExpiresSeconds: 3600
    })
    expect(mockUnlink).toHaveBeenCalledWith('/tmp/subtitle-template/video_audio.mp3')
    expect(JSON.parse(mockNetFetch.mock.calls[1][1].body as string)).toEqual({
      agent_id: 'asr_42da310c1e4347ddb2c96dd2a5d055c2',
      url: 'https://oss-cn-hangzhou.aliyuncs.com/agent_tmp/demo/video_audio.mp3?token=1'
    })
    expect(JSON.parse(result.content[0].text)).toEqual({
      provider: 'vectcut',
      action: 'submit',
      mode: 'subtitle_template',
      template: 'luxury_black_shadow',
      agent_id: 'asr_42da310c1e4347ddb2c96dd2a5d055c2',
      source_kind: 'local_video_audio_extracted',
      source_url: 'https://oss-cn-hangzhou.aliyuncs.com/agent_tmp/demo/video_audio.mp3?token=1',
      original_input: '/tmp/video.mp4',
      extracted_audio: true,
      duration_seconds: 601,
      draft_id: undefined,
      task_id: 'task-long-video'
    })
  })

  it('should query subtitle template task status', async () => {
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
          message: '成功',
          output: {
            draft_id: 'dfd_cat_1775226770_5deb0396',
            draft_url: 'https://www.vectcut.com/draft/downloader?draft_id=dfd_cat_1775226770_5deb0396&is_capcut=0',
            video_url: ''
          },
          purchase_link: 'https://www.vectcut.com',
          status: 'success',
          success: true,
          task_id: '924E4C927BEE00007FAD0F2342006823'
        })
      )

    const server = createServer()
    const result = await callTool(server, 'get_smart_subtitle_task_status', {
      taskId: '924E4C927BEE00007FAD0F2342006823'
    })

    expect(mockNetFetch).toHaveBeenNthCalledWith(
      2,
      'https://open.vectcut.com/cut_jianying/smart_subtitle_task_status?task_id=924E4C927BEE00007FAD0F2342006823',
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
      mode: 'subtitle_template',
      error: '',
      message: '成功',
      output: {
        draft_id: 'dfd_cat_1775226770_5deb0396',
        draft_url: 'https://www.vectcut.com/draft/downloader?draft_id=dfd_cat_1775226770_5deb0396&is_capcut=0',
        video_url: ''
      },
      purchase_link: 'https://www.vectcut.com',
      status: 'success',
      success: true,
      task_id: '924E4C927BEE00007FAD0F2342006823'
    })
  })
})
