const mockSaveArtifact = vi.hoisted(() => vi.fn(async () => '/workspace/artifact/generated'))
vi.mock('../filesystem/tools/download', () => ({ saveArtifactFile: mockSaveArtifact }))
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockNetFetch, mockStat, mockStoreGet, mockStoreSet, mockUploadLocalFile, mockUploadImageBase64 } = vi.hoisted(() => ({
  mockNetFetch: vi.fn(),
  mockStat: vi.fn(),
  mockStoreGet: vi.fn(),
  mockStoreSet: vi.fn(),
  mockUploadLocalFile: vi.fn(),
  mockUploadImageBase64: vi.fn()
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

vi.mock('node:fs/promises', () => ({
  stat: mockStat
}))

vi.mock('@main/services/OssUploadService', () => ({
  ossUploadService: {
    uploadLocalFile: mockUploadLocalFile,
    uploadImageBase64: mockUploadImageBase64
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

const { mockSend, mockGetMainWindow } = vi.hoisted(() => ({ mockSend: vi.fn(), mockGetMainWindow: vi.fn() }))
vi.mock('@main/services/WindowService', () => ({ windowService: { getMainWindow: mockGetMainWindow } }))

import ImageGenerateServer from '../image-generate'
import ColorGradeServer from '../color-grade'
import { rankCodemodeTools } from '../../services/agents/services/claudecode/harness/codemode-search'

vi.mock('@main/utils', () => ({ getResourcePath: () => '/nonexistent-resource-path' }))

type ImageGenerateServerInstance = InstanceType<typeof ImageGenerateServer>

function createServer() {
  return new ImageGenerateServer()
}

async function callTool(
  server: ImageGenerateServerInstance,
  args: Record<string, unknown>,
  toolName = 'generate_or_edit_image'
) {
  const handlers = (server.mcpServer.server as any)._requestHandlers
  const callToolHandler = handlers?.get('tools/call')
  if (!callToolHandler) {
    throw new Error('No tools/call handler registered')
  }
  return callToolHandler({ method: 'tools/call', params: { name: toolName, arguments: args } }, {})
}

async function listTools(server: ImageGenerateServerInstance) {
  const handlers = (server.mcpServer.server as any)._requestHandlers
  const listHandler = handlers?.get('tools/list')
  if (!listHandler) {
    throw new Error('No tools/list handler registered')
  }
  return listHandler({ method: 'tools/list', params: {} }, {})
}

async function listToolsFromMcpServer(mcpServer: ImageGenerateServerInstance['mcpServer']) {
  const handlers = (mcpServer.server as any)._requestHandlers
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

describe('ImageGenerateServer', () => {
  beforeEach(() => {
    mockSend.mockReset()
    mockGetMainWindow.mockReset().mockReturnValue({ isDestroyed: () => false, webContents: { send: mockSend } })
    mockNetFetch.mockReset()
    mockStat.mockReset()
    mockStoreGet.mockReset()
    mockStoreSet.mockReset()
    mockUploadLocalFile.mockReset()
    mockUploadImageBase64.mockReset()
    mockStoreGet.mockImplementation((key: string) => (key === 'auth.refresh_token' ? 'refresh-token' : undefined))
    mockStat.mockResolvedValue({
      isFile: () => true
    })
  })

  it('notifies wait and repeated status with stable task identity and creation time', async () => {
    const server = new ImageGenerateServer({ runtimeSessionId: 'session-a' })
    const completed = { success: true, status: 'success', result: { image: 'https://example.com/result.png' } }
    const request = vi.spyOn(server as any, 'requestWithAuth')
      .mockResolvedValueOnce(mockJsonResponse({ task_id: 'task-a' }))
      .mockResolvedValue(mockJsonResponse(completed))
    vi.spyOn(server as any, 'buildInlineResultImageContent').mockResolvedValue(null)
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000)
    try {
      await callTool(server, { prompt: 'an image' })
      now.mockReturnValue(2000)
      const status = await callTool(server, { action: 'status', taskId: 'task-a' })
      expect(JSON.parse(status.content[0].text).task_id).toBe('task-a')
      expect(mockSend.mock.calls).toEqual([
        ['app:image-generated', { id: 'task-a', runtimeSessionId: 'session-a', taskId: 'task-a', imageUrl: completed.result.image, filePath: '/workspace/artifact/generated', createdAt: 1000, status: 'completed' }],
        ['app:image-generated', { id: 'task-a', runtimeSessionId: 'session-a', taskId: 'task-a', imageUrl: completed.result.image, filePath: '/workspace/artifact/generated', createdAt: 1000, status: 'completed' }]
      ])
      expect(request).toHaveBeenCalledTimes(3)
    } finally {
      now.mockRestore()
    }
  })

  it.each([
    { status: 'failed', success: false, image: 'https://example.com/a.png' },
    { status: 'error', image: 'https://example.com/a.png' },
    { status: 'running', image: 'https://example.com/a.png' },
    { status: 'success', success: false, image: 'https://example.com/a.png' },
    { status: 'success', image: 'file:///tmp/a.png' },
    { status: 'success', image: 'data:image/png;base64,YQ==' },
    { status: 'success', image: 'https://' },
    { status: 'success', image: undefined }
  ])('does not notify non-completed or invalid image results: %j', async ({ status, success, image }) => {
    const server = new ImageGenerateServer({ runtimeSessionId: 'session-a' })
    vi.spyOn(server as any, 'requestWithAuth').mockResolvedValue(mockJsonResponse({ status, success, result: { image } }))
    vi.spyOn(server as any, 'buildInlineResultImageContent').mockResolvedValue(null)
    await callTool(server, { action: 'status', taskId: 'task-a' })
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('never infers multi-image fields or notifies submit, external, or sessionless calls', async () => {
    for (const options of [{}, { runtimeSessionId: ' ' }, { runtimeSessionId: 'session-a', external: true }, { runtimeSessionId: 'session-a' }]) {
      const server = new ImageGenerateServer(options)
      vi.spyOn(server as any, 'requestWithAuth').mockResolvedValue(mockJsonResponse({ success: true, task_id: 'task-a', status: 'success', result: options.runtimeSessionId === 'session-a' && !options.external ? { images: ['https://example.com/a.png'] } : { image: 'https://example.com/a.png' } }))
      vi.spyOn(server as any, 'buildInlineResultImageContent').mockResolvedValue(null)
      await callTool(server, options.external ? { task_id: 'task-a' } : { action: 'status', taskId: 'task-a' }, options.external ? 'task_status' : 'generate_or_edit_image')
      if (!options.external) {
        vi.mocked((server as any).requestWithAuth).mockResolvedValue(mockJsonResponse({
          success: true, task_id: 'task-a', status: 'success', result: { image: 'https://example.com/a.png' }
        }))
        await callTool(server, { action: 'submit', prompt: 'an image' })
      }
    }
    expect(mockSend).not.toHaveBeenCalled()
  })

  it.each(['missing', 'destroyed', 'throws'])('notification window failure does not change tool success: %s', async (mode) => {
    const server = new ImageGenerateServer({ runtimeSessionId: 'session-a' })
    vi.spyOn(server as any, 'requestWithAuth').mockResolvedValue(mockJsonResponse({ success: true, status: 'success', result: { image: 'http://example.com/a.png' } }))
    vi.spyOn(server as any, 'buildInlineResultImageContent').mockResolvedValue(null)
    if (mode === 'missing') mockGetMainWindow.mockReturnValue(null)
    if (mode === 'destroyed') mockGetMainWindow.mockReturnValue({ isDestroyed: () => true })
    if (mode === 'throws') mockSend.mockImplementation(() => { throw new Error('IPC closed') })
    const result = await callTool(server, { action: 'status', taskId: 'task-a' })
    expect(result.isError).not.toBe(true)
    expect(JSON.parse(result.content[0].text).success).toBe(true)
  })

  it('isolates notifications between session-scoped servers', async () => {
    for (const runtimeSessionId of ['session-a', 'session-b']) {
      const server = new ImageGenerateServer({ runtimeSessionId })
      vi.spyOn(server as any, 'requestWithAuth').mockResolvedValue(mockJsonResponse({ status: 'success', result: { image: 'https://example.com/a.png' } }))
      vi.spyOn(server as any, 'buildInlineResultImageContent').mockResolvedValue(null)
      await callTool(server, { action: 'status', taskId: 'task-a' })
    }
    expect(mockSend.mock.calls.map((call) => call[1].runtimeSessionId)).toEqual(['session-a', 'session-b'])
  })

  it('isolates external tools on every transport and rejects hidden tools', async () => {
    const external = new ImageGenerateServer({ external: true })
    expect((await listTools(external)).tools.map((t: any) => t.name)).toEqual(['submit', 'task_status'])
    expect((await listToolsFromMcpServer(external.createMcpServer())).tools.map((t: any) => t.name)).toEqual(['submit', 'task_status'])
    for (const name of ['generate_or_edit_image', 'generate_image']) {
      expect((await callTool(external, { prompt: 'test' }, name)).isError).toBe(true)
    }
    for (const name of ['submit', 'task_status']) {
      expect((await callTool(createServer(), {}, name)).isError).toBe(true)
    }
    expect(mockNetFetch).not.toHaveBeenCalled()
  })

  it.each(['reference_images', 'referenceImages', 'referenceImage', 'sourceImage', 'sourceImages', 'baseImage', 'editImage'])(
    'rejects unsafe references through %s before any IO, even when another alias overrides it', async (field) => {
      const external = new ImageGenerateServer({ external: true })
      for (const value of ['/tmp/a.png', 'file:///tmp/a.png', 'data:image/png;base64,AAAA', 'ftp://example.com/a',
        'http://127.0.0.1/a', 'http://2130706433/a', 'http://10.0.0.1/a', 'http://[::1]/a',
        'http://[::ffff:127.0.0.1]/a', 'http://localhost/a', 'http://169.254.169.254/a', 'https://user:pass@example.com/a', null, 123]) {
        const result = await callTool(external, { prompt: 'test', [field]: [value] }, 'submit')
        expect(result.isError, String(value)).toBe(true)
        const overridden = await callTool(external, { prompt: 'test', [field]: [value], referenceImage: 'https://example.com/safe.png', ...(field === 'referenceImage' ? { referenceImage: value } : {}) }, 'submit')
        expect(overridden.isError).toBe(true)
      }
      expect(mockNetFetch).not.toHaveBeenCalled()
      expect(mockStat).not.toHaveBeenCalled()
      expect(mockUploadLocalFile).not.toHaveBeenCalled()
      expect(mockUploadImageBase64).not.toHaveBeenCalled()
    }
  )

  it('submits directly to the backend without polling, uploading or downloading references', async () => {
    const external = new ImageGenerateServer({ external: true })
    mockNetFetch.mockResolvedValueOnce(mockJsonResponse({ access_token: 'token' }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true, task_id: 'remote-task', status: 'queued' }))
    const result = await callTool(external, { prompt: 'test', action: 'submit_and_wait', sourceImage: 'https://example.com/a.png' }, 'submit')
    const payload = JSON.parse(result.content[0].text)
    expect(payload.task_id).toBe('remote-task')
    expect(payload.polling_hint).toContain('task_status')
    expect(mockNetFetch).toHaveBeenCalledTimes(2)
    expect(JSON.parse(mockNetFetch.mock.calls[1][1].body).reference_images).toEqual(['https://example.com/a.png'])
    expect(mockNetFetch.mock.calls[1][1].signal).toBeInstanceOf(AbortSignal)
  })

  it.each([
    { status: 'PROCESSING', progress: 0.5 },
    { status: 'SUCCESS', result: { image: 'http://127.0.0.1/private', billing: { points: 1 } } },
    { status: 'FAILED', result: { error: 'moderation rejected' } }
  ])('queries once and preserves backend result without fetching images: $status', async (backend) => {
    const external = new ImageGenerateServer({ external: true })
    mockNetFetch.mockResolvedValueOnce(mockJsonResponse({ access_token: 'token' }))
      .mockResolvedValueOnce(mockJsonResponse(backend))
    const result = await callTool(external, { task_id: 'remote-task' }, 'task_status')
    const payload = JSON.parse(result.content[0].text)
    expect(payload.task_id).toBe('remote-task')
    expect(payload.status).toBe(backend.status.toLowerCase())
    expect(payload.result).toEqual(backend.result)
    expect(result.content).toHaveLength(1)
    if (backend.status === 'FAILED') {
      expect(result.isError).toBe(true)
      expect(payload.error).toBe('moderation rejected')
    }
    expect(mockNetFetch).toHaveBeenCalledTimes(2)
  })

  it.each([{ success: false, error: 'quota exceeded' }, { success: true }])('reports rejected or malformed submissions', async (backend) => {
    const external = new ImageGenerateServer({ external: true })
    mockNetFetch.mockResolvedValueOnce(mockJsonResponse({ access_token: 'token' }))
      .mockResolvedValueOnce(mockJsonResponse(backend))
    const result = await callTool(external, { prompt: 'test' }, 'submit')
    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0].text).status).toBe('failed')
  })

  it('returns a stable query error without claiming the backend task failed', async () => {
    mockNetFetch.mockResolvedValueOnce(mockJsonResponse({ access_token: 'token' }))
      .mockResolvedValueOnce(mockJsonResponse({ error: 'unavailable' }, false, 503))
    const result = await callTool(new ImageGenerateServer({ external: true }), { task_id: 'existing' }, 'task_status')
    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0].text)).toMatchObject({ success: false, status: 'unknown', task_id: 'existing' })
    expect(mockNetFetch).toHaveBeenCalledTimes(2)
  })

  it('requires a nonempty task_id without IO', async () => {
    const result = await callTool(new ImageGenerateServer({ external: true }), { task_id: ' ' }, 'task_status')
    expect(result.isError).toBe(true)
    expect(mockNetFetch).not.toHaveBeenCalled()
  })

  it('should expose only the generate_or_edit_image tool', async () => {
    const server = createServer()
    const result = await listTools(server)

    expect(result.tools).toHaveLength(1)
    expect(result.tools.map((tool: { name: string }) => tool.name)).toEqual(['generate_or_edit_image'])
    expect(result.tools[0].description).toContain('transparent-background PNG')
    expect(result.tools[0].inputSchema.properties.transparent_background.description).toContain('gpt-image-2')
    expect(result.tools[0].inputSchema.properties.background.enum).toContain('transparent')
  })

  it('should refresh image capabilities from remote and persist them locally', async () => {
    mockNetFetch
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: 'access-token',
          expires_in: 3600
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          capabilities: {
            'seedream-4.5': {
              badges: ['限时优惠'],
              reference_supported: true,
              resolutions: {
                '1K': [
                  { ratio: '1:1', size: '1024x1024' },
                  { ratio: '16:9', size: '1280x720' }
                ]
              }
            },
            'seedream-5.0': {
              reference_supported: true,
              resolutions: {
                '2K': [{ ratio: '1:1', size: '2048x2048' }]
              }
            }
          },
          prices: {
            'seedream-4.5': {
              project_id: '26',
              resource_points_per_unit: 30
            },
            'seedream-5.0': {
              project_id: '45',
              resource_points_per_unit: 25
            }
          }
        })
      )

    const server = createServer()
    const refreshResult = await server.refreshImageCapabilitiesCache()
    const result = await server.listImageCapabilities({
      model: 'seedream-4.5',
      ratio: '1:1'
    })

    expect(refreshResult).toEqual({ updated: true })
    expect(mockNetFetch).toHaveBeenNthCalledWith(
      2,
      'https://open.vectcut.com/llm/image/model_capabilities',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
          'X-Client-Type': 'pc'
        })
      })
    )
    expect(mockStoreSet).toHaveBeenCalledWith(
      'image.capabilities_payload',
      expect.objectContaining({
        capabilities: expect.objectContaining({
          'seedream-4.5': expect.any(Object)
        }),
        prices: expect.any(Object),
        updatedAt: expect.any(Number)
      })
    )

    expect(result).toEqual({
      requestedModel: 'seedream-4.5',
      resolvedModel: 'seedream-4.5',
      models: [
        {
          model: 'seedream-4.5',
          badges: ['限时优惠'],
          reference_supported: true,
          resolutions: {
            '1K': [{ ratio: '1:1', size: '1024x1024' }]
          },
          price: {
            project_id: '26',
            resource_points_per_unit: 30
          }
        }
      ]
    })
  })

  it('should use bundled default image model list without remote fetch', async () => {
    const server = createServer()
    const firstResult = await server.getImageModelList()
    const secondResult = await server.getImageModelList()

    expect(firstResult).toEqual({
      models: [
        'nano_banana_2.1',
        'nano_banana_pro',
        'nano_banana_2',
        'gpt-image-2-all',
        'gpt-image-2.5-all',
        'seedream-5.0',
        'seedream-5.0-pro',
        'seedream-4.5',
        'seedream-4.0',
        'seedream-3.0'
      ],
      defaultModel: ''
    })
    expect(secondResult).toEqual(firstResult)
    expect(mockNetFetch).not.toHaveBeenCalled()
  })

  it('should mark GPT Image 2 and 2.5 as transparent-background PNG capable in defaults', async () => {
    const server = createServer()
    const result = await server.listImageCapabilities({
      includePrices: false
    })
    const byModel = new Map(result.models.map((item) => [item.model, item]))

    for (const model of ['gpt-image-2-all', 'gpt-image-2.5-all']) {
      expect(byModel.get(model)).toMatchObject({
        transparent_background_supported: true,
        output_formats: expect.arrayContaining(['png'])
      })
    }
  })

  it('should create a fresh MCP server instance for each bridge session', async () => {
    const server = createServer()

    const freshMcpServer = server.createMcpServer()
    const originalTools = await listTools(server)
    const freshTools = await listToolsFromMcpServer(freshMcpServer)

    expect(freshMcpServer).not.toBe(server.mcpServer)
    expect(freshTools.tools).toEqual(originalTools.tools)
  })

  it('should omit prices when includePrices is false', async () => {
    const server = createServer()
    const result = await server.listImageCapabilities({
      model: 'seedream-4.5',
      tier: '2K',
      includePrices: false
    })

    expect(result).toMatchObject({
      requestedModel: 'seedream-4.5',
      resolvedModel: 'seedream-4.5',
      models: [
        {
          model: 'seedream-4.5',
          reference_supported: true
        }
      ]
    })
    expect(result.models[0].resolutions).toEqual({
      '2K': expect.arrayContaining([{ ratio: '1:1', size: '2048x2048' }])
    })
    expect(result.models[0]).not.toHaveProperty('price')
  })

  it('should submit and wait for an image generation task by default', async () => {
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
          task_id: 'task-123',
          message_id: 'msg-123',
          status: 'queued',
          queue_name: 'llm-image-task',
          error: ''
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          success: true,
          task_id: 'task-123',
          status: 'success',
          progress: 100,
          message: '处理完成',
          error: '',
          result: {
            billing: {
              consume: 3
            },
            image: 'https://example.com/result.png',
            draft_id: 'draft-1',
            draft_url: 'https://www.vectcut.com/draft/downloader?draft_id=draft-1',
            reused_from_history: false
          }
        })
      )

    const server = createServer()
    const result = await callTool(server, {
      prompt: '  一只站在云上的猫  ',
      model: 'seedream-4.5',
      size: '1024x1024',
      referenceImage: 'https://example.com/ref.png',
      composeDraft: false,
      draftId: 'draft-1'
    })

    expect(mockStoreSet).toHaveBeenCalledWith('auth.refresh_token', 'refresh-token-next')
    expect(mockNetFetch).toHaveBeenNthCalledWith(
      2,
      'https://open.vectcut.com/llm/image/submit_task/generate',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
          'Content-Type': 'application/json'
        })
      })
    )
    expect(mockNetFetch).toHaveBeenNthCalledWith(
      3,
      'https://open.vectcut.com/llm/image/submit_task/task_status?task_id=task-123',
      expect.objectContaining({
        method: 'GET'
      })
    )
    expect(JSON.parse(String(mockNetFetch.mock.calls[1]?.[1]?.body))).toEqual({
      prompt: '一只站在云上的猫',
      model: 'seedream-4.5',
      size: '1024x1024',
      compose_draft: false,
      draft_id: 'draft-1',
      reference_images: ['https://example.com/ref.png']
    })

    expect(result.isError).not.toBe(true)
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      provider: 'vectcut',
      action: 'submit_and_wait',
      estimated_wait_time: '3-5 minutes',
      requested_model: 'seedream-4.5',
      resolved_model: 'seedream-4.5',
      model_match_type: 'exact',
      success: true,
      task_id: 'task-123',
      status: 'success',
      progress: 100,
      message: '处理完成',
      error: '',
      billing: {
        consume: 3
      },
      output: {
        image_url: 'https://example.com/result.png',
        draft_id: 'draft-1',
        draft_url: 'https://www.vectcut.com/draft/downloader?draft_id=draft-1'
      },
      result: {
        billing: {
          consume: 3
        },
        image: 'https://example.com/result.png',
        draft_id: 'draft-1',
        draft_url: 'https://www.vectcut.com/draft/downloader?draft_id=draft-1',
        reused_from_history: false
      }
    })
  })

  it('should keep supporting the legacy generate_image tool name', async () => {
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
          task_id: 'task-legacy-123',
          status: 'queued'
        })
      )

    const server = createServer()
    const result = await callTool(server, {
      action: 'submit',
      prompt: '把这张图改成胶片质感',
      editImage: 'https://example.com/original.png'
    }, 'generate_image')

    expect(result.isError).not.toBe(true)
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      provider: 'vectcut',
      action: 'submit',
      task_id: 'task-legacy-123'
    })
  })

  it('should upload local reference images before submitting the image task', async () => {
    mockUploadLocalFile.mockResolvedValue({
      signedPublicUrl: 'https://oss-cn-hangzhou.aliyuncs.com/agent_tmp/demo/reference-style.png?token=1'
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
          success: true,
          task_id: 'task-local-ref-123',
          status: 'queued'
        })
      )

    const server = createServer()
    const result = await callTool(server, {
      action: 'submit',
      prompt: '参考这张图的字体风格，生成一张新的海报',
      referenceImage: '/tmp/reference-style.png'
    })

    expect(mockUploadLocalFile).toHaveBeenCalledWith('/tmp/reference-style.png', {
      bucket: 'oss-hangzhou-mp4',
      region: 'oss-cn-hangzhou',
      folder: 'agent_tmp/{uid}',
      objectKeyPrefix: 'vectcut_ai_image_reference_',
      signExpiresSeconds: 3600
    })
    expect(JSON.parse(String(mockNetFetch.mock.calls[1]?.[1]?.body))).toEqual({
      prompt: '参考这张图的字体风格，生成一张新的海报',
      reference_images: ['https://oss-cn-hangzhou.aliyuncs.com/agent_tmp/demo/reference-style.png?token=1']
    })
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      provider: 'vectcut',
      action: 'submit',
      task_id: 'task-local-ref-123',
      reference_images: ['https://oss-cn-hangzhou.aliyuncs.com/agent_tmp/demo/reference-style.png?token=1']
    })
  })

  it('should upload pasted screenshot data URLs before submitting the image task', async () => {
    mockUploadImageBase64.mockResolvedValue({
      publicUrl: 'https://open.vectcut.com/download/agent_tmp/demo/pasted-screenshot.png?token=1',
      objectKey: 'agent_tmp/demo/pasted-screenshot.png'
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
          success: true,
          task_id: 'task-inline-ref-123',
          status: 'queued'
        })
      )

    const server = createServer()
    const result = await callTool(server, {
      action: 'submit',
      prompt: '参考这张粘贴截图生成一张新的海报',
      referenceImage: 'data:image/png;base64,aGVsbG8='
    })

    expect(mockUploadImageBase64).toHaveBeenCalledWith('aGVsbG8=', 'image/png')
    expect(JSON.parse(String(mockNetFetch.mock.calls[1]?.[1]?.body))).toEqual({
      prompt: '参考这张粘贴截图生成一张新的海报',
      reference_images: ['https://open.vectcut.com/download/agent_tmp/demo/pasted-screenshot.png?token=1']
    })
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      provider: 'vectcut',
      action: 'submit',
      task_id: 'task-inline-ref-123',
      reference_images: ['https://open.vectcut.com/download/agent_tmp/demo/pasted-screenshot.png?token=1']
    })
  })

  it('should reject relative local reference image paths', async () => {
    mockNetFetch.mockResolvedValueOnce(
      mockJsonResponse({
        access_token: 'access-token',
        expires_in: 3600
      })
    )

    const server = createServer()
    const result = await callTool(server, {
      prompt: '参考这张图生成一张新的海报',
      referenceImage: 'reference-style.png'
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain(
      "'reference_images' must use remote URLs, file URLs, or absolute local paths; upload local reference images first if needed"
    )
  })

  it('should accept editing-style image aliases and map them to reference fields', async () => {
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
          task_id: 'task-edit-123',
          status: 'queued'
        })
      )

    const server = createServer()
    await callTool(server, {
      action: 'submit',
      prompt: '保留人物主体，把背景改成雪山，并提升清晰度',
      editImage: 'https://example.com/original.png',
      composeDraft: false
    })

    expect(mockNetFetch).toHaveBeenNthCalledWith(
      2,
      'https://open.vectcut.com/llm/image/submit_task/generate',
      expect.objectContaining({
        method: 'POST'
      })
    )
    expect(JSON.parse(String(mockNetFetch.mock.calls[1]?.[1]?.body))).toEqual({
      prompt: '保留人物主体，把背景改成雪山，并提升清晰度',
      compose_draft: false,
      reference_images: ['https://example.com/original.png']
    })
  })

  it('should resolve non-standard model aliases to the closest supported model', async () => {
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
          task_id: 'task-model-123',
          status: 'queued'
        })
      )

    const server = createServer()
    const result = await callTool(server, {
      action: 'submit',
      prompt: '保留主体，把图片变成电影海报风格',
      model: 'gptimage2',
      editImage: 'https://example.com/original.png',
      transparent_background: true,
      outputFormat: 'png'
    })

    expect(mockNetFetch).toHaveBeenNthCalledWith(
      2,
      'https://open.vectcut.com/llm/image/submit_task/generate',
      expect.objectContaining({
        method: 'POST'
      })
    )
    expect(JSON.parse(String(mockNetFetch.mock.calls[1]?.[1]?.body))).toEqual({
      prompt: '保留主体，把图片变成电影海报风格',
      model: 'gpt-image-2-all',
      reference_images: ['https://example.com/original.png'],
      transparent_background: true,
      output_format: 'png'
    })

    expect(JSON.parse(result.content[0].text)).toMatchObject({
      provider: 'vectcut',
      action: 'submit',
      requested_model: 'gptimage2',
      resolved_model: 'gpt-image-2-all'
    })
  })

  it('should query image generation task status', async () => {
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
          task_id: 'task-123',
          status: 'success',
          progress: 100,
          message: '处理完成',
          error: '',
          result: {
            image: 'https://example.com/result.png',
            draft_id: 'draft-1',
            reused_from_history: false
          }
        })
      )

    const server = createServer()
    const result = await callTool(server, {
      action: 'status',
      taskId: 'task-123'
    })

    expect(mockNetFetch).toHaveBeenNthCalledWith(
      2,
      'https://open.vectcut.com/llm/image/submit_task/task_status?task_id=task-123',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token'
        })
      })
    )

    expect(result.isError).not.toBe(true)
    expect(JSON.parse(result.content[0].text)).toEqual({
      provider: 'vectcut',
      action: 'status',
      estimated_wait_time: '3-5 minutes',
      success: true,
      task_id: 'task-123',
      status: 'success',
      progress: 100,
      message: '处理完成',
      error: '',
      output: {
        image_url: 'https://example.com/result.png',
        draft_id: 'draft-1',
        draft_url: undefined,
        reused_from_history: false,
        error: undefined
      },
      result: {
        image: 'https://example.com/result.png',
        draft_id: 'draft-1',
        reused_from_history: false
      }
    })
  })

  it('should require prompt when submitting a task', async () => {
    const server = createServer()
    const result = await callTool(server, {
      action: 'submit'
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("'prompt' is required")
  })

  it('should reject unknown capability model filters', async () => {
    mockNetFetch
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: 'access-token',
          expires_in: 3600
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          capabilities: {
            'seedream-4.5': {
              reference_supported: true,
              resolutions: {
                '1K': [{ ratio: '1:1', size: '1024x1024' }]
              }
            }
          },
          prices: {}
        })
      )

    const server = createServer()
    await expect(server.listImageCapabilities({
      model: 'unknown-model'
    })).rejects.toThrow('Unknown image model')
  })
})

 describe('ImageGenerateServer artifact persistence', () => {
  it('awaits saving before returning a local file path', async () => {
    const server = new ImageGenerateServer({ runtimeSessionId: 'save-session', workspaceRoot: '/workspace' }) as any
    const result: any = { success: true, status: 'success', task_id: 'save-test', output: { image_url: 'https://example.com/result.png' } }
    let release!: (path: string) => void
    mockSaveArtifact.mockImplementationOnce(() => new Promise<string>(resolve => { release = resolve }))
    let settled = false
    const pending = server.formatImageTaskResult(result).then((value: any) => { settled = true; return value })
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(mockSaveArtifact).toHaveBeenLastCalledWith(expect.objectContaining({ workspaceRoot: '/workspace' }))
    release('/workspace/artifact/result')
    const response = await pending
    expect(JSON.parse(response.content[0].text)).toMatchObject({ filePath: '/workspace/artifact/result', file_path: '/workspace/artifact/result' })
  })
  it('preserves completed remote output when saving fails without resubmitting', async () => {
    const server = new ImageGenerateServer({ runtimeSessionId: 'save-session', workspaceRoot: '/workspace' }) as any
    const result: any = { success: true, status: 'success', task_id: 'save-test', output: { image_url: 'https://example.com/result.png' } }
    const request = vi.spyOn(server, 'requestWithAuth')
    mockSaveArtifact.mockRejectedValueOnce(new Error('download exhausted after 5 attempts'))
    const response = await server.formatImageTaskResult(result)
    expect(JSON.parse(response.content[0].text)).toMatchObject({ save_failed: true, output: { image_url: 'https://example.com/result.png' } })
    expect(request).not.toHaveBeenCalled()
  })
 })

// ====================================================================
// codemode BM25 可发现性：图像编辑意图必须落到 AI 生图，且不得抢邻居的意图
// ====================================================================
describe('image-generate codemode 可发现性', () => {
  const entry = (server: string, name: string, description: string) => ({
    name: `mcp__vectcut__${server}__${name}`,
    description: `[${server}] ${description}`
  })

  // 邻居描述为对应源文件的逐字摘录，作为真实竞争项
  const neighborFixtures = [
    entry('video-portrait-matte', 'submit_video_portrait_matte_task', 'Cut the person out of a video (portrait matting) and return a WEBM video with the background removed. Output format defaults to WEBM and can be overridden with format (WEBM/MOV/MP4). Submits and waits for the finished video in this one long-running call (up to 35 minutes).'),
    entry('subtitle-recognition', 'submit_subtitle_recognition_task', 'Run subtitle recognition for an audio or video source and wait until the same tool call finishes. This extracts subtitle text and timed segments only, without writing anything back into a draft.'),
    entry('video-understand', 'submit_video_detail_task', 'Video understanding / 视频理解、参考视频复刻、模仿、拆解: analyze reference videos before recreation or cloning, including shots, editing rhythm, visual style, captions, transitions and audio cues.'),
    entry('ffmpeg-media', 'capture_frame_at_timestamp', 'Capture a frame image from a video at a specific timestamp with the bundled ffmpeg.')
  ]

  const buildCatalog = async () => {
    const imageTools = (await listTools(createServer())).tools
    const gradeTools = (await listTools(new ColorGradeServer() as any)).tools
    return [
      ...imageTools.map((t: any) => entry('image', t.name, t.description)),
      ...gradeTools.map((t: any) => entry('color-grade', t.name, t.description)),
      ...neighborFixtures
    ]
  }

  // codemode 要求模型用英文关键词检索，故断言全部用英文。
  // 其中 remove watermark / remove object 等形式是 A/B 实测里旧描述真实漏掉、
  // 且会被 video-portrait-matte 的工具名加权抢走的 case。
  const imageEditQueries = [
    'change background', 'replace background', 'sky replacement',
    'face swap', 'replace face', 'virtual try-on', 'outfit swap', 'change clothes',
    'outpainting', 'uncrop', 'extend canvas', 'change aspect ratio',
    'photo retouching', 'inpainting', 'beauty retouch', 'skin smoothing', 'face slimming',
    'remove watermark', 'remove logo', 'watermark removal',
    'remove subtitles', 'erase text', 'remove object', 'remove person',
    'image restoration', 'old photo restoration', 'denoise', 'upscale photo', 'super resolution',
    'colorize photo', 'restyle anime', 'ID photo', 'transparent cutout',
    'replace product', 'product photo', 'poster layout', 'generate image'
  ]

  it.each(imageEditQueries)('英文图像编辑查询「%s」排第一的是 AI 生图', async (query) => {
    const catalog = await buildCatalog()
    const ranked = rankCodemodeTools(catalog, query, 5)
    expect(ranked.length).toBeGreaterThan(0)
    expect(ranked[0].name).toContain('generate_or_edit_image')
  })

  const neighborQueries: Array<[string, string]> = [
    ['color grading', 'color-grade'],
    ['match reference look', 'color-grade'],
    ['apply lut to batch', 'color-grade'],
    ['unify color across clips', 'color-grade'],
    ['video understanding', 'video-understand']
  ]

  it.each(neighborQueries)('邻居意图「%s」不得被 AI 生图抢走', async (query, expectedServer) => {
    const catalog = await buildCatalog()
    const ranked = rankCodemodeTools(catalog, query, 5)
    expect(ranked.length).toBeGreaterThan(0)
    expect(ranked[0].name).toContain(expectedServer)
  })
})
