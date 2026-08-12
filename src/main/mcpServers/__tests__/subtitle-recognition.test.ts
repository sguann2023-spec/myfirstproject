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

import SubtitleRecognitionServer from '../subtitle-recognition'

type SubtitleRecognitionServerInstance = InstanceType<typeof SubtitleRecognitionServer>

function createServer() {
  return new SubtitleRecognitionServer()
}

async function callTool(server: SubtitleRecognitionServerInstance, toolName: string, args: Record<string, unknown>) {
  const handlers = (server.mcpServer.server as any)._requestHandlers
  const callToolHandler = handlers?.get('tools/call')
  if (!callToolHandler) {
    throw new Error('No tools/call handler registered')
  }
  return callToolHandler({ method: 'tools/call', params: { name: toolName, arguments: args } }, {})
}

async function listTools(server: SubtitleRecognitionServerInstance) {
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

describe('SubtitleRecognitionServer', () => {
  let workspaceRoot: string

  beforeEach(() => {
    vi.clearAllMocks()
    mockStoreGet.mockImplementation((key: string) => (key === 'auth.refresh_token' ? 'refresh-token' : undefined))
  })

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'subtitle-recognition-test-'))
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
      'submit_subtitle_recognition_task',
      'get_subtitle_recognition_task_status'
    ])
  })

  it('should submit subtitle recognition task with default llm mode', async () => {
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
          task_id: 'task-asr-123',
          message_id: 'message-123',
          status: 'pending',
          effect_mode: 'llm',
          error: ''
        })
      )

    const server = createServer()
    const result = await callTool(server, 'submit_subtitle_recognition_task', {
      url: 'https://example.com/source.mp4'
    })

    expect(mockStoreSet).toHaveBeenCalledWith('auth.refresh_token', 'refresh-token-next')
    expect(mockNetFetch).toHaveBeenNthCalledWith(
      2,
      'https://open.vectcut.com/llm/asr/asr_llm/submit_task/submit_asr_llm_task',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
          'Content-Type': 'application/json'
        }),
        body: JSON.stringify({
          url: 'https://example.com/source.mp4',
          effect_mode: 'llm'
        })
      })
    )

    expect(JSON.parse(result.content[0].text)).toEqual({
      provider: 'vectcut',
      action: 'submit',
      mode: 'subtitle_recognition',
      task_mode: 'asr',
      url: 'https://example.com/source.mp4',
      effect_mode: 'llm',
      content: undefined,
      success: true,
      task_id: 'task-asr-123',
      message_id: 'message-123',
      status: 'pending',
      error: ''
    })
  })

  it('should support sta alignment mode with explicit effect mode', async () => {
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
          task_id: 'task-sta-456',
          status: 'pending',
          effect_mode: 'llm_vad',
          error: ''
        })
      )

    const server = createServer()
    await callTool(server, 'submit_subtitle_recognition_task', {
      url: 'https://example.com/source.mp3',
      effectMode: 'llm_vad',
      content: '这是一段校对后的字幕文案'
    })

    expect(JSON.parse(mockNetFetch.mock.calls[1][1].body as string)).toEqual({
      url: 'https://example.com/source.mp3',
      effect_mode: 'llm_vad',
      content: '这是一段校对后的字幕文案'
    })
  })

  it('should query subtitle recognition task status', async () => {
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
          message: 'llm_asr 队列任务处理完成',
          mode: 'asr',
          progress: 100,
          result: {
            content: '识别出的完整字幕文本',
            error: '',
            mode: 'asr',
            effect_mode: 'llm',
            segments: [{ start: 0, end: 1200, text: '识别出的字幕片段' }]
          },
          success: true,
          status: 'success',
          task_id: 'task-status-789',
          url: 'https://example.com/source.mp4'
        })
      )

    const server = createServer()
    const result = await callTool(server, 'get_subtitle_recognition_task_status', {
      taskId: 'task-status-789'
    })

    expect(mockNetFetch).toHaveBeenNthCalledWith(
      2,
      'https://open.vectcut.com/llm/asr/asr_llm/submit_task/task_status?task_id=task-status-789',
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
      mode: 'asr',
      error: '',
      message: 'llm_asr 队列任务处理完成',
      progress: 100,
      success: true,
      status: 'success',
      task_id: 'task-status-789',
      url: 'https://example.com/source.mp4',
      artifact: {
        storage: 'workspace_file',
        file_path: path.join(workspaceRoot, '.capcut', 'tool-results', 'subtitle-recognition', 'task-status-789.json'),
        relative_path: path.join('.capcut', 'tool-results', 'subtitle-recognition', 'task-status-789.json')
      },
      result_summary: {
        has_result: true,
        content_chars: '识别出的完整字幕文本'.length,
        segment_count: 1,
        result_mode: 'asr',
        effect_mode: 'llm',
        error: ''
      }
    })

    const storedText = await fs.readFile(payload.artifact.file_path, 'utf8')
    expect(JSON.parse(storedText)).toEqual({
      provider: 'vectcut',
      action: 'status',
      mode: 'asr',
      error: '',
      message: 'llm_asr 队列任务处理完成',
      progress: 100,
      result: {
        content: '识别出的完整字幕文本',
        error: '',
        mode: 'asr',
        effect_mode: 'llm',
        segments: [{ start: 0, end: 1200, text: '识别出的字幕片段' }]
      },
      success: true,
      status: 'success',
      task_id: 'task-status-789',
      url: 'https://example.com/source.mp4'
    })
  })
})
