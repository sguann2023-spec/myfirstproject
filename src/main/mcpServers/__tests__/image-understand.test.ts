import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockNetFetch, mockStoreGet, mockStoreSet, mockPrepareVideo, mockUpload, mockCleanup } = vi.hoisted(() => ({
  mockNetFetch: vi.fn(),
  mockStoreGet: vi.fn(),
  mockStoreSet: vi.fn(),
  mockPrepareVideo: vi.fn(),
  mockUpload: vi.fn(),
  mockCleanup: vi.fn()
}))

vi.mock('@main/services/network/MainHttpClient', () => ({ mainHttpClient: { fetch: mockNetFetch } }))
vi.mock('@main/services/OssUploadService', () => ({ ossUploadService: { uploadLocalFile: mockUpload } }))
vi.mock('@main/utils/prepare-subtitle-audio', () => ({ prepareVideoUnderstanding: mockPrepareVideo }))

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

import ImageUnderstandServer from '../image-understand'

type ImageUnderstandServerInstance = InstanceType<typeof ImageUnderstandServer>

function createServer(workspaceRoot?: string) {
  return new ImageUnderstandServer(workspaceRoot)
}

async function callTool(server: ImageUnderstandServerInstance, toolName: string, args: Record<string, unknown>) {
  const handlers = (server.mcpServer.server as any)._requestHandlers
  const callToolHandler = handlers?.get('tools/call')
  if (!callToolHandler) {
    throw new Error('No tools/call handler registered')
  }
  return callToolHandler({ method: 'tools/call', params: { name: toolName, arguments: args } }, {})
}

async function listTools(server: ImageUnderstandServerInstance) {
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

describe('ImageUnderstandServer', () => {
  let workspaceRoot: string

  beforeEach(async () => {
    vi.resetAllMocks()
    mockStoreGet.mockImplementation((key: string) => (key === 'auth.refresh_token' ? 'refresh-token' : undefined))
    mockPrepareVideo.mockResolvedValue({ videoPath: '/tmp/compressed-720p.mp4', durationSeconds: 120, cleanup: mockCleanup })
    mockUpload.mockResolvedValue({ signedPublicUrl: 'https://oss.example.com/video.mp4' })
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'image-understand-test-'))
  })

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true }).catch(() => undefined)
  })

  it('should expose only the inspect_image tool', async () => {
    const server = createServer(workspaceRoot)
    const result = await listTools(server)

    expect(result.tools.map((tool: { name: string }) => tool.name)).toEqual(['inspect_image'])
    expect(result.tools[0].inputSchema.properties).toHaveProperty('image')
  })

  it('should send remote image urls directly to gpt-5.6-luna', async () => {
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
          id: 'chatcmpl-1',
          model: 'qwen3.7-plus',
          billing: {
            total_consumed_points: 1.33
          },
          choices: [
            {
              message: {
                role: 'assistant',
                content: '这是一张包含产品界面的截图。'
              }
            }
          ]
        })
      )

    const server = createServer(workspaceRoot)
    const result = await callTool(server, 'inspect_image', {
      url: 'https://example.com/demo.png',
      question: '这张图里是什么？'
    })

    expect(mockStoreSet).toHaveBeenCalledWith('auth.refresh_token', 'refresh-token-next')
    expect(mockNetFetch).toHaveBeenNthCalledWith(
      2,
      'https://open.vectcut.com/llm/chat/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
          'Content-Type': 'application/json'
        })
      })
    )

    const requestBody = JSON.parse(mockNetFetch.mock.calls[1][1].body as string)
    expect(requestBody.model).toBe('gpt-5.6-luna')
    expect(requestBody.messages[0].content[1]).toEqual({
      type: 'image_url',
      image_url: {
        url: 'https://example.com/demo.png'
      }
    })

    const payload = JSON.parse(result.content[0].text)
    expect(payload.answer).toBe('这是一张包含产品界面的截图。')
    expect(payload.billing).toEqual({
      total_consumed_points: 1.33
    })
    expect(payload.source_summary).toEqual([
      {
        original_input: 'https://example.com/demo.png',
        submitted_url: 'https://example.com/demo.png',
        source_kind: 'remote_image'
      }
    ])
  })

  it.each(['file_path', 'image'])('should convert local files supplied via %s to data urls before submitting', async (sourceField) => {
    const localImagePath = path.join(workspaceRoot, 'local-source.png')
    await fs.writeFile(localImagePath, Buffer.from('hello-image'))

    mockNetFetch
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: 'access-token',
          expires_in: 3600
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          id: 'chatcmpl-2',
          model: 'qwen3.7-plus',
          choices: [
            {
              message: {
                role: 'assistant',
                content: '本地图片识别完成。'
              }
            }
          ]
        })
      )

    const server = createServer(workspaceRoot)
    const result = await callTool(server, 'inspect_image', {
      [sourceField]: localImagePath
    })

    const requestBody = JSON.parse(mockNetFetch.mock.calls[1][1].body as string)
    expect(requestBody.model).toBe('gpt-5.6-luna')
    expect(requestBody.messages[0].content[1].type).toBe('image_url')
    expect(requestBody.messages[0].content[1].image_url.url).toMatch(/^data:image\/png;base64,/)

    const payload = JSON.parse(result.content[0].text)
    expect(payload.answer).toBe('本地图片识别完成。')
    expect(payload.source_summary).toEqual([
      {
        original_input: localImagePath,
        submitted_url: 'data:image/png;base64,<data-url-omitted>',
        source_kind: 'local_image'
      }
    ])
    expect(payload.artifact.file_path).toContain(path.join('.capcut', 'tool-results', 'image-understand'))

    const storedText = await fs.readFile(payload.artifact.file_path, 'utf8')
    const storedPayload = JSON.parse(storedText)
    expect(storedPayload.request.model).toBe('gpt-5.6-luna')
    expect(storedPayload.answer).toBe('本地图片识别完成。')
  })

  it('should parse SSE-style text responses from the chat completion endpoint', async () => {
    mockNetFetch
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: 'access-token',
          expires_in: 3600
        })
      )
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          [
            'data: {"choices":[{"delta":{"content":"这是"}}]}',
            'data: {"choices":[{"delta":{"content":"一张工具界面截图。"}}]}',
            'data: [DONE]'
          ].join('\n')
      } as Response)

    const server = createServer(workspaceRoot)
    const result = await callTool(server, 'inspect_image', {
      url: 'https://example.com/sse-demo.png'
    })

    const payload = JSON.parse(result.content[0].text)
    expect(payload.answer).toBe('这是一张工具界面截图。')
    expect(payload.response_summary.model).toBe('gpt-5.6-luna')
  })

  it('should preserve billing fields from SSE-style responses', async () => {
    mockNetFetch
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: 'access-token',
          expires_in: 3600
        })
      )
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          [
            'data: {"id":"chatcmpl-sse-1","model":"qwen3.7-plus","choices":[{"delta":{"content":"这是"}}]}',
            'data: {"choices":[{"delta":{"content":"一张截图。"}}],"usage":{"prompt_tokens":100,"completion_tokens":20}}',
            'data: {"billing":{"total_consumed_points":1.33}}',
            'data: [DONE]'
          ].join('\n')
      } as Response)

    const server = createServer(workspaceRoot)
    const result = await callTool(server, 'inspect_image', {
      url: 'https://example.com/sse-billing-demo.png'
    })

    const payload = JSON.parse(result.content[0].text)
    expect(payload.answer).toBe('这是一张截图。')
    expect(payload.billing).toEqual({
      total_consumed_points: 1.33
    })
    expect(payload.response_summary.id).toBe('chatcmpl-sse-1')
  })

  it('switches to Omni for prompt, uploads only compressed video, and preserves billing and artifacts', async () => {
    const videoPath = path.join(workspaceRoot, 'video.mp4')
    await fs.writeFile(videoPath, 'original-video')
    mockNetFetch.mockResolvedValueOnce(mockJsonResponse({ access_token: 'token' }))
      .mockResolvedValueOnce(mockJsonResponse({
        model: 'qwen3.8-omni-flash', choices: [{ message: { content: '节奏逐渐加快。' } }],
        billing: { total_consumed_points: 2 }
      }))
    const result = await callTool(createServer(workspaceRoot), 'inspect_image', {
      path: 'video.mp4', prompt: '分析节奏与情绪', question: 'ignored'
    })
    expect(mockPrepareVideo).toHaveBeenCalledWith(videoPath, undefined)
    expect(mockUpload).toHaveBeenCalledWith('/tmp/compressed-720p.mp4', expect.any(Object))
    expect(mockCleanup).toHaveBeenCalledOnce()
    expect(await fs.readFile(videoPath, 'utf8')).toBe('original-video')
    const body = JSON.parse(mockNetFetch.mock.calls[1][1].body)
    expect(body.model).toBe('qwen3.8-omni-flash')
    expect(body.messages[0].content).toEqual([
      { type: 'text', text: '分析节奏与情绪' },
      { type: 'video_url', video_url: { url: 'https://oss.example.com/video.mp4' } }
    ])
    const payload = JSON.parse(result.content[0].text)
    expect(payload).toMatchObject({
      mode: 'video_understand', model: 'qwen3.8-omni-flash', prompt: '分析节奏与情绪',
      answer: '节奏逐渐加快。', billing: { total_consumed_points: 2 },
      source_summary: [{ source_kind: 'local_video', duration_seconds: 120, resolution: '720p' }]
    })
    expect(JSON.parse(await fs.readFile(payload.artifact.file_path, 'utf8')).request.model).toBe('qwen3.8-omni-flash')
  })

  it('downloads remote video and deletes the downloaded temporary file', async () => {
    mockNetFetch.mockResolvedValueOnce(new Response('downloaded'))
      .mockResolvedValueOnce(mockJsonResponse({ access_token: 'token' }))
      .mockResolvedValueOnce(mockJsonResponse({ choices: [{ message: { content: 'Done' } }] }))
    const result = await callTool(createServer(workspaceRoot), 'inspect_image', { url: 'https://example.com/video.mp4', prompt: 'Analyze' })
    expect(result.isError).toBeUndefined()
    expect(JSON.parse(result.content[0].text).source_summary[0].source_kind).toBe('remote_video')
    await expect(fs.stat(mockPrepareVideo.mock.calls[0][0])).rejects.toThrow()
  })

  it('blocks overlong video before upload or model submission', async () => {
    const videoPath = path.join(workspaceRoot, 'long.mp4')
    await fs.writeFile(videoPath, 'video')
    mockPrepareVideo.mockRejectedValue(new Error('视频时长不能超过 2 分钟'))
    const result = await callTool(createServer(workspaceRoot), 'inspect_image', { url: videoPath, prompt: 'Analyze' })
    expect(result.isError).toBe(true)
    expect(mockUpload).not.toHaveBeenCalled()
    expect(mockNetFetch).not.toHaveBeenCalled()
  })

  it.each(['', ' ', 123, null])('rejects invalid prompt %j', async (prompt) => {
    const result = await callTool(createServer(workspaceRoot), 'inspect_image', { url: 'https://example.com/video.mp4', prompt })
    expect(result.isError).toBe(true)
    expect(mockPrepareVideo).not.toHaveBeenCalled()
    expect(mockNetFetch).not.toHaveBeenCalled()
  })

  it('cleans compressed copy after upload failure', async () => {
    const videoPath = path.join(workspaceRoot, 'video.mp4')
    await fs.writeFile(videoPath, 'video')
    mockUpload.mockRejectedValue(new Error('upload failed'))
    const result = await callTool(createServer(workspaceRoot), 'inspect_image', { url: videoPath, prompt: 'Analyze' })
    expect(result.isError).toBe(true)
    expect(mockCleanup).toHaveBeenCalledOnce()
    expect(mockNetFetch).not.toHaveBeenCalled()
  })
})
