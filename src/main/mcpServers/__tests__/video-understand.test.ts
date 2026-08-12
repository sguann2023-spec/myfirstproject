import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

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

import VideoUnderstandServer from '../video-understand'

type VideoUnderstandServerInstance = InstanceType<typeof VideoUnderstandServer>

function createServer() {
  return new VideoUnderstandServer()
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

  beforeEach(() => {
    vi.clearAllMocks()
    mockStoreGet.mockImplementation((key: string) => (key === 'auth.refresh_token' ? 'refresh-token' : undefined))
  })

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'video-understand-test-'))
    vi.stubEnv('WORKSPACE_ROOT', workspaceRoot)
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await fs.rm(workspaceRoot, { recursive: true, force: true }).catch(() => undefined)
  })

  it('should expose submit and status tools', async () => {
    const server = createServer()
    const result = await listTools(server)

    expect(result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      'submit_video_detail_task',
      'get_video_detail_task_status'
    ])
  })

  it('should submit single video understand task with aliases', async () => {
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

    const server = createServer()
    const result = await callTool(server, 'submit_video_detail_task', {
      video_url: 'https://example.com/source.mp4',
      prompt: '总结一下画面内容'
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
          prompt: '总结一下画面内容'
        })
      })
    )

    expect(JSON.parse(result.content[0].text)).toEqual({
      provider: 'vectcut',
      action: 'submit',
      mode: 'video_understand',
      request: {
        video_url: 'https://example.com/source.mp4',
        model: 'gpt-5.6-luna',
        prompt: '总结一下画面内容'
      },
      error: '',
      message_id: 'message-123',
      queue_name: 'video-detail-task',
      status: 'queued',
      success: true,
      task_id: 'task-123'
    })
  })

  it('should submit multi video understand task with fps list', async () => {
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
          queue_name: 'video-detail-task',
          status: 'queued',
          success: true,
          task_id: 'task-456'
        })
      )

    const server = createServer()
    await callTool(server, 'submit_video_detail_task', {
      videoUrls: ['https://example.com/a.mp4', 'https://example.com/b.mp4']
    })

    expect(JSON.parse(mockNetFetch.mock.calls[1][1].body as string)).toEqual({
      video_urls: ['https://example.com/a.mp4', 'https://example.com/b.mp4'],
      model: 'gpt-5.6-luna'
    })
  })

  it('should query video understand task status', async () => {
    mockNetFetch
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: 'access-token',
          expires_in: 3600
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          task_id: 'task-status-789',
          status: 'success',
          progress: 100,
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

    const server = createServer()
    const result = await callTool(server, 'get_video_detail_task_status', {
      task_id: 'task-status-789'
    })

    expect(mockNetFetch).toHaveBeenNthCalledWith(
      2,
      'https://open.vectcut.com/llm/video_detail/submit/task_status?task_id=task-status-789',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
          'Content-Type': 'application/json'
        })
      })
    )

    const payload = JSON.parse(result.content[0].text)
    expect(payload).toEqual({
      provider: 'vectcut',
      action: 'status',
      mode: 'video_understand',
      task_id: 'task-status-789',
      status: 'success',
      progress: 100,
      message: '任务处理完成',
      prompt: '总结一下画面内容',
      video_url: 'https://example.com/source.mp4',
      error: '',
      success: true,
      artifact: {
        storage: 'workspace_file',
        file_path: path.join(workspaceRoot, '.capcut', 'tool-results', 'video-understand', 'task-status-789.json'),
        relative_path: path.join('.capcut', 'tool-results', 'video-understand', 'task-status-789.json')
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
      action: 'status',
      mode: 'video_understand',
      task_id: 'task-status-789',
      status: 'success',
      progress: 100,
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
})
