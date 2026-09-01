import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
    vi.clearAllMocks()
    mockStoreGet.mockImplementation((key: string) => (key === 'auth.refresh_token' ? 'refresh-token' : undefined))
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'image-understand-test-'))
  })

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true }).catch(() => undefined)
  })

  it('should expose only the inspect_image tool', async () => {
    const server = createServer(workspaceRoot)
    const result = await listTools(server)

    expect(result.tools.map((tool: { name: string }) => tool.name)).toEqual(['inspect_image'])
  })

  it('should send remote image urls directly to qwen3.7-plus', async () => {
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
    expect(requestBody.model).toBe('qwen3.7-plus')
    expect(requestBody.messages[0].content[1]).toEqual({
      type: 'image_url',
      image_url: {
        url: 'https://example.com/demo.png'
      }
    })

    const payload = JSON.parse(result.content[0].text)
    expect(payload.answer).toBe('这是一张包含产品界面的截图。')
    expect(payload.source_summary).toEqual([
      {
        original_input: 'https://example.com/demo.png',
        submitted_url: 'https://example.com/demo.png',
        source_kind: 'remote_image'
      }
    ])
  })

  it('should convert local files to data urls before submitting', async () => {
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
      file_path: localImagePath
    })

    const requestBody = JSON.parse(mockNetFetch.mock.calls[1][1].body as string)
    expect(requestBody.model).toBe('qwen3.7-plus')
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
    expect(storedPayload.request.model).toBe('qwen3.7-plus')
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
    expect(payload.response_summary.model).toBe('qwen3.7-plus')
  })
})
