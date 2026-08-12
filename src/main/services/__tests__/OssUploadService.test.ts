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

import { ossUploadService } from '../OssUploadService'

function mockJsonResponse(data: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data)
  } as Response
}

describe('OssUploadService', () => {
  let tempFilePath = ''

  beforeEach(async () => {
    vi.clearAllMocks()
    ;(ossUploadService as any).accessToken = null
    ;(ossUploadService as any).refreshPromise = null
    mockStoreGet.mockImplementation((key: string) => {
      if (key === 'auth.refresh_token') return 'refresh-token'
      if (key === 'settings.userId') return 'user-123'
      return undefined
    })

    tempFilePath = path.join(os.tmpdir(), `oss-upload-${Date.now()}.mp3`)
    await fs.writeFile(tempFilePath, Buffer.from('hello upload'))
  })

  afterEach(async () => {
    if (tempFilePath) {
      await fs.rm(tempFilePath, { force: true })
    }
  })

  it('uploads local files through the agent tmp init flow and returns the signed download url', async () => {
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
          file_name: 'demo.mp3',
          object_key: 'agent_tmp/user-123/vectcut_koubo_tmp_file_server.mp3',
          upload: {
            upload_url: 'https://oss-hangzhou-mp4.oss-cn-hangzhou.aliyuncs.com',
            form_data: {
              key: 'agent_tmp/user-123/vectcut_koubo_tmp_file_server.mp3',
              policy: 'policy-value',
              OSSAccessKeyId: 'ak',
              Signature: 'sig'
            }
          },
          download: {
            signed_url: 'https://open.vectcut.com/download/agent_tmp/user-123/vectcut_koubo_tmp_file_server.mp3?token=1'
          }
        })
      )
      .mockResolvedValueOnce(mockJsonResponse({}, true, 200))

    const bytes = await fs.readFile(tempFilePath)
    const result = await ossUploadService.uploadLocalFile(tempFilePath, {
      bucket: 'oss-hangzhou-mp4',
      region: 'oss-cn-hangzhou',
      folder: 'agent_tmp/{uid}',
      objectKeyPrefix: 'vectcut_koubo_tmp_file_',
      signExpiresSeconds: 3600
    })

    expect(mockStoreSet).toHaveBeenCalledWith('auth.refresh_token', 'refresh-token-next')
    expect(mockNetFetch).toHaveBeenNthCalledWith(
      2,
      'https://open.vectcut.com/sts/upload/agent_tmp/init',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
          'Content-Type': 'application/json'
        }),
        body: JSON.stringify({
          file_name: path.basename(tempFilePath)
        })
      })
    )
    expect(mockNetFetch).toHaveBeenNthCalledWith(
      3,
      'https://oss-hangzhou-mp4.oss-cn-hangzhou.aliyuncs.com',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(FormData)
      })
    )
    expect(result.objectKey).toBe('agent_tmp/user-123/vectcut_koubo_tmp_file_server.mp3')
    expect(result.folder).toBe('agent_tmp/user-123')
    expect(result.publicUrl).toBe('https://open.vectcut.com/download/agent_tmp/user-123/vectcut_koubo_tmp_file_server.mp3?token=1')
    expect(result.signedPublicUrl).toBe(
      'https://open.vectcut.com/download/agent_tmp/user-123/vectcut_koubo_tmp_file_server.mp3?token=1'
    )
    expect(result.bucket).toBe('oss-hangzhou-mp4')
    expect(result.region).toBe('oss-cn-hangzhou')
    expect(result.contentType).toBe('audio/mpeg')
    expect(result.size).toBe(bytes.length)
  })
})
