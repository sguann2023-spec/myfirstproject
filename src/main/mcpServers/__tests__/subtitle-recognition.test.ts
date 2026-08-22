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

function createServer(workspaceRoot?: string) {
  return new SubtitleRecognitionServer(workspaceRoot)
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

  it('should expose only the submit-and-wait tool', async () => {
    const server = createServer(workspaceRoot)
    const result = await listTools(server)

    expect(result.tools.map((tool: { name: string }) => tool.name)).toEqual(['submit_subtitle_recognition_task'])
  })

  it('should submit subtitle recognition task, wait for completion, and return only summary plus artifact path', async () => {
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
          task_id: 'task-asr-123',
          url: 'https://example.com/source.mp4'
        })
      )

    const server = createServer(workspaceRoot)
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
    expect(mockNetFetch).toHaveBeenNthCalledWith(
      3,
      'https://open.vectcut.com/llm/asr/asr_llm/submit_task/task_status?task_id=task-asr-123',
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
      action: 'submit_and_wait',
      mode: 'subtitle_recognition',
      estimated_wait_time: '15-30 minutes',
      task_mode: 'asr',
      url: 'https://example.com/source.mp4',
      effect_mode: 'llm',
      source_summary: [
        {
          original_input: 'https://example.com/source.mp4',
          submitted_url: 'https://example.com/source.mp4',
          source_kind: 'remote_media'
        }
      ],
      error: '',
      message: 'llm_asr 队列任务处理完成',
      progress: 100,
      success: true,
      status: 'success',
      content: '识别出的完整字幕文本',
      recognition_mode: 'asr',
      recognition_url: 'https://example.com/source.mp4',
      artifact: {
        storage: 'workspace_file',
        file_path: path.join(workspaceRoot, 'task-asr-123.json'),
        relative_path: 'task-asr-123.json'
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

    expect(payload.result).toBeUndefined()

    const storedText = await fs.readFile(payload.artifact.file_path, 'utf8')
    expect(JSON.parse(storedText)).toEqual({
      provider: 'vectcut',
      action: 'submit_and_wait',
      mode: 'subtitle_recognition',
      estimated_wait_time: '15-30 minutes',
      task_mode: 'asr',
      url: 'https://example.com/source.mp4',
      effect_mode: 'llm',
      source_summary: [
        {
          original_input: 'https://example.com/source.mp4',
          submitted_url: 'https://example.com/source.mp4',
          source_kind: 'remote_media'
        }
      ],
      error: '',
      message: 'llm_asr 队列任务处理完成',
      progress: 100,
      success: true,
      status: 'success',
      content: '识别出的完整字幕文本',
      recognition_mode: 'asr',
      recognition_url: 'https://example.com/source.mp4',
      result: {
        content: '识别出的完整字幕文本',
        error: '',
        mode: 'asr',
        effect_mode: 'llm',
        segments: [{ start: 0, end: 1200, text: '识别出的字幕片段' }]
      }
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
      .mockResolvedValueOnce(
        mockJsonResponse({
          error: '',
          message: 'sta 队列任务处理完成',
          mode: 'sta',
          progress: 100,
          result: {
            content: '这是一段校对后的字幕文案',
            error: '',
            mode: 'sta',
            effect_mode: 'llm_vad',
            segments: [{ start: 0, end: 1000, text: '这是一段校对后的字幕文案' }]
          },
          success: true,
          status: 'success',
          task_id: 'task-sta-456',
          url: 'https://example.com/source.mp3'
        })
      )

    const server = createServer(workspaceRoot)
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

  it('should keep polling when pending status includes an empty result object', async () => {
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
          task_id: 'task-poll-001',
          status: 'pending',
          effect_mode: 'basic',
          error: ''
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          error: '',
          message: '任务已提交，等待处理',
          mode: 'asr',
          progress: 0,
          result: {},
          success: true,
          status: 'pending',
          task_id: 'task-poll-001',
          url: 'https://example.com/source.mp3'
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          error: '',
          message: '识别完成',
          mode: 'asr',
          progress: 100,
          result: {
            content: '最终字幕结果',
            error: '',
            mode: 'asr',
            effect_mode: 'basic',
            segments: [{ start: 0, end: 800, text: '最终字幕结果' }]
          },
          success: true,
          status: 'success',
          task_id: 'task-poll-001',
          url: 'https://example.com/source.mp3'
        })
      )

    const server = createServer(workspaceRoot) as any
    server.sleep = vi.fn().mockResolvedValue(undefined)

    const result = await callTool(server, 'submit_subtitle_recognition_task', {
      url: 'https://example.com/source.mp3',
      effectMode: 'basic'
    })

    expect(mockNetFetch).toHaveBeenNthCalledWith(
      3,
      'https://open.vectcut.com/llm/asr/asr_llm/submit_task/task_status?task_id=task-poll-001',
      expect.any(Object)
    )
    expect(mockNetFetch).toHaveBeenNthCalledWith(
      4,
      'https://open.vectcut.com/llm/asr/asr_llm/submit_task/task_status?task_id=task-poll-001',
      expect.any(Object)
    )

    const payload = JSON.parse(result.content[0].text)
    expect(payload.status).toBe('success')
    expect(payload.content).toBe('最终字幕结果')
    expect(payload.result_summary).toEqual({
      has_result: true,
      content_chars: '最终字幕结果'.length,
      segment_count: 1,
      result_mode: 'asr',
      effect_mode: 'basic',
      error: ''
    })
  })
})
