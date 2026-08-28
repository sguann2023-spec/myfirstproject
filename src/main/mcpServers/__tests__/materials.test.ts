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

import MaterialsServer from '../materials'

type MaterialsServerInstance = InstanceType<typeof MaterialsServer>

function createServer(workspaceRoot?: string) {
  return new MaterialsServer(workspaceRoot)
}

async function callTool(server: MaterialsServerInstance, args: Record<string, unknown>) {
  const handlers = (server.mcpServer.server as any)._requestHandlers
  const callToolHandler = handlers?.get('tools/call')
  if (!callToolHandler) {
    throw new Error('No tools/call handler registered')
  }
  return callToolHandler({ method: 'tools/call', params: { name: 'folder_links', arguments: args } }, {})
}

async function listTools(server: MaterialsServerInstance) {
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

describe('MaterialsServer', () => {
  let workspaceRoot: string

  beforeEach(async () => {
    vi.clearAllMocks()
    mockStoreGet.mockImplementation((key: string) => (key === 'auth.refresh_token' ? 'refresh-token' : undefined))
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'materials-server-test-'))
    vi.stubEnv('WORKSPACE_ROOT', workspaceRoot)
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await fs.rm(workspaceRoot, { recursive: true, force: true }).catch(() => undefined)
  })

  it('should expose the folder_links tool', async () => {
    const server = createServer(workspaceRoot)
    const result = await listTools(server)

    expect(result.tools.map((tool: { name: string }) => tool.name)).toEqual(['folder_links'])
  })

  it('should fetch folder links and persist the full result into the workspace', async () => {
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
          folder_id: '123456',
          folder_path: '项目A/成片',
          include_subfolders: true,
          items: [
            {
              object_key: 'files/user_123/20260603/demo.mp4',
              file_name: 'demo.mp4',
              folder_path: '项目A/成片',
              file_size_bytes: 12873455,
              updated_at: '2026-06-03 15:23:10',
              public_signed_url: 'https://open.vectcut.com/materials/file-1'
            },
            {
              object_key: 'files/user_123/20260603/voice.mp3',
              file_name: 'voice.mp3',
              folder_path: '项目A/成片',
              file_size_bytes: 1024,
              updated_at: null,
              public_signed_url: 'https://open.vectcut.com/materials/file-2'
            }
          ],
          count: 2
        })
      )

    const server = createServer(workspaceRoot)
    const result = await callTool(server, { folder_id: '123456' })

    expect(mockStoreSet).toHaveBeenCalledWith('auth.refresh_token', 'refresh-token-next')
    expect(mockNetFetch).toHaveBeenNthCalledWith(
      2,
      'https://open.vectcut.com/sts/folder/share_links',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
          'Content-Type': 'application/json'
        }),
        body: JSON.stringify({
          folder_id: '123456',
          limit: 100
        })
      })
    )

    const payload = JSON.parse(result.content[0].text)
    expect(payload).toEqual({
      provider: 'vectcut',
      action: 'folder_links',
      folder_id: '123456',
      folder_path: '项目A/成片',
      file_count: 2,
      artifact: {
        storage: 'workspace_file',
        file_path: path.join(workspaceRoot, '.capcut', 'tool-results', 'materials', 'folder-links-123456.json'),
        relative_path: path.join('.capcut', 'tool-results', 'materials', 'folder-links-123456.json')
      }
    })

    const storedText = await fs.readFile(payload.artifact.file_path, 'utf8')
    expect(JSON.parse(storedText)).toEqual({
      provider: 'vectcut',
      action: 'folder_links',
      folder_id: '123456',
      folder_path: '项目A/成片',
      include_subfolders: true,
      count: 2,
      requested_limit: 100,
      fetched_via: {
        method: 'POST',
        endpoint: 'https://open.vectcut.com/sts/folder/share_links'
      },
      file_count: 2,
      links: [
        {
          name: 'demo.mp4',
          object_key: 'files/user_123/20260603/demo.mp4',
          folder_path: '项目A/成片',
          file_size_bytes: 12873455,
          updated_at: '2026-06-03 15:23:10',
          url: 'https://open.vectcut.com/materials/file-1'
        },
        {
          name: 'voice.mp3',
          object_key: 'files/user_123/20260603/voice.mp3',
          folder_path: '项目A/成片',
          file_size_bytes: 1024,
          updated_at: null,
          url: 'https://open.vectcut.com/materials/file-2'
        }
      ],
      raw_result: {
        success: true,
        folder_id: '123456',
        folder_path: '项目A/成片',
        include_subfolders: true,
        items: [
          {
            object_key: 'files/user_123/20260603/demo.mp4',
            file_name: 'demo.mp4',
            folder_path: '项目A/成片',
            file_size_bytes: 12873455,
            updated_at: '2026-06-03 15:23:10',
            public_signed_url: 'https://open.vectcut.com/materials/file-1'
          },
          {
            object_key: 'files/user_123/20260603/voice.mp3',
            file_name: 'voice.mp3',
            folder_path: '项目A/成片',
            file_size_bytes: 1024,
            updated_at: null,
            public_signed_url: 'https://open.vectcut.com/materials/file-2'
          }
        ],
        count: 2
      }
    })
  })

  it('should accept custom limit when requesting folder links', async () => {
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
          folder_id: '123456',
          folder_path: '项目A/成片',
          include_subfolders: true,
          items: [],
          count: 0
        })
      )

    const server = createServer(workspaceRoot)
    await callTool(server, { folder_id: '123456', limit: 20 })

    expect(mockNetFetch).toHaveBeenNthCalledWith(
      2,
      'https://open.vectcut.com/sts/folder/share_links',
      expect.objectContaining({
        body: JSON.stringify({
          folder_id: '123456',
          limit: 20
        })
      })
    )
  })

  it('should reject requests without folder id', async () => {
    const server = createServer(workspaceRoot)
    const result = await callTool(server, {})

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("'folderId' or 'folder_id' is required")
  })

  it('should reject invalid limit values', async () => {
    const server = createServer(workspaceRoot)
    const result = await callTool(server, { folder_id: '123456', limit: 101 })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("'limit' must be an integer between 1 and 100")
  })
})
