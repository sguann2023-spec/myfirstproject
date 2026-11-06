import fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockNetFetch, mockStoreGet, mockStoreSet } = vi.hoisted(() => ({
  mockNetFetch: vi.fn(),
  mockStoreGet: vi.fn(),
  mockStoreSet: vi.fn()
}))

const mockWebContentsSend = vi.fn()

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

vi.mock('@main/services/WindowService', () => ({
  windowService: {
    getMainWindow: vi.fn(() => ({
      isDestroyed: () => false,
      webContents: {
        send: mockWebContentsSend
      }
    }))
  }
}))

vi.mock('@main/services/OssUploadService', () => ({
  ossUploadService: {
    uploadLocalFile: vi.fn()
  }
}))

import DraftManagementServer from '../draft-management'

type DraftManagementServerInstance = InstanceType<typeof DraftManagementServer>

function createServer(workspacePath?: string) {
  return new DraftManagementServer(workspacePath, 'runtime-owner-A')
}

async function callTool(server: DraftManagementServerInstance, toolName: string, args: Record<string, unknown>) {
  const handlers = (server.mcpServer.server as any)._requestHandlers
  const callToolHandler = handlers?.get('tools/call')
  if (!callToolHandler) {
    throw new Error('No tools/call handler registered')
  }
  return callToolHandler({ method: 'tools/call', params: { name: toolName, arguments: args } }, {})
}

async function listTools(server: DraftManagementServerInstance) {
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

describe('DraftManagementServer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStoreGet.mockImplementation((key: string) => (key === 'auth.refresh_token' ? 'refresh-token' : undefined))
  })

  it('should expose create, modify, and query tools', async () => {
    const server = createServer()
    const result = await listTools(server)

    expect(result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      'create_draft',
      'modify_draft',
      'query_script'
    ])
  })

  it('should document the optional local-only test flag', async () => {
    const { tools } = await listTools(createServer())
    expect(tools[0].inputSchema.properties.is_test).toMatchObject({ type: 'boolean', default: false })
    expect(tools[0].inputSchema.properties.is_test.description).toContain('Not sent to the backend')
    expect(tools[0].inputSchema.required || []).not.toContain('is_test')
  })

  it.each([false, true])('should handle explicit is_test=%s without forwarding it', async (isTest) => {
    const saved = new Map<string, unknown>()
    mockStoreSet.mockImplementation((key, value) => saved.set(key, value))
    mockStoreGet.mockImplementation((key) => key === 'auth.refresh_token' ? 'refresh-token' : saved.get(key))
    mockNetFetch.mockImplementation(async (url) => String(url).includes('/oidc/token')
      ? mockJsonResponse({ access_token: 'token' })
      : mockJsonResponse({ success: true, output: { draft_id: 'test-created' } }))
    const result = await callTool(createServer(), 'create_draft', { is_test: isTest, name: 'Verification' })
    expect(JSON.parse(result.content[0].text).output.draft_id).toBe('test-created')
    expect(JSON.parse(mockNetFetch.mock.calls[1][1].body)).toEqual({ name: 'Verification' })
    expect(mockWebContentsSend).toHaveBeenCalledTimes(isTest ? 0 : 2)
    expect([...saved.keys()].filter((key) => key.startsWith('drafts.'))).toHaveLength(isTest ? 1 : 0)
    mockWebContentsSend.mockClear()
    await callTool(createServer(), 'modify_draft', { draftId: 'test-created', name: 'Edited' })
    expect(mockWebContentsSend).toHaveBeenCalledTimes(isTest ? 0 : 2)
  })

  it.each([
    { ok: false, data: { error: 'HTTP error' } },
    { ok: true, data: { success: false, output: { draft_id: 'failed' } } },
    { ok: true, data: { error: 'Rejected', output: { draft_id: 'failed' } } },
    { ok: true, data: { success: true, output: {} } }
  ])('should not register unsuccessful test creation: %j', async ({ ok, data }) => {
    mockNetFetch.mockResolvedValueOnce(mockJsonResponse({ access_token: 'token' }))
      .mockResolvedValueOnce(mockJsonResponse(data, ok, ok ? 200 : 500))
    await callTool(createServer(), 'create_draft', { is_test: true })
    expect(mockWebContentsSend).not.toHaveBeenCalled()
    expect(mockStoreSet.mock.calls.filter(([key]) => key.startsWith('drafts.'))).toHaveLength(0)
  })

  it('should reject a non-boolean test flag before requests or events', async () => {
    const result = await callTool(createServer(), 'create_draft', { is_test: 'true' })
    expect(result.isError).toBe(true)
    expect(mockNetFetch).not.toHaveBeenCalled()
    expect(mockWebContentsSend).not.toHaveBeenCalled()
  })

  it('should create a draft', async () => {
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
          output: {
            draft_id: 'dfd_create_1',
            draft_url: 'https://www.vectcut.com/draft/downloader?draft_id=dfd_create_1'
          },
          success: true
        })
      )

    const server = createServer()
    const result = await callTool(server, 'create_draft', {
      width: 1080,
      height: 1920,
      name: '测试草稿',
      cover: 'https://example.com/cover.png'
    })

    expect(mockStoreSet).toHaveBeenCalledWith('auth.refresh_token', 'refresh-token-next')
    expect(mockNetFetch).toHaveBeenNthCalledWith(
      2,
      'https://open.vectcut.com/cut_jianying/create_draft',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
          'Content-Type': 'application/json'
        }),
        body: expect.any(String)
      })
    )
    expect(JSON.parse(mockNetFetch.mock.calls[1][1].body as string)).toEqual({
      width: 1080,
      height: 1920,
      name: '测试草稿',
      cover: 'https://example.com/cover.png'
    })

    expect(JSON.parse(result.content[0].text)).toEqual({
      provider: 'vectcut',
      action: 'create_draft',
      error: '',
      output: {
        draft_id: 'dfd_create_1',
        draft_url: 'https://www.vectcut.com/draft/downloader?draft_id=dfd_create_1'
      },
      success: true
    })

    expect(mockWebContentsSend).toHaveBeenCalledWith(
      'app:draft-created',
      expect.objectContaining({
        action: 'create',
        draftId: expect.stringMatching(/^pending:/),
        name: '测试草稿',
        cover: 'https://example.com/cover.png',
        width: 1080,
        height: 1920,
        runtimeSessionId: 'runtime-owner-A',
        status: 'in_progress'
      })
    )

    expect(mockWebContentsSend).toHaveBeenCalledWith(
      'app:draft-created',
      expect.objectContaining({
        action: 'create',
        draftId: 'dfd_create_1',
        name: '测试草稿',
        cover: 'https://example.com/cover.png',
        width: 1080,
        height: 1920,
        runtimeSessionId: 'runtime-owner-A',
        status: 'completed'
      })
    )
  })

  it('should modify draft metadata with snake_case alias support', async () => {
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
          output: {
            draft_id: 'dfd_meta_1',
            draft_url: 'https://www.vectcut.com/draft/downloader?draft_id=dfd_meta_1'
          },
          success: true
        })
      )

    const server = createServer()
    const result = await callTool(server, 'modify_draft', {
      draft_id: 'dfd_meta_1',
      name: '新草稿名',
      cover: 'https://example.com/new-cover.png'
    })

    expect(mockNetFetch).toHaveBeenNthCalledWith(
      2,
      'https://open.vectcut.com/cut_jianying/modify_draft',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          draft_id: 'dfd_meta_1',
          name: '新草稿名',
          cover: 'https://example.com/new-cover.png'
        })
      })
    )

    expect(JSON.parse(result.content[0].text)).toEqual({
      provider: 'vectcut',
      action: 'modify_draft',
      error: '',
      output: {
        draft_id: 'dfd_meta_1',
        draft_url: 'https://www.vectcut.com/draft/downloader?draft_id=dfd_meta_1'
      },
      success: true
    })

    expect(mockWebContentsSend).toHaveBeenCalledWith(
      'app:draft-created',
      expect.objectContaining({
        action: 'modify',
        draftId: 'dfd_meta_1',
        name: '新草稿名',
        cover: 'https://example.com/new-cover.png',
        runtimeSessionId: 'runtime-owner-A',
        status: 'in_progress'
      })
    )

    expect(mockWebContentsSend).toHaveBeenCalledWith(
      'app:draft-created',
      expect.objectContaining({
        action: 'modify',
        draftId: 'dfd_meta_1',
        name: '新草稿名',
        cover: 'https://example.com/new-cover.png',
        runtimeSessionId: 'runtime-owner-A',
        status: 'completed'
      })
    )
  })

  it('should inspect draft script and return a parsed summary', async () => {
    const workspacePath = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'draft-management-test-'))

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
          error: '',
          output: JSON.stringify({
            duration: 8_000_000,
            fps: 30,
            canvas_config: { width: 1080, height: 1920 },
            tracks: [{ id: 'track-1' }, { id: 'track-2' }],
            materials: {
              videos: [{ id: 'video-1' }],
              texts: [{ id: 'text-1' }]
            }
          })
        })
      )

    try {
      const server = createServer(workspacePath)
      const result = await callTool(server, 'query_script', {
        draftId: 'dfd_query_1',
        forceUpdate: false
      })

      expect(mockNetFetch).toHaveBeenNthCalledWith(
        2,
        'https://open.vectcut.com/cut_jianying/query_script',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            draft_id: 'dfd_query_1',
            force_update: false
          })
        })
      )

      const parsedResult = JSON.parse(result.content[0].text)
      const expectedScriptPath = path.join(workspacePath, 'dfd_query_1.json')

      expect(parsedResult).toEqual({
        provider: 'vectcut',
        action: 'query_script',
        draft_id: 'dfd_query_1',
        script_summary: {
          duration_us: 8_000_000,
          duration_s: 8,
          fps: 30,
          canvas: { width: 1080, height: 1920 },
          track_count: 2,
          material_group_count: 2
        },
        script_file_path: expectedScriptPath,
        script_relative_path: 'dfd_query_1.json',
        success: true,
        error: ''
      })

      const savedScript = JSON.parse(await fsPromises.readFile(parsedResult.script_file_path, 'utf8'))
      expect(savedScript).toEqual({
        duration: 8_000_000,
        fps: 30,
        canvas_config: { width: 1080, height: 1920 },
        tracks: [{ id: 'track-1' }, { id: 'track-2' }],
        materials: {
          videos: [{ id: 'video-1' }],
          texts: [{ id: 'text-1' }]
        }
      })
    } finally {
      await fsPromises.rm(workspacePath, { recursive: true, force: true })
    }
  })
})
