import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

import VideoUnderstandServer from '../video-understand'

type VideoUnderstandServerInstance = InstanceType<typeof VideoUnderstandServer>

function createServer(workspaceRoot?: string) {
  return new VideoUnderstandServer(workspaceRoot)
}

async function callTool(server: VideoUnderstandServerInstance, toolName: string, args: Record<string, unknown>) {
  const handlers = (server.mcpServer.server as any)._requestHandlers
  const callToolHandler = handlers?.get('tools/call')
  if (!callToolHandler) {
    throw new Error('No tools/call handler registered')
  }
  return callToolHandler({ method: 'tools/call', params: { name: toolName, arguments: args } }, {})
}

async function listTools(server: VideoUnderstandServerInstance) {
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

describe('VideoUnderstandServer', () => {
  let workspaceRoot: string

  beforeEach(async () => {
    vi.clearAllMocks()
    mockStoreGet.mockImplementation((key: string) => (key === 'auth.refresh_token' ? 'refresh-token' : undefined))
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'video-understand-test-'))
  })

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true }).catch(() => undefined)
  })

  it('should expose only the submit-and-wait tool', async () => {
    const server = createServer(workspaceRoot)
    const result = await listTools(server)

    expect(result.tools.map((tool: { name: string }) => tool.name)).toEqual(['submit_video_detail_task'])
  })

  it('should submit a remote video task and poll until completion', async () => {
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
          queue_name: 'video-detail-task',
          status: 'queued',
          success: true,
          task_id: 'task-123'
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          task_id: 'task-123',
          status: 'success',
          progress: 1,
          message: '任务处理完成',
          prompt: '总结一下画面内容',
          video_url: 'https://example.com/source.mp4',
          result: {
            output: {
              video_detail: '画面中是一条街道和路过的人群'
            }
          },
          error: '',
          success: true
        })
      )

    const server = createServer(workspaceRoot)
    const result = await callTool(server, 'submit_video_detail_task', {
      video_url: 'https://example.com/source.mp4',
      prompt: '总结一下画面内容',
      fps: 2
    })

    expect(mockStoreSet).toHaveBeenCalledWith('auth.refresh_token', 'refresh-token-next')
    expect(mockNetFetch).toHaveBeenNthCalledWith(
      2,
      'https://open.vectcut.com/llm/video_detail/submit/submit_video_detail_task',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
          'Content-Type': 'application/json'
        }),
        body: JSON.stringify({
          video_url: 'https://example.com/source.mp4',
          model: 'gpt-5.6-luna',
          prompt: '总结一下画面内容',
          fps: 2
        })
      })
    )
    expect(mockNetFetch).toHaveBeenNthCalledWith(
      3,
      'https://open.vectcut.com/llm/video_detail/submit/task_status?task_id=task-123',
      expect.objectContaining({ method: 'GET' })
    )

    const payload = JSON.parse(result.content[0].text)
    expect(payload).toEqual({
      provider: 'vectcut',
      action: 'submit_and_wait',
      mode: 'video_understand',
      estimated_wait_time: '15-30 minutes',
      task_id: 'task-123',
      status: 'success',
      progress: 1,
      message: '任务处理完成',
      prompt: '总结一下画面内容',
      video_url: 'https://example.com/source.mp4',
      error: '',
      success: true,
      source_summary: [
        {
          original_input: 'https://example.com/source.mp4',
          submitted_url: 'https://example.com/source.mp4',
          source_kind: 'remote_video'
        }
      ],
      artifact: {
        storage: 'workspace_file',
        file_path: path.join(workspaceRoot, '.capcut', 'tool-results', 'video-understand', 'task-123.json'),
        relative_path: path.join('.capcut', 'tool-results', 'video-understand', 'task-123.json')
      },
      result_summary: {
        has_result: true,
        result_keys: ['output'],
        output_keys: ['video_detail'],
        video_detail_chars: '画面中是一条街道和路过的人群'.length
      }
    })

    const storedText = await fs.readFile(payload.artifact.file_path, 'utf8')
    expect(JSON.parse(storedText)).toEqual({
      provider: 'vectcut',
      action: 'submit_and_wait',
      mode: 'video_understand',
      estimated_wait_time: '15-30 minutes',
      request: {
        video_url: 'https://example.com/source.mp4',
        model: 'gpt-5.6-luna',
        prompt: '总结一下画面内容',
        fps: 2
      },
      source_summary: [
        {
          original_input: 'https://example.com/source.mp4',
          submitted_url: 'https://example.com/source.mp4',
          source_kind: 'remote_video'
        }
      ],
      task_id: 'task-123',
      status: 'success',
      progress: 1,
      message: '任务处理完成',
      prompt: '总结一下画面内容',
      video_url: 'https://example.com/source.mp4',
      result: {
        output: {
          video_detail: '画面中是一条街道和路过的人群'
        }
      },
      error: '',
      success: true
    })
  })

  it('should upload local video before submitting', async () => {
    const localVideoPath = path.join(workspaceRoot, 'local-source.mp4')
    await fs.writeFile(localVideoPath, 'video')

    mockUploadLocalFile.mockResolvedValue({
      signedPublicUrl: 'https://oss.example.com/local-source.mp4?token=1'
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
          status: 'queued',
          success: true,
          task_id: 'task-local'
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          task_id: 'task-local',
          status: 'success',
          progress: 1,
          message: '任务处理完成',
          result: {
            output: {
              video_detail: '本地视频分析完成'
            }
          },
          success: true
        })
      )

    const server = createServer(workspaceRoot)
    const result = await callTool(server, 'submit_video_detail_task', {
      videoUrl: localVideoPath
    })

    expect(mockUploadLocalFile).toHaveBeenCalledWith(localVideoPath, {
      bucket: 'oss-hangzhou-mp4',
      region: 'oss-cn-hangzhou',
      folder: 'agent_tmp/{uid}',
      objectKeyPrefix: 'vectcut_video_understand_',
      signExpiresSeconds: 3600
    })
    expect(JSON.parse(mockNetFetch.mock.calls[1][1].body as string)).toEqual({
      video_url: 'https://oss.example.com/local-source.mp4?token=1',
      model: 'gpt-5.6-luna'
    })

    const payload = JSON.parse(result.content[0].text)
    expect(payload.source_summary).toEqual([
      {
        original_input: localVideoPath,
        submitted_url: 'https://oss.example.com/local-source.mp4?token=1',
        source_kind: 'local_video'
      }
    ])
  })

  it('should keep polling when status is pending even if api success is true', async () => {
    mockNetFetch
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: 'access-token',
          expires_in: 3600
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          status: 'queued',
          success: true,
          task_id: 'task-pending'
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          task_id: 'task-pending',
          status: 'pending',
          progress: 0,
          message: '任务已提交，请稍候',
          success: true
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          task_id: 'task-pending',
          status: 'success',
          progress: 1,
          message: '任务处理完成',
          result: {
            output: {
              video_detail: '最终视频理解结果'
            }
          },
          success: true
        })
      )

    const server = createServer(workspaceRoot)
    const result = await callTool(server, 'submit_video_detail_task', {
      video_url: 'https://example.com/source.mp4'
    })

    expect(mockNetFetch).toHaveBeenNthCalledWith(
      3,
      'https://open.vectcut.com/llm/video_detail/submit/task_status?task_id=task-pending',
      expect.objectContaining({ method: 'GET' })
    )
    expect(mockNetFetch).toHaveBeenNthCalledWith(
      4,
      'https://open.vectcut.com/llm/video_detail/submit/task_status?task_id=task-pending',
      expect.objectContaining({ method: 'GET' })
    )

    const payload = JSON.parse(result.content[0].text)
    expect(payload.status).toBe('success')
    expect(payload.result_summary).toEqual({
      has_result: true,
      result_keys: ['output'],
      output_keys: ['video_detail'],
      video_detail_chars: '最终视频理解结果'.length
    })
  }, 10000)
})
