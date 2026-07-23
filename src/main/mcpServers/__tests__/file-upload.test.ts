import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUploadLocalFile } = vi.hoisted(() => ({
  mockUploadLocalFile: vi.fn()
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

import FileUploadServer from '../file-upload'

type FileUploadServerInstance = InstanceType<typeof FileUploadServer>

function createServer() {
  return new FileUploadServer()
}

async function callTool(server: FileUploadServerInstance, args: Record<string, unknown>) {
  const handlers = (server.mcpServer.server as any)._requestHandlers
  const callToolHandler = handlers?.get('tools/call')
  if (!callToolHandler) {
    throw new Error('No tools/call handler registered')
  }
  return callToolHandler({ method: 'tools/call', params: { name: 'upload_file_to_oss', arguments: args } }, {})
}

async function listTools(server: FileUploadServerInstance) {
  const handlers = (server.mcpServer.server as any)._requestHandlers
  const listHandler = handlers?.get('tools/list')
  if (!listHandler) {
    throw new Error('No tools/list handler registered')
  }
  return listHandler({ method: 'tools/list', params: {} }, {})
}

describe('FileUploadServer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should expose the upload_file_to_oss tool', async () => {
    const server = createServer()
    const result = await listTools(server)

    expect(result.tools).toHaveLength(1)
    expect(result.tools[0].name).toBe('upload_file_to_oss')
  })

  it('should upload a local file with fixed OSS options', async () => {
    mockUploadLocalFile.mockResolvedValue({
      objectKey: 'agent_tmp/user-123/vectcut_koubo_tmp_file_hash.mp3',
      folder: 'agent_tmp/user-123',
      publicUrl: 'https://player.install-ai-guider.top/agent_tmp/user-123/vectcut_koubo_tmp_file_hash.mp3',
      signedPublicUrl: 'https://player.install-ai-guider.top/agent_tmp/user-123/vectcut_koubo_tmp_file_hash.mp3?token=1',
      bucket: 'oss-hangzhou-mp4',
      region: 'oss-cn-hangzhou',
      contentType: 'audio/mpeg',
      size: 1234
    })

    const server = createServer()
    const result = await callTool(server, {
      filePath: '/tmp/demo.mp3'
    })

    expect(mockUploadLocalFile).toHaveBeenCalledWith('/tmp/demo.mp3', {
      bucket: 'oss-hangzhou-mp4',
      region: 'oss-cn-hangzhou',
      folder: 'agent_tmp/{uid}',
      contentType: undefined,
      objectKeyPrefix: 'vectcut_koubo_tmp_file_',
      publicEndpoint: 'https://player.install-ai-guider.top',
      signExpiresSeconds: 3600
    })
    expect(JSON.parse(result.content[0].text)).toEqual({
      provider: 'vectcut',
      action: 'upload_file',
      file_path: '/tmp/demo.mp3',
      bucket: 'oss-hangzhou-mp4',
      region: 'oss-cn-hangzhou',
      folder: 'agent_tmp/user-123',
      object_key: 'agent_tmp/user-123/vectcut_koubo_tmp_file_hash.mp3',
      public_url: 'https://player.install-ai-guider.top/agent_tmp/user-123/vectcut_koubo_tmp_file_hash.mp3',
      signed_public_url: 'https://player.install-ai-guider.top/agent_tmp/user-123/vectcut_koubo_tmp_file_hash.mp3?token=1',
      content_type: 'audio/mpeg',
      size: 1234
    })
  })

  it('should reject non-absolute file paths', async () => {
    const server = createServer()
    const result = await callTool(server, {
      filePath: 'relative/demo.mp3'
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("'filePath' must be an absolute path")
  })

  it('should surface a readable error when file exceeds 500MB', async () => {
    mockUploadLocalFile.mockRejectedValue(new Error('FILE_TOO_LARGE'))

    const server = createServer()
    const result = await callTool(server, {
      filePath: '/tmp/huge-video.mp4'
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain(
      '文件大小不能超过 500MB， 如有需要请去官网资产库上传：https://www.vectcut.com/materials'
    )
  })
})
